// `pa --limpiar [--si]` (cmd_limpiar de motor/bin/pa): el build viejo de los worktrees de TODOS los proyectos. Sólo puestos libres (se
// toma su candado, exclusivo y sin esperar, mientras se borra: ningún worker arranca a la mitad) y sólo dirs de build (dirsDeBuild) sin
// ningún archivo tocado en PA_LIMPIAR_DIAS días (default 7; el mtime del dir solo no dice nada). Dry-run por default.
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { borrarSinSeguir } from "../base/enlaces.ts";
import { tomar } from "../base/lock.ts";
import { esCarpeta, listar } from "./corridas.ts";
import { v, type Pa } from "./entorno.ts";
import { dirsDeBuild, raizWorktrees, sufPuesto } from "./worktrees.ts";

const esDirReal = (p: string) => {
  try {
    const st = lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
};

/** `find d -mtime -N -print -quit`: ¿algo adentro de `d` (o él mismo) se tocó hace menos de N días? Sin seguir enlaces. */
function tocadoReciente(d: string, dias: number, ahora = Date.now()): boolean {
  const limite = dias * 86_400_000;
  const reciente = (p: string) => {
    try {
      return ahora - lstatSync(p).mtimeMs < limite;
    } catch {
      return false;
    }
  };
  const caminar = (p: string): boolean => {
    if (reciente(p)) return true;
    if (!esDirReal(p)) return false;
    let ns: string[];
    try {
      ns = readdirSync(p);
    } catch {
      return false;
    }
    return ns.some((n) => caminar(path.join(p, n)));
  };
  return caminar(d);
}

/** `du -sb`: el tamaño aparente de todo lo que cuelga de `d` (cada inodo una vez, enlaces sin seguir; los directorios cuentan). */
function tamanoDe(d: string): number {
  const vistos = new Set<string>();
  const caminar = (p: string): number => {
    let st;
    try {
      st = lstatSync(p);
    } catch {
      return 0;
    }
    const clave = `${st.dev}:${st.ino}`;
    let n = 0;
    if (st.ino && st.nlink > 1) {
      if (vistos.has(clave)) return 0;
      vistos.add(clave);
    }
    n += st.size;
    if (st.isDirectory()) {
      try {
        for (const x of readdirSync(p)) n += caminar(path.join(p, x));
      } catch {
        /* ilegible */
      }
    }
    return n;
  };
  return caminar(d);
}

/** `numfmt --to=iec`: 1500 → 1.5K, 4096 → 4.0K, 10240 → 10K (siempre redondea para arriba). */
export function numfmtIec(n: number): string {
  const u = ["", "K", "M", "G", "T", "P", "E"];
  if (n < 1024) return String(n);
  let x = n;
  let i = 0;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  const r = x < 10 ? Math.ceil(x * 10 - 1e-9) / 10 : Math.ceil(x - 1e-9);
  if (r >= 1024 && i < u.length - 1) return `1.0${u[i + 1]}`;
  return x < 10 ? `${r.toFixed(1)}${u[i]}` : `${r}${u[i]}`;
}

/** Los puestos de worktree de pa: `{ nombre (slug[@k], el del candado), ruta }`, en el orden del glob. */
function puestos(pa: Pa): { nombre: string; ruta: string }[] {
  const raiz = raizWorktrees(pa);
  const r: { nombre: string; ruta: string }[] = [];
  if (pa.plat === "win32" && !pa.env.PA_STATE) {
    // %LOCALAPPDATA%\trama\wt\<slug>\<k>
    for (const s of listar(raiz, (n) => esCarpeta(path.join(raiz, n)))) {
      for (const k of listar(path.join(raiz, s))) r.push({ nombre: `${s}${sufPuesto(k)}`, ruta: path.join(raiz, s, k) });
    }
  } else for (const n of listar(raiz)) r.push({ nombre: n, ruta: path.join(raiz, n) });
  return r.filter((w) => esDirReal(w.ruta));
}

export async function cmdLimpiar(pa: Pa, args: string[]): Promise<number> {
  const { io } = pa;
  const aplicar = args[0] === "--si";
  const dias = Number(v(pa.env, "PA_LIMPIAR_DIAS", "7"));
  const diasTxt = v(pa.env, "PA_LIMPIAR_DIAS", "7");
  mkdirSync(pa.lockdir, { recursive: true });
  let total = 0;
  let hay = false;
  for (const w of puestos(pa)) {
    const lg = await tomar(path.join(pa.lockdir, w.nombre), { plat: pa.plat, env: pa.env });
    if (!lg) {
      io.out(`  ${w.nombre}: puesto en uso, no lo toco\n`);
      continue;
    }
    try {
      const x = { pa, proyecto: "", ruta: "", slug: w.nombre.split("@")[0]!, dir: "", ts: "" };
      for (const rel of await dirsDeBuild(x, w.ruta, true)) {
        const d = path.join(w.ruta, rel);
        if (tocadoReciente(d, dias)) continue;
        const n = tamanoDe(d);
        total += n;
        hay = true;
        io.out(`  ${w.nombre}/${rel}  ${numfmtIec(n)}\n`);
        if (aplicar) borrarSinSeguir(d);
      }
    } finally {
      await lg.liberar();
    }
  }
  const gb = (total / 1073741824).toFixed(2);
  if (!hay) io.out(`pa --limpiar: nada de build con más de ${diasTxt} días en worktrees libres.\n`);
  else if (aplicar) io.out(`pa --limpiar: liberados ${gb} GB.\n`);
  else io.out(`pa --limpiar: se liberarían ${gb} GB (dry-run; con --si se borra).\n`);
  return 0;
}
