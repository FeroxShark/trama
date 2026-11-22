// enPath en Windows: npm deja en su prefijo `opencode` (script para bash, sin extensión) al lado de `opencode.cmd`. Windows no puede
// ejecutar el primero; tiene que ganar el `.cmd`. Con archivos de verdad, así que corre sólo en Windows (el CI de Windows).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { enPath } from "../electron/cli/base/buscar.ts";

const win = process.platform === "win32";

test("Windows: un nombre suelto nunca resuelve al archivo sin extensión; gana el de PATHEXT", { skip: win ? false : "sólo Windows (archivos de verdad)" }, () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "buscar-win-"));
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, "opencode"), "#!/bin/sh\n");
  writeFileSync(path.join(d, "opencode.cmd"), "@echo off\r\n");
  const env = { PATH: d, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  // Windows no distingue mayúsculas: enPath arma `opencode` + `.CMD` de PATHEXT.
  const en = (n: string) => enPath(n, [], env, "win32")?.toLowerCase() ?? null;
  assert.equal(en("opencode"), path.join(d, "opencode.cmd").toLowerCase());
  // con carpeta, igual
  assert.equal(en(path.join(d, "opencode")), path.join(d, "opencode.cmd").toLowerCase());
  // si ya trae la extensión, vale tal cual
  assert.equal(en("opencode.cmd"), path.join(d, "opencode.cmd").toLowerCase());
  // sólo el script sin extensión: no hay nada que Windows pueda ejecutar
  writeFileSync(path.join(d, "solo"), "#!/bin/sh\n");
  assert.equal(en("solo"), null);
});
