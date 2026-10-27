// "Unificar instrucciones": AGENTS.md como única fuente de lo que cualquier modelo tiene que saber del proyecto. Claude lee
// CLAUDE.md, Gemini/agy GEMINI.md y el resto AGENTS.md; tres archivos que se desincronizan y cambiar de modelo hacía perder
// información. Esto pasa el contenido a AGENTS.md y deja CLAUDE.md / GEMINI.md como stub (`@AGENTS.md`).
//   planUnificar    qué cambiaría (sin escribir nada), con el antes y el después de cada archivo para mostrar la vista previa
//   aplicarUnificar guarda antes cada archivo que cambia en <estado de pa>/<slug>/md-backup/<fecha>/ y escribe; sin git commit
// Las reglas son las de `pa <proy> --unificar-md [--aplicar]` (motor/bin/pa, cmd_unificar_md); tests/unificar-md.test.ts corre las
// dos sobre los mismos proyectos y compara los archivos que dejan. Node puro: la carpeta del proyecto y la del estado llegan de afuera.
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readlink, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorT } from "./errores.ts";
import { enBlanco, esStub, limpio, MD_MAX_BYTES, MD_STUB, norm, resolverImports, topeAgents } from "./instrucciones-md.ts";

export const ARCHIVOS_MD = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"] as const;
export type ArchivoMd = (typeof ARCHIVOS_MD)[number];

/** falta · vacio (sólo blancos) · stub (sólo importa AGENTS.md) · real (tiene contenido propio) · otro (enlace a otra cosa, enorme, no es un archivo: no se toca). */
export type TipoMd = "falta" | "vacio" | "stub" | "real" | "otro";

type Leido = { tipo: TipoMd; texto: string; bytes: number; enlace: string | null };

/** Qué hay en un archivo de instrucciones de la carpeta del proyecto. */
async function leer(ruta: string, nombre: ArchivoMd): Promise<Leido> {
  const f = path.join(ruta, nombre);
  const l = await lstat(f).catch(() => null);
  if (!l) return { tipo: "falta", texto: "", bytes: 0, enlace: null };
  if (l.isSymbolicLink()) {
    const enlace = await readlink(f).catch(() => "");
    // Un CLAUDE.md que es un enlace a AGENTS.md ya está unificado (es el truco de siempre).
    const agents = nombre !== "AGENTS.md" ? await realpath(path.join(ruta, "AGENTS.md")).catch(() => null) : null;
    const destino = await realpath(f).catch(() => null);
    return { tipo: agents && destino === agents ? "stub" : "otro", texto: "", bytes: 0, enlace };
  }
  if (!l.isFile() || l.size > MD_MAX_BYTES) return { tipo: "otro", texto: "", bytes: l.size, enlace: null };
  const texto = (await readFile(f, "utf8")).replace(/\r/g, "");
  return { tipo: enBlanco(texto) ? "vacio" : esStub(texto) ? "stub" : "real", texto, bytes: l.size, enlace: null };
}

// --- El estado de los tres archivos (la fila de cada proyecto en Ajustes > Proyectos) -------------------------------

export type FilaMd = { archivo: ArchivoMd; tipo: TipoMd; bytes: number; caracteres: number };
export type EstadoMd = {
  ruta: string;
  archivos: FilaMd[];
  /** Los caracteres de las instrucciones que reciben los modelos que no son Claude (AGENTS.md, o CLAUDE.md si no hay) ya con los imports resueltos. */
  caracteres: number;
  /** El tope de esos modelos (`PA_AGENTS_MAX`, 20 000 por defecto) y si lo pasa (se les corta). */
  tope: number;
  truncado: boolean;
  /** AGENTS.md tiene contenido y ni CLAUDE.md ni GEMINI.md tienen contenido propio: nada que unificar. */
  unificado: boolean;
  /** Hay algo que `unificar` pasaría a AGENTS.md o stubs que faltan. */
  porUnificar: boolean;
  tareaEnCurso?: "acortar" | "fusionar" | null;
};

export async function estadoMd(ruta: string, env: Record<string, string | undefined> = process.env): Promise<EstadoMd> {
  const leidos = await Promise.all(ARCHIVOS_MD.map((n) => leer(ruta, n)));
  const por = Object.fromEntries(ARCHIVOS_MD.map((n, i) => [n, leidos[i]])) as Record<ArchivoMd, Leido>;
  const fuente = por["AGENTS.md"].tipo === "real" ? por["AGENTS.md"] : por["CLAUDE.md"].tipo === "real" ? por["CLAUDE.md"] : null;
  const caracteres = fuente ? [...(await resolverImports(fuente.texto, ruta))].length : 0;
  const tope = topeAgents(env);
  const plan = await planUnificar(ruta);
  return {
    ruta,
    archivos: ARCHIVOS_MD.map((n, i) => ({ archivo: n, tipo: leidos[i].tipo, bytes: leidos[i].bytes, caracteres: [...leidos[i].texto].length })),
    caracteres,
    tope,
    truncado: caracteres > tope,
    unificado: por["AGENTS.md"].tipo === "real" && por["CLAUDE.md"].tipo !== "real" && por["GEMINI.md"].tipo !== "real" && por["CLAUDE.md"].tipo !== "falta",
    porUnificar: !plan.nada,
    tareaEnCurso: null,
  };
}

// --- El plan -----------------------------------------------------------------------------------------------------------

/**
 * Qué se le hace a un archivo. `de` dice de dónde sale el contenido (CLAUDE.md, GEMINI.md o los dos).
 * crea / anexa: AGENTS.md se escribe (nuevo, o con lo de otro archivo al final) · stub: el archivo pasa a importar AGENTS.md ·
 * crea-stub: no existía y se crea el import (Claude Code no lee AGENTS.md solo) · ya-dentro: su contenido ya está en AGENTS.md.
 */
export type AccionMd = { archivo: ArchivoMd; que: "crea" | "anexa" | "stub" | "crea-stub" | "ya-dentro"; de?: "CLAUDE.md" | "GEMINI.md" | "ambos" | "iguales" };

export type PlanMd = {
  ruta: string;
  acciones: AccionMd[];
  /** Lo que tienen hoy (`null`: no existe) y lo que quedaría, sólo de los archivos que cambian. */
  antes: Partial<Record<ArchivoMd, string | null>>;
  despues: Partial<Record<ArchivoMd, string>>;
  /** Archivos que no se tocan y por qué (enlace a otra cosa, enorme). */
  avisos: { archivo: ArchivoMd; motivo: "enlace" | "enorme" | "no-archivo" }[];
  /** Nada que hacer: "unificado" (AGENTS.md ya es la fuente) o "sin-contenido" (no hay de dónde sacar nada). */
  nada: "unificado" | "sin-contenido" | null;
  /** Los caracteres que tendría AGENTS.md y si pasa el tope de los modelos que no son Claude. */
  caracteres: number;
  tope: number;
  truncado: boolean;
  /** Cambia si cambia cualquiera de los tres archivos: aplicar sólo vale sobre el plan que se vio. */
  huella: string;
};

const unaLinea = (s: string) => s.replace(/^\n+|\n+$/g, "");

export async function planUnificar(ruta: string, env: Record<string, string | undefined> = process.env): Promise<PlanMd> {
  const agents = await leer(ruta, "AGENTS.md");
  const claude = await leer(ruta, "CLAUDE.md");
  const gemini = await leer(ruta, "GEMINI.md");
  const huella = createHash("sha256")
    .update(JSON.stringify([agents, claude, gemini].map((x) => [x.tipo, x.texto, x.enlace])))
    .digest("hex")
    .slice(0, 16);
  const tope = topeAgents(env);
  const base: PlanMd = { ruta, acciones: [], antes: {}, despues: {}, avisos: [], nada: null, caracteres: 0, tope, truncado: false, huella };
  const otro: [ArchivoMd, Leido][] = [["AGENTS.md", agents], ["CLAUDE.md", claude], ["GEMINI.md", gemini]];
  for (const [n, x] of otro) if (x.tipo === "otro") base.avisos.push({ archivo: n, motivo: x.bytes > MD_MAX_BYTES ? "enorme" : x.enlace ? "enlace" : "no-archivo" });
  // Un AGENTS.md que no se puede tocar frena todo: no se le pasa nada a un archivo que no se puede escribir.
  if (agents.tipo === "otro") return { ...base, nada: "sin-contenido" };

  const aExiste = agents.tipo === "real";
  const fuentes = ([["CLAUDE.md", claude], ["GEMINI.md", gemini]] as [ArchivoMd, Leido][]).filter(([, x]) => x.tipo === "real");
  const textos = new Map(fuentes.map(([n, x]) => [n, limpio(x.texto)]));
  let nuevo = "";
  const acciones: AccionMd[] = [];

  if (!aExiste) {
    if (fuentes.length === 0) return { ...base, nada: "sin-contenido" };
    if (fuentes.length === 1) {
      const n = fuentes[0][0] as "CLAUDE.md" | "GEMINI.md";
      nuevo = textos.get(n) as string;
      acciones.push({ archivo: "AGENTS.md", que: "crea", de: n });
    } else if (norm(claude.texto) === norm(gemini.texto)) {
      nuevo = textos.get("CLAUDE.md") as string;
      acciones.push({ archivo: "AGENTS.md", que: "crea", de: "iguales" });
    } else {
      nuevo = `# AGENTS.md\n\n<!-- Unificado desde CLAUDE.md y GEMINI.md, que decían cosas distintas: revisá y juntá lo repetido. -->\n\n## Desde CLAUDE.md\n\n${textos.get("CLAUDE.md")}\n\n## Desde GEMINI.md\n\n${textos.get("GEMINI.md")}`;
      acciones.push({ archivo: "AGENTS.md", que: "crea", de: "ambos" });
    }
  } else {
    nuevo = limpio(agents.texto);
    const base0 = nuevo;
    for (const [n, x] of fuentes) {
      const t = textos.get(n) as string;
      if (norm(x.texto) === norm(agents.texto) || base0.includes(t.replace(/^\s+/, ""))) acciones.push({ archivo: n, que: "ya-dentro" });
      else {
        nuevo += `\n\n## Desde ${n} (unificado acá; revisalo y juntá lo repetido)\n\n${t}`;
        acciones.push({ archivo: "AGENTS.md", que: "anexa", de: n as "CLAUDE.md" | "GEMINI.md" });
      }
    }
  }

  for (const [n, x] of [["CLAUDE.md", claude], ["GEMINI.md", gemini]] as [ArchivoMd, Leido][]) {
    if (x.tipo === "real" || x.tipo === "vacio") acciones.push({ archivo: n, que: "stub" });
    else if (x.tipo === "falta" && n === "CLAUDE.md") acciones.push({ archivo: n, que: "crea-stub" });
  }

  const escribe = acciones.some((a) => a.que !== "ya-dentro");
  const caracteres = [...unaLinea(nuevo)].length;
  if (!escribe) return { ...base, nada: "unificado", caracteres, truncado: caracteres > tope };

  const antes: PlanMd["antes"] = {};
  const despues: PlanMd["despues"] = {};
  if (!aExiste || nuevo !== limpio(agents.texto)) {
    antes["AGENTS.md"] = agents.tipo === "falta" ? null : agents.texto;
    despues["AGENTS.md"] = `${nuevo}\n`;
  }
  for (const a of acciones) {
    if (a.que === "stub" || a.que === "crea-stub") {
      antes[a.archivo] = a.que === "crea-stub" ? null : (a.archivo === "CLAUDE.md" ? claude : gemini).texto;
      despues[a.archivo] = `${MD_STUB}\n`;
    }
  }
  return { ...base, acciones, antes, despues, caracteres, truncado: caracteres > tope };
}

// --- Aplicar -------------------------------------------------------------------------------------------------------------

const dosDig = (n: number) => String(n).padStart(2, "0");
/** AAAAMMDD-HHMMSS, como `date +%Y%m%d-%H%M%S` de `pa`. */
export const marcaDeTiempo = (d = new Date()) =>
  `${d.getFullYear()}${dosDig(d.getMonth() + 1)}${dosDig(d.getDate())}-${dosDig(d.getHours())}${dosDig(d.getMinutes())}${dosDig(d.getSeconds())}`;

async function escribirMd(ruta: string, nombre: ArchivoMd, texto: string): Promise<void> {
  const f = path.join(ruta, nombre);
  const modo = await stat(f).then((s) => s.mode & 0o777, () => 0o644);
  const tmp = path.join(ruta, `.${nombre}.trama-${process.pid}.tmp`);
  try {
    await writeFile(tmp, texto, { mode: modo });
    await rename(tmp, f);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export type Aplicado = { backup: string | null; escritos: ArchivoMd[]; plan: PlanMd };

/**
 * Hace lo que dice el plan. `huella` es la del plan que la persona vio y confirmó: si los archivos cambiaron desde entonces
 * no se escribe nada (que vea el plan nuevo). `estadoProyecto` es la carpeta del estado de `pa` de ese proyecto (<estado>/<slug>):
 * ahí va el backup de todo lo que existía de los tres archivos, antes de escribir. No hace git commit.
 */
export async function aplicarUnificar(ruta: string, estadoProyecto: string, huella: unknown, ahora = new Date()): Promise<Aplicado> {
  const plan = await planUnificar(ruta);
  if (typeof huella !== "string" || huella !== plan.huella) throw errorT("main.mdCambio");
  if (plan.nada) return { backup: null, escritos: [], plan };
  const backup = path.join(estadoProyecto, "md-backup", marcaDeTiempo(ahora));
  await mkdir(backup, { recursive: true });
  for (const n of ARCHIVOS_MD) {
    const f = path.join(ruta, n);
    const l = await lstat(f).catch(() => null);
    if (l?.isFile()) await copyFile(f, path.join(backup, n));
    else if (l?.isSymbolicLink()) await writeFile(path.join(backup, `${n}.enlace`), `${n} -> ${await readlink(f)}\n`);
  }
  const escritos: ArchivoMd[] = [];
  // AGENTS.md primero: si algo falla después, el contenido ya está a salvo en su lugar y el stub viejo sigue siendo el original.
  for (const n of ARCHIVOS_MD) {
    const t = plan.despues[n];
    if (t === undefined) continue;
    await escribirMd(ruta, n, t);
    escritos.push(n);
  }
  return { backup, escritos, plan };
}

// --- Editar AGENTS.md a mano (el panel de Ajustes > Proyectos) --------------------------------------------------------------

/** Lo más largo que se acepta guardar a mano. */
export const AGENTS_EDITAR_MAX = 400_000;

export async function leerAgents(ruta: string): Promise<string> {
  const l = await lstat(path.join(ruta, "AGENTS.md")).catch(() => null);
  if (!l) return "";
  if (!l.isFile() || l.size > MD_MAX_BYTES) throw errorT("main.mdNoArchivo", { v: "AGENTS.md" });
  return readFile(path.join(ruta, "AGENTS.md"), "utf8");
}

/** Guarda AGENTS.md (CRLF → LF, un solo salto final); si ya existía deja antes su copia en el backup. Devuelve los caracteres que quedaron. */
export async function guardarAgents(ruta: string, estadoProyecto: string, texto: unknown, ahora = new Date()): Promise<{ caracteres: number; tope: number; truncado: boolean }> {
  if (typeof texto !== "string" || texto.length > AGENTS_EDITAR_MAX) throw errorT("main.mdTexto");
  const l = await lstat(path.join(ruta, "AGENTS.md")).catch(() => null);
  if (l && (!l.isFile() || l.size > MD_MAX_BYTES)) throw errorT("main.mdNoArchivo", { v: "AGENTS.md" });
  const limpioT = `${limpio(texto)}\n`;
  if (l) {
    const actual = await readFile(path.join(ruta, "AGENTS.md"), "utf8");
    if (actual === limpioT) return medir(limpioT, ruta);
    const dir = path.join(estadoProyecto, "md-backup", marcaDeTiempo(ahora));
    await mkdir(dir, { recursive: true });
    await copyFile(path.join(ruta, "AGENTS.md"), path.join(dir, "AGENTS.md"));
  }
  await escribirMd(ruta, "AGENTS.md", limpioT);
  return medir(limpioT, ruta);
}

async function medir(texto: string, ruta: string) {
  const caracteres = [...(await resolverImports(texto, ruta))].length;
  const tope = topeAgents();
  return { caracteres, tope, truncado: caracteres > tope };
}
