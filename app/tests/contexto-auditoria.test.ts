// «Revisar con IA»: lo que agrupa y cuenta la ventana (src/paneles/contexto-auditoria.ts), sin React.
import test from "node:test";
import assert from "node:assert/strict";
import type { Hallazgo } from "../electron/auditoria-contexto-texto.ts";
import { agrupar, carpetaCorta, nombresCortos, pendientesDe, recortar, resumenArchivos, totales, vistaDe } from "../src/paneles/contexto-auditoria.ts";

const h = (id: string, archivo: string, ahorro: number, estado: Hallazgo["estado"] = "pendiente", tipo: Hallazgo["tipo"] = "duplicado"): Hallazgo => ({ id, tipo, archivo, buscar: "a", reemplazo: "", razon: "r", ahorro, estado });

test("nombresCortos: CLAUDE.md y los nombres repetidos llevan su carpeta; los demás, sólo el archivo", () => {
  const n = nombresCortos(["/home/p/atlas/CLAUDE.md", "/home/p/atlas/memory/notas.md", "/home/p/faro/memory/notas.md", "/home/p/atlas/memory/MEMORY.md"]);
  assert.equal(n.get("/home/p/atlas/CLAUDE.md"), "atlas/CLAUDE.md");
  assert.equal(n.get("/home/p/atlas/memory/notas.md"), "memory/notas.md");
  assert.equal(n.get("/home/p/faro/memory/notas.md"), "memory/notas.md");
  assert.equal(n.get("/home/p/atlas/memory/MEMORY.md"), "memory/MEMORY.md");
  assert.equal(nombresCortos(["/x/unico.md"]).get("/x/unico.md"), "unico.md");
});

test("agrupar: por archivo, el que más ahorra primero, y dentro el hallazgo más grande primero", () => {
  const g = agrupar({ hallazgos: [h("h1", "/a/uno.md", 10), h("h2", "/a/dos.md", 300), h("h3", "/a/uno.md", 80), h("h4", "/a/dos.md", 5, "aplicado")] });
  assert.deepEqual(g.map((x) => x.nombre), ["dos.md", "uno.md"]);
  assert.deepEqual(g[0].hallazgos.map((x) => x.id), ["h2", "h4"]);
  assert.deepEqual(g[1].hallazgos.map((x) => x.id), ["h3", "h1"]);
  assert.equal(g[0].ahorroPosible, 300); // el aplicado ya no cuenta
  assert.deepEqual(g[1].pendientes, ["h1", "h3"]);
});

test("agrupar: un archivo ya todo aplicado queda al final", () => {
  const g = agrupar({ hallazgos: [h("h1", "/a/a.md", 500, "aplicado"), h("h2", "/a/b.md", 10)] });
  assert.deepEqual(g.map((x) => x.nombre), ["b.md", "a.md"]);
});

test("totales: lo posible suma sólo los pendientes; lo aplicado, los aplicados; el inválido no suma", () => {
  const t = totales({ hallazgos: [h("h1", "/a", 100), h("h2", "/a", 50, "aplicado", "viejo"), h("h3", "/b", 70, "invalido", "largo"), h("h4", "/b", 30, "pendiente", "contradiccion")] });
  assert.equal(t.posible, 130);
  assert.equal(t.aplicado, 50);
  assert.deepEqual([t.pendientes, t.aplicados, t.invalidos], [2, 1, 1]);
  assert.deepEqual(t.porTipo, { duplicado: 1, contradiccion: 1, viejo: 1, largo: 1 });
});

test("pendientesDe: todos o los de un archivo", () => {
  const a = { hallazgos: [h("h1", "/a", 1), h("h2", "/b", 1), h("h3", "/a", 1, "aplicado")] };
  assert.deepEqual(pendientesDe(a), ["h1", "h2"]);
  assert.deepEqual(pendientesDe(a, "/a"), ["h1"]);
});

test("recortar: lo corto queda igual, lo largo se corta en una palabra con «…»", () => {
  assert.equal(recortar("hola \n\n"), "hola");
  const r = recortar("palabra ".repeat(100), 50);
  assert.ok(r.endsWith("…") && r.length <= 51, r);
  assert.ok(!/\s…$/u.test(r));
});

test("carpetaCorta y resumenArchivos", () => {
  assert.equal(carpetaCorta("/home/p/.local/state/trama/md-backup/2026-11-22-1314"), "md-backup/2026-11-22-1314");
  assert.deepEqual(resumenArchivos([{ ruta: "a", tokens: 10, huella: "x" }, { ruta: "b", tokens: 5, huella: "y" }]), { n: 2, tokens: 15 });
});

test("vistaDe: cada estado de la auditoría tiene su vista", () => {
  const base = { id: "a", cwd: "/p", modelo: "m", avance: null, error: null, archivos: [], hallazgos: [], respaldo: null };
  assert.equal(vistaDe(null), "sin-revisar");
  assert.equal(vistaDe({ ...base, estado: "corriendo" }), "corriendo");
  assert.equal(vistaDe({ ...base, estado: "error", error: "x" }), "error");
  assert.equal(vistaDe({ ...base, estado: "lista" }), "sin-hallazgos");
  assert.equal(vistaDe({ ...base, estado: "lista", hallazgos: [h("h1", "/a", 1)] }), "hallazgos");
});
