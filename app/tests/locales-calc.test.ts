// La cuenta de cuánto contexto entra en la VRAM (electron/locales-calc.ts): pura, sin GPU ni disco.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BYTES_Q8_0,
  clasificar,
  conContextWindow,
  contextWindowDe,
  ctxDeEnv,
  ctxFijoDeUnit,
  ctxQueEntra,
  ctxValido,
  envDe,
  estadoDeShow,
  estimar,
  kvBytesPorToken,
  libreMiB,
  MIB,
  motivoDeLog,
  nCtxDe,
  necesitaMiB,
  parsearApps,
  parsearMemoria,
  seCayo,
  type CuentaModelo,
  type Gpu,
} from "../electron/locales-calc.ts";

const KV_GRANDE = kvBytesPorToken({ capas: 17, kvHeads: 4, dimK: 256, dimV: 256, bytesPorElemento: BYTES_Q8_0 });
const GRANDE: CuentaModelo = { pesosMiB: 17955, fijoMiB: 2048, kvBytesPorToken: KV_GRANDE, ctxMin: 4096, ctxMax: 262144, paso: 1024 };

test("KV por token: capas × cabezas × (K+V) × bytes del elemento (q8_0 = 34/32)", () => {
  assert.equal(BYTES_Q8_0, 1.0625);
  assert.equal(KV_GRANDE, 17 * 4 * 512 * 1.0625);
  assert.equal(kvBytesPorToken({ capas: 1, kvHeads: 1, dimK: 1, dimV: 1, bytesPorElemento: 0.5 }), 1);
  // 32K de contexto en el modelo grande: ~1,1 GiB.
  assert.ok(Math.abs((KV_GRANDE * 32768) / MIB - 1156) < 1);
});

test("necesitaMiB: pesos + fijo + KV del contexto", () => {
  assert.equal(necesitaMiB(GRANDE, 0), 17955 + 2048);
  assert.ok(Math.abs(necesitaMiB(GRANDE, 65536) - (17955 + 2048 + 2312)) < 1);
});

test("ctxQueEntra: el mayor múltiplo del paso que cabe, acotado; 0 si ni el mínimo entra", () => {
  const m = { ...GRANDE, kvBytesPorToken: MIB / 1024 }; // 1 KiB por token: 1 MiB = 1024 tokens
  assert.equal(ctxQueEntra(8, m), 8192);
  assert.equal(ctxQueEntra(8.9, m), 8192);
  assert.equal(ctxQueEntra(100000, m), 262144);
  assert.equal(ctxQueEntra(3, m), 0); // 3072 < ctxMin
  assert.equal(ctxQueEntra(0, m), 0);
  assert.equal(ctxQueEntra(-5, m), 0);
  assert.equal(ctxQueEntra(10, { ...m, kvBytesPorToken: 0 }), 0);
});

const gpu = (extra: Partial<Gpu> = {}): Gpu => ({
  totalMiB: 24576,
  usadoMiB: 0,
  llamaMiB: 0,
  consumidores: [
    { nombre: "Handy", nominalMiB: 3379, actualMiB: 0 },
    { nombre: "TTS", nominalMiB: 5018, actualMiB: 0 },
  ],
  ...extra,
});

test("estimar: GPU vacía → total − margen − reservas de Handy y TTS − pesos − fijo, todo en KV", () => {
  const chico: CuentaModelo = { ...GRANDE, pesosMiB: 8000 };
  const e = estimar(gpu(), chico);
  assert.equal(e.otrosMiB, 0);
  assert.equal(e.reservaMiB, 3379 + 5018);
  assert.equal(e.presupuestoMiB, 24576 - 512 - 3379 - 5018);
  const sobra = e.presupuestoMiB - (8000 + 2048);
  assert.equal(e.maxCtx, Math.floor(Math.floor((sobra * MIB) / KV_GRANDE) / 1024) * 1024);
  assert.ok(e.maxCtxSinReservas > e.maxCtx);
  // Lo que dice que entra, entra de verdad en la cuenta; el paso siguiente no.
  assert.ok(necesitaMiB(chico, e.maxCtx) <= e.presupuestoMiB);
  assert.ok(necesitaMiB(chico, e.maxCtx + chico.paso) > e.presupuestoMiB);
});

test("estimar: el modelo grande entero no entra si Handy y TTS pueden cargar, pero sí (~110K) si no lo hacen", () => {
  const e = estimar(gpu(), GRANDE);
  assert.equal(e.maxCtx, 0);
  assert.ok(e.maxCtxSinReservas >= 100 * 1024 && e.maxCtxSinReservas <= 125 * 1024, String(e.maxCtxSinReservas));
  // Con los dos ya cargados no queda nada que reservar y se ve lo que de verdad queda.
  const cargados = estimar(gpu({ usadoMiB: 3379 + 5018, consumidores: [{ nombre: "Handy", nominalMiB: 3379, actualMiB: 3379 }, { nombre: "TTS", nominalMiB: 5018, actualMiB: 5018 }] }), GRANDE);
  assert.deepEqual(cargados.reservas, []);
  assert.equal(cargados.maxCtx, 0);
});

test("estimar: el llama-server que se reemplaza no cuenta como ocupado; Handy ya cargado no se reserva dos veces", () => {
  const e = estimar(gpu({ usadoMiB: 20000 + 3300, llamaMiB: 20000, consumidores: [{ nombre: "Handy", nominalMiB: 3379, actualMiB: 3300 }, { nombre: "TTS", nominalMiB: 5018, actualMiB: 0 }] }), GRANDE);
  assert.equal(e.otrosMiB, 3300);
  assert.deepEqual(e.reservas, [
    { nombre: "Handy", miB: 79 },
    { nombre: "TTS", miB: 5018 },
  ]);
  // Si ya pasa de lo nominal no hay reserva negativa.
  const e2 = estimar(gpu({ usadoMiB: 4000, consumidores: [{ nombre: "Handy", nominalMiB: 3379, actualMiB: 4000 }] }), GRANDE);
  assert.deepEqual(e2.reservas, []);
});

test("estimar: si ni el mínimo entra, maxCtx es 0 y el presupuesto puede ser negativo", () => {
  const e = estimar(gpu({ usadoMiB: 20000 }), GRANDE);
  assert.equal(e.maxCtx, 0);
  assert.equal(e.maxCtxSinReservas, 0);
  assert.ok(e.presupuestoMiB < 0);
});

test("estimar: un modelo chico (chico) llega al tope del modelo", () => {
  const chico: CuentaModelo = { pesosMiB: 6873, fijoMiB: 2048, kvBytesPorToken: kvBytesPorToken({ capas: 16, kvHeads: 4, dimK: 256, dimV: 256, bytesPorElemento: BYTES_Q8_0 }), ctxMin: 4096, ctxMax: 262144, paso: 1024 };
  const e = estimar(gpu(), chico);
  assert.ok(e.maxCtx >= 65536);
  assert.ok(e.maxCtx <= 262144);
  assert.ok(e.maxCtx % 1024 === 0);
});

test("ctxValido: entero entre el mínimo y el máximo, llevado al múltiplo de 256 de abajo", () => {
  assert.equal(ctxValido(32768, 4096, 262144), 32768);
  assert.equal(ctxValido(32800, 4096, 262144), 32768);
  assert.equal(ctxValido("65536", 4096, 262144), 65536);
  assert.equal(ctxValido(4096, 4096, 262144), 4096);
  assert.equal(ctxValido(4095, 4096, 262144), null);
  assert.equal(ctxValido(262144 + 256, 4096, 262144), null);
  assert.equal(ctxValido(1.5, 1, 100), null);
  assert.equal(ctxValido("12abc", 4096, 262144), null);
  assert.equal(ctxValido(NaN, 4096, 262144), null);
  assert.equal(ctxValido(null, 4096, 262144), null);
  assert.equal(ctxValido("-8192", 4096, 262144), null);
});

const YAML = `models:
  - id: otro
    contextWindow: 1000 # otro
  - id: ejemplo-27b
    name: Modelo de ejemplo
    contextWindow: 32768   # = el -c de llama-server-ejemplo.service
    reasoningEfforts: [off, low]
  - id: chico-27b
    contextWindow: 65536
`;

test("conContextWindow: cambia sólo el número del modelo pedido y deja comentarios y vecinos", () => {
  const n = conContextWindow(YAML, "ejemplo-27b", 98304)!;
  assert.ok(n.includes("contextWindow: 98304   # = el -c de llama-server-ejemplo.service"));
  assert.ok(n.includes("contextWindow: 1000 # otro"));
  assert.ok(n.includes("contextWindow: 65536"));
  assert.equal(n.split("\n").length, YAML.split("\n").length);
  assert.equal(contextWindowDe(n, "ejemplo-27b"), 98304);
  assert.equal(contextWindowDe(n, "chico-27b"), 65536);
});

test("conContextWindow: un modelo que no está, o sin contextWindow, no cambia nada (null)", () => {
  assert.equal(conContextWindow(YAML, "no-existe", 8192), null);
  assert.equal(contextWindowDe(YAML, "no-existe"), null);
  assert.equal(conContextWindow("models:\n  - id: a\n    name: x\n  - id: b\n    contextWindow: 5\n", "a", 8192), null);
  assert.equal(contextWindowDe("models:\n  - id: a\n    name: x\n  - id: b\n    contextWindow: 5\n", "a"), null);
});

test("env de la unit: se escribe y se lee igual", () => {
  assert.equal(ctxDeEnv(envDe(131072)), 131072);
  assert.equal(ctxDeEnv("# nada\n"), null);
  assert.equal(ctxDeEnv("LLAMA_CTX=abc\n"), null);
  assert.ok(envDe(4096).endsWith("LLAMA_CTX=4096\n"));
});

test("nCtxDe: /props de llama-server", () => {
  assert.equal(nCtxDe({ default_generation_settings: { n_ctx: 32768 } }), 32768);
  assert.equal(nCtxDe({ n_ctx: 8192 }), 8192);
  assert.equal(nCtxDe({}), null);
  assert.equal(nCtxDe(null), null);
  assert.equal(nCtxDe({ n_ctx: "x" }), null);
});

test("nvidia-smi: memoria y procesos", () => {
  assert.deepEqual(parsearMemoria("24576, 11101\n"), { totalMiB: 24576, usadoMiB: 11101 });
  assert.equal(parsearMemoria(""), null);
  assert.equal(parsearMemoria("N/A, N/A"), null);
  assert.deepEqual(parsearApps("1234, /usr/bin/llama-server, 20000\n55, handy, 3300\nbasura\n"), [
    { pid: 1234, proceso: "/usr/bin/llama-server", miB: 20000 },
    { pid: 55, proceso: "handy", miB: 3300 },
  ]);
});

test("clasificar: llama-server aparte, Handy por su nombre y TTS por su línea de comando", () => {
  const apps = parsearApps("1, /home/ana/llama.cpp/build/bin/llama-server, 20000\n2, /usr/bin/handy, 3300\n3, python3, 4900\n4, otra-cosa, 100\n");
  const r = clasificar(apps, (pid) => (pid === 3 ? "python3 /home/ana/bin/asistente-tts-qwen --serve" : ""));
  assert.equal(r.llamaMiB, 20000);
  assert.deepEqual(r.consumidores.map((c) => [c.nombre, c.actualMiB]), [["Handy", 3300], ["TTS", 4900]]);
  const vacio = clasificar([], () => "");
  assert.deepEqual(vacio.consumidores.map((c) => c.actualMiB), [0, 0]);
});

test("ctxFijoDeUnit: el -c de una unit que no lee LLAMA_CTX; null si lo lee (las plantillas) o no tiene", () => {
  assert.equal(ctxFijoDeUnit("[Service]\nExecStart=/x/llama-server -m a.gguf -ngl 99 -c 32768 --port 8080\n"), 32768);
  assert.equal(ctxFijoDeUnit("ExecStart=/x/llama-server --ctx-size=65536 -m a.gguf\n"), 65536);
  assert.equal(ctxFijoDeUnit("EnvironmentFile=-%h/.config/trama/locales/ejemplo.env\nExecStart=/x/llama-server -c ${LLAMA_CTX} -m a.gguf\n"), null);
  assert.equal(ctxFijoDeUnit("ExecStart=/x/llama-server -c $LLAMA_CTX\n"), null);
  // Un comentario no cuenta.
  assert.equal(ctxFijoDeUnit("# ExecStart=/x/llama-server -c 4096\nExecStart=/x/llama-server -m a.gguf\n"), null);
});

test("estadoDeShow y seCayo: auto-restart, failed o un reinicio nuevo son una caída; cargando no", () => {
  const s = estadoDeShow("ActiveState=activating\nSubState=auto-restart\nNRestarts=3\n");
  assert.deepEqual(s, { activo: "activating", sub: "auto-restart", reinicios: 3 });
  assert.equal(seCayo(s, 3), true);
  assert.equal(seCayo(estadoDeShow("ActiveState=failed\nSubState=failed\nNRestarts=0"), 0), true);
  assert.equal(seCayo(estadoDeShow("ActiveState=activating\nSubState=start\nNRestarts=4"), 3), true);
  assert.equal(seCayo(estadoDeShow("ActiveState=active\nSubState=running\nNRestarts=3"), 3), false);
  assert.equal(seCayo(estadoDeShow("ActiveState=inactive\nSubState=dead\nNRestarts=0"), 0), false);
  assert.equal(seCayo(estadoDeShow(""), 0), false);
});

test("motivoDeLog: con el journal de verdad de un OOM dice sin memoria; si no, la última línea de error sin las de systemd", () => {
  const oom = `common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to 99, abort
ggml_backend_cuda_buffer_type_alloc_buffer: allocating 16400.57 MiB on device 0: cudaMalloc failed: out of memory
llama_model_load: error loading model: unable to allocate CUDA0 buffer
llama-server-ejemplo.service: Main process exited, code=exited, status=1/FAILURE`;
  const m = motivoDeLog(oom);
  assert.equal(m.sinMemoria, true);
  assert.match(m.linea ?? "", /cudaMalloc failed/);
  // El aviso de llama.cpp solo (sin 1 GiB de margen) no es falta de memoria: en el borde igual carga.
  assert.equal(motivoDeLog("common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to 99, abort").sinMemoria, false);
  const otro = motivoDeLog("main: loading model\nllama_model_load: error loading model: archivo roto\nllama-server-ejemplo.service: Failed with result 'exit-code'.\nStopped llama-server-ejemplo.service.");
  assert.deepEqual(otro, { sinMemoria: false, linea: "llama_model_load: error loading model: archivo roto" });
  // "room" no es OOM.
  assert.equal(motivoDeLog("no room for more slots").sinMemoria, false);
  assert.equal(motivoDeLog("").linea, null);
});

test("libreMiB: lo que queda para el modelo sin contar a Handy ni al TTS (lo que la estimación les reserva vuelve)", () => {
  const gpu: Gpu = { totalMiB: 24576, usadoMiB: 8192, llamaMiB: 0, consumidores: [{ nombre: "Handy", nominalMiB: 3379, actualMiB: 0 }] };
  const e = estimar(gpu, GRANDE);
  assert.equal(libreMiB(e), 24576 - 8192 - 512);
  // El caso de Ana: 8 GB ocupados por otros y 17,5 GB de pesos: ni a 4K.
  assert.ok(GRANDE.pesosMiB > libreMiB(e));
});
