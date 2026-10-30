// Los canales que son de la pantalla de la PC y se resuelven en el proceso de la ventana, sea todo en uno
// (ipc.ts) o cliente del motor (ventana-cliente.ts): salir y recargar, volver como estaba, ir a la ventana
// de un líder, abrir el changelog y las notas de Trama, y los íconos achicados con `nativeImage`. Sin el núcleo: en modo cliente
// la ventana no lo carga.
import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, Notification, shell } from "electron";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { CHANGELOG } from "./actualizacion.js";
import { errorT } from "./errores.js";
import { pedidoDeSalida } from "./cierre.js";
import { iconosDe, LADO_MAX, logoDeBytes } from "./iconos.js";
import { abrirEnlace, notasDeGithub } from "./enlace.js";
import { log, silencio } from "./log.js";
import { textoDelPortapapeles } from "./portapapeles.js";
import { marcar } from "./reinicio-marcas.js";
import { registro } from "./registro.js";
import type { VersionAnterior } from "./version-anterior.js";
import { irA, ubicar } from "./terminal.js";
import { textosValidos, type Textos } from "./bandeja.js";
import { anunciar, avisoValido, estadoValido, type AvisoEspera, type EstadoEspera } from "./espera-aviso.js";

let recargarVentana: () => void = () => {};
/** Lo que hace "Recargar" del cartel de error (src/ErrorBoundary.ts): main.ts vuelve a cargar la ventana. */
export function ponerRecarga(fn: () => void) {
  recargarVentana = fn;
}

let relanzarVentana: () => void = () => {};
/** Lo que hace "Reiniciar la ventana" tras instalar una Trama nueva (aviso del pie): main.ts relanza el proceso. */
export function ponerRelanzo(fn: () => void) {
  relanzarVentana = fn;
}

let versionAnterior: VersionAnterior | null = null;
/** Actualizar seguro (electron/version-anterior.ts): lo que contestan "Volver a la versión anterior" de Ajustes y el aviso de que se volvió sola. */
export function ponerVersionAnterior(v: VersionAnterior | null) {
  versionAnterior = v;
}

export const ventanas = () => BrowserWindow.getAllWindows();
export const ocultar = () => {
  for (const v of ventanas()) v.hide();
};

/** Cuánto se espera a que la ventana diga qué tenía abierto y escrito antes de reiniciar. */
const VISTA_MS = 1500;
/** Lo que cada vista tenía al reiniciar la trama anterior (electron/volver.ts): se entrega una vez. */
let vistasDeAntes: Record<string, unknown> = {};
export function ponerVistas(v: Record<string, unknown>) {
  vistasDeAntes = v;
}
let alGuardarVista: ((vista: unknown) => void) | null = null;
/** Quien mantiene `volver.json` al día (main.ts): la ventana le avisa con cada cambio de lo que tiene abierto. */
let alAnotarVista: ((vista: unknown) => void) | null = null;
export function ponerAnotadorDeVista(fn: (vista: unknown) => void) {
  alAnotarVista = fn;
}
/** Le pide a la ventana lo que hay que devolverle al volver. `null` si no contesta a tiempo. */
export function pedirVista(): Promise<unknown> {
  return new Promise((ok) => {
    const t = setTimeout(() => fin(null), VISTA_MS);
    const fin = (v: unknown) => {
      clearTimeout(t);
      alGuardarVista = null;
      ok(v);
    };
    alGuardarVista = fin;
    for (const v of ventanas()) v.webContents.send("volver:pedir", null);
  });
}

/** Un PNG/JPG/WebP achicado a `LADO_MAX` px de lado (sin agrandar lo que ya es más chico), como data URL; `null` si no se pudo leer. */
function achicarLogo(crudo: Buffer): string | null {
  const img = nativeImage.createFromBuffer(crudo);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  if (width <= LADO_MAX && height <= LADO_MAX) return img.toDataURL();
  const f = LADO_MAX / Math.max(width, height);
  return img.resize({ width: Math.max(1, Math.round(width * f)), height: Math.max(1, Math.round(height * f)), quality: "best" }).toDataURL();
}

/** Los logos de las carpetas: archivos locales, achicados acá (64 px alcanzan para el círculo a 2×). */
export async function iconosVentana() {
  return iconosDe(await registro(), achicarLogo);
}

/** Lo más que se lee de una imagen elegida a mano. */
const TOPE_ELEGIDA = 8 * 1024 * 1024;

/** El selector nativo de una imagen para el logo de un proyecto: la imagen ya achicada (data URL) o `null` si se canceló. */
async function elegirLogo(e: Electron.IpcMainInvokeEvent): Promise<string | null> {
  const v = BrowserWindow.fromWebContents(e.sender) ?? undefined;
  const filtros = [{ name: "PNG, JPG, WebP, ICO, SVG", extensions: ["png", "jpg", "jpeg", "webp", "ico", "svg"] }];
  const r = await (v ? dialog.showOpenDialog(v, { properties: ["openFile"], filters: filtros }) : dialog.showOpenDialog({ properties: ["openFile"], filters: filtros }));
  const archivo = r.canceled ? null : (r.filePaths[0] ?? null);
  if (!archivo) return null;
  const s = await stat(archivo).catch(() => null);
  if (!s?.isFile() || s.size === 0 || s.size > TOPE_ELEGIDA) throw errorT("main.logo.invalido");
  const url = logoDeBytes(await readFile(archivo), path.extname(archivo), achicarLogo);
  if (!url) throw errorT("main.logo.invalido");
  return url;
}

/** Quien tiene la bandeja (main.ts): el renderer le manda los textos del menú ya traducidos. */
let alTextosBandeja: ((t: Textos) => void) | null = null;
export function ponerTextosBandeja(fn: (t: Textos) => void) {
  alTextosBandeja = fn;
}

/** Quien tiene la bandeja: cuántos líderes esperan al usuario (el tooltip y el punto del ícono). */
let alEstadoEspera: ((e: EstadoEspera) => void) | null = null;
/** Lo último que dijo la ventana: la bandeja se arma después de la primera lectura. */
let ultimoEstadoEspera: EstadoEspera | null = null;
export function ponerEstadoEspera(fn: (e: EstadoEspera) => void) {
  alEstadoEspera = fn;
  if (ultimoEstadoEspera) fn(ultimoEstadoEspera);
}

/** Las notificaciones vivas: sin una referencia el recolector las suelta antes de que se toquen. */
const avisos = new Set<Notification>();
/** La notificación de "te espera": al tocarla vuelve la ventana y el renderer abre esa conversación. Sin sonido. */
function mostrarAviso(a: AvisoEspera) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: a.titulo, body: a.cuerpo, silent: true });
  avisos.add(n);
  const soltar = () => void avisos.delete(n);
  n.on("close", soltar);
  n.on("failed", soltar);
  n.on("click", () => {
    soltar();
    const v = ventanas()[0];
    if (!v || v.isDestroyed()) return;
    v.show();
    v.focus();
    v.webContents.send("espera:abrir", a.sid);
  });
  n.show();
}

/** Le pide a la ventana la pregunta de cómo cerrar (el diálogo de Cerrar del todo): la bandeja la trae a la vista y la dispara. */
export function pedirSalida() {
  for (const v of ventanas()) v.webContents.send("app:pedirSalida", null);
}

/**
 * Anota en el IPC los canales que son sólo de la ventana; `salir` es Cerrar del todo (Ctrl+Q, la bandeja) con lo que
 * eligió el usuario en el diálogo: devuelve cuántos líderes responden (y no hizo nada), o 0 y el proceso se va.
 */
export function armarCanalesVentana(salir: (x: { modo: "seguir" | "parar"; forzar: boolean }) => Promise<number>) {
  ipcMain.handle("archivo:elegirLogo", (e) => elegirLogo(e));
  ipcMain.handle("app:salir", (_e, x: unknown) => salir(pedidoDeSalida(x)));
  ipcMain.handle("bandeja:textos", (_e, x: unknown) => {
    const t = textosValidos(x);
    if (t) alTextosBandeja?.(t);
  });
  ipcMain.handle("espera:estado", (_e, x: unknown) => {
    const e = estadoValido(x);
    if (!e) return;
    ultimoEstadoEspera = e;
    alEstadoEspera?.(e);
  });
  ipcMain.handle("espera:notificar", (_e, x: unknown) => {
    const a = avisoValido(x);
    if (a) anunciar(a, mostrarAviso);
  });
  // Respaldo del Ctrl+V de la caja cuando el navegador no recibe el texto (electron/portapapeles.ts).
  ipcMain.handle("portapapeles:texto", () =>
    textoDelPortapapeles(clipboard, (tipos) => log.escribir("aviso", "portapapeles", `sin texto; tipos: ${tipos.join(", ") || "ninguno"}`)),
  );
  // El selector nativo de carpetas del campo "Carpeta" de un líder nuevo: la ruta elegida o `null` si se canceló. Por la tailnet no existe (se escribe la ruta).
  ipcMain.handle("carpeta:elegir", async (e) => {
    const v = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const r = await (v ? dialog.showOpenDialog(v, { properties: ["openDirectory"] }) : dialog.showOpenDialog({ properties: ["openDirectory"] }));
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle("app:recargar", () => recargarVentana());
  ipcMain.handle("trama:reiniciarVentana", () => relanzarVentana());
  // Volver como estaba: sólo la ventana pasa por acá (el navegador se guarda lo suyo, src/volver.ts).
  ipcMain.handle("volver:leer", () => {
    const v = vistasDeAntes.ventana ?? null;
    delete vistasDeAntes.ventana;
    return v;
  });
  ipcMain.handle("volver:guardar", (_e, vista: unknown) => void alGuardarVista?.(vista));
  // Una marca del reinicio que anota la página (electron/reinicio-marcas.ts): sin reinicio en marcha no hace nada.
  ipcMain.handle("reinicio:marca", (_e, paso: unknown) => void (typeof paso === "string" && /^[a-z-]{1,30}$/.test(paso) && marcar("pagina", paso)));
  ipcMain.handle("volver:anotar", (_e, vista: unknown) => void alAnotarVista?.(vista));
  // "Ir a la ventana" de un líder de la terminal (electron/terminal.ts), y si se la puede ubicar.
  ipcMain.handle("lider:ir", (_e, pid: number) => irA(Number(pid)));
  ipcMain.handle("lider:ubicable", async (_e, pid: number) => (await ubicar(Number(pid))) !== null);
  // La URL es fija: el frontend no elige qué se abre.
  ipcMain.handle("claude:changelog", () => shell.openExternal(CHANGELOG));
  // Actualizar seguro: qué versión anterior hay para volver (o null), volver a ella, y el aviso de que se volvió sola (se gasta al leerlo).
  ipcMain.handle("trama:anterior", async () => (await versionAnterior?.disponible()) ?? null);
  ipcMain.handle("trama:volverAnterior", () => versionAnterior?.volverManual() ?? { ok: false, error: "esta instalación no guarda versiones anteriores" });
  ipcMain.handle("trama:avisoVuelta", () => versionAnterior?.leerAviso() ?? null);
  // Las notas del aviso de "Trama nueva": la URL la pone el frontend, así que sólo sale si es de github.com (enlace.ts).
  ipcMain.handle("trama:notas", (_e, url: unknown) => {
    if (typeof url === "string" && notasDeGithub(url)) abrirEnlace(url, (u) => void shell.openExternal(u).catch(silencio("ventana")));
  });
}
