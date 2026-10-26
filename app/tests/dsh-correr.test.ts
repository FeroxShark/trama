// El runner de workers de pa para dsh (motor/dsh/correr.mjs) contra un `dsh --profile headless --json` de verdad y el servidor OpenAI
// falso (scripts/openai-falso.mjs): el NDJSON que copia al transcript, el .json final con la forma de codex_a_json, los códigos de
// salida y los errores de argumentos. Sin `dsh` lo que lo necesita se saltea. HOME y DSH_HOME en un tmp.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DSH, SIN_DSH, arrancarFalso, entornoTmp } from "./dsh-ayuda.ts";

const CORRER = path.join(import.meta.dirname, "..", "..", "motor", "dsh", "correr.mjs");
const { tmp, home, trabajo, dshHome } = entornoTmp("dsh-correr");
after(() => rmSync(tmp, { recursive: true, force: true }));

type Salida = { codigo: number | null; stderr: string; json: any; stream: string };
let n = 0;
/** Corre `correr.mjs` como lo hace pa: argumentos, `--` y la tarea; devuelve el exit, el stderr y los archivos que dejó. */
function correr(args: string[], tarea: string | null, env: Record<string, string | undefined> = {}): Promise<Salida> {
  const stream = path.join(tmp, `stream-${++n}.ndjson`);
  const salida = path.join(tmp, `salida-${n}.json`);
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CORRER, "--cwd", trabajo, "--stream", stream, "--salida", salida, ...args, ...(tarea === null ? [] : ["--", tarea])], {
      env: { ...process.env, HOME: home, DSH_HOME: dshHome, HILOS_DSH: DSH ?? "/no/existe/dsh", DEEPSEEK_API_KEY: "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    p.stderr!.on("data", (t) => (stderr += t));
    p.on("close", (codigo) =>
      ok({ codigo, stderr, json: existsSync(salida) ? JSON.parse(readFileSync(salida, "utf8")) : null, stream: existsSync(stream) ? readFileSync(stream, "utf8") : "" }),
    );
  });
}

test("una corrida buena: NDJSON al stream y un .json con la forma de codex_a_json (result, is_error, num_turns, duración, tokens, costo 0)", { skip: SIN_DSH, timeout: 120_000 }, async () => {
  const falso = await arrancarFalso(tmp);
  after(() => falso.cerrar());
  // opencode (del catálogo de pi-ai) apuntado al servidor falso por --url: se prueba también que no hace falta definir el proveedor.
  const r = await correr(["--modelo", "dsh:opencode/big-pickle", "--url", falso.baseURL], "RAZONA HERRAMIENTA hacelo", { OPENCODE_API_KEY: "" });
  assert.equal(r.codigo, 0, r.stderr);
  const eventos = r.stream.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(eventos[0].type, "session");
  assert.ok(eventos.some((e) => e.type === "tool_call" && e.tool === "bash"));
  assert.equal(eventos.at(-1).type, "final");
  const j = r.json;
  assert.equal(j.type, "result");
  assert.equal(j.motor, "dsh");
  assert.equal(j.subtype, "success");
  assert.equal(j.is_error, false);
  assert.equal(j.result, "listo: hola-desde-bash");
  assert.equal(j.num_turns, 2, "dos pasos del modelo: la herramienta y la respuesta");
  assert.ok(j.duration_ms > 0);
  assert.equal(j.total_cost_usd, 0, "opencode/ollama son gratis");
  assert.match(j.dsh_session_id, /^session-/);
  assert.deepEqual(j.modelUsage, { "dsh:opencode/big-pickle": { inputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 9 } });
  // La herramienta corrió en el worktree y el modelo recibió la tarea.
  const pedidos = falso.pedidos();
  assert.equal(pedidos[0]!.headers.authorization, "Bearer public", "OpenCode: la key pública si no hay una propia");
});

test("ollama: la tarea larga y con comillas llega entera (por stdin, no por argv); --tarea-archivo y `-- -` también", { skip: SIN_DSH, timeout: 120_000 }, async () => {
  const falso = await arrancarFalso(tmp);
  after(() => falso.cerrar());
  const tarea = `hacé "esto" y 'aquello' $HOME \`ls\`\nlínea 2 ${"x".repeat(5000)}`;
  const r = await correr(["--modelo", "dsh:ollama/fake-model", "--url", falso.baseURL], tarea);
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(r.json.is_error, false);
  assert.equal(r.json.result, `eco: ${tarea}`);
  assert.equal(pedidoUsuario(falso.pedidos().at(-1)!), tarea);
  const f = path.join(tmp, "tarea.txt");
  writeFileSync(f, "desde archivo");
  const r2 = await correr(["--modelo", "dsh:ollama/fake-model", "--url", falso.baseURL, "--tarea-archivo", f], null);
  assert.equal(r2.json.result, "eco: desde archivo");
});
const pedidoUsuario = (p: any) => {
  const m = (p.body.messages as any[]).find((x) => x.role === "user");
  return typeof m.content === "string" ? m.content : m.content.map((c: any) => c.text).join("");
};

test("si el modelo falla (500): exit distinto de 0, is_error y el motivo en result y en stderr", { skip: SIN_DSH, timeout: 180_000 }, async () => {
  const falso = await arrancarFalso(tmp);
  after(() => falso.cerrar());
  const r = await correr(["--modelo", "dsh:ollama/fake-model", "--url", falso.baseURL], "ERROR500");
  assert.notEqual(r.codigo, 0);
  assert.equal(r.json.is_error, true);
  assert.equal(r.json.subtype, "error");
  assert.match(r.json.result, /500.*boom falso/);
  assert.match(r.stderr, /dsh\/correr: la corrida falló/);
  assert.ok(r.stream.includes('"turn_end"'), "igual deja el stream");
});

test("errores de uso: modelo que no es de dsh (2), sin tarea (2), deepseek sin key (1), sin dsh (127); siempre dejan el .json", { timeout: 60_000 }, async () => {
  let r = await correr(["--modelo", "gemini-3.8-flash"], "hola");
  assert.equal(r.codigo, 2);
  assert.match(r.stderr, /no es de dsh/);
  assert.equal(r.json.is_error, true);
  r = await correr(["--modelo", "dsh:ollama/x"], null);
  assert.equal(r.codigo, 2);
  assert.match(r.stderr, /falta la tarea/);
  r = await correr(["--modelo", "dsh:deepseek/deepseek-v4-flash"], "hola");
  assert.equal(r.codigo, 1);
  assert.match(r.stderr, /falta DEEPSEEK_API_KEY/);
  assert.match(r.json.result, /falta DEEPSEEK_API_KEY/);
  r = await correr(["--modelo", "dsh:ollama/x"], "hola", { HILOS_DSH: "/no/existe/dsh" });
  assert.equal(r.codigo, 127);
  assert.match(r.stderr, /no está dsh/);
  assert.equal(r.json.is_error, true);
});

test("motor/dsh/config.mjs y electron/dsh.ts (duplicados a propósito) dicen lo mismo", async () => {
  const mjs = await import("../../motor/dsh/config.mjs");
  const ts = await import("../electron/dsh.ts");
  const casos = [
    { proveedor: "ollama", modelo: "qwen2.5-coder:7b" },
    { proveedor: "ollama", modelo: "llava:7b", baseURL: "http://otra:11434/v1", imagenes: true, contexto: 32768 },
    { proveedor: "opencode", modelo: "big-pickle" },
    { proveedor: "opencode", modelo: "big-pickle", baseURL: "http://gw/v1" },
    { proveedor: "deepseek", modelo: "deepseek-v4-flash" },
  ] as const;
  for (const c of casos) assert.equal(mjs.escribirParche(c), ts.escribirParche(c as any), JSON.stringify(c));
  for (const id of ["dsh:ollama/qwen2.5-coder:7b", "dsh:opencode/a/b", "dsh:nada/x", "dsh:ollama/", "claude-opus", "dsh:ollama"]) assert.deepEqual(mjs.parsearModelo(id), ts.parsearModelo(id), id);
  assert.deepEqual(ts.parsearModelo("dsh:opencode/a/b"), { proveedor: "opencode", modelo: "a/b" });
  const env = { PATH: "/usr/bin", XDG_DATA_HOME: "/xdg" };
  for (const p of ["ollama", "opencode", "deepseek"] as const) assert.deepEqual(mjs.entornoDsh(p, env, "/h"), ts.entornoDsh(p, env, "/h"));
  assert.equal(ts.entornoDsh("ollama", env, "/h").DSH_HOME, "/xdg/trama/dsh");
  assert.equal(ts.entornoDsh("ollama", env, "/h").DSH_PERMISSION_MODE, "workspace-write");
  assert.equal(ts.resolverDsh({ HILOS_DSH: "/x/dsh" }), "/x/dsh");
  assert.equal(ts.resolverDsh({ PATH: "/a:/b" }, "/h", (f) => f === "/b/dsh"), "/b/dsh");
  assert.equal(ts.resolverDsh({ PATH: "" }, "/h", (f) => f === "/h/.local/bin/dsh"), "/h/.local/bin/dsh");
  assert.equal(mjs.resolverDsh({ PATH: "/a" }, "/h", () => false), "dsh");
});

test("aResultado: 429 / QUOTA de OpenCode da el mensaje accionable, distinto con clave propia; otros proveedores y errores no", async () => {
  const { aResultado } = await import(CORRER);
  const stderr = 'dsh: QUOTA: 429: {"type":"FreeUsageLimitError","message":"Free usage limit reached."}\n';
  const base = { eventos: [], modelo: "dsh:opencode/x", rc: 1, stderr, segundos: 1, gratis: true };
  const pub = aResultado({ ...base, proveedor: "opencode", conClave: false });
  assert.equal(pub.is_error, true);
  assert.match(pub.result, /se terminó el uso gratis de la clave pública.*opencode\.ai.*Ajustes → DeepSeek Harness/);
  const propia = aResultado({ ...base, proveedor: "opencode", conClave: true });
  assert.match(propia.result, /tu clave llegó al límite/);
  assert.ok(!/pública/.test(propia.result));
  assert.match(aResultado({ ...base, proveedor: "deepseek" }).result, /QUOTA/);
  assert.match(aResultado({ ...base, proveedor: "opencode", stderr: "dsh: boom\n" }).result, /boom/);
});
