// Plugin «pa-worker» de agy (Antigravity CLI) para el Trama nativo de Windows: lo que en Linux hace instalar-producto.sh con
// symlinks (plugin.json, hooks.json y agy-pa.sh en ~/.gemini/config/plugins/pa-worker), pero COPIANDO (un symlink pide privilegios
// en Windows) y con los hooks de Node (`.mjs`, sin bash). Sin el plugin los workers de agy no tienen guardias y pa no los lanza.
//
// Lo corren `instalar-nativo` (al instalar o actualizar Trama) y `pa` mismo cuando el chequeo de agy ve que el plugin no está
// cargado (agy se pudo instalar después de Trama): es idempotente y no pisa una carpeta que no sea nuestra. Lo prueba
// tests/cli-plugin-agy.test.ts con las carpetas inyectadas.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { apoyoDeHooks, HOOK_DE_AGY, archivoHook, hooksJsonAgy } from "./hooks.ts";

export type LineaPlugin = { tipo: "ok" | "hecho" | "aviso"; texto: string };

export const MARCA_PLUGIN = ".de-trama";
const NOMBRE_PLUGIN = "pa-worker";
/** Las guardias que `agy-pa.mjs` llama desde su propia carpeta (y lo que ellas cargan). */
const GUARDIAS = ["destructive-guard", "latido"] as const;

/** `~/.gemini/config/plugins/pa-worker`. */
export const carpetaPluginAgy = (home: string): string => path.join(home, ".gemini", "config", "plugins", NOMBRE_PLUGIN);

const leer = (f: string): string | null => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};

/** Escribe `texto` si el archivo no lo tiene ya: devuelve true si cambió. */
function escribirSiCambia(f: string, texto: string): boolean {
  if (leer(f) === texto) return false;
  writeFileSync(f, texto);
  return true;
}

/** Copia `de` en `a` si el contenido difiere: devuelve true si cambió. */
function copiarSiCambia(de: string, a: string): boolean {
  const nuevo = readFileSync(de);
  try {
    if (readFileSync(a).equals(nuevo)) return false;
  } catch {
    /* no estaba */
  }
  copyFileSync(de, a);
  return true;
}

/**
 * Deja el plugin en su lugar. `hooks` = la carpeta con los `.mjs` (en Windows `<app>\hooks`). Devuelve las líneas del instalador.
 * Una carpeta que ya está, no es de Trama y trae otro plugin se deja como está (aviso).
 */
export function instalarPluginAgy(o: { hooks: string; home: string }): LineaPlugin[] {
  const plug = carpetaPluginAgy(o.home);
  const agyPa = path.join(o.hooks, archivoHook(HOOK_DE_AGY, "mjs"));
  if (!existsSync(agyPa)) return [{ tipo: "aviso", texto: `falta ${agyPa}: no instalé el plugin pa-worker de agy` }];
  const manifiesto = path.join(plug, "plugin.json");
  if (existsSync(plug) && !existsSync(path.join(plug, MARCA_PLUGIN))) {
    let nombre: unknown;
    try {
      nombre = (JSON.parse(leer(manifiesto) ?? "null") as { name?: unknown } | null)?.name;
    } catch {
      nombre = undefined;
    }
    if (existsSync(manifiesto) && nombre !== NOMBRE_PLUGIN) return [{ tipo: "aviso", texto: `no toco ${plug} (es de otro plugin; movelo a mano)` }];
  }
  let cambio = false;
  mkdirSync(plug, { recursive: true });
  cambio = escribirSiCambia(manifiesto, `${JSON.stringify({ name: NOMBRE_PLUGIN })}\n`) || cambio;
  cambio = escribirSiCambia(path.join(plug, "hooks.json"), `${JSON.stringify(hooksJsonAgy("mjs"), null, 2)}\n`) || cambio;
  cambio = copiarSiCambia(agyPa, path.join(plug, archivoHook(HOOK_DE_AGY, "mjs"))) || cambio;
  const faltan: string[] = [];
  for (const g of [...GUARDIAS.map((n) => `${n}.mjs`), ...apoyoDeHooks("mjs")]) {
    const de = path.join(o.hooks, g);
    if (existsSync(de)) cambio = copiarSiCambia(de, path.join(plug, g)) || cambio;
    else faltan.push(g);
  }
  escribirSiCambia(path.join(plug, MARCA_PLUGIN), "copiado por Trama: se reemplaza en cada instalación\n");
  const lineas: LineaPlugin[] = [{ tipo: cambio ? "hecho" : "ok", texto: `${cambio ? "plugin pa-worker de agy: " : ""}${plug}` }];
  if (faltan.length) lineas.push({ tipo: "aviso", texto: `al plugin pa-worker le faltan ${faltan.join(", ")} (no están en ${o.hooks})` });
  return lineas;
}
