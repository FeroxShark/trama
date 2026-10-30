// La vista previa del panel de contexto (electron/contexto-previa.ts) y la captura del prompt base por versión (electron/contexto-base.ts).
// Todo con fixtures inventados en carpetas temporales y un `claude` falso: nada corre de verdad, ni se toca el ~/.claude de nadie.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { vacios } from "../electron/apagados.ts";
import type { Inventario } from "../electron/conectores-claude.ts";
import { archivoBase, baseDeTranscript, capturarBase, guardarBase, leerBases, type BaseClaude, type Salida } from "../electron/contexto-base.ts";
import { elegirBase, vistaPrevia, ventanaDe } from "../electron/contexto-previa.ts";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "trama-previa-"));
const L = (o: unknown) => JSON.stringify(o);

const PARTES = ["Prefijo inventado.", "Sos un asistente de prueba.\n\n# Harness\n - una regla inventada", "# Environment\n - datos inventados"];
const HERRAMIENTAS = [
  { nombre: "Bash", tokens: 1000 },
  { nombre: "Read", tokens: 500 },
  { nombre: "WebFetch", tokens: 300 },
];
const base = (version: string, capturadoEn: number): BaseClaude => ({ version, capturadoEn, modelo: "claude-haiku-5-5", partes: PARTES, herramientas: HERRAMIENTAS, diferidas: ["CronCreate", "WebFetch"] });

/** Un transcript como el que deja `claude -p ok`: el pedido con sus herramientas, el snapshot del prompt y un mensaje del modelo. */
const transcript = (version: string) => [
  L({ type: "api-request-shape", version, shape: { system: [{ type: "text", text: PARTES[0] }, { type: "text", text: PARTES.slice(1).join("\n") }], tools: HERRAMIENTAS.map((h) => ({ name: h.nombre, description: "d".repeat(Math.round(h.tokens * 3.5)), input_schema: {} })) } }),
  L({ type: "attachment", attachment: { type: "prompt_snapshot", systemPrompt: PARTES } }),
  L({ type: "attachment", attachment: { type: "deferred_tools_delta", addedNames: ["CronCreate", "mcp__srv__algo"], removedNames: [] } }),
  L({ type: "assistant", message: { id: "m1", model: "claude-haiku-5-5", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 10 } } }),
];

test("base: se guarda por versión, sin repetir, con un tope, y un archivo roto cuenta como vacío", async () => {
  const dir = tmp();
  assert.deepEqual(await leerBases(dir), {});
  writeFileSync(archivoBase(dir), "{ no es json");
  assert.deepEqual(await leerBases(dir), {});
  for (let i = 0; i < 8; i++) await guardarBase(base(`2.1.${300 + i}`, 1000 + i), dir);
  const r = await leerBases(dir);
  assert.equal(Object.keys(r).length, 6);
  assert.ok(r["2.1.307"] && !r["2.1.300"]);
  assert.deepEqual(r["2.1.307"].herramientas, HERRAMIENTAS);
  // Sólo el prompt y las herramientas: nada más viaja al archivo.
  const crudo = JSON.parse(readFileSync(archivoBase(dir), "utf8"));
  assert.deepEqual(Object.keys(crudo.bases["2.1.307"]).sort(), ["capturadoEn", "diferidas", "herramientas", "modelo", "partes", "version"]);
});

test("base: sale de un transcript (versión, partes, herramientas integradas y diferidas sin MCP)", () => {
  const b = baseDeTranscript(transcript("2.1.999"), 5)!;
  assert.equal(b.version, "2.1.999");
  assert.equal(b.modelo, "claude-haiku-5-5");
  assert.deepEqual(b.partes, PARTES);
  assert.deepEqual(b.herramientas.map((h) => h.nombre), ["Bash", "Read", "WebFetch"]);
  assert.deepEqual(b.diferidas, ["CronCreate"]);
  // Sin versión o sin pedido, no hay base.
  assert.equal(baseDeTranscript([L({ type: "api-request-shape", shape: { system: [{ type: "text", text: "x" }], tools: [] } })]), null);
  assert.equal(baseDeTranscript([]), null);
});

/** Un `claude` falso: dice su versión y, al correr `-p ok`, escribe el transcript de la sesión pedida en la carpeta de proyectos. */
function claudeFalso(claudeDir: string, version = "2.1.314", fallaHaiku = false) {
  const llamadas: string[][] = [];
  const correr = async (_file: string, args: string[], env: NodeJS.ProcessEnv, _v: boolean, cwd: string): Promise<Salida> => {
    llamadas.push(args);
    assert.ok(!Object.keys(env).some((k) => /^ANTHROPIC_/.test(k)), "nunca la clave de API");
    if (args[0] === "--version") return { code: 0, stdout: `${version} (Claude Code)\n`, stderr: "", tiempo: false, noExiste: false };
    if (fallaHaiku && args.includes("haiku")) return { code: 1, stdout: "", stderr: "modelo desconocido", tiempo: false, noExiste: false };
    const sid = args[args.indexOf("--session-id") + 1];
    const carpeta = path.join(claudeDir, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
    mkdirSync(path.join(carpeta, "memory"), { recursive: true });
    writeFileSync(path.join(carpeta, `${sid}.jsonl`), transcript(version).join("\n"));
    return { code: 0, stdout: "{}", stderr: "", tiempo: false, noExiste: false };
  };
  return { correr, llamadas };
}

test("capturar: corre `claude -p ok` en una carpeta vacía, guarda sólo prompt y herramientas y limpia lo que dejó", async () => {
  const claudeDir = tmp();
  const dirTrama = tmp();
  const tmpBase = tmp();
  const f = claudeFalso(claudeDir);
  const b = await capturarBase({ claudeDir, dirTrama, tmp: tmpBase, correr: f.correr, env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "no-va" }, home: tmpBase, plat: "linux", esEjecutable: () => false });
  assert.equal(b.version, "2.1.314");
  assert.deepEqual(b.partes, PARTES);
  assert.deepEqual(Object.keys(await leerBases(dirTrama)), ["2.1.314"]);
  // Con el modelo más chico y sin servidores MCP.
  const p = f.llamadas.find((a) => a[0] === "-p")!;
  assert.deepEqual(p.slice(0, 2), ["-p", "ok"]);
  assert.ok(p.includes("haiku") && p.includes("--strict-mcp-config"));
  // Nada queda: ni el transcript, ni la carpeta de proyecto de la corrida, ni la carpeta temporal.
  assert.deepEqual(existsSync(path.join(claudeDir, "projects")) ? readdirSync(path.join(claudeDir, "projects")) : [], []);
  assert.deepEqual(readdirSync(tmpBase).filter((n) => n.startsWith("trama-base-")), []);
  // Una vez por versión: la segunda vez no corre nada más que la pregunta de la versión.
  const otra = claudeFalso(claudeDir);
  await capturarBase({ claudeDir, dirTrama, tmp: tmpBase, correr: otra.correr, env: {}, home: tmpBase, plat: "linux", esEjecutable: () => false });
  assert.deepEqual(otra.llamadas.map((a) => a[0]), ["--version"]);
});

test("capturar: si el modelo chico no se acepta prueba con el de siempre; sin claude o sin transcript avisa", async () => {
  const claudeDir = tmp();
  const f = claudeFalso(claudeDir, "2.1.400", true);
  const d = { claudeDir, dirTrama: tmp(), tmp: tmp(), correr: f.correr, env: {}, home: tmp(), plat: "linux" as const, esEjecutable: () => false };
  const b = await capturarBase(d);
  assert.equal(b.version, "2.1.400");
  assert.deepEqual(f.llamadas.filter((a) => a[0] === "-p").map((a) => a.includes("haiku")), [true, false]);
  await assert.rejects(capturarBase({ ...d, dirTrama: tmp(), correr: async () => ({ code: null, stdout: "", stderr: "", tiempo: false, noExiste: true }) }), /baseSinClaude/);
  await assert.rejects(
    capturarBase({ ...d, dirTrama: tmp(), correr: async (_f, a) => ({ code: 0, stdout: a[0] === "--version" ? "2.1.1" : "{}", stderr: "", tiempo: false, noExiste: false }) }),
    /baseSinTranscript/,
  );
});

test("base: la de la versión instalada manda; si no, la más nueva (vieja); sin ninguna, falta", () => {
  const bs = { "2.1.1": base("2.1.1", 10), "2.1.2": base("2.1.2", 20) };
  assert.deepEqual([elegirBase(bs, "2.1.1").base?.version, elegirBase(bs, "2.1.1").estado], ["2.1.1", "lista"]);
  assert.deepEqual([elegirBase(bs, "2.1.9").base?.version, elegirBase(bs, "2.1.9").estado], ["2.1.2", "vieja"]);
  assert.deepEqual([elegirBase({}, "2.1.9").base, elegirBase({}, null).estado], [null, "falta"]);
  assert.equal(ventanaDe("claude-opus-5-5"), 1_000_000);
  assert.equal(ventanaDe("claude-sonnet-4-5"), 200_000);
  assert.equal(ventanaDe("claude-sonnet-4-5[1m]"), 1_000_000);
});

/** Un proyecto inventado con su CLAUDE.md y una skill, y el inventario de Claude Code con un MCP, un hook y tres skills. */
function mundo() {
  const home = tmp();
  const proyecto = path.join(home, "proyectos", "atlas");
  mkdirSync(proyecto, { recursive: true });
  writeFileSync(path.join(proyecto, "CLAUDE.md"), "Reglas inventadas del proyecto Atlas. ".repeat(20));
  writeFileSync(path.join(home, "CLAUDE.md"), "Reglas inventadas del home. ".repeat(10));
  const claudeDir = path.join(home, ".claude");
  const memoriaAuto = path.join(claudeDir, "projects", proyecto.replace(/[^A-Za-z0-9]/g, "-"), "memory");
  mkdirSync(memoriaAuto, { recursive: true });
  writeFileSync(path.join(memoriaAuto, "MEMORY.md"), "- [Nota inventada](nota.md) — algo\n");
  const inv: Inventario = {
    version: 1,
    proyectos: [proyecto],
    items: [
      { id: "skill|usuario|bocetos", tipo: "skill", nombre: "bocetos", origen: "usuario", de: "", descripcion: "Dibuja bocetos de pantallas en HTML", activo: true, conmutable: false },
      { id: "skill|proyecto|atlas|capturas", tipo: "skill", nombre: "capturas", origen: "proyecto", de: proyecto, descripcion: "Saca capturas de la app", activo: true, conmutable: false },
      { id: "skill|proyecto|otro|ajena", tipo: "skill", nombre: "ajena", origen: "proyecto", de: path.join(home, "proyectos", "otro"), descripcion: "De otro proyecto", activo: true, conmutable: false },
      { id: "mcp|usuario|nube", tipo: "mcp", nombre: "nube", origen: "usuario", de: "", descripcion: "", activo: true, conmutable: true, clase: "http", destino: "https://nube.invalida" },
      { id: "mcp|usuario|apagado", tipo: "mcp", nombre: "apagado", origen: "usuario", de: "", descripcion: "", activo: false, conmutable: true },
      { id: "hook|usuario|1", tipo: "hook", nombre: "SessionStart:startup", origen: "usuario", de: "", descripcion: "", activo: true, conmutable: false, clase: "SessionStart", destino: "mostrar-aviso.sh" },
    ],
  };
  const dirTrama = tmp();
  return { home, proyecto, claudeDir, inv, dirTrama };
}

const deps = (m: ReturnType<typeof mundo>, extra: Record<string, unknown> = {}) => ({ home: m.home, claudeDir: m.claudeDir, dirTrama: m.dirTrama, inv: m.inv, apagados: vacios(), mcpTrama: () => ["trama-propio"], version: async () => "2.1.314", ...extra });

test("vista previa: sin base capturada devuelve lo que sabe y no inventa el resto", async () => {
  const m = mundo();
  const v = await vistaPrevia({ tipo: "lider", proyecto: m.proyecto }, deps(m));
  assert.equal(v.desglose, null);
  assert.deepEqual(v.base, { estado: "falta", version: null, instalada: "2.1.314", capturadoEn: null });
  assert.deepEqual(v.proyectos, [{ ruta: m.proyecto, nombre: "atlas" }]);
  assert.deepEqual(v.hooks.map((h) => [h.evento, h.comando]), [["SessionStart", "mostrar-aviso.sh"]]);
});

test("vista previa: un líder nuevo carga sistema, herramientas, CLAUDE.md por archivo, memoria, skills del proyecto y MCP", async () => {
  const m = mundo();
  await guardarBase(base("2.1.314", 1), m.dirTrama);
  const v = await vistaPrevia({ tipo: "lider", proyecto: m.proyecto, modelo: "claude-opus-5-5" }, deps(m));
  const d = v.desglose!;
  assert.equal(v.base.estado, "lista");
  assert.equal(d.fuente, "previa");
  assert.equal(d.estimado, true);
  assert.equal(d.promptVersion, "2.1.314");
  assert.equal(d.ventana, 1_000_000);
  assert.deepEqual(d.sistema.filter((s) => s.tipo === "prompt").map((s) => s.seccion), ["intro", "arnes", "entorno"]);
  assert.deepEqual(d.herramientas.map((h) => [h.nombre, h.diferida]), [["Bash", false], ["Read", false], ["WebFetch", false], ["CronCreate", true]]);
  // Los CLAUDE.md de esa carpeta y su memoria automática, cada uno con su peso; el del home también (es un líder).
  assert.deepEqual(d.memoria.map((x) => path.basename(x.ruta)).sort(), ["CLAUDE.md", "CLAUDE.md", "MEMORY.md"]);
  assert.ok(d.memoria.every((x) => x.tokens > 0 && x.estimado));
  // Skills: las del usuario y las de ese proyecto, no las de otro.
  assert.deepEqual(d.skills.map((s) => s.nombre).sort(), ["bocetos", "capturas"]);
  // MCP prendidos más los propios de Trama; el apagado no. Su peso se sabe al conectar.
  assert.deepEqual(d.mcp.map((s) => s.servidor).sort(), ["nube", "trama-propio"]);
  assert.ok(d.mcp.every((s) => s.tokens === null));
  const suma = d.categorias.reduce((n, c) => n + c.tokens, 0);
  assert.equal(d.usado, suma);
  assert.deepEqual(d.categorias.map((c) => c.id), ["sistema", "herramientas", "mcp", "skills", "memoria"]);
});

test("vista previa: un worker nuevo va sin MCP y sin el CLAUDE.md del home; lo apagado no se carga", async () => {
  const m = mundo();
  await guardarBase(base("2.1.314", 1), m.dirTrama);
  const w = (await vistaPrevia({ tipo: "worker", proyecto: m.proyecto }, deps(m))).desglose!;
  assert.deepEqual(w.mcp, []);
  assert.deepEqual(w.memoria.map((x) => x.ruta).filter((r) => r === path.join(m.home, "CLAUDE.md")), []);
  assert.ok(!w.categorias.some((c) => c.id === "mcp"));
  // Un archivo de memoria apagado por Trama no se carga (y por eso no figura): vuelve cuando se prende.
  const apagado = path.join(m.proyecto, "CLAUDE.md");
  const sin = (await vistaPrevia({ tipo: "worker", proyecto: m.proyecto }, deps(m, { apagados: { ...vacios(), memoria: [apagado] } }))).desglose!;
  assert.ok(!sin.memoria.some((x) => x.ruta === apagado));
  assert.ok(sin.categorias.find((c) => c.id === "memoria")!.tokens < w.categorias.find((c) => c.id === "memoria")!.tokens);
  // Las skills apagadas tampoco se cuentan.
  const sk = (await vistaPrevia({ tipo: "worker", proyecto: m.proyecto }, deps(m, { apagados: { ...vacios(), skills: ["bocetos"] } }))).desglose!;
  assert.deepEqual(sk.skills.map((s) => s.nombre), ["capturas"]);
});

test("vista previa: sólo proyectos conocidos, tipos y modelos válidos", async () => {
  const m = mundo();
  await assert.rejects(vistaPrevia({ tipo: "lider", proyecto: "/otra/carpeta" }, deps(m)), /previaRara/);
  await assert.rejects(vistaPrevia({ tipo: "otro" }, deps(m)), /previaRara/);
  await assert.rejects(vistaPrevia({ tipo: "lider", modelo: "x; y" }, deps(m)), /previaRara/);
  // Sin proyecto: arranca en el home.
  await guardarBase(base("2.1.314", 1), m.dirTrama);
  const v = await vistaPrevia({ tipo: "lider" }, deps(m));
  assert.equal(v.proyecto, "");
  assert.ok(v.desglose!.memoria.some((x) => x.ruta === path.join(m.home, "CLAUDE.md")));
});
