// tests/mcp-trama.test.ts: el servidor MCP de Trama (electron/cli/mcp-trama.ts) arrancado de verdad por stdio, con un `pa` de mentira
// (HILOS_PA) y un motor de mentira en el socket local (HILOS_LOCAL); y su registro en la config de cada motor (electron/mcp-trama-registro.ts).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { after, test } from "node:test";
import { atender } from "../electron/cli/mcp-trama.ts";
import { bloqueCodex, registrarEnAgy, registrarEnClaude, registrarEnCodex, registrarEnOpencode, scriptMcpTrama } from "../electron/mcp-trama-registro.ts";
import { socketMotor } from "../electron/rutas.ts";

const raiz = mkdtempSync(path.join(os.tmpdir(), "mcp-trama-"));
after(() => rmSync(raiz, { recursive: true, force: true }));
const SERVIDOR = path.join(import.meta.dirname, "..", "electron", "cli", "mcp-trama.ts");
const SID = "0b5e8a3c-1d2f-4a6b-9c7d-112233445566";

/** Un `pa` que anota sus argumentos y contesta `--hilos --json` y `--async`. */
function paFalso(): { ruta: string; log: string } {
  const log = path.join(raiz, "pa.log");
  const ruta = path.join(raiz, "pa-falso.js");
  const hilos = [
    { id: "20261101-100000-11", proyecto: "demo", estado: "trabajando", en_cola: false, tarea: "arreglar el menú de ejemplo", modelo: "m1", rama: "pa/demo/x", jefe: "lider-a", jefe_id: SID, inicio: 200 },
    { id: "20261031-090000-22", proyecto: "otro", estado: "listo", en_cola: false, tarea: "migrar la base de prueba", modelo: "m2", rama: null, jefe: null, jefe_id: null, inicio: 100, resultado: "quedó migrada la tabla falsa" },
  ];
  writeFileSync(
    ruta,
    `#!${process.execPath}
const fs = require("node:fs");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + "\\n");
if (a[0] === "--hilos") { process.stdout.write(JSON.stringify(${JSON.stringify(hilos)})); process.exit(0); }
if (a[1] === "--async") { process.stdout.write("lanzado en " + a[0] + ": id 20261101-120000-33\\n"); process.exit(0); }
process.stderr.write("uso raro\\n"); process.exit(2);
`,
  );
  chmodSync(ruta, 0o755);
  return { ruta, log };
}

/** Arranca el servidor y devuelve cómo pedirle algo (respuestas por id). */
function arrancar(env: NodeJS.ProcessEnv) {
  const p = spawn(process.execPath, [SERVIDOR], { env, stdio: ["pipe", "pipe", "pipe"] });
  const esperando = new Map<number, (r: Record<string, unknown>) => void>();
  const fallar = new Map<number, (e: Error) => void>();
  let err = "";
  p.once("exit", (c) => {
    for (const f of fallar.values()) f(new Error(`el servidor salió con ${c}: ${err}`));
  });
  p.stderr.on("data", (b: Buffer) => (err += b.toString()));
  createInterface({ input: p.stdout }).on("line", (l) => {
    const r = JSON.parse(l);
    esperando.get(r.id)?.(r);
    esperando.delete(r.id);
    fallar.delete(r.id);
  });
  let n = 0;
  const pedir = (method: string, params?: unknown) =>
    new Promise<Record<string, any>>((resolve, reject) => {
      const id = ++n;
      esperando.set(id, resolve);
      fallar.set(id, reject);
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const avisar = (method: string) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  const cerrar = () => new Promise<number | null>((r) => (p.once("exit", r), p.stdin.end()));
  return { pedir, avisar, cerrar };
}

test("el servidor arranca por stdio, lista las herramientas y llama estado, buscar, lanzar y mandar (pa y motor de mentira)", async () => {
  const pa = paFalso();
  // El motor de mentira: el `/rpc` del socket local, como electron/remoto.ts.
  const carpeta = path.join(raiz, "local");
  mkdirSync(carpeta, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HILOS_PA: pa.ruta, HILOS_LOCAL: carpeta, PA_JEFE: "lider-b" };
  const pedidos: { canal: string; args: unknown[]; cliente: unknown }[] = [];
  const motor = http.createServer((req, res) => {
    let t = "";
    req.on("data", (b) => (t += b));
    req.on("end", () => {
      const { canal, args } = JSON.parse(t);
      pedidos.push({ canal, args, cliente: req.headers["x-trama-cliente"] });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, valor: { sid: args[0].sid, nombre: "lider-a" } }));
    });
  });
  await new Promise<void>((r) => motor.listen(socketMotor(carpeta, env), r));
  const s = arrancar(env);
  try {
    const ini = await s.pedir("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prueba", version: "0" } });
    assert.equal(ini.result.protocolVersion, "2025-06-18");
    assert.equal(ini.result.serverInfo.name, "trama");
    assert.ok(ini.result.capabilities.tools);
    s.avisar("notifications/initialized");

    const lista = await s.pedir("tools/list");
    assert.deepEqual(lista.result.tools.map((h: { name: string }) => h.name).sort(), ["buscar_hilos", "estado_workers", "lanzar_worker", "mandar_mensaje"]);
    for (const h of lista.result.tools) assert.equal(h.inputSchema.type, "object", h.name);

    const estado = await s.pedir("tools/call", { name: "estado_workers", arguments: {} });
    assert.equal(estado.result.isError, undefined);
    const filas = JSON.parse(estado.result.content[0].text);
    assert.deepEqual(filas.map((f: { id: string }) => f.id), ["20261101-100000-11"], "por defecto sólo los que trabajan");
    assert.equal(filas[0].jefe_id, SID);
    const todos = JSON.parse((await s.pedir("tools/call", { name: "estado_workers", arguments: { todos: true } })).result.content[0].text);
    assert.equal(todos.length, 2);

    const busca = JSON.parse((await s.pedir("tools/call", { name: "buscar_hilos", arguments: { texto: "TABLA falsa" } })).result.content[0].text);
    assert.deepEqual(busca.map((f: { id: string }) => f.id), ["20261031-090000-22"]);

    const lanzar = await s.pedir("tools/call", { name: "lanzar_worker", arguments: { proyecto: "demo", tarea: "-x una tarea con guion", modelo: "claude-x", effort: "high" } });
    assert.equal(lanzar.result.isError, undefined, lanzar.result.content[0].text);
    assert.match(lanzar.result.content[0].text, /id 20261101-120000-33/);
    const malo = await s.pedir("tools/call", { name: "lanzar_worker", arguments: { proyecto: "../fuera", tarea: "t" } });
    assert.equal(malo.result.isError, true);

    const llamadas = readFileSync(pa.log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(llamadas.at(-1), ["demo", "--async", "-m", "claude-x", "--effort", "high", "--", "-x una tarea con guion"], "la tarea va después de --");
    assert.ok(llamadas.some((a) => a.join(" ") === "--hilos --json --todo"), "buscar mira también lo viejo");

    const mandar = await s.pedir("tools/call", { name: "mandar_mensaje", arguments: { sid: SID, texto: "¿terminaste?" } });
    assert.equal(mandar.result.isError, undefined, mandar.result.content[0].text);
    assert.match(mandar.result.content[0].text, /lider-a/);
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0]!.canal, "lider:encolarAgente");
    assert.match(String(pedidos[0]!.cliente), /^[0-9a-f]{16}$/);
    const arg = pedidos[0]!.args[0] as { sid: string; texto: string };
    assert.equal(arg.sid, SID);
    assert.match(arg.texto, /^Mensaje de lider-b \(por el MCP de Trama\):\n\n¿terminaste\?$/);

    const desconocida = await s.pedir("tools/call", { name: "borrar_todo", arguments: {} });
    assert.equal(desconocida.error.code, -32602);
    assert.equal((await s.pedir("metodo/raro")).error.code, -32601);
  } finally {
    assert.equal(await s.cerrar(), 0, "termina limpio al cerrarse stdin");
    motor.close();
  }
});

test("mandar_mensaje sin motor: error claro, no una excepción", async () => {
  const r = await atender(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "mandar_mensaje", arguments: { sid: SID, texto: "hola" } } },
    { pa: async () => ({ rc: 0, out: "[]", err: "" }), motor: async () => Promise.reject(new Error("Trama no está abierta (no hay un motor escuchando): el mensaje no salió")) },
    {},
  );
  assert.equal((r as any).result.isError, true);
  assert.match((r as any).result.content[0].text, /Trama no está abierta/);
  const malo = await atender({ id: 2, method: "tools/call", params: { name: "mandar_mensaje", arguments: { sid: "20261101-100000-11", texto: "x" } } }, { pa: async () => ({ rc: 0, out: "", err: "" }), motor: async () => null }, {});
  assert.match((malo as any).result.content[0].text, /sid inválido/);
});

const S = { comando: "/opt/node/bin/node", args: ["/opt/trama/app/dist-electron/cli/mcp-trama.js"] };

test("registro en agy: crea, no reescribe si está igual, respeta lo demás y el apagado, y no toca un JSON roto", () => {
  const f = path.join(raiz, "agy", ".gemini", "config", "mcp_config.json");
  assert.equal(registrarEnAgy(f, S), "creado");
  assert.deepEqual(JSON.parse(readFileSync(f, "utf8")).mcpServers.trama, { command: S.comando, args: S.args, disabled: false });
  assert.equal(registrarEnAgy(f, S), "igual");
  const j = JSON.parse(readFileSync(f, "utf8"));
  j.mcpServers.otro = { command: "x" };
  j.mcpServers.trama.disabled = true;
  writeFileSync(f, JSON.stringify(j));
  assert.equal(registrarEnAgy(f, { ...S, args: ["/otra/mcp-trama.js"] }), "actualizado");
  const k = JSON.parse(readFileSync(f, "utf8"));
  assert.deepEqual(k.mcpServers.otro, { command: "x" });
  assert.equal(k.mcpServers.trama.disabled, true, "apagado a mano sigue apagado");
  writeFileSync(f, "{ roto");
  assert.equal(registrarEnAgy(f, S), "respetado");
  assert.equal(readFileSync(f, "utf8"), "{ roto");
});

test("registro en codex: agrega la tabla al final, la reemplaza sin tocar el resto y escribe a través del enlace", () => {
  const real = path.join(raiz, "codex-real", "config.toml");
  mkdirSync(path.dirname(real), { recursive: true });
  writeFileSync(real, 'model = "x"\n\n[mcp_servers.otro]\ncommand = "y"\n');
  const home = path.join(raiz, "codex-cuenta");
  mkdirSync(home, { recursive: true });
  // En Windows un enlace a un archivo pide permisos de administrador: ahí se escribe directo.
  const f = process.platform === "win32" ? real : path.join(home, "config.toml");
  if (f !== real) symlinkSync(real, f);
  assert.equal(registrarEnCodex(f, S), "creado");
  assert.equal(readFileSync(real, "utf8"), `model = "x"\n\n[mcp_servers.otro]\ncommand = "y"\n\n${bloqueCodex(S)}`);
  assert.equal(registrarEnCodex(f, S), "igual");
  writeFileSync(real, `[mcp_servers.trama]\ncommand = "viejo"\nenabled = false\n\n[tui]\nx = 1\n`);
  assert.equal(registrarEnCodex(f, S), "actualizado");
  assert.equal(readFileSync(real, "utf8"), `${bloqueCodex(S)}enabled = false\n\n[tui]\nx = 1\n`);
  assert.match(bloqueCodex({ comando: "C:\\n\\node.exe", args: ["a"] }), /command = "C:\\\\n\\\\node.exe"/, "las barras de Windows van escapadas");
});

test("registro en opencode: la sección mcp de opencode.json; un opencode.jsonc no se toca", () => {
  const d = path.join(raiz, "oc", "opencode");
  assert.equal(registrarEnOpencode(d, S), "creado");
  const j = JSON.parse(readFileSync(path.join(d, "opencode.json"), "utf8"));
  assert.deepEqual(j.mcp.trama, { type: "local", command: [S.comando, ...S.args], enabled: true });
  assert.equal(registrarEnOpencode(d, S), "igual");
  const d2 = path.join(raiz, "oc2", "opencode");
  mkdirSync(d2, { recursive: true });
  writeFileSync(path.join(d2, "opencode.jsonc"), "// mío\n{}");
  assert.equal(registrarEnOpencode(d2, S), "respetado");
});

test("registro en Claude: con claude mcp add-json de usuario, y nada si ya está igual", async () => {
  const f = path.join(raiz, "claude", ".claude.json");
  mkdirSync(path.dirname(f), { recursive: true });
  const corridas: string[][] = [];
  const correr = async (a: string[]) => (corridas.push(a), 0);
  assert.equal(await registrarEnClaude(f, S, correr), "creado");
  assert.deepEqual(corridas, [["mcp", "add-json", "--scope", "user", "trama", JSON.stringify({ type: "stdio", command: S.comando, args: S.args })]]);
  writeFileSync(f, JSON.stringify({ mcpServers: { trama: { type: "stdio", command: S.comando, args: S.args } } }));
  corridas.length = 0;
  assert.equal(await registrarEnClaude(f, S, correr), "igual");
  assert.equal(corridas.length, 0);
  assert.equal(await registrarEnClaude(f, { ...S, args: ["/otra.js"] }, correr), "actualizado");
  assert.deepEqual(corridas[0], ["mcp", "remove", "--scope", "user", "trama"]);
});

test("el script se encuentra al lado (el .ts en las fuentes) y nunca dentro de un asar", () => {
  assert.equal(scriptMcpTrama(path.dirname(SERVIDOR)), SERVIDOR);
  assert.equal(scriptMcpTrama(path.join(raiz, "no-hay")), null);
});
