// Conectores: los servidores MCP propios (electron/mcp-config.ts), `claude mcp list` (electron/mcp.ts) y lo que recibe cada motor.
// Lo que más importa: el valor secreto sólo vive en claves.env (0600), nunca en mcp.json, en el argv ni de vuelta hacia la interfaz.
import { test, after } from "node:test";
import { POSIX } from "./plataforma.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { guardarClave, leerClaves, leerClavesMcp } from "../electron/claves.ts";
import { archivoMcpClaudeSync, estadoMcp, olvidarCache, parsearMcpList } from "../electron/mcp.ts";
import { claveDe, guardarServidor, jsonClaude, leerMcp, paraAcp, paraOpencode, quitarServidor, resueltos, vistaMcp, type EntradaMcp } from "../electron/mcp-config.ts";
import { argvLider } from "../electron/lider-arma.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-mcp-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const rutas = () => {
  const d = path.join(tmp, `t${++n}`);
  return { mcp: path.join(d, "mcp.json"), claves: path.join(d, "claves.env") };
};

const SECRETO = "ntn_SECRETO_de_prueba_1234567890";
const notion: EntradaMcp = { nombre: "notion", tipo: "http", url: "https://mcp.notion.com/mcp", variables: [{ tipo: "cabecera", nombre: "Authorization", valor: `Bearer ${SECRETO}` }] };
const fs: EntradaMcp = { nombre: "archivos", tipo: "stdio", comando: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/mi carpeta"], variables: [{ tipo: "env", nombre: "TOKEN", valor: "otro-secreto-9876" }] };

// --- claude mcp list ---------------------------------------------------------------------------------------------------------------------

const SALIDA = `Checking MCP server health…

plugin:design:slack: https://mcp.slack.com/mcp (HTTP) - × Failed to connect — ERR_PROXY_TUNNEL: Proxy refused to open a tunnel: 403 Forbidden
claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 (HTTP) - ✓ Connected
plugin:design:google calendar:  (HTTP) - - Not configured
claude.ai Notion: https://mcp.notion.com/mcp (HTTP) - ! Needs authentication
mi-fs: npx -y @modelcontextprotocol/server-filesystem /tmp/a - b (stdio) - ✓ Connected
`;

test("parsearMcpList: nombre con ':' y espacios, estados, tipo, destino con ' - ' y ruido", () => {
  const r = parsearMcpList(SALIDA);
  assert.deepEqual(r.map((s) => [s.nombre, s.estado, s.tipo]), [
    ["plugin:design:slack", "falla", "HTTP"],
    ["claude.ai Gmail", "ok", "HTTP"],
    ["plugin:design:google calendar", "sin-configurar", "HTTP"],
    ["claude.ai Notion", "auth", "HTTP"],
    ["mi-fs", "ok", "stdio"],
  ]);
  assert.equal(r[0].detalle, "Failed to connect — ERR_PROXY_TUNNEL: Proxy refused to open a tunnel: 403 Forbidden");
  assert.equal(r[1].destino, "https://gmailmcp.googleapis.com/mcp/v1");
  assert.equal(r[4].destino, "npx -y @modelcontextprotocol/server-filesystem /tmp/a - b");
  assert.deepEqual(parsearMcpList(""), []);
  assert.deepEqual(parsearMcpList("No MCP servers configured. Use `claude mcp add` to add a server.\n"), []);
  assert.deepEqual(parsearMcpList("\x1b[32mcolor: http://x (HTTP) - ✓ Connected\x1b[0m").map((s) => s.estado), ["ok"]);
});

test("estadoMcp: Claude muestra lo de claude y lo de trama; Gemini y el local, que no les llega; un fallo de claude no tira", async () => {
  olvidarCache();
  let pedidos = 0;
  const d = { listar: async () => (pedidos++, SALIDA), trama: () => [{ nombre: "notion", tipo: "http" as const, url: "https://mcp.notion.com/mcp", variables: [] }] };
  const c = await estadoMcp("claude", false, false, d);
  assert.equal(c.claude?.servidores.length, 5);
  assert.deepEqual(c.trama, [{ nombre: "notion", tipo: "http", destino: "https://mcp.notion.com/mcp", pasa: true }]);
  await estadoMcp("claude", false, false, d);
  assert.equal(pedidos, 1, "la lista se pide una vez cada medio minuto");
  await estadoMcp("claude", false, true, d);
  assert.equal(pedidos, 2, "fresco la vuelve a pedir");
  for (const m of ["dsh", "opencode"]) {
    const e = await estadoMcp(m, false, false, d);
    assert.equal(e.claude, null);
    assert.equal(e.trama[0].pasa, true);
    assert.equal(e.sinTrama, null);
  }
  const g = await estadoMcp("agy", false, false, d);
  assert.deepEqual([g.trama[0].pasa, g.sinTrama, g.claude], [false, "agy", null]);
  const l = await estadoMcp("claude", true, false, d);
  assert.deepEqual([l.trama[0].pasa, l.sinTrama, l.claude], [false, "local", null]);
  assert.equal(pedidos, 2, "un líder local no pide la lista de claude");
  olvidarCache();
  const roto = await estadoMcp("claude", false, false, { ...d, listar: async () => { throw new Error("spawn claude ENOENT"); } });
  assert.match(roto.claude!.error!, /ENOENT/);
  assert.deepEqual(roto.claude!.servidores, []);
});

// --- Guardado ----------------------------------------------------------------------------------------------------------------------------

test("guardar: el valor secreto va a claves.env (0600) y no a mcp.json; la vista sólo dice si hay", async () => {
  const r = rutas();
  await guardarClave("OPENCODE_API_KEY", "oc-existente", r.claves);
  const lista = await guardarServidor(notion, r);
  const json = readFileSync(r.mcp, "utf8");
  assert.ok(!json.includes(SECRETO) && !json.includes("Bearer"), "mcp.json sin el secreto");
  assert.ok(!JSON.stringify(lista).includes(SECRETO), "la vista sin el secreto");
  assert.deepEqual(lista[0].variables, [{ tipo: "cabecera", nombre: "Authorization", hay: true }]);
  const claves = readFileSync(r.claves, "utf8");
  assert.ok(claves.includes(`${claveDe("notion", { tipo: "cabecera", nombre: "Authorization" })}=Bearer ${SECRETO}`));
  assert.ok(claves.includes("OPENCODE_API_KEY=oc-existente"), "las demás claves quedan");
  if (POSIX) {
    assert.equal(statSync(r.claves).mode & 0o777, 0o600);
    assert.equal(statSync(r.mcp).mode & 0o777, 0o600);
  }
  // Guardar una clave de proveedor no borra las de los conectores.
  await guardarClave("DEEPSEEK_API_KEY", "ds-1", r.claves);
  assert.equal(Object.keys(await leerClavesMcp(r.claves)).length, 1);
  assert.deepEqual(Object.keys(await leerClaves(r.claves)).sort(), ["DEEPSEEK_API_KEY", "OPENCODE_API_KEY"]);
});

test("editar sin valor conserva el guardado; sacar una variable borra su valor; quitar el servidor borra todo", async () => {
  const r = rutas();
  await guardarServidor(fs, r);
  await guardarServidor({ ...fs, args: ["-y", "x"], variables: [{ tipo: "env", nombre: "TOKEN" }] }, r);
  assert.equal(Object.values(await leerClavesMcp(r.claves))[0], "otro-secreto-9876");
  assert.deepEqual((await leerMcp(r.mcp))[0].args, ["-y", "x"]);
  // Una variable nueva sin valor se pide.
  await assert.rejects(guardarServidor({ ...fs, variables: [{ tipo: "env", nombre: "TOKEN" }, { tipo: "env", nombre: "OTRA" }] }, r), /main\.mcpSinValor/);
  await guardarServidor({ ...fs, variables: [] }, r);
  assert.deepEqual(await leerClavesMcp(r.claves), {});
  await guardarServidor(notion, r);
  const queda = await quitarServidor("NOTION", r);
  assert.deepEqual(queda.map((s) => s.nombre), ["archivos"]);
  assert.deepEqual(await leerClavesMcp(r.claves), {});
});

test("validar: nombre, tipo, comando, URL y valores raros se rechazan sin escribir nada", async () => {
  const r = rutas();
  for (const mal of [
    { ...notion, nombre: "con espacio" },
    { ...notion, nombre: "" },
    { ...notion, tipo: "ws" },
    { ...notion, url: "ftp://x" },
    { ...notion, url: "no es url" },
    { ...fs, comando: "" },
    { ...fs, comando: "--evil" },
    { ...notion, variables: [{ tipo: "cabecera", nombre: "a b", valor: "x" }] },
    { ...notion, variables: [{ tipo: "cabecera", nombre: "A", valor: "x" }, { tipo: "cabecera", nombre: "a", valor: "y" }] },
    { ...notion, variables: [{ tipo: "cabecera", nombre: "A", valor: "linea1\nlinea2" }] },
    { ...notion, variables: [{ tipo: "cabecera", nombre: "A", valor: "\"entre comillas\"" }] },
  ])
    await assert.rejects(guardarServidor(mal, r), /main\.mcp/);
  assert.deepEqual(await leerMcp(r.mcp), []);
  assert.deepEqual(await leerClavesMcp(r.claves), {});
});

test("un mcp.json roto o con renglones malos no tira: se ignoran", async () => {
  const r = rutas();
  await guardarServidor(fs, r);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(r.mcp, JSON.stringify({ version: 1, servidores: [{ nombre: "ok", tipo: "http", url: "https://a.b/mcp", variables: [] }, { nombre: "mal nombre", tipo: "http" }, 5] }));
  assert.deepEqual((await vistaMcp(r)).map((s) => s.nombre), ["ok"]);
  writeFileSync(r.mcp, "{ no es json");
  assert.deepEqual(await leerMcp(r.mcp), []);
});

// --- Lo que recibe cada motor ----------------------------------------------------------------------------------------------------------

test("config por motor: Claude (--mcp-config), ACP (dsh y opencode) y la sección mcp de opencode", async () => {
  const r = rutas();
  await guardarServidor(notion, r);
  await guardarServidor(fs, r);
  const rs = resueltos(await leerMcp(r.mcp), await leerClavesMcp(r.claves));
  assert.equal(rs.length, 2);
  assert.deepEqual(JSON.parse(jsonClaude(rs)), {
    mcpServers: {
      notion: { type: "http", url: "https://mcp.notion.com/mcp", headers: { Authorization: `Bearer ${SECRETO}` } },
      archivos: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/mi carpeta"], env: { TOKEN: "otro-secreto-9876" } },
    },
  });
  assert.deepEqual(paraAcp(rs), [
    { type: "http", name: "notion", url: "https://mcp.notion.com/mcp", headers: [{ name: "Authorization", value: `Bearer ${SECRETO}` }] },
    { name: "archivos", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/mi carpeta"], env: [{ name: "TOKEN", value: "otro-secreto-9876" }] },
  ]);
  assert.deepEqual(paraOpencode(rs), {
    notion: { type: "remote", url: "https://mcp.notion.com/mcp", enabled: true, headers: { Authorization: `Bearer ${SECRETO}` } },
    archivos: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp/mi carpeta"], enabled: true, environment: { TOKEN: "otro-secreto-9876" } },
  });
  // Un servidor al que le falta un valor (se perdió claves.env) no se pasa: arrancaría roto.
  assert.deepEqual(resueltos(await leerMcp(r.mcp), {}).map((s) => s.nombre), []);
});

test("argv de un líder de Claude: --mcp-config con la ruta (sin secretos), nunca --strict-mcp-config; el local y Ollama, sin él", async () => {
  const base = { modelo: "claude-opus-5-5", effort: "high", sid: "11111111-2222-3333-4444-555555555555", nombre: "trama-1", resume: false };
  const con = argvLider({ ...base, mcpConfig: "/x/mcp/claude.json" });
  assert.deepEqual(con.slice(con.indexOf("--mcp-config"), con.indexOf("--mcp-config") + 2), ["--mcp-config", "/x/mcp/claude.json"]);
  assert.ok(!con.includes("--strict-mcp-config"));
  assert.ok(!argvLider(base).includes("--mcp-config"));
  const local = argvLider({ ...base, mcpConfig: "/x/mcp/claude.json", local: { url: "http://127.0.0.1:8080", ctx: 32768 } });
  assert.ok(!local.includes("--mcp-config") && local.includes("--strict-mcp-config"), "el local sigue con --strict-mcp-config");
  assert.ok(!argvLider({ ...base, modelo: "llama3", mcpConfig: "/x", ollama: { url: "http://127.0.0.1:11434", modelo: "llama3" } }).includes("--mcp-config"));
});

test("el archivo de --mcp-config lleva los valores pero queda en 0600, y sin servidores no se escribe", async () => {
  const r = rutas();
  await guardarServidor(notion, r);
  const rs = resueltos(await leerMcp(r.mcp), await leerClavesMcp(r.claves));
  const dir = path.join(tmp, "estado-mcp");
  const f = archivoMcpClaudeSync({ servidores: rs, dir })!;
  assert.equal(f, path.join(dir, "claude.json"));
  assert.ok(readFileSync(f, "utf8").includes(SECRETO));
  if (POSIX) assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.equal(archivoMcpClaudeSync({ servidores: [], dir }), null);
});
