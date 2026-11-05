// La carpeta de un líder en la barra no salta sola (reporte de Gonza, Windows: "tiene un chat, cambia de carpeta y después
// vuelve"). Reglas: lo elegido a mano (`nombres.proyectos`) nunca se pierde; lo que la barra decide sola (workers o primer
// mensaje) se fija con el líder (`nombres.fijadas`) y ya no se recalcula. Docs: docs/estado/carpeta-estable.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { armarArbol, lideresSinProceso } from "../src/barra/arbol.ts";
import { almacenNombres } from "../electron/nombres.ts";
import { registro } from "../electron/registro.ts";
import type { Hilo, Lider } from "../src/datos/contrato.ts";

const AHORA = 2_000_000_000;
const MIN = 60;

const lider = (id: string, extra: Partial<Lider> = {}): Lider => ({
  id,
  nombre: `ana-${id}`,
  proyecto: "lo-que-diga-el-cwd",
  titulo: "Opus 5.5",
  actividad: AHORA - MIN,
  creado: AHORA - 6 * 3600,
  cache_ttl_s: 3600,
  cache_vence: AHORA + 30 * MIN,
  origen: "app",
  pid: 4242,
  vivo: true,
  ocupado: false,
  modelo: "claude-opus-5-5",
  effort: "high",
  ...extra,
});

let n = 0;
const worker = (proyecto: string, jefe_id: string, inicio = AHORA - 10 * MIN): Hilo =>
  ({
    id: `20261003-100000-${20000 + n++}`,
    tarea: "Tarea",
    proyecto,
    estado: "trabajando",
    modelo: "claude-opus-5-5",
    effort: "medium",
    origen: "jefe",
    jefe: `ana-${jefe_id}`,
    jefe_id,
    sigue_de: null,
    en_cola: false,
    inicio,
    duracion_s: null,
    puesto: "1",
    rama: null,
    commits: 0,
    decision: null,
    decision_nada: null,
    resultado: null,
    archivado: null,
    leer: false,
    cache_ttl_s: null,
    cache_vence: null,
    cache_frio: null,
    cache_modelo: null,
  }) as Hilo;

/** Una barra viva: cada pasada arma el árbol y guarda lo que decidió, como hace `Barra.tsx` (efecto sobre `decididas`). */
function barra(fijar: boolean) {
  const mover = new Map<string, string>();
  const fijadas = new Map<string, string>();
  return {
    mover,
    fijadas,
    carpeta(hilos: Hilo[], lideres: Lider[], sid = "a") {
      const a = armarArbol(hilos, { lideres, mover, fijadas, ahora: AHORA });
      if (fijar) for (const [id, p] of a.decididas) fijadas.set(id, p);
      return a.lideres.get(sid)!.proyecto;
    },
  };
}

/** El mismo líder por todas las transiciones que hacen saltar la carpeta; devuelve la carpeta tras cada una. */
function recorrido(b: ReturnType<typeof barra>): string[] {
  const out: string[] = [];
  const paso = (hilos: Hilo[], lideres: Lider[]) => out.push(b.carpeta(hilos, lideres));
  const w = worker("brote", "a");
  // 1. Vivo, su primer mensaje nombra atlas.
  paso([], [lider("a", { inferido: "atlas" })]);
  // 2. Lanza un worker en otro proyecto (de brote).
  paso([w], [lider("a", { inferido: "atlas" })]);
  // 3. El worker se va de la lista (integrado, archivado, podado).
  paso([], [lider("a", { inferido: "atlas" })]);
  // 4. El registry no se pudo leer un instante: no hay `inferido`.
  paso([], [lider("a", { inferido: null })]);
  // 5. Compactó / retomó: el "primer mensaje" ahora es otro y nombra a otro proyecto.
  paso([], [lider("a", { inferido: "omc" })]);
  // 6. Se quedó sin proceso (reinicio, murió) con un worker de otro proyecto todavía a la vista.
  const sin = lideresSinProceso([w], { lideres: [], ahora: AHORA });
  paso([w], sin);
  // 7. Vuelve con proceso y sin `inferido` (transcript todavía sin leer).
  paso([w], [lider("a")]);
  return out;
}

test("sin fijar (lo de antes) la carpeta saltaba: control de que el recorrido sí la mueve", () => {
  const sin = recorrido(barra(false));
  assert.ok(new Set(sin).size > 1, `debería saltar, dio ${sin.join(" → ")}`);
});

test("el líder conserva la carpeta que se decidió por todo el recorrido", () => {
  const cs = recorrido(barra(true));
  assert.deepEqual(cs, Array(cs.length).fill("atlas"));
});

test("si el primer worker ya está a la vista al decidir, esa es la carpeta y no se mueve", () => {
  const b = barra(true);
  const w = worker("brote", "a");
  assert.equal(b.carpeta([w], [lider("a", { inferido: "atlas" })]), "brote");
  assert.equal(b.carpeta([], [lider("a", { inferido: "atlas" })]), "brote");
  assert.equal(b.carpeta([worker("atlas", "a", AHORA - 99 * MIN)], [lider("a")]), "brote");
});

test("lo elegido a mano gana sobre lo fijado y sobre todo lo demás", () => {
  const b = barra(true);
  assert.equal(b.carpeta([], [lider("a", { inferido: "atlas" })]), "atlas");
  b.mover.set("a", "omc");
  assert.equal(b.carpeta([worker("brote", "a")], [lider("a", { inferido: "atlas" })]), "omc");
  // Y lo elegido a mano no se vuelve a "decidir".
  const a = armarArbol([], { lideres: [lider("a", { inferido: "atlas" })], mover: b.mover, fijadas: new Map(), ahora: AHORA });
  assert.equal(a.decididas.size, 0);
  // "Soltarlo" (vuelve a la de siempre) lo deja decidir de nuevo.
  b.mover.delete("a");
  b.fijadas.delete("a");
  assert.equal(b.carpeta([worker("brote", "a")], [lider("a", { inferido: "atlas" })]), "brote");
});

test("sin workers ni mensaje que nombre un proyecto no se decide nada: sigue en general", () => {
  const a = armarArbol([], { lideres: [lider("a", { inferido: null })], ahora: AHORA });
  assert.equal(a.lideres.get("a")!.proyecto, "general");
  assert.equal(a.decididas.size, 0);
});

// --- nombres.json -----------------------------------------------------------------------------------------------

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "trama-carpeta-"));

test("nombres: dos cambios a la vez, recién arrancado, se guardan los dos", async () => {
  const f = path.join(tmp(), "nombres.json");
  const a = almacenNombres(f, writeFile);
  await Promise.all([a.proyecto("s1", "atlas"), a.proyecto("s2", "omc"), a.titulo("s1", "Login"), a.proyecto("s3", "brote", true)]);
  const b = await almacenNombres(f, writeFile).leer();
  assert.deepEqual(b.proyectos, { s1: "atlas", s2: "omc" });
  assert.deepEqual(b.fijadas, { s3: "brote" });
  assert.deepEqual(b.titulos, { s1: "Login" });
});

test("nombres: guarda de a una y en orden, aunque la primera escritura tarde más que las siguientes", async () => {
  const f = path.join(tmp(), "nombres.json");
  const disco = new Map<string, string>();
  let enCurso = 0;
  let maximo = 0;
  let llamadas = 0;
  const a = almacenNombres(f, async (arch, t) => {
    maximo = Math.max(maximo, ++enCurso);
    // Cada escritura tarda menos que la anterior: sin orden, la más vieja queda última en el disco.
    for (let vueltas = 8 - llamadas++; vueltas > 0; vueltas--) await new Promise(setImmediate);
    disco.set(arch, t);
    enCurso--;
  });
  await Promise.all([a.proyecto("s1", "atlas"), a.proyecto("s2", "omc"), a.titulo("s1", "Login"), a.proyecto("s3", "brote", true)]);
  assert.equal(maximo, 1);
  const j = JSON.parse(disco.get(f)!);
  assert.deepEqual(j.proyectos, { s1: "atlas", s2: "omc" });
  assert.deepEqual(j.fijadas, { s3: "brote" });
  assert.deepEqual(j.titulos, { s1: "Login" });
  assert.equal(disco.get(`${f}.bak`), disco.get(f));
});

test("nombres: una escritura que falla se dice y no traba las siguientes", async () => {
  const f = path.join(tmp(), "nombres.json");
  let primera = true;
  const a = almacenNombres(f, async (arch, t) => {
    if (primera) {
      primera = false;
      throw new Error("disco ocupado");
    }
    await writeFile(arch, t);
  });
  const [mala, buena] = await Promise.allSettled([a.proyecto("s1", "atlas"), a.proyecto("s2", "omc")]);
  assert.equal(mala.status, "rejected");
  assert.equal(buena.status, "fulfilled");
  assert.deepEqual((await almacenNombres(f, writeFile).leer()).proyectos, { s1: "atlas", s2: "omc" });
});

test("nombres: una carpeta fijada nunca pisa la elegida a mano, y soltar la olvida", async () => {
  const f = path.join(tmp(), "nombres.json");
  const a = almacenNombres(f, writeFile);
  await a.proyecto("s", "omc");
  await a.proyecto("s", "atlas", true);
  assert.deepEqual((await a.leer()).proyectos, { s: "omc" });
  assert.deepEqual((await a.leer()).fijadas, {});
  await a.proyecto("t", "atlas", true);
  await a.proyecto("t", "brote");
  assert.deepEqual(((await a.leer()) as { fijadas: object }).fijadas, {});
  await a.proyecto("u", "atlas", true);
  await a.proyecto("u", null);
  assert.deepEqual((await a.leer()).fijadas, {});
});

test("nombres: un archivo roto se recupera del .bak y lo elegido a mano sobrevive al próximo guardado", async () => {
  const f = path.join(tmp(), "nombres.json");
  const a = almacenNombres(f, writeFile);
  await a.proyecto("s1", "atlas");
  await a.proyecto("s2", "omc");
  writeFileSync(f, '{"version":1,"proyect'); // escritura a medias
  const b = almacenNombres(f, writeFile);
  assert.equal((await b.leer()).proyectos.s1, "atlas");
  await b.proyecto("s3", "brote");
  const c = await almacenNombres(f, writeFile).leer();
  assert.deepEqual(c.proyectos, { s1: "atlas", s2: "omc", s3: "brote" });
});

test("nombres: un archivo que no se puede leer un instante no se da por vacío ni se pisa", async () => {
  const dir = tmp();
  const f = path.join(dir, "nombres.json");
  mkdirSync(f); // leerlo falla con EISDIR: como un archivo bloqueado, no como "no existe"
  const escrituras: string[] = [];
  const a = almacenNombres(f, async (arch, t) => void escrituras.push(arch + t));
  assert.deepEqual((await a.leer()).proyectos, {});
  await assert.rejects(a.proyecto("s", "atlas"));
  assert.deepEqual(escrituras, []);
  // Ya se puede leer: vuelve a intentar (no quedó "vacío" para siempre).
  rmSync(f, { recursive: true });
  writeFileSync(f, JSON.stringify({ version: 1, proyectos: { x: "omc" } }));
  assert.deepEqual((await a.leer()).proyectos, { x: "omc" });
});

// --- registry -------------------------------------------------------------------------------------------------------

test("registro: un registry que no se puede leer un instante no deja sin proyectos a todos", async () => {
  const dir = tmp();
  const proy = path.join(dir, "atlas");
  mkdirSync(proy);
  const f = path.join(dir, "registry.json");
  const antes = process.env.PROYECTOS_REGISTRY;
  process.env.PROYECTOS_REGISTRY = f;
  try {
    writeFileSync(f, JSON.stringify({ projects: [{ name: "atlas", path: proy }] }));
    assert.deepEqual((await registro()).map((p) => p.slug), ["atlas"]);
    writeFileSync(f, '{"projects": [{"name": "atl'); // a medias
    assert.deepEqual((await registro()).map((p) => p.slug), ["atlas"]);
    rmSync(f);
    assert.deepEqual(await registro(), []); // sin archivo sí es "sin proyectos"
  } finally {
    if (antes === undefined) delete process.env.PROYECTOS_REGISTRY;
    else process.env.PROYECTOS_REGISTRY = antes;
  }
});

test("sanidad: el archivo guardado lleva versión y fijadas", async () => {
  const f = path.join(tmp(), "nombres.json");
  await almacenNombres(f, writeFile).proyecto("s", "atlas", true);
  const j = JSON.parse(readFileSync(f, "utf8"));
  assert.equal(j.version, 1);
  assert.deepEqual(j.fijadas, { s: "atlas" });
});
