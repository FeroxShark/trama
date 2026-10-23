// La red de contención del main: lo que antes dejaba la ventana en blanco sin rastro. Los errores sin
// atrapar del proceso se loguean sin tirar la app; el renderer que muere se recarga solo, con tope (si
// muere 3 veces en un minuto se deja el cartel, electron/main.ts); la página que no carga, que se
// cuelga o que escribe un error en su consola queda en el log. Sin imports de `electron`: lo que se
// vigila entra por parámetro (tests/contencion.test.ts lo prueba con emisores de mentira).
import type { Bitacora, crearTope } from "./bitacora.js";

type Emisor = { on(evento: string, fn: (...a: any[]) => void): unknown };

/** `uncaughtException` y `unhandledRejection` del proceso: se loguean y la app sigue. */
export function vigilarProceso(log: Bitacora, proc: Emisor = process) {
  proc.on("uncaughtException", (e: unknown) => log.escribir("error", "main uncaughtException", e));
  proc.on("unhandledRejection", (e: unknown) => log.escribir("error", "main unhandledRejection", e));
}

export function vigilarPagina(
  wc: Emisor,
  o: {
    log: Bitacora;
    tope: ReturnType<typeof crearTope>;
    /** Vuelve a cargar la misma página. */
    recargar(): void;
    /** Deja el cartel en vez de reintentar. */
    cartel(detalle: string): void;
  },
) {
  wc.on("render-process-gone", (_e, d: { reason?: string; exitCode?: number }) => {
    // Cerrar la ventana también termina el proceso, "bien": no es una caída.
    if (d?.reason === "clean-exit") return;
    const detalle = `el renderer murió (${d?.reason ?? "?"}, código ${d?.exitCode ?? "?"})`;
    if (o.tope.muerte()) {
      o.log.escribir("error", "renderer render-process-gone", `${detalle}: se recarga`);
      o.recargar();
    } else {
      o.log.escribir("error", "renderer render-process-gone", `${detalle}: demasiadas muertes seguidas, se deja el cartel`);
      o.cartel(detalle);
    }
  });
  wc.on("did-fail-load", (_e, codigo: number, descripcion: string, url: string, principal: boolean) => {
    // -3: la carga se abortó porque otra la pisó (una recarga). Sólo importa la página principal.
    if (codigo === -3 || principal === false) return;
    o.log.escribir("error", "renderer did-fail-load", `${descripcion} (${codigo}) ${url}`);
  });
  wc.on("unresponsive", () => o.log.escribir("aviso", "renderer", "la ventana no responde"));
  wc.on("responsive", () => o.log.escribir("info", "renderer", "la ventana volvió a responder"));
  // Electron 44 manda un solo objeto; el formato viejo traía (nivel, mensaje, línea, origen).
  wc.on("console-message", (d: { level?: string; message?: string; lineNumber?: number; sourceId?: string }, ...viejo: unknown[]) => {
    const error = d?.level === "error" || viejo[0] === 3;
    if (!error) return;
    const mensaje = d?.message ?? String(viejo[1] ?? "");
    const origen = d?.sourceId ?? String(viejo[3] ?? "");
    const linea = d?.lineNumber ?? viejo[2];
    o.log.escribir("error", "renderer console", origen ? `${mensaje} (${origen}:${linea})` : mensaje);
  });
}
