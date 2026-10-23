// electron/locales.ts con dependencias falsas: nunca corre nvidia-smi, systemctl ni qwen-model-switch de verdad, y los
// archivos son un HOME temporal (ni ~/.dsh ni las unidades de Ana).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
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

const { asegurarLocal, destinoLocal, guardarLocal, leerLocales, LOCALES, probarLocal } = await import("../electron/locales.ts");
type Deps = import("../electron/locales.ts").Deps;

const YAML = `models:
  - id: qwen38-uncensored
    contextWindow: 32768 # = el -c
  - id: bonsai2-27b
    contextWindow: 65536
`;

type Llamada = { bin: string; args: string[] };

type Opciones = {
  nCtx?: (env: string | null) => number | null;
  /** qwen-model-switch sale con error al toque (lo que dice en stderr). */
  falla?: string;
  sinGpu?: boolean;
  /** Lo que mide nvidia-smi como usado (MiB), y si en la lista de procesos hay un llama-server. */
  usado?: number;
  sinLlama?: boolean;
  /**
   * Como la unit de verdad cuando no le alcanza la VRAM: qwen-model-switch no sale hasta que la unit queda parada
   * (`systemctl stop`), y `systemctl show` dice esto en cada vuelta después de la primera.
   */
  cuelga?: { show: string; journal?: string };
  /** Las units instaladas: nombre → texto (en HOME/.config/systemd/user). */
  units?: Record<string, string>;
};

async function entorno(opts: Opciones = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), "locales-"));
  const dsh = path.join(home, "settings.yaml");
  const carpeta = path.join(home, "locales");
  await writeFile(dsh, YAML);
  for (const [n, texto] of Object.entries(opts.units ?? {})) {
    await mkdir(path.join(home, ".config", "systemd", "user"), { recursive: true });
    await writeFile(path.join(home, ".config", "systemd", "user", n), texto);
  }
  const llamadas: Llamada[] = [];
  const archivoEnv = path.join(carpeta, "hauhaucs.env");
  let shows = 0;
  let soltar: ((e: unknown) => void) | null = null;
  const d: Deps = {
    home,
    env: { HILOS_LOCALES_DIR: carpeta, HILOS_DSH_SETTINGS: dsh, HILOS_NVIDIA_SMI: "/falso/nvidia-smi", HILOS_QWEN_SWITCH: "/falso/qwen-model-switch" },
    ejecutar: async (bin, args) => {
      llamadas.push({ bin, args });
      if (bin.endsWith("nvidia-smi")) {
        if (opts.sinGpu) throw new Error("sin driver");
        if (args[0].includes("compute-apps")) return opts.sinLlama ? "" : "10, llama-server, 1000\n11, handy, 3300\n";
        return `24576, ${opts.usado ?? 6000}\n`;
      }
      if (bin === "systemctl" && args[1] === "show") {
        shows++;
        return opts.cuelga && shows > 1 ? opts.cuelga.show : "ActiveState=inactive\nSubState=dead\nNRestarts=0\n";
      }
      if (bin === "systemctl" && args[1] === "stop" && soltar) {
        soltar(Object.assign(new Error("exit 1"), { stderr: "qwen-llama-server.service quedó inactive\n" }));
        soltar = null;
      }
      if (bin === "journalctl") return opts.cuelga?.journal ?? "";
      if (bin.endsWith("qwen-model-switch")) {
        if (opts.falla) throw Object.assign(new Error("x"), { stderr: opts.falla });
        if (opts.cuelga) return new Promise((_, mal) => (soltar = mal));
      }
      return "";
    },
    leer: async (f) => readFile(f, "utf8").catch(() => null),
    tamano: async () => null,
    escribir: async (f, t) => {
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, t);
    },
    borrar: (f) => rm(f, { force: true }),
    pedirJson: async () => {
      const env = await readFile(archivoEnv, "utf8").catch(() => null);
      const n = opts.nCtx ? opts.nCtx(env) : Number(/LLAMA_CTX=(\d+)/.exec(env ?? "")?.[1] ?? 0);
      return n ? { default_generation_settings: { n_ctx: n } } : null;
    },
    // Una vuelta del event loop, no los 2 s del vigía: el test no espera y nada se queda girando en microtareas.
    dormir: () => new Promise((ok) => setImmediate(ok)),
    ahora: () => 0,
  };
  /** Las llamadas sin nvidia-smi ni las preguntas a systemd (show, journal), como "bin args". */
  const acciones = () =>
    llamadas
      .filter((l) => !l.bin.endsWith("nvidia-smi") && l.bin !== "journalctl" && !(l.bin === "systemctl" && l.args[1] === "show"))
      .map((l) => `${l.bin.split("/").pop()} ${l.args.join(" ")}`);
  return { d, home, dsh, archivoEnv, llamadas, acciones, limpiar: () => rm(home, { recursive: true, force: true }) };
}

test("hay una fila por modelo local, con unit y entrada de dsh propias", () => {
  assert.deepEqual(LOCALES.map((l) => l.id), ["qwen-local", "bonsai-local"]);
  assert.equal(new Set(LOCALES.map((l) => l.unit)).size, LOCALES.length);
  assert.equal(new Set(LOCALES.map((l) => l.clave)).size, LOCALES.length);
  assert.equal(LOCALES[0].dshId, "qwen38-uncensored");
  assert.equal(LOCALES[1].unit, "qwen-llama-server-bonsai.service");
});

test("leer: sin nada guardado vale el -c de la unit; trae lo de dsh y la cuenta de la GPU", async () => {
  const e = await entorno();
  try {
    const r = await leerLocales(e.d);
    assert.equal(r.gpuMiB, 24576);
    const q = r.modelos.find((m) => m.id === "qwen-local")!;
    assert.equal(q.ctx, 32768);
    assert.equal(q.dsh, 32768);
    assert.equal(r.modelos.find((m) => m.id === "bonsai-local")!.ctx, 65536);
    // El llama-server de 1000 MiB se descuenta.
    assert.equal(q.est!.otrosMiB, 6000 - 1000);
    // Handy ya ocupa 3300 de sus 3379: sólo queda reservada la diferencia; el TTS entero.
    assert.deepEqual(q.est!.reservas, [{ nombre: "Handy", miB: 79 }, { nombre: "TTS", miB: 5018 }]);
    assert.ok(q.est!.maxCtxSinReservas >= q.est!.maxCtx);
  } finally {
    await e.limpiar();
  }
});

test("leer: sin nvidia-smi no hay estimación pero sí el valor guardado", async () => {
  const e = await entorno({ sinGpu: true });
  try {
    const r = await leerLocales(e.d);
    assert.equal(r.gpuMiB, null);
    assert.equal(r.modelos[0].est, null);
    assert.equal(r.modelos[0].ctx, 32768);
  } finally {
    await e.limpiar();
  }
});

test("guardar: escribe LLAMA_CTX y el contextWindow de dsh, y no carga nada (ni systemctl ni qwen-model-switch)", async () => {
  const e = await entorno();
  try {
    const r = await guardarLocal({ id: "qwen-local", ctx: 98304 }, e.d);
    assert.equal(await readFile(e.archivoEnv, "utf8"), "# Lo escribe trama (Contexto del modelo local): lo lee la unit con EnvironmentFile.\nLLAMA_CTX=98304\n");
    const yaml = await readFile(e.dsh, "utf8");
    assert.ok(yaml.includes("contextWindow: 98304 # = el -c"));
    assert.ok(yaml.includes("contextWindow: 65536"));
    assert.equal(r.modelos[0].ctx, 98304);
    assert.equal(r.modelos[0].dsh, 98304);
    assert.ok(e.llamadas.every((l) => l.bin.endsWith("nvidia-smi")), "sólo mide la GPU");
  } finally {
    await e.limpiar();
  }
});

test("guardar: modelo desconocido o -c fuera de rango se rechaza sin escribir", async () => {
  const e = await entorno();
  try {
    await assert.rejects(guardarLocal({ id: "claude-opus-5-5", ctx: 8192 }, e.d), /localDesconocido/);
    await assert.rejects(guardarLocal({ id: "qwen-local", ctx: 100 }, e.d), /localCtxInvalido/);
    await assert.rejects(guardarLocal({ id: "qwen-local", ctx: 9_999_999 }, e.d), /localCtxInvalido/);
    await assert.rejects(guardarLocal(null, e.d), /localDesconocido/);
    assert.equal(await readFile(e.archivoEnv, "utf8").catch(() => null), null);
    assert.equal(await readFile(e.dsh, "utf8"), YAML);
  } finally {
    await e.limpiar();
  }
});

test("guardar: sin dsh igual guarda el -c de la unit", async () => {
  const e = await entorno();
  try {
    await rm(e.dsh);
    const r = await guardarLocal({ id: "bonsai-local", ctx: 131072 }, e.d);
    assert.equal(r.modelos[1].ctx, 131072);
    assert.equal(r.modelos[1].dsh, null);
  } finally {
    await e.limpiar();
  }
});

test("probar: para la unit, la carga con qwen-model-switch <clave>, confirma el n_ctx y deja el valor guardado", async () => {
  const e = await entorno();
  try {
    const r = await probarLocal({ id: "qwen-local", ctx: 65536 }, e.d);
    assert.equal(r.ok, true);
    assert.equal(r.nCtx, 65536);
    assert.equal(r.usadoMiB, 6000);
    assert.equal(r.total, 24576);
    assert.deepEqual(e.acciones(), ["systemctl --user stop qwen-llama-server.service", "qwen-model-switch hauhaucs"]);
    assert.match(await readFile(e.archivoEnv, "utf8"), /LLAMA_CTX=65536/);
    assert.match(await readFile(e.dsh, "utf8"), /contextWindow: 65536 # = el -c/);
  } finally {
    await e.limpiar();
  }
});

test("probar: si no carga (falta de memoria) vuelve el -c de antes, en el env y en dsh, y dice por qué", async () => {
  const e = await entorno({ falla: "CUDA out of memory\nlisto" });
  try {
    await guardarLocal({ id: "qwen-local", ctx: 32768 }, e.d);
    const r = await probarLocal({ id: "qwen-local", ctx: 262144 }, e.d);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /localSinMemoria/);
    assert.match(await readFile(e.archivoEnv, "utf8"), /LLAMA_CTX=32768/);
    assert.match(await readFile(e.dsh, "utf8"), /contextWindow: 32768 # = el -c/);
  } finally {
    await e.limpiar();
  }
});

test("probar: si llama-server contesta otro n_ctx no es un éxito", async () => {
  const e = await entorno({ nCtx: () => 4096 });
  try {
    const r = await probarLocal({ id: "bonsai-local", ctx: 65536 }, e.d);
    assert.equal(r.ok, false);
    assert.equal(r.nCtx, 4096);
    assert.match(r.error ?? "", /localOtroCtx/);
  } finally {
    await e.limpiar();
  }
});

test("probar: una sola a la vez, y valida antes de tocar nada", async () => {
  const e = await entorno();
  try {
    await assert.rejects(probarLocal({ id: "qwen-local", ctx: 3 }, e.d), /localCtxInvalido/);
    assert.equal(e.llamadas.length, 0);
    let suelta!: () => void;
    const lenta: Deps = { ...e.d, ejecutar: (bin, args, o) => (bin.endsWith("qwen-model-switch") ? new Promise((ok) => (suelta = () => ok(""))) : e.d.ejecutar(bin, args, o)) };
    const primera = probarLocal({ id: "qwen-local", ctx: 65536 }, lenta);
    await new Promise((ok) => setTimeout(ok, 20));
    await assert.rejects(probarLocal({ id: "bonsai-local", ctx: 65536 }, e.d), /localOcupado/);
    suelta();
    assert.equal((await primera).ok, true);
  } finally {
    await e.limpiar();
  }
});

// Lo que dejó en el journal la unit de verdad (Qwen 3.8 a 4096 con 8 GB ocupados por otros): la línea del primer segundo es
// sólo un aviso (sin 1 GiB de margen); la carga se cae ~45 s después, cuando CUDA no le da el buffer.
const JOURNAL_OOM = `common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to 99, abort
ggml_backend_cuda_buffer_type_alloc_buffer: allocating 16400.57 MiB on device 0: cudaMalloc failed: out of memory
llama_model_load: error loading model: unable to allocate CUDA0 buffer
llama_model_load_from_file_impl: failed to load model
qwen-llama-server.service: Main process exited, code=exited, status=1/FAILURE
qwen-llama-server.service: Failed with result 'exit-code'.
`;

test("probar: si la unit se cae y systemd la relanza (auto-restart), la para enseguida y dice que no entró en la GPU", async () => {
  const e = await entorno({ cuelga: { show: "ActiveState=activating\nSubState=auto-restart\nNRestarts=1\n", journal: JOURNAL_OOM } });
  try {
    await guardarLocal({ id: "qwen-local", ctx: 32768 }, e.d);
    const r = await probarLocal({ id: "qwen-local", ctx: 65536 }, e.d);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /localSinMemoria/);
    // Parada antes de cargar, la carga, y parada al verla caída (qwen-model-switch sale solo al verla inactive).
    const acc = e.acciones();
    assert.deepEqual(acc.slice(0, 3), ["systemctl --user stop qwen-llama-server.service", "qwen-model-switch hauhaucs", "systemctl --user stop qwen-llama-server.service"]);
    assert.ok(acc.slice(3).every((a) => a === "systemctl --user stop qwen-llama-server.service"), "después de caerse sólo se la para");
    assert.match(await readFile(e.archivoEnv, "utf8"), /LLAMA_CTX=32768/);
    assert.match(await readFile(e.dsh, "utf8"), /contextWindow: 32768 # = el -c/);
  } finally {
    await e.limpiar();
  }
});

test("probar: un reinicio nuevo (NRestarts sube) también cuenta como caída, aunque ya diga activating/start", async () => {
  const e = await entorno({ cuelga: { show: "ActiveState=activating\nSubState=start\nNRestarts=2\n", journal: "llama_model_load: error loading model: archivo roto\n" } });
  try {
    const r = await probarLocal({ id: "bonsai-local", ctx: 65536 }, e.d);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /localNoCargo/);
    assert.match(r.error ?? "", /archivo roto/);
  } finally {
    await e.limpiar();
  }
});

test("probar: mientras carga sin caerse no la corta, aunque llama.cpp avise que no le queda margen", async () => {
  // active/running y el aviso del primer segundo: sigue esperando a qwen-model-switch, que acá termina bien.
  const e = await entorno({ cuelga: { show: "ActiveState=active\nSubState=running\nNRestarts=0\n", journal: JOURNAL_OOM.split("\n")[0] } });
  try {
    const r = probarLocal({ id: "qwen-local", ctx: 65536 }, e.d);
    await new Promise((ok) => setTimeout(ok, 30));
    assert.equal(e.acciones().filter((a) => a.includes("stop")).length, 1, "sólo la parada de antes de cargar");
    // Ninguna parada la suelta: se la suelta a mano, como si qwen-model-switch hubiera visto el /health.
    await e.d.ejecutar("systemctl", ["--user", "stop", "x"], {});
    const res = await r;
    // El falso la suelta con error: lo que importa es que no la cortó el vigía.
    assert.equal(res.ok, false);
  } finally {
    await e.limpiar();
  }
});

test("probar: si los pesos solos no entran en lo libre, falla al toque sin parar ni cargar nada", async () => {
  // 9 GB usados por otros (sin llama-server que descontar): libres 24 − 9 − 0,5 = 14,7 GB < 17,5 GB de pesos.
  const e = await entorno({ usado: 9000, sinLlama: true });
  try {
    const r = await probarLocal({ id: "qwen-local", ctx: 4096 }, e.d);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /localNoEntra/);
    assert.deepEqual(e.acciones(), [], "ni stop ni qwen-model-switch");
    assert.equal(await readFile(e.archivoEnv, "utf8").catch(() => null), null, "no escribió el env");
    assert.equal(await readFile(e.dsh, "utf8"), YAML);
  } finally {
    await e.limpiar();
  }
});

const UNIT_FIJA = `[Service]
ExecStart=%h/llama.cpp/build/bin/llama-server -m %h/models/x.gguf -ngl 99 -c 32768 --port 8080
Restart=on-failure
`;

test("probar: una unit con -c fijo (no lee LLAMA_CTX) falla al toque con otro valor, y con el suyo prueba", async () => {
  const e = await entorno({ units: { "qwen-llama-server.service": UNIT_FIJA } });
  try {
    const r = await probarLocal({ id: "qwen-local", ctx: 65536 }, e.d);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /localUnitFija/);
    assert.match(r.error ?? "", /32768/);
    assert.deepEqual(e.acciones(), []);
    assert.equal((await probarLocal({ id: "qwen-local", ctx: 32768 }, e.d)).ok, true);
  } finally {
    await e.limpiar();
  }
});

test("leer: ctxFijo dice el -c de la unit instalada que no lee LLAMA_CTX; las plantillas de systemd/locales/ lo leen", async () => {
  const e = await entorno({ units: { "qwen-llama-server.service": UNIT_FIJA } });
  try {
    const r = await leerLocales(e.d);
    assert.equal(r.modelos[0].ctxFijo, 32768);
    assert.equal(r.modelos[1].ctxFijo, null, "sin unit instalada no se sabe: null");
    const plantillas = await leerLocales({ ...e.d, env: { ...e.d.env, HILOS_UNITS_DIR: path.join(import.meta.dirname, "..", "systemd", "locales") } });
    assert.deepEqual(plantillas.modelos.map((m) => m.ctxFijo), [null, null]);
  } finally {
    await e.limpiar();
  }
});

test("probar: si no había env y no carga, lo borra (no deja el valor que falló) y dsh vuelve a lo de antes", async () => {
  const e = await entorno({ falla: "algo raro" });
  try {
    const r = await probarLocal({ id: "qwen-local", ctx: 65536 }, e.d);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /localNoCargo/);
    assert.equal(await readFile(e.archivoEnv, "utf8").catch(() => null), null);
    assert.equal(await readFile(e.dsh, "utf8"), YAML);
  } finally {
    await e.limpiar();
  }
});

/** Un llama-server de mentira para `asegurarLocal`: qué alias sirve (`/v1/models`) y su n_ctx (`/props`); `tras` = lo que sirve después de cargar. */
function servidor(e: Awaited<ReturnType<typeof entorno>>, antes: string | null, tras: string | null, nCtx = 32768) {
  let sirve = antes;
  const ejecutar = e.d.ejecutar;
  e.d.ejecutar = async (bin, args, o) => {
    const r = await ejecutar(bin, args, o);
    if (bin.endsWith("qwen-model-switch")) sirve = tras;
    return r;
  };
  const urls: string[] = [];
  e.d.pedirJson = async (url) => {
    urls.push(url);
    if (url.endsWith("/v1/models")) return sirve ? { object: "list", data: [{ id: sirve }] } : null;
    if (url.endsWith("/props")) return sirve ? { default_generation_settings: { n_ctx: nCtx } } : null;
    return null;
  };
  return urls;
}

test("líder local: si llama-server ya sirve ese modelo no carga nada y dice adónde y con qué contexto", async () => {
  const e = await entorno();
  try {
    servidor(e, "qwen38-uncensored", "qwen38-uncensored", 65536);
    assert.deepEqual(await asegurarLocal("qwen-local", e.d), { url: "http://127.0.0.1:8080", ctx: 65536 });
    assert.deepEqual(e.acciones(), []);
  } finally {
    await e.limpiar();
  }
});

test("líder local: si sirve otro (o nada) lo carga con qwen-model-switch <clave> y devuelve el n_ctx cargado", async () => {
  const e = await entorno();
  try {
    servidor(e, "qwen38-uncensored", "bonsai2-27b", 65536);
    assert.deepEqual(await asegurarLocal("bonsai-local", e.d), { url: "http://127.0.0.1:8080", ctx: 65536 });
    assert.deepEqual(e.acciones(), ["qwen-model-switch bonsai"]);
  } finally {
    await e.limpiar();
  }
});

test("líder local: dos mensajes a la vez esperan la misma carga (un solo qwen-model-switch)", async () => {
  const e = await entorno();
  try {
    servidor(e, null, "qwen38-uncensored");
    const [a, b] = await Promise.all([asegurarLocal("qwen-local", e.d), asegurarLocal("qwen-local", e.d)]);
    assert.deepEqual(a, b);
    assert.deepEqual(e.acciones(), ["qwen-model-switch hauhaucs"]);
  } finally {
    await e.limpiar();
  }
});

test("líder local: si no entra en la VRAM, el mismo aviso que Probar y no carga nada", async () => {
  const e = await entorno({ usado: 9000, sinLlama: true });
  try {
    servidor(e, null, "qwen38-uncensored");
    await assert.rejects(asegurarLocal("qwen-local", e.d), /localNoEntra/);
    assert.deepEqual(e.acciones(), []);
  } finally {
    await e.limpiar();
  }
});

test("líder local: si la unit se cae al cargar, la para y dice que no entró; si queda otro modelo, lo dice", async () => {
  const e = await entorno({ cuelga: { show: "ActiveState=activating\nSubState=auto-restart\nNRestarts=1\n" } });
  try {
    servidor(e, null, null);
    await assert.rejects(asegurarLocal("qwen-local", e.d), /localSinMemoria|localNoCargo/);
    assert.ok(e.acciones().includes("systemctl --user stop qwen-llama-server.service"));
  } finally {
    await e.limpiar();
  }
  const f = await entorno();
  try {
    servidor(f, null, "bonsai2-27b");
    await assert.rejects(asegurarLocal("qwen-local", f.d), /localOtroModelo/);
  } finally {
    await f.limpiar();
  }
});

test("líder local: modelo desconocido se rechaza; destinoLocal no carga nada (el -c guardado)", async () => {
  const e = await entorno();
  try {
    const urls = servidor(e, null, null);
    await assert.rejects(asegurarLocal("claude-opus-5-5", e.d), /localDesconocido/);
    assert.deepEqual(await destinoLocal("qwen-local", e.d), { url: "http://127.0.0.1:8080", ctx: 32768 });
    assert.deepEqual(e.acciones(), []);
    assert.deepEqual(urls, []);
  } finally {
    await e.limpiar();
  }
});
