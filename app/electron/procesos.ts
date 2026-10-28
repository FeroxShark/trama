// Lo de procesos que cambia con la plataforma: matar el ÁRBOL de lo que lanzó un líder / agy / un chequeo, y el shell que
// corre un `-c`. Node puro (sin `electron`); en Linux es exactamente lo de siempre (el grupo de procesos con `kill(-pid)`,
// `bash -c` y `/bin/sh -c`). Windows no tiene grupos de procesos como POSIX: el árbol se mata con `taskkill /T /F` y el
// shell es `cmd.exe` (la versión nativa de Windows no lleva bash en ninguna forma). Lo prueba tests/procesos.test.ts con la plataforma inyectada.
import { execFile } from "node:child_process";
import { esWindows, type Plataforma, plataformaActual } from "./rutas.ts";

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

/**
 * Corta lo que corre `pid` cuando el interrupt amable no contestó (Parar). Linux: `SIGINT` al proceso (como siempre). Windows no tiene SIGINT para
 * un hijo (`kill("SIGINT")` lo termina sin avisarle y deja a sus hijos): se mata el árbol con `taskkill /T /F`.
 */
export function interrumpir(hijo: { pid?: number; kill: (senal: NodeJS.Signals) => boolean }, o: OpcionesArbol = {}): void {
  if (esWindows(o.plat ?? plataformaActual())) return matarArbol(hijo.pid, "SIGTERM", o);
  hijo.kill("SIGINT");
}

/** Cómo se lanza el shell que corre un comando escrito como texto (el `npm test` de un chequeo, el hook de un `settings.json`). */
export type ShellLanzar = { file: string; args: string[]; verbatim: boolean };

/**
 * El shell para un comando como texto. Linux: `bash -c` / `/bin/sh -c`, lo de siempre. Windows: `cmd.exe /d /s /c "<comando>"` (verbatim: las
 * comillas del comando llegan tal cual); nunca bash, ni el de Git for Windows ni el `System32\bash.exe` que es WSL. Lo prueba tests/rutas.test.ts.
 */
export function shellDe(cual: "bash" | "sh", comando: string, env: Env = process.env, plat: Plataforma = plataformaActual()): ShellLanzar {
  if (!esWindows(plat)) return { file: cual === "sh" ? "/bin/sh" : "bash", args: ["-c", comando], verbatim: false };
  return { file: env.ComSpec || env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", `"${comando}"`], verbatim: true };
}
