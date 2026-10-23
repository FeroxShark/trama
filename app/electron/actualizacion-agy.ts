// El aviso de Antigravity CLI (`agy`) nuevo, hermano del de Claude Code (electron/actualizador.ts): la
// instalada sale de `agy --version` y la última del mismo servicio que usa `agy update` (la raíz del
// actualizador dice "Stable Version: x.y.z"; sin ese, el paquete AUR `antigravity-cli`). Sin `agy`
// instalado no se muestra nada ni se consulta nada. Actualizar NO corre `agy update`: /usr/bin/agy es de root
// (paquete AUR antigravity-cli), así que abre una terminal (kitty) con `paru -S antigravity-cli` y ahí se pone
// la contraseña; el aviso se va cuando la versión sube (al cerrar la terminal, o al próximo chequeo).
//   HILOS_AGY             el `agy` que se pregunta (en la prueba, uno falso o uno que no existe).
//   HILOS_AGY_ACTUALIZADOR  la URL del actualizador (en la prueba, un servidor local).
//   HILOS_AGY_AUR         la URL del RPC de AUR.
//   HILOS_TERMINAL        la terminal de Actualizar (en la prueba, un falso; default kitty, ver actualizador.ts).
import path from "node:path";
import { ESTADO } from "./pa.js";
import { crearActualizador, entorno } from "./actualizador.js";
import { ultimaDeActualizador, ultimaDeAur } from "./version.js";

const AGY = process.env.HILOS_AGY ?? "agy";
const ACTUALIZADOR = process.env.HILOS_AGY_ACTUALIZADOR ?? "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app";
const AUR = process.env.HILOS_AGY_AUR ?? "https://aur.archlinux.org/rpc/v5/info?arg[]=antigravity-cli";

type Traer = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;

/** La última de agy: el actualizador primero, AUR si ese no contesta. null si ninguno. */
export async function ultimaAgy(traer: Traer = fetch): Promise<string | null> {
  const pedir = async (url: string) => {
    const r = await traer(url, { signal: AbortSignal.timeout(15_000) });
    return r.ok ? r.text() : null;
  };
  const delActualizador = await pedir(ACTUALIZADOR).then(ultimaDeActualizador, () => null);
  if (delActualizador) return delActualizador;
  return pedir(AUR).then((t) => (t ? ultimaDeAur(JSON.parse(t)) : null)).catch(() => null);
}

const agy = crearActualizador({
  archivo: path.join(ESTADO, "agy-version.json"),
  bin: AGY,
  nombre: "actualizacion-agy",
  ultima: () => ultimaAgy(),
  actualizar: { terminal: ["paru", "-S", "antigravity-cli"] },
  entornoActualizar: entorno,
  olvidarSiFalta: true,
});

export const { leerAviso: leerAvisoAgy, descartar: descartarAgy, alCambiarAviso: alCambiarAvisoAgy, actualizar: actualizarAgy } = agy;
