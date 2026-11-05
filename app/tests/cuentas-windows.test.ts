// Ajustes > Cuentas en Windows nativo, con la plataforma inyectada (no se puede correr Windows acá): `agy` y `claude` cuentan
// como instalados aunque estén fuera del PATH de la app (`%USERPROFILE%\.local\bin`) o sean un `.cmd` de npm; y ningún texto
// de la interfaz nombra Ubuntu ni WSL.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hayAgy, hayClaude } from "../electron/capacidades.ts";
import { resolverAgy } from "../electron/binario.ts";
import { estadoCuentas, sondearAgy, type Deps, type Salida } from "../electron/cuentas.ts";

const HOME = "C:\\Users\\gonza";
const ENV = { Path: "C:\\Windows\\System32", APPDATA: `${HOME}\\AppData\\Roaming`, LOCALAPPDATA: `${HOME}\\AppData\\Local` };
const hay = (...ruta: string[]) => (f: string) => ruta.includes(f);
const MODELOS = "gemini-4-argon-high\tGemini 4 Argon (High)\n";
const ok = (stdout: string): Salida => ({ code: 0, stdout, stderr: "", tiempo: false, noExiste: false });

test("Windows: agy.exe en %USERPROFILE%\\.local\\bin (fuera del PATH) cuenta como instalado", () => {
  const exe = `${HOME}\\.local\\bin\\agy.exe`;
  assert.equal(resolverAgy(ENV, HOME, hay(exe), "win32"), exe);
  assert.equal(hayAgy(ENV, HOME, hay(exe), "win32"), true);
  assert.equal(hayAgy(ENV, HOME, hay(), "win32"), false);
});

test("Windows: un agy.cmd de npm (%APPDATA%\\npm) cuenta como instalado y se lanza por cmd.exe", async () => {
  const cmd = `${HOME}\\AppData\\Roaming\\npm\\agy.cmd`;
  assert.equal(resolverAgy(ENV, HOME, hay(cmd), "win32"), cmd);
  const vistos: string[] = [];
  const d: Deps = { env: ENV, home: HOME, plat: "win32", esEjecutable: hay(cmd), correr: async (bin) => (vistos.push(bin), ok(MODELOS)) };
  assert.deepEqual(await sondearAgy(d), { instalado: true, logueado: true, cuenta: null, error: null });
  assert.deepEqual(vistos, [cmd]);
});

test("Windows: agy en el PATH de la app y claude.exe en .local\\bin se detectan; sin nada, no instalados", async () => {
  const agy = "C:\\Tools\\agy.exe";
  const claude = `${HOME}\\.local\\bin\\claude.exe`;
  const env = { ...ENV, Path: "C:\\Windows\\System32;C:\\Tools" };
  assert.equal(hayAgy(env, HOME, hay(agy), "win32"), true);
  assert.equal(hayClaude(env, HOME, hay(claude), "win32"), true);
  const d = (e: (f: string) => boolean): Deps => ({ env, home: HOME, plat: "win32", esEjecutable: e, correr: async (bin) => ({ ...ok(""), noExiste: true, code: null, stdout: bin }) });
  const sin = await estadoCuentas(d(hay()));
  assert.equal(sin.agy.instalado, false);
  assert.equal(sin.claude.instalado, false);
});

test("la interfaz no nombra Ubuntu ni WSL en Cuentas (es ni en)", () => {
  for (const idioma of ["es", "en"]) {
    const src = readFileSync(new URL(`../src/i18n/${idioma}.ts`, import.meta.url), "utf8");
    for (const clave of ["ajustes.cuentasIntro", "ajustes.ctaNoInstalada"]) {
      const linea = src.split("\n").find((l) => l.includes(`"${clave}"`)) ?? "";
      assert.ok(linea, `falta ${clave} en ${idioma}`);
      assert.doesNotMatch(linea, /ubuntu|wsl/i, `${clave} (${idioma}) nombra Ubuntu o WSL`);
    }
  }
});
