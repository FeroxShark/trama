// `remoto.json`, el acceso desde el celular, leído y escrito desde Ajustes (antes se editaba a mano). El archivo es
// el de siempre (`{ version: 1, puerto, dispositivos }`; apagado a propósito: `activo: false`, que conserva el puerto y
// la lista). Acá sólo se decide qué entra al archivo: dónde se escucha no se elige (siempre y sólo las IPs de Tailscale,
// remoto.ts) y cualquier campo que no sea de la lista se rechaza, también un `host` o `0.0.0.0`. Que el servidor se
// ponga al día con lo escrito lo hace remoto-armar.ts. Lo prueba tests/remoto-config.test.ts.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { errorT } from "./errores.ts";
import { ESTADO, escribirAtomico } from "./pa.js";
import { DISPOSITIVOS_MAX, PUERTO_DEF, validarDispositivo, validarPuerto, type ConfigEditable } from "./valida-ajustes.ts";

export const ARCHIVO_REMOTO = path.join(ESTADO, "remoto.json");

export type { ConfigEditable };

const CAMPOS = new Set(["activo", "puerto", "dispositivos"]);

/** El archivo tal como está, sin exigir que sirva para escuchar: apagado y vacío si no existe o está roto. */
export async function leerEditable(archivo = ARCHIVO_REMOTO): Promise<ConfigEditable> {
  let j: { version?: unknown; puerto?: unknown; dispositivos?: unknown; activo?: unknown } | null = null;
  try {
    j = JSON.parse(await readFile(archivo, "utf8"));
  } catch {
    // Sin archivo (o roto): apagado, con el puerto de siempre para proponer.
  }
  if (!j || j.version !== 1) return { activo: false, puerto: PUERTO_DEF, dispositivos: [] };
  const puerto = typeof j.puerto === "number" && validarPuerto(j.puerto) === null ? j.puerto : PUERTO_DEF;
  const dispositivos = Array.isArray(j.dispositivos)
    ? j.dispositivos.filter((d): d is string => typeof d === "string" && /^[a-z0-9-]{1,63}$/i.test(d))
    : [];
  return { activo: j.activo !== false && dispositivos.length > 0 && validarPuerto(j.puerto) === null, puerto, dispositivos };
}

/**
 * Lo que llega a guardar, ya revisado: tira con el motivo si algo no vale (y entonces no se escribe nada).
 * `dispositivos` se normaliza (minúsculas, sin repetir); prendido exige al menos uno.
 */
export function validarConfig(x: unknown): ConfigEditable {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw errorT("main.remotoForma");
  const o = x as Record<string, unknown>;
  const raro = Object.keys(o).find((k) => !CAMPOS.has(k));
  if (raro !== undefined) throw errorT("main.remotoCampo", { campo: raro.slice(0, 40) });
  if (typeof o.activo !== "boolean") throw errorT("main.remotoForma");
  const malPuerto = validarPuerto(o.puerto);
  if (malPuerto || typeof o.puerto !== "number") throw errorT("main.remotoPuerto");
  if (!Array.isArray(o.dispositivos)) throw errorT("main.remotoForma");
  if (o.dispositivos.length > DISPOSITIVOS_MAX) throw errorT("main.remotoDemasiados", { max: DISPOSITIVOS_MAX });
  const dispositivos: string[] = [];
  for (const d of o.dispositivos) {
    const mal = validarDispositivo(d, dispositivos);
    if (mal === "ajustes.errDispRepetido") continue;
    if (mal) throw errorT("main.remotoDispositivo", { nombre: String(d).slice(0, 40) });
    dispositivos.push((d as string).trim().toLowerCase());
  }
  if (o.activo && !dispositivos.length) throw errorT("main.remotoSinDispositivos");
  return { activo: o.activo, puerto: o.puerto, dispositivos };
}

/** Valida y escribe `remoto.json`; devuelve cómo quedó. Rechaza (sin tocar el archivo) si algo no vale. */
export async function guardarConfig(x: unknown, archivo = ARCHIVO_REMOTO): Promise<ConfigEditable> {
  const c = validarConfig(x);
  const json: Record<string, unknown> = { version: 1, puerto: c.puerto, dispositivos: c.dispositivos };
  if (!c.activo) json.activo = false;
  await escribirAtomico(archivo, JSON.stringify(json, null, 2) + "\n");
  return c;
}
