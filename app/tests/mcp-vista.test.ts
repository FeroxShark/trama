import assert from "node:assert/strict";
import test from "node:test";
import { agrupar, claveIcono, inicial, nombreVisible, type ServidorVisto } from "../src/hilo/mcp-vista.ts";

const s = (nombre: string, estado: ServidorVisto["estado"]): ServidorVisto => ({ nombre, destino: "https://ejemplo.com/mcp", tipo: "HTTP", estado, detalle: null });

test("nombreVisible: quita el prefijo de claude.ai y el de plugin, y dice de dónde viene", () => {
  assert.deepEqual(nombreVisible("claude.ai Google Calendar"), { titulo: "Google Calendar", origen: { tipo: "claudeai", de: "" } });
  assert.deepEqual(nombreVisible("plugin:design:figma"), { titulo: "figma", origen: { tipo: "plugin", de: "design" } });
  assert.deepEqual(nombreVisible("archivos"), { titulo: "archivos", origen: { tipo: "config", de: "" } });
});

test("claveIcono: por el nombre del servicio; sin ícono, la inicial", () => {
  assert.equal(claveIcono("Gmail"), "correo");
  assert.equal(claveIcono("Google Calendar"), "calendario");
  assert.equal(claveIcono("Notion"), "documentos");
  assert.equal(claveIcono("figma"), "figma");
  assert.equal(claveIcono("Slack"), "chat");
  assert.equal(claveIcono("Zeta"), null);
  assert.equal(inicial("zeta"), "Z");
  assert.equal(inicial("  ¡3d"), "3");
  assert.equal(inicial("--"), "·");
});

test("agrupar: conectados, piden sesión, no conectan y apagados, cada uno donde le toca", () => {
  const g = agrupar(
    [s("claude.ai Gmail", "ok"), s("claude.ai Google Calendar", "auth"), s("plugin:design:figma", "falla"), s("viejo", "sin-configurar"), s("raro", "desconocido")],
    ["claude.ai Notion"],
  );
  assert.deepEqual(g.conectados.map((f) => f.titulo), ["Gmail"]);
  assert.deepEqual(g.auth.map((f) => f.titulo), ["Google Calendar"]);
  assert.deepEqual(g.fallan.map((f) => f.titulo), ["figma", "viejo", "raro"]);
  assert.deepEqual(g.apagados.map((f) => [f.nombre, f.servidor]), [["claude.ai Notion", null]]);
});

test("agrupar: uno apagado que claude también nombra va sólo en apagados", () => {
  const g = agrupar([s("claude.ai Notion", "ok"), s("claude.ai Gmail", "ok")], ["claude.ai Notion"]);
  assert.deepEqual(g.conectados.map((f) => f.titulo), ["Gmail"]);
  assert.equal(g.apagados[0].servidor?.estado, "ok");
});
