// Las instrucciones de un proyecto para los modelos: AGENTS.md es la fuente única; CLAUDE.md y GEMINI.md pueden ser un stub
// que lo importa con `@AGENTS.md` (Claude Code y Gemini CLI siguen imports). Acá, lo puro y chico que comparten
// `unificar-md.ts` (el plan de unificar) y `contexto-local.ts` (el prefacio de un líder que no es Claude), y que `pa`
// (motor/bin/pa: md_resolver, md_es_stub, md_limpio) hace igual en bash: tests/unificar-md.test.ts los cruza.
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** Cuántos caracteres de AGENTS.md reciben los modelos que no son Claude (`PA_AGENTS_MAX` en `pa`). */
export const AGENTS_MAX_DEFECTO = 20000;

/** Un archivo que se importa o se unifica no pasa de acá (un `@/var/log/…` suelto no puede colar medio disco). */
export const MD_MAX_BYTES = 1024 * 1024;

/** El stub con que quedan CLAUDE.md y GEMINI.md: un comentario (Claude Code lo oculta del contexto) y el import. */
export const MD_STUB = "<!-- Editá AGENTS.md, no este archivo: acá sólo se importa para que cada modelo (Claude, Gemini, …) lea las mismas instrucciones. -->\n@AGENTS.md";

/** El tope en vigor: `PA_AGENTS_MAX` si es un entero positivo, si no el de siempre. */
export function topeAgents(env: Record<string, string | undefined> = process.env): number {
  const v = env.PA_AGENTS_MAX;
  return v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : AGENTS_MAX_DEFECTO;
}

/** Sin `\r` ni blancos al final de todo: el texto con que se compara y se escribe. */
export const limpio = (t: string): string => t.replace(/\r/g, "").replace(/\s+$/, "");
/** Lo mismo sin blancos al principio: dos archivos "dicen lo mismo" si esto es igual. */
export const norm = (t: string): string => limpio(t).replace(/^\s+/, "");
export const enBlanco = (t: string): boolean => t.trim() === "";

/**
 * ¿No tiene contenido propio? Sólo `@AGENTS.md` (una o más veces), comentarios HTML de una línea y líneas en blanco.
 * Un archivo así es un stub: `pa` no lo mira como instrucciones y unificar no lo toca.
 */
export function esStub(texto: string): boolean {
  const resto = texto
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !/^<!--.*-->$/.test(l));
  return resto.length > 0 && resto.every((l) => l === "@AGENTS.md");
}

const FENCE = /^\s*(```|~~~)/;
const IMPORTA = /^\s*@(\S+)\s*$/;

/**
 * El texto con cada línea que es un `@ruta` solo reemplazada por el contenido de ese archivo: un nivel (lo importado no se
 * resuelve de nuevo), ruta relativa a `dir` sin `..`, sin ser absoluta ni `~`, que termine DENTRO de `dir` aunque haya
 * symlinks de por medio, que sea un archivo de hasta 1 MB. Lo que no se puede resolver queda como estaba. Fuera de los
 * bloques de código. Es lo que hace `md_resolver` en `pa`.
 */
export async function resolverImports(texto: string, dir: string): Promise<string> {
  const raiz = await realpath(dir).catch(() => path.resolve(dir));
  const lineas = texto.replace(/\r/g, "").split("\n");
  // `read` de bash descarta el último "" si el texto termina en salto: acá igual.
  if (lineas.length && lineas[lineas.length - 1] === "") lineas.pop();
  const salida: string[] = [];
  let enCodigo = false;
  for (const l of lineas) {
    if (FENCE.test(l)) enCodigo = !enCodigo;
    const m = !enCodigo ? IMPORTA.exec(l) : null;
    if (m) {
      const rel = m[1];
      if (!path.isAbsolute(rel) && !rel.startsWith("~") && !rel.split("/").includes("..")) {
        const dest = await realpath(path.resolve(dir, rel)).catch(() => null);
        if (dest && dest.startsWith(raiz + path.sep)) {
          const st = await stat(dest).catch(() => null);
          if (st?.isFile() && st.size <= MD_MAX_BYTES) {
            const t = await readFile(dest, "utf8").catch(() => null);
            if (t !== null) {
              salida.push(t.replace(/\r/g, "").replace(/\n+$/, ""));
              continue;
            }
          }
        }
      }
    }
    salida.push(l);
  }
  return salida.join("\n").replace(/\n+$/, "");
}

/** El contenido de un archivo de instrucciones con sus imports resueltos, o `null` si no se puede leer. */
export async function leerResuelto(archivo: string): Promise<string | null> {
  const t = await readFile(archivo, "utf8").catch(() => null);
  return t === null ? null : resolverImports(t, path.dirname(archivo));
}

/**
 * El AGENTS.md (o, sin él, CLAUDE.md) de un proyecto como lo reciben los modelos que no leen CLAUDE.md, entre varias
 * carpetas (el worktree y el tree principal): el primer AGENTS.md y después el primer CLAUDE.md cuyo texto, ya con los
 * imports resueltos, no quede vacío. `null` si no hay ninguno.
 */
export async function instruccionesDe(carpetas: string[]): Promise<{ archivo: string; texto: string } | null> {
  for (const nombre of ["AGENTS.md", "CLAUDE.md"]) {
    for (const d of carpetas) {
      const archivo = path.join(d, nombre);
      const texto = await leerResuelto(archivo);
      // Un stub cuyo import no se pudo resolver (falta AGENTS.md) no es una instrucción: se sigue con el que viene.
      if (texto !== null && !enBlanco(texto) && !esStub(texto)) return { archivo, texto };
    }
  }
  return null;
}
