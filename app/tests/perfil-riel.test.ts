// El perfil de reparto en la barra de cupos (src/barra/PerfilRiel.tsx, src/datos/perfil-reparto.ts): se guarda en `modelos.json` por el mismo
// camino que Ajustes (main real contra una carpeta temporal, con un `pa` de mentira), tocando sólo el perfil; si falla, el archivo no cambia y
// el motivo llega; el indicador está en el riel con su `data-guia`; los textos están en los dos idiomas.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { guardarModelos, leerModelos, type CorrerPa } from "../electron/modelos-config.ts";
import type { FuenteModelos, Perfil } from "../src/datos/perfil-reparto.ts";
import { es } from "../src/i18n/es.ts";
import { en } from "../src/i18n/en.ts";

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
const { EVENTO_PERFIL, guardarPerfil, leerPerfil, perfilDe, PERFILES } = await import("../src/datos/perfil-reparto.ts");

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-perfil-riel-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

const sinPa: CorrerPa = async () => ({ rc: 2, out: "", dijo: "no existe" });
/** La fuente de Ajustes, pero con el main de verdad y un `modelos.json` temporal. */
const conArchivo = (contenido?: string) => {
  const ruta = path.join(tmp, `c${++n}`, "trama", "modelos.json");
  if (contenido !== undefined) {
    mkdirSync(path.dirname(ruta), { recursive: true });
    writeFileSync(ruta, contenido);
  }
  const f: FuenteModelos = {
    modelos: () => leerModelos(sinPa, ruta) as ReturnType<FuenteModelos["modelos"]>,
    guardarModelos: (c) => guardarModelos(c, sinPa, ruta) as ReturnType<FuenteModelos["guardarModelos"]>,
  };
  return { ruta, f, json: () => JSON.parse(readFileSync(ruta, "utf8")) as Record<string, unknown> };
};

test("elegir un perfil lo escribe en modelos.json y lo demás queda como estaba", async () => {
  const { f, json } = conArchivo(JSON.stringify({ version: 1, lider: { modelo: "claude-opus-5-5", effort: "high" }, clave_ajena: { x: 1 }, reserva_lider: 0.5 }));
  assert.equal(await leerPerfil(f), "equilibrado");
  assert.equal(await guardarPerfil("agresivo", f), "agresivo");
  const j = json();
  assert.equal(j.perfil, "agresivo");
  assert.deepEqual(j.lider, { modelo: "claude-opus-5-5", effort: "high" });
  assert.deepEqual(j.clave_ajena, { x: 1 });
  assert.equal(j.reserva_lider, 0.5);
  assert.equal(await leerPerfil(f), "agresivo");
});

test("cada uno de los cuatro perfiles se guarda y se lee de vuelta; equilibrado saca la clave", async () => {
  const { f, json } = conArchivo('{"version": 1}');
  for (const p of PERFILES) {
    assert.equal(await guardarPerfil(p, f), p);
    assert.equal(await leerPerfil(f), p);
    assert.equal("perfil" in json(), p !== "equilibrado", p);
  }
});

test("sin archivo se crea al elegir; elegir el que ya está no escribe", async () => {
  const { ruta, f } = conArchivo();
  assert.equal(await leerPerfil(f), "equilibrado");
  assert.equal(await guardarPerfil("equilibrado", f), "equilibrado");
  assert.throws(() => readFileSync(ruta), /ENOENT/);
  assert.equal(await guardarPerfil("ahorro", f), "ahorro");
  assert.equal(JSON.parse(readFileSync(ruta, "utf8")).perfil, "ahorro");
});

test("si guardar falla rechaza con el motivo y el archivo queda igual", async () => {
  const roto = '{"version": 1, "perfil": "ahorro",,}';
  const { ruta, f } = conArchivo(roto);
  await assert.rejects(() => guardarPerfil("rendimiento", f), (e: Error) => e.message.length > 0);
  assert.equal(readFileSync(ruta, "utf8"), roto);
});

test("un guardado avisa a Ajustes con el perfil que quedó; sin cambio no avisa", async () => {
  const visto: Perfil[] = [];
  const objetivo = new EventTarget();
  (globalThis as unknown as { window: EventTarget }).window = objetivo;
  objetivo.addEventListener(EVENTO_PERFIL, (e) => visto.push((e as CustomEvent<Perfil>).detail));
  try {
    const { f } = conArchivo();
    await guardarPerfil("ahorro", f);
    await guardarPerfil("ahorro", f);
    await guardarPerfil("equilibrado", f);
    assert.deepEqual(visto, ["ahorro", "equilibrado"]);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("perfilDe: sin dato vale equilibrado", () => {
  assert.equal(perfilDe(undefined), "equilibrado");
  assert.equal(perfilDe({}), "equilibrado");
  assert.equal(perfilDe({ perfil: "agresivo" }), "agresivo");
});

test("el riel muestra el perfil (data-guia, un ícono por perfil, dedo de 2.75rem) y Ajustes lo escucha", () => {
  const raiz = path.join(import.meta.dirname, "..");
  const leer = (r: string) => readFileSync(path.join(raiz, r), "utf8");
  const comp = leer("src/barra/PerfilRiel.tsx");
  assert.match(comp, /data-guia="perfil-riel"/);
  assert.match(comp, /guardarPerfil\(/);
  assert.match(comp, /useFoco\(/);
  assert.match(leer("src/barra/CuposRiel.tsx"), /<PerfilRiel\b/);
  for (const p of PERFILES) assert.match(comp, new RegExp(`${p}: Ic`), p);
  const css = leer("src/barra/riel-estilos.css");
  assert.match(css, /\.perfil-btn \{[^}]*height: 2\.75rem/);
  assert.match(css, /\.perfil-op \{[^}]*min-height: 2\.75rem/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.perfil-btn/);
  const ajustes = leer("src/paneles/AjustesModelos.tsx");
  assert.match(ajustes, /EVENTO_PERFIL/);
  assert.match(ajustes, /avisarPerfil\(/);
});

test("textos: las claves del menú existen en es y en con las mismas variables; el agresivo dice lo que hace", () => {
  const claves = ["riel.perfil", "riel.perfilTip", "riel.perfilAria", "riel.perfilNota", "riel.perfilGuardando", "riel.perfilFallo", "riel.perfilLeerFallo"] as const;
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of claves) {
    assert.ok(es[k] && en[k], k);
    assert.deepEqual(vars(es[k]), vars(en[k]), k);
  }
  assert.match(es["riel.perfilNota"], /ahora en adelante/);
  assert.match(es["riel.perfilNota"], /ya corren/);
  // Lo que hace de verdad (motor/bin/reparto, aplicar_agresivo): piso de calidad duro, reserva del líder, Flash sólo lee, locales sin historial.
  assert.match(es["cu.perfilAgresivoQue"], /más barato/);
  assert.match(es["cu.perfilAgresivoQue"], /mínimo de calidad/);
  assert.match(es["cu.perfilAgresivoQue"], /Flash/);
  assert.match(en["cu.perfilAgresivoQue"], /quality floor/);
  assert.match(en["cu.perfilAgresivoQue"], /Flash/);
});
