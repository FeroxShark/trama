// Mover un líder de carpeta (`src/barra/mover-logica.ts` + `armarArbol`): la asignación del usuario gana sobre el cwd y el primer
// worker, persiste, mover a la carpeta de origen la borra, y el menú «Mover a proyecto…» lista las carpetas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarArbol } from "../src/barra/arbol.ts";
import { armarArrastre, CARPETAS, type Movida } from "../src/barra/arrastre.ts";
import { asignacionAlMover, carpetaDeLiderNuevo, carpetasParaMover, esOtraCarpeta } from "../src/barra/mover-logica.ts";
import type { Hilo, Lider } from "../src/datos/contrato.ts";

const AHORA = 2_000_000_000;
const lider = (id: string, proyecto: string, p: Partial<Lider> = {}): Lider => ({
  id,
  nombre: `ana-${id}`,
  proyecto,
  titulo: "Opus 5.5",
  actividad: AHORA - 60,
  creado: AHORA - 3600,
  cache_ttl_s: 3600,
  cache_vence: AHORA + 600,
  origen: "app",
  pid: 1,
  vivo: true,
  ocupado: false,
  modelo: "claude-opus-5-5",
  effort: null,
  inferido: proyecto,
  ...p,
});
const worker = (jefe: string, proyecto: string): Hilo =>
  ({ id: `20261003-100000-${jefe}`, proyecto, tarea: "t", estado: "trabajando", inicio: AHORA - 100, jefe_id: jefe, commits: 0, rama: null }) as unknown as Hilo;

test("lo movido a mano gana sobre el cwd (inferido) y sobre el primer worker", () => {
  const l = lider("a", "atlas");
  const w = worker("a", "atlas");
  assert.equal(armarArbol([w], { lideres: [l], ahora: AHORA }).lideres.get("a")!.proyecto, "atlas");
  const movido = armarArbol([w], { lideres: [l], mover: new Map([["a", "trama"]]), ahora: AHORA });
  assert.equal(movido.lideres.get("a")!.proyecto, "trama");
  // Sus workers se ven bajo el líder, en la carpeta nueva.
  const carpeta = movido.carpetas.find((g) => g.proyecto === "trama")!;
  assert.ok(carpeta, "la carpeta nueva existe");
  const rama = [...carpeta.ramas, ...carpeta.espera, ...carpeta.dormidos].find((r) => r.lider?.id === "a")!;
  assert.ok(rama, "el líder está en la carpeta nueva");
  assert.equal([...rama.vivas, ...rama.viejas].length, 1, "su worker cuelga de él");
  assert.equal(movido.carpetas.find((g) => g.proyecto === "atlas"), undefined);
});

test("persiste: la misma asignación da la misma carpeta en cada armado y no depende de fijadas", () => {
  const l = lider("a", "atlas");
  const mover = new Map([["a", "trama"]]);
  const fijadas = new Map([["a", "atlas"]]);
  for (let i = 0; i < 3; i++) assert.equal(armarArbol([], { lideres: [l], mover, fijadas, ahora: AHORA + i }).lideres.get("a")!.proyecto, "trama");
});

test("mover a la carpeta de origen borra la asignación; a otra, la guarda", () => {
  assert.equal(asignacionAlMover("atlas", "atlas"), null);
  assert.equal(asignacionAlMover("atlas", "trama"), "trama");
  assert.equal(asignacionAlMover(null, "trama"), "trama");
  assert.equal(asignacionAlMover(undefined, "trama"), "trama");
});

test("un arrastre sólo cae en otra carpeta, no en la propia", () => {
  assert.equal(esOtraCarpeta("atlas", "trama"), true);
  assert.equal(esOtraCarpeta("atlas", "atlas"), false);
  assert.equal(esOtraCarpeta("atlas", undefined), false);
});

test("el menú «Mover a proyecto…» lista el home primero, las carpetas por nombre y sin repetidos", () => {
  const nombre = (p: string) => (p === "general" ? "inicio" : p === "omc" ? "Atlas" : p);
  const l = carpetasParaMover({ registro: ["trama", "omc"], enBarra: ["trama", "general", "brote"], ya: "viejo", nombre });
  assert.deepEqual(
    l.map((x) => x.p),
    ["general", "omc", "brote", "trama", "viejo"],
  );
  assert.equal(l[0].texto, "inicio");
  // Dos slugs que se ven igual: queda uno.
  assert.equal(carpetasParaMover({ registro: ["a", "b"], enBarra: [], ya: null, nombre: () => "Igual" }).length, 2);
});

test("carpetaDeLiderNuevo: un líder derivado (de) hereda la carpeta del padre sin ser secuestrado por nuevaEn", () => {
  const carpetaDe = (sid: string) => (sid === "s-b" ? "brote" : undefined);
  assert.equal(carpetaDeLiderNuevo({ nuevaEn: "atlas", de: "s-b", carpetaDe }), "brote");
  assert.equal(carpetaDeLiderNuevo({ nuevaEn: "atlas", carpetaDe }), "atlas");
  assert.equal(carpetaDeLiderNuevo({ deCarpeta: "trama", nuevaEn: "atlas", de: "s-b", carpetaDe }), "trama");
});

test("armarArrastre: permite arrastrar un líder único de su carpeta hacia otra carpeta, pero no una carpeta única", () => {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const win = {
    addEventListener(k: string, fn: (e: unknown) => void) {
      if (!listeners.has(k)) listeners.set(k, new Set());
      listeners.get(k)!.add(fn);
    },
    removeEventListener(k: string, fn: (e: unknown) => void) {
      listeners.get(k)?.delete(fn);
    },
  };
  const prevWin = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = win;
  try {
    const proyAtlas: Record<string, unknown> = {
      getBoundingClientRect: () => ({ left: 0, right: 200, top: 0, bottom: 50 }),
      querySelector: () => ({ dataset: { carpeta: "atlas" } }),
      setAttribute() {},
      removeAttribute() {},
    };
    const proyTrama: Record<string, unknown> = {
      getBoundingClientRect: () => ({ left: 0, right: 200, top: 60, bottom: 110 }),
      querySelector: () => ({ dataset: { carpeta: "trama" } }),
      setAttribute() {},
      removeAttribute() {},
    };
    const unidad: Record<string, unknown> = {
      dataset: { grupo: "lider:atlas", mueve: "l1" },
      isConnected: true,
      closest: (sel: string) => (sel === "[data-mueve]" ? unidad : sel === ".proy" ? proyAtlas : null),
      getBoundingClientRect: () => ({ left: 10, right: 190, top: 20, bottom: 44, width: 180 }),
      setAttribute() {},
      removeAttribute() {},
    };
    const asa = {
      classList: { contains: (c: string) => c === "lider" },
      closest: (sel: string) => (sel === ".lider, .proy-nom" ? asa : sel === "[data-mueve]" ? unidad : null),
    };
    let bajarFn: ((e: unknown) => void) | null = null;
    const lista = {
      clientLeft: 0,
      clientTop: 0,
      scrollLeft: 0,
      scrollTop: 0,
      addEventListener: (k: string, fn: (e: unknown) => void) => {
        if (k === "pointerdown") bajarFn = fn;
      },
      removeEventListener() {},
      querySelectorAll: (sel: string) => (sel === "[data-grupo]" ? [unidad] : sel === ".proy" ? [proyAtlas, proyTrama] : []),
      getBoundingClientRect: () => ({ left: 0, right: 200, top: 0, bottom: 200 }),
      setPointerCapture() {},
      hasPointerCapture: () => false,
      releasePointerCapture() {},
    } as unknown as HTMLElement;

    const soltadas: Movida[] = [];
    const limpiar = armarArrastre(lista, {
      raiz: () => null,
      linea: () => null,
      puede: () => true,
      alSoltar: (m) => soltadas.push(m),
    });

    bajarFn!({ button: 0, pointerType: "mouse", isPrimary: true, pointerId: 1, clientX: 50, clientY: 30, target: asa });
    for (const fn of listeners.get("pointermove") ?? []) fn({ pointerId: 1, clientX: 50, clientY: 80 });
    for (const fn of listeners.get("pointerup") ?? []) fn({ pointerId: 1 });
    assert.deepEqual(soltadas, [{ grupo: "lider:atlas", id: "l1", junto: "l1", antes: false, aCarpeta: "trama" }]);

    // Carpeta única: no arranca arrastre.
    unidad.dataset = { grupo: CARPETAS, mueve: "atlas" };
    asa.classList = { contains: (c: string) => c === "proy-nom" };
    bajarFn!({ button: 0, pointerType: "mouse", isPrimary: true, pointerId: 2, clientX: 50, clientY: 30, target: asa });
    assert.equal(listeners.get("pointermove")?.size ?? 0, 0);
    limpiar();
  } finally {
    (globalThis as { window?: unknown }).window = prevWin;
  }
});
