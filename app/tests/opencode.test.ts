// electron/opencode.ts: el modelo `opencode:<proveedor>/<modelo>`, qué es gratis, la lista de `opencode models`, dónde está el binario
// y cómo se sabe si hay login. Sin opencode de verdad (la parte con binario está en opencode-puente.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { contarCredenciales, esErrorCuota, esGratis, esModeloOpencode, estadoOpencode, formatearModelo, hayOpencode, effortDefectoOpencode, effortParaAcp, listarModelos, listarModelosConEfforts, mensajeCuotaOpencode, parsearModelosVerbose, parsearModelo, parsearModelos, politicaOpencode, proveedoresConLogin, resolverOpencode } from "../electron/opencode.ts";

test("parsearModelo: opencode:<proveedor>/<modelo>", () => {
  assert.deepEqual(parsearModelo("opencode:opencode/deepseek-v4.1-flash-free"), { proveedor: "opencode", modelo: "deepseek-v4.1-flash-free", valor: "opencode/deepseek-v4.1-flash-free" });
  assert.deepEqual(parsearModelo("opencode:openrouter/qwen/qwen3:free"), { proveedor: "openrouter", modelo: "qwen/qwen3:free", valor: "openrouter/qwen/qwen3:free" });
  for (const mal of ["opencode:", "opencode:solo", "opencode:/x", "opencode:a/", "dsh:opencode/big-pickle", "opencode:a b/c", "opencode:a/b c", null, 3]) assert.equal(parsearModelo(mal), null, String(mal));
  assert.equal(formatearModelo("opencode/big-pickle"), "opencode:opencode/big-pickle");
  assert.ok(esModeloOpencode("opencode:opencode/big-pickle") && !esModeloOpencode("dsh:opencode/big-pickle"));
});

test("esGratis: *-free y big-pickle", () => {
  for (const g of ["opencode/beam-free", "opencode:opencode/glm-5.3-flash-free", "opencode/big-pickle", "opencode:opencode/big-pickle"]) assert.ok(esGratis(g), g);
  for (const p of ["opencode/gpt-5", "anthropic/claude-sonnet-5", "opencode:openrouter/big-pickle", "opencode/free-thing"]) assert.ok(!esGratis(p), p);
});

test("parsearModelos: una línea <proveedor>/<modelo>, sin ruido ni repetidos", () => {
  const sal = "\u001b[0mopencode/beam-free\nopencode/big-pickle\n\nWarning: algo\nopencode/beam-free\namazon-bedrock/amazon.nova-lite-v1:0\n  openrouter/qwen/qwen3-coder:free  \n";
  assert.deepEqual(parsearModelos(sal), ["opencode/beam-free", "opencode/big-pickle", "amazon-bedrock/amazon.nova-lite-v1:0", "openrouter/qwen/qwen3-coder:free"]);
});

test("resolverOpencode / hayOpencode: HILOS_OPENCODE, PATH, ~/.opencode/bin", () => {
  const existe = (f: string) => f === "/h/.opencode/bin/opencode";
  assert.equal(resolverOpencode({ PATH: "/usr/bin" }, "/h", existe), "/h/.opencode/bin/opencode");
  assert.equal(resolverOpencode({ PATH: "/usr/bin" }, "/h", () => false), "opencode");
  assert.equal(resolverOpencode({ HILOS_OPENCODE: "/x/oc" }, "/h", () => false), "/x/oc");
  assert.ok(hayOpencode({ PATH: "" }, "/h", existe));
  assert.ok(!hayOpencode({ PATH: "" }, "/h", () => false));
  assert.ok(!hayOpencode({ HILOS_OPENCODE: "/no/existe" }, "/h", () => false));
  assert.ok(!hayOpencode({ HILOS_CAPTURA: "1" }, "/h", () => false));
});

test("login: auth.json (sólo los ids) o `providers list`", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "oc-auth-"));
  try {
    assert.deepEqual(proveedoresConLogin({ XDG_DATA_HOME: tmp }, tmp), []);
    mkdirSync(path.join(tmp, "opencode"), { recursive: true });
    writeFileSync(path.join(tmp, "opencode", "auth.json"), JSON.stringify({ opencode: { type: "oauth", access: "SECRETO" }, openai: { type: "api", key: "sk-x" } }));
    assert.deepEqual(proveedoresConLogin({ XDG_DATA_HOME: tmp }, tmp), ["opencode", "openai"]);
    const e = await estadoOpencode({ env: { XDG_DATA_HOME: tmp, HILOS_OPENCODE: "/x/oc" }, home: tmp, existe: () => true, correr: async () => "1.2.3\n" });
    assert.deepEqual({ ...e, comando: "" }, { version: 1, instalado: true, versionOpencode: "1.2.3", comando: "", logueado: true, proveedores: ["opencode", "openai"], consola: true });
    assert.ok(!JSON.stringify(e).includes("SECRETO"));
    // sin auth.json: lo que dice el programa
    const sin = (n: number) => estadoOpencode({ env: { XDG_DATA_HOME: path.join(tmp, "nada"), HILOS_OPENCODE: "/x/oc" }, home: tmp, existe: () => true, correr: async (_b, a) => (a[0] === "--version" ? "2.1.4" : `T  Credentials\n|\n—  ${n} credentials\n`) });
    assert.equal((await sin(0)).logueado, false);
    assert.equal((await sin(2)).logueado, true);
    const roto = await estadoOpencode({ env: { XDG_DATA_HOME: path.join(tmp, "nada"), HILOS_OPENCODE: "/x/oc" }, home: tmp, existe: () => true, correr: async (_b, a) => { if (a[0] === "--version") return "2.1.4"; throw new Error("x"); } });
    assert.equal(roto.logueado, null);
    const no = await estadoOpencode({ env: { HILOS_OPENCODE: "/no" }, home: tmp, existe: () => false, correr: async () => "" });
    assert.deepEqual([no.instalado, no.versionOpencode, no.logueado], [false, null, null]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  assert.equal(contarCredenciales("\u001b[90m—  1 credentials"), 1);
  assert.equal(contarCredenciales("nada"), null);
});

test("listarModelos corre `opencode models` (con --refresh si se pide)", async () => {
  const vistos: string[][] = [];
  const d = { env: { HILOS_OPENCODE: "/x/oc" }, home: "/h", existe: () => true, correr: async (_b: string, a: string[]) => (vistos.push(a), "opencode/beam-free\nopencode/big-pickle\n") };
  assert.deepEqual(await listarModelos(d), ["opencode/beam-free", "opencode/big-pickle"]);
  await listarModelos(d, true);
  assert.deepEqual(vistos, [["models"], ["models", "--refresh"]]);
});

test("cuota y permisos", async () => {
  assert.ok(esErrorCuota("429 FreeUsageLimitError: Free usage limit reached"));
  assert.match(mensajeCuotaOpencode("opencode/beam-free"), /\/connect/);
  const p = politicaOpencode("/w/proy");
  const pide = (rawInput: object) => p({ sessionId: "s", entrada: {}, toolCall: { rawInput }, opciones: [] });
  assert.equal(await pide({ filepath: "/w/proy/a.txt", parentDir: "/w/proy" }), "permitir");
  assert.equal(await pide({ filepath: "/tmp/fuera.txt", parentDir: "/tmp" }), "rechazar");
  assert.equal(await pide({ filepath: "../otro/a" }), "rechazar");
  assert.equal(await pide({ pattern: "x" }), "permitir");
});

const VERBOSE = [
  "opencode/beam-free",
  JSON.stringify({ id: "beam-free", variants: { low: { reasoningEffort: "low" }, medium: {}, high: {} } }, null, 2),
  "opencode/big-pickle",
  JSON.stringify({ id: "big-pickle", variants: {} }, null, 2),
  "\u001b[0mopenai/gpt-x",
  JSON.stringify({ id: "gpt-x", variants: { minimal: {}, xhigh: {} } }, null, 2),
  "openrouter/sin-json",
  "{ roto",
  "amazon/nova",
  JSON.stringify({ id: "nova" }, null, 2),
].join("\n");

test("parsearModelosVerbose: los niveles salen de `variants` (vacío si no razona o el JSON está roto)", () => {
  assert.deepEqual(parsearModelosVerbose(VERBOSE), {
    "opencode/beam-free": ["low", "medium", "high"],
    "opencode/big-pickle": [],
    "openai/gpt-x": ["minimal", "xhigh"],
    "openrouter/sin-json": [],
    "amazon/nova": [],
  });
  assert.equal(effortDefectoOpencode(["low", "medium", "high"]), "medium");
  assert.equal(effortDefectoOpencode(["minimal", "xhigh"]), "minimal");
});

test("listarModelosConEfforts: verbose; si falla, la lista pelada; --refresh desconocido se reintenta sin él", async () => {
  const vistos: string[][] = [];
  const base = { env: { HILOS_OPENCODE: "/x/oc" }, home: "/h", existe: () => true };
  const ok = await listarModelosConEfforts({ ...base, correr: async (_b, a) => (vistos.push(a), VERBOSE) }, true);
  assert.deepEqual(ok.efforts["opencode/beam-free"], ["low", "medium", "high"]);
  assert.deepEqual(vistos, [["models", "--verbose", "--refresh"]]);
  const rechaza = new Error("Unrecognized flag: --refresh in command opencode models");
  const v2: string[][] = [];
  const sinRefresh = await listarModelosConEfforts({ ...base, correr: async (_b, a) => (v2.push(a), a.includes("--refresh") ? Promise.reject(rechaza) : VERBOSE) }, true);
  assert.ok(sinRefresh.modelos.includes("opencode/beam-free"));
  assert.deepEqual(v2, [["models", "--verbose", "--refresh"], ["models", "--verbose"]]);
  const pelada = await listarModelosConEfforts({ ...base, correr: async (_b, a) => (a.includes("--verbose") ? Promise.reject(new Error("x")) : "opencode/beam-free\n") });
  assert.deepEqual(pelada, { modelos: ["opencode/beam-free"], efforts: {} });
  // listarModelos con --refresh rechazado cae a `models`
  const v3: string[][] = [];
  assert.deepEqual(await listarModelos({ ...base, correr: async (_b, a) => (v3.push(a), a.includes("--refresh") ? Promise.reject(rechaza) : "opencode/big-pickle\n") }, true), ["opencode/big-pickle"]);
  assert.deepEqual(v3, [["models", "--refresh"], ["models"]]);
});

test("effortParaAcp: sólo si la sesión ofrece `effort` y el valor es uno de los suyos", () => {
  const ops = [{ id: "model" }, { id: "effort", options: [{ value: "low" }, { value: "medium" }, { value: "default" }] }];
  assert.equal(effortParaAcp(ops, "medium"), "medium");
  assert.equal(effortParaAcp(ops, "xhigh"), null);
  assert.equal(effortParaAcp(ops, ""), null);
  assert.equal(effortParaAcp([{ id: "model" }], "low"), null);
  assert.equal(effortParaAcp([{ id: "effort" }], "low"), "low");
  assert.equal(effortParaAcp(ops, "--x y"), null);
});

test("login 2.x: `auth list` con «OpenCode Console … stored» y sin auth.json", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "oc-auth2-"));
  try {
    const visto: string[] = [];
    const e = await estadoOpencode({
      env: { XDG_DATA_HOME: path.join(tmp, "nada"), HILOS_OPENCODE: "/x/oc" },
      home: tmp,
      existe: () => true,
      correr: async (_b, a) => {
        visto.push(a.join(" "));
        if (a[0] === "--version") return "2.1.4";
        if (a[0] === "auth") return "\u001b[90m│\u001b[0m  OpenCode Console  Personal                    stored\n";
        throw new Error('Unexpected positional argument: "list"');
      },
    });
    assert.deepEqual([e.logueado, e.consola], [true, true]);
    assert.equal(visto[1], "auth list");
    // el otro lugar de auth.json (~/.local/share) también cuenta
    mkdirSync(path.join(tmp, ".local", "share", "opencode"), { recursive: true });
    writeFileSync(path.join(tmp, ".local", "share", "opencode", "auth.json"), JSON.stringify({ openai: {} }));
    assert.deepEqual(proveedoresConLogin({ XDG_DATA_HOME: path.join(tmp, "otro") }, tmp), ["openai"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
