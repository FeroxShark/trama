// cli/pa/motores: lo que la paridad función por función (tests/paridad/casos-motores.ts) no cubre: los rechazos del -m y de los
// flags (contra el `pa` bash de verdad), los chequeos (programa, plugin, key, servidor de Ollama), el entorno de cada llamada
// (cuenta, shims, keys, HILOS_*, las ANTHROPIC_* de un local) y la escritura del .json al terminar.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chequearAgy, chequearCodex, chequearDsh, chequearOpencode, dshBin, localEstado, opencodeBin, pluginCargado } from "../electron/cli/pa/motores/chequeo.ts";
import { armarLlamada, conCuenta, contratoBase, entornoOllama, type DatosLlamada } from "../electron/cli/pa/motores/llamada.ts";
import { motorDe, validarOtroMotor, type FlagsLanzar } from "../electron/cli/pa/motores/modelos.ts";
import { arreglarJsonOllama, escribirAgyJson, escribirCodexJson, escribirLatido } from "../electron/cli/pa/motores/salida.ts";
import { CONTRATO_AGY, CONTRATO_CODEX, SIN_JEFE } from "../electron/cli/pa/contrato.ts";
import { comandoOriginal, correr } from "./paridad/arnes.ts";
import { testPosix } from "./plataforma.ts";

const tmp = () => realpathSync(mkdtempSync(path.join(os.tmpdir(), "motores-")));
const escribir = (f: string, t: string, modo?: number) => {
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, t);
  if (modo) chmodSync(f, modo);
};
const io = { err: () => {} };

// ---------------------------------------------------------------- rechazos (contra el bash)

const RECHAZOS: [string, FlagsLanzar, string[]][] = [
  ["codex:gpt-9-high", {}, []],
  ["Gemini-4-Argon-High", { esfuerzoFlag: true }, ["--effort", "high"]],
  ["gemini-5-ultra", {}, []],
  ["agy:gpt-oss-120b-medium", { maxBudget: "1" }, ["--max-budget-usd", "1"]],
  ["CODEX:gpt-6-sol-high", { mcp: true }, ["--mcp"]],
  ["codex:gpt-6-sol-high", { esfuerzoFlag: true }, ["--effort", "low"]],
  ["codex:gpt-6-astra-low", { maxBudget: "2" }, ["--max-budget-usd", "2"]],
  ["dsh:Ollama/x", { esfuerzoFlag: true }, ["--effort", "low"]],
  ["dsh:nube/x", {}, []],
  ["opencode:a/b", { leer: true }, ["--leer"]],
  ["opencode:suelto", {}, []],
  ["dsh:deepseek/x", { cuentaFlag: "foo" }, ["--cuenta", "foo"]],
  ["dsh:deepseek/x", { maxBudget: "1" }, ["--max-budget-usd", "1"]],
  ["ollama:x", { maxBudget: "1" }, ["--max-budget-usd", "1"]],
  ["OLLAMA:x", { esfuerzoFlag: true }, ["--effort", "high"]],
];

for (const [m, f, flags] of RECHAZOS) {
  testPosix(`validarOtroMotor: ${m} ${flags.join(" ")} dice lo mismo que el bash (sale 2)`, { timeout: 60_000 }, () => {
    const v = validarOtroMotor(m, f);
    assert.ok(v && !v.ok, `debería rechazar ${m}`);
    const a = correr({ nombre: m, args: ["demo", "--sin-jefe", "-m", m, ...flags, "x"] }, comandoOriginal("pa"));
    assert.equal(a.pasos[0]!.rc, 2);
    assert.equal(a.pasos[0]!.stderr.trim().split("\n").pop(), v.error);
  });
}

test("validarOtroMotor: normaliza y dice el motor; un Claude es null", () => {
  assert.deepEqual(validarOtroMotor("Gemini-4-Argon-High"), { ok: true, modelo: "gemini-4-argon-high", motor: "agy" });
  assert.deepEqual(validarOtroMotor("CODEX:gpt-6-luna-low"), { ok: true, modelo: "codex:gpt-6-luna-low", motor: "codex" });
  assert.deepEqual(validarOtroMotor("DSH:Ollama/qwen3:30b"), { ok: true, modelo: "dsh:ollama/qwen3:30b", motor: "dsh" });
  assert.deepEqual(validarOtroMotor("OpenCode:opencode/big-pickle", { esfuerzoFlag: true, cuentaFlag: "oc2" }), { ok: true, modelo: "opencode:opencode/big-pickle", motor: "dsh" });
  assert.deepEqual(validarOtroMotor("Ollama:qwen3"), { ok: true, modelo: "ollama:qwen3", motor: "ollama" });
  assert.equal(validarOtroMotor("claude-sonnet-5-5"), null);
  assert.equal(motorDe("opencode:x/y"), "dsh");
  assert.equal(motorDe("claude-opus-5-5"), "claude");
});

test("contratoBase: agy y codex/dsh sin jefe; claude con o sin jefe", () => {
  assert.equal(contratoBase("agy", "jefe-1"), `${CONTRATO_AGY}\n${SIN_JEFE}`);
  assert.equal(contratoBase("dsh", "jefe-1"), `${CONTRATO_CODEX}\n${SIN_JEFE}`);
  assert.match(contratoBase("claude", "jefe-1"), /llamada "jefe-1"/);
  assert.ok(contratoBase("ollama", "").endsWith(SIN_JEFE));
});

// ---------------------------------------------------------------- chequeos

test("pluginCargado: el hook pa-worker con PreToolUse y habilitado", () => {
  const j = (hooks: unknown) => JSON.stringify({ command: { data: { hooks } } });
  assert.equal(pluginCargado(j([{ name: "pa-worker", actions: [{ event: "PreToolUse" }] }])), true);
  assert.equal(pluginCargado(j([{ name: "pa-worker", enabled: false, actions: [{ event: "PreToolUse" }] }])), false);
  assert.equal(pluginCargado(j([{ name: "pa-worker", actions: [{ event: "PostToolUse" }] }])), false);
  assert.equal(pluginCargado(j([{ name: "otro", actions: [{ event: "PreToolUse" }] }])), false);
  assert.equal(pluginCargado("no es json"), false);
});

/** Un PATH con programas falsos (sh) y un registry con el proyecto `demo`. */
function mundo(programas: Record<string, string>) {
  const r = tmp();
  const bin = path.join(r, "bin");
  for (const [n, cuerpo] of Object.entries(programas)) escribir(path.join(bin, n), `#!/bin/sh\n${cuerpo}\n`, 0o755);
  // Sólo node de verdad: lo demás del PATH de la máquina (un agy, dsh u opencode instalados) no tiene que verse.
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, path.join(bin, "node"));
  const proy = path.join(r, "proy");
  mkdirSync(proy);
  const reg = path.join(r, "registry.json");
  writeFileSync(reg, JSON.stringify({ projects: [{ name: "demo", path: proy }] }));
  const env = { HOME: path.join(r, "home"), PATH: bin, PROYECTOS_REGISTRY: reg, TRAMA_CLAVES: path.join(r, "claves.env") };
  return { r, bin, proy, env };
}

testPosix("chequearAgy: privacidad primero, después agy y su plugin", () => {
  const hooks = JSON.stringify({ command: { data: { hooks: [{ name: "pa-worker", actions: [{ event: "PreToolUse" }] }] } } });
  const m = mundo({ agy: `echo '${hooks}'` });
  assert.equal(chequearAgy({ proyecto: "demo", tarea: "mandá a x@y.com", env: m.env }), "el pedido parece traer un mail (no se manda a Google)");
  assert.equal(chequearAgy({ proyecto: "demo", tarea: "nada", env: m.env }), "");
  const sin = mundo({ agy: "echo '{}'" });
  assert.match(chequearAgy({ proyecto: "demo", tarea: "nada", env: sin.env }), /plugin pa-worker/);
  assert.equal(chequearAgy({ proyecto: "demo", tarea: "nada", env: mundo({}).env }), "agy no está en el PATH");
});

testPosix("chequearCodex: OpenAI en el motivo, codex en el PATH y su login", () => {
  assert.equal(chequearCodex({ proyecto: "demo", tarea: "key sk-123456", env: mundo({ codex: "exit 0" }).env }), "el pedido parece traer una clave de API (no se manda a OpenAI)");
  assert.equal(chequearCodex({ proyecto: "demo", tarea: "x", env: mundo({ codex: "exit 0" }).env }), "");
  assert.equal(chequearCodex({ proyecto: "demo", tarea: "x", env: mundo({ codex: "exit 1" }).env }), "codex no tiene sesión iniciada (codex login)");
  assert.match(chequearCodex({ proyecto: "demo", tarea: "x", env: mundo({}).env }), /codex no está en el PATH/);
});

testPosix("chequearDsh / chequearOpencode: binario, keys y modelo", async () => {
  const m = mundo({ dsh: "exit 0", opencode: "exit 0" });
  assert.equal(await chequearDsh("dsh:deepseek/x", { proyecto: "demo", tarea: "x", env: m.env }), `falta DEEPSEEK_API_KEY (en el entorno o en ${m.env.TRAMA_CLAVES})`);
  assert.equal(await chequearDsh("dsh:deepseek/x", { proyecto: "demo", tarea: "x", env: { ...m.env, DEEPSEEK_API_KEY: "k" } }), "");
  assert.equal(await chequearDsh("dsh:opencode/big-pickle", { proyecto: "demo", tarea: "x", env: m.env }), "");
  assert.match(await chequearDsh("dsh:opencode/kimi", { proyecto: "demo", tarea: "x", env: m.env }), /falta OPENCODE_API_KEY .* para 'kimi', que no es gratis/);
  assert.equal(await chequearDsh("dsh:deepseek/x", { proyecto: "demo", tarea: "a@b.io", env: m.env }), "el pedido parece traer un mail (no se manda a deepseek)");
  assert.match(await chequearDsh("dsh:deepseek/x", { proyecto: "demo", tarea: "x", env: mundo({}).env }), /dsh no está instalado/);
  assert.equal(chequearOpencode("opencode:opencode/big-pickle", { proyecto: "demo", tarea: "x", env: m.env }), "");
  assert.equal(chequearOpencode("opencode:suelto", { proyecto: "demo", tarea: "x", env: m.env }), "'opencode:suelto' no es un modelo de opencode (opencode:<proveedor>/<modelo>)");
  assert.equal(await chequearDsh("opencode:opencode/x", { proyecto: "demo", tarea: "y@z.com", env: m.env }), "el pedido parece traer un mail (no se manda a OpenCode)");
  assert.match(chequearOpencode("opencode:opencode/x", { proyecto: "demo", tarea: "x", env: mundo({}).env }), /opencode no está instalado/);
});

testPosix("dshBin / opencodeBin: la variable manda; si no, PATH y las carpetas de instalación", () => {
  const m = mundo({});
  const home = m.env.HOME;
  escribir(path.join(home, ".opencode", "bin", "opencode"), "#!/bin/sh\n", 0o755);
  escribir(path.join(home, ".local", "bin", "dsh"), "#!/bin/sh\n", 0o755);
  assert.equal(opencodeBin(m.env), path.join(home, ".opencode", "bin", "opencode"));
  assert.equal(dshBin(m.env), path.join(home, ".local", "bin", "dsh"));
  assert.equal(dshBin({ ...m.env, HILOS_DSH: "/no/existe" }), "");
});

test("localEstado: no responde, no tiene el modelo, :latest y ok", async () => {
  const srv = http.createServer((_q, r) => r.end(JSON.stringify({ models: [{ name: "qwen3:latest" }, { model: "gemma:2b" }] })));
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    assert.equal(await localEstado(url, "qwen3", {}), "ok");
    assert.equal(await localEstado(url, "gemma:2b", {}), "ok");
    assert.equal(await localEstado(url, "llama", {}), `el servidor ${url} no tiene el modelo 'llama' (ollama pull llama)`);
  } finally {
    srv.close();
  }
  assert.equal(await localEstado("http://127.0.0.1:9", "x", { PA_LOCAL_CHEQUEO_S: "1" }), "el servidor http://127.0.0.1:9 no responde (http://127.0.0.1:9/api/tags)");
});

// ---------------------------------------------------------------- llamadas

function datos(motor: DatosLlamada["motor"], modelo: string, extra: Partial<DatosLlamada> = {}): DatosLlamada {
  const r = tmp();
  return {
    motor,
    modelo,
    contrato: "C",
    prompt: "T",
    rutaTrabajo: path.join(r, "wt"),
    ruta: path.join(r, "proy"),
    rama: "pa/x/1",
    dir: path.join(r, "estado"),
    ts: "20261028-000000-1",
    hb: path.join(r, "hb"),
    mapaProy: path.join(r, "mapa.md"),
    env: { HOME: path.join(r, "home"), PATH: "/usr/bin", TRAMA_CLAVES: path.join(r, "claves.env"), PA_CODEX_SHIMS: "/shims", OPENCODE_API_KEY: "" },
    io,
    gitComun: () => "",
    plat: "linux",
    ...extra,
  };
}

test("armarLlamada agy: stdout al stream, PA_AGY_* exportadas y la cuenta sólo en el worker", () => {
  const l = armarLlamada(datos("agy", "agy:claude-opus-5-5-high", { leer: true, cuenta: { sacar: ["PATH"], poner: { HOME: "/cuenta" } } }));
  assert.equal(l.cmd, "agy");
  assert.equal(l.stdout, l.transcript);
  assert.equal(l.json, "agy");
  assert.equal(l.args[3], "claude-opus-5-5-high");
  assert.equal(l.exporta.PA_AGY_MODO, "leer");
  assert.equal(l.env.PA_AGY_RAMA, "pa/x/1");
  assert.equal(l.env.HOME, "/cuenta");
  assert.equal(l.env.PATH, undefined);
  assert.equal(l.env.PA_WORKER, "1");
  assert.equal(l.env.GIT_EDITOR, "true");
  assert.equal(l.latido, undefined);
});

test("armarLlamada codex: shims primeros en el PATH (no en Windows), latido y el último mensaje a borrar", () => {
  const l = armarLlamada(datos("codex", "codex:gpt-6-luna-medium", { gitComun: () => "/repo/.git", env: { ...datos("codex", "x").env, PA_CODEX_LATIDO_S: "5" } }));
  assert.equal(l.env.PATH, "/shims:/usr/bin");
  assert.deepEqual(l.latido, { tool: "codex", cadaS: 5 });
  assert.ok(l.borrarAntes[0]!.endsWith(".codex-ultimo"));
  assert.deepEqual(l.args.slice(0, 6), ["exec", "--json", "-m", "gpt-6-luna", "-c", 'model_reasoning_effort="medium"']);
  assert.ok(l.args.includes("/repo/.git"));
  const w = armarLlamada(datos("codex", "codex:gpt-6-sol-high", { plat: "win32" }));
  assert.equal(w.env.PATH, "/usr/bin");
});

test("armarLlamada dsh: el runner node de motor/dsh, la tarea por archivo, la key sólo si es de ese proveedor", () => {
  const d = datos("dsh", "dsh:deepseek/deepseek-v4-flash", { maxTurns: "9" });
  d.env.DEEPSEEK_API_KEY = "ds-1";
  const l = armarLlamada(d);
  assert.equal(l.cmd, "node");
  assert.match(l.args[0]!, /motor[\\/]dsh[\\/]correr\.mjs$/);
  assert.deepEqual(l.args.slice(-4), ["--max-pasos", "9", "--tarea-archivo", l.tareaArchivo!.ruta]);
  assert.equal(l.exporta.PA_MAX_TURNS, "9");
  assert.equal(l.env.DEEPSEEK_API_KEY, "ds-1");
  assert.equal(l.stdout, null);
  assert.equal(l.json, "runner");
  assert.ok(l.tareaArchivo!.texto.endsWith("TAREA:\nT"));
  assert.ok("HILOS_DSH" in l.env);
});

test("armarLlamada opencode: reusa motor/opencode/correr.mjs, --effort, cuenta agregada y ninguna key de pa", () => {
  const l = armarLlamada(datos("dsh", "opencode:opencode/big-pickle", { ocEffort: "high", cuenta: { poner: { TRAMA_OPENCODE_CUENTA: "oc2" } } }));
  assert.match(l.args[0]!, /motor[\\/]opencode[\\/]correr\.mjs$/);
  assert.deepEqual(l.args.slice(1, 3), ["--modelo", "opencode:opencode/big-pickle"]);
  assert.ok(l.args.includes("--effort"));
  assert.equal(l.env.TRAMA_OPENCODE_CUENTA, "oc2");
  assert.equal(l.env.OPENCODE_API_KEY, "");
  assert.equal(l.latido?.tool, "opencode");
  assert.ok("HILOS_OPENCODE" in l.env);
});

test("conCuenta y entornoOllama: las ANTHROPIC_* del local y los modelos por defecto apuntando a él", () => {
  assert.deepEqual(conCuenta({ A: "1", B: "2" }, { sacar: ["A"], poner: { C: "3" } }), { B: "2", C: "3" });
  const e = entornoOllama({ ANTHROPIC_API_KEY: "sk-real", X: "y" }, "http://localhost:11434", "qwen3");
  assert.equal(e.ANTHROPIC_API_KEY, "");
  assert.equal(e.ANTHROPIC_AUTH_TOKEN, "ollama");
  assert.equal(e.ANTHROPIC_BASE_URL, "http://localhost:11434");
  assert.equal(e.CLAUDE_CODE_SUBAGENT_MODEL, "qwen3");
  assert.equal(e.ANTHROPIC_DEFAULT_HAIKU_MODEL, "qwen3");
  assert.equal(e.X, "y");
});

// ---------------------------------------------------------------- .json al terminar y latido

test("escribirAgyJson / escribirCodexJson: el .json de pa; sin stream queda vacío", () => {
  const r = tmp();
  const f = (n: string) => path.join(r, n);
  writeFileSync(f("s"), `${JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "ok" } })}\n`);
  writeFileSync(f("e"), "");
  escribirAgyJson({ transcript: f("s"), err: f("e"), modelo: "gemini-4-argon-high", rc: 0, out: f("a.json") });
  assert.equal(JSON.parse(readFileSync(f("a.json"), "utf8")).result, "ok");
  escribirAgyJson({ transcript: f("no"), err: f("e"), modelo: "m", rc: 0, out: f("b.json") });
  assert.equal(readFileSync(f("b.json"), "utf8"), "");
  writeFileSync(f("u"), "final\n");
  escribirCodexJson({ transcript: f("e"), err: f("e"), modelo: "codex:gpt-6-sol-high", rc: 0, ultimo: f("u"), segundos: 4, out: f("c.json") });
  const c = JSON.parse(readFileSync(f("c.json"), "utf8"));
  assert.equal(c.result, "final");
  assert.equal(c.duration_ms, 4000);
  assert.equal(c.motor, "codex");
});

test("arreglarJsonOllama: motor, modelo_local y costo 0; un .json roto queda como está", () => {
  const r = tmp();
  const out = path.join(r, "x.json");
  writeFileSync(out, JSON.stringify({ type: "result", total_cost_usd: 1.5, result: "ok" }));
  arreglarJsonOllama(out, "ollama:qwen3");
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), { type: "result", total_cost_usd: 0, result: "ok", motor: "ollama", modelo_local: "ollama:qwen3" });
  writeFileSync(out, "roto");
  arreglarJsonOllama(out, "ollama:qwen3");
  assert.equal(readFileSync(out, "utf8"), "roto");
});

test("escribirLatido: sin saltos ni tabs y cortado a 160 caracteres", () => {
  const hb = path.join(tmp(), "hb");
  escribirLatido(hb, "codex", `a\tb\nc${"é".repeat(300)}`, 1700000000);
  const t = readFileSync(hb, "utf8");
  assert.ok(t.startsWith("epoch=1700000000\ntool=codex\nenvuelo=1\ndesc=a b c"));
  assert.equal(Array.from(t.split("desc=")[1]!.replace(/\n$/, "")).length, 160);
});
