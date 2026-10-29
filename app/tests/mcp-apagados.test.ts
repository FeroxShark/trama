import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { configActiva, fijarApagado, leerApagados, nombreConectorValido } from "../electron/mcp-apagados.ts";

/** Un `.claude.json` inventado (con una credencial falsa, que nunca tiene que salir) para un home inventado. */
function armar(extra: Record<string, unknown> = {}) {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "mcp-apagados-"));
  const home = path.join(raiz, "ana");
  mkdirSync(home, { recursive: true });
  const archivo = path.join(home, ".claude.json");
  const base = {
    numStartups: 41,
    oauthAccount: { emailAddress: "ana@ejemplo.com", token: "tok-falso-0123456789" },
    mcpServers: { archivos: { command: "npx", args: ["-y", "srv", "--token", "TOKEN-FALSO-1"] } },
    projects: {
      [home]: { allowedTools: [], disabledMcpServers: ["claude.ai Notion", "claude.ai Drive"], hasTrustDialogAccepted: true },
      [path.join(home, "tienda")]: { disabledMcpServers: ["claude.ai Correo"] },
    },
    ...extra,
  };
  writeFileSync(archivo, JSON.stringify(base, null, 2) + "\n", { mode: 0o600 });
  return { raiz, home, archivo, base, cfg: configActiva({}, home, "linux") };
}

const leerJson = (f: string) => JSON.parse(readFileSync(f, "utf8"));

test("lee los apagados del proyecto del líder (su home) y no los de otro proyecto", async () => {
  const { cfg } = armar();
  assert.equal(cfg.cuenta, null);
  assert.deepEqual(await leerApagados(cfg), ["claude.ai Notion", "claude.ai Drive"]);
});

test("sin archivo, sin proyecto o sin lista: ninguno", async () => {
  const { cfg, archivo } = armar();
  writeFileSync(archivo, JSON.stringify({ projects: { "/otro": {} } }));
  assert.deepEqual(await leerApagados(cfg), []);
  writeFileSync(archivo, "{}");
  assert.deepEqual(await leerApagados(cfg), []);
  assert.deepEqual(await leerApagados({ ...cfg, archivo: archivo + ".no-hay" }), []);
});

test("prender saca sólo ese nombre y deja todo lo demás del archivo igual (orden, valores, modo)", async () => {
  const { cfg, archivo, base } = armar();
  const r = await fijarApagado(cfg, "claude.ai Notion", false);
  assert.deepEqual(r, ["claude.ai Drive"]);
  const despues = leerJson(archivo);
  const esperado = structuredClone(base) as typeof base;
  (esperado.projects[cfg.proyecto] as { disabledMcpServers: string[] }).disabledMcpServers = ["claude.ai Drive"];
  assert.deepEqual(despues, esperado);
  assert.deepEqual(Object.keys(despues), Object.keys(base));
  assert.deepEqual(Object.keys(despues.projects[cfg.proyecto]), ["allowedTools", "disabledMcpServers", "hasTrustDialogAccepted"]);
  assert.equal(statSync(archivo).mode & 0o777, 0o600);
  assert.ok(readFileSync(archivo, "utf8").endsWith("}\n"));
});

test("apagar suma el nombre una sola vez; pedir lo que ya está no escribe nada", async () => {
  const { cfg, archivo } = armar();
  assert.deepEqual(await fijarApagado(cfg, "claude.ai Slack", true), ["claude.ai Notion", "claude.ai Drive", "claude.ai Slack"]);
  const mtime = statSync(archivo).mtimeMs;
  const antes = readFileSync(archivo, "utf8");
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(await fijarApagado(cfg, "claude.ai Slack", true), ["claude.ai Notion", "claude.ai Drive", "claude.ai Slack"]);
  assert.deepEqual(await fijarApagado(cfg, "claude.ai Nunca", false), ["claude.ai Notion", "claude.ai Drive", "claude.ai Slack"]);
  assert.equal(readFileSync(archivo, "utf8"), antes);
  assert.equal(statSync(archivo).mtimeMs, mtime);
});

test("es atómico: no deja archivos temporales y conserva la sangría de 4 espacios o el archivo sin salto final", async () => {
  const { cfg, archivo, home } = armar();
  const j = leerJson(archivo);
  writeFileSync(archivo, JSON.stringify(j, null, 4));
  await fijarApagado(cfg, "claude.ai Notion", false);
  const t = readFileSync(archivo, "utf8");
  assert.match(t, /^\{\n    "numStartups": 41,/);
  assert.ok(t.endsWith("}"));
  assert.deepEqual(readdirSync(home).sort(), [".claude.json"]);
});

test("un proyecto que Claude Code todavía no conoce se crea sólo al apagar", async () => {
  const { cfg, archivo, base } = armar();
  const nuevo = { ...cfg, proyecto: "/srv/otro" };
  assert.deepEqual(await fijarApagado(nuevo, "claude.ai Notion", false), []);
  assert.deepEqual(leerJson(archivo), base);
  assert.deepEqual(await fijarApagado(nuevo, "claude.ai Notion", true), ["claude.ai Notion"]);
  assert.deepEqual(leerJson(archivo).projects["/srv/otro"], { disabledMcpServers: ["claude.ai Notion"] });
  assert.deepEqual(leerJson(archivo).oauthAccount, base.oauthAccount);
});

test("archivo ilegible: no se toca y el error no trae nada de su contenido", async () => {
  const { cfg, archivo } = armar();
  writeFileSync(archivo, '{"oauthAccount":{"token":"tok-falso-roto"');
  const roto = readFileSync(archivo, "utf8");
  for (const f of [() => leerApagados(cfg), () => fijarApagado(cfg, "claude.ai Notion", false)])
    await assert.rejects(f, (e: Error) => !/tok-falso/.test(e.message) && /conectoresIlegible/.test(e.message));
  assert.equal(readFileSync(archivo, "utf8"), roto);
});

test("rechaza nombres raros y tipos que no son", async () => {
  const { cfg, archivo } = armar();
  const antes = readFileSync(archivo, "utf8");
  for (const n of ["", "a\nb", "x".repeat(201), 3, null, { a: 1 }]) await assert.rejects(fijarApagado(cfg, n, true));
  await assert.rejects(fijarApagado(cfg, "claude.ai Notion", "si"));
  assert.equal(readFileSync(archivo, "utf8"), antes);
  assert.equal(nombreConectorValido("claude.ai Google Calendar"), true);
});

test("con varias cuentas: la preferida usa su carpeta y su .claude.json, no el de siempre", async () => {
  const { raiz, home, archivo, cfg: siempre } = armar();
  const carpeta = path.join(raiz, "cuentas", "trabajo");
  mkdirSync(carpeta, { recursive: true });
  const propio = path.join(carpeta, ".claude.json");
  writeFileSync(propio, JSON.stringify({ projects: { [home]: { disabledMcpServers: ["claude.ai Linear"] } } }));
  const cuentas = path.join(raiz, "cuentas.json");
  writeFileSync(cuentas, JSON.stringify({ cuentas: [{ id: "trabajo", proveedor: "claude", nombre: "Trabajo", dir: carpeta }], preferidas: { claude: "trabajo" } }));
  const cfg = configActiva({ TRAMA_CUENTAS: cuentas }, home, "linux");
  assert.deepEqual([cfg.cuenta, cfg.archivo, cfg.proyecto], ["trabajo", propio, home]);
  assert.deepEqual(await leerApagados(cfg), ["claude.ai Linear"]);
  const del = readFileSync(archivo, "utf8");
  await fijarApagado(cfg, "claude.ai Linear", false);
  assert.deepEqual(await leerApagados(cfg), []);
  assert.equal(readFileSync(archivo, "utf8"), del, "el .claude.json de la cuenta de siempre no se toca");
  // Si la preferida ya no existe, vuelve a la de siempre.
  writeFileSync(cuentas, JSON.stringify({ cuentas: [], preferidas: { claude: "trabajo" } }));
  assert.equal(configActiva({ TRAMA_CUENTAS: cuentas }, home, "linux").archivo, siempre.archivo);
  // CLAUDE_CONFIG_DIR de la propia Trama manda sobre ~/.claude.json.
  assert.equal(configActiva({ CLAUDE_CONFIG_DIR: "/cfg/x", TRAMA_CUENTAS: path.join(raiz, "no.json") }, home, "linux").archivo, "/cfg/x/.claude.json");
});

test("Windows: la carpeta se reconoce con barras y mayúsculas distintas", async () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "mcp-apagados-w-"));
  const archivo = path.join(raiz, ".claude.json");
  writeFileSync(archivo, JSON.stringify({ projects: { "C:/Users/Ana": { disabledMcpServers: ["claude.ai Notion"] } } }));
  const cfg = { cuenta: null, dir: raiz, archivo, proyecto: "c:\\users\\ana" };
  assert.deepEqual(await leerApagados(cfg, "win32"), ["claude.ai Notion"]);
  assert.deepEqual(await fijarApagado(cfg, "claude.ai Notion", false, "win32"), []);
  assert.deepEqual(Object.keys(leerJson(archivo).projects), ["C:/Users/Ana"]);
});
