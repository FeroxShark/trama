// «Revisar con IA» del panel Contexto, el lado del main: junta los archivos que se cargan en cada mensaje (CLAUDE.md del usuario, los de instrucciones
// del proyecto, MEMORY.md y su carpeta), le pide a un revisor (por suscripción, de sólo lectura: `correrRevisor`) recortes con reemplazo exacto y
// los aplica con respaldo cuando la persona los elige. Los tipos y el prompt/parser puros están en auditoria-contexto-texto.ts.
//   auditar          lee y manda; no escribe NADA en el disco de la persona. La auditoría queda en memoria, por proyecto, con la huella sha256 de cada archivo.
//   aplicarHallazgos relee cada archivo: si la huella cambió no lo toca (sus hallazgos quedan `invalido`); si no, copia el original a
//                    <estado>/md-backup/<marca>/ y escribe todos los reemplazos del archivo de una vez, sobre el texto original.
// Nunca se sigue un enlace simbólico (se escribiría a través de él) y nunca se mandan claves, mails ni teléfonos a un motor que no es Claude.
import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { apariciones, parsearHallazgos, promptAuditor, textoLF, type Auditoria, type Hallazgo } from "./auditoria-contexto-texto.ts";
import { enmascarar, rutasClaude } from "./conectores-claude.ts";
import { memoriaDe } from "./contexto-local.ts";
import { tokensAprox } from "./contexto-sesion.ts";
import { errorT } from "./errores.ts";
import { enBlanco, MD_MAX_BYTES } from "./instrucciones-md.ts";
import { codexListo, correrRevisor, revisoresPermitidos, type OpcionesCorrida } from "./revision-plan.ts";
import { claseDeModelo, excluirGuardado, memoriaCompartidaGuardada } from "./modelos-config.ts";
import type { MotorMemoria } from "./modelos-tipos.ts";
import { real, registro, slug as slugDe } from "./registro.ts";
import { estadoPa } from "./rutas.ts";
import { marcaDeTiempo, estadoMd } from "./unificar-md.ts";

/** Lo más que se manda al revisor, en caracteres de todos los archivos juntos (~60 mil tokens). El que no entra se saltea (y no figura en la auditoría). */
export const TOPE_CARACTERES = 200_000;
/** Los modelos de Claude que se prueban para el revisor por defecto, del más barato al más caro. */
export const MODELOS_DEFECTO = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;

export type ArchivoJuntado = { ruta: string; texto: string; huella: string; /** De la memoria del dueño (`MEMORY.md` y su carpeta). */ memoria: boolean };

export type CorrerRevisor = typeof correrRevisor;

export type DepsAuditoria = {
  env?: Record<string, string | undefined>;
  /** Cuáles de estos ids se pueden usar de revisor; por defecto `revisoresPermitidos` con lo que desactivó la persona en Ajustes > Modelos. */
  permitidos?: (ids: string[]) => Promise<string[]>;
  /** ¿Recibe este motor la memoria? Por defecto el interruptor «Memoria compartida» de modelos.json. */
  memoriaCompartida?: (motor: MotorMemoria) => boolean;
  /** La carpeta del estado de `pa` de ese proyecto (<estado>/<slug>), donde va `md-backup/`. */
  estadoDe?: (cwd: string) => Promise<string>;
  ahora?: () => Date;
};

export const huellaDe = (texto: string) => createHash("sha256").update(texto).digest("hex");

/** Un `.md` regular (nunca un enlace) y de tamaño razonable: su ruta real y su texto; `null` si no sirve. */
async function leerSeguro(ruta: string): Promise<{ ruta: string; texto: string } | null> {
  const l = await lstat(ruta).catch(() => null);
  if (!l || l.isSymbolicLink() || !l.isFile() || l.size > MD_MAX_BYTES) return null;
  const [texto, real] = await Promise.all([readFile(ruta, "utf8").catch(() => null), realpath(ruta).catch(() => null)]);
  return texto === null || real === null || enBlanco(texto) ? null : { ruta: real, texto };
}

/**
 * Los archivos que se cargan en cada mensaje para un proyecto: el CLAUDE.md del usuario, los CLAUDE.md / AGENTS.md / GEMINI.md propios de `cwd`
 * (los `real` de `estadoMd`: un stub no aporta), `MEMORY.md` y los `.md` de la carpeta de memoria del proyecto. Sin repetidos (por ruta real),
 * sin enlaces simbólicos y hasta `TOPE_CARACTERES`.
 */
export async function juntarArchivos(cwd: string, d: Pick<DepsAuditoria, "env"> = {}): Promise<ArchivoJuntado[]> {
  const env = d.env ?? process.env;
  const rutas = rutasClaude(env);
  const candidatos: { ruta: string; memoria: boolean }[] = [{ ruta: path.join(rutas.claude, "CLAUDE.md"), memoria: false }];
  const st = await estadoMd(cwd, env).catch(() => null);
  for (const f of st?.archivos ?? []) if (f.tipo === "real") candidatos.push({ ruta: path.join(cwd, f.archivo), memoria: false });
  const indice = memoriaDe(rutas.home, cwd, env);
  candidatos.push({ ruta: indice, memoria: true });
  const carpeta = path.dirname(indice);
  const nombres = (await readdir(carpeta).catch(() => [] as string[])).filter((n) => /\.md$/i.test(n) && n !== path.basename(indice)).sort();
  for (const n of nombres) candidatos.push({ ruta: path.join(carpeta, n), memoria: true });

  const vistos = new Set<string>();
  const r: ArchivoJuntado[] = [];
  let total = 0;
  for (const c of candidatos) {
    const x = await leerSeguro(c.ruta);
    if (!x || vistos.has(x.ruta)) continue;
    vistos.add(x.ruta);
    if (total + x.texto.length > TOPE_CARACTERES) continue;
    total += x.texto.length;
    r.push({ ruta: x.ruta, texto: x.texto, huella: huellaDe(x.texto), memoria: c.memoria });
  }
  return r;
}

// --- Lo que sale de la máquina hacia un motor que no es Claude -----------------------------------------------------------------

const MAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Un teléfono: 8 a 15 dígitos con separadores (espacios, guiones, puntos, paréntesis) y un `+` opcional; no toca fechas ni números sueltos cortos. */
const TELEFONO = /(?<![\w./-])\+?\(?\d[\d ()./-]{6,17}\d(?![\w/-])/g;

/** Una fecha (2026-11-22, 22/11/2026, 22.11.2026): ocho dígitos que no son un teléfono. */
const FECHA = /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})$/;

/** El texto sin claves, mails ni teléfonos (lo que se manda a un motor que no es Claude). Sólo para el prompt: los hallazgos se validan contra el original. */
export function sinDatosPrivados(texto: string): string {
  return enmascarar(texto)
    .replace(MAIL, "[correo]")
    .replace(TELEFONO, (m) => (m.replace(/\D/g, "").length >= 8 && !FECHA.test(m) ? "[teléfono]" : m));
}

// --- Las auditorías (en memoria, una por proyecto) ----------------------------------------------------------------------------

const porProyecto = new Map<string, Auditoria>();
const corriendo = new Map<string, Promise<Auditoria>>();
const copia = (a: Auditoria): Auditoria => ({ ...a, archivos: a.archivos.map((x) => ({ ...x })), hallazgos: a.hallazgos.map((h) => ({ ...h })) });
const porId = (id: string) => [...porProyecto.values()].find((a) => a.id === id);

export const auditoriaDe = (cwd: string): Auditoria | null => {
  const a = porProyecto.get(cwd);
  return a ? copia(a) : null;
};

/** El revisor: el pedido si se puede, y si no hay pedido el más barato de Claude permitido (Haiku) o, en su defecto, el primero que haya. */
async function elegirModelo(pedido: string | undefined, d: DepsAuditoria): Promise<string> {
  const permitidos =
    d.permitidos ??
    (async (ids: string[]) => revisoresPermitidos(ids, excluirGuardado(), ids.some((i) => claseDeModelo(i) === "codex") && (await codexListo())));
  if (pedido) {
    if ((await permitidos([pedido])).includes(pedido)) return pedido;
    throw errorT("main.auditoriaModelo", { v: pedido });
  }
  const ok = await permitidos([...MODELOS_DEFECTO]);
  if (!ok[0]) throw errorT("main.auditoriaModelo", { v: MODELOS_DEFECTO[0] });
  return ok[0];
}

const lineaDeAvance = (a: { paso?: { v: string }; texto?: string }): string | null => {
  const t = (a.texto ?? a.paso?.v ?? "").trim().split("\n").filter(Boolean).pop();
  return t ? t.slice(0, 160) : null;
};

export type PedidoAuditar = { cwd: string; modelo?: string; effort?: string };

/**
 * Revisa los archivos de `cwd` con un modelo y guarda la auditoría. No escribe nada en disco de la persona. Con Gemini o ChatGPT respeta el
 * interruptor «Memoria compartida» de ese motor (apagado: la memoria no se manda) y pasa el texto por `sinDatosPrivados`. Si el revisor falla, la
 * auditoría queda en `estado: "error"` con el texto traducido (no se lanza). Una segunda llamada mientras corre devuelve la misma corrida.
 */
export function auditar(x: PedidoAuditar, correr: CorrerRevisor = correrRevisor, d: DepsAuditoria = {}): Promise<Auditoria> {
  const previa = corriendo.get(x.cwd);
  if (previa) return previa;
  const p = auditarUna(x, correr, d).finally(() => corriendo.delete(x.cwd));
  corriendo.set(x.cwd, p);
  return p;
}

async function auditarUna(x: PedidoAuditar, correr: CorrerRevisor, d: DepsAuditoria): Promise<Auditoria> {
  const modelo = await elegirModelo(x.modelo, d);
  const clase = claseDeModelo(modelo);
  const juntos = await juntarArchivos(x.cwd, d);
  const motor = clase === "gemini" || clase === "codex" ? clase : null;
  const compartida = d.memoriaCompartida ?? memoriaCompartidaGuardada;
  const enviados = juntos.filter((f) => !f.memoria || !motor || compartida(motor));
  if (!enviados.length) throw errorT("main.auditoriaSinArchivos");
  const a: Auditoria = {
    id: randomUUID(),
    cwd: x.cwd,
    modelo,
    estado: "corriendo",
    avance: null,
    error: null,
    archivos: enviados.map((f) => ({ ruta: f.ruta, tokens: tokensAprox(f.texto), huella: f.huella })),
    hallazgos: [],
    respaldo: null,
  };
  porProyecto.set(x.cwd, a);
  // Un revisor que no es Claude corre en una carpeta vacía: que no pueda leer la memoria por su cuenta aunque el interruptor esté apagado.
  const vacia = motor ? await mkdtemp(path.join(os.tmpdir(), "trama-auditoria-")) : undefined;
  try {
    const prompt = promptAuditor(enviados.map((f) => ({ ruta: f.ruta, texto: motor ? sinDatosPrivados(f.texto) : f.texto })));
    const o: OpcionesCorrida = { avance: (v) => void (a.avance = lineaDeAvance(v) ?? a.avance), señal: new AbortController().signal };
    const salida = await correr(modelo, x.effort ?? "", prompt, vacia, o);
    if (!salida.trim()) throw errorT("main.revisionVacia", { v: modelo });
    a.hallazgos = parsearHallazgos(salida, enviados);
    a.estado = "lista";
  } catch (e) {
    a.estado = "error";
    a.error = e instanceof Error ? e.message : String(e);
  } finally {
    a.avance = null;
    if (vacia) await rm(vacia, { recursive: true, force: true }).catch(() => {});
  }
  return copia(a);
}

// --- Aplicar -------------------------------------------------------------------------------------------------------------------

/** El nombre con que una ruta queda en la carpeta del respaldo: sin separadores ni `:` (rutas de Linux y de Windows). */
export const nombreRespaldo = (ruta: string) => ruta.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "");

async function copiarSinPisar(origen: string, dir: string): Promise<void> {
  const base = nombreRespaldo(origen);
  for (let n = 0; ; n++) {
    const destino = path.join(dir, n ? `${base}.${n}` : base);
    if (!(await lstat(destino).catch(() => null))) return copyFile(origen, destino);
  }
}

async function escribirArchivo(ruta: string, texto: string): Promise<void> {
  const modo = await stat(ruta).then((s) => s.mode & 0o777, () => 0o644);
  const tmp = path.join(path.dirname(ruta), `.${path.basename(ruta)}.trama-${process.pid}.tmp`);
  try {
    await writeFile(tmp, texto, { mode: modo });
    await rename(tmp, ruta);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** Todos los reemplazos de un archivo sobre su texto original, de una vez: los que no están una sola vez o se pisan con uno anterior quedan fuera. */
export function reemplazar(lf: string, hs: readonly Hallazgo[]): { texto: string; hechos: Set<string> } {
  const tomados: { ini: number; fin: number; h: Hallazgo }[] = [];
  for (const h of hs) {
    if (apariciones(lf, h.buscar) !== 1) continue;
    const ini = lf.indexOf(h.buscar);
    const fin = ini + h.buscar.length;
    if (tomados.some((t) => ini < t.fin && t.ini < fin)) continue;
    tomados.push({ ini, fin, h });
  }
  let texto = lf;
  for (const t of [...tomados].sort((p, q) => q.ini - p.ini)) texto = texto.slice(0, t.ini) + t.h.reemplazo + texto.slice(t.fin);
  return { texto, hechos: new Set(tomados.map((t) => t.h.id)) };
}

let fila: Promise<unknown> = Promise.resolve();

/**
 * Aplica los hallazgos `ids` de la auditoría `id`. Por archivo: si su huella ya no es la de la auditoría (o es un enlace) no se toca y sus
 * hallazgos quedan `invalido`; si no, se copia el original a <estado>/md-backup/<marca>/ y se escribe (CRLF se conserva). Después se actualiza la
 * huella y los pendientes de ese archivo se revalidan. De a una aplicación por vez.
 */
export function aplicarHallazgos(id: string, ids: readonly string[], d: DepsAuditoria = {}): Promise<Auditoria> {
  const p = fila.then(() => aplicarUna(id, ids, d));
  fila = p.catch(() => {});
  return p;
}

async function aplicarUna(id: string, ids: readonly string[], d: DepsAuditoria): Promise<Auditoria> {
  const a = porId(id);
  if (!a || a.estado !== "lista") throw errorT("main.auditoriaNoEsta");
  const elegidos = a.hallazgos.filter((h) => h.estado === "pendiente" && ids.includes(h.id));
  const ahora = (d.ahora ?? (() => new Date()))();
  let respaldo: string | null = null;
  for (const arch of a.archivos) {
    const hs = elegidos.filter((h) => h.archivo === arch.ruta);
    if (!hs.length) continue;
    const x = await leerSeguro(arch.ruta);
    if (!x || x.ruta !== arch.ruta || huellaDe(x.texto) !== arch.huella) {
      for (const h of hs) h.estado = "invalido";
      continue;
    }
    const { texto: lf, crlf } = textoLF(x.texto);
    const { texto: nuevo, hechos } = reemplazar(lf, hs);
    for (const h of hs) if (!hechos.has(h.id)) h.estado = "invalido";
    if (!hechos.size) continue;
    respaldo ??= path.join(await (d.estadoDe ?? estadoPorDefecto)(a.cwd), "md-backup", marcaDeTiempo(ahora));
    await mkdir(respaldo, { recursive: true });
    await copiarSinPisar(arch.ruta, respaldo);
    const final = crlf ? nuevo.replace(/\n/g, "\r\n") : nuevo;
    await escribirArchivo(arch.ruta, final);
    for (const h of hs) if (hechos.has(h.id)) h.estado = "aplicado";
    arch.huella = huellaDe(final);
    arch.tokens = tokensAprox(final);
    a.respaldo = respaldo;
    const lfNuevo = textoLF(final).texto;
    for (const h of a.hallazgos) if (h.archivo === arch.ruta && h.estado === "pendiente" && apariciones(lfNuevo, h.buscar) !== 1) h.estado = "invalido";
  }
  return copia(a);
}

// --- Los canales ---------------------------------------------------------------------------------------------------------------

async function estadoPorDefecto(cwd: string): Promise<string> {
  const r = await real(cwd);
  const p = (await registro()).find((q) => q.ruta === cwd || q.ruta === r);
  return path.join(estadoPa(), p?.slug ?? (slugDe(cwd) || "_sin-proyecto"));
}

/** `proyecto` tiene que ser una carpeta del registry (o vacío: el home): nunca una ruta cualquiera que mande la ventana. */
async function cwdDeProyecto(proyecto: unknown, d: { registro?: () => Promise<{ ruta: string }[]> } = {}): Promise<string> {
  if (proyecto === undefined || proyecto === null || proyecto === "") return os.homedir();
  if (typeof proyecto !== "string") throw errorT("main.proyectoRaro", { v: "?" });
  const ps = await (d.registro ?? registro)();
  const pedido = await real(proyecto);
  const p = ps.find((q) => q.ruta === proyecto) ?? (await (async () => { for (const q of ps) if ((await real(q.ruta)) === pedido) return q; return undefined; })());
  if (!p) throw errorT("main.proyectoRaro", { v: proyecto.slice(0, 80) });
  return p.ruta;
}

const texto = (x: unknown) => (typeof x === "string" && x.length <= 120 ? x : undefined);
const dict = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});

/** `contexto:auditar`: `{ proyecto, modelo?, effort? }` → la auditoría al terminar (mientras corre, `contexto:auditoria` la devuelve con `avance`). */
export async function auditarContexto(x: unknown): Promise<Auditoria> {
  const o = dict(x);
  return auditar({ cwd: await cwdDeProyecto(o.proyecto), modelo: texto(o.modelo), effort: texto(o.effort) });
}

/** `contexto:auditoria`: `{ proyecto }` → la última auditoría de ese proyecto (o `null`). */
export async function auditoriaContexto(x: unknown): Promise<Auditoria | null> {
  return auditoriaDe(await cwdDeProyecto(dict(x).proyecto));
}

/** `contexto:aplicarHallazgo`: `{ id, hallazgos: string[] }` → la auditoría con esos hallazgos aplicados (o `invalido`). */
export async function aplicarHallazgoContexto(x: unknown): Promise<Auditoria> {
  const o = dict(x);
  const ids = Array.isArray(o.hallazgos) ? o.hallazgos.filter((i): i is string => typeof i === "string" && i.length <= 20).slice(0, 100) : [];
  return aplicarHallazgos(typeof o.id === "string" ? o.id : "", ids);
}
