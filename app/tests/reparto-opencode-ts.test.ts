// `reparto --opencode-limite` (lee la salida de OpenCode por stdin) y `--sondear-opencode` (un pedido mínimo a un modelo gratis) del port
// TS (electron/cli/reparto.ts): el límite gratis de OpenCode agota el grupo opencode-free entero. El sondeo corre un `opencode` falso
// de shell (sólo POSIX). Sin red ni cupo real: REPARTO_AHORA fija la hora.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { soloPosix } from "./plataforma.ts";

const REPARTO = path.join(import.meta.dirname, "..", "electron", "cli", "reparto.ts");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-oc-ts-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const AHORA = "2026-10-26T12:00:00Z";
const rep = path.join(tmp, "rep");
const agotado = path.join(rep, "agotado.json");
const oc = path.join(tmp, "opencode-falso");

/** `opencode` falso: `models` lista dos gratis; `run` escribe su argv en <tmp>/argv.txt y dice `respuesta` (por stderr si `error`). */
function opencodeFalso(respuesta: string, error: boolean) {
  const salida = error ? `echo "${respuesta}" >&2` : `echo "${respuesta}"`;
  writeFileSync(
    oc,
    `#!/bin/sh\nif [ "$1" = models ]; then echo opencode/big-pickle; echo opencode/glm-5.3-flash-free; exit 0; fi\necho "$*" > "${tmp}/argv.txt"\n${salida}\nexit ${error ? 1 : 0}\n`,
  );
  chmodSync(oc, 0o755);
}

const run = (args: string[], o: { stdin?: string; oc?: string } = {}) => {
  rmSync(rep, { recursive: true, force: true });
  return spawnSync(process.execPath, [REPARTO, ...args], {
    encoding: "utf8",
    input: o.stdin ?? "",
    timeout: 60_000,
    env: {
      ...(process.env as Record<string, string>),
      HOME: path.join(tmp, "home"),
      REPARTO_STATE: rep,
      REPARTO_AHORA: AHORA,
      TRAMA_MODELOS: path.join(tmp, "no-modelos.json"),
      REPARTO_CLAUDE: "0",
      REPARTO_CODEX: "0",
      REPARTO_OPENCODE_FIJO: JSON.stringify(["opencode/big-pickle", "opencode/glm-5.3-flash-free"]),
      HILOS_OPENCODE: o.oc ?? oc,
    },
  });
};
/** Horas entre `AHORA` y la vuelta que quedó escrita para el grupo opencode-free. */
const horasDeVuelta = () => (Date.parse(JSON.parse(readFileSync(agotado, "utf8"))["opencode-free"].hasta) - Date.parse(AHORA)) / 3_600_000;

test("--opencode-limite: 'Free usage limit' por stdin agota el grupo opencode-free 24 h", () => {
  const r = run(["--opencode-limite"], { stdin: "Error: Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going.\n" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(horasDeVuelta(), 24);
});

test("--opencode-limite: con 'retrying in N' vuelve a esa hora; 'Free usage exceeded' también cuenta", () => {
  assert.equal(run(["--opencode-limite"], { stdin: "Free usage exceeded, retrying in 90m\n" }).status, 0);
  assert.equal(horasDeVuelta(), 1.5);
  assert.equal(run(["--opencode-limite"], { stdin: "Free usage limit: retrying in 0.5 minutes\n" }).status, 0);
  assert.equal(horasDeVuelta(), 1 / 60, "nunca menos de un minuto");
});

test("--opencode-limite: otra cosa (un 429 de un modelo) sale 1 y no marca nada", () => {
  const r = run(["--opencode-limite"], { stdin: "Too Many Requests: 429\n" });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(existsSync(agotado), false);
});

test("--sondear-opencode: si opencode dice el límite gratis marca el grupo (0), con un pedido `run … OK` al modelo gratis", { skip: soloPosix("el opencode falso es un script de shell") }, () => {
  opencodeFalso("Error: Free usage limit reached.", true);
  const r = run(["--sondear-opencode"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(horasDeVuelta(), 24);
  assert.equal(readFileSync(path.join(tmp, "argv.txt"), "utf8").trim(), "run -m opencode/glm-5.3-flash-free OK");
});

test("--sondear-opencode: si opencode contesta, el grupo no se toca (1)", { skip: soloPosix("el opencode falso es un script de shell") }, () => {
  opencodeFalso("OK", false);
  const r = run(["--sondear-opencode"]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^opencode contesta: el grupo opencode-free no se toca$/m);
  assert.equal(existsSync(agotado), false);
});

test("--sondear-opencode sin opencode instalado sale 2", () => {
  const r = run(["--sondear-opencode"], { oc: path.join(tmp, "no-existe") });
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /^reparto: opencode no está instalado$/m);
});
