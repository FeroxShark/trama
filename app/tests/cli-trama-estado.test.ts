// cli/trama-estado.ts: el contrato JSON (separadores de Python), la regla de «sesión» de cada programa y el chequeo de Ollama y del
// motor contra servidores HTTP locales. Los programas falsos son scripts de shell: esos casos sólo corren en POSIX.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MODELO_AGY, claveDsh, enPalabras, estado, jsonPy, main, pedir } from "../electron/cli/trama-estado.ts";
import { soloPosix } from "./plataforma.ts";

function sandbox() {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "te-")));
  const home = path.join(raiz, "home");
  mkdirSync(home);
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: path.join(raiz, "local"),
    PATH: path.join(raiz, "vacio"),
    TRAMA_CLAUDE: "trama-no-existe",
    TRAMA_AGY: "trama-no-existe",
    HILOS_DSH: path.join(raiz, "no-dsh"),
    HILOS_OPENCODE: path.join(raiz, "no-oc"),
    TRAMA_PUERTO: "1",
    OLLAMA_HOST: "127.0.0.1:1",
    TRAMA_MODELOS: path.join(raiz, "no-modelos.json"),
    TRAMA_CLAVES: path.join(raiz, "no-claves.env"),
    HILOS_STATE: path.join(raiz, "hilos"),
    XDG_DATA_HOME: path.join(raiz, "datos"),
    CLAUDE_CONFIG_DIR: path.join(raiz, "claude"),
  };
  const escribir = (r: string, t: string, modo?: number) => {
    mkdirSync(path.dirname(r), { recursive: true });
    writeFileSync(r, t);
    if (modo) chmodSync(r, modo);
  };
  return { raiz, env, escribir };
}

const servidor = (handler: http.RequestListener) =>
  new Promise<{ puerto: number; cerrar: () => void }>((resolve) => {
    const s = http.createServer(handler).listen(0, "127.0.0.1", () => resolve({ puerto: (s.address() as AddressInfo).port, cerrar: () => s.close() }));
  });

test("jsonPy: el formato de json.dumps(ensure_ascii=False) de Python", () => {
  assert.equal(jsonPy({ a: 1, b: [1, "x"], c: { d: null, e: true }, f: "é\"\n" }), '{"a": 1, "b": [1, "x"], "c": {"d": null, "e": true}, "f": "é\\"\\n"}');
  assert.equal(jsonPy([]), "[]");
  assert.equal(jsonPy({}), "{}");
});

test("MODELO_AGY: id con tab, o sólo el id de los prefijos conocidos", () => {
  for (const l of ["gemini-3-pro\tGemini", "  claude-x", "GPT-5.1", "foo-bar\tx"]) assert.ok(MODELO_AGY.test(l), l);
  for (const l of ["", "no hay sesión", "gemini con espacios", "foo-bar"]) assert.ok(!MODELO_AGY.test(l), l);
});

test("claveDsh: entorno o claves.env, sin comillas ni vacíos; nunca devuelve el valor", () => {
  const t = sandbox();
  const c = { env: t.env, home: t.env.HOME! };
  assert.equal(claveDsh("DEEPSEEK_API_KEY", c), false);
  t.escribir(t.env.TRAMA_CLAVES!, "export DEEPSEEK_API_KEY='abc'\r\nOPENCODE_API_KEY=\"\"\n");
  assert.equal(claveDsh("DEEPSEEK_API_KEY", c), true);
  assert.equal(claveDsh("OPENCODE_API_KEY", c), false);
  assert.equal(claveDsh("OPENCODE_API_KEY", { ...c, env: { ...t.env, OPENCODE_API_KEY: "x" } }), true);
});

test("estado: sin nada instalado todo da false y el JSON mantiene el contrato", async () => {
  const t = sandbox();
  const est = await estado(t.env);
  assert.deepEqual(est, {
    version: 1,
    claude: { instalado: false, logueado: false },
    agy: { instalado: false, logueado: false },
    dsh: { instalado: false, version: null, ruta: null, claves: { opencode: false, deepseek: false } },
    opencode: { instalado: false, version: null, ruta: null, logueado: false },
    ollama: { url: "http://127.0.0.1:1", responde: false, modelos: [] },
    motor: { vivo: false, url: "http://127.0.0.1:1", proceso: false },
  });
  assert.match(enPalabras(est), /^claude {3}instalado: no · sesión: no\nagy {6}instalado: no/);
  assert.match(enPalabras(est), /ollama {3}http:\/\/127\.0\.0\.1:1 · responde: no · modelos: ninguno\nmotor {4}http:\/\/127\.0\.0\.1:1 · vivo: no\n$/);
});

test("main: --json en cualquier posición; siempre sale 0", async () => {
  const t = sandbox();
  let out = "";
  assert.equal(await main(["x", "--json"], t.env, (s) => (out += s)), 0);
  assert.ok(out.startsWith('{"version": 1, "claude": {"instalado": false, "logueado": false}'));
  assert.ok(out.endsWith("\n") && out.split("\n").length === 2);
});

test("ollama y motor: responden por HTTP; un 404 también cuenta como vivo", async () => {
  const ol = await servidor((req, res) => {
    if (req.url === "/api/tags") res.end(JSON.stringify({ models: [{ name: "llama3" }, { nombre: "x" }, { name: "qwen" }] }));
    else res.writeHead(404).end();
  });
  const mo = await servidor((_req, res) => res.writeHead(404).end());
  try {
    const t = sandbox();
    t.escribir(path.join(t.env.HILOS_STATE!, "dueno"), JSON.stringify({ pid: process.pid }));
    const est = await estado({ ...t.env, OLLAMA_HOST: `127.0.0.1:${ol.puerto}`, TRAMA_PUERTO: String(mo.puerto) });
    assert.deepEqual(est.ollama, { url: `http://127.0.0.1:${ol.puerto}`, responde: true, modelos: ["llama3", "qwen"] });
    assert.deepEqual(est.motor, { vivo: true, url: `http://127.0.0.1:${mo.puerto}`, proceso: true });
    assert.deepEqual(await pedir(`http://127.0.0.1:${mo.puerto}/`), [404, ""]);
    // modelos.json manda sobre OLLAMA_HOST
    t.escribir(t.env.TRAMA_MODELOS!, JSON.stringify({ locales: [{ nombre: "x" }, { url: `http://127.0.0.1:${ol.puerto}///` }] }));
    assert.equal((await estado({ ...t.env })).ollama.responde, true);
  } finally {
    ol.cerrar();
    mo.cerrar();
  }
});

test("motor: el dueño muerto o ilegible no cuenta como proceso", async () => {
  const t = sandbox();
  t.escribir(path.join(t.env.HILOS_STATE!, "dueno"), JSON.stringify({ pid: 2 ** 22 + 12345 }));
  assert.equal((await estado(t.env)).motor.proceso, false);
  t.escribir(path.join(t.env.HILOS_STATE!, "dueno"), "basura");
  assert.equal((await estado(t.env)).motor.proceso, false);
});

test("programas falsos: versión, keys, sesión de claude/agy/opencode", { skip: soloPosix("scripts de shell") }, async () => {
  const t = sandbox();
  const bin = path.join(t.raiz, "bin");
  t.escribir(path.join(bin, "dsh"), '#!/bin/sh\necho "dsh 9.9.9 extra"\necho segunda\n', 0o755);
  t.escribir(path.join(bin, "opencode"), '#!/bin/sh\nif [ "$1" = auth ]; then printf "\\033[32m|  OpenCode Console  stored\\033[0m\\n"; else echo "opencode 1.2.3"; fi\n', 0o755);
  t.escribir(path.join(bin, "agy"), '#!/bin/sh\nprintf "gemini-3-pro\\tGemini 3 Pro\\n"\n', 0o755);
  t.escribir(path.join(bin, "claude"), '#!/bin/sh\necho \'{"loggedIn": true}\'\n', 0o755);
  const env = { ...t.env, HILOS_DSH: path.join(bin, "dsh"), HILOS_OPENCODE: path.join(bin, "opencode"), TRAMA_AGY: path.join(bin, "agy"), TRAMA_CLAUDE: path.join(bin, "claude"), DEEPSEEK_API_KEY: "valor-falso" };
  const est = await estado(env);
  assert.deepEqual(est.claude, { instalado: true, logueado: true });
  assert.deepEqual(est.agy, { instalado: true, logueado: true });
  assert.deepEqual(est.dsh, { instalado: true, version: "dsh 9.9.9 extra", ruta: path.join(bin, "dsh"), claves: { opencode: false, deepseek: true } });
  assert.deepEqual(est.opencode, { instalado: true, version: "opencode 1.2.3", ruta: path.join(bin, "opencode"), logueado: true });
  assert.ok(!JSON.stringify(est).includes("valor-falso"), "el valor de la key no sale nunca");
});

test("claude: sin JSON usa el archivo de credenciales; si falla no hay fallback", { skip: soloPosix("scripts de shell") }, async () => {
  const t = sandbox();
  const bin = path.join(t.raiz, "bin");
  t.escribir(path.join(bin, "viejo"), "#!/bin/sh\necho no se esta\n", 0o755);
  t.escribir(path.join(bin, "falla"), "#!/bin/sh\nexit 3\n", 0o755);
  const env = (c: string) => ({ ...t.env, TRAMA_CLAUDE: path.join(bin, c) });
  assert.equal((await estado(env("viejo"))).claude.logueado, false);
  t.escribir(path.join(t.env.CLAUDE_CONFIG_DIR!, ".credentials.json"), "{}");
  assert.equal((await estado(env("viejo"))).claude.logueado, true);
  assert.equal((await estado(env("falla"))).claude.logueado, false);
});
