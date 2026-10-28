// src/barra/claude-code.ts: a qué carpeta de la barra va cada conversación de Claude Code, el buscador y las carpetas que faltan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { carpetaCorta, carpetasExtra, carpetaDe, claveClaude, filtrarClaude, OTRAS, repartirClaude } from "../src/barra/claude-code.ts";
import { convsClaudeCodeDe, type ConvClaudeCode } from "../src/datos/contrato.ts";

const c = (sid: string, titulo: string, ms: number, proyecto: string | null, cwd = "/home/ana/atlas"): ConvClaudeCode => ({ sid, titulo, ms, modelo: null, cwd, proyecto, existe: true, ajena: false });

test("repartirClaude: cada una en su carpeta (Otras carpetas sin proyecto), sin las que ya son líderes, la más reciente primero", () => {
  const convs = [c("a", "uno", 1, "atlas"), c("b", "dos", 9, "atlas"), c("c", "tres", 5, null, "/tmp/x"), c("d", "cuatro", 7, "general", "/home/ana"), c("e", "cinco", 3, "atlas")];
  const r = repartirClaude(convs, new Set(["e"]));
  assert.deepEqual(r.get("atlas")?.map((x) => x.sid), ["b", "a"]);
  assert.deepEqual(r.get(OTRAS)?.map((x) => x.sid), ["c"]);
  assert.deepEqual(r.get("general")?.map((x) => x.sid), ["d"]);
  assert.equal(carpetaDe(convs[2]), OTRAS);
  assert.equal(claveClaude("atlas"), "claude:atlas");
});

test("filtrarClaude: todas las palabras, sin tildes ni mayúsculas, en el título o en la carpeta", () => {
  const convs = [c("a", "Migrar el webhook de pagos", 1, "atlas"), c("b", "Revisión del diseño", 2, null, "/home/ana/fotos")];
  assert.deepEqual(filtrarClaude(convs, "").map((x) => x.sid), ["a", "b"]);
  assert.deepEqual(filtrarClaude(convs, "WEBHOOK pagos").map((x) => x.sid), ["a"]);
  assert.deepEqual(filtrarClaude(convs, "revision").map((x) => x.sid), ["b"]);
  assert.deepEqual(filtrarClaude(convs, "fotos").map((x) => x.sid), ["b"]);
  assert.deepEqual(filtrarClaude(convs, "webhook fotos"), []);
});

test("carpetasExtra: las carpetas con conversaciones que la barra no tiene, la más reciente primero y Otras carpetas al final", () => {
  const r = repartirClaude([c("a", "x", 5, "atlas"), c("b", "y", 9, "brote"), c("c", "z", 20, null), c("d", "w", 1, "general"), c("e", "v", 2, "cauce")], new Set());
  assert.deepEqual(carpetasExtra(r, new Set(["cauce"])), ["brote", "atlas", OTRAS]);
  assert.deepEqual(carpetasExtra(r, new Set(["atlas", "brote", "cauce"])), [OTRAS]);
});

test("carpetaCorta: el último tramo, con barras de Linux o de Windows", () => {
  assert.equal(carpetaCorta("/home/ana/atlas"), "atlas");
  assert.equal(carpetaCorta("C:\\Users\\ana\\atlas\\"), "atlas");
  assert.equal(carpetaCorta("/"), "/");
});

test("convsClaudeCodeDe: valida lo que llega del main y descarta lo que no tiene forma", () => {
  const r = convsClaudeCodeDe([
    { sid: "a", titulo: "t", ms: 5, cwd: "/x", modelo: "claude-opus-5-5", proyecto: "atlas", existe: false, ajena: true },
    { sid: "b", titulo: "t", ms: 5, cwd: "/y" },
    { sid: 7, titulo: "t", ms: 5, cwd: "/y" },
    null,
  ]);
  assert.deepEqual(r, [
    { sid: "a", titulo: "t", ms: 5, cwd: "/x", modelo: "claude-opus-5-5", proyecto: "atlas", existe: false, ajena: true },
    { sid: "b", titulo: "t", ms: 5, cwd: "/y", modelo: null, proyecto: null, existe: true, ajena: false },
  ]);
  assert.deepEqual(convsClaudeCodeDe("x"), []);
});
