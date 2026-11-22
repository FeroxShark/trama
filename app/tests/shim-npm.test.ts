// destinoShimNpm: el programa al que llama el `.cmd` que deja npm (cmd-shim), para lanzarlo sin cmd.exe (paraLanzar).
import assert from "node:assert/strict";
import { test } from "node:test";
import { destinoShimNpm } from "../electron/binario.ts";

const JS = [
  "@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0", "",
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ") ELSE (", '  SET "_prog=node"', "  SET PATHEXT=%PATHEXT:;.JS;=;%", ")", "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
].join("\r\n");
const EXE = ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0", '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*'].join("\r\n");

test("shim de npm con un .js: el script relativo a la carpeta del .cmd, con node", () => {
  assert.deepEqual(destinoShimNpm("C:\\npm\\claude.cmd", () => JS), { destino: "node_modules\\@anthropic-ai\\claude-code\\cli.js", conNode: true });
});

test("shim de npm con un .exe: el binario, sin node", () => {
  assert.deepEqual(destinoShimNpm("C:\\npm\\claude.cmd", () => EXE), { destino: "node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe", conNode: false });
});

test("un .cmd que no es de npm, o que no se puede leer: null (va por cmd.exe como siempre)", () => {
  assert.equal(destinoShimNpm("C:\\t\\git.cmd", () => '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0\\node.exe" "%~dp0\\git.mjs" %*\r\n'), null);
  assert.equal(destinoShimNpm("C:\\t\\x.cmd", () => null), null);
});
