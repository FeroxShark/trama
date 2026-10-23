"use strict";
// Corre en el asistente y también en la página de Trama (localhost:8791): sólo sandbox, nada de Node.
const { contextBridge, ipcRenderer } = require("electron");

const invocar = (canal, ...a) => ipcRenderer.invoke(canal, ...a);

contextBridge.exposeInMainWorld("carcasa", {
  pasos: () => invocar("asistente:pasos"),
  avanzar: () => invocar("asistente:avanzar"),
  conectar: (proveedor) => invocar("asistente:conectar", proveedor),
  saltarLogin: (proveedor) => invocar("asistente:saltarLogin", proveedor),
  saltarOllama: () => invocar("asistente:saltarOllama"),
  espejo: () => invocar("asistente:espejo"),
  abrir: (url) => invocar("app:abrir", url),
  version: () => invocar("app:version"),
  actualizacion: () => invocar("actualizar:estado"),
  reiniciarParaActualizar: () => invocar("actualizar:instalar"),
  onEvento: (cb) => ipcRenderer.on("asistente:evento", (_e, ev) => cb(ev)),
  onActualizacion: (cb) => ipcRenderer.on("actualizar:cambio", (_e, ev) => cb(ev)),
});
