// Rescate de sucios huérfanos: lo que quedó sin commitear en un puesto sólo se commitea en la rama donde estaba si todavía es de esa
// rama. Si su dueño ya fue superado (otra corrida commiteó después en esa rama: lo sucio es más viejo que la punta) o no se sabe de
// quién es (el puesto estaba en una rama que no es de pa), commitearlo metería archivos viejos encima del trabajo bueno (pasó el
// 2026-11-10: «pa: huérfano de …» deshizo parte de un arreglo). En ese caso se guarda como parche en
// `<estado>/<proy>/rescates/<fecha>-<rama>.patch`, el puesto queda limpio y se avisa por stderr.
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Un `git -C <puesto> …` ya atado al puesto y al entorno. */
export type GitDe = (args: string[]) => Promise<{ codigo: number; salida: string }>;

/** `abc/def` → `abc-def`, para usarlo en un nombre de archivo. */
const aNombre = (rama: string) => rama.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "sin-rama";

/** La hora local `AAAAMMDD-HHMMSS`. */
const marca = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** La ruta del archivo de una línea de `status --porcelain` (la nueva, si es un renombre). */
const rutaDeLinea = (l: string) => {
  const r = l.slice(3);
  const i = r.indexOf(" -> ");
  return (i >= 0 ? r.slice(i + 4) : r).replace(/^"|"$/g, "").replace(/\/$/, "");
};

/**
 * ¿Lo sucio es de otra época que la punta de la rama? Sí si todo archivo que todavía existe se tocó antes del último commit de
 * `HEAD` (con al menos uno que exista: si sólo hay borrados no hay con qué comparar y se conserva el comportamiento de siempre).
 */
export async function sucioSuperado(git: GitDe, wt: string, sucios: string[]): Promise<boolean> {
  const r = await git(["log", "-1", "--format=%ct", "HEAD"]);
  const punta = Number(r.salida.trim());
  if (r.codigo !== 0 || !punta) return false;
  let vistos = 0;
  for (const l of sucios) {
    let m: number;
    try {
      m = statSync(path.join(wt, rutaDeLinea(l))).mtimeMs;
    } catch {
      continue; // borrado
    }
    vistos++;
    if (Math.floor(m / 1000) >= punta) return false;
  }
  return vistos > 0;
}

/** ¿La rama es de pa (`pa/<slug>/…`)? Un puesto parado en `main` o en una rama ajena no tiene dueño conocido. */
export const esRamaDePa = (rama: string, slug: string) => rama.startsWith(`pa/${slug}/`);

/**
 * Si lo sucio no es de la rama actual, lo guarda como parche (incluye los archivos nuevos y los binarios), deja el puesto limpio
 * (sin tocar `excluidos`: los dirs de build) y avisa. Devuelve la ruta del parche, o null si hay que commitearlo como siempre.
 */
export async function rescatarSiAjeno(o: {
  git: GitDe;
  wt: string;
  rama: string;
  slug: string;
  /** `<estado>/<proy>`. */
  dir: string;
  sucios: string[];
  excluidos: string[];
  err: (s: string) => void;
}): Promise<string | null> {
  const ajena = !esRamaDePa(o.rama, o.slug);
  if (!ajena && !(await sucioSuperado(o.git, o.wt, o.sucios))) return null;
  const fuera = o.excluidos.map((r) => `:(exclude,literal)${r}`);
  await o.git(["add", "-N", "--", ".", ...fuera]); // los archivos nuevos entran en el diff
  const d = await o.git(["diff", "--binary", "HEAD", "--", ".", ...fuera]);
  if (d.codigo !== 0) return null;
  const carpeta = path.join(o.dir, "rescates");
  let destino = path.join(carpeta, `${marca()}-${aNombre(o.rama)}.patch`);
  try {
    mkdirSync(carpeta, { recursive: true });
    for (let i = 2; ; i++) {
      try {
        writeFileSync(destino, d.salida.endsWith("\n") ? d.salida : `${d.salida}\n`, { flag: "wx" });
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        destino = path.join(carpeta, `${marca()}-${aNombre(o.rama)}-${i}.patch`);
      }
    }
  } catch {
    await o.git(["reset", "-q"]);
    return null; // no se pudo guardar: mejor el comportamiento de siempre que perder el trabajo
  }
  await o.git(["reset", "-q", "--hard", "HEAD"]);
  await o.git(["clean", "-fdq", "--", ".", ...fuera]);
  o.err(
    ajena
      ? `pa: el worktree ${path.basename(o.wt)} estaba en '${o.rama}' (no es una rama de pa) con cambios sin commitear: no los commiteo, quedaron como parche en ${destino}\n`
      : `pa: el worktree ${path.basename(o.wt)} tenía cambios sin commitear más viejos que la punta de '${o.rama}' (otra corrida commiteó después): no los commiteo, quedaron como parche en ${destino}\n`,
  );
  return destino;
}
