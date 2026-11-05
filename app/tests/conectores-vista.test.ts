import assert from "node:assert/strict";
import test from "node:test";
import type { Conector } from "../electron/conectores-claude.ts";
import { buscarPlugins, delTipo, deDonde, filtrar } from "../src/paneles/conectores-vista.ts";

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

test("buscarPlugins: cada palabra en nombre, categoría o descripción, sin tildes ni mayúsculas", () => {
  const ps = [
    { nombre: "document-skills", descripcion: "Word, Excel, PowerPoint y PDF", categoria: "documentos", instalado: true },
    { nombre: "claude-api", descripcion: "Armar apps con la API", categoria: "", instalado: false },
  ];
  assert.equal(buscarPlugins(ps, "  ").length, 2);
  assert.deepEqual(buscarPlugins(ps, "POWERPOINT pdf").map((p) => p.nombre), ["document-skills"]);
  assert.deepEqual(buscarPlugins(ps, "documentación").map((p) => p.nombre), []);
  assert.deepEqual(buscarPlugins(ps, "api").map((p) => p.nombre), ["claude-api"]);
});

// --- Ordenar por uso -------------------------------------------------------------------------------------------------------------------------
import { claveSkill, nombreServidor, usosDeHistorial } from "../electron/usos-historial.ts";
import { nombreMcp } from "../electron/historial-parser.ts";
import { enBloques, esDeTrama, haceDias, nombreHook, ordenarPorUso, SIN_DATO, usosPorConector } from "../src/paneles/conectores-vista.ts";

const consulta = (o: Record<string, unknown> = {}) => ({
  sesiones: 12,
  piezas: [
    { clase: "skill", nombre: "diseno", usos: 5, ganchos: 0 },
    { clase: "skill", nombre: "estilo:tono", usos: 2, ganchos: 0 },
    { clase: "skill", nombre: "revisar", usos: 0, ganchos: 0 },
    { clase: "mcp", nombre: "archivos", usos: 9, ganchos: 0 },
    { clase: "mcp", nombre: "plugin_estilo_voz", usos: 3, ganchos: 0 },
  ],
  comandos: { revisar: 1 },
  ultimo: { skills: { diseno: "2026-10-10", "estilo:tono": "2026-10-12" }, comandos: { revisar: "2026-10-13" }, mcp: { archivos: "2026-10-01", plugin_estilo_voz: "2026-10-11" } },
  ...o,
});
const inventario: Conector[] = [
  c({ id: "s1", nombre: "diseno" }),
  c({ id: "s2", nombre: "revisar" }),
  c({ id: "s3", nombre: "tono", origen: "plugin", de: "estilo@mercado" }),
  c({ id: "s4", nombre: "olvidada" }),
  c({ id: "p1", tipo: "plugin", nombre: "estilo", origen: "usuario", de: "mercado" }),
  c({ id: "p2", tipo: "plugin", nombre: "solo-hooks", origen: "usuario", de: "mercado" }),
  c({ id: "m1", tipo: "mcp", nombre: "archivos" }),
  c({ id: "m2", tipo: "mcp", nombre: "voz", origen: "plugin", de: "estilo@mercado" }),
  c({ id: "m3", tipo: "mcp", nombre: "calendario", origen: "proyecto", de: "/x/tienda" }),
  c({ id: "h1", tipo: "hook", nombre: "PreToolUse · Bash", clase: "PreToolUse", destino: "bash ~/.claude/hooks/guardia.sh" }),
];
const ids = (xs: Conector[]) => xs.map((x) => x.id);
const usos = () => usosDeHistorial(consulta(), inventario.filter((x) => x.tipo === "skill").map((x) => ({ clave: claveSkill(x), nombre: x.nombre, origen: x.origen, de: x.de })));

test("usosPorConector: veces y último día de skills (con sus /comandos), plugins y servidores MCP", () => {
  const u = usosPorConector(inventario, usos());
  assert.deepEqual(u.get("s1"), { veces: 5, ultimo: "2026-10-10" });
  // Una skill invocada sólo a mano (`/revisar`) cuenta y fecha igual.
  assert.deepEqual(u.get("s2"), { veces: 1, ultimo: "2026-10-13" });
  // Una skill de plugin se cuenta por su clave `plugin:skill`.
  assert.deepEqual(u.get("s3"), { veces: 2, ultimo: "2026-10-12" });
  // El plugin suma sus skills y los servidores que trae (`plugin_<plugin>_<servidor>`), con el día más nuevo de los dos.
  assert.deepEqual(u.get("p1"), { veces: 5, ultimo: "2026-10-12" });
  assert.deepEqual(u.get("m1"), { veces: 9, ultimo: "2026-10-01" });
  assert.deepEqual(u.get("m2"), { veces: 3, ultimo: "2026-10-11" });
});

test("usosPorConector: cero uso es «sin uso en 30 días» (0), nunca «sin dato»; sin dato es null", () => {
  const u = usosPorConector(inventario, usos());
  assert.deepEqual(u.get("s4"), { veces: 0, ultimo: null });
  assert.deepEqual(u.get("m3"), { veces: 0, ultimo: null });
  // Un plugin sin skills ni servidores sólo actúa por hooks: no hay con qué contarlo.
  assert.deepEqual(u.get("p2"), SIN_DATO);
  // Los hooks no tienen conteo.
  assert.deepEqual(u.get("h1"), SIN_DATO);
  // Sin registro de historial (error, vacío, otra versión): todo sin dato, ningún 0 inventado.
  for (const v of usosPorConector(inventario, null).values()) assert.deepEqual(v, SIN_DATO);
  assert.equal(usosDeHistorial({ version: 1, error: "x" }, []), null);
  assert.equal(usosDeHistorial(consulta({ sesiones: 0 }), []), null);
});

test("usosPorConector: un servidor MCP de una consulta vieja (sin conteo de MCP) queda sin dato, no en cero", () => {
  const vieja = usosDeHistorial({ sesiones: 3, piezas: [{ clase: "skill", nombre: "diseno", usos: 1, ganchos: 0 }], comandos: {} }, []);
  assert.ok(vieja);
  delete vieja.mcp;
  assert.deepEqual(usosPorConector(inventario, vieja).get("m3"), SIN_DATO);
});

test("ordenarPorUso: más usados, menos usados y último uso; sin dato siempre al final", () => {
  const u = usosPorConector(inventario, usos());
  const todos = inventario.filter((x) => x.tipo !== "hook");
  assert.deepEqual(ids(ordenarPorUso(todos, "origen", u)), ids(todos));
  assert.deepEqual(ids(ordenarPorUso(todos, "mas", u)), ["m1", "p1", "s1", "m2", "s3", "s2", "s4", "m3", "p2"]);
  // Los candidatos a sacar (cero uso) primero; el sin dato (p2) cierra.
  assert.deepEqual(ids(ordenarPorUso(todos, "menos", u)).slice(0, 2), ["s4", "m3"]);
  assert.equal(ids(ordenarPorUso(todos, "menos", u)).at(-1), "p2");
  // Último uso: el más reciente arriba, después los de cero uso, al final el sin dato.
  assert.deepEqual(ids(ordenarPorUso(todos, "ultimo", u)), ["s2", "s3", "p1", "m2", "s1", "m1", "s4", "m3", "p2"]);
  // No toca la lista de entrada.
  assert.equal(todos[0].id, "s1");
});

test("ordenarPorUso: los hooks (todos sin dato) quedan en el orden de origen", () => {
  const hooks = [c({ id: "h2", tipo: "hook" }), c({ id: "h3", tipo: "hook" }), c({ id: "h4", tipo: "hook" })];
  const u = usosPorConector(hooks, usos());
  for (const o of ["mas", "menos", "ultimo"] as const) assert.deepEqual(ids(ordenarPorUso(hooks, o, u)), ["h2", "h3", "h4"]);
});

test("nombreHook y esDeTrama: el nombre de su script y de dónde viene", () => {
  assert.equal(nombreHook(c({ tipo: "hook", clase: "PreToolUse", destino: "bash ~/.claude/hooks/guardia.sh" })), "guardia.sh");
  assert.equal(nombreHook(c({ tipo: "hook", clase: "SessionStart", destino: 'node "C:\\Users\\ana\\AppData\\Local\\trama\\app\\hooks\\latido.mjs" --x' })), "latido.mjs");
  // Sin script (un comando suelto): el evento, no el comando.
  assert.equal(nombreHook(c({ tipo: "hook", clase: "Stop", nombre: "Stop", destino: "echo listo" })), "Stop");
  assert.equal(esDeTrama(c({ tipo: "hook", destino: "node ~/.local/share/trama/app/hooks/latido.mjs" })), true);
  assert.equal(esDeTrama(c({ tipo: "hook", destino: "bash ~/.claude/hooks/guardia.sh" })), false);
  assert.equal(esDeTrama(c({ tipo: "mcp", nombre: "trama" })), true);
  assert.equal(esDeTrama(c({ tipo: "skill", nombre: "trama" })), false);
});

test("nombreServidor coincide con nombreMcp del parser; haceDias y enBloques", () => {
  for (const n of ["claude.ai Calendar", "tablero", "a b/c", "x\ny"]) assert.equal(nombreServidor(n), nombreMcp(n));
  assert.equal(haceDias("2026-10-13", "2026-10-13"), 0);
  assert.equal(haceDias("2026-10-12", "2026-10-13"), 1);
  assert.equal(haceDias("2026-09-30", "2026-10-02"), 2);
  assert.equal(haceDias("2026-10-20", "2026-10-13"), 0);
  assert.deepEqual(enBloques([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(enBloques([], 3), []);
});

test("307 skills ordenadas por uso en un instante (no se traba)", () => {
  const muchas = Array.from({ length: 307 }, (_, i) => c({ id: `k${i}`, nombre: `skill-${i}` }));
  const q = consulta({ piezas: muchas.filter((_, i) => i % 7 === 0).map((x, i) => ({ clase: "skill", nombre: x.nombre, usos: i + 1, ganchos: 0 })), ultimo: { skills: {}, comandos: {}, mcp: {} } });
  const u = usosPorConector(muchas, usosDeHistorial(q, muchas.map((x) => ({ clave: x.nombre, nombre: x.nombre, origen: x.origen, de: x.de }))));
  const t0 = performance.now();
  const r = ordenarPorUso(muchas, "mas", u);
  assert.ok(performance.now() - t0 < 200);
  assert.equal(r[0].nombre, "skill-301");
  assert.equal(u.get("k1")?.veces, 0);
});
