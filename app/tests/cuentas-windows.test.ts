// Ajustes > Cuentas en Windows nativo, con la plataforma inyectada (no se puede correr Windows acá): `agy` y `claude` cuentan
// como instalados aunque estén fuera del PATH de la app (`%USERPROFILE%\.local\bin`) o sean un `.cmd` de npm; y ningún texto
// de la interfaz nombra Ubuntu ni WSL.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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

// Ningún `claude` se lanza pelado fuera de `cli/pa/` (que ya usa `resolverClaude`) y de `binario.ts` (que lo define): en Windows el `.exe` o
// `.cmd` está en el prefijo de npm o en `%USERPROFILE%\\.local\\bin`, y sólo `resolverClaude` + `paraLanzar` lo encuentran y lo lanzan.
// (`?? "claude"` suelto es a menudo un id de cuenta o una etiqueta: sólo cuenta el que viene de una variable de entorno, o sea el binario.)
const CLAUDE_PELADO = /(?:HILOS_CLAUDE|process\.env\.\w+|\benv\[[^\]]+\])\s*\?\?\s*["']claude["']|\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(\s*["']claude["']/g;

/** Los `.ts` de `dir` (recursivo), salvo lo que `fuera` descarte. */
function fuentes(dir: string, fuera: (ruta: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (fuera(ruta)) return [];
    return e.isDirectory() ? fuentes(ruta, fuera) : ruta.endsWith(".ts") ? [ruta] : [];
  });
}

/** `archivo:línea: texto` de cada `claude` pelado en `src`. */
export function claudesPelados(archivo: string, src: string): string[] {
  return [...src.matchAll(CLAUDE_PELADO)].map((m) => `${archivo}:${src.slice(0, m.index).split("\n").length}: ${m[0].replace(/\s+/g, " ")}`);
}

test("ningún claude se lanza pelado fuera de cli/pa/ (todos por resolverClaude + paraLanzar)", () => {
  const raiz = path.join(import.meta.dirname, "..", "electron");
  const archivos = fuentes(raiz, (r) => r === path.join(raiz, "cli", "pa") || r === path.join(raiz, "binario.ts"));
  assert.ok(archivos.length > 50, "el recorrido no encontró los fuentes de electron/");
  const malos = archivos.flatMap((a) => claudesPelados(path.relative(path.join(raiz, ".."), a), readFileSync(a, "utf8")));
  assert.deepEqual(malos, [], `claude pelado (usá resolverClaude + paraLanzar):\n${malos.join("\n")}`);
});

test("el chequeo de claude pelado detecta ?? \"claude\" y spawn/execFile con \"claude\" literal, con archivo:línea", () => {
  const malo = 'const a = 1;\nconst id = g.cuenta ?? "claude";\nconst C = process.env.HILOS_CLAUDE ?? "claude";\nexecFile(\n  "claude", []);\nspawn("claude", x);\n';
  assert.deepEqual(claudesPelados("electron/x.ts", malo), ['electron/x.ts:3: process.env.HILOS_CLAUDE ?? "claude"', 'electron/x.ts:4: execFile( "claude"', 'electron/x.ts:6: spawn("claude"']);
  assert.deepEqual(claudesPelados("electron/x.ts", 'const m = "claude"; const c = resolverClaude(env, home); spawn(l.file, l.args);'), []);
});
