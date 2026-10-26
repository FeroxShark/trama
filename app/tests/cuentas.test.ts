// Ajustes > Cuentas (electron/cuentas.ts): agy conectado, sin conectar y con el binario en ~/.local/bin fuera del PATH
// del servicio, contra scripts/agy-falso.mjs; Claude con su `auth status`. Nada toca la red ni una cuenta de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { correrReal, cuentaValida, estadoCuentas, sondearAgy, sondearClaude, sondearCodex, type Deps, type Salida } from "../electron/cuentas.ts";
import { hayAgy } from "../electron/capacidades.ts";
import { resolverAgy } from "../electron/binario.ts";

// Un PATH mínimo donde esté el `node` que corre la prueba (agy-falso.mjs es `#!/usr/bin/env node`).
const BASICO = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(":");
const FALSO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "agy-falso.mjs");
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-cuentas-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** Un `agy` en una carpeta: un sh que corre el falso con el mismo node (no depende del PATH). */
function agyEn(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "agy");
  writeFileSync(f, `#!/bin/sh\nexec "${process.execPath}" "${FALSO}" "$@"\n`);
  chmodSync(f, 0o755);
  return f;
}

const reales = (env: Record<string, string | undefined>, home: string): Deps => ({ env, home, correr: correrReal });

test("agy conectado: `agy models` trae modelos", async () => {
  const c = await sondearAgy(reales({ HILOS_AGY: FALSO, PATH: BASICO }, tmp));
  assert.deepEqual(c, { instalado: true, logueado: true, cuenta: null, error: null });
});

test("agy sin conectar: no trae nada y no es un error", async () => {
  const c = await sondearAgy(reales({ HILOS_AGY: FALSO, PATH: BASICO, TRAMA_FALSO_AGY_LOGIN: "0" }, tmp));
  assert.deepEqual(c, { instalado: true, logueado: false, cuenta: null, error: null });
});

test("agy en ~/.local/bin y un PATH pelado (el servicio): se encuentra y está conectado", async () => {
  const home = path.join(tmp, "casa-a");
  agyEn(path.join(home, ".local", "bin"));
  const vacio = path.join(tmp, "path-vacio"); // un PATH sin agy (aquí /usr/bin tiene el de verdad)
  mkdirSync(vacio, { recursive: true });
  const env = { PATH: vacio };
  assert.equal(resolverAgy(env, home), path.join(home, ".local", "bin", "agy"));
  assert.equal(hayAgy(env, home), true);
  assert.deepEqual(await sondearAgy(reales(env, home)), { instalado: true, logueado: true, cuenta: null, error: null });
  // Sin sesión en ese mismo agy: instalado, sin conectar.
  const sinSesion = await sondearAgy(reales({ ...env, TRAMA_FALSO_AGY_LOGIN: "0" }, home));
  assert.equal(sinSesion.instalado, true);
  assert.equal(sinSesion.logueado, false);
});

test("agy en /usr/local/bin o ~/.antigravity/bin también se encuentra; sin él: no instalado", async () => {
  const home = path.join(tmp, "casa-b");
  const en = (...fs: string[]) => (f: string) => fs.includes(f);
  assert.equal(resolverAgy({ PATH: "/usr/bin" }, home, en(path.join(home, ".antigravity", "bin", "agy"))), path.join(home, ".antigravity", "bin", "agy"));
  assert.equal(hayAgy({ PATH: "" }, home, en("/usr/local/bin/agy")), true);
  assert.equal(hayAgy({ PATH: "" }, home, en()), false);
  const c = await sondearAgy({ env: { PATH: "/nada" }, home: path.join(tmp, "casa-sin"), esEjecutable: () => false, correr: correrReal });
  assert.deepEqual(c, { instalado: false, logueado: false, cuenta: null, error: null });
});

test("agy que falla (sin red) o no contesta: error con el motivo, nunca 'sin conectar' a ciegas", async () => {
  const c = await sondearAgy(reales({ HILOS_AGY: FALSO, PATH: BASICO, TRAMA_FALSO_AGY_ERROR: "dial tcp: lookup falló" }, tmp));
  assert.equal(c.instalado, true);
  assert.equal(c.logueado, false);
  assert.equal(c.error, "dial tcp: lookup falló");
  const colgado: Deps = { env: { HILOS_AGY: FALSO }, home: tmp, correr: async () => ({ code: null, stdout: "", stderr: "", tiempo: true, noExiste: false }) };
  assert.equal((await sondearAgy(colgado)).error, "agy no contestó a tiempo");
});

const claudeDice = (s: Partial<Salida>): Deps => ({
  env: { HILOS_CLAUDE: "/x/claude" },
  home: tmp,
  correr: async () => ({ code: 0, stdout: "", stderr: "", tiempo: false, noExiste: false, ...s }),
});

test("claude: conectado con su correo, sin sesión (sale con 1 y dice el JSON) y un claude que no se entiende", async () => {
  assert.deepEqual(await sondearClaude(claudeDice({ stdout: '{"loggedIn":true,"email":"ana@ejemplo.org"}' })), { instalado: true, logueado: true, cuenta: "ana@ejemplo.org", error: null });
  assert.deepEqual(await sondearClaude(claudeDice({ code: 1, stdout: '{"loggedIn":false}' })), { instalado: true, logueado: false, cuenta: null, error: null });
  const raro = await sondearClaude(claudeDice({ code: 2, stderr: "unknown command: auth\n" }));
  assert.equal(raro.logueado, false);
  assert.equal(raro.error, "unknown command: auth");
  assert.equal((await sondearClaude(claudeDice({ noExiste: true }))).instalado, false);
});

test("estadoCuentas junta los dos y cuentaValida no deja pasar basura", async () => {
  const r = await estadoCuentas({ ...claudeDice({ stdout: '{"loggedIn":true}' }), env: { HILOS_CLAUDE: "/x/claude", HILOS_AGY: FALSO, PATH: BASICO }, correr: async (bin, a, env, t) => (bin === FALSO ? correrReal(bin, a, env, t) : { code: 0, stdout: '{"loggedIn":true}', stderr: "", tiempo: false, noExiste: false }) });
  assert.equal(r.version, 1);
  assert.equal(r.claude.logueado, true);
  assert.equal(r.agy.logueado, true);
  assert.deepEqual(cuentaValida({ instalado: 1, logueado: true, cuenta: 5, error: "" }), { instalado: false, logueado: true, cuenta: null, error: null });
});

const codexDice = (s: Partial<Salida>): Deps => ({
  env: { HILOS_CODEX: "/x/codex" },
  home: tmp,
  correr: async () => ({ code: 0, stdout: "", stderr: "", tiempo: false, noExiste: false, ...s }),
});

test("codex (ChatGPT): conectado, sin sesión, no instalado (lo normal, no un error) y uno que no contesta", async () => {
  assert.deepEqual(await sondearCodex(codexDice({ stderr: "Logged in using ChatGPT\n" })), { instalado: true, logueado: true, cuenta: null, error: null });
  assert.deepEqual(await sondearCodex(codexDice({ code: 1, stderr: "Not logged in\n" })), { instalado: true, logueado: false, cuenta: null, error: null });
  assert.deepEqual(await sondearCodex(codexDice({ noExiste: true })), { instalado: false, logueado: false, cuenta: null, error: null });
  assert.equal((await sondearCodex(codexDice({ tiempo: true }))).error, "codex no contestó a tiempo");
});
