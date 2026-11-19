// El selector del líder muestra a TODOS los proveedores; el que no está conectado se ve «Sin conectar» y elegirlo no cambia el modelo:
// ofrece «Conectar», que abre Ajustes en su fila. Sin DOM: las opciones son las de verdad (`opciones.tsx`, alimentadas por lo que
// contesta el main y valida `configValida`), y el toque es la decisión `alTocar` que usa `Selector.tsx`.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("src")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(new RegExp("\\\\", "g"), "/").replace(new RegExp("^(?!\\.)"), "./"), ctx);
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
    if (!url.endsWith(".tsx")) return next(url, ctx);
    const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "tsx", format: "esm", jsx: "automatic", sourcefile: url });
    return { format: "module", source: code, shortCircuit: true };
  },
});

const noop = () => {};
Object.assign(globalThis, {
  window: globalThis,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  location: { search: "?fixtures=0", hash: "" },
  hilos: {},
  document: { documentElement: { addEventListener: noop, removeEventListener: noop }, addEventListener: noop, removeEventListener: noop, getElementsByClassName: () => [], hidden: false, visibilityState: "visible" },
});

const { MODELOS, aplicarModelos } = await import("../src/hilo/opciones.tsx");
const { alPedirAjustes, pendienteDeMostrar, ITEMS } = await import("../src/paneles/ajustes-nav.ts");
const { DESTINO_CONECTAR, alTocar } = await import("../src/hilo/conectar.ts");
const { configValida } = await import("../src/datos/modelos-config.ts");
const { EMPRESAS } = await import("../src/hilo/modelos.ts");

type Empresa = keyof typeof EMPRESAS;
const todos: Record<string, boolean> = { anthropic: true, google: true, openai: true, opencode: true, dsh: true, local: true };
// Lo que contesta el main, pasado por la validación de la ventana (como en la app).
const aplicar = (conexion: Record<string, boolean> | undefined) => aplicarModelos(configValida({ version: 1, gemini: false, locales: [], llama: [], lider: null, ...(conexion ? { conexion } : {}) }));
const col = (c: string) => MODELOS.filter((m) => m.col === c);

beforeEach(() => aplicar(undefined));

test("OpenAI sin sesión aparece con sus cuatro modelos, atenuado y con «Sin conectar»", () => {
  aplicar({ ...todos, openai: false });
  const ops = col("openai");
  assert.deepEqual(ops.map((m) => m.id), ["codex:gpt-6.1-sol", "codex:gpt-6-sol", "codex:gpt-6-luna", "codex:gpt-6-astra"]);
  assert.ok(ops.every((m) => m.sinConectar === true && typeof m.conectar === "function"));
  assert.ok(col("anthropic").length > 0 && col("anthropic").every((m) => !m.sinConectar), "Anthropic conectado sigue normal");
});

test("elegir un modelo sin conectar pide «Conectar» y no cambia el modelo; «Conectar» abre Ajustes en Plan y cupos > ChatGPT", () => {
  aplicar({ ...todos, openai: false });
  const m = col("openai")[0]!;
  assert.equal(alTocar(m, false), "conectar");
  assert.equal(alTocar(m, true), "conectar", "ni siquiera pide confirmar el cambio de motor");
  let abrio = 0;
  const quitar = alPedirAjustes(() => abrio++);
  m.conectar!();
  quitar();
  assert.equal(abrio, 1);
  assert.equal(pendienteDeMostrar()?.opc, "cu.chatgpt");
});

test("con sesión de ChatGPT se elige normal", () => {
  aplicar(todos);
  const ops = col("openai");
  assert.equal(ops.length, 4);
  assert.ok(ops.every((m) => !m.sinConectar && !m.conectar));
  assert.equal(alTocar(ops[0]!, false), "elegir");
  assert.equal(alTocar(ops[0]!, true), "confirmar", "otro motor: confirma como siempre");
});

test("todos los proveedores están siempre; los que no están listos van «Sin conectar», también Gemini sin sesión de agy", () => {
  aplicar({ anthropic: true, google: false, openai: false, opencode: false, dsh: false, local: false });
  for (const c of ["anthropic", "google", "openai", "opencode", "dsh", "local"]) assert.ok(col(c).length > 0, `${c} está en la tabla`);
  for (const c of ["google", "openai", "opencode", "dsh", "local"]) assert.ok(col(c).every((m) => m.sinConectar === true), `${c} sin conectar`);
  assert.ok(col("anthropic").every((m) => !m.sinConectar));
});

test("sin la clave `conexion` (un main viejo) la tabla es la de antes: sin OpenAI ni filas de relleno", () => {
  aplicar(undefined);
  assert.equal(col("openai").length, 0);
  assert.ok(MODELOS.every((m) => !m.sinConectar));
});

test("la ventana valida `conexion`: sólo empresas conocidas y booleanos", () => {
  const c = configValida({ version: 1, gemini: false, locales: [], llama: [], lider: null, conexion: { openai: false, anthropic: true, rara: false, google: "sí" } });
  assert.deepEqual(c?.conexion, { openai: false, anthropic: true });
  assert.equal(configValida({ version: 1, gemini: false, locales: [], llama: [], lider: null })?.conexion, undefined);
});

test("cada destino de «Conectar» es una fila que existe en Ajustes", () => {
  for (const e of Object.keys(EMPRESAS) as Empresa[]) {
    const d = DESTINO_CONECTAR[e];
    assert.ok(ITEMS.some((i) => i.cat === d.cat && i.nombre === d.opc), `${e}: ${d.cat}/${d.opc}`);
  }
});
