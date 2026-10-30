// El panel de contexto (base del main): el registro del apagado global y su pedazo de settings (apagados.ts), lo que se suma al
// --settings de un worker (el port de pa) y al argv de un líder, el desglose desde un `/context` y desde un transcript
// (contexto-desglose.ts), y el catálogo de skills (skills-catalogo.ts). Todo con fixtures inventados en carpetas temporales.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  archivoApagados,
  archivoFragmento,
  fijarApagadoTrama,
  fragmentoClaude,
  fragmentoVigente,
  guardarApagados,
  leerApagadosTrama,
  nombreValido,
  normalizar,
  sumarFragmento,
  vacios,
} from "../electron/apagados.ts";
import { settingsWorker } from "../electron/cli/pa/lanzar.ts";
import type { Pa } from "../electron/cli/pa/entorno.ts";
import { desdeClaude, desdeTranscript, excluida, memoriaDeSesion, pedidosDe, sinDesglose, usosDe } from "../electron/contexto-desglose.ts";
import { argvLider, lineaContexto, parsearLinea } from "../electron/lider-arma.ts";
import { buscarSkills, catalogoSkills } from "../electron/skills-catalogo.ts";
import type { Inventario } from "../electron/conectores-claude.ts";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "trama-ctx-"));

test("apagados: sin registro está todo prendido y no hay pedazo de settings", () => {
  const d = tmp();
  assert.deepEqual(leerApagadosTrama(d), vacios());
  assert.equal(fragmentoClaude(vacios()), null);
  assert.equal(fragmentoVigente(d), undefined);
  assert.ok(!existsSync(archivoFragmento(d)));
});

test("apagados: fijar escribe el registro y el pedazo (skillOverrides, deny de MCP normalizado y de herramientas, claudeMdExcludes)", () => {
  const d = tmp();
  fijarApagadoTrama("skills", "skill-inventada", true, d);
  fijarApagadoTrama("skills", "plugin-x:otra", true, d);
  fijarApagadoTrama("mcp", "claude.ai Servicio Falso", true, d);
  fijarApagadoTrama("herramientas", "WebFetch", true, d);
  fijarApagadoTrama("herramientas", "mcp__srv__borrar", true, d);
  const a = fijarApagadoTrama("memoria", "/home/inventado/proyecto/CLAUDE.md", true, d);
  assert.deepEqual(a.skills, ["skill-inventada", "plugin-x:otra"]);
  const f = JSON.parse(readFileSync(archivoFragmento(d), "utf8"));
  assert.deepEqual(f, {
    skillOverrides: { "skill-inventada": "off", "plugin-x:otra": "off" },
    permissions: { deny: ["mcp__claude_ai_Servicio_Falso", "WebFetch", "mcp__srv__borrar"] },
    claudeMdExcludes: ["/home/inventado/proyecto/CLAUDE.md"],
  });
  assert.equal(fragmentoVigente(d), archivoFragmento(d));
  // Apagar dos veces no repite; prender lo saca.
  fijarApagadoTrama("skills", "skill-inventada", true, d);
  const b = fijarApagadoTrama("skills", "skill-inventada", false, d);
  assert.deepEqual(b.skills, ["plugin-x:otra"]);
  // Prender todo borra el pedazo: los workers y líderes vuelven a como siempre.
  guardarApagados(vacios(), d);
  assert.ok(!existsSync(archivoFragmento(d)));
  assert.ok(existsSync(archivoApagados(d)));
});

test("apagados: lo que no vale no se guarda (herramientas protegidas, rutas relativas, control, tipos raros)", () => {
  const d = tmp();
  for (const [t, n] of [
    ["herramientas", "Bash"],
    ["herramientas", "Edit"],
    ["herramientas", "rm -rf"],
    ["memoria", "CLAUDE.md"],
    ["skills", "con espacio"],
    ["mcp", "linea\nnueva"],
    ["otra", "x"],
  ] as const)
    assert.throws(() => fijarApagadoTrama(t, n, true, d), undefined, `${t} ${n}`);
  assert.ok(nombreValido("memoria", "**/proyecto/CLAUDE.local.md"));
  assert.ok(nombreValido("memoria", "C:\\Users\\x\\CLAUDE.md"));
  assert.deepEqual(normalizar({ skills: ["a", "a", 3, ""], herramientas: ["Read", "Grep"], mcp: "no-lista" }), { ...vacios(), skills: ["a"], herramientas: ["Grep"] });
  // Un registro roto se lee como vacío y un pedazo editado a mano se rehace del registro.
  writeFileSync(archivoApagados(d), "{roto");
  assert.deepEqual(leerApagadosTrama(d), vacios());
  guardarApagados({ skills: ["s1"] }, d);
  writeFileSync(archivoFragmento(d), '{"skillOverrides":{"otra":"off"}}\n');
  fragmentoVigente(d);
  assert.deepEqual(JSON.parse(readFileSync(archivoFragmento(d), "utf8")), { skillOverrides: { s1: "off" } });
});

test("sumarFragmento: excludes y deny se agregan a los del worker, skillOverrides se pone, lo raro no rompe", () => {
  const s = { claudeMdExcludes: ["/h/CLAUDE.md"], hooks: {}, permissions: { deny: ["Read(/x/**)"] } };
  assert.deepEqual(sumarFragmento(s, { skillOverrides: { a: "off" }, permissions: { deny: ["WebFetch"] }, claudeMdExcludes: ["/p/CLAUDE.md"] }), {
    claudeMdExcludes: ["/h/CLAUDE.md", "/p/CLAUDE.md"],
    hooks: {},
    permissions: { deny: ["Read(/x/**)", "WebFetch"] },
    skillOverrides: { a: "off" },
  });
  const t = { claudeMdExcludes: ["/h/CLAUDE.md"] };
  assert.deepEqual(sumarFragmento(t, null), { claudeMdExcludes: ["/h/CLAUDE.md"] });
  assert.deepEqual(sumarFragmento({ claudeMdExcludes: [] }, { permissions: "raro", skillOverrides: [] }), { claudeMdExcludes: [] });
});

test("worker (port de pa): el --settings lleva el apagado global si Trama dejó el pedazo en su config", () => {
  const raiz = tmp();
  const pa = { env: { PATH: "" }, io: { out: () => {}, err: () => {} }, plat: "linux", home: path.join(raiz, "home"), state: path.join(raiz, "estado"), lockdir: "", bin: path.join(raiz, "motor", "bin") } as unknown as Pa;
  const sin = JSON.parse(settingsWorker(pa, { hb: "/e/hb", leer: false }));
  assert.equal(sin.skillOverrides, undefined);
  const conf = path.join(pa.home, ".config", "trama");
  mkdirSync(conf, { recursive: true });
  guardarApagados({ skills: ["skill-inventada"], mcp: ["srv"], memoria: ["/ruta/CLAUDE.md"] }, conf);
  const con = JSON.parse(settingsWorker(pa, { hb: "/e/hb", leer: false }));
  assert.deepEqual(con.skillOverrides, { "skill-inventada": "off" });
  assert.deepEqual(con.permissions, { deny: ["mcp__srv"] });
  assert.deepEqual(con.claudeMdExcludes, [`${pa.home}/CLAUDE.md`, "/ruta/CLAUDE.md"]);
});

test("líder: --settings con el pedazo sólo para Claude de verdad (no local ni Ollama)", () => {
  const base = { modelo: "claude-opus-5-5", effort: "high", sid: "11111111-2222-3333-4444-555555555555", nombre: "trama-1", resume: false };
  const con = argvLider({ ...base, apagados: "/c/apagados-claude.json" });
  assert.deepEqual(con.slice(con.indexOf("--settings"), con.indexOf("--settings") + 2), ["--settings", "/c/apagados-claude.json"]);
  assert.ok(!argvLider(base).includes("--settings"));
  const ollama = argvLider({ ...base, modelo: "llama3", apagados: "/c/a.json", ollama: { url: "http://127.0.0.1:11434", modelo: "llama3" } });
  assert.ok(!ollama.includes("/c/a.json"));
  const local = argvLider({ ...base, apagados: "/c/a.json", local: { url: "http://127.0.0.1:8080", ctx: 32768 } });
  assert.ok(!local.includes("/c/a.json"));
});

/** Una respuesta a get_context_usage inventada, con la forma de claude 2.1.3xx. */
const RESPUESTA = {
  categories: [
    { id: "system_prompt", name: "System prompt", tokens: 3000, color: "x", kind: "used" },
    { id: "system_tools", name: "System tools", tokens: 12000, color: "x", kind: "used" },
    { id: "mcp_tools", name: "MCP tools", tokens: 900, color: "x", kind: "used" },
    { id: "mcp_instructions", name: "MCP server instructions", tokens: 100, color: "x", kind: "used" },
    { id: "mcp_tools_deferred", name: "MCP tools (deferred)", tokens: 5000, color: "x", kind: "deferred" },
    { id: "memory_files", name: "Memory files", tokens: 1500, color: "x", kind: "used" },
    { id: "skills", name: "Skills", tokens: 700, color: "x", kind: "used" },
    { id: "messages", name: "Messages", tokens: 20000, color: "x", kind: "used" },
    { id: "free_space", name: "Free space", tokens: 950000, color: "x", kind: "free" },
  ],
  totalTokens: 38200,
  maxTokens: 1000000,
  rawMaxTokens: 1000000,
  percentage: 3.8,
  gridRows: [],
  model: "claude-opus-5-5",
  memoryFiles: [{ path: "/home/inventado/.claude/CLAUDE.md", type: "User", tokens: 1500 }],
  mcpTools: [
    { name: "mcp__falso__buscar", serverName: "falso", tokens: 600, isLoaded: true },
    { name: "mcp__falso__borrar", serverName: "falso", tokens: 300, isLoaded: true },
  ],
  mcpInstructions: [{ serverName: "falso", tokens: 100 }],
  systemTools: [
    { name: "Bash", tokens: 4000 },
    { name: "WebFetch", tokens: 800 },
  ],
  skills: {
    totalSkills: 2,
    includedSkills: 2,
    tokens: 700,
    skillFrontmatter: [
      { name: "skill-usada", source: "user", tokens: 300 },
      { name: "plugin-x:nunca", source: "plugin", pluginName: "plugin-x", tokens: 400 },
    ],
  },
  isAutoCompactEnabled: true,
};

const linea = (o: unknown) => JSON.stringify(o);
const TRANSCRIPT = [
  linea({ type: "user", cwd: "/proyectos/inventado", message: { role: "user", content: "hola" } }),
  linea({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 10, cache_creation_input_tokens: 18000, cache_read_input_tokens: 0 }, content: [{ type: "tool_use", name: "Bash", input: {} }] } }),
  linea({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 10, cache_creation_input_tokens: 18000, cache_read_input_tokens: 0 }, content: [{ type: "tool_use", name: "Skill", input: { skill: "skill-usada" } }] } }),
  linea({ type: "assistant", isSidechain: true, message: { id: "s1", usage: { input_tokens: 99999 }, content: [{ type: "tool_use", name: "WebFetch", input: {} }] } }),
  linea({ type: "user", message: { role: "user", content: [{ type: "text", text: "<command-name>/skill-usada</command-name>" }] } }),
  linea({ type: "assistant", message: { id: "m2", model: "claude-opus-5-5", usage: { input_tokens: 5, cache_creation_input_tokens: 2000, cache_read_input_tokens: 18010 }, content: [{ type: "tool_use", name: "mcp__falso__buscar", input: {} }, { type: "tool_use", name: "Bash", input: {} }] } }),
  "no es json",
];

test("usos: tool_use por herramienta, skills por Skill y por /comando, MCP por servidor y herramienta; sin subagentes", () => {
  const u = usosDe(TRANSCRIPT);
  assert.deepEqual(u.herramientas, { Bash: 2, Skill: 1 });
  assert.deepEqual(u.skills, { "skill-usada": 2 });
  assert.deepEqual(u.mcp, { falso: { buscar: 1 } });
});

test("desglose de un líder vivo: categorías juntas, MCP por servidor y herramienta, skills y memoria exactas, y lo que nunca se usó", () => {
  const d = desdeClaude(RESPUESTA, { id: "sid-x", usos: usosDe(TRANSCRIPT) });
  assert.equal(d.fuente, "claude");
  assert.equal(d.estimado, false);
  assert.equal(d.usado, 38200);
  assert.equal(d.ventana, 1000000);
  const cat = Object.fromEntries(d.categorias.filter((c) => !c.diferido).map((c) => [c.id, c.tokens]));
  assert.deepEqual(cat, { sistema: 3000, herramientas: 12000, mcp: 1000, memoria: 1500, skills: 700, mensajes: 20000, libre: 950000 });
  assert.deepEqual(d.categorias.filter((c) => c.diferido).map((c) => [c.id, c.tokens]), [["mcp", 5000]]);
  assert.deepEqual(d.mcp, [
    {
      servidor: "falso",
      tokens: 1000,
      usos: 1,
      instrucciones: 100,
      diferidos: 0,
      resultados: null,
      herramientas: [
        { nombre: "buscar", tokens: 600, cargada: true, usos: 1 },
        { nombre: "borrar", tokens: 300, cargada: true, usos: 0 },
      ],
    },
  ]);
  assert.deepEqual(d.sinUso, { herramientas: ["WebFetch"], mcp: [], skills: ["plugin-x:nunca"] });
  assert.deepEqual(d.memoria, [{ ruta: "/home/inventado/.claude/CLAUDE.md", tipo: "User", tokens: 1500, estimado: false }]);
  // Una respuesta vacía o rara no inventa nada.
  const raro = desdeClaude({ x: 1 }, { id: "s" });
  assert.equal(raro.usado, null);
  assert.deepEqual(raro.categorias, []);
});

test("desglose estimado desde el transcript: el primer pedido es lo fijo y lo que creció, mensajes", () => {
  assert.deepEqual(
    pedidosDe(TRANSCRIPT).map((p) => p.total),
    [18010, 20015],
  );
  const d = desdeTranscript(TRANSCRIPT, {
    tipo: "worker",
    id: "1234-5678",
    motor: "claude",
    memoria: [{ ruta: "/proyectos/inventado/CLAUDE.md", tipo: "Project", tokens: 1000, estimado: true }],
    skills: [{ nombre: "skill-usada", origen: "usuario", plugin: null, tokens: 50 }, { nombre: "otra", origen: "usuario", plugin: null, tokens: 30 }],
  });
  assert.equal(d.fuente, "transcript");
  assert.equal(d.estimado, true);
  assert.equal(d.usado, 20015);
  assert.equal(d.ventana, 1_000_000);
  assert.equal(d.ventanaEstimada, true);
  assert.deepEqual(
    d.categorias.map((c) => [c.id, c.tokens]),
    [["sistema", 16930], ["memoria", 1000], ["skills", 80], ["mensajes", 2005]],
  );
  assert.deepEqual(d.sinUso.skills, ["otra"]);
  assert.deepEqual(d.mcp.map((m) => [m.servidor, m.usos]), [["falso", 1]]);
  const vacio = desdeTranscript([], { tipo: "worker", id: "w", motor: "claude", memoria: [], skills: [] });
  assert.equal(vacio.motivo, "sin-uso");
  assert.equal(sinDesglose({ tipo: "lider", id: "s", motor: "gemini" }).fuente, "sin-desglose");
});

test("memoria de una sesión: usuario y de cwd hacia arriba, con imports de la misma carpeta, sin comentarios y sin los excluidos", async () => {
  const r = tmp();
  const proy = path.join(r, "proy");
  const claude = path.join(r, "claude");
  mkdirSync(path.join(proy, "sub"), { recursive: true });
  mkdirSync(claude, { recursive: true });
  writeFileSync(path.join(claude, "CLAUDE.md"), "x".repeat(350));
  writeFileSync(path.join(proy, "CLAUDE.md"), "<!-- stub -->\n@AGENTS.md");
  writeFileSync(path.join(proy, "AGENTS.md"), "y".repeat(700));
  writeFileSync(path.join(proy, "sub", "CLAUDE.local.md"), "z".repeat(35));
  const m = await memoriaDeSesion({ cwd: path.join(proy, "sub"), claudeDir: claude, excludes: [] });
  assert.deepEqual(
    m.map((f) => [path.relative(r, f.ruta), f.tokens]),
    [["claude/CLAUDE.md", 100], ["proy/sub/CLAUDE.local.md", 10], ["proy/CLAUDE.md", 200]],
  );
  const sin = await memoriaDeSesion({ cwd: path.join(proy, "sub"), claudeDir: claude, excludes: [`**/proy/CLAUDE.md`, path.join(claude, "CLAUDE.md")] });
  assert.deepEqual(sin.map((f) => path.relative(r, f.ruta)), ["proy/sub/CLAUDE.local.md"]);
  assert.ok(excluida("/a/b/CLAUDE.md", ["/a/*/CLAUDE.md"]));
  assert.ok(!excluida("/a/b/c/CLAUDE.md", ["/a/*/CLAUDE.md"]));
});

test("el pedido de /context y su respuesta viajan por el canal de control", () => {
  assert.deepEqual(JSON.parse(lineaContexto("c9")), { type: "control_request", request_id: "c9", request: { subtype: "get_context_usage", detail: "summary" } });
  const ev = parsearLinea(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "c9", response: RESPUESTA } }));
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0], { tipo: "control", id: "c9", ok: true, contexto: RESPUESTA });
});

test("catálogo de skills: clave con el plugin, estado (apagada por Trama o por su plugin), tokens estimados o exactos, búsqueda sin tildes", () => {
  const inv: Inventario = {
    version: 1,
    proyectos: [],
    items: [
      { id: "skill|usuario|diseño", tipo: "skill", nombre: "diseño", origen: "usuario", de: "", descripcion: "Pulir cómo se ve una interfaz", activo: true, conmutable: false },
      { id: "skill|plugin|px@m||hacer", tipo: "skill", nombre: "hacer", origen: "plugin", de: "px@m", descripcion: "Hace cosas", activo: true, conmutable: false },
      { id: "skill|plugin|py@m||apagada", tipo: "skill", nombre: "apagada", origen: "plugin", de: "py@m", descripcion: "", activo: false, conmutable: false },
      { id: "plugin|px@m|", tipo: "plugin", nombre: "px", origen: "usuario", de: "m", descripcion: "", activo: true, conmutable: true },
    ],
  };
  const c = catalogoSkills(inv, { ...vacios(), skills: ["px:hacer"] }, new Map([["diseño", 77]]));
  assert.deepEqual(
    c.map((s) => [s.clave, s.estado, s.tokens, s.tokensEstimado]),
    [["diseño", "activa", 77, false], ["px:hacer", "apagada", 7, true], ["py:apagada", "plugin-apagado", 4, true]],
  );
  assert.deepEqual(buscarSkills(c, "DISENO interfaz").map((s) => s.clave), ["diseño"]);
  assert.equal(buscarSkills(c, "").length, 3);
});
