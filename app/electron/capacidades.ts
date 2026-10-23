// Detectar en vez de configurar: qué herramientas de esta máquina existen (Tailscale, Hyprland, kitty), para no
// ofrecer lo que no hay (el acceso por la tailnet, "Ir a la ventana"). Sin `electron` ni imports locales salvo
// binario.ts: lo prueba tests/modo-local.test.ts.
import { accessSync, constants } from "node:fs";
import os from "node:os";
import { resolverBinario } from "./binario.ts";

type Env = Record<string, string | undefined>;

export type Capacidades = {
  /** Hay `tailscale`: tiene sentido el acceso desde el celular por la tailnet. */
  tailscale: boolean;
  /** Hay `hyprctl`: se puede ubicar la ventana de un líder de terminal en Hyprland. */
  hyprctl: boolean;
  /** Hay `kitten` (kitty): lo mismo, en kitty. */
  kitten: boolean;
};

const ejecutable = (f: string) => {
  try {
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Qué herramientas hay en esta máquina: la variable de entorno que la nombra (`HILOS_TAILSCALE`…), el PATH o
 * `~/.local/bin`. Se mira cada vez que se pregunta (unos `access`): instalar una después la activa sin reiniciar.
 */
export function capacidades(env: Env = process.env, home = os.homedir(), existe: (f: string) => boolean = ejecutable): Capacidades {
  const hay = (nombre: string, variable: string) => !!env[variable] || resolverBinario(nombre, variable, env, home, existe) !== nombre;
  return { tailscale: hay("tailscale", "HILOS_TAILSCALE"), hyprctl: hay("hyprctl", "HILOS_HYPRCTL"), kitten: hay("kitten", "HILOS_KITTEN") };
}

/**
 * ¿Está instalado `agy` (Antigravity CLI)? Si `HILOS_AGY` está definido, vale si apunta a un ejecutable (las pruebas
 * ponen un camino inexistente para apagarlo, o `scripts/agy-falso.mjs` para prenderlo). En una captura sin `HILOS_AGY`
 * no se prende solo para no alterar las referencias visuales.
 */
export function hayAgy(env: Env = process.env, home = os.homedir(), existe: (f: string) => boolean = ejecutable): boolean {
  if (env.HILOS_AGY !== undefined) return !!env.HILOS_AGY && existe(env.HILOS_AGY);
  if (env.HILOS_CAPTURA) return false;
  return resolverBinario("agy", "HILOS_AGY", env, home, existe) !== "agy";
}
