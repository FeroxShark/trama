// Un worker en cola (tope global o puestos ocupados): `pa --hilos` lo lista `trabajando` con `en_cola`, pero
// sin tarea, sin líder y sin motivo: todavía no tiene `.hilo` ni `.corrida`. Lo que sí hay en su carpeta de
// `pa` son tres archivos chicos: `<id>.cola` (el motivo), `<id>.jefe` (`jefe=` y `jefe_id=`) y `<id>.pid` (el
// `pa` hijo que espera; su línea de comando lleva la tarea detrás de `--`). Es la segunda lectura directa de
// `$PA_STATE` (junto a los `.sid`): de ahí sale sólo eso y sólo para lo que está en cola. Sin imports de
// Electron: lo prueba tests/cola-pa.test.ts con una carpeta y un `/proc` de mentira.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Lo que la app agrega a una fila de `pa --hilos` (no lo manda `pa`). */
export type DeCola = {
  /** Por qué espera ("tope global: 5 workers vivos", "los 3 puestos ocupados"). */
  cola_motivo?: string;
  /** Murió en la cola, sin llegar a arrancar (su `pa` ya no vive y quedó el `.cola`). */
  sin_arrancar?: boolean;
};

type Fila = {
  id?: unknown;
  proyecto?: unknown;
  estado?: unknown;
  en_cola?: unknown;
  tarea?: unknown;
  rama?: unknown;
  jefe?: unknown;
  jefe_id?: unknown;
} & DeCola;

const ID = /^\d{8}-\d{6}-\d+$/;
const SLUG = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
const TOPE_TAREA = 500;
const TOPE_ARCHIVO = 4096;

const leer = (archivo: string) => readFile(archivo, "utf8").then((t) => t.slice(0, TOPE_ARCHIVO), () => null);

/** La tarea de `pa <proyecto> … -- <tarea>`: lo que sigue al primer `--` de la línea de comando. */
export function tareaDeArgv(argv: readonly string[]): string | null {
  // Un pid reusado por otra cosa no es el `pa` de la cola.
  const pa = argv.slice(0, 2).some((a) => path.basename(a) === "pa");
  const i = argv.indexOf("--");
  if (!pa || i < 0) return null;
  const tarea = argv.slice(i + 1).join(" ").replace(/\s+/g, " ").trim();
  return tarea ? tarea.slice(0, TOPE_TAREA) : null;
}

async function tareaDelPid(pid: string, proc: string): Promise<string | null> {
  if (!/^\d+$/.test(pid)) return null;
  const crudo = await readFile(path.join(proc, pid, "cmdline"), "utf8").catch(() => null);
  return crudo === null ? null : tareaDeArgv(crudo.replace(/\0$/, "").split("\0"));
}

const campo = (texto: string, clave: string) => texto.match(new RegExp(`^${clave}=(.*)$`, "m"))?.[1]?.trim() || null;

/**
 * De quién es una corrida recién lanzada: `jefe_id=`/`jefe=` de su `<id>.corrida` (`pa` la escribe antes del evento
 * `inicio`) o, si todavía no está, de su `<id>.jefe` (lo escribe el `pa` que lanza, antes del fork). Es lo que la
 * barra necesita para colgar al worker de su líder ya, sin esperar a `pa --hilos` (~11 s). `null`: no hay dato.
 */
export async function jefeDeCorrida(raiz: string, proyecto: string, id: string): Promise<{ jefe_id: string; jefe: string | null } | null> {
  if (!ID.test(id) || !SLUG.test(proyecto)) return null;
  const base = path.join(raiz, proyecto, id);
  for (const ext of ["corrida", "jefe"]) {
    const t = await leer(`${base}.${ext}`);
    const jid = t ? campo(t, "jefe_id") : null;
    if (jid) return { jefe_id: jid, jefe: campo(t!, "jefe") };
  }
  return null;
}

/** Los eventos `inicio` sin líder, con el que dicen `.corrida`/`.jefe`; el resto, tal cual. */
export async function conLider<E extends { tipo: string; id: string; proyecto: string; jefe_id?: string; jefe?: string | null }>(
  eventos: readonly E[],
  raiz: string,
): Promise<E[]> {
  return Promise.all(
    eventos.map(async (e) => {
      if (e.tipo !== "inicio" || e.jefe_id) return e;
      const j = await jefeDeCorrida(raiz, e.proyecto, e.id);
      return j ? { ...e, ...j } : e;
    }),
  );
}

/**
 * Completa en el lugar las filas que están en cola y las que murieron sin arrancar. Devuelve cuántas tocó.
 * `raiz`: `$PA_STATE`; `proc`: `/proc` (para los tests).
 */
export async function completarCola(hilos: Fila[], raiz: string, proc = "/proc"): Promise<number> {
  let tocadas = 0;
  await Promise.all(
    hilos.map(async (h) => {
      if (typeof h?.id !== "string" || typeof h.proyecto !== "string" || !ID.test(h.id) || !SLUG.test(h.proyecto)) return;
      const base = path.join(raiz, h.proyecto, h.id);
      if (h.en_cola === true) {
        const [cola, jefe, pid] = await Promise.all([leer(`${base}.cola`), leer(`${base}.jefe`), leer(`${base}.pid`)]);
        const motivo = cola?.trim();
        if (motivo && !h.cola_motivo) (h.cola_motivo = motivo), tocadas++;
        const jid = jefe ? campo(jefe, "jefe_id") : null;
        if (jid && !h.jefe_id) {
          h.jefe_id = jid;
          h.jefe = (jefe && campo(jefe, "jefe")) || h.jefe || null;
          tocadas++;
        }
        if (!h.tarea && pid) {
          const tarea = await tareaDelPid(pid.trim(), proc);
          if (tarea) (h.tarea = tarea), tocadas++;
        }
      } else if (h.estado === "murio" && !h.tarea && !h.rama) {
        // El `.cola` se borra cuando consigue puesto: si sigue ahí y el proceso ya no vive, nunca arrancó.
        const cola = await stat(`${base}.cola`).then(() => true, () => false);
        if (cola && !h.sin_arrancar) (h.sin_arrancar = true), tocadas++;
        if (cola) {
          const jefe = await leer(`${base}.jefe`);
          const jid = jefe ? campo(jefe, "jefe_id") : null;
          if (jid && !h.jefe_id) (h.jefe_id = jid), (h.jefe = campo(jefe!, "jefe") ?? h.jefe ?? null);
        }
      }
    }),
  );
  return tocadas;
}
