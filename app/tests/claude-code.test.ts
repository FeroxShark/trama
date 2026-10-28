// electron/claude-code.ts: las conversaciones de Claude Code que no son de Trama, contra transcripts inventados en un tmp.
// Título (/rename > generado > resumen > primer mensaje), modelo, carpeta, índice cacheado por mtime, y que nunca se escriba un .jsonl.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearIndiceClaudeCode, leerConv, sidsDePa, vistaConvs, type ConvListada } from "../electron/claude-code.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-claude-code-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const proyectos = path.join(tmp, "claude", "projects");
const cwd = path.join(tmp, "casa", "atlas");

const l = (o: Record<string, unknown>) => JSON.stringify({ cwd, ...o }) + "\n";
const usuario = (texto: unknown, extra: Record<string, unknown> = {}) => l({ type: "user", message: { role: "user", content: texto }, ...extra });
const asistente = (modelo: string) => l({ type: "assistant", message: { role: "assistant", model: modelo, content: [{ type: "text", text: "listo" }] } });
const SID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const escribir = (carpeta: string, sid: string, texto: string, mtime?: number) => {
  const dir = path.join(proyectos, carpeta);
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${sid}.jsonl`);
  writeFileSync(f, texto);
  if (mtime) utimesSync(f, mtime / 1000, mtime / 1000);
  return f;
};

test("leerConv: el título sale de /rename, del generado, del resumen o del primer mensaje; se saltea lo que no escribió la persona", () => {
  const caveat = usuario("<local-command-caveat>Caveat</local-command-caveat>", { isMeta: true });
  const comando = usuario("<command-name>/clear</command-name>");
  const primero = usuario([{ type: "text", text: "Arreglá   el login\ny después el logout" }]);
  const base = caveat + comando + primero + asistente("claude-opus-4-5");
  assert.deepEqual(leerConv("a", 5, base, null), { sid: "a", titulo: "Arreglá el login y después el logout", ms: 5, modelo: "claude-opus-4-5", cwd });
  assert.equal(leerConv("a", 5, base + l({ type: "ai-title", aiTitle: "Login roto" }), null)?.titulo, "Login roto");
  assert.equal(leerConv("a", 5, base + l({ type: "ai-title", aiTitle: "Login roto" }) + l({ type: "custom-title", customTitle: "Mi nombre" }), null)?.titulo, "Mi nombre");
  assert.equal(leerConv("a", 5, l({ type: "summary", summary: "Resumen viejo" }) + base, null)?.titulo, "Resumen viejo");
  // El modelo es el último que contestó, sin contar "<synthetic>".
  assert.equal(leerConv("a", 5, base + asistente("claude-sonnet-5-5") + asistente("<synthetic>"), null)?.modelo, "claude-sonnet-5-5");
  // Sin ningún mensaje de la persona, o sin carpeta: no es una conversación.
  assert.equal(leerConv("a", 5, caveat + comando + asistente("x"), null), null);
  assert.equal(leerConv("a", 5, JSON.stringify({ type: "user", message: { content: "hola" } }), null), null);
});

test("leerConv: la cola pisa a la cabeza y la primera línea cortada de la cola no rompe nada", () => {
  const cabeza = usuario("primero") + l({ type: "ai-title", aiTitle: "Viejo" }) + asistente("claude-opus-4-5");
  const cola = '{"type":"assistant","mess' + "\n" + l({ type: "ai-title", aiTitle: "Nuevo" }) + asistente("claude-haiku-5-5");
  const c = leerConv("a", 1, cabeza, cola);
  assert.equal(c?.titulo, "Nuevo");
  assert.equal(c?.modelo, "claude-haiku-5-5");
});

test("listar: lee cabeza y cola, ordena por fecha, junta cuentas con el mismo projects y no relee lo que no cambió", async () => {
  const f1 = escribir("-atlas", SID(1), usuario("Primera") + asistente("claude-opus-4-5"), 1_000_000);
  // Un transcript más grande que cabeza + cola: el título de la cola gana aunque el medio nunca se lea.
  const relleno = l({ type: "attachment", x: "z".repeat(1024) }).repeat(700);
  const f2 = escribir("-atlas", SID(2), usuario("Segunda") + relleno + l({ type: "custom-title", customTitle: "Renombrada" }) + asistente("claude-sonnet-5-5"), 2_000_000);
  escribir("-atlas", SID(3), asistente("claude-opus-4-5"), 3_000_000); // sin mensajes de la persona
  const cuenta = path.join(tmp, "cuenta", "projects");
  mkdirSync(path.dirname(cuenta), { recursive: true });
  symlinkSync(proyectos, cuenta);
  const cache = path.join(tmp, "estado", "claude-code.json");
  const antes = readFileSync(f2, "utf8");
  const mk = () => crearIndiceClaudeCode({ raices: () => [proyectos, cuenta, path.join(tmp, "no-existe")], propia: () => proyectos, cache });
  const a = mk();
  const r1 = await a.listar();
  assert.deepEqual(r1.convs.map((c) => [c.sid, c.titulo, c.ajena]), [[SID(2), "Renombrada", false], [SID(1), "Primera", false]]);
  assert.equal(r1.pasada.archivos, 3);
  assert.equal(r1.pasada.leidos, 3);
  // Segunda pasada, y un proceso nuevo (lee el cache de disco): nada se relee.
  assert.equal((await a.listar()).pasada.leidos, 0);
  assert.equal((await mk().listar()).pasada.leidos, 0);
  // Lo que crece se relee, sólo eso.
  appendFileSync(f1, l({ type: "ai-title", aiTitle: "Con título" }));
  const r3 = await mk().listar();
  assert.equal(r3.pasada.leidos, 1);
  assert.equal(r3.convs.find((c) => c.sid === SID(1))?.titulo, "Con título");
  // Nunca se escribe un transcript ajeno.
  assert.equal(readFileSync(f2, "utf8"), antes);
  // Un transcript que se borra sale del índice.
  rmSync(f1);
  assert.deepEqual((await mk().listar()).convs.map((c) => c.sid), [SID(2)]);
});

test("listar: lo de otra carpeta projects es ajeno", async () => {
  const otra = path.join(tmp, "otra", "projects", "-x");
  mkdirSync(otra, { recursive: true });
  writeFileSync(path.join(otra, `${SID(9)}.jsonl`), usuario("De otra cuenta"));
  const r = await crearIndiceClaudeCode({ raices: () => [proyectos, path.join(tmp, "otra", "projects")], propia: () => proyectos }).listar();
  assert.equal(r.convs.find((c) => c.sid === SID(9))?.ajena, true);
  assert.equal(r.convs.find((c) => c.sid === SID(2))?.ajena, false);
});

test("vistaConvs: saca las de Trama y las de worktrees de pa, y ubica cada una en su proyecto, en General o en otras carpetas", async () => {
  const c = (n: number, dir: string): ConvListada => ({ sid: SID(n), titulo: `t${n}`, ms: n, modelo: null, cwd: dir, ajena: false });
  const casa = path.join(tmp, "casa");
  const convs = [c(1, path.join(casa, "atlas")), c(2, path.join(casa, "atlas", "sub")), c(3, casa), c(4, path.join(tmp, "suelta")), c(5, path.join(casa, "atlas")), c(6, path.join(tmp, "x", "pa", "worktrees", "atlas@1")), c(7, path.join(tmp, "borrada"))];
  const r = await vistaConvs(convs, {
    excluidas: new Set([SID(5)]),
    rutas: [[path.join(casa, "atlas"), "atlas"]],
    casa,
    real: async (p) => p,
    existe: async (p) => !p.endsWith("borrada"),
  });
  assert.deepEqual(r.map((v) => [v.sid, v.proyecto, v.existe]), [
    [SID(1), "atlas", true],
    [SID(2), "atlas", true],
    [SID(3), "general", true],
    [SID(4), null, true],
    [SID(7), null, false],
  ]);
});

test("sidsDePa: los .sid de los workers", async () => {
  const pa = path.join(tmp, "pa");
  mkdirSync(path.join(pa, "atlas"), { recursive: true });
  writeFileSync(path.join(pa, "atlas", "20260101-000000-1.sid"), SID(7) + "\n");
  writeFileSync(path.join(pa, "atlas", "20260101-000000-2.sid"), "no valido!!\n");
  assert.deepEqual([...(await sidsDePa(pa))], [SID(7)]);
});
