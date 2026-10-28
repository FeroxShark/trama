// El prompt de un worker que no es Claude (agy, codex, dsh, opencode): esos programas no tienen system prompt por flag ni leen
// CLAUDE.md, así que el contrato, el CLAUDE.md del dueño (sólo a quien puede recibirlo) y el AGENTS.md del proyecto van adelante
// de la tarea. Copia de md_resolver, md_vacio, md_stub_texto, agents_md_candidatos, agents_md_archivo y agents_md_bloque de
// motor/bin/pa, con lo que hace el `$(...)` de bash (le saca los saltos de línea del final).
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Env, Io } from "../entorno.ts";

export const AGENTS_MAX_DEFECTO = 20000;

/** Lo que deja `$(cmd)`: la salida sin los `\n` del final. */
export const sinSaltosFinales = (s: string) => s.replace(/\n+$/, "");
/** `[[:space:]]` (ASCII). */
const ESP = "[ \\t\\n\\v\\f\\r]";

const leer = (f: string) => readFileSync(f, "utf8");
const tamano = (f: string): number | null => {
  try {
    return statSync(f).size;
  } catch {
    return null;
  }
};
const real = (f: string): string | null => {
  try {
    return realpathSync(f);
  } catch {
    return null;
  }
};

/** El texto del archivo con sus `@ruta` (una sola, en su propia línea, fuera de bloques de código) reemplazados por el archivo, si queda dentro de su carpeta y pesa ≤ 1 MiB. */
export function mdResolver(f: string): string {
  const dir = path.dirname(f);
  const raiz = real(dir) ?? path.resolve(dir);
  let texto = "";
  try {
    texto = leer(f);
  } catch {
    texto = ""; // una carpeta o un archivo ilegible: el `while read` no lee nada
  }
  let lineas = texto.split("\n");
  // `read` no devuelve una línea vacía después del último salto.
  if (lineas.length && lineas[lineas.length - 1] === "") lineas = lineas.slice(0, -1);
  const partes: string[] = [];
  let enCodigo = false;
  for (let linea of lineas) {
    linea = linea.replace(/\r$/, "");
    if (new RegExp(`^${ESP}*(\`\`\`|~~~)`).test(linea)) enCodigo = !enCodigo;
    const imp = enCodigo ? null : new RegExp(`^${ESP}*@([^ \\t\\n\\v\\f\\r]+)${ESP}*$`).exec(linea);
    if (imp) {
      const rel = imp[1]!;
      if (!rel.startsWith("/") && !rel.startsWith("~") && !`/${rel}/`.includes("/../")) {
        const dest = real(path.join(dir, rel));
        let esArchivo = false;
        try {
          esArchivo = !!dest && statSync(dest).isFile();
        } catch {
          esArchivo = false;
        }
        if (dest && esArchivo && dest.startsWith(raiz + path.sep) && (tamano(dest) ?? 9999999) <= 1048576) {
          let imp = "";
          try {
            imp = leer(dest);
          } catch {
            imp = "";
          }
          partes.push(sinSaltosFinales(imp.replace(/\r/g, "")));
          continue;
        }
      }
    }
    partes.push(linea);
  }
  return partes.join("\n") + "\n";
}

/** Sólo blancos. */
export const mdVacio = (t: string) => t.replace(/[ \t\n\v\f\r]/g, "") === "";
/** Sin contenido propio: sólo `@AGENTS.md`, comentarios HTML de una línea y blancos. */
export function mdStubTexto(t: string): boolean {
  const resto = t
    .split("\n")
    .filter((l) => !new RegExp(`^${ESP}*(<!--.*-->)?${ESP}*$`).test(l))
    .map((l) => l.replace(new RegExp(`^${ESP}+|${ESP}+$`, "g"), ""));
  return resto.length > 0 && resto.every((l) => l === "@AGENTS.md");
}

/** AGENTS.md de cada carpeta y después CLAUDE.md de cada carpeta (los que existen y no están vacíos). */
export function agentsMdCandidatos(carpetas: string[]): string[] {
  const r: string[] = [];
  for (const c of ["AGENTS.md", "CLAUDE.md"]) {
    for (const d of carpetas) if (d && (tamano(path.join(d, c)) ?? 0) > 0) r.push(path.join(d, c));
  }
  return r;
}

/** El primero que no queda vacío ni es un stub una vez resueltos sus imports, o null. */
export function agentsMdArchivo(carpetas: string[]): string | null {
  for (const f of agentsMdCandidatos(carpetas)) {
    const r = mdResolver(f);
    if (!mdVacio(r) && !mdStubTexto(r)) return f;
  }
  return null;
}

/** El bloque para el prompt (con los dos saltos adelante), o "". Truncado a PA_AGENTS_MAX caracteres, con aviso por stderr. */
export function agentsMdBloque(carpetas: string[], env: Env, io: Pick<Io, "err">): string {
  let max = env.PA_AGENTS_MAX ? env.PA_AGENTS_MAX : String(AGENTS_MAX_DEFECTO);
  if (!/^[0-9]+$/.test(max) || Number(max) <= 0) max = String(AGENTS_MAX_DEFECTO);
  const tope = Number(max);
  const f = agentsMdArchivo(carpetas);
  if (!f) return "";
  let t = sinSaltosFinales(mdResolver(f));
  const cps = Array.from(t);
  const n = cps.length;
  let cab = `${f}; valen igual que las de arriba`;
  if (n > tope) {
    t = `${cps.slice(0, tope).join("")}\n[… truncado: ${f} tiene ${n} caracteres y acá van sólo los primeros ${tope} (tope PA_AGENTS_MAX); leé el resto con Read si lo necesitás]`;
    cab = `${f}; OJO: truncado a los primeros ${tope} de ${n} caracteres`;
    io.err(`pa: aviso: ${f} tiene ${n} caracteres y los modelos que no son Claude reciben sólo los primeros ${tope} (PA_AGENTS_MAX). Acortalo o subí el tope.\n`);
  }
  return sinSaltosFinales(`\n\nINSTRUCCIONES (${cab}):\n${t}`);
}

/** El CLAUDE.md del dueño (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/CLAUDE.md`). */
export const claudeMdDueno = (env: Env, home: string) => path.join(env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "CLAUDE.md");

/**
 * El prompt entero de un worker de otro motor: el contrato como «system prompt», los CLAUDE.md que le tocan (`mds`: el del
 * dueño, o ninguno si la tarea sale a otra empresa que no debe verlo), el AGENTS.md del proyecto y la tarea.
 */
export function promptOtroMotor(o: { contrato: string; mds: string[]; carpetas: string[]; tarea: string; env: Env; io: Pick<Io, "err"> }): string {
  let p = `INSTRUCCIONES DEL ORQUESTADOR (valen como system prompt):\n${o.contrato}`;
  for (const md of o.mds) {
    if ((tamano(md) ?? 0) <= 0) continue;
    let txt: string;
    try {
      txt = leer(md);
    } catch {
      continue;
    }
    p += `\n\nINSTRUCCIONES (${md}; valen igual que las de arriba):\n${sinSaltosFinales(txt)}`;
  }
  p += agentsMdBloque(o.carpetas, o.env, o.io);
  p += `\n\nTAREA:\n${o.tarea}`;
  return p;
}
