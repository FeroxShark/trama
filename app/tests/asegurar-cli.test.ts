// scripts/asegurar-cli.mjs: antes de correr un CLI de app/dist-electron (motor/bin/pa, reparto, tablero, cuentas) lo pone al día si
// app/electron tiene fuentes más nuevas. Cada prueba arma su propio app/ en una carpeta temporal (con el helper copiado y el
// node_modules del repo enlazado) para no tocar el dist-electron de verdad.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import { recompilarDistElectron } from "../electron/cli/pa/ramas.ts";

const HELPER = path.resolve(import.meta.dirname, "../scripts/asegurar-cli.mjs");
const NODE_MODULES = path.resolve(import.meta.dirname, "../node_modules");
const raiz = mkdtempSync(path.join(os.tmpdir(), "asegurar-cli-"));
after(() => rmSync(raiz, { recursive: true, force: true }));

const VIEJO = new Date("2001-01-01T00:00:00Z");

/** Un app/ de mentira: el helper, un dist-electron/cli/pa.js viejo ("v1") y, si hay fuentes, un pa.ts que exporta "v2". */
function armar(nombre: string, { fuentes = true } = {}) {
  const app = path.join(raiz, nombre, "app");
  mkdirSync(path.join(app, "scripts"), { recursive: true });
  copyFileSync(HELPER, path.join(app, "scripts", "asegurar-cli.mjs"));
  mkdirSync(path.join(app, "dist-electron", "cli"), { recursive: true });
  writeFileSync(path.join(app, "dist-electron", "cli", "pa.js"), "// v1\n");
  if (fuentes) {
    mkdirSync(path.join(app, "electron", "cli"), { recursive: true });
    writeFileSync(path.join(app, "electron", "cli", "pa.ts"), 'export const v = "v2";\n');
    writeFileSync(
      path.join(app, "tsconfig.electron.json"),
      JSON.stringify({ compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", outDir: "dist-electron", rootDir: "electron", types: [], strict: true, skipLibCheck: true }, include: ["electron"] }),
    );
    symlinkSync(NODE_MODULES, path.join(app, "node_modules"), "dir");
  }
  return app;
}

const dist = (app: string) => path.join(app, "dist-electron", "cli", "pa.js");
const leer = (f: string) => readFileSync(f, "utf8");
const correr = (app: string, ...args: string[]) => spawnSync(process.execPath, [path.join(app, "scripts", "asegurar-cli.mjs"), ...args], { encoding: "utf8" });

test("un .js más nuevo que las fuentes no se toca: ni compila ni dice nada", () => {
  const app = armar("al-dia");
  utimesSync(path.join(app, "electron", "cli", "pa.ts"), VIEJO, VIEJO);
  utimesSync(path.join(app, "tsconfig.electron.json"), VIEJO, VIEJO);
  const r = correr(app, dist(app));
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, "");
  assert.equal(leer(dist(app)), "// v1\n");
});

test("un .ts más nuevo que el .js recompila en silencio", () => {
  const app = armar("stale");
  utimesSync(dist(app), VIEJO, VIEJO);
  const r = correr(app, dist(app));
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, "");
  assert.match(leer(dist(app)), /"v2"/);
});

test("si tsc no compila avisa por stderr, sale 0 y el .js que había sigue", () => {
  const app = armar("roto");
  writeFileSync(path.join(app, "electron", "cli", "pa.ts"), 'export const v: number = "x";\n');
  utimesSync(dist(app), VIEJO, VIEJO);
  const r = correr(app, dist(app));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /no pude recompilar app\/dist-electron/);
  assert.equal(leer(dist(app)), "// v1\n");
});

test("un .js fuera de app/dist-electron (p. ej. TRAMA_PA_JS) no se toca aunque las fuentes sean más nuevas", () => {
  const app = armar("fuera");
  const otro = path.join(raiz, "fuera", "otro", "pa.js");
  mkdirSync(path.dirname(otro), { recursive: true });
  writeFileSync(otro, "// otro\n");
  utimesSync(otro, VIEJO, VIEJO);
  const r = correr(app, otro);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.equal(leer(dist(app)), "// v1\n");
  assert.equal(leer(otro), "// otro\n");
});

test("sin fuentes (un Trama instalado) no hace nada, ni con --recompilar", () => {
  const app = armar("instalado", { fuentes: false });
  assert.equal(correr(app, dist(app)).status, 0);
  const r = correr(app, "--recompilar");
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, "");
  assert.equal(leer(dist(app)), "// v1\n");
});

test("--recompilar compila aunque el .js parezca al día", () => {
  const app = armar("forzado");
  utimesSync(path.join(app, "electron", "cli", "pa.ts"), VIEJO, VIEJO);
  utimesSync(path.join(app, "tsconfig.electron.json"), VIEJO, VIEJO);
  const r = correr(app, "--recompilar");
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.match(leer(dist(app)), /"v2"/);
});

test("un candado viejo (de un proceso muerto) se saca y se compila igual", () => {
  const app = armar("candado-viejo");
  utimesSync(dist(app), VIEJO, VIEJO);
  const candado = path.join(app, "dist-electron", ".compilar.lock");
  mkdirSync(candado);
  utimesSync(candado, VIEJO, VIEJO);
  const r = correr(app, dist(app));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.match(leer(dist(app)), /"v2"/);
  assert.equal(existsSync(candado), false);
});

test("dos recompilaciones a la vez: una compila, la otra espera y no vuelve a compilar; no queda candado", async () => {
  const app = armar("dos-a-la-vez");
  utimesSync(dist(app), VIEJO, VIEJO);
  const lanzar = () =>
    new Promise<{ code: number | null; err: string }>((resolver) => {
      let err = "";
      const h = spawn(process.execPath, [path.join(app, "scripts", "asegurar-cli.mjs"), dist(app)], { stdio: ["ignore", "ignore", "pipe"] });
      h.stderr.on("data", (d) => (err += d));
      h.on("close", (code) => resolver({ code, err }));
    });
  const [a, b] = await Promise.all([lanzar(), lanzar()]);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.equal(a.err + b.err, "");
  assert.match(leer(dist(app)), /"v2"/);
  assert.equal(existsSync(path.join(app, "dist-electron", ".compilar.lock")), false);
});

test("pa --integrar (recompilarDistElectron) recompila el dist-electron del repo que tiene app/", async () => {
  const ruta = path.dirname(armar("integrar"));
  await recompilarDistElectron(ruta);
  assert.match(leer(dist(path.join(ruta, "app"))), /"v2"/);
});

test("pa --integrar en un repo sin app/tsconfig.electron.json no compila nada", async () => {
  const ruta = path.dirname(armar("sin-tsconfig", { fuentes: false }));
  await recompilarDistElectron(ruta);
  assert.equal(leer(dist(path.join(ruta, "app"))), "// v1\n");
});
