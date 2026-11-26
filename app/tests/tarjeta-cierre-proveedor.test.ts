import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import type { CierreVisto } from "../electron/cierre-chats.ts";
import type { Lider } from "../src/datos/contrato.ts";

// El mismo JSX de la ventana, renderizado a texto sin abrir la aplicación.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = fileURLToPath(new URL(spec, ctx.parentURL));
      for (const archivo of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (existsSync(archivo)) return next(pathToFileURL(archivo).href, ctx);
      }
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
  location: { search: "?captura=lider-cierre&idioma=es", hash: "" },
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  document: {
    documentElement: { style: { setProperty: noop, removeProperty: noop }, setAttribute: noop },
    addEventListener: noop,
    removeEventListener: noop,
    getElementsByClassName: () => [],
    visibilityState: "visible",
  },
});
createRequire(import.meta.url)("react").useSyncExternalStore = (_suscribir: unknown, leer: () => unknown) => leer();

const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement: h } = await import("react");
const { LIDERES } = await import("../src/datos/fixtures.ts");
const { ChatLider } = await import("../src/hilo/Lider.tsx");
const { cierreRigeAlLider, TarjetaCierre } = await import("../src/hilo/TarjetaCierre.tsx");
const { cierreDeCaptura } = await import("../src/hilo/cierre-vivo.ts");

const lider = { ...LIDERES.lideres.find((l) => l.origen === "app")!, modelo: "claude-opus-5-5", cuenta: undefined, ocupado: false };
const cierre = cierreDeCaptura(lider.id, "cerrada", 1_800_000_000);
const botonSeguir = /aria-haspopup="dialog"[^>]*>.*Seguir con otro modelo<\/button>/;
const chat = (cambios: Partial<Lider> = {}) => renderToStaticMarkup(h(ChatLider, { l: { ...lider, ...cambios }, alCreado: noop, alNuevo: noop }));
const tarjeta = (cambios: Partial<CierreVisto> = {}) => renderToStaticMarkup(h(TarjetaCierre, { c: { ...cierre, ...cambios }, alSeguir: noop }));

test("el chat ofrece seguir con otro modelo en el cierre vigente y ocioso", () => {
  assert.match(chat(), botonSeguir);
  assert.doesNotMatch(chat({ ocupado: true }), botonSeguir);
});

test("el chat oculta el cierre anterior al cambiar de proveedor o de cuenta", () => {
  assert.match(chat(), /class="cq"/);
  assert.doesNotMatch(chat({ modelo: "codex:gpt-6.2-sol" }), /class="cq"/);
  assert.doesNotMatch(chat({ modelo: "agy:claude-opus-5-5" }), /class="cq"/);
  assert.doesNotMatch(chat({ cuenta: "claude-otra" }), /class="cq"/);
  assert.doesNotMatch(chat({ modelo: null }), /class="cq"/);
});

test("los cierres de Google y ChatGPT rigen a sus propios modelos", () => {
  assert.equal(cierreRigeAlLider({ proveedor: "google", cuenta: "google" }, { modelo: "agy:claude-opus-5-5" }), true);
  assert.equal(cierreRigeAlLider({ proveedor: "chatgpt", cuenta: "chatgpt" }, { modelo: "codex:gpt-6.2-sol" }), true);
});

test("si el cierre informa una familia, sólo rige a los modelos de esa familia", () => {
  const deOpus = { ...cierre, grupo: "opus" };
  assert.equal(cierreRigeAlLider(deOpus, lider), true);
  assert.equal(cierreRigeAlLider(deOpus, { modelo: "claude-sonnet-5-5" }), false);
});

test("la acción de seguir aparece después de cerrar y desaparece cuando vuelve el cupo", () => {
  for (const fase of ["cerrando", "volvio", "retomado"] as const) {
    assert.doesNotMatch(tarjeta({ fase }), botonSeguir);
    assert.match(tarjeta({ fase }), /Abrir el resumen/);
  }
});

test("el resumen sigue disponible y el interruptor exige hora y que la persona no haya escrito", () => {
  assert.match(tarjeta(), /role="switch"/);
  for (const cambios of [{ vuelve: null }, { duenoEscribio: true }]) {
    const html = tarjeta(cambios);
    assert.match(html, /Abrir el resumen/);
    assert.doesNotMatch(html, /role="switch"/);
  }
});
