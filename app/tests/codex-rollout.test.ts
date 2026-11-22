// El contexto de codex sale del rollout (último `token_count`), no del acumulado de `turn.completed` (CTX-38).
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { carpetaCodex, contextoDeThread, hallarRollout, leerRollout, ultimoTokenCount, type DiscoRollout } from "../electron/codex-rollout.ts";
import { mensajesDeStream } from "../electron/cli/pa/hilo-stream.ts";
import { Traductor } from "../electron/codex-stream.ts";

const TH = "01a2020a-bc07-7523-8a09-70f63a322020";

/** Una línea `token_count` como las del rollout real (el `total_token_usage` es el acumulado de la sesión). */
const tc = (contexto: number, opciones: { cacheado?: number; salida?: number; ventana?: number | null; total?: number } = {}) =>
  JSON.stringify({
    timestamp: "2026-11-22T07:07:39.421Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { input_tokens: opciones.total ?? contexto * 10 },
        last_token_usage: { input_tokens: contexto, cached_input_tokens: opciones.cacheado ?? 0, output_tokens: opciones.salida ?? 50 },
        ...(opciones.ventana === null ? {} : { model_context_window: opciones.ventana ?? 475_000 }),
      },
    },
  });
const otra = JSON.stringify({ timestamp: "x", type: "event_msg", payload: { type: "agent_message", message: "hola" } });
const vacio = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null } });

/** Un disco en memoria: los archivos por ruta; las carpetas salen de los prefijos. */
function disco(archivos: Record<string, string>, sep: "/" | "\\"): DiscoRollout {
  return {
    listar(carpeta) {
      const pre = carpeta.endsWith(sep) ? carpeta : carpeta + sep;
      const nombres = new Set<string>();
      for (const r of Object.keys(archivos)) if (r.startsWith(pre)) nombres.add(r.slice(pre.length).split(sep)[0]!);
      return [...nombres];
    },
    cola(archivo, bytes) {
      const t = archivos[archivo];
      if (t === undefined) return null;
      const b = Buffer.from(t, "utf8");
      return { texto: b.subarray(Math.max(0, b.length - bytes)).toString("utf8"), entero: b.length <= bytes };
    },
  };
}

test("ultimoTokenCount: el último pedido manda (varios pedidos), no el acumulado; salta líneas rotas y token_count sin info", () => {
  const texto = [otra, tc(100_000, { cacheado: 90_000, salida: 10, total: 100_000 }), tc(110_000, { total: 210_000 }), tc(120_000, { cacheado: 100_000, salida: 7, total: 330_000 }), vacio, "{roto", otra, ""].join("\n");
  assert.deepEqual(ultimoTokenCount(texto), { contexto: 120_000, cacheado: 100_000, salida: 7, ventana: 475_000 });
  assert.equal(ultimoTokenCount([otra, vacio].join("\n")), null);
  assert.equal(ultimoTokenCount(""), null);
});

test("ultimoTokenCount: sin model_context_window la ventana queda desconocida; lo cacheado nunca pasa del contexto", () => {
  assert.deepEqual(ultimoTokenCount(tc(1000, { ventana: null, cacheado: 5000 })), { contexto: 1000, cacheado: 1000, salida: 50, ventana: null });
});

test("carpetaCodex: CODEX_HOME manda; si no, .codex del home (USERPROFILE en Windows)", () => {
  assert.equal(carpetaCodex({ CODEX_HOME: "/c/cx" }, "linux", "/home/ana"), "/c/cx");
  assert.equal(carpetaCodex({}, "linux", "/home/ana"), "/home/ana/.codex");
  assert.equal(carpetaCodex({ USERPROFILE: "C:\\Users\\Ana" }, "win32"), "C:\\Users\\Ana\\.codex");
  assert.equal(carpetaCodex({ CODEX_HOME: "D:\\cx", USERPROFILE: "C:\\Users\\Ana" }, "win32"), "D:\\cx");
});

for (const [plat, home, sep, c] of [
  ["linux", "/home/ana", "/", path.posix],
  ["win32", "C:\\Users\\Ana", "\\", path.win32],
] as const) {
  const f = (...p: string[]) => c.join(home, ".codex", "sessions", ...p);
  const rollout = (dia: string, th = TH) => f("2026", "11", dia, `rollout-2026-11-${dia}T03-56-27-${th}.jsonl`);
  const env = plat === "win32" ? { USERPROFILE: home } : { HOME: home };

  test(`${plat}: hallarRollout encuentra el archivo del thread entre varios días y varios hilos`, () => {
    const d = disco({ [rollout("20")]: tc(1), [rollout("22")]: tc(2), [rollout("22", "otro-hilo-0000")]: tc(3), [f("2026", "10", "30", `rollout-x-${TH}.jsonl`)]: tc(4) }, sep);
    assert.equal(hallarRollout(TH, { env, plat, disco: d }), rollout("22"));
    assert.equal(hallarRollout("no-esta-0000-0000", { env, plat, disco: d }), null);
    assert.equal(hallarRollout("", { env, plat, disco: d }), null);
  });

  test(`${plat}: varios pedidos y reanudación: el último token_count de un rollout que sigue creciendo`, () => {
    const archivos: Record<string, string> = { [rollout("22")]: [tc(100_000), tc(110_000), tc(120_000)].join("\n") + "\n" };
    const d = disco(archivos, sep);
    assert.equal(contextoDeThread(TH, { env, plat, disco: d })?.contexto, 120_000, "tres pedidos de 100k, 110k y 120k: el contexto es 120k, no los 330k acumulados");
    archivos[rollout("22")] += [tc(60_000, { ventana: 400_000 }), tc(70_000, { ventana: 400_000 })].join("\n") + "\n"; // `resume`: el mismo archivo sigue
    assert.deepEqual(contextoDeThread(TH, { env, plat, disco: d }), { contexto: 70_000, cacheado: 0, salida: 50, ventana: 400_000 });
  });

  test(`${plat}: rollout ausente, sin thread o con el disco roto: desconocido (null), nunca lanza`, () => {
    assert.equal(contextoDeThread(TH, { env, plat, disco: disco({}, sep) }), null);
    assert.equal(contextoDeThread(null, { env, plat, disco: disco({}, sep) }), null);
    assert.equal(contextoDeThread(TH, { env, plat, disco: disco({ [rollout("22")]: otra + "\n" }, sep) }), null, "todavía sin ningún token_count");
    const roto: DiscoRollout = {
      listar() {
        throw new Error("EIO");
      },
      cola() {
        throw new Error("EIO");
      },
    };
    assert.equal(contextoDeThread(TH, { env, plat, disco: roto }), null);
  });
}

test("leerRollout lee sólo la cola: un archivo enorme con el token_count al final, y una primera línea cortada no rompe", () => {
  const relleno = otra.repeat(1) + "\n";
  const grande = tc(5_000) + "\n" + relleno.repeat(8000) + tc(88_000) + "\n"; // > 256 KB
  assert.ok(grande.length > 256 * 1024);
  const pedidos: number[] = [];
  const d: DiscoRollout = {
    listar: () => [],
    cola(_a, bytes) {
      pedidos.push(bytes);
      const b = Buffer.from(grande, "utf8");
      return { texto: b.subarray(Math.max(0, b.length - bytes)).toString("utf8"), entero: b.length <= bytes };
    },
  };
  assert.equal(leerRollout("x", d)?.contexto, 88_000);
  assert.deepEqual(pedidos, [256 * 1024], "no hizo falta leer más");
  // El único token_count está lejos del final: se amplía la lectura.
  const lejos = tc(42_000) + "\n" + relleno.repeat(8000);
  pedidos.length = 0;
  assert.equal(leerRollout("x", { ...d, cola: (_a, bytes) => (pedidos.push(bytes), { texto: Buffer.from(lejos).subarray(Math.max(0, lejos.length - bytes)).toString(), entero: lejos.length <= bytes }) })?.contexto, 42_000);
  assert.equal(pedidos.length, 2);
  assert.equal(leerRollout("x", { listar: () => [], cola: () => null }), null);
});

// --- con el disco de verdad (Linux): el archivo que va creciendo ---------------------------------------------------------
const tmp = mkdtempSync(path.join(os.tmpdir(), "codex-rollout-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("disco real: CODEX_HOME, sessions/AAAA/MM/DD y la cola de un archivo que crece", () => {
  const dia = path.join(tmp, "cx", "sessions", "2026", "11", "22");
  mkdirSync(dia, { recursive: true });
  mkdirSync(path.join(tmp, "cx", "sessions", "2026", "9", "3"), { recursive: true });
  const archivo = path.join(dia, `rollout-2026-11-22T03-56-27-${TH}.jsonl`);
  writeFileSync(archivo, [otra, tc(127_650, { cacheado: 127_000, ventana: 475_000, total: 3_770_243 })].join("\n") + "\n");
  const o = { env: { CODEX_HOME: path.join(tmp, "cx") }, plat: "linux" as const };
  assert.equal(hallarRollout(TH, o), archivo);
  assert.deepEqual(contextoDeThread(TH, o), { contexto: 127_650, cacheado: 127_000, salida: 50, ventana: 475_000 });
  appendFileSync(archivo, tc(131_000) + "\n");
  assert.equal(contextoDeThread(TH, o)?.contexto, 131_000);
  assert.equal(contextoDeThread(TH, { ...o, env: { CODEX_HOME: path.join(tmp, "no-existe") } }), null);
});

// --- el traductor del chat ---------------------------------------------------------------------------------------------
const msg = { type: "item.completed", item: { id: "i1", type: "agent_message", text: "Hola" } };
/** El caso medido: el turno terminó con 3 770 243 acumulados, pero el último pedido pesaba 127 650 en una ventana de 475 000. */
const finAcumulado = { type: "turn.completed", usage: { input_tokens: 3_770_243, cached_input_tokens: 3_600_000, output_tokens: 900, reasoning_output_tokens: 100 } };

test("Traductor: con el rollout, el contexto y el result son los del último pedido; el acumulado queda como consumo del turno", () => {
  const t = new Traductor({ sid: "s", modelo: "codex:gpt-6.1-sol" });
  t.linea(msg);
  t.rollout = { contexto: 127_650, cacheado: 127_000, salida: 40, ventana: 475_000 };
  const out = t.linea(finAcumulado);
  const ms = out.filter((o) => o.type === "stream_event" && o.event.type === "message_start");
  assert.equal(ms[0]!.event.message.usage.input_tokens, 127_650);
  const r = out.at(-1)!;
  assert.deepEqual(r.usage, { input_tokens: 127_650, output_tokens: 1000 });
  assert.deepEqual(r.consumo_turno, { input_tokens: 3_770_243, cached_input_tokens: 3_600_000, output_tokens: 1000 });
  assert.equal(r.modelUsage["codex:gpt-6.1-sol"].contextWindow, 475_000, "la ventana del rollout");
  assert.equal(t.contexto, 127_650);
});

test("Traductor: sin rollout el contexto queda desconocido (no el acumulado) y la ventana es la del catálogo", () => {
  const t = new Traductor({ sid: "s", modelo: "codex:gpt-6.1-sol", contextoPrevio: 50_000 });
  t.linea(msg);
  const out = t.linea(finAcumulado);
  assert.equal(out.filter((o) => o.type === "stream_event" && o.event.type === "message_start" && o.event.message.id.startsWith("msg_codex_u")).length, 0, "no mueve el medidor con un dato inventado");
  const r = out.at(-1)!;
  assert.equal(r.usage.input_tokens, undefined);
  assert.equal(r.consumo_turno.input_tokens, 3_770_243);
  assert.equal(t.contexto, 0);
  assert.ok(r.modelUsage["codex:gpt-6.1-sol"].contextWindow > 0);
});

test("Traductor: la ventana real del turno anterior vale hasta que el rollout diga la suya", () => {
  const t = new Traductor({ sid: "s", modelo: "codex:gpt-6.1-sol", ventanaPrevia: 475_000 });
  assert.equal(t.linea(finAcumulado).at(-1)!.modelUsage["codex:gpt-6.1-sol"].contextWindow, 475_000);
});

// --- el worker (`pa --hilo`) --------------------------------------------------------------------------------------------
const stream = [
  { type: "thread.started", thread_id: TH },
  { type: "item.completed", item: { id: "a", type: "agent_message", text: "primero" } },
  { type: "turn.completed", usage: { input_tokens: 330_000, cached_input_tokens: 300_000, output_tokens: 40 } },
  { type: "thread.started", thread_id: TH }, // reanudación
  { type: "item.completed", item: { id: "b", type: "agent_message", text: "segundo" } },
  { type: "turn.completed", usage: { input_tokens: 3_770_243, cached_input_tokens: 3_600_000, output_tokens: 90 } },
]
  .map((o) => JSON.stringify(o))
  .join("\n");

test("worker: el usage del mensaje es el del último pedido del rollout (con varios turnos y una reanudación), no el acumulado", () => {
  const pedidos: string[] = [];
  const m = mensajesDeStream(stream, "", "", "", (th) => (pedidos.push(th), { contexto: 127_650, cacheado: 127_000, salida: 60, ventana: 475_000 })) as any[];
  const asist = m.filter((x) => x.rol === "assistant");
  assert.equal(asist.length, 1, "sin herramientas de por medio, el texto de los dos turnos es un mismo mensaje");
  assert.deepEqual(asist[0].usage, { input_tokens: 650, output_tokens: 60, cache_read_input_tokens: 127_000, cache_creation_input_tokens: 0 });
  assert.deepEqual(pedidos, [TH], "una sola lectura, del thread del stream");
});

test("worker: sin rollout (o sin lector) el usage queda null, nunca el acumulado", () => {
  for (const lector of [() => null, undefined]) {
    const m = mensajesDeStream(stream, "", "", "", lector) as any[];
    assert.deepEqual(m.filter((x) => x.rol === "assistant").map((x) => x.usage), [null]);
  }
});
