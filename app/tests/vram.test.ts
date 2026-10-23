// Liberar VRAM (electron/vram.ts y src/hilo/vram.ts) con la CLI `vram` FALSA: nunca se llama a la de verdad (`vram liberar`
// para Handy o el TTS de Ana). Cada `ejecutar` anota qué se le pidió, y los tests miran que `liberar` sólo corra con un id
// que la lista ofrece.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// Los imports `.js` de electron/ se llevan al `.ts`.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { leerVram, liberarVram, MIN_MIB, parsearVram } = await import("../electron/vram.ts");
const { efectoDeLiberar, faltaMiB, sobraKvMiB } = await import("../src/hilo/vram.ts");
type Deps = import("../electron/locales.ts").Deps;

const consumidor = (o: Record<string, unknown>) => ({ id: "x.service", nombre: "X", mib: 1000, pids: [111], unit: "x.service", tipo: "servicio", accion: "stop", estado: "activo", liberable: true, motivo: "", ...o });
const LISTA = {
  gpu: { total_mib: 24576, usado_mib: 20000, libre_mib: 4576 },
  consumidores: [
    consumidor({ id: "handy.service", nombre: "Handy", mib: 3379 }),
    consumidor({ id: "comfyui.service", nombre: "ComfyUI", mib: 6144 }),
    consumidor({ id: "qwen-tts.service", nombre: "TTS Qwen", mib: 2000, accion: "restart" }),
    consumidor({ id: "llama.service", nombre: "llama-server", mib: 15000, tipo: "llama-server" }),
    consumidor({ id: "trama-motor.service", nombre: "trama", mib: 400, unit: "trama-motor.service" }),
    consumidor({ id: "pid:" + process.pid, nombre: "Electron", mib: 700, unit: "", pids: [process.pid] }),
    consumidor({ id: "pid:9", nombre: "Xorg", mib: 600, liberable: false, motivo: "es el escritorio" }),
    consumidor({ id: "chico.service", nombre: "Chico", mib: MIN_MIB - 1 }),
  ],
  otros_mib: 500,
};

type Llamada = { bin: string; args: string[] };
function deps(responde: (args: string[]) => string | Error, llamadas: Llamada[]): Deps {
  return {
    home: "/home/ana",
    env: { HILOS_VRAM: "/falso/vram" },
    ejecutar: async (bin, args) => {
      llamadas.push({ bin, args });
      const r = responde(args);
      if (r instanceof Error) throw r;
      return r;
    },
    leer: async () => null,
    tamano: async () => null,
    escribir: async () => {},
    borrar: async () => {},
    pedirJson: async () => null,
    dormir: async () => {},
    ahora: () => 0,
  };
}
const respondeLista = (extra?: (args: string[]) => string | Error) => (args: string[]) => (args[0] === "liberar" ? (extra?.(args) ?? "{}") : JSON.stringify(LISTA));

test("la lista ofrece sólo lo liberable: sin llama-server, sin trama, sin lo diminuto, de mayor a menor", () => {
  const e = parsearVram(JSON.stringify(LISTA))!;
  assert.deepEqual(
    e.consumidores.map((c) => c.id),
    ["comfyui.service", "handy.service", "qwen-tts.service"],
  );
  assert.equal(e.totalMiB, 24576);
  assert.equal(e.libreMiB, 4576);
  assert.equal(e.consumidores.find((c) => c.id === "qwen-tts.service")?.accion, "restart");
});

test("una salida que no es la de la CLI no se interpreta", () => {
  assert.equal(parsearVram("no es json"), null);
  assert.equal(parsearVram("{}"), null);
  assert.equal(parsearVram(JSON.stringify({ gpu: {}, consumidores: "no" })), null);
});

test("leerVram corre sólo `vram --json` y no toca nada", async () => {
  const llamadas: Llamada[] = [];
  const e = await leerVram(deps(respondeLista(), llamadas));
  assert.equal(e.consumidores.length, 3);
  assert.deepEqual(llamadas, [{ bin: "/falso/vram", args: ["--json"] }]);
});

test("leerVram: sin CLI o con salida rara, un error con clave main.*", async () => {
  await assert.rejects(leerVram(deps(() => new Error("ENOENT"), [])), /main\.vramSinCli/);
  await assert.rejects(leerVram(deps(() => "basura", [])), /main\.vramSalidaRara/);
});

test("liberarVram corre `vram liberar <id> --json` para un id de la lista y devuelve lo liberado", async () => {
  const llamadas: Llamada[] = [];
  const ok = JSON.stringify({ ok: true, id: "handy.service", nombre: "Handy", accion: "stop", liberado_mib: 3379, libre_mib: 7955 });
  const r = await liberarVram({ id: "handy.service" }, deps(respondeLista(() => ok), llamadas));
  assert.deepEqual(r, { ok: true, id: "handy.service", nombre: "Handy", liberadoMiB: 3379, libreMiB: 7955, error: null });
  assert.deepEqual(llamadas.map((l) => l.args), [["--json"], ["liberar", "handy.service", "--json"]]);
});

test("liberarVram no llega a la CLI con un id que la lista no ofrece (trama, llama-server, no liberable, inventado)", async () => {
  for (const id of ["trama-motor.service", "llama.service", "pid:9", "chico.service", "inventado", "", "--todos"]) {
    const llamadas: Llamada[] = [];
    await assert.rejects(liberarVram({ id }, deps(respondeLista(), llamadas)), /main\.vramNoLiberable/, id);
    assert.ok(llamadas.every((l) => l.args[0] !== "liberar"), `"${id}" no debió llamar a liberar`);
  }
  await assert.rejects(liberarVram(null, deps(respondeLista(), [])), /main\.vramNoLiberable/);
  await assert.rejects(liberarVram({ id: 7 }, deps(respondeLista(), [])), /main\.vramNoLiberable/);
});

test("liberarVram: si la CLI sale con error, se ve su JSON; sin JSON, un error del main", async () => {
  const mal = Object.assign(new Error("exit 1"), { stdout: JSON.stringify({ ok: false, id: "handy.service", error: "no se pudo parar" }) });
  const r = await liberarVram({ id: "handy.service" }, deps(respondeLista(() => mal), []));
  assert.equal(r.ok, false);
  assert.equal(r.error, "no se pudo parar");
  assert.equal(r.liberadoMiB, null);
  await assert.rejects(liberarVram({ id: "handy.service" }, deps(respondeLista(() => new Error("kill")), [])), /main\.vramSinCli/);
});

test("liberarVram: de a uno; el segundo pedido mientras corre el primero no sale", async () => {
  const llamadas: Llamada[] = [];
  let suelta!: () => void;
  const d = deps(respondeLista(), llamadas);
  const base = d.ejecutar;
  d.ejecutar = async (bin, args, o) => {
    if (args[0] === "liberar") await new Promise<void>((ok) => (suelta = ok));
    return base(bin, args, o);
  };
  const primero = liberarVram({ id: "handy.service" }, d);
  await new Promise((ok) => setImmediate(ok));
  await new Promise((ok) => setImmediate(ok));
  await assert.rejects(liberarVram({ id: "comfyui.service" }, d), /main\.vramOcupado/);
  suelta();
  await primero;
  assert.equal(llamadas.filter((l) => l.args[0] === "liberar").length, 1);
});

// ---------- la cuenta de "¿entra?" ----------

// 24 GB, modelo de 10 GB; la KV cuesta 100 MiB cada 1K tokens; quedan 3 GB para la KV (sobra) sin liberar.
const est = { presupuestoMiB: 13312, reservaMiB: 0, modeloMiB: 10240, kvMiBPorK: 100 };
const info = { ctxMin: 4096, ctxMax: 262144, paso: 1024 };

test("sobra y falta para el contexto pedido", () => {
  assert.equal(sobraKvMiB(est), 3072);
  assert.equal(faltaMiB(est, 16384), 0); // 1638 MiB de KV, tiene 3072
  assert.equal(faltaMiB(est, 65536), Math.ceil(6553.6 - 3072));
});

test("liberar algo grande hace que entre el pedido; algo chico, menos contexto; casi nada, no alcanza solo", () => {
  const pedido = 65536; // pide 6553.6 MiB de KV, tiene 3072
  const grande = efectoDeLiberar(est, info, 6144, pedido);
  assert.equal(grande.veredicto, "entra");
  assert.ok(grande.ctx >= pedido);
  const medio = efectoDeLiberar(est, info, 1500, pedido);
  assert.equal(medio.veredicto, "menos");
  assert.ok(medio.ctx > 0 && medio.ctx < pedido);
  const sinLugar = { ...est, presupuestoMiB: 10240 }; // sobra 0
  const poco = efectoDeLiberar(sinLugar, info, 100, pedido); // 100 MiB = 1K tokens < ctxMin
  assert.equal(poco.veredicto, "no");
  assert.equal(poco.ctx, 0);
});
