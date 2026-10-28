// Ajustes > Locales, lo detectado (src/paneles/locales-detectados.ts): las guías por plataforma y cómo se usa un modelo como motor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EstadoModelos } from "../electron/modelos-config.ts";
import type { ModeloDetectado } from "../electron/locales-deteccion.ts";

// En src/ los imports no llevan extensión (los resuelve Vite): acá se los lleva al .ts.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { choqueDePuerto, gbDeMiB, guiaDe, idUso, usarComo, usoActual } = await import("../src/paneles/locales-detectados.ts");
const { borradorDe } = await import("../src/paneles/modelos-borrador.ts");

const estado = (): EstadoModelos => ({
  version: 1,
  ruta: "/x/modelos.json",
  existe: true,
  config: { workers: {}, locales: [], excluir: [], permitir_max: false, gemini: {}, claude: {}, destrabar: {} },
  error: null,
  efectivo: null,
});

const modelo = (o: Partial<ModeloDetectado> = {}): ModeloDetectado => ({
  id: "puerto:11434:qwen3:8b",
  nombre: "qwen3:8b",
  origen: "puerto",
  origenDetalle: "ollama (puerto 11434)",
  servidor: "ollama",
  estadoServidor: "prendido",
  url: "http://127.0.0.1:11434",
  modelo: "qwen3:8b",
  ...o,
});

test("cada programa tiene guía para Linux y para Windows; vLLM no trae comando en Windows", () => {
  for (const id of ["llama-server", "lm-studio", "vllm", "ollama"] as const)
    for (const plat of ["linux", "win32"] as const) {
      const g = guiaDe(id, plat);
      assert.ok(g.instalar !== null || g.web !== null || id === "vllm", `${id}/${plat} dice cómo instalar`);
    }
  assert.equal(guiaDe("vllm", "win32").instalar, null);
  assert.match(guiaDe("lm-studio", "win32").instalar ?? "", /^winget install /);
  assert.match(guiaDe("lm-studio", "linux").web ?? "", /^https:\/\/lmstudio\.ai\//);
  assert.equal(guiaDe("ollama", "darwin").instalar, guiaDe("ollama", "linux").instalar, "macOS cae en la guía de Linux");
});

test("el id del motor depende del arnés: Claude Code es ollama:<modelo>, dsh es dsh:ollama/<modelo>", () => {
  assert.equal(idUso(modelo(), "claude"), "ollama:qwen3:8b");
  assert.equal(idUso(modelo(), "dsh"), "dsh:ollama/qwen3:8b");
});

test("usarComo agrega el local una sola vez y lo elige de motor de workers o del líder", () => {
  const m = modelo();
  let b = borradorDe(estado());
  b = usarComo(b, m, "claude", "workers");
  assert.deepEqual(b.locales.map((l) => l.id), ["ollama:qwen3:8b"]);
  assert.equal(b.workers.default?.modelo, "ollama:qwen3:8b");
  assert.equal(b.lider, undefined);
  b = usarComo(b, m, "dsh", "lider");
  assert.equal(b.locales.length, 1, "no se duplica");
  assert.equal(b.lider?.modelo, "dsh:ollama/qwen3:8b");
  assert.equal(usoActual(b, m, "workers"), "claude");
  assert.equal(usoActual(b, m, "lider"), "dsh");
  assert.equal(usoActual(b, modelo({ modelo: "otro" }), "lider"), null);
});

test("un modelo de llama-server usa la dirección que se le detectó", () => {
  const m = modelo({ id: "systemd:x.service", servidor: "llama-server", url: "http://127.0.0.1:8080", modelo: "codigo-14b", unit: "x.service" });
  const b = usarComo(borradorDe(estado()), m, "claude", "workers");
  assert.equal(b.locales[0].url, "http://127.0.0.1:8080");
  assert.equal(b.locales[0].modelo, "codigo-14b");
});

test("choqueDePuerto: otro modelo prendido en el mismo puerto impide prender éste", () => {
  const a = modelo({ id: "a", servidor: "llama-server", url: "http://127.0.0.1:8080", estadoServidor: "apagado" });
  const b = modelo({ id: "b", servidor: "llama-server", url: "http://127.0.0.1:8080", estadoServidor: "prendido" });
  const c = modelo({ id: "c", servidor: "llama-server", url: "http://127.0.0.1:9090", estadoServidor: "prendido" });
  assert.equal(choqueDePuerto(a, [a, b, c])?.id, "b");
  assert.equal(choqueDePuerto(a, [a, c]), null);
  assert.equal(choqueDePuerto(b, [a, b]), null, "uno no choca consigo mismo");
});

test("gbDeMiB usa coma en español y punto en inglés", () => {
  assert.equal(gbDeMiB(12288, true), "12,0");
  assert.equal(gbDeMiB(11596, false), "11.3");
});
