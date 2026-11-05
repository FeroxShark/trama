// Ajustes > Conectores > Descubrir: la lógica pura de la lista (filtrar, buscar, ordenar por fecha con «sin dato» al final, qué acción tiene cada item).
import assert from "node:assert/strict";
import test from "node:test";
import type { ItemMcp, ItemSkill } from "../electron/descubrir.ts";
import { accionDe, buscarDescubrir, delTipo, fechaCorta, ordenarDescubrir, tamanoCorto, yaEsta, type ItemDescubrir } from "../src/paneles/descubrir-vista.ts";

const skill = (nombre: string, extra: Partial<ItemSkill> = {}): ItemSkill => ({ id: `skill:${nombre}`, tipo: "skill", nombre, descripcion: null, origen: "anthropics/skills", enlace: "https://github.com/x", fecha: null, archivos: 2, scripts: false, instalado: false, ...extra });
const mcp = (nombre: string, extra: Partial<ItemMcp> = {}): ItemMcp => ({ id: `mcp:${nombre}`, tipo: "mcp", nombre, titulo: null, descripcion: null, origen: "registry.modelcontextprotocol.io", enlace: null, fecha: null, version: null, remoto: null, cabeceras: [], paquete: null, agregado: false, ...extra });
const https = { url: "https://a.example.com/mcp", dominio: "a.example.com", seguro: true };
const paquete = { tipo: "npm", identificador: "x", version: null, comando: "npx -y x", enlace: null };

test("ordenar: más recientes primero y lo que no tiene fecha («sin dato») siempre al final, por nombre", () => {
  const l: ItemDescubrir[] = [skill("b-skill"), mcp("viejo", { fecha: "2026-01-01T00:00:00Z" }), mcp("nuevo", { fecha: "2026-10-01T00:00:00Z" }), skill("a-skill"), mcp("rota", { fecha: "no es fecha" })];
  assert.deepEqual(ordenarDescubrir(l, "reciente").map((i) => i.nombre), ["nuevo", "viejo", "a-skill", "b-skill", "rota"]);
  assert.deepEqual(ordenarDescubrir(l, "nombre").map((i) => i.nombre), ["a-skill", "b-skill", "nuevo", "rota", "viejo"]);
  assert.equal(l[0]!.nombre, "b-skill", "no toca la lista original");
});

test("filtrar por tipo y buscar (sin tildes, todas las palabras)", () => {
  const l: ItemDescubrir[] = [skill("tema", { descripcion: "Aplicar un tema a presentaciones" }), mcp("io.github.ana/notas", { titulo: "Notas de Ana", descripcion: "Búsqueda de notas" })];
  assert.deepEqual(delTipo(l, "skill").map((i) => i.nombre), ["tema"]);
  assert.equal(delTipo(l, "todo").length, 2);
  assert.deepEqual(buscarDescubrir(l, "busqueda NOTAS").map((i) => i.nombre), ["io.github.ana/notas"]);
  assert.deepEqual(buscarDescubrir(l, "anthropics tema").map((i) => i.nombre), ["tema"]);
  assert.equal(buscarDescubrir(l, "nada de esto").length, 0);
  assert.equal(buscarDescubrir(l, "  ").length, 2);
});

test("acción de cada item: skill, remoto https, paquete (sólo se muestra) o ninguna; y si ya está", () => {
  assert.equal(accionDe(skill("a")), "skill");
  assert.equal(accionDe(mcp("a", { remoto: https })), "remoto");
  assert.equal(accionDe(mcp("a", { remoto: { ...https, seguro: false } })), "ninguna");
  assert.equal(accionDe(mcp("a", { remoto: { ...https, seguro: false }, paquete })), "paquete");
  assert.equal(accionDe(mcp("a", { paquete })), "paquete");
  assert.equal(yaEsta(skill("a", { instalado: true })), true);
  assert.equal(yaEsta(mcp("a", { agregado: true })), true);
  assert.equal(yaEsta(mcp("a")), false);
});

test("fecha y tamaños: «sin dato» es null, no una fecha inventada", () => {
  assert.equal(fechaCorta(null, "es"), null);
  assert.equal(fechaCorta("basura", "es"), null);
  assert.match(fechaCorta("2026-10-30T10:00:00Z", "es")!, /2026/);
  assert.equal(tamanoCorto(512), "512 B");
  assert.equal(tamanoCorto(2048), "2 KB");
  assert.equal(tamanoCorto(3 * 1024 * 1024), "3.0 MB");
});
