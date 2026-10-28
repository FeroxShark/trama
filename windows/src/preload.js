"use strict";
// Corre en el asistente y también en la página de Trama (localhost:8791): sólo sandbox, nada de Node.
const { contextBridge, ipcRenderer } = require("electron");

const invocar = (canal, ...a) => ipcRenderer.invoke(canal, ...a);

// Lo que es de la pantalla de la PC (ventana.js): la página lo pide acá porque el motor lo rechaza por red. Tiene que ser
// igual a las claves de crearCanalesVentana (lo verifica tests/ventana.test.js).
const CANALES_VENTANA = ["app:salir", "app:pararTodo", "carpeta:elegir", "archivo:elegirLogo", "portapapeles:texto", "bandeja:textos", "espera:estado", "espera:notificar", "cuentas:login", "lider:ir", "lider:ubicable", "claude:changelog", "trama:notas", "volver:leer", "volver:guardar", "volver:anotar", "reinicio:marca", "app:recargar", "trama:reiniciarVentana"];
// Lo que la carcasa le avisa a la página (no viene del motor): la notificación de un líder tocada.
const AVISOS_VENTANA = ["espera:abrir"];

contextBridge.exposeInMainWorld("carcasa", {
  ventana: {
    canales: CANALES_VENTANA,
    avisa: AVISOS_VENTANA,
    llamar: (canal, ...a) => (CANALES_VENTANA.includes(canal) ? invocar(canal, ...a) : Promise.reject(new Error(`no es de la ventana: ${canal}`))),
    alRecibir: (canal, cb) => {
      if (!AVISOS_VENTANA.includes(canal)) return () => {};
      const f = (_e, dato) => cb(dato);
      ipcRenderer.on(canal, f);
      return () => ipcRenderer.off(canal, f);
    },
  },
  pasos: () => invocar("asistente:pasos"),
  avanzar: () => invocar("asistente:avanzar"),
  conectar: (proveedor) => invocar("asistente:conectar", proveedor),
  saltarLogin: (proveedor) => invocar("asistente:saltarLogin", proveedor),
  continuarLogin: () => invocar("asistente:continuarLogin"),
  cuentas: () => invocar("cuentas:estado"),
  saltarOllama: () => invocar("asistente:saltarOllama"),
  espejo: () => invocar("asistente:espejo"),
  abrir: (url) => invocar("app:abrir", url),
  version: () => invocar("app:version"),
  actualizacion: () => invocar("actualizar:estado"),
  reiniciarParaActualizar: () => invocar("actualizar:instalar"),
  buscarActualizacion: () => invocar("actualizar:buscar"),
  restosPlan: () => invocar("restos:plan"),
  restosQuitar: (ids) => invocar("restos:quitar", ids),
  restosQuitarDistro: (nombre) => invocar("restos:quitarDistro", nombre),
  // La página lo lee al pintar: el sistema se sabe antes del primer cuadro (la franja no puede aparecer después).
  plataforma: process.platform,
  tituloTema: (t) => invocar("ventana:titulo", t),
  onEvento: (cb) => ipcRenderer.on("asistente:evento", (_e, ev) => cb(ev)),
  onActualizacion: (cb) => ipcRenderer.on("actualizar:cambio", (_e, ev) => cb(ev)),
});
