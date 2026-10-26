// El secreto de cada instalación para el modo local (`TRAMA_LOCAL=1`): sin él, cualquier proceso que pueda abrir
// 127.0.0.1:8791 (otro usuario del sistema, o en WSL2 cualquier programa de Windows por el reenvío de localhost)
// manejaría agentes que corren comandos como el usuario. El navegador lo recibe una vez por `/?t=` y queda en una cookie.
// Node puro (sin `electron`): lo prueba tests/modo-local.test.ts.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configTrama } from "./rutas.ts";

type Env = Record<string, string | undefined>;

/** ¿Se exige el token? Siempre salvo `TRAMA_TOKEN=0` (la excepción de WSL mientras la carcasa de Windows no lo mande). */
export const tokenExigido = (env: Env = process.env) => env.TRAMA_TOKEN !== "0";

/** `~/.config/trama/token` (`XDG_CONFIG_HOME` lo mueve). */
export const rutaToken = (env: Env = process.env) => path.join(configTrama(env), "token");

const valido = (t: string) => /^[0-9a-f]{64}$/.test(t);

/** Lee el token; si no está (o no sirve) crea uno nuevo de 32 bytes en hex, archivo 0600 y carpeta 0700. */
export function leerOCrearToken(env: Env = process.env): string {
  const archivo = rutaToken(env);
  try {
    const t = readFileSync(archivo, "utf8").trim();
    if (valido(t)) {
      // Por si alguien lo dejó abierto a otros.
      try {
        chmodSync(archivo, 0o600);
      } catch {}
      return t;
    }
  } catch {}
  const t = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(archivo), { recursive: true, mode: 0o700 });
  writeFileSync(archivo, `${t}\n`, { mode: 0o600 });
  // `mode` no cambia el de un archivo que ya existía (el inválido que se reemplaza).
  chmodSync(archivo, 0o600);
  return t;
}

/** Comparación en tiempo constante (con largos distintos no hay nada que ocultar). */
export function mismoToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** ¿La cabecera `Cookie` trae `trama=<token>`? */
export function cookieValida(cabecera: string | undefined, token: string): boolean {
  for (const par of (cabecera ?? "").split(";")) {
    const i = par.indexOf("=");
    if (i > 0 && par.slice(0, i).trim() === "trama" && mismoToken(par.slice(i + 1).trim(), token)) return true;
  }
  return false;
}
