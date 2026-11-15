import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Elige la pantalla Wayland de la sesión, aunque el proceso no la traiga en el entorno.
 *
 * Con `ozone-platform-hint=auto`, Chromium cae en X11 si falta `WAYLAND_DISPLAY` y hay `DISPLAY`: la ventana corre por
 * XWayland y se ve borrosa con escala fraccionaria (2026-11-15, laptop: la app la relanzó un proceso sin WAYLAND_DISPLAY).
 * Por eso: si el entorno no trae `WAYLAND_DISPLAY` y existe un socket `$XDG_RUNTIME_DIR/wayland-N`, se lo usa y se fuerza
 * `ozone-platform=wayland`. Sin socket ni sesión Wayland (X11, Xvfb de las pruebas) no se toca nada.
 *
 * Pura: `listar` y `esSocket` son inyectables para probarla sin una sesión gráfica real.
 */
export function resolverWayland(
  env: NodeJS.ProcessEnv = process.env,
  uid: number = process.getuid?.() ?? 1000,
  listar: (dir: string) => string[] = (dir) => {
    try {
      return readdirSync(dir).sort();
    } catch {
      return [];
    }
  },
  esSocket: (ruta: string) => boolean = (ruta) => {
    try {
      return statSync(ruta).isSocket();
    } catch {
      return false;
    }
  },
): { waylandDisplay?: string; forzarWayland: boolean } {
  const run = env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  // Ya viene con una pantalla que existe: se respeta.
  if (env.WAYLAND_DISPLAY && !env.WAYLAND_DISPLAY.startsWith("/") && esSocket(path.join(run, env.WAYLAND_DISPLAY))) {
    return { waylandDisplay: env.WAYLAND_DISPLAY, forzarWayland: true };
  }
  const socket = listar(run).find((f) => /^wayland-\d+$/.test(f) && esSocket(path.join(run, f)));
  if (socket) return { waylandDisplay: socket, forzarWayland: true };
  // Sesión Wayland sin socket visible (raro): no hay pantalla que nombrar; se deja a `auto`.
  return { forzarWayland: false };
}

/** Aplica `resolverWayland` al proceso: exporta `WAYLAND_DISPLAY` si hacía falta y devuelve si hay que forzar `ozone-platform=wayland`. */
export function aplicarWayland(env: NodeJS.ProcessEnv = process.env): boolean {
  const r = resolverWayland(env);
  if (r.waylandDisplay && env.WAYLAND_DISPLAY !== r.waylandDisplay) env.WAYLAND_DISPLAY = r.waylandDisplay;
  return r.forzarWayland;
}
