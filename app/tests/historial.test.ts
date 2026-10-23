// electron/historial.ts y electron/historial-parser.ts: el registro de en qué se van los tokens,
// contra transcripts, `.sid` y un plugin inventados en un tmp. Un líder (con una skill de plugin, un
// servidor MCP, subagentes y una compactación), un worker de `pa` y un subagente; que la segunda
// pasada no relea nada, que lo que crece se lea una vez, y que nada de texto ni de rutas quede guardado.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearHistorial, desempacar, type Consulta, type PiezaConsulta } from "../electron/historial.ts";
import { calibrar, nombreArchivo, nombreHook, nombreProyecto, PARSER, type Sesion } from "../electron/historial-parser.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-historial-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const casa = path.join(tmp, "casa");
const claude = path.join(tmp, "claude");
const proyectos = path.join(claude, "projects");
const paState = path.join(tmp, "pa");
const carpeta = path.join(tmp, "estado", "historial");

// Dos días locales, al mediodía.
const D1 = new Date(2026, 2, 10, 12, 0, 0).getTime();
const D2 = new Date(2026, 2, 11, 12, 0, 0).getTime();
const DIA1 = "2026-03-10";
const DIA2 = "2026-03-11";
const CWD = path.join(casa, "Proyectos", "atlas");

type U = [number, number, number, number];
type Uso = { nombre: string; entrada?: Record<string, unknown> };
let n = 0;
const renglon = (d: Record<string, unknown>, ms: number, cwd = CWD) => JSON.stringify({ ...d, timestamp: new Date(ms).toISOString(), cwd }) + "\n";
const asistente = (id: string, modelo: string, [i, c, r, o]: U, ms: number, usos: Uso[] = [], cwd = CWD) =>
  renglon(
    {
      type: "assistant",
      message: {
        id,
        model: modelo,
        content: [{ type: "text", text: "TEXTO-DEL-MODELO" }, ...usos.map((u) => ({ type: "tool_use", id: `uso-${++n}`, name: u.nombre, input: u.entrada ?? {} }))],
        usage: { input_tokens: i, cache_creation_input_tokens: c, cache_read_input_tokens: r, output_tokens: o },
      },
    },
    ms,
    cwd,
  );
const adjunto = (tipo: string, resto: Record<string, unknown>, ms = D1) => renglon({ type: "attachment", attachment: { type: tipo, ...resto } }, ms);
const usuario = (texto: string, ms = D1, cwd = CWD) => renglon({ type: "user", message: { role: "user", content: texto } }, ms, cwd);

function escribir(archivo: string, texto: string) {
  mkdirSync(path.dirname(archivo), { recursive: true });
  writeFileSync(archivo, texto);
}

// Un plugin instalado: su hook se reconoce por el cartel que muestra.
const PLUGIN = path.join(claude, "plugins", "cache", "mercado", "brujula", "1.0.0");
escribir(path.join(claude, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "brujula@mercado": [{ installPath: PLUGIN }] } }));
escribir(
  path.join(PLUGIN, ".claude-plugin", "plugin.json"),
  JSON.stringify({ name: "brujula", hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node arranque.mjs", statusMessage: "Cargando brújula..." }] }] } }),
);

const LISTADO = "- brujula:norte: Dice para dónde queda el norte DESCRIPCION-DE-SKILL\n- resumir: Resume lo que se le pasa\n";
const HERRAMIENTAS = [
  { name: "Bash", description: "x".repeat(600), input_schema: { type: "object" } },
  { name: "Skill", description: "x".repeat(300), input_schema: { type: "object" } },
  { name: "mcp__correo__leer", description: "x".repeat(200), input_schema: { type: "object" } },
];
const LIDER = path.join(proyectos, "-tmp-casa-Proyectos-atlas", "lider-a.jsonl");
escribir(
  LIDER,
  adjunto("skill_listing", { content: LISTADO, isInitial: true, names: ["brujula:norte", "resumir"], skillCount: 2 }) +
    adjunto("instructions", {
      files: [
        { path: path.join(casa, "CLAUDE.md"), type: "User", content: "g".repeat(700) },
        { path: path.join(CWD, "CLAUDE.md"), type: "Project", content: "p".repeat(1400) },
      ],
    }) +
    adjunto("hook_success", { command: "Cargando brújula...", hookEvent: "SessionStart", hookName: "SessionStart:startup", content: "b".repeat(350), stdout: "" }) +
    adjunto("hook_success", { command: `${casa}/guiones/saludo.sh --ruta ${casa}/RUTA-SECRETA`, hookEvent: "SessionStart", hookName: "SessionStart:startup", content: "s".repeat(70) }) +
    adjunto("mcp_instructions_delta", { addedNames: ["correo"], addedBlocks: ["m".repeat(120)] }) +
    adjunto("deferred_tools_delta", { addedNames: ["mcp__correo__buscar", "WebFetch"], addedLines: ["mcp__correo__buscar", "WebFetch"] }) +
    adjunto("date", { content: "hoy" }) +
    usuario("MENSAJE-DE-ANA") +
    asistente("m1", "claude-opus-5-5", [10, 2000, 0, 5], D1, [{ nombre: "Skill", entrada: { skill: "brujula:norte", args: "ARGUMENTO" } }]) +
    adjunto("prompt_snapshot", { systemPrompt: ["y".repeat(3000), "z".repeat(500)], tools: HERRAMIENTAS }) +
    // El mismo mensaje, otro bloque: vale su último `usage`.
    asistente("m1", "claude-opus-5-5", [10, 2000, 0, 25], D1, [{ nombre: "mcp__correo__leer" }]) +
    asistente("m2", "claude-opus-5-5", [4, 0, 2010, 8], D1, [{ nombre: "Agent", entrada: { subagent_type: "explorador", prompt: "ENCARGO" } }, { nombre: "Agent", entrada: { prompt: "ENCARGO" } }]) +
    // Después del arranque: un CLAUDE.md de una subcarpeta, y el listado de skills otra vez tras compactar.
    adjunto("nested_memory", { path: path.join(CWD, "docs", "CLAUDE.md"), content: { path: path.join(CWD, "docs", "CLAUDE.md"), type: "Nested", content: "n".repeat(140) } }) +
    renglon({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto", preTokens: 150000 } }, D1) +
    adjunto("skill_listing", { content: LISTADO, isInitial: false, names: ["brujula:norte", "resumir"], skillCount: 2 }) +
    // Lo que el parser no conoce: se cuenta y se sigue.
    JSON.stringify({ type: "cosa-nueva", dato: 1 }) + "\n" +
    '{"type":"assistant", roto\n' +
    adjunto("invento_futuro", { content: "algo" }) +
    asistente("m3", "claude-opus-5-5", [6, 0, 2100, 9], D2, [{ nombre: "Skill", entrada: { skill: "suelta" } }]),
);

// Un subagente del líder: su tipo sale del `.meta.json`, nunca su encargo.
const SUB = path.join(proyectos, "-tmp-casa-Proyectos-atlas", "lider-a", "subagents");
escribir(path.join(SUB, "agent-abc.jsonl"), usuario("ENCARGO") + asistente("s1", "claude-haiku-5-5", [1, 0, 10, 1], D1, [{ nombre: "Read", entrada: { file_path: `${casa}/RUTA-SECRETA` } }]));
escribir(path.join(SUB, "agent-abc.meta.json"), JSON.stringify({ agentType: "explorador", description: "ENCARGO", model: "haiku" }));

// Un worker de `pa`: corre en un worktree, y su proyecto es el del registry. Con una línea más larga que un trozo.
const WT = "/tmp/wt/faro-20260310";
const WORKER = path.join(proyectos, "-tmp-wt-faro-20260310", "sid-w1.jsonl");
escribir(
  WORKER,
  usuario("TAREA", D1, WT) +
    asistente("w1", "claude-sonnet-5-5", [2, 20, 200, 2], D1, [{ nombre: "Bash" }], WT) +
    usuario("R".repeat(700_000), D1, WT) +
    asistente("w2", "claude-sonnet-5-5", [3, 0, 222, 3], D1, [{ nombre: "Bash" }], WT),
);
escribir(path.join(paState, "faro", "20260310-100000-111.sid"), "sid-w1\n");
escribir(path.join(paState, "faro", "20260310-100300-444.sid"), "../../etc/passwd");

const historial = crearHistorial({ proyectos, paState, carpeta, claude, casa });
after(() => historial.cerrar());

const pieza = (c: Consulta, clase: string, nombre: string): PiezaConsulta => {
  const p = c.piezas.find((x) => x.clase === clase && x.nombre === nombre);
  assert.ok(p, `falta ${clase} ${nombre}`);
  return p;
};
const guardado = (): string => readdirSync(carpeta).map((f) => readFileSync(path.join(carpeta, f), "utf8")).join("\n");
const sesiones = (): Record<string, Sesion> => desempacar(JSON.parse(readFileSync(path.join(carpeta, "2026-03.json"), "utf8"))) ?? {};

test("la primera pasada lee todo y la segunda no relee nada", async () => {
  const una = await historial.alDia();
  assert.equal(una.archivos, 3);
  assert.equal(una.leidos, 3);
  assert.equal(una.bytes, statSync(LIDER).size + statSync(WORKER).size + statSync(path.join(SUB, "agent-abc.jsonl")).size);
  const dos = await historial.alDia();
  assert.deepEqual([dos.archivos, dos.leidos, dos.bytes, dos.lineas], [3, 0, 0, 0]);
  assert.deepEqual(readdirSync(carpeta).sort(), ["2026-03.json", "indice.json"]);
});

test("quién es quién: líder, worker de pa (por su .sid) y subagente", () => {
  const s = sesiones();
  assert.deepEqual(Object.keys(s).sort(), ["lider-a", "lider-a/agent-abc", "sid-w1"]);
  assert.deepEqual([s["lider-a"].rol, s["lider-a"].proyecto, s["lider-a"].worker], ["lider", "atlas", null]);
  assert.deepEqual([s["sid-w1"].rol, s["sid-w1"].proyecto, s["sid-w1"].worker], ["worker", "faro", "20260310-100000-111"]);
  const sub = s["lider-a/agent-abc"];
  assert.deepEqual([sub.rol, sub.rolPadre, sub.tipo, sub.proyecto], ["subagente", "lider", "explorador", "atlas"]);
  assert.equal(s["lider-a"].inicio, D1);
  assert.equal(s["lider-a"].fin, D2);
  assert.deepEqual(s["lider-a"].arranque, { entrada: 10, cacheCreado: 2000, cacheLeido: 0 });
});

test("la consulta: tokens por modelo y por rol, exactos", async () => {
  const c = await historial.consultar(DIA1, DIA2);
  assert.equal(c.sesiones, 3);
  assert.deepEqual(c.modelos, {
    "claude-opus-5-5": { entrada: 20, cacheCreado: 2000, cacheLeido: 4110, salida: 42 },
    "claude-sonnet-5-5": { entrada: 5, cacheCreado: 20, cacheLeido: 422, salida: 5 },
    "claude-haiku-5-5": { entrada: 1, cacheCreado: 0, cacheLeido: 10, salida: 1 },
  });
  assert.deepEqual(c.roles.lider, { sesiones: 1, modelos: { "claude-opus-5-5": c.modelos["claude-opus-5-5"] } });
  assert.deepEqual(c.roles.worker, { sesiones: 1, modelos: { "claude-sonnet-5-5": c.modelos["claude-sonnet-5-5"] } });
  assert.deepEqual(c.roles.subagente, { sesiones: 1, modelos: { "claude-haiku-5-5": c.modelos["claude-haiku-5-5"] } });
  assert.deepEqual(c.arranque, { sesiones: 3, tokens: 2010 + 222 + 11 });
  assert.equal(c.compactaciones, 1);
});

test("la consulta: qué se usó (skills, MCP, subagentes, herramientas)", async () => {
  const c = await historial.consultar(DIA1, DIA2);
  assert.deepEqual(c.herramientas, { Skill: 2, mcp__correo__leer: 1, Agent: 2, Bash: 2, Read: 1 });
  assert.deepEqual(c.subagentes, { explorador: 1, "general-purpose": 1 });
  assert.deepEqual([pieza(c, "skill", "brujula:norte").usos, pieza(c, "skill", "brujula:norte").sesiones], [1, 1]);
  // Cargada y nunca usada; usada sin estar en ningún listado.
  assert.deepEqual([pieza(c, "skill", "resumir").usos, pieza(c, "skill", "resumir").sesiones], [0, 1]);
  assert.deepEqual([pieza(c, "skill", "suelta").usos, pieza(c, "skill", "suelta").sesiones, pieza(c, "skill", "suelta").peso], [1, 0, 0]);
  assert.equal(pieza(c, "mcp", "correo").usos, 1);
  assert.equal(pieza(c, "plugin", "brujula").usos, 1);
  // Su hook corrió una vez (con texto) en el rango: actúa por ganchos.
  assert.equal(pieza(c, "plugin", "brujula").ganchos, 1);
  assert.equal(pieza(c, "claudemd", "atlas/CLAUDE.md").usos, null);
});

test("la consulta: lo cargado, con su tamaño exacto y su peso estimado", async () => {
  const c = await historial.consultar(DIA1, DIA2);
  const renglones = LISTADO.split("\n");
  assert.equal(pieza(c, "skill", "brujula:norte").chars, renglones[0].length + 1);
  assert.equal(pieza(c, "skill", "resumir").chars, renglones[1].length + 1);
  // El plugin: su skill y lo que inyectó su hook.
  assert.equal(pieza(c, "plugin", "brujula").chars, renglones[0].length + 1 + 350);
  assert.equal(pieza(c, "claudemd", "~/CLAUDE.md").chars, 700);
  assert.equal(pieza(c, "claudemd", "atlas/CLAUDE.md").chars, 1400);
  assert.equal(pieza(c, "hook", "saludo.sh").chars, 70);
  assert.equal(pieza(c, "sistema", "sistema").chars, 3500);
  assert.equal(pieza(c, "herramientas", "herramientas").chars, JSON.stringify(HERRAMIENTAS[0]).length + JSON.stringify(HERRAMIENTAS[1]).length);
  // El servidor MCP: sus instrucciones, el nombre de su herramienta diferida y la definición de la cargada.
  assert.equal(pieza(c, "mcp", "correo").chars, 120 + "mcp__correo__buscar".length + 1 + JSON.stringify(HERRAMIENTAS[2]).length);
  assert.equal(pieza(c, "diferidas", "nombres").chars, "WebFetch".length + 1);
  // Calibrado contra el arranque exacto de la sesión: las piezas (sin contar dos veces la skill del plugin) pesan lo que pesó.
  const lider = sesiones()["lider-a"];
  const { k, calibrada } = calibrar(lider);
  assert.ok(calibrada && k > 2.5 && k < 4, `k = ${k}`);
  const suma = c.piezas.reduce((t, p) => t + p.peso, 0) - pieza(c, "skill", "brujula:norte").peso;
  assert.ok(Math.abs(suma - 2010) < 20, `suma = ${suma}`);
  assert.equal(pieza(c, "sistema", "sistema").peso, Math.round(3500 / k));
  // Lo cargado se relee en cada turno: tres mensajes del líder.
  assert.ok(Math.abs(pieza(c, "sistema", "sistema").pesoPorTurnos - Math.round((3500 / k) * 3)) <= 1);
  // Lo que se cargó después del arranque no pesa en él: va aparte.
  assert.deepEqual([pieza(c, "claudemd", "docs/CLAUDE.md").peso, pieza(c, "claudemd", "docs/CLAUDE.md").despues], [0, Math.round(140 / k)]);
  assert.equal(pieza(c, "skill", "resumir").despues, Math.round((renglones[1].length + 1) / k));
  assert.equal(pieza(c, "sistema", "sistema").despues, 0);
  // Piezas ordenadas por peso.
  assert.deepEqual(c.piezas.map((p) => p.peso), [...c.piezas.map((p) => p.peso)].sort((a, b) => b - a));
});

test("lo que no se sabe se dice: líneas sin reconocer y sesiones sin calibrar", async () => {
  const c = await historial.consultar(DIA1, DIA2);
  // La línea de un tipo nuevo, la rota y el adjunto que no existía.
  assert.equal(c.sinDato.lineas, 3);
  // El worker y el subagente no traen el sistema ni las herramientas: 3,5 caracteres por token.
  assert.equal(c.sinDato.sinCalibrar, 2);
  assert.deepEqual([c.sinDato.sinArranque, c.sinDato.parserViejo, c.sinDato.meses], [0, 0, 0]);
});

test("el rango de días: sólo lo de esos días", async () => {
  const c = await historial.consultar(DIA2, DIA2);
  assert.equal(c.sesiones, 1);
  assert.deepEqual(c.modelos, { "claude-opus-5-5": { entrada: 6, cacheCreado: 0, cacheLeido: 2100, salida: 9 } });
  assert.deepEqual(c.herramientas, { Skill: 1 });
  assert.equal(c.compactaciones, 0);
  assert.deepEqual([c.roles.worker.sesiones, c.roles.subagente.sesiones], [0, 0]);
  assert.equal((await historial.consultar("2026-04-01", "2026-04-30")).sesiones, 0);
  await assert.rejects(historial.consultar("ayer", DIA2));
  await assert.rejects(historial.consultar(DIA2, DIA1));
});

test("la consulta de un rol: sólo sus sesiones; lo que llega del renderer no se cree", async () => {
  const w = await historial.consultar(DIA1, DIA2, "worker");
  assert.deepEqual([w.rol, w.sesiones, w.roles.worker.sesiones, w.roles.lider.sesiones], ["worker", 1, 1, 0]);
  assert.deepEqual(Object.keys(w.modelos), ["claude-sonnet-5-5"]);
  assert.equal((await historial.consultar(DIA1, DIA2)).rol, null);
  // `ultimos` (el canal historial:consultar): cualquier cosa rara es 7 días y sin rol; un error vuelve como dato.
  const u = await historial.ultimos("raro", { x: 1 });
  assert.ok("sesiones" in u && u.rol === null);
  const u30 = await historial.ultimos(30, "worker");
  assert.ok("sesiones" in u30 && u30.rol === "worker");
  assert.ok(u30.desde < u.desde);
});

test("sólo números y nombres: ni texto de mensajes ni rutas", () => {
  const todo = guardado();
  for (const prohibido of [casa, tmp, "MENSAJE-DE-ANA", "TEXTO-DEL-MODELO", "DESCRIPCION-DE-SKILL", "RUTA-SECRETA", "ARGUMENTO", "ENCARGO", "TAREA", "guiones", "/tmp/wt", "-tmp-casa"])
    assert.ok(!todo.includes(prohibido), `quedó guardado "${prohibido}"`);
  // Un hook suelto se llama como su script; uno que no tiene script, como su evento. Nunca su comando.
  assert.deepEqual(nombreHook("/home/ana/x/saludo.sh --ruta /home/ana/y", "SessionStart", new Map()), { clase: "hook", nombre: "saludo.sh" });
  assert.deepEqual(nombreHook("echo hola > /home/ana/z", "SessionStart", new Map()), { clase: "hook", nombre: "SessionStart" });
  assert.deepEqual(nombreHook("node /home/ana/.claude/plugins/cache/mercado/faro/2.0/hooks/a.js", "Stop", new Map()), { clase: "plugin", nombre: "faro" });
  // El worktree de un worker es su proyecto.
  assert.equal(nombreArchivo("/home/ana/wt/faro@2/CLAUDE.md", "/home/ana"), "faro/CLAUDE.md");
  assert.equal(nombreArchivo("/home/ana/CLAUDE.md", "/home/ana"), "~/CLAUDE.md");
  assert.deepEqual([nombreProyecto("/home/ana/wt/faro@12", "/home/ana"), nombreProyecto("/home/ana", "/home/ana")], ["faro", "~"]);
});

test("un transcript que crece: se lee sólo lo nuevo, y una línea a medio escribir espera", async () => {
  const nuevo = asistente("m4", "claude-opus-5-5", [1, 0, 2200, 4], D2, [{ nombre: "Bash" }]);
  const medio = asistente("m5", "claude-opus-5-5", [1, 0, 2300, 2], D2);
  appendFileSync(LIDER, nuevo + medio.slice(0, 40));
  const p = await historial.alDia();
  assert.deepEqual([p.leidos, p.bytes], [1, nuevo.length + 40]);
  let c = await historial.consultar(DIA2, DIA2);
  assert.deepEqual(c.modelos["claude-opus-5-5"], { entrada: 7, cacheCreado: 0, cacheLeido: 4300, salida: 13 });
  assert.deepEqual(c.herramientas, { Skill: 1, Bash: 1 });
  // Sin crecer, la línea a medias no se vuelve a leer.
  assert.equal((await historial.alDia()).bytes, 0);
  appendFileSync(LIDER, medio.slice(40));
  assert.equal((await historial.alDia()).bytes, medio.length);
  c = await historial.consultar(DIA2, DIA2);
  assert.deepEqual(c.modelos["claude-opus-5-5"], { entrada: 8, cacheCreado: 0, cacheLeido: 6600, salida: 15 });
  // El arranque es el del primer mensaje: no cambia.
  assert.equal(c.arranque.tokens, 2010);
});

test("otro proceso sigue desde donde quedó, y sin índice no se cuenta dos veces", async () => {
  const antes = await historial.consultar(DIA1, DIA2);
  const otro = crearHistorial({ proyectos, paState, carpeta, claude, casa });
  assert.equal((await otro.alDia()).bytes, 0);
  rmSync(path.join(carpeta, "indice.json"));
  const p = await otro.alDia();
  assert.equal(p.leidos, 3);
  const despues = await otro.consultar(DIA1, DIA2);
  assert.deepEqual(despues, antes);
});

test("un parser nuevo indexa de nuevo; lo que ya no tiene transcript queda, y se dice", async () => {
  const mes = path.join(carpeta, "2026-03.json");
  const d = JSON.parse(readFileSync(mes, "utf8"));
  for (const s of Object.values(d.sesiones) as Sesion[]) s.parser = PARSER - 1;
  d.sesiones["vieja"] = { ...d.sesiones["sid-w1"], sid: "vieja" };
  writeFileSync(mes, JSON.stringify(d));
  const indice = JSON.parse(readFileSync(path.join(carpeta, "indice.json"), "utf8"));
  indice.parser = PARSER - 1;
  writeFileSync(path.join(carpeta, "indice.json"), JSON.stringify(indice));
  const otro = crearHistorial({ proyectos, paState, carpeta, claude, casa });
  assert.equal((await otro.alDia()).leidos, 3);
  const c = await otro.consultar(DIA1, DIA2);
  assert.equal(c.sesiones, 3);
  assert.equal(c.sinDato.parserViejo, 1);
  assert.deepEqual(c.modelos["claude-sonnet-5-5"], { entrada: 5, cacheCreado: 20, cacheLeido: 422, salida: 5 });
});

test("un mes que este build no entiende no se pisa ni se cuenta", async () => {
  const aparte = path.join(tmp, "estado-3", "historial");
  mkdirSync(aparte, { recursive: true });
  const futuro = JSON.stringify({ version: 99, algo: "de otro build" });
  writeFileSync(path.join(aparte, "2026-03.json"), futuro);
  const h = crearHistorial({ proyectos, paState, carpeta: aparte, claude, casa });
  await h.alDia();
  assert.equal(readFileSync(path.join(aparte, "2026-03.json"), "utf8"), futuro);
  const c = await h.consultar(DIA1, DIA2);
  assert.deepEqual([c.sesiones, c.sinDato.meses], [0, 1]);
});

test("Claude Code borra un transcript: lo indexado queda", async () => {
  rmSync(WORKER);
  const p = await historial.alDia();
  assert.deepEqual([p.archivos, p.leidos], [2, 0]);
  const indice = JSON.parse(readFileSync(path.join(carpeta, "indice.json"), "utf8"));
  assert.deepEqual(Object.keys(indice.archivos).sort(), ["lider-a", "lider-a/agent-abc"]);
  const c = await historial.consultar(DIA1, DIA1);
  assert.equal(c.roles.worker.sesiones, 1);
  assert.deepEqual(c.modelos["claude-sonnet-5-5"], { entrada: 5, cacheCreado: 20, cacheLeido: 422, salida: 5 });
});

test("pedir: una pasada sola, sin reloj que quede, y no más de una por hora", async () => {
  const aparte = path.join(tmp, "estado-2", "historial");
  let t = 1_000_000;
  const h = crearHistorial({ proyectos, paState, carpeta: aparte, claude, casa, ahora: () => t, esperaMs: 5 });
  after(() => h.cerrar());
  const indice = path.join(aparte, "indice.json");
  const existe = () => {
    try {
      return statSync(indice).mtimeMs;
    } catch {
      return 0;
    }
  };
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  h.pedir();
  h.pedir();
  for (let i = 0; i < 200 && !existe(); i++) await espera(10);
  const primera = existe();
  assert.ok(primera > 0);
  appendFileSync(LIDER, asistente("m6", "claude-opus-5-5", [1, 0, 1, 1], D2));
  // A los diez minutos no sale otra; pasada la hora, sí.
  t += 600_000;
  h.pedir();
  await espera(60);
  assert.equal(existe(), primera);
  t += 3_600_000;
  h.pedir();
  for (let i = 0; i < 200 && existe() === primera; i++) await espera(10);
  assert.ok(existe() > primera);
});
