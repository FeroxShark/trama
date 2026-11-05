import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { almacenTitulos, decidirTitulo } from "../electron/titulo-estable.ts";
import { tituloCorto, tituloLider } from "../electron/tema.ts";

const PRIMERO = "Abrir Blender y revisar el modelo del barco que quedó a medias";
const escribir = (a: string, t: string) => writeFile(a, t);
const sinTema = { custom: null, ai: null, primero: null };

async function carpeta<T>(f: (ruta: string) => Promise<T>) {
  const d = await mkdtemp(path.join(os.tmpdir(), "titulos-"));
  try {
    return await f(path.join(d, "titulos-fijos.json"));
  } finally {
    await rm(d, { recursive: true, force: true });
  }
}

test("un título automático ya mostrado no cambia tras un reinicio aunque el transcript diga otro", () =>
  carpeta(async (ruta) => {
    const a = almacenTitulos(ruta, escribir);
    // Antes del arreglo: el ai-title de Claude Code, reescrito, cambiaba el nombre en cada lectura.
    assert.equal(await a.titulo("s1", { custom: null, ai: "Revisar barco en Blender", primero: PRIMERO }, "trama-aaaa"), "Revisar barco en Blender");
    await a.vaciar();
    // Reinicio del motor: almacén nuevo, mismo archivo; el transcript releído trae otro ai-title, o ninguno.
    const b = almacenTitulos(ruta, escribir);
    assert.equal(await b.titulo("s1", { custom: null, ai: "Abrir Blender", primero: PRIMERO }, "trama-aaaa"), "Revisar barco en Blender");
    assert.equal(await b.titulo("s1", sinTema, "trama-aaaa"), "Revisar barco en Blender");
    assert.equal(await b.titulo("s1", { custom: null, ai: null, primero: PRIMERO }, "trama-aaaa", "Otro generado"), "Revisar barco en Blender");
    // Sin el arreglo (tituloLider a secas) saldría otro:
    assert.equal(tituloLider({ custom: null, ai: "Abrir Blender", primero: PRIMERO }, "trama-aaaa"), "Abrir Blender");
  }));

test("el recorte del primer mensaje se mantiene hasta el primer título bueno, y ése queda", () =>
  carpeta(async (ruta) => {
    const a = almacenTitulos(ruta, escribir);
    const corto = tituloCorto(PRIMERO);
    assert.equal(await a.titulo("s2", { custom: null, ai: null, primero: PRIMERO }, "trama-aaaa"), corto);
    assert.equal(await a.titulo("s2", sinTema, "trama-aaaa"), corto);
    assert.equal(await a.titulo("s2", { custom: null, ai: null, primero: PRIMERO }, "trama-aaaa", "Barco en Blender"), "Barco en Blender");
    await a.vaciar();
    const b = almacenTitulos(ruta, escribir);
    assert.equal(await b.titulo("s2", { custom: null, ai: "Otra cosa", primero: PRIMERO }, "trama-aaaa", "Más otra"), "Barco en Blender");
  }));

test("lo puesto a mano en Claude Code manda sobre lo inferido y no se pierde si deja de verse", () =>
  carpeta(async (ruta) => {
    const a = almacenTitulos(ruta, escribir);
    assert.equal(await a.titulo("s3", { custom: null, ai: "Automático", primero: PRIMERO }, "trama-aaaa"), "Automático");
    // /rename: pisa al automático ya fijado.
    assert.equal(await a.titulo("s3", { custom: "Mi nombre", ai: "Automático", primero: PRIMERO }, "trama-aaaa"), "Mi nombre");
    // El name de la sesión también cuenta como puesto a mano.
    assert.equal(await a.titulo("s4", { custom: null, ai: "Auto", primero: PRIMERO }, "maxq-blender"), "maxq-blender");
    await a.vaciar();
    const b = almacenTitulos(ruta, escribir);
    // Reinicio, transcript ilegible / el proceso murió (ya no hay name): sigue el nombre a mano, no el automático.
    assert.equal(await b.titulo("s3", { custom: null, ai: "Automático nuevo", primero: PRIMERO }, "trama-bbbb"), "Mi nombre");
    assert.equal(await b.titulo("s4", sinTema, "trama-bbbb"), "maxq-blender");
    // Un /rename nuevo lo reemplaza.
    assert.equal(await b.titulo("s3", { custom: "Otro nombre", ai: null, primero: PRIMERO }, "trama-bbbb"), "Otro nombre");
  }));

test("decidirTitulo: lo automático nunca pisa lo manual guardado y no escribe de más", () => {
  const manual = { titulo: "Mío", fase: "manual" as const };
  assert.deepEqual(decidirTitulo(manual, { custom: null, ai: "X", primero: PRIMERO }, ""), { titulo: "Mío", fijar: null });
  assert.deepEqual(decidirTitulo({ titulo: "Z", fase: "final" }, { custom: null, ai: "X", primero: PRIMERO }, ""), { titulo: "Z", fijar: null });
  assert.deepEqual(decidirTitulo(undefined, sinTema, ""), { titulo: "", fijar: null });
});

test("un archivo ilegible no se pisa: se muestra lo calculado pero no se escribe", () =>
  carpeta(async (ruta) => {
    await writeFile(ruta, "{roto");
    const a = almacenTitulos(ruta, escribir);
    assert.equal(await a.titulo("s5", { custom: "Mío", ai: null, primero: null }, ""), "Mío");
    await a.vaciar();
    assert.equal(await readFile(ruta, "utf8"), "{roto");
  }));
