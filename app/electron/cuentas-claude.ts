// Gestor de múltiples cuentas de Claude para Trama.
// Permite guardar perfiles aislados de .claude.json y .credentials.json,
// listar las cuentas conectadas y alternar entre ellas con un clic.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ESTADO } from "./estado.js";
import { log } from "./log.js";
import { enTerminal } from "./actualizador.js";
import { resolverBinario } from "./binario.js";

export interface CuentaClaude {
  id: string;
  email: string;
  nombre: string;
  activa: boolean;
  creada: number;
}

export interface EstadoCuentasClaude {
  version: 1;
  activa: string | null;
  cuentas: CuentaClaude[];
}

const HOME = os.homedir();
const CLAUDE_JSON = path.join(HOME, ".claude.json");
const CLAUDE_CREDENTIALS = path.join(HOME, ".claude", ".credentials.json");

function carpetaPerfiles(): string {
  const dir = path.join(ESTADO, "perfiles_claude");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {}
  }
  return dir;
}

function rutaRegistro(): string {
  return path.join(carpetaPerfiles(), "perfiles.json");
}

function leerJson<T>(f: string): T | null {
  try {
    if (!existsSync(f)) return null;
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
}

function leerEmailActual(): string | null {
  const j = leerJson<{ oauthAccount?: { emailAddress?: string } }>(CLAUDE_JSON);
  return j?.oauthAccount?.emailAddress?.trim() || null;
}

function leerRegistro(): EstadoCuentasClaude {
  const r = leerJson<EstadoCuentasClaude>(rutaRegistro());
  if (r && r.version === 1 && Array.isArray(r.cuentas)) return r;
  return { version: 1, activa: null, cuentas: [] };
}

function guardarRegistro(r: EstadoCuentasClaude): void {
  try {
    writeFileSync(rutaRegistro(), JSON.stringify(r, null, 2), "utf8");
  } catch (e) {
    log.escribir("error", "cuentas", `Error al guardar registro de cuentas Claude: ${e}`);
  }
}

/**
  * Sincroniza la cuenta actualmente en uso en ~/.claude.json dentro del registro de perfiles.
  */
export function asegurarCuentaActual(): EstadoCuentasClaude {
  const reg = leerRegistro();
  const email = leerEmailActual();
  if (!email) return reg;

  const perfilDir = carpetaPerfiles();
  let existe = reg.cuentas.find((c) => c.email.toLowerCase() === email.toLowerCase());

  if (!existe) {
    const id = `cuenta_${Date.now()}`;
    const cuentaDir = path.join(perfilDir, id);
    mkdirSync(cuentaDir, { recursive: true });

    // Copiar archivos actuales al perfil
    if (existsSync(CLAUDE_JSON)) copyFileSync(CLAUDE_JSON, path.join(cuentaDir, ".claude.json"));
    if (existsSync(CLAUDE_CREDENTIALS)) copyFileSync(CLAUDE_CREDENTIALS, path.join(cuentaDir, ".credentials.json"));

    existe = {
      id,
      email,
      nombre: email,
      activa: true,
      creada: Date.now(),
    };
    reg.cuentas.push(existe);
  }

  // Marcar como activa
  reg.activa = existe.id;
  for (const c of reg.cuentas) {
    c.activa = c.id === existe.id;
  }

  guardarRegistro(reg);
  return reg;
}

/** Devuelve la lista de cuentas de Claude guardadas. */
export function listarCuentasClaude(): EstadoCuentasClaude {
  return asegurarCuentaActual();
}

/**
 * Alterna la cuenta activa a la seleccionada copiando sus credenciales a ~/.claude.json.
 */
export function cambiarCuentaClaude(id: string): { ok: boolean; email?: string; error?: string } {
  const reg = leerRegistro();
  const target = reg.cuentas.find((c) => c.id === id);
  if (!target) return { ok: false, error: "Cuenta no encontrada" };

  const perfilDir = carpetaPerfiles();

  // 1. Respaldar la cuenta que estaba activa antes de cambiar
  if (reg.activa) {
    const activoDir = path.join(perfilDir, reg.activa);
    mkdirSync(activoDir, { recursive: true });
    if (existsSync(CLAUDE_JSON)) copyFileSync(CLAUDE_JSON, path.join(activoDir, ".claude.json"));
    if (existsSync(CLAUDE_CREDENTIALS)) copyFileSync(CLAUDE_CREDENTIALS, path.join(activoDir, ".credentials.json"));
  }

  // 2. Restaurar la cuenta destino
  const targetDir = path.join(perfilDir, target.id);
  const srcJson = path.join(targetDir, ".claude.json");
  const srcCred = path.join(targetDir, ".credentials.json");

  if (existsSync(srcJson)) {
    copyFileSync(srcJson, CLAUDE_JSON);
  }
  if (existsSync(srcCred)) {
    const credDir = path.dirname(CLAUDE_CREDENTIALS);
    if (!existsSync(credDir)) mkdirSync(credDir, { recursive: true });
    copyFileSync(srcCred, CLAUDE_CREDENTIALS);
  }

  // 3. Actualizar estado
  reg.activa = target.id;
  for (const c of reg.cuentas) c.activa = c.id === target.id;
  guardarRegistro(reg);

  log.escribir("info", "cuentas", `Cuenta de Claude cambiada a: ${target.email}`);
  return { ok: true, email: target.email };
}

/**
 * Abre una terminal para iniciar sesión con una nueva cuenta de Claude
 * sin perder las credenciales de la cuenta actual.
 */
export async function conectarNuevaCuenta(): Promise<{ ok: boolean; email?: string; error?: string }> {
  // Asegurar que la actual esté guardada
  asegurarCuentaActual();
  const emailAntes = leerEmailActual();

  const claudeBin = resolverBinario("claude", "HILOS_CLAUDE", process.env, HOME);
  const res = await enTerminal([claudeBin, "auth", "login"], process.env as NodeJS.ProcessEnv);

  if (res.err) {
    return { ok: false, error: res.err };
  }

  // Sincronizar nueva cuenta si se completó el login
  const nuevoEmail = leerEmailActual();
  if (nuevoEmail) {
    asegurarCuentaActual();
    log.escribir("info", "cuentas", `Login completado. Anterior: ${emailAntes ?? "ninguno"}, Nuevo: ${nuevoEmail}`);
    return { ok: true, email: nuevoEmail };
  }

  return { ok: false, error: "No se detectó una nueva sesión de Claude" };
}
