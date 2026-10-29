// Los envoltorios de motor/bin (pa en bash; reparto, tablero y cuentas en python) corren el .js de app/dist-electron/cli: antes lo
// ponen al día con scripts/asegurar-cli.mjs. Cada prueba arma un repo de mentira (los envoltorios copiados, un app/ con fuentes que
// dicen "<herramienta>-v2" y un dist-electron viejo que dice "-v1") y corre el envoltorio de verdad.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";

const REPO = path.resolve(import.meta.dirname, "../..");
const raiz = mkdtempSync(path.join(os.tmpdir(), "envoltorios-asegurar-"));
after(() => rmSync(raiz, { recursive: true, force: true }));
const HERRAMIENTAS = ["pa", "reparto", "tablero", "cuentas"] as const;
const VIEJO = new Date("2001-01-01T00:00:00Z");

/** Un repo de mentira. `fuentesRotas`: el pa.ts no compila (tsc avisa y el .js viejo tiene que seguir corriendo). */
function armar(nombre: string, { fuentesRotas = false } = {}) {
  const r = path.join(raiz, nombre);
  for (const d of ["motor/bin", "app/scripts", "app/electron/cli", "app/dist-electron/cli"]) mkdirSync(path.join(r, d), { recursive: true });
  for (const h of HERRAMIENTAS) copyFileSync(path.join(REPO, "motor", "bin", h), path.join(r, "motor", "bin", h));
  copyFileSync(path.join(REPO, "app", "scripts", "asegurar-cli.mjs"), path.join(r, "app", "scripts", "asegurar-cli.mjs"));
  for (const h of HERRAMIENTAS) {
    const fuente = h === "pa" && fuentesRotas ? 'const x: number = "no";\nprocess.stdout.write("pa-v2\\n");\n' : `process.stdout.write("${h}-v2\\n");\n`;
    writeFileSync(path.join(r, "app", "electron", "cli", `${h}.ts`), fuente);
    writeFileSync(path.join(r, "app", "dist-electron", "cli", `${h}.js`), `process.stdout.write("${h}-v1\\n");\n`);
    utimesSync(path.join(r, "app", "dist-electron", "cli", `${h}.js`), VIEJO, VIEJO);
  }
  writeFileSync(
    path.join(r, "app", "tsconfig.electron.json"),
    JSON.stringify({ compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", outDir: "dist-electron", rootDir: "electron", types: ["node"], strict: true, skipLibCheck: true }, include: ["electron"] }),
  );
  symlinkSync(path.join(REPO, "app", "node_modules"), path.join(r, "app", "node_modules"), "dir");
  return r;
}

// El entorno de un usuario pelado: PATH para node y bash, y una casa temporal (nada de las variables PA_ o TRAMA_ del que corre la prueba).
const correr = (cmd: string, args: string[], casa: string) => spawnSync(cmd, args, { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: casa, PA_STATE: path.join(casa, "st") } });
const casa = mkdtempSync(path.join(os.tmpdir(), "envoltorios-casa-"));
after(() => rmSync(casa, { recursive: true, force: true }));

test("pa (bash): un .ts más nuevo que el .js recompila antes de correr, en silencio", () => {
  const r = armar("pa");
  const res = correr("bash", [path.join(r, "motor", "bin", "pa"), "--version"], casa);
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "pa-v2\n");
  assert.equal(res.stderr, "");
});

for (const h of ["reparto", "tablero", "cuentas"] as const) {
  test(`${h} (python): un .ts más nuevo que el .js recompila antes de correr, en silencio`, () => {
    const r = armar(h);
    const res = correr("python3", [path.join(r, "motor", "bin", h)], casa);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, `${h}-v2\n`);
    assert.equal(res.stderr, "");
  });
}

test("si tsc no compila, pa avisa por stderr y corre el .js que había", () => {
  const r = armar("roto", { fuentesRotas: true });
  const res = correr("bash", [path.join(r, "motor", "bin", "pa"), "--version"], casa);
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "pa-v1\n");
  assert.match(res.stderr, /no pude recompilar app\/dist-electron/);
});

test("sin asegurar-cli.mjs (un checkout viejo) corre el .js que hay, sin error", () => {
  const r = armar("sin-helper");
  rmSync(path.join(r, "app", "scripts"), { recursive: true, force: true });
  const res = correr("bash", [path.join(r, "motor", "bin", "pa"), "--version"], casa);
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "pa-v1\n");
  assert.equal(res.stderr, "");
});
