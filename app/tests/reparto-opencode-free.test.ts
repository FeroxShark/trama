// El límite gratis de OpenCode ("Free usage limit reached") es de TODA la cuenta: `reparto --opencode-limite` (lo que usa pa al
// cortar) agota el grupo opencode-free entero, y --resumen/--tabla lo muestran SIN CUPO con la hora de vuelta. Salidas fijas, sin red.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPARTO = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-oc-free-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const home = path.join(tmp, "home");
const rep = path.join(tmp, "rep");
mkdirSync(home, { recursive: true });
// opencode falso: lista tres gratis y uno de Go; `run` dice el límite gratis (lo que pasa hoy).
const oc = path.join(tmp, "opencode-falso.sh");
writeFileSync(
  oc,
  `#!/bin/bash
if [[ "$1" == models ]]; then printf 'opencode/beam-free\\nopencode/big-pickle\\nopencode/glm-5.3-flash-free\\nopencode-go/kimi-k2.7\\n'; exit 0; fi
echo "Error: Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models." >&2
exit 1
`,
);
chmodSync(oc, 0o755);

const run = (args: string[], stdin = "") => {
  rmSync(path.join(rep, "enfriado.json"), { force: true });
  return spawnSync("python3", [REPARTO, ...args], {
    encoding: "utf8",
    input: stdin,
    timeout: 60_000,
    env: { ...(process.env as Record<string, string>), HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), REPARTO_STATE: rep, PA_STATE: path.join(tmp, "pa"), HILOS_OPENCODE: oc, REPARTO_CLAUDE: "0" },
  });
};
const horasDeVuelta = () => {
  const ag = JSON.parse(readFileSync(path.join(rep, "agotado.json"), "utf8"));
  return (Date.parse(ag["opencode-free"].hasta) - Date.now()) / 3_600_000;
};
const resumenOpencode = () => run(["--resumen"]).stdout.split("\n").filter((l) => l.includes("-m opencode:opencode/"));

test("sin agotar, los gratis de OpenCode salen con cupo", () => {
  rmSync(rep, { recursive: true, force: true });
  const filas = resumenOpencode();
  assert.equal(filas.length, 3, filas.join("\n"));
  for (const l of filas) assert.doesNotMatch(l, /SIN CUPO/);
});

test("--opencode-limite con 'Free usage limit reached': agota TODO el grupo 24 h y --resumen lo muestra SIN CUPO con la vuelta", () => {
  rmSync(rep, { recursive: true, force: true });
  const r = run(["--opencode-limite"], "\u001b[91mError: \u001b[0mFree usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.\n");
  assert.equal(r.status, 0, r.stderr);
  const h = horasDeVuelta();
  assert.ok(h > 23.9 && h < 24.1, `24 h por defecto, no ${h}`);
  const filas = resumenOpencode();
  assert.equal(filas.length, 3, filas.join("\n"));
  for (const l of filas) {
    assert.match(l, /SIN CUPO \(vuelve en 23 h 5\d min\)|SIN CUPO \(vuelve en 24 h/, l);
    assert.doesNotMatch(l, /cupo 100 ?%/);
  }
  // cualquier gratis figura enfriado por el grupo (pa lo usa para saltear en `-m a,b,c`); uno de Go no
  assert.equal(run(["--enfriado", "opencode:opencode/big-pickle"]).status, 0);
  assert.equal(run(["--enfriado", "opencode-go/kimi-k2.7"]).status, 1);
});

test("con 'retrying in N' el grupo vuelve a esa hora; 'Free usage exceeded' también cuenta", () => {
  rmSync(rep, { recursive: true, force: true });
  assert.equal(run(["--opencode-limite"], "Free usage exceeded, retrying in 90m\n").status, 0);
  const h = horasDeVuelta();
  assert.ok(h > 1.4 && h < 1.6, `1,5 h, no ${h}`);
  assert.match(resumenOpencode()[0], /SIN CUPO \(vuelve en 1 h (2\d|30) min\)/);
});

test("--opencode-limite con otra cosa (un 429 de un modelo, texto cualquiera) no toca el grupo", () => {
  rmSync(rep, { recursive: true, force: true });
  assert.equal(run(["--opencode-limite"], "Too Many Requests: 429\n").status, 1);
  for (const l of resumenOpencode()) assert.doesNotMatch(l, /SIN CUPO/);
});

test("--sondear-opencode: si opencode dice el límite gratis marca el grupo; no corre solo en --resumen", () => {
  rmSync(rep, { recursive: true, force: true });
  resumenOpencode();
  assert.throws(() => readFileSync(path.join(rep, "agotado.json"), "utf8"), "el resumen no sondea");
  const r = run(["--sondear-opencode"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(horasDeVuelta() > 23);
});
