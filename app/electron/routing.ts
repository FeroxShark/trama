// La tabla de routing de `~/CLAUDE.md`: con qué modelo y esfuerzo lanzan los
// líderes a sus workers. Va entre `<!-- trama:routing … -->` y
// `<!-- /trama:routing -->`; Ajustes la muestra y edita SÓLO las tres filas de
// worker (código, exploración, diseño). Todo lo demás del archivo queda byte a
// byte igual; si los marcadores o las filas no tienen la forma esperada, no se
// escribe nada. Sin ningún marcador (la plantilla de una instalación nueva) no es
// un error: se lee como "lo decide el líder" y el bloque se crea al guardar algo. Node puro y sin imports locales: los tests lo usan directo con
// un CLAUDE.md de ejemplo (`HILOS_CLAUDE_MD` cambia la ruta).
import { chmod, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { errorT, textoT } from "./errores.ts";

export const RUTA_CLAUDE_MD = process.env.HILOS_CLAUDE_MD ?? path.join(os.homedir(), "CLAUDE.md");

const INICIO = "<!-- trama:routing";
const FIN = "<!-- /trama:routing -->";

export type Rol = "codigo" | "explorar" | "diseno";
export const ROLES: Rol[] = ["codigo", "explorar", "diseno"];
/** Cómo empieza la primera celda de cada fila de worker. */
const CELDA_ROL: Record<Rol, string> = {
  codigo: "Worker que escribe código",
  explorar: "Worker exploración",
  diseno: "Frontend / diseño visual",
};

/** Lo que se escribe en la columna Modelo cuando no hay default. */
export const LO_DECIDE = "lo decide el líder";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** Un id de modelo: sin espacios ni "|" (iría dentro de una celda de la tabla). */
const MODELO = /^[A-Za-z0-9][\w.:[\]-]*$/;

/** Una fila de worker. `modelo === null`: lo decide el líder (y `effort` también es `null`). */
export type Fila = {
  rol: Rol;
  modelo: string | null;
  /** La primera palabra de la celda ("medium acotado, high si…" → "medium"); `null` si no hay. */
  effort: string | null;
  /** La celda tal cual, para mostrar el matiz que no entra en el selector. */
  nota: string;
};

export type Routing = { version: 1; filas: Fila[] } | { version: 1; error: string };

type Ubicada = Fila & { linea: number; celdas: string[] };

const celdas = (linea: string) => {
  const t = linea.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return null;
  return t.slice(1, -1).split("|").map((c) => c.trim());
};

const sinTildes = (s: string) => s.replace(/`/g, "").trim();

/**
 * El texto con el bloque de la tabla agregado al final, todas las filas en "lo decide el líder". Es lo que pasa en una
 * instalación nueva: la plantilla de `~/CLAUDE.md` del instalador no trae la tabla. Sólo si faltan los dos marcadores;
 * con uno solo el archivo está roto y se avisa.
 */
function conBloque(texto: string): string {
  const nl = texto.includes("\r\n") ? "\r\n" : "\n";
  const bloque = [
    "## Routing de workers",
    "",
    `${INICIO} (la app trama edita esta tabla; no cambiar el formato de las filas) -->`,
    "| Rol | Modelo | Effort |",
    "|---|---|---|",
    ...ROLES.map((r) => `| ${CELDA_ROL[r]} | ${LO_DECIDE} | — |`),
    FIN,
  ].join(nl);
  return texto.replace(/\s*$/, "") + (texto.trim() ? nl + nl : "") + bloque + nl;
}

const sinMarcas = (texto: string) => !texto.includes(INICIO) && !texto.includes(FIN);

/** Las líneas del archivo y dónde están las tres filas; tira con el porqué si algo no cierra. */
function ubicar(texto: string): { lineas: string[]; filas: Ubicada[] } {
  const lineas = (sinMarcas(texto) ? conBloque(texto) : texto).split("\n");
  const ini = lineas.flatMap((l, i) => (l.trimStart().startsWith(INICIO) ? [i] : []));
  const fin = lineas.flatMap((l, i) => (l.trim() === FIN ? [i] : []));
  if (ini.length !== 1 || fin.length !== 1)
    throw errorT("main.routingSinMarcas");
  if (fin[0] < ini[0]) throw errorT("main.routingAlReves");

  const filas: Ubicada[] = [];
  for (const rol of ROLES) {
    const donde: number[] = [];
    for (let i = ini[0] + 1; i < fin[0]; i++) if (celdas(lineas[i])?.[0]?.startsWith(CELDA_ROL[rol])) donde.push(i);
    if (donde.length !== 1)
      throw donde.length
        ? errorT("main.routingRepetida", { fila: CELDA_ROL[rol], n: donde.length })
        : errorT("main.routingFalta", { fila: CELDA_ROL[rol] });
    const i = donde[0];
    const c = celdas(lineas[i])!;
    if (c.length !== 3) throw errorT("main.routingColumnas", { fila: CELDA_ROL[rol], n: c.length });
    const m = sinTildes(c[1]);
    let modelo: string | null;
    if (m.toLowerCase() === LO_DECIDE) modelo = null;
    else if (MODELO.test(m)) modelo = m;
    else throw errorT("main.routingModelo", { fila: CELDA_ROL[rol], v: c[1] });
    const palabra = sinTildes(c[2]).split(/[\s,;·]+/)[0]?.toLowerCase() ?? "";
    filas.push({ rol, modelo, effort: EFFORTS.includes(palabra) ? palabra : null, nota: sinTildes(c[2]), linea: i, celdas: c });
  }
  return { lineas, filas };
}

/** Las tres filas de worker del texto de un CLAUDE.md. */
export function parsearRouting(texto: string): Routing {
  try {
    return { version: 1, filas: ubicar(texto).filas.map(({ rol, modelo, effort, nota }) => ({ rol, modelo, effort, nota })) };
  } catch (e) {
    return { version: 1, error: (e as Error).message };
  }
}

export type Cambio = { rol: Rol; modelo: string | null; effort: string | null };

/**
 * El mismo texto con las filas de `cambios` reescritas. Una fila que queda igual
 * (mismo modelo, mismo primer effort) no se toca, matiz incluido; si sólo cambia
 * el modelo, la celda del effort queda como estaba. Tira si algo no cierra.
 */
export function escribirRouting(texto: string, cambios: Cambio[]): string {
  const { lineas, filas } = ubicar(texto);
  const base = lineas.join("\n");
  for (const c of cambios) {
    const f = filas.find((x) => x.rol === c.rol);
    if (!f) throw errorT("main.rolRaro", { v: String(c.rol) });
    if (c.modelo !== null && !MODELO.test(c.modelo)) throw errorT("main.modeloRaro", { v: String(c.modelo) });
    // Gemini y los locales no llevan esfuerzo aparte (es parte del nombre o no existe): su celda dice "—".
    const sinEffort = c.modelo !== null && !c.modelo.startsWith("claude-") && c.effort === null;
    if (c.modelo !== null && !sinEffort && !EFFORTS.includes(c.effort ?? "")) throw errorT("main.effortRaro", { v: String(c.effort) });
    if (c.modelo === f.modelo && (c.modelo === null || c.effort === f.effort)) continue;
    const modelo = c.modelo === null ? LO_DECIDE : `\`${c.modelo}\``;
    const effort = c.modelo === null || sinEffort ? "—" : c.effort === f.effort ? f.celdas[2] : c.effort!;
    const original = lineas[f.linea];
    const cr = original.endsWith("\r") ? "\r" : "";
    const sangria = original.slice(0, original.length - original.trimStart().length);
    lineas[f.linea] = `${sangria}| ${f.celdas[0]} | ${modelo} | ${effort} |${cr}`;
  }
  const nuevo = lineas.join("\n");
  // Un archivo sin tabla al que no se le cambió nada queda como estaba (no le agrega el bloque de balde).
  return nuevo === base ? texto : nuevo;
}

// --- El archivo --------------------------------------------------------------

export async function leerRouting(ruta = RUTA_CLAUDE_MD): Promise<Routing> {
  let texto: string;
  try {
    texto = await readFile(ruta, "utf8");
  } catch (e) {
    return { version: 1, error: textoT("main.noLeo", { ruta, e: (e as Error).message }) };
  }
  return parsearRouting(texto);
}

/**
 * Relee el archivo, aplica los cambios y lo reemplaza de una (tmp + rename en
 * la misma carpeta; si es un symlink, se escribe el archivo al que apunta).
 * Devuelve la tabla como quedó o el error, sin haber escrito nada.
 */
export async function guardarRouting(cambios: Cambio[], ruta = RUTA_CLAUDE_MD): Promise<Routing> {
  try {
    // Sin `~/CLAUDE.md` (instalación nueva) no es un error: se parte de un archivo vacío y se crea con el bloque.
    let real = ruta;
    let antes = "";
    let modo: number | null = null;
    try {
      real = await realpath(ruta);
      antes = await readFile(real, "utf8");
      modo = (await stat(real)).mode & 0o7777;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const despues = escribirRouting(antes, cambios);
    if (despues !== antes) {
      const tmp = `${real}.trama-${process.pid}.tmp`;
      await writeFile(tmp, despues);
      // El tmp nace con el modo del umask: el archivo reemplazado conserva el que tenía (un CLAUDE.md 0600 no se abre).
      if (modo !== null) await chmod(tmp, modo);
      await rename(tmp, real);
    }
    return parsearRouting(despues);
  } catch (e) {
    return { version: 1, error: (e as Error).message };
  }
}
