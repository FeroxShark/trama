// Ajustes > Conectores como tienda: la lógica pura de las tarjetas (armarlas desde cada fuente, buscar, categoría, orden por pestaña y
// las secciones de Descubrir). Lo que una fuente no trae es «sin dato» (null) y va siempre al final; nunca se mezcla con un cero.
import assert from "node:assert/strict";
import test from "node:test";
import type { Conector } from "../electron/conectores-claude.ts";
import type { ItemMcp, ItemSkill } from "../electron/descubrir.ts";
import type { Catalogo, PluginCatalogo } from "../electron/plugins-claude.ts";
import {
  autorDeNombreMcp,
  buscarTarjetas,
  categoriasDeTarjetas,
  conteoTuyos,
  filtrarCategoria,
  listaDeSeccion,
  ordenarTarjetas,
  ordenesDe,
  origenDeRepo,
  seccionesDescubrir,
  tarjetasDescubrirMcp,
  tarjetasDescubrirPlugins,
  tarjetasDescubrirSkills,
  tarjetasTuyos,
} from "../src/paneles/tienda-logica.ts";
import type { UsoConector } from "../src/paneles/conectores-vista.ts";

const c = (o: Partial<Conector>): Conector => ({ id: o.nombre ?? "x", tipo: "skill", nombre: "x", origen: "usuario", de: "", descripcion: "", activo: true, conmutable: false, ...o });
const pl = (nombre: string, o: Partial<PluginCatalogo> = {}): PluginCatalogo => ({ nombre, descripcion: `Hace ${nombre}`, categoria: "", instalado: false, instalaciones: null, actualizado: null, ...o });
const cat = (id: string, repo: string, plugins: PluginCatalogo[], agregado = true): Catalogo => ({ id, repo, conocido: true, agregado, plugins });
const skill = (nombre: string, o: Partial<ItemSkill> = {}): ItemSkill => ({ id: `skill:${nombre}`, tipo: "skill", nombre, descripcion: null, origen: "anthropics/skills", enlace: "https://x", fecha: null, archivos: 3, scripts: false, instalado: false, ...o });
const mcp = (nombre: string, o: Partial<ItemMcp> = {}): ItemMcp => ({ id: `mcp:${nombre}`, tipo: "mcp", nombre, titulo: null, descripcion: null, origen: "registry.modelcontextprotocol.io", enlace: null, fecha: null, version: null, remoto: null, cabeceras: [], paquete: null, agregado: false, ...o });

test("origen: Anthropic por su repo, un autor por el dueño del repo o el espacio de nombres del registro", () => {
  assert.deepEqual(origenDeRepo("anthropics/skills"), { clase: "anthropic" });
  assert.deepEqual(origenDeRepo("ana/plugins"), { clase: "autor", n: "ana" });
  assert.deepEqual(origenDeRepo(""), { clase: "tuyo" });
  assert.equal(autorDeNombreMcp("io.github.ana/notas"), "ana");
  assert.equal(autorDeNombreMcp("com.example/agenda"), "example");
  assert.equal(autorDeNombreMcp("suelto"), "suelto");
});

test("Tuyos: cada pestaña trae sólo lo suyo, con el uso y de dónde viene", () => {
  const todos = [
    c({ nombre: "diseno", descripcion: "Tarea de diseño" }),
    c({ nombre: "tono", origen: "plugin", de: "estilo@mercado" }),
    c({ id: "p1", nombre: "estilo", tipo: "plugin", de: "mercado", conmutable: true }),
    c({ id: "m1", nombre: "archivos", tipo: "mcp", clase: "stdio", destino: "npx -y x" }),
    c({ id: "h1", nombre: "PreToolUse · Bash", tipo: "hook", clase: "PreToolUse", destino: "bash ~/.claude/hooks/guardia.sh" }),
  ];
  const uso = new Map<string, UsoConector>([["diseno", { veces: 5, ultimo: "2026-11-04" }]]);
  const skills = tarjetasTuyos("skills", todos, uso);
  assert.deepEqual(skills.map((x) => x.nombre), ["diseno", "tono"]);
  assert.equal(skills[0]!.veces, 5);
  assert.equal(skills[1]!.veces, null, "sin registro de uso: sin dato, no cero");
  assert.deepEqual(skills[0]!.origen, { clase: "tuyo" });
  assert.deepEqual(skills[1]!.origen, { clase: "plugin", n: "estilo" });
  assert.equal(skills[0]!.donde, "~/.claude/skills/diseno");
  const plugins = tarjetasTuyos("plugins", todos, uso);
  assert.deepEqual(plugins[0]!.trae, { skills: 1, mcp: 0, hooks: 0 }, "lo que trae el plugin sale del inventario");
  assert.equal(plugins[0]!.conmutable, true);
  assert.equal(tarjetasTuyos("hooks", todos, uso)[0]!.nombre, "guardia.sh");
  assert.deepEqual(conteoTuyos(todos, []), { skills: 2, mcp: 1, plugins: 1, hooks: 1 });
});

test("Tuyos: los conectores propios de Trama se suman a los de Claude Code en MCP y no en otras pestañas", () => {
  const propios = [{ nombre: "notion", tipo: "http" as const, url: "https://mcp.notion.com/mcp", variables: [] }];
  const m = tarjetasTuyos("mcp", [c({ nombre: "tablero", tipo: "mcp", destino: "node t.mjs" })], null, { propios });
  assert.deepEqual(m.map((x) => x.nombre), ["tablero", "notion"]);
  assert.deepEqual(m[1]!.fuente, { tipo: "propio", nombre: "notion" });
  assert.equal(m[1]!.destino, "https://mcp.notion.com/mcp");
  assert.equal(tarjetasTuyos("skills", [], null, { propios }).length, 0);
  assert.equal(conteoTuyos([], propios).mcp, 1);
});

test("Tuyos: un plugin instalado toma categoría, instalaciones y origen del catálogo si ese catálogo está cargado", () => {
  const catalogos = [cat("mercado", "anthropics/claude-plugins-official", [pl("estilo", { categoria: "escritura", instalaciones: 310, actualizado: 5 })])];
  const [p] = tarjetasTuyos("plugins", [c({ id: "p1", nombre: "estilo", tipo: "plugin", de: "mercado" })], null, { catalogos });
  assert.equal(p!.categoria, "escritura");
  assert.equal(p!.instalaciones, 310);
  assert.deepEqual(p!.origen, { clase: "anthropic" });
  const [sin] = tarjetasTuyos("plugins", [c({ id: "p1", nombre: "estilo", tipo: "plugin", de: "mercado" })], null);
  assert.equal(sin!.categoria, null);
  assert.equal(sin!.instalaciones, null);
});

test("Descubrir: la acción de cada tarjeta y de quién es (el «+», el comando o nada)", () => {
  const s = tarjetasDescubrirSkills([skill("tema", { instalado: true })]);
  assert.equal(s[0]!.accion, "instalar");
  assert.equal(s[0]!.puesto, true);
  assert.deepEqual(s[0]!.origen, { clase: "anthropic" });
  const m = tarjetasDescubrirMcp([
    mcp("io.github.ana/notas", { titulo: "Notas de Ana", remoto: { url: "https://n.example.com/mcp", dominio: "n.example.com", seguro: true }, fecha: "2026-10-01T00:00:00Z" }),
    mcp("io.github.luis/archivos", { paquete: { tipo: "npm", identificador: "x", version: null, comando: "npx -y x", enlace: null } }),
    mcp("dev.local/prueba", { remoto: { url: "http://p.example.com", dominio: "p.example.com", seguro: false } }),
  ]);
  assert.deepEqual(m.map((x) => x.accion), ["agregar", "comando", "ninguna"]);
  assert.equal(m[0]!.nombre, "Notas de Ana");
  assert.deepEqual(m[0]!.origen, { clase: "autor", n: "ana" });
  assert.equal(m[0]!.fecha, Date.parse("2026-10-01T00:00:00Z"));
  assert.equal(m[1]!.fecha, null);
});

test("Descubrir: los plugins vienen sólo de los catálogos agregados y llevan `plugin@catálogo`", () => {
  const ts = tarjetasDescubrirPlugins([cat("a", "anthropics/x", [pl("uno", { instalado: true, instalaciones: 0 })]), cat("b", "ana/y", [pl("dos")], false)]);
  assert.deepEqual(ts.map((x) => x.clave), ["uno@a"]);
  assert.equal(ts[0]!.instalaciones, 0, "cero instalaciones no es «sin dato»");
  assert.equal(ts[0]!.puesto, true);
  assert.deepEqual(ts[0]!.fuente, { tipo: "plugin", plugin: "uno", catalogo: "a" });
});

test("buscar: cada palabra en nombre, descripción, autor, categoría o destino, sin tildes", () => {
  const ts = tarjetasDescubrirPlugins([cat("a", "ana/y", [pl("document-skills", { descripcion: "Word y PDF", categoria: "documentación" }), pl("claude-api")])]);
  assert.equal(buscarTarjetas(ts, "  ").length, 2);
  assert.deepEqual(buscarTarjetas(ts, "DOCUMENTACION word").map((x) => x.nombre), ["document-skills"]);
  assert.deepEqual(buscarTarjetas(ts, "ana").length, 2, "el autor también se busca");
  assert.equal(buscarTarjetas(ts, "nada de esto").length, 0);
});

test("categorías: con conteo, la más poblada primero, y filtrar por una", () => {
  const ts = tarjetasDescubrirPlugins([cat("a", "ana/y", [pl("a1", { categoria: "dev" }), pl("a2", { categoria: "dev" }), pl("a3", { categoria: "arte" }), pl("a4")])]);
  assert.deepEqual(categoriasDeTarjetas(ts), [{ nombre: "dev", n: 2 }, { nombre: "arte", n: 1 }]);
  assert.deepEqual(filtrarCategoria(ts, "dev").map((x) => x.nombre), ["a1", "a2"]);
  assert.equal(filtrarCategoria(ts, null).length, 4);
  assert.deepEqual(categoriasDeTarjetas(tarjetasDescubrirSkills([skill("x")])), [], "una fuente sin categorías no inventa ninguna");
});

test("orden por uso: «sin dato» siempre al final; «menos usados» empieza por los de cero; «último» por el día", () => {
  const todos = [c({ nombre: "a" }), c({ nombre: "b" }), c({ nombre: "c" }), c({ nombre: "d" }), c({ nombre: "e" })];
  const uso = new Map<string, UsoConector>([
    ["a", { veces: 2, ultimo: "2026-11-01" }],
    ["b", { veces: 9, ultimo: "2026-10-20" }],
    ["c", { veces: 0, ultimo: null }],
    ["d", { veces: null, ultimo: null }],
    ["e", { veces: 2, ultimo: "2026-11-03" }],
  ]);
  const ts = tarjetasTuyos("skills", todos, uso);
  const nombres = (o: Parameters<typeof ordenarTarjetas>[1]) => ordenarTarjetas(ts, o).map((x) => x.nombre).join("");
  assert.equal(nombres("mas"), "beacd");
  assert.equal(nombres("menos"), "caebd");
  assert.equal(nombres("ultimo"), "eabcd");
  assert.equal(nombres("nombre"), "abcde");
  assert.equal(ts[0]!.nombre, "a", "no toca la lista que recibe");
});

test("orden por instalaciones y por recientes: el dato que falta va al final, por nombre", () => {
  const ts = tarjetasDescubrirPlugins([cat("a", "ana/y", [pl("sin"), pl("poco", { instalaciones: 5, actualizado: 100 }), pl("mucho", { instalaciones: 900, actualizado: 50 }), pl("cero", { instalaciones: 0 }), pl("antes")])]);
  assert.deepEqual(ordenarTarjetas(ts, "instalados").map((x) => x.nombre), ["mucho", "poco", "cero", "antes", "sin"]);
  assert.deepEqual(ordenarTarjetas(ts, "recientes").map((x) => x.nombre), ["poco", "mucho", "antes", "cero", "sin"]);
});

test("orden por origen: lo tuyo antes que plugins, Anthropic y claude.ai", () => {
  const todos = [c({ nombre: "z", origen: "claudeai", de: "knowledge" }), c({ nombre: "y", origen: "plugin", de: "p@m" }), c({ nombre: "x" }), c({ nombre: "w", origen: "proyecto", de: "/h/tienda" })];
  assert.equal(ordenarTarjetas(tarjetasTuyos("skills", todos, null), "origen").map((x) => x.nombre).join(""), "xwyz");
});

test("órdenes de cada pestaña: sólo los que tienen de dónde sacarse", () => {
  assert.deepEqual(ordenesDe("skills", "tuyos"), ["origen", "mas", "menos", "ultimo"]);
  assert.deepEqual(ordenesDe("hooks", "tuyos"), ["origen"]);
  assert.deepEqual(ordenesDe("plugins", "descubrir"), ["instalados", "recientes", "nombre"]);
  assert.deepEqual(ordenesDe("mcp", "descubrir"), ["recientes", "nombre"]);
  assert.deepEqual(ordenesDe("skills", "descubrir"), ["nombre"], "las skills de anthropics/skills no traen fecha ni instalaciones");
  assert.deepEqual(ordenesDe("hooks", "descubrir"), []);
});

test("secciones: «Para vos» sólo con base, «Nuevos» con fecha y «Más instalados» con dato; cada una con su total", () => {
  const ps = [
    pl("base", { categoria: "dev", instalado: true, instalaciones: 10, actualizado: 1 }),
    pl("dev-grande", { categoria: "dev", instalaciones: 500, actualizado: 5 }),
    pl("dev-chico", { categoria: "dev", instalaciones: 50, actualizado: 9 }),
    pl("arte", { categoria: "arte", instalaciones: 900, actualizado: 7 }),
    pl("sin-nada"),
  ];
  const ts = tarjetasDescubrirPlugins([cat("a", "ana/y", ps)]);
  const s = seccionesDescubrir(ts, 2);
  assert.deepEqual(s.secciones.map((x) => x.id), ["paraVos", "nuevos", "masInstalados"]);
  const por = (id: string) => s.secciones.find((x) => x.id === id)!;
  assert.deepEqual(por("paraVos").items.map((x) => x.nombre), ["dev-grande", "dev-chico"], "de lo que ya tenés, lo que falta, de más a menos instalado");
  assert.equal(por("nuevos").total, 4);
  assert.deepEqual(por("nuevos").items.map((x) => x.nombre), ["dev-chico", "arte"]);
  assert.equal(por("masInstalados").total, 4);
  assert.deepEqual(por("masInstalados").items.map((x) => x.nombre), ["arte", "dev-grande"]);
  assert.deepEqual(s.categorias, [{ nombre: "dev", n: 3 }, { nombre: "arte", n: 1 }]);
  assert.equal(listaDeSeccion(ts, "masInstalados").length, 4, "«Ver todo» trae la lista entera");
});

test("secciones: sin nada instalado no hay «Para vos»; sin fechas ni instalaciones no hay secciones (la pestaña se dibuja plana)", () => {
  const sinBase = seccionesDescubrir(tarjetasDescubrirPlugins([cat("a", "ana/y", [pl("x", { categoria: "dev", instalaciones: 3, actualizado: 2 })])]));
  assert.deepEqual(sinBase.secciones.map((x) => x.id), ["nuevos", "masInstalados"]);
  const skills = seccionesDescubrir(tarjetasDescubrirSkills([skill("a"), skill("b")]));
  assert.deepEqual(skills, { secciones: [], categorias: [] });
});
