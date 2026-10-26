// Lo de procesos que cambia con la plataforma: matar el ÁRBOL de lo que lanzó un líder / agy / un chequeo, y el shell que
// corre un `-c`. Node puro (sin `electron`); en Linux es exactamente lo de siempre (el grupo de procesos con `kill(-pid)`,
// `bash -c` y `/bin/sh -c`). Windows no tiene grupos de procesos como POSIX: el árbol se mata con `taskkill /T /F` y el
// shell es el bash de Git for Windows (el mismo con el que corren los hooks y el Bash tool de Claude Code), nunca el
// `bash.exe` de `System32`, que es el lanzador de WSL. Lo prueba tests/procesos.test.ts con la plataforma inyectada.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { esWindows, homeDe, type Plataforma, plataformaActual } from "./rutas.ts";

type Env = Record<string, string | undefined>;

export type OpcionesArbol = {
  plat?: Plataforma;
  /** `process.kill`, inyectable (los tests lo vigilan). */
  kill?: (pid: number, senal: NodeJS.Signals) => void;
  /** `taskkill`, inyectable. */
  taskkill?: (args: string[]) => void;
};

const taskkillReal = (args: string[]) => {
  execFile("taskkill", args, { windowsHide: true }, () => {
    /* ya no estaba: nada que matar */
  });
};

/**
 * Manda `senal` a todo el árbol que empezó `pid`. Linux: el grupo (`kill(-pid)`; el líder y sus hijos salen `detached`, su propio
 * grupo). Windows: `taskkill /T /F /PID` (no hay TERM: `/F` corta seco, también a los hijos). Nunca tira: un árbol vacío (ESRCH) es nada.
 */
export function matarArbol(pid: number | undefined, senal: NodeJS.Signals = "SIGTERM", o: OpcionesArbol = {}): void {
  if (!pid || pid <= 1) return;
  const plat = o.plat ?? plataformaActual();
  if (esWindows(plat)) {
    (o.taskkill ?? taskkillReal)(["/T", "/F", "/PID", String(pid)]);
    return;
  }
  try {
    (o.kill ?? process.kill)(-pid, senal);
  } catch {
    /* grupo vacío (ESRCH): nada que barrer */
  }
}

/** Dónde busca el bash de Git for Windows (en orden). */
export function bashsDeGit(env: Env, plat: Plataforma = "win32"): string[] {
  if (!esWindows(plat)) return [];
  const w = path.win32;
  const archivos = env.ProgramFiles || "C:\\Program Files";
  const x86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = env.LOCALAPPDATA || w.join(homeDe(env, "win32"), "AppData", "Local");
  const sub = (raiz: string) => [w.join(raiz, "Git", "bin", "bash.exe"), w.join(raiz, "Git", "usr", "bin", "bash.exe")];
  return [env.HILOS_BASH, env.GIT_BASH, ...sub(archivos), ...sub(x86), ...sub(w.join(local, "Programs"))].filter((x): x is string => !!x);
}

/**
 * El shell para un `-c`: `[ejecutable, "-c"]`. `bash` y `sh` son lo que pedía cada llamada de hoy (`bash -c` en salud.ts, `/bin/sh -c`
 * en el hook de contexto-local.ts); en Windows las dos son el bash de Git. Si no hay Git for Windows queda `bash` pelado: el error
 * de spawn dice qué falta.
 */
export function shellDe(cual: "bash" | "sh", env: Env = process.env, plat: Plataforma = plataformaActual(), existe: (f: string) => boolean = existsSync): string[] {
  if (!esWindows(plat)) return [cual === "sh" ? "/bin/sh" : "bash", "-c"];
  return [bashsDeGit(env, plat).find((f) => existe(f)) ?? "bash", "-c"];
}
