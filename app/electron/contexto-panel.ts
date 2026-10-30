// El panel derecho de contexto en el main: junta lo que hace falta para cada canal (`contexto:desglose`, `skills:catalogo`,
// `apagados:leer` y `apagados:fijar`). Lo puro está en contexto-desglose.ts, skills-catalogo.ts y apagados.ts; acá se leen los
// transcripts, el inventario de Claude Code y el proceso del líder. Nunca lee ni devuelve credenciales (`~/.claude.json` no se toca: el
// inventario sólo saca nombres, y enmascarados).
import os from "node:os";
import path from "node:path";
import { fijarApagadoTrama, HERRAMIENTAS_PROTEGIDAS, leerApagadosTrama, TIPOS_APAGADO, type Apagados } from "./apagados.ts";
import { inventario, rutasClaude } from "./conectores-claude.ts";
import { capturarBase } from "./contexto-base.ts";
import { skillsDeSesion, vistaPrevia, type VistaPrevia } from "./contexto-previa.ts";
import { sidDeWorker, transcriptDe as transcriptPorSid, TRANSCRIPTS } from "./consumo.ts";
import { cwdDe, desdeClaude, desdeTranscript, medirConRespaldo, memoriaDeSesion, sinDesglose, usosDe, type Desglose, type Medicion } from "./contexto-desglose.ts";
import { leerTranscript, type Transcript } from "./contexto-jsonl.ts";
import { leerSesion } from "./contexto-sesion.ts";
import { errorT } from "./errores.ts";
import { sinLado, ventanaSub, type GastoSubagentes } from "./subagentes-gasto.ts";
import { carpetaDeSubagentes, crearGastos } from "./subagentes-gasto-disco.ts";
import type { Subagentes } from "./subagentes.ts";
import { aplicarApagadosLideres, claseDeLider, contextoVivo, transcriptDe as transcriptDeLider } from "./lider.ts";
import { PA_STATE } from "./pa.ts";
import { buscarSkills, catalogoSkills, DIAS_USOS, usosDeHistorial, type SkillCatalogo, type UsosCatalogo } from "./skills-catalogo.ts";

const SID = /^[0-9a-f-]{36}$/;
const ID_WORKER = /^[\w.@-]{1,120}$/;
const ID_SUB = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** La última medición exacta de cada líder vivo: si al refrescar no contesta, se sigue mostrando esa (marcada) en vez de saltar a una estimada. */
const ultimaMedicion = new Map<string, Medicion>();

/**
 * El último desglose de cada líder o worker, con la firma del transcript con que se calculó (ruta, tamaño, fecha y apagados). Mientras la
 * firma no cambie, el refresco automático no vuelve a analizar el transcript ni a preguntarle al líder: el panel se queda con lo mismo.
 */
const ultimoDesglose = new Map<string, { firma: string; d: Desglose }>();
/** Dónde está el transcript de cada worker: no cambia mientras viva su sesión, así que no se vuelve a buscar en `projects/` en cada refresco. */
const rutaWorker = new Map<string, string>();
/** Un pedido por vez por líder o worker: si el refresco automático se cruza con otro, el segundo espera al primero. */
const enVuelo = new Map<string, Promise<Desglose>>();
const TOPE = 40;

const firmaDe = (ruta: string, tr: Transcript, apagados: Apagados) => `${ruta}|${tr.tam}|${tr.mtime}|${JSON.stringify(apagados)}`;

/** Lo último calculado si la firma sigue igual (y no se pidió fresco): `null` si hay que volver a calcular. */
const guardado = (clave: string, firma: string | null, fresco: boolean): Desglose | null => {
  const previo = ultimoDesglose.get(clave);
  return !fresco && firma && previo?.firma === firma ? previo.d : null;
};

/** Guarda `d` con su firma (si la hay) y lo devuelve. */
function recordar(clave: string, firma: string | null, d: Desglose): Desglose {
  if (firma) {
    ultimoDesglose.delete(clave);
    ultimoDesglose.set(clave, { firma, d });
    if (ultimoDesglose.size > TOPE) ultimoDesglose.delete(ultimoDesglose.keys().next().value as string);
  }
  return d;
}

const gastos = crearGastos();

/** Los subagentes de una sesión de Claude (`{ lider: sid }`) con lo que gastó cada uno. `vivos`: los que sigue el main (con su estado al día). */
export async function gastoSubagentes(x: unknown, vivos?: { leer(): Promise<Subagentes> }): Promise<GastoSubagentes> {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  const sid = typeof o.lider === "string" ? o.lider : "";
  if (!SID.test(sid)) throw errorT("main.sesionRara", { v: sid.slice(0, 80) });
  const l = await claseDeLider(sid);
  const t = await transcriptDeLider(sid, l?.cwd).catch(() => null);
  if (!t) return { version: 1, sid, subagentes: [], total: { entrada: 0, cacheCreado: 0, cacheLeido: 0, salida: 0, total: 0 } };
  const base = (await vivos?.leer().catch(() => ({}) as Subagentes))?.[sid];
  const g = await gastos.listar(carpetaDeSubagentes(t), sid, base);
  // Una sesión sin proceso no sigue a nadie: lo que parece "corriendo" en su carpeta quedó a medias, no corre.
  return base ? g : { ...g, subagentes: g.subagentes.map((s) => (s.estado === "corriendo" ? { ...s, estado: "parado" as const } : s)) };
}

/**
 * El desglose de un líder (`{ lider: sid }`) o de un worker de `pa` (`{ worker: id }`). Líder de Claude vivo: su `/context` (exacto). Si no:
 * su transcript (estimado). Gemini, dsh y OpenCode: sin desglose. `fresco` (el botón de refrescar) salta lo guardado.
 */
export async function desgloseContexto(x: unknown): Promise<Desglose> {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  const clave = typeof o.lider === "string" ? `lider:${o.lider}` : typeof o.worker === "string" ? `worker:${o.worker}` : null;
  if (!clave) throw errorT("main.apagadoRaro", { v: "?" });
  const en = enVuelo.get(clave);
  if (en) return en;
  const pedido = calcularDesglose(o, clave, o.fresco === true).finally(() => enVuelo.delete(clave));
  enVuelo.set(clave, pedido);
  return pedido;
}

async function calcularDesglose(o: Record<string, unknown>, clave: string, fresco: boolean): Promise<Desglose> {
  const apagados = leerApagadosTrama();
  const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  if (typeof o.lider === "string") {
    const sid = o.lider;
    if (!SID.test(sid)) throw errorT("main.sesionRara", { v: sid.slice(0, 80) });
    const l = await claseDeLider(sid);
    const motor = l ? (l.local ? "local" : l.clase) : "claude";
    if (l && l.clase !== "claude") return sinDesglose({ tipo: "lider", id: sid, motor, modelo: l.modelo });
    const t = await transcriptDeLider(sid, l?.cwd).catch(() => null);
    const tr = await leerTranscript(t).catch(() => null);
    const ls = tr?.lineas ?? [];
    const firma = tr && t ? firmaDe(t, tr, apagados) : null;
    const previo = guardado(clave, firma, fresco);
    if (previo) return previo;
    const vivo = l && !l.local ? await medirConRespaldo(ultimaMedicion, sid, () => contextoVivo(sid)) : null;
    if (vivo) return recordar(clave, firma, desdeClaude(vivo.resp, { id: sid, usos: usosDe(ls), info: leerSesion(ls), medidoEn: vivo.en, desactualizado: vivo.viejo }));
    if (!ls.length) return sinDesglose({ tipo: "lider", id: sid, motor, modelo: l?.modelo, motivo: "sin-transcript" });
    const cwd = cwdDe(ls) ?? l?.cwd ?? os.homedir();
    const memoria = await memoriaDeSesion({ cwd, claudeDir, excludes: apagados.memoria });
    const skills = l?.local ? [] : await skillsDeSesion(cwd, apagados);
    return recordar(clave, firma, desdeTranscript(ls, { tipo: "lider", id: sid, motor, memoria, skills, excludes: apagados.memoria }));
  }
  if (o.subagente && typeof o.subagente === "object") {
    const q = o.subagente as Record<string, unknown>;
    const sid = typeof q.lider === "string" ? q.lider : "";
    const id = typeof q.id === "string" ? q.id : "";
    if (!SID.test(sid)) throw errorT("main.sesionRara", { v: sid.slice(0, 80) });
    if (!ID_SUB.test(id)) throw errorT("main.apagadoRaro", { v: id.slice(0, 80) });
    const l = await claseDeLider(sid);
    const t = await transcriptDeLider(sid, l?.cwd).catch(() => null);
    // Un subagente es de Claude Code aunque el líder haya cambiado de motor: su transcript manda.
    const ls = t ? await lineas(path.join(carpetaDeSubagentes(t), `agent-${id}.jsonl`)) : [];
    if (!ls.length) return sinDesglose({ tipo: "subagente", id, motor: "claude", motivo: "sin-transcript" });
    // Sólo lectura: lo que cargó es lo que dice su transcript (el prompt, las herramientas, las instrucciones que le llegaron); nada se inventa de archivos ni se apaga desde acá.
    const d = desdeTranscript(sinLado(ls), { tipo: "subagente", id, motor: "claude", memoria: [], skills: [], excludes: apagados.memoria });
    return d.ventana === null || d.ventanaEstimada ? { ...d, ventana: ventanaSub(d.modelo), ventanaEstimada: true } : d;
  }
  if (typeof o.worker === "string") {
    const id = o.worker;
    if (!ID_WORKER.test(id)) throw errorT("main.apagadoRaro", { v: id.slice(0, 80) });
    const sid = await sidDeWorker(PA_STATE, id);
    const t = sid ? await rutaDeWorker(sid) : null;
    const tr = await leerTranscript(t).catch(() => null);
    if (sid && t && !tr) rutaWorker.delete(sid);
    const ls = tr?.lineas ?? [];
    const firma = tr && t ? firmaDe(t, tr, apagados) : null;
    const previo = guardado(clave, firma, fresco);
    if (previo) return previo;
    // Sin transcript de Claude: un worker de otro motor (agy, dsh, OpenCode) o uno que todavía no arrancó.
    if (!ls.length) return sinDesglose({ tipo: "worker", id, motor: sid ? "claude" : "otro", motivo: sid ? "sin-transcript" : "motor-sin-desglose" });
    const cwd = cwdDe(ls) ?? os.homedir();
    // `pa` le saca al worker el CLAUDE.md del home (`claudeMdExcludes` de su --settings), además de lo que apagó Trama.
    const memoria = await memoriaDeSesion({ cwd, claudeDir, excludes: [path.join(os.homedir(), "CLAUDE.md"), ...apagados.memoria] });
    const skills = await skillsDeSesion(cwd, apagados);
    return recordar(clave, firma, desdeTranscript(ls, { tipo: "worker", id, motor: "claude", memoria, skills, excludes: [path.join(os.homedir(), "CLAUDE.md"), ...apagados.memoria] }));
  }
  throw errorT("main.apagadoRaro", { v: "?" });
}

/** Qué cargaría un líder o worker nuevo (`{ tipo, proyecto?, modelo? }`), sin lanzar nada. */
export const previaContexto = (x: unknown): Promise<VistaPrevia> => vistaPrevia(x);

/** Captura el prompt base de la versión instalada de `claude` (una vez por versión; ver contexto-base.ts) y devuelve sólo de cuál fue. */
export async function capturarBaseContexto(x: unknown): Promise<{ version: string; capturadoEn: number }> {
  const forzar = !!x && typeof x === "object" && (x as Record<string, unknown>).forzar === true;
  const b = await capturarBase({}, forzar);
  return { version: b.version, capturadoEn: b.capturadoEn };
}

async function rutaDeWorker(sid: string): Promise<string | null> {
  const en = rutaWorker.get(sid);
  if (en) return en;
  const t = await transcriptPorSid(TRANSCRIPTS, sid);
  if (t) rutaWorker.set(sid, t);
  return t;
}

export type Catalogo = { version: 1; skills: SkillCatalogo[]; total: number; exactos: boolean; usos: UsosCatalogo | null };

const ESPERA_USOS_MS = 5000;

/** El catálogo de skills, filtrado por `q`. Con `sid` de un líder de Claude vivo, los tokens de cada skill son los que dice él. */
export async function catalogoContexto(x: unknown, historial?: { ultimos(dias: unknown, rol: unknown): Promise<unknown> }): Promise<Catalogo> {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  const exactos = new Map<string, number>();
  if (typeof o.sid === "string" && SID.test(o.sid)) {
    const r = (await medirConRespaldo(ultimaMedicion, o.sid, () => contextoVivo(o.sid as string)).then((m) => m?.resp ?? null)) as { skills?: { skillFrontmatter?: { name?: unknown; tokens?: unknown }[] } } | null;
    for (const s of r?.skills?.skillFrontmatter ?? []) if (typeof s.name === "string" && typeof s.tokens === "number") exactos.set(s.name, s.tokens);
  }
  const todas = catalogoSkills(await inventario(rutasClaude()), leerApagadosTrama(), exactos);
  // El historial se pone al día antes de contestar (la primera vez, con muchos transcripts, tarda): si no está a tiempo, el catálogo sale
  // sin usos (`null`: no se sabe, nunca "no se usó") y la próxima vez ya está.
  const espera = new Promise<null>((ok) => setTimeout(() => ok(null), ESPERA_USOS_MS).unref());
  const usos = historial ? usosDeHistorial(await Promise.race([historial.ultimos(DIAS_USOS, undefined).catch(() => null), espera]), todas) : null;
  return { version: 1, skills: buscarSkills(todas, o.q), total: todas.length, exactos: exactos.size > 0, usos };
}

export type VistaApagados = {
  version: 1;
  apagados: Apagados;
  tipos: readonly string[];
  /** Herramientas que no se dejan apagar. */
  protegidas: readonly string[];
  /** En qué motores se aplica: sólo Claude (workers y líderes); los otros no cargan skills ni memoria de Claude Code. */
  motores: { claude: true; gemini: false; dsh: false; opencode: false; ollama: false; local: false };
};

const vista = (a: Apagados): VistaApagados => ({
  version: 1,
  apagados: a,
  tipos: TIPOS_APAGADO,
  protegidas: HERRAMIENTAS_PROTEGIDAS,
  motores: { claude: true, gemini: false, dsh: false, opencode: false, ollama: false, local: false },
});

export const leerApagadosPanel = (): VistaApagados => vista(leerApagadosTrama());

/**
 * Apaga o prende una cosa para todo Trama. Los workers que se lancen desde ya lo toman (va en su `--settings`); los líderes de Claude se
 * relanzan sin perder la conversación (`aplicarApagadosLideres`): `aviso: "proximo-mensaje"` para que la vista lo diga.
 */
export async function fijarApagadoPanel(tipo: unknown, nombre: unknown, apagado: unknown): Promise<VistaApagados & { lideres: { reiniciados: number; pendientes: number }; aviso: "proximo-mensaje" }> {
  const antes = JSON.stringify(leerApagadosTrama());
  const a = fijarApagadoTrama(tipo, nombre, apagado);
  // Si ya estaba así, no se relanza a nadie.
  const lideres = JSON.stringify(a) === antes ? { reiniciados: 0, pendientes: 0 } : await aplicarApagadosLideres();
  return { ...vista(a), lideres, aviso: "proximo-mensaje" };
}
