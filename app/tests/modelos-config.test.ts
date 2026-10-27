// La config de modelos compartida con `pa` (electron/modelos-config.ts + modelos-tipos.ts): leer y escribir
// `modelos.json` (atómico, con `version`, sin perder claves desconocidas, sin crearlo hasta guardar), validar,
// sondear Ollama (contra un servidor HTTP de mentira en loopback: nunca un modelo de verdad) y poner al día las
// tres filas de `~/CLAUDE.md`. Todo en carpetas temporales con un `pa` de mentira.
import { test, after } from "node:test";
import { soloPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { DEFAULTS_CLAUDE, DEFAULTS_GEMINI, GEMINI, TIPOS, defaultsDe, efectivoDe, leerConfig, unir, urlOllama, validarConfig, HOY, type ConfigModelos } from "../electron/modelos-tipos.ts";
import { guardarModelos, leerModelos, sondearOllama, type CorrerPa } from "../electron/modelos-config.ts";
import { parsearRouting } from "../electron/routing.ts";
import { cambiarIdioma, textoMain } from "../src/i18n/index.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-modelos-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const nuevaRuta = () => path.join(tmp, `c${++n}`, "trama", "modelos.json");

const enEs = (s: string) => {
  cambiarIdioma("es");
  try {
    return textoMain(s);
  } finally {
    cambiarIdioma("en");
  }
};
const lanza = (re: RegExp) => (e: unknown) => re.test(enEs((e as Error).message));

const CONTRATO = {
  version: 1,
  lider: { modelo: "claude-opus-5-5", effort: "high" },
  workers: { default: { modelo: "claude-sonnet-5-5", effort: "high" }, "codigo-acotado": { modelo: "gemini-4-argon-high" }, mecanico: { modelo: "ollama:qwen3-coder:30b" } },
  locales: [{ id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B", url: "http://localhost:11434", modelo: "qwen3-coder:30b" }],
  gemini: { cupo_max: 70, sin_claude: "esperar" },
  claude: {},
  destrabar: {},
};
const escribir = (ruta: string, x: unknown) => {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, typeof x === "string" ? x : JSON.stringify(x, null, 2));
};

test("sin archivo: lo de hoy, y leer no crea nada", async () => {
  const ruta = nuevaRuta();
  const e = await leerModelos(undefined, ruta);
  assert.equal(e.existe, false);
  assert.equal(e.error, null);
  assert.deepEqual(e.config, { workers: {}, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} });
  assert.equal(e.efectivo, null);
  assert.equal(existsSync(path.dirname(ruta)), false);
});

test("lee el contrato completo", async () => {
  const ruta = nuevaRuta();
  escribir(ruta, CONTRATO);
  const e = await leerModelos(undefined, ruta);
  assert.equal(e.existe, true);
  assert.deepEqual(e.config.lider, { modelo: "claude-opus-5-5", effort: "high" });
  assert.deepEqual(e.config.workers["codigo-acotado"], { modelo: "gemini-4-argon-high" });
  assert.equal(e.config.locales[0]!.id, "ollama:qwen3-coder:30b");
  assert.deepEqual(e.config.gemini, { cupo_max: 70 });
  // El `sin_claude` viejo (Gemini) se lee como el `sin_cupo` de ahora.
  assert.equal(e.config.sin_cupo, "esperar");
});

test("guardar crea la carpeta, escribe con version 1 y no deja temporales", async () => {
  const ruta = nuevaRuta();
  const e = await guardarModelos({ lider: { modelo: "claude-opus-5-5", effort: "xhigh" }, workers: {}, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} }, undefined, ruta);
  assert.equal(e.existe, true);
  const j = JSON.parse(readFileSync(ruta, "utf8"));
  assert.equal(j.version, 1);
  assert.deepEqual(j.lider, { modelo: "claude-opus-5-5", effort: "xhigh" });
  assert.equal("workers" in j, false);
  assert.deepEqual(readdirSync(path.dirname(ruta)), ["modelos.json"]);
});

test("guardar conserva las claves que no conoce y saca lo que el borrador ya no tiene", async () => {
  const ruta = nuevaRuta();
  escribir(ruta, {
    ...CONTRATO,
    futuro: { x: 1 },
    lider: { modelo: "claude-opus-5-5", effort: "high", nota: "mia" },
    gemini: { cupo_max: 70, sin_claude: "esperar", otro: true },
    locales: [{ ...CONTRATO.locales[0], etiqueta: "rapido" }],
  });
  const e = await leerModelos(undefined, ruta);
  const c: ConfigModelos = structuredClone(e.config);
  c.lider = { modelo: "claude-sonnet-5-5", effort: "medium" };
  delete c.workers.mecanico; // vuelve a "como hoy"
  c.gemini = { cupo_max: 50 }; // un borrador viejo que todavía lo trae: no se escribe más
  await guardarModelos(c, undefined, ruta);
  const j = JSON.parse(readFileSync(ruta, "utf8"));
  assert.deepEqual(j.futuro, { x: 1 });
  assert.deepEqual(j.lider, { modelo: "claude-sonnet-5-5", effort: "medium", nota: "mia" });
  assert.equal("mecanico" in j.workers, false);
  assert.deepEqual(j.workers["codigo-acotado"], { modelo: "gemini-4-argon-high" });
  assert.deepEqual(j.gemini, { otro: true }, "gemini.cupo_max ya no se escribe (el motor no lo usa); lo ajeno se conserva");
  assert.equal(j.locales[0].etiqueta, "rapido");
});

test("un modelo que no es de Claude no lleva effort al cambiar desde uno que sí", () => {
  const antes = { version: 1, lider: { modelo: "claude-opus-5-5", effort: "high" } };
  const c = validarConfig({ lider: { modelo: "gemini-4-argon-low" } });
  assert.deepEqual((unir(antes, c).lider as object), { modelo: "gemini-4-argon-low" });
});

test("guardar sin cambios no reescribe el archivo", async () => {
  const ruta = nuevaRuta();
  const { version: _v, ...sinVersion } = CONTRATO;
  escribir(ruta, JSON.stringify(unir(null, validarConfig(sinVersion)), null, 2) + "\n");
  const antes = readFileSync(ruta, "utf8");
  await guardarModelos((await leerModelos(undefined, ruta)).config, undefined, ruta);
  assert.equal(readFileSync(ruta, "utf8"), antes);
});

test("un JSON roto o de otra versión se muestra y NO se pisa", async () => {
  for (const [texto, re] of [
    ['{ "version": 1, ', /No puedo leer/],
    ["[]", /No puedo leer/],
    ['{"version": 2, "lider": {}}', /versión 2/],
  ] as [string, RegExp][]) {
    const ruta = nuevaRuta();
    escribir(ruta, texto);
    const e = await leerModelos(undefined, ruta);
    assert.match(enEs(e.error!), re);
    await assert.rejects(guardarModelos({ lider: { modelo: "claude-opus-5-5" } }, undefined, ruta), lanza(re));
    assert.equal(readFileSync(ruta, "utf8"), texto);
  }
});

test("sigue el symlink al guardar (dotfiles)", { skip: soloPosix("symlinks") }, async () => {
  const dir = path.dirname(nuevaRuta());
  mkdirSync(dir, { recursive: true });
  const real = path.join(tmp, "real-modelos.json");
  writeFileSync(real, JSON.stringify({ version: 1 }));
  const link = path.join(dir, "modelos.json");
  symlinkSync(real, link);
  await guardarModelos({ lider: { modelo: "claude-haiku-5-5", effort: "low" } }, undefined, link);
  assert.equal(JSON.parse(readFileSync(real, "utf8")).lider.modelo, "claude-haiku-5-5");
});

test("validación: lo que no vale se rechaza con su motivo y sin tocar el archivo", async () => {
  const ruta = nuevaRuta();
  escribir(ruta, CONTRATO);
  const antes = readFileSync(ruta, "utf8");
  const casos: [unknown, RegExp][] = [
    [{ lider: { modelo: "gpt-9" } }, /no conozco el modelo/],
    [{ lider: { modelo: "ollama:no-esta" } }, /no está en la lista de modelos locales/],
    [{ lider: { modelo: "gemini-4-argon-high", effort: "high" } }, /sólo los modelos de Claude/],
    [{ lider: { modelo: "claude-opus-5-5", effort: "mucho" } }, /no existe/],
    [{ workers: { magia: { modelo: "claude-opus-5-5" } } }, /no es un tipo de worker/],
    [{ gemini: { cupo_max: 0 } }, /número entero del 1 al 100/],
    [{ gemini: { cupo_max: 101 } }, /número entero del 1 al 100/],
    [{ gemini: { cupo_max: 5.5 } }, /número entero/],
    [{ sin_cupo: "quizas" }, /esperar o fallar/],
    [{ gemini: { rarisimo: 1 } }, /Campo desconocido/],
    [{ cosa: 1 }, /Campo desconocido/],
    [{ locales: [{ id: "ollama:x", modelo: "x", url: "ftp://a" }] }, /no es una dirección http/],
    [{ locales: [{ id: "otro", modelo: "x", url: "http://localhost:11434" }] }, /debería llamarse ollama:x/],
    [{ locales: [{ id: "ollama:x", modelo: "x y", url: "http://localhost:11434" }] }, /nombre del modelo/],
    [
      { locales: [{ id: "ollama:x", modelo: "x", url: "http://a:1" }, { id: "ollama:x", modelo: "x", url: "http://a:1" }] },
      /dos veces/,
    ],
    ["texto", /forma esperada/],
  ];
  for (const [x, re] of casos) await assert.rejects(guardarModelos(x, undefined, ruta), lanza(re), JSON.stringify(x));
  assert.equal(readFileSync(ruta, "utf8"), antes);
});

test("urlOllama normaliza y rechaza lo que no es http(s)", () => {
  assert.equal(urlOllama(" http://localhost:11434/ "), "http://localhost:11434");
  assert.equal(urlOllama("https://caja.local:8443"), "https://caja.local:8443");
  for (const mal of ["localhost:11434", "file:///x", "http://u:p@h", "http://h?x=1", "", 3, null]) assert.equal(urlOllama(mal), null);
});

test("leerConfig es tolerante: ignora lo que no entiende", () => {
  const c = leerConfig({ lider: 3, workers: { default: { modelo: "claude-sonnet-5-5" }, mecanico: { modelo: 5 } }, locales: [{ id: 1 }], gemini: { cupo_max: "mucho", sin_claude: "x" } });
  assert.deepEqual(c, { workers: { default: { modelo: "claude-sonnet-5-5" } }, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} });
});

test("qué corre hoy: el tipo, el default del archivo o lo de siempre", () => {
  const vacia: ConfigModelos = { workers: {}, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} };
  assert.deepEqual(efectivoDe(vacia, "default"), HOY.workers.default);
  assert.deepEqual(efectivoDe(vacia, "mecanico"), { modelo: "claude-haiku-5-5", effort: "xhigh" });
  const c: ConfigModelos = { workers: { default: { modelo: "gemini-4-argon-low" }, lectura: { modelo: "claude-opus-5-5", effort: "max" } }, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} };
  assert.deepEqual(efectivoDe(c, "debug"), { modelo: "gemini-4-argon-low" });
  assert.deepEqual(efectivoDe(c, "lectura"), { modelo: "claude-opus-5-5", effort: "max" });
});

test("defaults por tipo de tarea: Haiku para leer y lo mecánico, Sonnet para el código, Opus para debug y diseño", () => {
  const vacia: ConfigModelos = { workers: {}, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} };
  const H = { modelo: "claude-haiku-5-5", effort: "xhigh" };
  const S = { modelo: "claude-sonnet-5-5", effort: "high" };
  const O = { modelo: "claude-opus-5-5", effort: "xhigh" };
  assert.deepEqual(
    Object.fromEntries(TIPOS.map((t) => [t, efectivoDe(vacia, t)])),
    { default: S, lectura: H, mecanico: H, "codigo-acotado": S, "codigo-multi": S, frontend: S, debug: O, diseno: O },
  );
  assert.equal(defaultsDe(false), DEFAULTS_CLAUDE);
  // El `default` del archivo sigue valiendo para los tipos que no tienen fila.
  const c: ConfigModelos = { workers: { default: { modelo: "claude-opus-5-5", effort: "low" } }, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} };
  assert.deepEqual(efectivoDe(c, "lectura"), { modelo: "claude-opus-5-5", effort: "low" });
});

test("sin Claude (sólo Gemini): Argon para todo lo que pesa y Flash sólo para lo mecánico", () => {
  const vacia: ConfigModelos = { workers: {}, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} };
  for (const t of TIPOS) {
    const m = efectivoDe(vacia, t, true).modelo;
    assert.equal(m, t === "mecanico" ? "gemini-3.8-flash-medium" : "gemini-4-argon-high", t);
    assert.ok((GEMINI as readonly string[]).includes(m), `${m} lo sabe lanzar pa`);
  }
  assert.equal(defaultsDe(true), DEFAULTS_GEMINI);
  assert.doesNotThrow(() => validarConfig({ workers: DEFAULTS_GEMINI }));
  assert.doesNotThrow(() => validarConfig({ workers: DEFAULTS_CLAUDE }));
});

test("la tabla efectiva viene de `pa --modelos --json` si existe; si falla, se arma del archivo", async () => {
  const ruta = nuevaRuta();
  escribir(ruta, CONTRATO);
  const llamadas: string[][] = [];
  const pa: CorrerPa = async (args) => {
    llamadas.push(args);
    return { rc: 0, out: JSON.stringify({ lider: { modelo: "claude-opus-5-5", effort: "high" }, workers: { debug: { modelo: "claude-sonnet-5-5", effort: "high" } } }), dijo: "" };
  };
  const e = await leerModelos(pa, ruta);
  assert.deepEqual(llamadas, [["--modelos", "--json"]]);
  assert.deepEqual(e.efectivo?.workers.debug, { modelo: "claude-sonnet-5-5", effort: "high" });
  for (const mal of [async () => ({ rc: 2, out: "", dijo: "no existe" }), async () => ({ rc: 0, out: "no es json", dijo: "" }), async () => { throw new Error("x"); }] as CorrerPa[])
    assert.equal((await leerModelos(mal, ruta)).efectivo, null);
});

// --- Ollama, con un servidor de mentira ---------------------------------------------------------------

function servidor(manejar: http.RequestListener): Promise<{ url: string; cerrar: () => void }> {
  return new Promise((res) => {
    const s = http.createServer(manejar).listen(0, "127.0.0.1", () => res({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => s.close() }));
  });
}

test("sondear Ollama lista lo instalado y no carga nada", async () => {
  const pedidos: string[] = [];
  const s = await servidor((req, res) => {
    pedidos.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ models: [{ name: "qwen3-coder:30b", size: 18_000_000_000 }, { model: "llama3.2:3b" }, { size: 1 }] }));
  });
  try {
    const r = await sondearOllama(s.url + "/");
    assert.deepEqual(r, { ok: true, modelos: [{ nombre: "qwen3-coder:30b", bytes: 18_000_000_000 }, { nombre: "llama3.2:3b", bytes: null }] });
    assert.deepEqual(pedidos, ["GET /api/tags"]);
  } finally {
    s.cerrar();
  }
});

test("sondear Ollama: no responde, error HTTP, no es Ollama, tarda", async () => {
  const caido = await servidor((_q, r) => r.end());
  caido.cerrar();
  await new Promise((r) => setTimeout(r, 30));
  const r1 = await sondearOllama(caido.url);
  assert.ok(!r1.ok && /No contesta nadie/.test(enEs(r1.motivo)));

  const e500 = await servidor((_q, r) => { r.statusCode = 500; r.end("x"); });
  const r2 = await sondearOllama(e500.url);
  assert.ok(!r2.ok && /500/.test(enEs((r2 as { motivo: string }).motivo)));
  e500.cerrar();

  const otro = await servidor((_q, r) => r.end(JSON.stringify({ hola: 1 })));
  const r3 = await sondearOllama(otro.url);
  assert.ok(!r3.ok && /no parece Ollama/.test(enEs((r3 as { motivo: string }).motivo)));
  otro.cerrar();

  const lento = await servidor(() => {});
  const r4 = await sondearOllama(lento.url, 100);
  assert.ok(!r4.ok && /tardó demasiado/.test(enEs((r4 as { motivo: string }).motivo)));
  lento.cerrar();

  await assert.rejects(sondearOllama("no es una url"), lanza(/no es una dirección http/));
});

// --- Las tres filas de ~/CLAUDE.md ---------------------------------------------------------------------

const CLAUDE_MD = `# Ejemplo

<!-- trama:routing (la app trama edita esta tabla; no cambiar el formato de las filas) -->
| Rol | Modelo | Effort |
|---|---|---|
| Orquestador (jefe) | Opus 5.5 | high |
| Worker que escribe código | \`claude-opus-5-5\` | medium |
| Worker exploración (leer repo, auditar; \`--leer\`) | \`claude-sonnet-5-5\` | high |
| Frontend / diseño visual | \`claude-fable-5-1\` | high |
<!-- /trama:routing -->
`;

test("destrabar: se lee, se valida, se escribe disperso y no pisa lo ajeno", async () => {
  assert.deepEqual(leerConfig({ destrabar: { "gemini-3.8-flash": false, "gemini-4-argon": true, "claude-opus-5-5": true, x: 3 } }).destrabar, { "gemini-3.8-flash": false, "gemini-4-argon": true });
  assert.deepEqual(leerConfig({}).destrabar, {});
  const base = { workers: {}, locales: [], excluir: [], permitir_max: false, gemini: {}, claude: {} };
  assert.throws(() => validarConfig({ ...base, destrabar: { "gemini-3.8-flash": "si" } }));
  assert.throws(() => validarConfig({ ...base, destrabar: { "claude-opus-5-5": true } }), "sólo modelos de agy");
  const ruta = nuevaRuta();
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, JSON.stringify({ version: 1, algo_ajeno: { x: 1 } }));
  await guardarModelos({ ...base, destrabar: { "gemini-3.8-flash": false } }, undefined, ruta);
  let j = JSON.parse(readFileSync(ruta, "utf8"));
  assert.deepEqual(j.destrabar, { "gemini-3.8-flash": false });
  assert.deepEqual(j.algo_ajeno, { x: 1 });
  assert.deepEqual((await leerModelos(undefined, ruta)).config.destrabar, { "gemini-3.8-flash": false });
  await guardarModelos({ ...base, destrabar: {} }, undefined, ruta);
  j = JSON.parse(readFileSync(ruta, "utf8"));
  assert.ok(!("destrabar" in j), "sin nada tocado sale del archivo");
});

test("excluir y permitir_max: se leen, se validan y se escriben sólo si no son el default, sin pisar lo ajeno", async () => {
  assert.deepEqual(leerConfig({ excluir: ["Fable", "claude-opus-5-*", 3, "con espacio"], permitir_max: true }).excluir, ["Fable", "claude-opus-5-*"]);
  assert.equal(leerConfig({ permitir_max: true }).permitir_max, true);
  assert.equal(leerConfig({}).permitir_max, false);
  const base = { workers: {}, locales: [], gemini: {}, claude: {} };
  assert.throws(() => validarConfig({ ...base, excluir: ["con espacio"] }));
  assert.throws(() => validarConfig({ ...base, excluir: "fable" }));
  assert.throws(() => validarConfig({ ...base, permitir_max: "si" }));
  const ruta = nuevaRuta();
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, JSON.stringify({ version: 1, algo_ajeno: { x: 1 } }));
  await guardarModelos({ workers: {}, locales: [], excluir: ["fable"], permitir_max: true, gemini: {}, claude: {} }, undefined, ruta);
  let j = JSON.parse(readFileSync(ruta, "utf8"));
  assert.deepEqual(j.excluir, ["fable"]);
  assert.equal(j.permitir_max, true);
  assert.deepEqual(j.algo_ajeno, { x: 1 });
  const e = await leerModelos(undefined, ruta);
  assert.deepEqual(e.config.excluir, ["fable"]);
  assert.equal(e.config.permitir_max, true);
  await guardarModelos({ workers: {}, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} }, undefined, ruta);
  j = JSON.parse(readFileSync(ruta, "utf8"));
  assert.ok(!("excluir" in j) && !("permitir_max" in j), "lo que vuelve al default sale del archivo");
  assert.deepEqual(j.algo_ajeno, { x: 1 });
});

test("guarda y lee reparto: auto y modelos agy:*", async () => {
  const ruta = nuevaRuta();
  await guardarModelos({ lider: { modelo: "agy:claude-opus-5-5-high" }, reparto: "auto", workers: { mecanico: { modelo: "agy:gpt-oss-120b-medium" } }, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} }, undefined, ruta);
  const j = JSON.parse(readFileSync(ruta, "utf8"));
  assert.equal(j.reparto, "auto");
  assert.deepEqual(j.lider, { modelo: "agy:claude-opus-5-5-high" });
  assert.deepEqual(j.workers.mecanico, { modelo: "agy:gpt-oss-120b-medium" });
  const e = await leerModelos(undefined, ruta);
  assert.equal(e.config.reparto, "auto");
  assert.deepEqual(e.config.lider, { modelo: "agy:claude-opus-5-5-high" });
});

test("topes de Claude: `reserva` (lo libre) se lee como tope y se escribe como `reserva` por ventana", async () => {
  assert.deepEqual(leerConfig({ reserva: 0.15 }).claude, { tope_5h: 85, tope_7d: 85 });
  assert.deepEqual(leerConfig({ reserva: { "5h": 0.2, "7d": 0.4 } }).claude, { tope_5h: 80, tope_7d: 60 });
  assert.deepEqual(leerConfig({ reserva: { "7d": 0.4 } }).claude, { tope_7d: 60 });
  assert.deepEqual(leerConfig({ reserva: "mucho" }).claude, {});
  assert.deepEqual(leerConfig({ reserva: 1.5 }).claude, {});
  assert.deepEqual(leerConfig({}).claude, {});
  const ruta = nuevaRuta();
  escribir(ruta, CONTRATO);
  const c: ConfigModelos = structuredClone((await leerModelos(undefined, ruta)).config);
  c.claude = { tope_5h: 80, tope_7d: 60 };
  const e = await guardarModelos(c, undefined, ruta);
  assert.deepEqual(JSON.parse(readFileSync(ruta, "utf8")).reserva, { "5h": 0.2, "7d": 0.4 });
  assert.deepEqual(e.config.claude, { tope_5h: 80, tope_7d: 60 });
  // Sólo una ventana: la otra queda sin escribir (reparto usa su default).
  c.claude = { tope_7d: 90 };
  await guardarModelos(c, undefined, ruta);
  assert.deepEqual(JSON.parse(readFileSync(ruta, "utf8")).reserva, { "7d": 0.1 });
  // Sin topes (el interruptor apagado): `reserva: null`, que `reparto` lee como "no guardar nada".
  c.claude = {};
  await guardarModelos(c, undefined, ruta);
  assert.equal(JSON.parse(readFileSync(ruta, "utf8")).reserva, null);
  // Y si nunca hubo reserva, no se inventa una.
  const otra = nuevaRuta();
  escribir(otra, { ...CONTRATO, reserva: undefined });
  const d: ConfigModelos = structuredClone((await leerModelos(undefined, otra)).config);
  d.claude = {};
  d.lider = { modelo: "claude-sonnet-5-5", effort: "high" };
  await guardarModelos(d, undefined, otra);
  assert.equal("reserva" in JSON.parse(readFileSync(otra, "utf8")), false);
});

test("sin_cupo: se escribe, reemplaza al sin_claude viejo y se valida", async () => {
  const ruta = nuevaRuta();
  escribir(ruta, CONTRATO);
  const c: ConfigModelos = structuredClone((await leerModelos(undefined, ruta)).config);
  c.sin_cupo = "fallar";
  await guardarModelos(c, undefined, ruta);
  const j = JSON.parse(readFileSync(ruta, "utf8"));
  assert.equal(j.sin_cupo, "fallar");
  assert.equal("sin_claude" in (j.gemini ?? {}), false);
  assert.equal((await leerModelos(undefined, ruta)).config.sin_cupo, "fallar");
  await assert.rejects(guardarModelos({ ...c, sin_cupo: "quizas" as never }, undefined, ruta), lanza(/esperar o fallar/));
});

test("topes de Claude: un `reserva` que ya dice lo mismo no se reescribe", async () => {
  const ruta = nuevaRuta();
  escribir(ruta, { ...CONTRATO, reserva: 0.155 });
  const c: ConfigModelos = structuredClone((await leerModelos(undefined, ruta)).config);
  assert.deepEqual(c.claude, { tope_5h: 85, tope_7d: 85 }); // round(84.5)
  c.lider = { modelo: "claude-sonnet-5-5", effort: "low" };
  await guardarModelos(c, undefined, ruta);
  assert.equal(JSON.parse(readFileSync(ruta, "utf8")).reserva, 0.155);
});

test("topes de Claude: enteros de 1 a 100, y nada desconocido adentro", async () => {
  const ruta = nuevaRuta();
  escribir(ruta, CONTRATO);
  const antes = readFileSync(ruta, "utf8");
  const casos: [unknown, RegExp][] = [
    [{ tope_5h: 0 }, /tope de uso de Claude/],
    [{ tope_7d: 101 }, /tope de uso de Claude/],
    [{ tope_5h: 50.5 }, /tope de uso de Claude/],
    [{ tope_5h: "85" }, /tope de uso de Claude/],
    [{ rarisimo: 1 }, /Campo desconocido/],
  ];
  for (const [claude, re] of casos) {
    const x = { workers: {}, locales: [], excluir: [], permitir_max: false, gemini: {}, claude };
    assert.throws(() => validarConfig(x), lanza(re), JSON.stringify(claude));
    await assert.rejects(guardarModelos(x as ConfigModelos, undefined, ruta), lanza(re));
  }
  assert.equal(readFileSync(ruta, "utf8"), antes);
  assert.doesNotThrow(() => validarConfig({ workers: {}, locales: [], excluir: [], permitir_max: false, gemini: {}, claude: { tope_5h: 1, tope_7d: 100 } }));
});

test("modelos dsh: la clase, el lector del líder y la validación (lider y workers aceptan dsh:<proveedor>/<modelo>, sin esfuerzo)", async () => {
  const { claseDeModelo, familiaDeModelo, localDeModelo, leerLider } = await import("../electron/modelos-config.ts");
  assert.equal(claseDeModelo("dsh:opencode/big-pickle"), "dsh");
  assert.equal(claseDeModelo("ollama:x"), "ollama");
  assert.equal(familiaDeModelo("ollama:x"), "claude");
  const cfg = leerLider(JSON.stringify(CONTRATO))!;
  assert.equal(localDeModelo("qwen3-coder:30b", cfg)?.id, "ollama:qwen3-coder:30b");
  assert.equal(localDeModelo("otro", cfg), null);

  const ok = validarConfig({ lider: { modelo: "dsh:opencode/deepseek-v4.1-flash-free" }, workers: { default: { modelo: "dsh:ollama/qwen3-coder:30b" } } });
  assert.deepEqual(ok.lider, { modelo: "dsh:opencode/deepseek-v4.1-flash-free" });
  assert.deepEqual(ok.workers.default, { modelo: "dsh:ollama/qwen3-coder:30b" });
  for (const mal of ["dsh:nube/x", "dsh:opencode/", "dsh:opencode", "dsh:"]) assert.throws(() => validarConfig({ lider: { modelo: mal } }), mal);
  assert.throws(() => validarConfig({ lider: { modelo: "dsh:opencode/big-pickle", effort: "high" } }), "dsh no lleva esfuerzo");

  // Y se escribe y se vuelve a leer tal cual.
  const ruta = nuevaRuta();
  await guardarModelos(ok, undefined, ruta);
  assert.equal(JSON.parse(readFileSync(ruta, "utf8")).lider.modelo, "dsh:opencode/deepseek-v4.1-flash-free");
  assert.equal((await leerModelos(undefined, ruta)).config.lider?.modelo, "dsh:opencode/deepseek-v4.1-flash-free");
});

test("modelos opencode: la clase, la familia y la validación (lider y workers aceptan opencode:<proveedor>/<modelo>, sin esfuerzo)", async () => {
  const { claseDeModelo, familiaDeModelo } = await import("../electron/modelos-config.ts");
  assert.equal(claseDeModelo("opencode:opencode/big-pickle"), "opencode");
  assert.equal(familiaDeModelo("opencode:opencode/big-pickle"), "opencode");
  const ok = validarConfig({ lider: { modelo: "opencode:opencode/deepseek-v4.1-flash-free" }, workers: { default: { modelo: "opencode:openrouter/qwen/qwen3-coder:free" } } });
  assert.deepEqual(ok.lider, { modelo: "opencode:opencode/deepseek-v4.1-flash-free" });
  assert.deepEqual(ok.workers.default, { modelo: "opencode:openrouter/qwen/qwen3-coder:free" });
  for (const mal of ["opencode:", "opencode:suelto", "opencode:/x", "opencode:a b/c"]) assert.throws(() => validarConfig({ lider: { modelo: mal } }), mal);
  assert.throws(() => validarConfig({ lider: { modelo: "opencode:opencode/beam-free", effort: "high" } }), "opencode no lleva esfuerzo");
});
