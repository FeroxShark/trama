// hallarAgy / hallarClaude (binario.ts) con la plataforma win32 simulada y un disco falso: agy.cmd del prefijo de npm fuera del PATH y
// agy.exe de %LOCALAPPDATA%\Programs\Antigravity\bin. Sin el resolvedor compartido, trama-estado y cuentas sólo miraban el PATH y
// las carpetas de Linux, y Gemini figuraba como no instalado en Windows.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { hallarAgy, hallarClaude } from "../electron/binario.ts";
import { primeraLineaError } from "../electron/cli/trama-estado.ts";

const HOME = "C:\\Users\\ana";
const LOCAL = "C:\\Users\\ana\\AppData\\Local";
const APPDATA = "C:\\Users\\ana\\AppData\\Roaming";
const env = { PATH: "C:\\Windows\\System32;C:\\Program Files\\nodejs", USERPROFILE: HOME, LOCALAPPDATA: LOCAL, APPDATA, PATHEXT: ".COM;.EXE;.BAT;.CMD" };

/** Un disco falso: sólo existen estos archivos (en Windows se compara sin distinguir mayúsculas). */
const disco = (...archivos: string[]) => {
  const s = new Set(archivos.map((a) => a.toLowerCase()));
  return (f: string) => s.has(f.toLowerCase());
};

test("win32: agy.exe en %LOCALAPPDATA%\\Programs\\Antigravity\\bin, fuera del PATH", () => {
  const exe = path.win32.join(LOCAL, "Programs", "Antigravity", "bin", "agy.exe");
  assert.equal(hallarAgy(env, HOME, disco(exe), "win32"), exe);
});

test("win32: agy.cmd del prefijo de npm (%APPDATA%\\npm), fuera del PATH", () => {
  const cmd = path.win32.join(APPDATA, "npm", "agy.cmd");
  assert.equal(hallarAgy(env, HOME, disco(cmd), "win32"), cmd);
});

test("win32: el PATH gana sobre las carpetas extra y no hay agy → null (no el nombre pelado)", () => {
  const enPath = path.win32.join("C:\\Windows\\System32", "agy.cmd");
  assert.equal(hallarAgy(env, HOME, disco(enPath), "win32"), enPath);
  assert.equal(hallarAgy(env, HOME, disco(), "win32"), null);
});

test("win32: claude.exe en %USERPROFILE%\\.local\\bin se encuentra aunque no esté en el PATH", () => {
  const exe = path.win32.join(HOME, ".local", "bin", "claude.exe");
  assert.equal(hallarClaude(env, HOME, disco(exe), "win32"), exe);
  assert.equal(hallarClaude(env, HOME, disco(), "win32"), null);
});

test("primeraLineaError: primera línea, sin color, sin tokens y recortada", () => {
  assert.equal(primeraLineaError("\n\u001b[31mfalta login\u001b[0m\nsegunda\n"), "falta login");
  assert.equal(primeraLineaError("token ghp_abcdefghijklmnopqrstuvwxyz0123456789 de prueba"), "token … de prueba");
  assert.equal(primeraLineaError("palabra ".repeat(60)).length, 160);
  assert.equal(primeraLineaError("   \n  "), "");
});
