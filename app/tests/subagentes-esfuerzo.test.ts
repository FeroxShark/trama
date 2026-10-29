import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { conHerencia, cwdDe, definicionDe, frontmatterDe, leerCarpeta, leerSubagente, liderEn } from "../electron/subagentes.ts";

// Esfuerzo y modelo de un subagente: de dónde sale (la llamada Agent, su transcript, su definición, el líder).
const temporal = () => mkdtempSync(path.join(tmpdir(), "trama-subagentes-esf-"));
const USO = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10 };
const linea = (o: object) => JSON.stringify(o) + "\n";
const T0 = "2026-10-24T10:00:00.000Z";
const epoch = (iso: string) => Date.parse(iso) / 1000;

/** Primer mensaje del subagente: el pedido, con su carpeta de trabajo como las líneas reales de Claude Code. */
const pedido = (ts: string, cwd = "/proyecto/prueba") => linea({ type: "user", timestamp: ts, cwd, message: { role: "user", content: "contá hasta tres" } });
/** Una respuesta del subagente con su esfuerzo en la línea (campo `effort` de primer nivel), como lo escribe Claude Code. */
const respuesta = (ts: string, extra: { effort?: string; model?: string } = {}) =>
  linea({
    type: "assistant",
    timestamp: ts,
    ...(extra.effort ? { effort: extra.effort } : {}),
    message: { model: extra.model ?? "claude-haiku-5-5", stop_reason: "tool_use", usage: USO, content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] },
  });
/** Una línea del líder (su transcript): respuesta cerrada, con su esfuerzo y modelo. */
const DelLider = (ts: string, extra: { effort?: string; model?: string; sidechain?: boolean } = {}) =>
  linea({
    type: "assistant",
    timestamp: ts,
    ...(extra.effort ? { effort: extra.effort } : {}),
    ...(extra.sidechain ? { isSidechain: true } : {}),
    message: { model: extra.model ?? "claude-opus-5-5", stop_reason: "end_turn", usage: USO, content: [{ type: "text", text: "listo" }] },
  });

test("cwd: sale de la línea del subagente, con las barras de Windows escapadas", () => {
  assert.equal(cwdDe(linea({ cwd: "C:\\Users\\ferox\\proy" })), "C:\\Users\\ferox\\proy");
  assert.equal(cwdDe(linea({ cwd: "/home/ferox/proy" })), "/home/ferox/proy");
  assert.equal(cwdDe(linea({ type: "user" })), null);
});

test("la cabecera de una definición: clave: valor, con comillas, CRLF y BOM; sin cabecera, nada", () => {
  assert.deepEqual(frontmatterDe("\uFEFF---\r\nname: revisor\r\neffort: \"high\"\r\nmodel: sonnet\r\n---\r\nCuerpo\r\nmodel: otro\r\n"), {
    name: "revisor",
    effort: "high",
    model: "sonnet",
  });
  assert.deepEqual(frontmatterDe("Sin cabecera\neffort: high\n"), {});
});

test("la definición del agente: gana la del proyecto; model inherit no fija nada; un tipo raro no busca archivo", async () => {
  const cwd = temporal();
  const home = temporal();
  try {
    mkdirSync(path.join(cwd, ".claude", "agents"), { recursive: true });
    mkdirSync(path.join(home, ".claude", "agents"), { recursive: true });
    writeFileSync(path.join(cwd, ".claude", "agents", "revisor.md"), "---\neffort: high\nmodel: inherit\n---\nCuerpo\n");
    writeFileSync(path.join(home, ".claude", "agents", "revisor.md"), "---\neffort: low\nmodel: haiku\n---\n");
    writeFileSync(path.join(home, ".claude", "agents", "solo-usuario.md"), "---\neffort: medium\nmodel: claude-opus-5-5\n---\n");
    assert.deepEqual(await definicionDe(cwd, "revisor", home), { modelo: null, esfuerzo: "high" });
    assert.deepEqual(await definicionDe(null, "solo-usuario", home), { modelo: "claude-opus-5-5", esfuerzo: "medium" });
    assert.deepEqual(await definicionDe(cwd, "sin-archivo", home), {});
    assert.deepEqual(await definicionDe(cwd, "caveman:cavecrew-reviewer", home), {});
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("el esfuerzo: lo de la llamada Agent manda; después lo que corrió; después la definición; si nada, ninguno", () => {
  const cola = pedido(T0) + respuesta("2026-10-24T10:00:03.000Z", { effort: "low" });
  const con = (meta: object, texto: string, def = {}) => leerSubagente("s1", "a1", { agentType: "revisor", description: "d", ...meta }, pedido(T0), texto, 0, def);
  assert.equal(con({ effort: "xhigh" }, cola, { esfuerzo: "high" }).esfuerzo, "xhigh");
  assert.equal(con({}, cola, { esfuerzo: "high" }).esfuerzo, "low");
  assert.equal(con({}, pedido(T0), { esfuerzo: "high" }).esfuerzo, "high");
  assert.equal(con({}, pedido(T0)).esfuerzo, null);
});

test("el modelo: el de su último mensaje; si no hay, el que pidió la llamada, o el de su definición", () => {
  const con = (meta: object, texto: string, def = {}) => leerSubagente("s1", "a1", { agentType: "revisor", description: "d", ...meta }, pedido(T0), texto, 0, def);
  assert.equal(con({ model: "haiku" }, pedido(T0) + respuesta("2026-10-24T10:00:03.000Z")).modelo, "Haiku 5.5");
  assert.equal(con({ model: "haiku" }, pedido(T0)).modelo, "haiku");
  assert.equal(con({}, pedido(T0), { modelo: "claude-sonnet-5-5" }).modelo, "Sonnet 5.5");
  assert.equal(con({}, pedido(T0)).modelo, null);
});

test("el líder: con qué esfuerzo y modelo lanzó al subagente (lo último antes de su hora; no lo de sus subagentes ni lo de después)", () => {
  const texto =
    DelLider("2026-10-24T09:58:00.000Z", { effort: "low", model: "claude-haiku-5-5" }) +
    DelLider("2026-10-24T09:59:00.000Z", { effort: "medium" }) +
    DelLider("2026-10-24T09:59:30.000Z", { effort: "max", sidechain: true }) +
    DelLider("2026-10-24T09:59:50.000Z", { model: "<synthetic>" }) +
    DelLider("2026-10-24T10:05:00.000Z", { effort: "xhigh" });
  assert.deepEqual(liderEn(texto, epoch(T0)), { modelo: "Opus 5.5", esfuerzo: "medium" });
  assert.deepEqual(liderEn(texto, epoch("2026-10-24T09:00:00.000Z")), { modelo: null, esfuerzo: null });
});

test("lo que al subagente le falta lo pone el del líder, marcado como heredado; lo que dijo él no se toca", () => {
  const base = leerSubagente("s1", "a1", { agentType: "Explore", description: "d" }, pedido(T0), pedido(T0), 0);
  assert.deepEqual([base.modelo, base.esfuerzo], [null, null]);
  const h = conHerencia(base, { modelo: "Opus 5.5", esfuerzo: "medium" });
  assert.deepEqual([h.modelo, h.modelo_heredado, h.esfuerzo, h.esfuerzo_heredado], ["Opus 5.5", true, "medium", true]);
  const propio = conHerencia({ ...base, modelo: "Haiku 5.5", esfuerzo: "high" }, { modelo: "Opus 5.5", esfuerzo: "medium" });
  assert.deepEqual([propio.modelo, propio.modelo_heredado, propio.esfuerzo, propio.esfuerzo_heredado], ["Haiku 5.5", undefined, "high", undefined]);
});

test("leerCarpeta: sin esfuerzo en la llamada, toma el de su definición; sin nada, el del líder marcado como heredado", async () => {
  const cwd = temporal();
  try {
    const dir = path.join(cwd, "sesion-prueba", "subagents");
    mkdirSync(dir, { recursive: true });
    mkdirSync(path.join(cwd, ".claude", "agents"), { recursive: true });
    // Un nombre de tipo que no existe en ninguna casa: la definición sólo sale de la del proyecto de este test.
    writeFileSync(path.join(cwd, ".claude", "agents", "trama-prueba-revisor.md"), "---\neffort: high\nmodel: haiku\n---\n");
    writeFileSync(path.join(dir, "agent-revisa1.jsonl"), pedido("2026-10-24T10:00:00.000Z", cwd));
    writeFileSync(path.join(dir, "agent-revisa1.meta.json"), JSON.stringify({ agentType: "trama-prueba-revisor", description: "revisa" }));
    writeFileSync(path.join(dir, "agent-sin1.jsonl"), pedido("2026-10-24T10:00:00.000Z", cwd));
    writeFileSync(path.join(dir, "agent-sin1.meta.json"), JSON.stringify({ agentType: "trama-prueba-sin-def", description: "sin nada" }));
    const lider = DelLider("2026-10-24T09:59:00.000Z", { effort: "medium" });
    const todos = await leerCarpeta(dir, "sesion-prueba", undefined, async () => lider);
    const revisa = todos.find((u) => u.id === "revisa1");
    const sin = todos.find((u) => u.id === "sin1");
    assert.deepEqual([revisa?.modelo, revisa?.modelo_heredado, revisa?.esfuerzo, revisa?.esfuerzo_heredado], ["haiku", undefined, "high", undefined]);
    assert.deepEqual([sin?.modelo, sin?.modelo_heredado, sin?.esfuerzo, sin?.esfuerzo_heredado], ["Opus 5.5", true, "medium", true]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
