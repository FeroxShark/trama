// Qué proveedores están conectados para el selector (electron/conexion-modelos.ts): la sesión de cada CLI más lo instalado, con caché corto.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { conexionDe, cuentasConCache, olvidarConexion } from "../electron/conexion-modelos.ts";
import type { Cuenta, EstadoCuentas } from "../electron/cuentas.ts";

const cta = (logueado: boolean): Cuenta => ({ instalado: true, logueado, cuenta: null, error: null });
const estado = (claude: boolean, agy: boolean, codex?: boolean): EstadoCuentas => ({ version: 1, claude: cta(claude), agy: cta(agy), ...(codex === undefined ? {} : { codex: cta(codex) }) });
const todo = { agy: true, dsh: true, opencode: true, local: true };

beforeEach(() => olvidarConexion());

test("cada proveedor está conectado según su sesión o su programa", () => {
  assert.deepEqual(conexionDe(estado(true, true, true), todo), { anthropic: true, google: true, openai: true, opencode: true, dsh: true, local: true });
  assert.deepEqual(conexionDe(estado(false, false, false), { agy: false, dsh: false, opencode: false, local: false }), { anthropic: false, google: false, openai: false, opencode: false, dsh: false, local: false });
});

test("Gemini necesita agy instalado Y con sesión; ChatGPT sin `codex` en el estado cuenta como sin conectar", () => {
  assert.equal(conexionDe(estado(true, true), { ...todo, agy: false }).google, false);
  assert.equal(conexionDe(estado(true, false), todo).google, false);
  assert.equal(conexionDe(estado(true, true), todo).openai, false);
});

test("si las cuentas no se pudieron leer, nada con sesión queda conectado (pero lo instalado sí)", () => {
  assert.deepEqual(conexionDe(null, todo), { anthropic: false, google: false, openai: false, opencode: true, dsh: true, local: true });
});

test("las consultas seguidas comparten una sola; después del caché o de olvidarlo se pregunta de nuevo", async () => {
  let n = 0;
  const preguntar = async () => (n++, estado(true, true, true));
  await Promise.all([cuentasConCache(preguntar, 1000), cuentasConCache(preguntar, 1500)]);
  assert.equal(n, 1);
  await cuentasConCache(preguntar, 1000 + 29_000);
  assert.equal(n, 1);
  await cuentasConCache(preguntar, 1000 + 31_000);
  assert.equal(n, 2);
  olvidarConexion();
  await cuentasConCache(preguntar, 1000 + 31_001);
  assert.equal(n, 3);
});

test("una consulta que falla da null (y el menú sigue)", async () => {
  assert.equal(await cuentasConCache(async () => Promise.reject(new Error("x")), 5000), null);
});
