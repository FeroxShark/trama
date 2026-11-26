// Presets de skills en disco (`<config de trama>/presets.json`). Node puro: los tests pasan la carpeta. Los tipos y la lógica
// pura viven en `presets-tipos.ts` (que también importa la interfaz); acá sólo se leen, validan y guardan.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { errorT } from "./errores.ts";
import { configTrama } from "./rutas.ts";
import { type ConfigPresets, normalizarPresets, presetsFabrica } from "./presets-tipos.ts";

export * from "./presets-tipos.ts";

export type EstadoPresets = { version: 1; ruta: string; existe: boolean; config: ConfigPresets };

export const archivoPresets = (dir = configTrama()) => path.join(dir, "presets.json");

/** La config guardada; si falta o es JSON roto, los defaults de fábrica. */
export function leerPresets(dir = configTrama()): ConfigPresets {
  try {
    return normalizarPresets(JSON.parse(readFileSync(archivoPresets(dir), "utf8")));
  } catch {
    return presetsFabrica();
  }
}

export function estadoPresets(dir = configTrama()): EstadoPresets {
  const ruta = archivoPresets(dir);
  let existe = false;
  try {
    readFileSync(ruta);
    existe = true;
  } catch {
    existe = false;
  }
  return { version: 1, ruta, existe, config: leerPresets(dir) };
}

/** Valida (objeto), normaliza y guarda de forma atómica (`tmp` + rename). Devuelve el estado nuevo. */
export function guardarPresets(x: unknown, dir = configTrama()): EstadoPresets {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw errorT("main.modelosForma");
  const cfg = normalizarPresets(x);
  mkdirSync(dir, { recursive: true });
  const ruta = archivoPresets(dir);
  const tmp = `${ruta}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
  renameSync(tmp, ruta);
  return { version: 1, ruta, existe: true, config: cfg };
}
