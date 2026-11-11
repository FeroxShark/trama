// Huérfanos de los líderes (Linux). El Bash tool de Claude corre cada comando en su propia sesión (setsid): lo que un líder deja
// corriendo desde sus herramientas (un `watch.sh` con su `pactl subscribe`) sale del grupo del líder y `barrerGrupo` no lo ve. Y si
// el motor muere a lo bruto (SIGKILL, crash) o lo reinicia systemd con `KillMode=process`, nadie barre nada: el hijo queda en el cgroup.
// Por eso cada líder sale con una etiqueta en el entorno (`TRAMA_LIDER_ETIQUETA=<pid motor>:<arranque motor>:<azar>`): el entorno se
// hereda aunque el hijo haga setsid, así que se puede encontrar y matar el árbol entero por su etiqueta. Un `pa --async` se lanza con la
// etiqueta vacía (pa/async.ts): sus workers sobreviven a los relanzos del motor, como dice `motor.ts`/`trama-motor.service`.
// Sólo Linux (lee /proc): en Windows no hay nada que barrer y todo es no-op.
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const VARIABLE = "TRAMA_LIDER_ETIQUETA";

/** Etiqueta única de un líder: el motor que lo lanzó, su hora de arranque (`arranqueDe`, o "x" si no se sabe) y un azar. */
export function nuevaEtiqueta(motorPid: number, motorArranque: string | null, azar: string = randomBytes(6).toString("hex")): string {
  return `${motorPid}:${motorArranque ?? "x"}:${azar}`;
}

/** Los `environ` de los procesos del sistema, uno por pid (los que no se pueden leer se saltean). */
function entornos(procDir: string): Array<{ pid: number; vars: string[] }> {
  let dirs: string[];
  try {
    dirs = readdirSync(procDir);
  } catch {
    return [];
  }
  const out: Array<{ pid: number; vars: string[] }> = [];
  for (const d of dirs) {
    if (!/^\d+$/.test(d)) continue;
    const pid = Number(d);
    if (pid <= 1 || pid === process.pid) continue;
    try {
      out.push({ pid, vars: readFileSync(path.join(procDir, d, "environ"), "latin1").split("\0") });
    } catch {
      /* el proceso ya salió o no es nuestro: nada que hacer */
    }
  }
  return out;
}

/** Los pids cuyo entorno lleva exactamente esa etiqueta (una etiqueta vacía no encuentra nada). */
export function conEtiqueta(etiqueta: string, procDir = "/proc"): number[] {
  if (!etiqueta) return [];
  const buscado = `${VARIABLE}=${etiqueta}`;
  return entornos(procDir)
    .filter((e) => e.vars.includes(buscado))
    .map((e) => e.pid);
}

/**
 * Manda TERM a todo proceso con esa etiqueta y, `esperaMs` después, KILL a los que sigan con la misma etiqueta (se vuelve a mirar: un
 * pid reciclado no tiene la etiqueta). Devuelve los pids alcanzados con TERM.
 */
export function barrerEtiqueta(
  etiqueta: string,
  o: { procDir?: string; kill?: (pid: number, senal: NodeJS.Signals) => void; esperaMs?: number } = {},
): number[] {
  const kill = o.kill ?? process.kill;
  const procDir = o.procDir ?? "/proc";
  const pids = conEtiqueta(etiqueta, procDir);
  for (const p of pids) {
    try {
      kill(p, "SIGTERM");
    } catch {
      /* ya salió */
    }
  }
  if (pids.length) {
    setTimeout(() => {
      for (const p of conEtiqueta(etiqueta, procDir)) {
        try {
          kill(p, "SIGKILL");
        } catch {
          /* ya salió */
        }
      }
    }, o.esperaMs ?? 3000).unref();
  }
  return pids;
}

/**
 * Al arrancar el motor: lo que quedó de un motor anterior (su etiqueta lleva el pid y la hora de arranque de ese motor) y que ese motor
 * ya no es. `vivo(pid, arranque)` dice si ese motor sigue (el motor lo mira con `arranqueDe`). Manda TERM; KILL al rato, como arriba.
 */
export function barrerDeMotoresMuertos(
  vivo: (pid: number, arranque: string) => boolean,
  o: { procDir?: string; kill?: (pid: number, senal: NodeJS.Signals) => void; esperaMs?: number } = {},
): number[] {
  const etiquetas = new Set<string>();
  for (const e of entornos(o.procDir ?? "/proc")) {
    const v = e.vars.find((x) => x.startsWith(`${VARIABLE}=`));
    if (v) etiquetas.add(v.slice(VARIABLE.length + 1));
  }
  const muertas = [...etiquetas].filter((et) => {
    const [pid, arranque] = et.split(":");
    const n = Number(pid);
    return Number.isInteger(n) && n > 1 && !vivo(n, arranque ?? "x");
  });
  return muertas.flatMap((et) => barrerEtiqueta(et, o));
}
