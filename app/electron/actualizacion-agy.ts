// El aviso de Antigravity CLI (`agy`) nuevo, hermano del de Claude Code (electron/actualizador.ts): la
// instalada sale de `agy --version` y la última del mismo servicio que usa `agy update` (la raíz del
// actualizador dice "Stable Version: x.y.z"; sin ese, en Arch el paquete AUR `antigravity-cli`; en Windows sólo
// el actualizador, que no hay AUR). Sin `agy` instalado no se muestra nada ni se consulta nada.
// Actualizar en Windows corre `agy update` (el agy es de la persona, en %USERPROFILE%\.local\bin: sin admin ni
// terminal). En Linux NO corre `agy update`: /usr/bin/agy es de root (paquete AUR antigravity-cli), así que abre una
// terminal con `paru -S antigravity-cli` y ahí se pone la contraseña; el aviso se va cuando la versión sube (al cerrar
// la terminal, o al próximo chequeo).
//   HILOS_AGY             el `agy` que se pregunta (en la prueba, uno falso o uno que no existe).
//   HILOS_AGY_ACTUALIZADOR  la URL del actualizador (en la prueba, un servidor local).
//   HILOS_PACMAN          el `pacman` que dice si es Arch (en la prueba, un ejecutable cualquiera).
//   HILOS_AGY_AUR         la URL del RPC de AUR.
//   HILOS_TERMINAL        la terminal de Actualizar (en la prueba, un falso; ver terminal-lanzar.ts).
import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolverAgy } from "./binario.ts";
import { ESTADO } from "./pa.js";
import { crearActualizador, entorno } from "./actualizador.js";
import { textoT } from "./errores.js";
import { esWindows, plataformaActual, type Plataforma } from "./rutas.ts";
import { ultimaDeActualizador, ultimaDeAur } from "./version.js";

const AGY = process.env.HILOS_AGY ?? (esWindows() ? resolverAgy(process.env, os.homedir()) : "agy");
const ACTUALIZADOR = process.env.HILOS_AGY_ACTUALIZADOR ?? "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app";
const AUR = process.env.HILOS_AGY_AUR ?? "https://aur.archlinux.org/rpc/v5/info?arg[]=antigravity-cli";

type Traer = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;

/**
 * La última de agy que se puede instalar. En Arch se actualiza con `paru -S antigravity-cli`, así que manda AUR: el
 * actualizador de Google anuncia versiones horas o días antes de que el paquete las tenga, y avisar de una que paru
 * todavía no baja terminaba en "No se pudo actualizar" (paru reinstalaba la misma). Sin pacman, el actualizador primero
 * y AUR si ese no contesta. En Windows no hay AUR (es el paquete de Arch): sólo el actualizador. null si ninguno.
 */
export async function ultimaAgy(traer: Traer = fetch, aurPrimero = hayPacman(), plat: Plataforma = plataformaActual()): Promise<string | null> {
  const pedir = async (url: string) => {
    const r = await traer(url, { signal: AbortSignal.timeout(15_000) });
    return r.ok ? r.text() : null;
  };
  const deAur = () => pedir(AUR).then((t) => (t ? ultimaDeAur(JSON.parse(t)) : null)).catch(() => null);
  const deActualizador = () => pedir(ACTUALIZADOR).then(ultimaDeActualizador, () => null);
  if (esWindows(plat)) return deActualizador();
  const [primero, segundo] = aurPrimero ? [deAur, deActualizador] : [deActualizador, deAur];
  return (await primero()) ?? (await segundo());
}

/**
 * Cómo se actualiza agy. Windows: `agy update` (corre sin terminal, sin admin). Linux: paru en una terminal, que pide la
 * contraseña (/usr/bin/agy es de root). Pura: `plat` inyectable para las pruebas.
 */
export function actualizarDe(plat: Plataforma = plataformaActual()): { args: string[] } | { terminal: string[] } {
  return esWindows(plat) ? { args: ["update"] } : { terminal: ["paru", "-S", "antigravity-cli"] };
}

/** Por qué no se puede actualizar agy acá (el texto), o null: en Windows siempre se puede; en Linux hace falta pacman. */
export function noSePuedeDe(plat: Plataforma = plataformaActual()): string | null {
  return esWindows(plat) || hayPacman() ? null : textoT("main.agySinPacman");
}

/** `paru -S` sólo existe en Arch (hay `pacman`; `HILOS_PACMAN` lo reemplaza en las pruebas). */
function hayPacman(env: NodeJS.ProcessEnv = process.env): boolean {
  const ok = (f: string) => {
    try {
      accessSync(f, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (env.HILOS_PACMAN !== undefined) return !!env.HILOS_PACMAN && ok(env.HILOS_PACMAN);
  return (env.PATH ?? "").split(":").some((d) => d && ok(path.join(d, "pacman")));
}

const agy = crearActualizador({
  archivo: path.join(ESTADO, "agy-version.json"),
  bin: AGY,
  nombre: "actualizacion-agy",
  ultima: () => ultimaAgy(),
  actualizar: actualizarDe(),
  entornoActualizar: entorno,
  noSePuedeActualizar: () => noSePuedeDe(),
  olvidarSiFalta: true,
});

export const { leerAviso: leerAvisoAgy, descartar: descartarAgy, alCambiarAviso: alCambiarAvisoAgy, actualizar: actualizarAgy } = agy;
