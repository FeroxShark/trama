// Archivos sin commitear de un repo o worktree y qué parte es de ESTA corrida, más los dirs de build de un worktree de pa.
// Port de sucios_de, ruta_porcelain, edad_sucios, delta_sucios, dirs_de_build y limpiar_build de motor/bin/pa. Los mensajes
// son contrato (salen por stderr y se comparan con los del bash en tests/paridad).
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { borrarSinSeguir } from "../base/enlaces.ts";
import { git } from "../base/git.ts";
import type { Env } from "./entorno.ts";

/** Ruta de una línea porcelain (en un rename, el destino; sin las comillas de las rutas raras). */
export function rutaPorcelain(l: string): string {
  let r = l.slice(3);
  if (r.includes(" -> ")) r = r.slice(r.lastIndexOf(" -> ") + 4);
  return r.replace(/"$/, "").replace(/^"/, "");
}

const NOMBRES_BUILD = new Set(["target", "target-wt", "node_modules", ".venv", "dist", "__pycache__"]);

/** `dirs_de_build`: los dirs de build sueltos (no trackeados) de un worktree de pa, relativos; con `borrar`, sólo los borrables. */
export async function dirsDeBuild(wt: string, state: string, env: Env, borrar = false): Promise<string[]> {
  if (!wt.startsWith(path.join(state, "worktrees") + path.sep) || !existsSync(path.join(wt, ".git"))) return [];
  const hallados: string[] = [];
  // find -maxdepth 4 -name .git -prune -o -type d ( nombres | CACHEDIR.TAG ) -print -prune
  const caminar = (d: string, prof: number) => {
    let hs: string[];
    try {
      hs = readdirSync(d);
    } catch {
      return;
    }
    for (const n of hs) {
      const abs = path.join(d, n);
      if (n === ".git") continue;
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (NOMBRES_BUILD.has(n) || existsSync(path.join(abs, "CACHEDIR.TAG"))) {
        hallados.push(abs);
        continue;
      }
      if (prof < 4) caminar(abs, prof + 1);
    }
  };
  caminar(wt, 1);
  const out: string[] = [];
  for (const d of hallados) {
    const rel = path.relative(wt, d).split(path.sep).join("/");
    if (borrar && !NOMBRES_BUILD.has(path.basename(d)) && !existsSync(path.join(d, ".rustc_info.json"))) continue;
    const r = await git(["-C", wt, "ls-files", "--", rel], { env });
    if (r.salida.trim()) continue;
    out.push(rel);
  }
  return out;
}

/** `limpiar_build`: borra los dirs de build de un worktree de pa sin atravesar enlaces. El que llama tiene el puesto. */
export async function limpiarBuild(wt: string, state: string, env: Env): Promise<void> {
  for (const rel of await dirsDeBuild(wt, state, env, true)) {
    try {
      borrarSinSeguir(path.join(wt, rel));
    } catch {
      /* best effort, como el `|| true` del bash */
    }
  }
}

/** `sucios_de`: las líneas de `git status --porcelain`, sin dirs de build sueltos ni symlinks sueltos que apuntan afuera. */
export async function suciosDe(ruta: string, state: string, env: Env): Promise<string[]> {
  const build = new Set(await dirsDeBuild(ruta, state, env));
  const r = await git(["-C", ruta, "status", "--porcelain"], { env });
  if (r.codigo !== 0) return [];
  const out: string[] = [];
  for (const l of r.salida.split("\n")) {
    if (!l) continue;
    const p = rutaPorcelain(l);
    if (build.size && l.startsWith("??") && build.has(p.replace(/\/$/, ""))) continue;
    if (l.startsWith("??")) {
      const abs = path.join(ruta, p);
      let esLink = false;
      try {
        esLink = lstatSync(abs.replace(/\/$/, "")).isSymbolicLink();
      } catch {
        /* nada */
      }
      if (esLink) {
        let resuelto = "";
        try {
          resuelto = realpathSync(abs);
        } catch {
          resuelto = "";
        }
        if (resuelto && !resuelto.startsWith(ruta + "/")) continue;
      }
    }
    out.push(l);
  }
  return out;
}

const mtime = (f: string): number | null => {
  try {
    return Math.floor(statSync(f).mtimeMs / 1000);
  } catch {
    return null;
  }
};

/** `edad_sucios`: «, el más viejo de hace N día(s)» / «…hace Nh», o "". */
export function edadSucios(ruta: string, lista: string[], ahora = Math.floor(Date.now() / 1000)): string {
  let viejo: number | null = null;
  for (const l of lista) {
    if (!l) continue;
    const m = mtime(path.join(ruta, rutaPorcelain(l)));
    if (m === null) continue;
    if (viejo === null || m < viejo) viejo = m;
  }
  if (viejo === null) return "";
  const dias = Math.floor((ahora - viejo) / 86400);
  return dias >= 1 ? `, el más viejo de hace ${dias} día(s)` : `, el más viejo de hace ${Math.floor((ahora - viejo) / 3600)}h`;
}

/**
 * `delta_sucios`: qué quedó sucio por culpa de esta corrida, como frase para un mensaje (con `\n`). `hay` es el código del bash
 * (true = hay delta del worker).
 */
export async function deltaSucios(ruta: string, base: string[], ini: number | null, state: string, env: Env): Promise<{ msg: string; hay: boolean }> {
  const ahora = await suciosDe(ruta, state, env);
  const total = ahora.length;
  if (total === 0) return { msg: "El repo quedó limpio: no hay trabajo en riesgo.\n", hay: false };
  const enBase = new Set(base.filter(Boolean));
  const nuevos = ahora.filter((l) => !enBase.has(l));
  if (ini !== null && enBase.size) {
    for (const l of ahora) {
      if (nuevos.includes(l)) continue;
      const m = mtime(path.join(ruta, rutaPorcelain(l)));
      if (m !== null && m > ini) nuevos.push(l);
    }
  }
  const n = nuevos.length;
  if (n === 0) {
    return {
      msg: `Archivos sin commitear: ${total} — NINGUNO es de este worker (los ${total} ya estaban al arrancar${edadSucios(ruta, base)}). No hay trabajo suyo en riesgo.\n`,
      hay: false,
    };
  }
  let msg = `Archivos sin commitear: ${total} — ${n} de este worker (${nuevos.map(rutaPorcelain).filter(Boolean).slice(0, 5).join(" ")})`;
  if (total > n) msg += `; los otros ${total - n} ya estaban al arrancar${edadSucios(ruta, base)}`;
  return { msg: msg + ".\n", hay: true };
}
