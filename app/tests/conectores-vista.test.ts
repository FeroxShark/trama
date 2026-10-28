import assert from "node:assert/strict";
import test from "node:test";
import type { Conector } from "../electron/conectores-claude.ts";
import { delTipo, deDonde, filtrar } from "../src/paneles/conectores-vista.ts";

const c = (o: Partial<Conector>): Conector => ({ id: o.nombre ?? "x", tipo: "skill", nombre: "x", origen: "usuario", de: "", descripcion: "", activo: true, conmutable: false, ...o });

test("filtrar: cada palabra en nombre, descripción u origen, sin tildes ni mayúsculas", () => {
  const items = [c({ nombre: "diseno", descripcion: "Tarea de diseño" }), c({ nombre: "deploy", origen: "proyecto", de: "/home/ana/tienda", descripcion: "Publicar" })];
  assert.equal(filtrar(items, "").length, 2);
  assert.deepEqual(filtrar(items, "DISEÑO").map((x) => x.nombre), ["diseno"]);
  assert.deepEqual(filtrar(items, "tienda publicar").map((x) => x.nombre), ["deploy"]);
  assert.equal(filtrar(items, "nada de esto").length, 0);
});

test("deDonde: la carpeta del proyecto o el plugin tal cual", () => {
  assert.equal(deDonde(c({ origen: "proyecto", de: "/home/ana/tienda/" })), "tienda");
  assert.equal(deDonde(c({ origen: "proyecto", de: "C:\\Users\\ana\\tienda" })), "tienda");
  assert.equal(deDonde(c({ origen: "plugin", de: "estilo@mercado" })), "estilo@mercado");
});

test("delTipo: sólo el tipo pedido, usuario antes que proyecto y plugin", () => {
  const items = [c({ nombre: "b", origen: "plugin", de: "p@m" }), c({ nombre: "z", origen: "usuario" }), c({ nombre: "a", origen: "usuario" }), c({ nombre: "h", tipo: "hook" })];
  assert.deepEqual(delTipo(items, "skill").map((x) => x.nombre), ["a", "z", "b"]);
});
