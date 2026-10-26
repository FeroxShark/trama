// Varias cuentas por proveedor (Ajustes > Plan y cupos, la bienvenida): la lista, alta, renombre, baja y login de cada cuenta
// los hace el CLI `cuentas` del orquestador (contrato: docs/cuentas-varias-por-proveedor.md de ese proyecto), el único dueño de
// `~/.config/trama/cuentas.json`. Trama no lo escribe ni lo lee: sólo le habla al CLI (execFile, sin shell) y valida lo que vuelve.
// Sin `cuentas` instalado (`HILOS_CUENTAS`, PATH o `~/.local/bin`) la lista es `null` y la app es la de una cuenta por proveedor.
// El login es interactivo y lo hace la persona: se lanza `cuentas login <id>` en una terminal (`terminal`, inyectada: la de
// electron/actualizador.ts) y se espera a que termine; después la vista vuelve a preguntar `--verificar`. Sin `electron`: lo prueba
// tests/cuentas-varias.test.ts con scripts/cuentas-falso.mjs.
import os from "node:os";
import { pathConLocal, resolverBinario } from "./binario.ts";
import { correrReal, type Salida } from "./cuentas.ts";
import { textoT } from "./errores.ts";

export type ProveedorCuenta = "claude" | "google" | "chatgpt";
export const PROVEEDORES_CUENTA: readonly ProveedorCuenta[] = ["claude", "google", "chatgpt"];

/** Una cuenta tal como la lista `cuentas --json`. `defecto`: la de siempre (su id es el del proveedor). `logueado`: `null` = no se preguntó o no se sabe. */
export type PerfilCuenta = { id: string; proveedor: ProveedorCuenta; nombre: string; defecto: boolean; logueado: boolean | null };
export type ListaCuentas = { version: 1; cuentas: PerfilCuenta[] };

type Env = Record<string, string | undefined>;
export type DepsVarias = {
  env: Env;
  home: string;
  esEjecutable?: (f: string) => boolean;
  correr: (bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<Salida>;
  /** Abre `argv` en una terminal y espera a que termine: `err` si no corrió o falló (texto ya codificado para la UI). */
  terminal?: (argv: string[], env: NodeJS.ProcessEnv) => Promise<{ err: string | null }>;
};

const TOPE_RAPIDO = 15_000;
const TOPE_VERIFICAR = 45_000;
export const LARGO_NOMBRE = 60;
const ID_VALIDO = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** El nombre que se escribe: sin espacios de más, 1 a 60 caracteres, sin controles. `null`: no vale. */
export function nombreValido(x: unknown): string | null {
  if (typeof x !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const n = x.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return n && n.length <= LARGO_NOMBRE ? n : null;
}

export const idValido = (x: unknown): x is string => typeof x === "string" && ID_VALIDO.test(x);
const proveedorValido = (x: unknown): x is ProveedorCuenta => typeof x === "string" && (PROVEEDORES_CUENTA as readonly string[]).includes(x);

const marca = textoT;

const ultimaLinea = (t: string) => t.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? "";

/** Corre `cuentas <args>`; sin el comando lo dice (clave), con código distinto de 0 devuelve lo que dijo. */
async function cli(d: DepsVarias, args: string[], timeout: number): Promise<string> {
  const bin = resolverBinario("cuentas", "HILOS_CUENTAS", d.env, d.home, d.esEjecutable);
  const r = await d.correr(bin, args, { ...d.env, PATH: pathConLocal(d.env, d.home) }, timeout);
  if (r.noExiste) throw new Error(marca("main.cuentasNo"));
  if (r.tiempo) throw new Error(marca("main.cuentasTiempo"));
  if (r.code !== 0) throw new Error(ultimaLinea(r.stderr) || ultimaLinea(r.stdout) || marca("main.cuentasFallo", { rc: String(r.code) }));
  return r.stdout;
}

/** ¿Está el comando `cuentas`? Sin él la app se comporta como siempre. */
export async function hayCuentas(d: DepsVarias): Promise<boolean> {
  try {
    await cli(d, ["--json"], TOPE_RAPIDO);
    return true;
  } catch {
    return false;
  }
}

/** Valida la salida de `cuentas --json`: sólo cuentas con id y proveedor conocidos. `null`: no es el contrato. */
export function parsearCuentas(salida: string): ListaCuentas | null {
  let raw: unknown;
  try {
    raw = JSON.parse(salida);
  } catch {
    return null;
  }
  const o = raw as { version?: unknown; cuentas?: unknown } | null;
  if (!o || o.version !== 1 || !Array.isArray(o.cuentas)) return null;
  const cuentas: PerfilCuenta[] = [];
  for (const c of o.cuentas) {
    const x = (c ?? {}) as Record<string, unknown>;
    if (!idValido(x.id) || !proveedorValido(x.proveedor)) continue;
    cuentas.push({
      id: x.id,
      proveedor: x.proveedor,
      nombre: nombreValido(x.nombre) ?? x.id,
      defecto: x.defecto === true || x.id === x.proveedor,
      logueado: typeof x.logueado === "boolean" ? x.logueado : null,
    });
  }
  return cuentas.length ? { version: 1, cuentas } : null;
}

/** La lista de cuentas; `verificar` le pregunta el login a cada CLI (lento: hasta decenas de segundos). `null`: no hay `cuentas`. */
export async function listarCuentas(d: DepsVarias, verificar = false): Promise<ListaCuentas | null> {
  try {
    return parsearCuentas(await cli(d, verificar ? ["--json", "--verificar"] : ["--json"], verificar ? TOPE_VERIFICAR : TOPE_RAPIDO));
  } catch {
    return null;
  }
}

/** Crea la cuenta y su carpeta (no hace el login) y devuelve su id. */
export async function agregarCuenta(d: DepsVarias, proveedor: unknown, nombre: unknown): Promise<string> {
  const n = nombreValido(nombre);
  if (!proveedorValido(proveedor) || !n) throw new Error(marca("main.cuentasDato"));
  const id = ultimaLinea(await cli(d, ["agregar", proveedor, n], TOPE_RAPIDO));
  if (!idValido(id)) throw new Error(marca("main.cuentasFallo", { rc: "?" }));
  return id;
}

export async function renombrarCuenta(d: DepsVarias, id: unknown, nombre: unknown): Promise<void> {
  const n = nombreValido(nombre);
  if (!idValido(id) || !n) throw new Error(marca("main.cuentasDato"));
  await cli(d, ["renombrar", id, n], TOPE_RAPIDO);
}

/** Saca la cuenta de la lista; `borrarCredenciales` además borra su carpeta (se pregunta antes, en la vista). La de siempre no se quita. */
export async function quitarCuenta(d: DepsVarias, id: unknown, borrarCredenciales: unknown): Promise<void> {
  if (!idValido(id) || proveedorValido(id)) throw new Error(marca("main.cuentasDato"));
  await cli(d, ["quitar", id, ...(borrarCredenciales === true ? ["--borrar-credenciales"] : [])], TOPE_RAPIDO);
}

/** El login de esa cuenta en una terminal; vuelve cuando la persona termina (o la cierra). Después hay que volver a verificar. */
export async function loginCuenta(d: DepsVarias, id: unknown): Promise<void> {
  if (!idValido(id)) throw new Error(marca("main.cuentasDato"));
  if (!d.terminal) throw new Error(marca("main.cuentasSinTerminal"));
  const bin = resolverBinario("cuentas", "HILOS_CUENTAS", d.env, d.home, d.esEjecutable);
  const r = await d.terminal([bin, "login", id], { ...d.env, PATH: pathConLocal(d.env, d.home) });
  if (r.err) throw new Error(r.err);
}

/** Una cuenta con su login preguntado (`--verificar`); el login que se acaba de hacer se comprueba con esto. */
export async function verCuenta(d: DepsVarias, id: unknown): Promise<PerfilCuenta | null> {
  if (!idValido(id)) return null;
  const l = await listarCuentas(d, true);
  return l?.cuentas.find((c) => c.id === id) ?? null;
}

export const cuentasDeEstaMaquinaVarias = (terminal: DepsVarias["terminal"]): DepsVarias => ({ env: process.env, home: os.homedir(), correr: correrReal, terminal });
