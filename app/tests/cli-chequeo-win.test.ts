// chequearAgy / chequearCodex con la plataforma win32 simulada: nada de `shell: true` (DEP0190), el `.cmd` de npm va por
// `cmd.exe /d /s /c` con comillas, el plugin pa-worker se intenta reparar y el aviso nunca manda a un .sh.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { spawnSync } from "node:child_process";
import { chequearAgy, chequearCodex } from "../electron/cli/pa/motores/chequeo.ts";

type Llamada = { file: string; args: string[]; opciones: Record<string, unknown> };

function mundo() {
  const r = realpathSync(mkdtempSync(path.join(os.tmpdir(), "chequeo-win-")));
  const proy = path.join(r, "proy");
  mkdirSync(proy);
  const reg = path.join(r, "registry.json");
  writeFileSync(reg, JSON.stringify({ projects: [{ name: "demo", path: proy }] }));
  return { env: { HOME: path.join(r, "home"), PATH: "", PROYECTOS_REGISTRY: reg, TRAMA_CLAVES: path.join(r, "claves.env") } };
}

/** Un `spawnSync` falso que anota la llamada y contesta con `salidas` en orden. */
function falso(salidas: string[], status = 0) {
  const llamadas: Llamada[] = [];
  const f = ((file: string, args: string[], opciones: Record<string, unknown>) => {
    llamadas.push({ file, args, opciones });
    return { status, stdout: salidas[Math.min(llamadas.length - 1, salidas.length - 1)] ?? "", stderr: "", signal: null, pid: 1, output: [] };
  }) as unknown as typeof spawnSync;
  return { f, llamadas };
}

const CARGADO = JSON.stringify({ command: { data: { hooks: [{ name: "pa-worker", actions: [{ event: "PreToolUse" }] }] } } });
const VACIO = JSON.stringify({ command: { data: { hooks: [] } } });
const AGY_CMD = "C:\\Users\\ana\\AppData\\Roaming\\npm\\agy.cmd";

test("chequearAgy en win32: agy.cmd va por cmd.exe /d /s /c, sin shell de Node", () => {
  const m = mundo();
  const { f, llamadas } = falso([CARGADO]);
  const r = chequearAgy({ proyecto: "demo", tarea: "nada", env: m.env, plat: "win32", spawn: f, buscar: () => AGY_CMD });
  assert.equal(r, "");
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0]!.file, /cmd\.exe$/i);
  assert.deepEqual(llamadas[0]!.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(llamadas[0]!.args[3]!, /agy\.cmd -p \/hooks --output-format json"$/);
  assert.equal(llamadas[0]!.opciones.windowsVerbatimArguments, true);
  assert.ok(!("shell" in llamadas[0]!.opciones), "sin shell: true");
});

test("chequearAgy en win32: un agy.exe va directo, sin cmd.exe ni shell", () => {
  const m = mundo();
  const { f, llamadas } = falso([CARGADO]);
  assert.equal(chequearAgy({ proyecto: "demo", tarea: "nada", env: m.env, plat: "win32", spawn: f, buscar: () => "C:\\Tools\\agy.exe" }), "");
  assert.equal(llamadas[0]!.file, "C:\\Tools\\agy.exe");
  assert.deepEqual(llamadas[0]!.args, ["-p", "/hooks", "--output-format", "json"]);
  assert.ok(!("shell" in llamadas[0]!.opciones));
});

test("chequearAgy en win32: sin plugin intenta repararlo, vuelve a mirar y, si queda, el aviso no sugiere un .sh", () => {
  const m = mundo();
  let reparos = 0;
  const { f, llamadas } = falso([VACIO, CARGADO]);
  assert.equal(chequearAgy({ proyecto: "demo", tarea: "nada", env: m.env, plat: "win32", spawn: f, buscar: () => AGY_CMD, repararPlugin: () => reparos++ }), "");
  assert.equal(reparos, 1);
  assert.equal(llamadas.length, 2);

  const otro = falso([VACIO]);
  const motivo = chequearAgy({ proyecto: "demo", tarea: "nada", env: m.env, plat: "win32", spawn: otro.f, buscar: () => AGY_CMD, repararPlugin: () => {} });
  assert.match(motivo, /plugin pa-worker de agy no está cargado/);
  assert.doesNotMatch(motivo, /\.sh/);
  assert.equal(otro.llamadas.length, 2);
});

test("chequearAgy en linux: no repara nada y el aviso es el de siempre (instalar-producto.sh)", () => {
  const m = mundo();
  let reparos = 0;
  const { f, llamadas } = falso([VACIO]);
  const motivo = chequearAgy({ proyecto: "demo", tarea: "nada", env: m.env, plat: "linux", spawn: f, buscar: () => "/usr/bin/agy", repararPlugin: () => reparos++ });
  assert.equal(motivo, "el plugin pa-worker de agy no está cargado (sin él no hay guardias: correr motor/scripts/instalar-producto.sh)");
  assert.equal(reparos, 0);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0]!.file, "/usr/bin/agy");
});

test("chequearCodex en win32: codex.cmd por cmd.exe, sin shell", () => {
  const m = mundo();
  const { f, llamadas } = falso([""], 0);
  assert.equal(chequearCodex({ proyecto: "demo", tarea: "x", env: m.env, plat: "win32", spawn: f, buscar: () => "C:\\Users\\ana\\AppData\\Roaming\\npm\\codex.cmd" }), "");
  assert.match(llamadas[0]!.file, /cmd\.exe$/i);
  assert.match(llamadas[0]!.args[3]!, /codex\.cmd login status"$/);
  assert.ok(!("shell" in llamadas[0]!.opciones));
});
