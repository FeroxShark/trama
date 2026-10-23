// `pa --hilo --json` con los campos del transcript (B19) → la forma de `Mensaje`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hiloDePa, mensajeDePa } from "../src/datos/paHilo.ts";
import { turnos } from "../src/hilo/turnos.ts";

const base = { herramientas: [], ts: "2026-10-03T12:00:00Z", modelo: null };

test("los campos de pa: meta, resumen, origen, error, sistema", () => {
  assert.equal(mensajeDePa({ ...base, i: 0, rol: "user", texto: "x", meta: true }).meta, true);
  assert.equal(mensajeDePa({ ...base, i: 0, rol: "user", texto: "x", resumen_compact: true }).resumen, true);
  assert.equal(mensajeDePa({ ...base, i: 0, rol: "user", texto: "x", origen: "task-notification" }).origen, "task-notification");
  // `error` va en null en todos: sólo cuenta en un sintético.
  assert.equal(mensajeDePa({ ...base, i: 0, rol: "assistant", texto: "x", modelo: "claude-opus-5-5", error: null }).error, undefined);
  assert.equal(mensajeDePa({ ...base, i: 0, rol: "assistant", texto: "x", error_api: true, error: null }).error, "unknown");
  assert.equal(mensajeDePa({ ...base, i: 0, rol: "assistant", texto: "x", modelo: "<synthetic>", error: "rate_limit" }).error, "rate_limit");
  const s = mensajeDePa({ ...base, i: 3, rol: "system", subtipo: "compact_boundary", texto: "Conversation compacted" });
  assert.deepEqual({ rol: s.rol, texto: s.texto, compacto: s.compacto }, { rol: "assistant", texto: "", compacto: { auto: null, antes: null } });
});

test("herramientas_det → det, y si vino recortado", () => {
  const m = mensajeDePa({
    ...base,
    i: 1,
    rol: "assistant",
    texto: "",
    herramientas: ["Bash", "Edit"],
    herramientas_det: [
      { nombre: "Bash", entrada: { command: "z".repeat(2000) } },
      { nombre: "Edit", entrada: { file_path: "/a", old_string: "a", new_string: "b" } },
      { nada: 1 },
    ],
  });
  assert.equal(m.det?.length, 2);
  assert.equal(m.det?.[0].cortado, true);
  assert.equal(m.det?.[1].cortado, undefined);
});

test("una página de pa: compactar + resumen van en un divisor", () => {
  const r = hiloDePa({
    version: 1,
    mensajes: [
      { ...base, i: 0, rol: "user", texto: "hacé X" },
      { ...base, i: 1, rol: "system", subtipo: "compact_boundary", texto: "Conversation compacted" },
      { ...base, i: 2, rol: "user", texto: "This session is being continued…", resumen_compact: true },
      { ...base, i: 3, rol: "assistant", texto: "sigo", modelo: "claude-opus-5-5" },
    ],
  });
  const its = turnos(r.mensajes);
  assert.deepEqual(
    its.map((x) => (x.tipo === "sistema" ? `${x.s.tipo}:${x.s.clase}` : x.tipo)),
    ["yo", "linea:compacto", "turno"],
  );
  const c = its[1];
  assert.ok(c.tipo === "sistema" && c.s.tipo === "linea" && c.s.clase === "compacto" && c.s.resumen === "This session is being continued…");
});
