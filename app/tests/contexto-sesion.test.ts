// El panel de contexto con una sesión como las de verdad, con todo inventado: servidores MCP con las herramientas diferidas (sólo el nombre
// está en la ventana), la herramienta Skill, un hook de inicio que activa una skill, CLAUDE.md y MEMORY.md. Que lo medido nunca pase de su
// categoría, que el número no cambie al refrescar y que el sistema se parta en lo que se puede.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  desdeClaude,
  desdeTranscript,
  medirConRespaldo,
  usosDe,
  type Desglose,
  type Medicion,
} from "../electron/contexto-desglose.ts";
import { hooksDeInicio, leerSesion, piezasSistema, skillsPorHook, topar } from "../electron/contexto-sesion.ts";

const L = (o: unknown) => JSON.stringify(o);
const x = (n: number, c = "x") => c.repeat(n);

/** Un `/context` con servidores MCP diferidos: sus definiciones pesan mucho pero no están en la ventana. */
const RESPUESTA = {
  categories: [
    { id: "system_prompt", name: "System prompt", tokens: 24000, kind: "used" },
    { id: "system_tools", name: "System tools", tokens: 11000, kind: "used" },
    { id: "mcp_tools", name: "MCP tools", tokens: 1000, kind: "used" },
    { id: "mcp_instructions", name: "MCP server instructions", tokens: 159, kind: "used" },
    { id: "mcp_tools_deferred", name: "MCP tools (deferred)", tokens: 160153, kind: "deferred" },
    { id: "memory_files", name: "Memory files", tokens: 5000, kind: "used" },
    { id: "skills", name: "Skills", tokens: 900, kind: "used" },
    { id: "messages", name: "Messages", tokens: 30000, kind: "used" },
    { id: "free_space", name: "Free space", tokens: 900000, kind: "free" },
  ],
  totalTokens: 72059,
  rawMaxTokens: 1_000_000,
  model: "claude-opus-5-5",
  memoryFiles: [
    { path: "/casa/inventada/.claude/CLAUDE.md", type: "User", tokens: 3000 },
    { path: "/casa/inventada/proy/CLAUDE.md", type: "Project", tokens: 2000 },
  ],
  mcpTools: [
    { name: "mcp__claude_ai_Nube__buscar", serverName: "claude_ai_Nube", tokens: 80000, isLoaded: false },
    { name: "mcp__claude_ai_Nube__crear", serverName: "claude_ai_Nube", tokens: 44566, isLoaded: false },
    { name: "mcp__claude_ai_Correo__leer", serverName: "claude_ai_Correo", tokens: 35587, isLoaded: false },
    { name: "mcp__claude_ai_Correo__mandar", serverName: "claude_ai_Correo", tokens: 700, isLoaded: true },
    { name: "mcp__local__ping", serverName: "local", tokens: 300, isLoaded: true },
  ],
  mcpInstructions: [{ serverName: "claude.ai Nube", tokens: 59 }, { serverName: "local", tokens: 100 }],
  systemTools: [{ name: "Bash", tokens: 4000 }, { name: "Skill", tokens: 300 }],
  skills: {
    skillFrontmatter: [
      { name: "caveman:caveman", source: "plugin", pluginName: "caveman", tokens: 400 },
      { name: "resumir", source: "user", tokens: 300 },
      { name: "olvidada", source: "user", tokens: 200 },
    ],
  },
};

const SHAPE = {
  type: "api-request-shape",
  shape: {
    system: [{ type: "text", text: "Sos un agente de prueba." }, { type: "text", text: x(3500, "p") }],
    tools: [
      { name: "Bash", description: x(700), input_schema: { type: "object" } },
      { name: "Skill", description: x(300), input_schema: { type: "object" } },
      { name: "mcp__local__ping", description: x(140), input_schema: { type: "object" } },
    ],
  },
};
const adj = (a: Record<string, unknown>, extra: Record<string, unknown> = {}) => L({ type: "attachment", attachment: a, ...extra });

const TRANSCRIPT = [
  adj({ type: "hook_success", hookName: "SessionStart:startup", hookEvent: "SessionStart", command: "Loading caveman mode...", content: `CAVEMAN MODE ACTIVE\n${x(700)}` }),
  L(SHAPE),
  adj({ type: "instructions", files: [{ path: "/casa/inventada/.claude/CLAUDE.md", type: "User", content: x(700) }, { path: "/casa/inventada/proy/CLAUDE.md", type: "Project", content: x(350) }, { path: "/casa/inventada/.claude/projects/p/memory/MEMORY.md", type: "AutoMem", content: x(210) }] }),
  adj({ type: "mcp_instructions_delta", addedNames: ["claude.ai Nube", "local"], addedBlocks: [x(210), x(350)], removedNames: [] }),
  adj({ type: "deferred_tools_delta", addedNames: ["mcp__claude_ai_Nube__buscar", "mcp__claude_ai_Nube__crear", "mcp__claude_ai_Correo__leer", "WebFetch"], addedLines: [], removedNames: [] }),
  adj({ type: "agent_listing_delta", addedTypes: ["a"], addedLines: [x(70)] }),
  L({ type: "user", cwd: "/proy", message: { role: "user", content: "hola" } }),
  L({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 5, cache_creation_input_tokens: 9000, cache_read_input_tokens: 0 }, content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "resumir" } }, { type: "tool_use", id: "t2", name: "mcp__local__ping", input: {} }] } }),
  L({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: x(700) }] }] } }),
  adj({ type: "hook_additional_context", hookName: "UserPromptSubmit", hookEvent: "UserPromptSubmit", content: ["CAVEMAN MODE ACTIVE (ultracave)."] }),
  adj({ type: "deferred_tools_record", entries: [{ name: "mcp__claude_ai_Nube__buscar", description: "d", input_schema: { type: "object", x: x(350) }, defer_loading: true }] }),
  L({ type: "assistant", message: { id: "m2", model: "claude-opus-5-5", usage: { input_tokens: 5, cache_creation_input_tokens: 1000, cache_read_input_tokens: 9000 }, content: [{ type: "tool_use", id: "t3", name: "mcp__claude_ai_Nube__buscar", input: {} }] } }),
];

const suma = (xs: (number | null)[]) => xs.reduce<number>((n, v) => n + (v ?? 0), 0);
const tope = (d: Desglose, id: string) => d.categorias.filter((c) => c.id === id && !c.diferido).reduce((n, c) => n + c.tokens, 0);

test("MCP diferidas: sólo suma lo cargado, nunca más que la categoría, y las diferidas se dicen aparte", () => {
  const d = desdeClaude(RESPUESTA, { id: "s", usos: usosDe(TRANSCRIPT), info: leerSesion(TRANSCRIPT) });
  const tokens = suma(d.mcp.map((m) => m.tokens));
  assert.ok(tokens <= tope(d, "mcp"), `${tokens} > ${tope(d, "mcp")}`);
  const nube = d.mcp.find((m) => m.servidor === "claude_ai_Nube");
  assert.deepEqual([nube?.tokens, nube?.diferidos, nube?.instrucciones], [59, 124566, 59]);
  const correo = d.mcp.find((m) => m.servidor === "claude_ai_Correo");
  assert.deepEqual([correo?.tokens, correo?.diferidos], [700, 35587]);
  // Las diferidas quedan marcadas y no suman al total del servidor.
  assert.deepEqual(nube?.herramientas.map((h) => h.cargada), [false, false]);
  // El mapa de bloques de la vista usa `tokens`: ningún servidor llega a los 124 mil.
  assert.ok(Math.max(...d.mcp.map((m) => m.tokens ?? 0)) < 1000);
});

test("lo contado nunca pasa de su categoría aunque las partes midan más (se achica parejo)", () => {
  const demas = { ...RESPUESTA, mcpTools: [{ name: "mcp__a__b", serverName: "a", tokens: 5000, isLoaded: true }, { name: "mcp__a__c", serverName: "a", tokens: 5000, isLoaded: true }], systemTools: [{ name: "Bash", tokens: 20000 }], memoryFiles: [{ path: "/m", type: "User", tokens: 9000 }] };
  const d = desdeClaude(demas, { id: "s" });
  assert.ok(suma(d.mcp.map((m) => m.tokens)) <= tope(d, "mcp"));
  assert.ok(suma(d.herramientas.map((h) => h.tokens)) <= tope(d, "herramientas"));
  assert.ok(suma(d.memoria.map((m) => m.tokens)) <= tope(d, "memoria"));
  const xs = [{ n: 6 }, { n: 4 }];
  topar(xs, (o) => o.n, (o, n) => void (o.n = n), 5);
  assert.ok(xs[0].n + xs[1].n <= 5);
  topar(xs, (o) => o.n, (o, n) => void (o.n = n), 100);
  assert.ok(xs[0].n + xs[1].n <= 5);
});

test("refrescar: el mismo número si el líder no contesta (queda la última medición, marcada)", async () => {
  const cache = new Map<string, Medicion>();
  let reloj = 1_000;
  const a = await medirConRespaldo(cache, "s", async () => RESPUESTA, () => reloj);
  reloj += 60_000;
  const b = await medirConRespaldo(cache, "s", async () => null, () => reloj);
  assert.equal(a?.viejo, false);
  assert.equal(b?.viejo, true);
  assert.equal(b?.en, 1_000);
  const da = desdeClaude(a?.resp, { id: "s", info: leerSesion(TRANSCRIPT), medidoEn: a?.en, desactualizado: a?.viejo });
  const db = desdeClaude(b?.resp, { id: "s", info: leerSesion(TRANSCRIPT), medidoEn: b?.en, desactualizado: b?.viejo });
  assert.deepEqual({ ...db, desactualizado: false }, { ...da, desactualizado: false });
  assert.equal(db.desactualizado, true);
  // Sin medición previa, o muy vieja, no se inventa.
  assert.equal(await medirConRespaldo(new Map(), "otro", async () => null), null);
  reloj += 7 * 3600_000;
  assert.equal(await medirConRespaldo(cache, "s", async () => null, () => reloj), null);
  // Un error al leer cuenta como que no contestó.
  assert.equal(await medirConRespaldo(new Map(), "z", async () => Promise.reject(new Error("x"))), null);
});

test("sistema: se parte en prompt, hook de inicio y lista de diferidas, y no pasa de su categoría", () => {
  const info = leerSesion(TRANSCRIPT);
  const piezas = piezasSistema(info);
  assert.deepEqual(piezas.map((p) => p.tipo), ["prompt", "hook", "diferidas"]);
  assert.ok(piezas[0].tokens > 900);
  assert.ok(piezas[1].texto?.startsWith("CAVEMAN MODE ACTIVE"));
  assert.equal(piezas[1].detalle, "SessionStart");
  // El hook de cada mensaje no es de inicio.
  assert.equal(hooksDeInicio(info).length, 1);
  const d = desdeClaude(RESPUESTA, { id: "s", info });
  assert.ok(suma(d.sistema.map((s) => s.tokens)) <= tope(d, "sistema"));
  const chico = desdeClaude({ ...RESPUESTA, categories: RESPUESTA.categories.map((c) => (c.id === "system_prompt" ? { ...c, tokens: 100 } : c)) }, { id: "s", info });
  assert.ok(suma(chico.sistema.map((s) => s.tokens)) <= 100);
  // El texto largo se corta y lo dice.
  const largo = piezasSistema(leerSesion([L({ type: "attachment", attachment: { type: "hook_success", hookName: "SessionStart:x", hookEvent: "SessionStart", command: "c", content: x(9000) } })]));
  assert.equal(largo[0].texto?.length, 4000);
  assert.equal(largo[0].truncado, true);
});

test("skills: la que entra por hook se ve 'cargada por hook', no 'nunca usada'; la que se llamó por Skill cuenta como usada", () => {
  const info = leerSesion(TRANSCRIPT);
  assert.deepEqual(skillsPorHook(info.hooks, ["caveman:caveman", "resumir", "olvidada", "ia"]), { "caveman:caveman": 2 });
  const d = desdeClaude(RESPUESTA, { id: "s", usos: usosDe(TRANSCRIPT), info });
  const por = Object.fromEntries(d.skills.map((s) => [s.nombre, [s.usos, s.hook]]));
  assert.deepEqual(por, { "caveman:caveman": [0, 2], resumir: [1, 0], olvidada: [0, 0] });
  assert.deepEqual(d.sinUso.skills, ["olvidada"]);
  assert.deepEqual(d.usos.hook, { "caveman:caveman": 2 });
});

test("transcript: herramientas, MCP cargado (más lo buscado), memoria con MEMORY.md, agentes, sistema y resultados de MCP en los mensajes", () => {
  const d = desdeTranscript(TRANSCRIPT, {
    tipo: "worker",
    id: "w",
    motor: "claude",
    memoria: [],
    skills: [{ nombre: "resumir", origen: "usuario", plugin: null, tokens: 40 }, { nombre: "caveman:caveman", origen: "plugin", plugin: "caveman", tokens: 60 }],
  });
  assert.equal(d.usado, 10_005);
  const cat = Object.fromEntries(d.categorias.map((c) => [c.id, c.tokens]));
  assert.equal(suma(Object.values(cat)), 10_005);
  assert.ok(cat.herramientas > 0 && cat.mcp > 0 && cat.memoria > 0 && cat.agentes > 0 && cat.sistema > 0);
  assert.deepEqual(d.memoria.map((m) => m.tipo), ["User", "Project", "AutoMem"]);
  // Lo medido por ítem nunca pasa de su categoría.
  assert.ok(suma(d.mcp.map((m) => m.tokens)) <= cat.mcp);
  assert.ok(suma(d.herramientas.map((h) => h.tokens)) <= cat.herramientas);
  assert.ok(suma(d.sistema.map((s) => s.tokens)) <= cat.sistema);
  const local = d.mcp.find((m) => m.servidor === "local");
  assert.ok((local?.resultados ?? 0) >= 200, "los resultados del servidor se miden aparte");
  const nube = d.mcp.find((m) => m.servidor === "claude_ai_Nube");
  assert.equal(nube?.herramientas.find((h) => h.nombre === "buscar")?.cargada, true);
  assert.equal(nube?.herramientas.find((h) => h.nombre === "crear")?.cargada, false);
  assert.deepEqual(d.usos.hook, { "caveman:caveman": 2 });
  // Una exclusión vigente saca el archivo aunque esa sesión lo haya cargado.
  const sin = desdeTranscript(TRANSCRIPT, { tipo: "worker", id: "w", motor: "claude", memoria: [], skills: [], excludes: ["/casa/inventada/proy/CLAUDE.md"] });
  assert.deepEqual(sin.memoria.map((m) => m.tipo), ["User", "AutoMem"]);
});

test("el mismo transcript da los mismos números las veces que se mida", () => {
  const pedir = () => desdeTranscript(TRANSCRIPT, { tipo: "lider", id: "s", motor: "claude", memoria: [], skills: [] });
  assert.deepEqual(pedir(), pedir());
});

test("una compactación vacía los resultados de MCP que quedaban en los mensajes", () => {
  const sin = leerSesion([...TRANSCRIPT.slice(0, 9), L({ type: "system", subtype: "compact_boundary" })]);
  assert.deepEqual(sin.resultadosMcp, {});
});

test("catálogo: usos de todas las sesiones recientes (Skill, /comando y plugin con hook), y sin dato no se afirma nada", async () => {
  const { usosDeHistorial } = await import("../electron/skills-catalogo.ts");
  const lista = [
    { clave: "caveman:caveman", nombre: "caveman", origen: "plugin" as const, de: "caveman@mercado" },
    { clave: "caveman:compress", nombre: "compress", origen: "plugin" as const, de: "caveman@mercado" },
    { clave: "resumir", nombre: "resumir", origen: "usuario" as const, de: "" },
  ];
  const consulta = {
    sesiones: 12,
    piezas: [
      { clase: "skill", nombre: "resumir", usos: 3, ganchos: 0 },
      { clase: "skill", nombre: "olvidada", usos: 0, ganchos: 0 },
      { clase: "plugin", nombre: "caveman", usos: null, ganchos: 40 },
    ],
    comandos: { resumir: 2, "caveman:compress": 1 },
  };
  const u = usosDeHistorial(consulta, lista);
  assert.deepEqual(u?.skills, { resumir: 5, "caveman:compress": 1 });
  assert.deepEqual(u?.porHook, ["caveman:caveman"]);
  assert.equal(u?.sesiones, 12);
  // Sin sesiones, con error o con algo raro: no se sabe.
  assert.equal(usosDeHistorial({ ...consulta, sesiones: 0 }, lista), null);
  assert.equal(usosDeHistorial({ version: 1, error: "x" }, lista), null);
  assert.equal(usosDeHistorial(null, lista), null);
});
