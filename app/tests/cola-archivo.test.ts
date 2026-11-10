// El archivo de la cola (`cola.json`): el respaldo (electron/cola-respaldo.ts) y la lectura única (electron/cola-lectura.ts), con la cola
// (electron/cola.ts) en el medio: si el archivo no se puede leer o es de otra versión, se copia a `cola.json.bak-<fecha>` antes de seguir con
// la cola vacía (la cola nunca se pierde), y si la carga falla, la promesa no queda rechazada para siempre.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearCola, type Encolado } from "../electron/cola.ts";
import { crearLecturaCola } from "../electron/cola-lectura.ts";
import { nombreDeRespaldo, respaldarCola, selloDeRespaldo } from "../electron/cola-respaldo.ts";

const nuevaCasa = () => mkdtempSync(path.join(os.tmpdir(), "trama-cola-archivo-"));

test("el respaldo de la cola: se copia a `cola.json.bak-<fecha>` y el original queda", async () => {
  const casa = nuevaCasa();
  try {
    const archivo = path.join(casa, "cola.json");
    writeFileSync(archivo, '{"version":2,"colas":{}}');
    const ahora = new Date("2026-11-10T04:34:31.123Z");
    const r = await respaldarCola(archivo, "version", { ahora });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.archivo, path.join(casa, "cola.json.bak-2026-11-10T04-34-31-123Z"));
    assert.equal(readFileSync(archivo, "utf8"), '{"version":2,"colas":{}}');
    assert.equal(readFileSync(r.ok ? r.archivo : "", "utf8"), '{"version":2,"colas":{}}');
    // El nombre del respaldo no lleva dos puntos (en Windows un archivo no puede).
    assert.ok(!selloDeRespaldo(ahora).includes(":"));
    assert.equal(nombreDeRespaldo(archivo, ahora), path.join(casa, "cola.json.bak-2026-11-10T04-34-31-123Z"));
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});

test("el respaldo: si no había cola, no hay nada que respaldar; si la copia falla, se dice", async () => {
  const casa = nuevaCasa();
  try {
    const archivo = path.join(casa, "cola.json");
    const sinArchivo = await respaldarCola(archivo, "ilegible");
    assert.equal(sinArchivo.ok, false);
    assert.equal(!sinArchivo.ok && sinArchivo.porque, "noHabia");
    writeFileSync(archivo, "x");
    const fallo = await respaldarCola(archivo, "ilegible", {
      copiar: async () => {
        throw new Error("no se pudo");
      },
    });
    assert.equal(fallo.ok, false);
    assert.equal(!fallo.ok && fallo.porque, "noSePudo");
    assert.deepEqual(readdirSync(casa), ["cola.json"]);
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});

/** Una cola de mentira: sólo lo que hace falta para `cargar`. */
function colaDePrueba(respaldo: (motivo: "ilegible" | "version") => void) {
  return crearCola({
    disponible: async () => "nadie",
    traer: async () => ({ ok: true }),
    mandar: async () => {},
    total: async () => 0,
    textoError: () => "error",
    guardar: async () => {},
    avisar: () => {},
    respaldo,
  });
}

test("la cola: si el archivo no se puede leer o es de otra versión, se pide el respaldo antes de seguir vacía", async () => {
  const motivos: string[] = [];
  const cola = colaDePrueba((m) => void motivos.push(m));
  await cola.cargar("esto no es json");
  await cola.cargar(JSON.stringify({ version: 2, colas: {} }));
  await cola.cargar(JSON.stringify({ version: 1, colas: {} }));
  assert.deepEqual(motivos, ["ilegible", "version"]);
});

test("la cola: con el archivo de esta versión, no hay nada que respaldar", async () => {
  const motivos: string[] = [];
  const cola = colaDePrueba((m) => void motivos.push(m));
  const item: Encolado = { id: 1, texto: "hola", modelo: "m", effort: "e" };
  await cola.cargar(JSON.stringify({ version: 1, colas: { s: [item] } }));
  assert.deepEqual(motivos, []);
  assert.equal(cola.lista("s").length, 1);
});

test("la lectura de la cola: se lee una sola vez; si la carga falla, se suelta la promesa y se anota", async () => {
  let leidas = 0;
  const fallos: unknown[] = [];
  const leer = crearLecturaCola({
    leer: async () => {
      leidas++;
      return "{}";
    },
    cargar: () => {
      throw new Error("se cayó");
    },
    alFallar: (e) => fallos.push(e),
  });
  await leer();
  await leer();
  assert.equal(leidas, 2, "la segunda vez se vuelve a leer");
  assert.equal(fallos.length, 2);
  assert.ok(fallos[0] instanceof Error);
});

test("la lectura de la cola: mientras va bien, el archivo se lee una sola vez", async () => {
  let leidas = 0;
  let cargadas = 0;
  const leer = crearLecturaCola({
    leer: async () => {
      leidas++;
      return "{}";
    },
    cargar: () => {
      cargadas++;
    },
    alFallar: () => assert.fail("no tenía que fallar"),
  });
  await leer();
  await leer();
  assert.equal(leidas, 1);
  assert.equal(cargadas, 1);
});

test("la lectura de la cola: si el archivo no está, la cola carga vacía (sin error)", async () => {
  let cargadas: (string | null)[] = [];
  const leer = crearLecturaCola({
    leer: async () => {
      throw new Error("no está");
    },
    cargar: (json) => void cargadas.push(json),
    alFallar: () => assert.fail("no tenía que fallar"),
  });
  await leer();
  assert.deepEqual(cargadas, [null]);
});
