// El adaptador de la ventana todo en uno: los canales del núcleo (electron/nucleo.ts, sin Electron) van al
// IPC de Electron (por el preload, `window.hilos`), la ventana escucha lo que el núcleo difunde, y los de
// la pantalla de la PC (salir, volver, ir a la ventana, changelog, íconos) salen de ventana-canales.ts.
// En modo cliente del motor esto no se carga: lo reemplaza ventana-cliente.ts.
import { app, ipcMain } from "electron";
import * as nucleo from "./nucleo.js";
import { cerrarDelTodo } from "./cierre.js";
import { armarCanalesVentana, iconosVentana, ocultar, ventanas } from "./ventana-canales.js";

export { pedirVista, ponerAnotadorDeVista, ponerRecarga, ponerVistas } from "./ventana-canales.js";

/** `irse`: se va el proceso (main.ts: bajo la unidad, con el código que no la levanta de nuevo). */
export function armarIpc(irse: () => void) {
  // La ventana es un oyente más de lo que el núcleo difunde (el primero: el celular se suma después).
  nucleo.escuchar((canal, dato) => {
    for (const v of ventanas()) v.webContents.send(canal, dato);
  });
  // Para los trabajos de fondo del núcleo: la ventana cuenta como cliente mientras se vea.
  nucleo.contarClientes(() => ventanas().filter((v) => v.isVisible()).length);
  nucleo.armarNucleo();
  // Los logos achicados con `nativeImage`: también para el celular.
  nucleo.manejar("proyectos:iconos", () => iconosVentana());
  for (const [canal, fn] of nucleo.manejadoresAnotados()) ipcMain.handle(canal, fn);

  // Sólo de la ventana: no pasan por el núcleo, así que por red no existen.
  armarCanalesVentana((x) =>
    cerrarDelTodo(x, {
      hacer: (modo, forzar) => (modo === "parar" ? nucleo.pararTodo(forzar, ocultar) : nucleo.salir(forzar, ocultar)),
      irse,
    }),
  );

  // Salir sin Ctrl+Q (la sesión que se cierra): los ganchos del núcleo (guardar, cortar chequeos) y, si hay
  // líderes vivos, se frena el quit hasta cerrarlos (con su tope; ver `esperarSalida`).
  app.on("before-quit", (e) => {
    nucleo.correrSalida();
    const espera = nucleo.esperarSalida(ocultar);
    if (!espera) return;
    e.preventDefault();
    // Red de última instancia: si algo más se cuelga al cerrar, a los 3 s del tope se sale igual.
    setTimeout(() => app.exit(0), nucleo.TOPE_SALIDA_MS + 3000).unref();
    void espera.then(
      () => app.quit(),
      () => app.quit(),
    );
  });
}
