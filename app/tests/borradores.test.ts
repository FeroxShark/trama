// Lo escrito sin mandar, en disco (electron/borradores.ts): sobrevive a un reinicio, se acota y suelta los
// adjuntos cuyo archivo ya no está. Con el disco de mentira (una variable) y nunca el estado de Ana.
import assert from "node:assert/strict";
import { test } from "node:test";
import { almacenBorradores, armar, BORRADOR_MAX, BORRADORES_MAX, leerFoto, recortar } from "../electron/borradores.ts";

/** Un disco de mentira y una forma de "abrir la app de nuevo" sobre él. */
function disco(existe: (ruta: string) => boolean = () => true) {
  const d = { json: null as string | null, escrituras: 0, t: 1000 };
  const abrir = () =>
    almacenBorradores(
      async () => d.json,
      async (j) => {
        d.json = j;
        d.escrituras++;
      },
      { ahora: () => d.t++, existe },
    );
  return { d, abrir };
}

test("el texto sin mandar sobrevive a un reinicio, con lo elegido en las preguntas y los adjuntos", async () => {
  const { d, abrir } = disco();
  const a = abrir();
  await a.guardar({
    "lider:s1": { texto: "a medio escribir ñ 🙂", archivos: [{ nombre: "nota.md", ruta: "/tmp/x/nota.md" }] },
    "BORRADOR_LIDER": { texto: "", extra: { "q1": "opción B" } },
  });
  const b = await abrir().leer(); // otra trama, mismo disco
  assert.equal(b.borradores["lider:s1"].texto, "a medio escribir ñ 🙂");
  assert.deepEqual(b.borradores["lider:s1"].archivos, [{ nombre: "nota.md", ruta: "/tmp/x/nota.md" }]);
  assert.deepEqual(b.borradores["BORRADOR_LIDER"].extra, { q1: "opción B" });
  assert.equal(d.escrituras, 1);
});

test("una caja vaciada deja de guardarse; un borrador sin nada no ocupa lugar", async () => {
  const { abrir } = disco();
  const a = abrir();
  await a.guardar({ x: { texto: "algo" }, y: { texto: "" }, z: { texto: "", archivos: [] }, w: null, v: 3 });
  assert.deepEqual(Object.keys((await abrir().leer()).borradores), ["x"]);
  await a.guardar({});
  assert.deepEqual((await abrir().leer()).borradores, {});
});

test("tope por borrador: lo que pasa de 200 KB se recorta sin partir un carácter", async () => {
  assert.equal(BORRADOR_MAX, 200 * 1024);
  const { abrir } = disco();
  const a = abrir();
  const grande = "ñ".repeat(BORRADOR_MAX); // 2 bytes cada una
  await a.guardar({ x: { texto: grande }, y: { texto: "🙂".repeat(BORRADOR_MAX) } });
  const r = (await abrir().leer()).borradores;
  assert.ok(Buffer.byteLength(r.x.texto) <= BORRADOR_MAX && Buffer.byteLength(r.x.texto) > BORRADOR_MAX - 2);
  assert.ok(Buffer.byteLength(r.y.texto) <= BORRADOR_MAX);
  assert.ok(!/[\ud800-\udbff]$/.test(r.y.texto), "no queda media pareja suplente");
  assert.equal(recortar("abc", 10), "abc");
  assert.equal(recortar("abcdef", 4), "abcd");
});

test("tope de cantidad: al llegar el 51 se va el que hace más que no se toca", async () => {
  assert.equal(BORRADORES_MAX, 50);
  const { d, abrir } = disco();
  const a = abrir();
  const foto: Record<string, { texto: string }> = {};
  for (let i = 0; i < BORRADORES_MAX; i++) foto[`c${i}`] = { texto: `texto ${i}` };
  const hasta: Record<string, { texto: string }> = {};
  for (const k of Object.keys(foto)) await a.guardar({ ...hasta, [k]: (hasta[k] = foto[k]) }); // de a uno: c0 es el más viejo
  assert.equal(Object.keys((await abrir().leer()).borradores).length, 50);
  d.t += 100;
  await a.guardar({ ...foto, nueva: { texto: "la 51" } });
  const r = (await abrir().leer()).borradores;
  assert.equal(Object.keys(r).length, 50);
  assert.ok(r.nueva, "la nueva entra");
  assert.equal(r.c0, undefined, "se va el más viejo");
  assert.ok(r.c49, "el resto sigue");
});

test("tocar un borrador lo rejuvenece; los que no cambian conservan su momento", async () => {
  const { d, abrir } = disco();
  const a = abrir();
  await a.guardar({ viejo: { texto: "uno" }, otro: { texto: "dos" } });
  const t0 = (await abrir().leer()).borradores.viejo.ts;
  d.t += 5000;
  await a.guardar({ viejo: { texto: "uno" }, otro: { texto: "dos, cambiado" } });
  const r = (await abrir().leer()).borradores;
  assert.equal(r.viejo.ts, t0, "igual: mismo momento");
  assert.ok(r.otro.ts > t0, "cambió: momento nuevo");
});

test("un adjunto cuyo archivo ya no está se suelta en silencio al volver; el texto queda", async () => {
  const vivos = new Set(["/tmp/a.png"]);
  const { abrir } = disco((r) => vivos.has(r));
  await abrir().guardar({
    x: { texto: "mirá esto", archivos: [{ nombre: "a.png", ruta: "/tmp/a.png" }, { nombre: "b.png", ruta: "/tmp/b.png" }] },
    soloAdjunto: { texto: "", archivos: [{ nombre: "b.png", ruta: "/tmp/b.png" }] },
  });
  const r = (await abrir().leer()).borradores;
  assert.deepEqual(r.x.archivos, [{ nombre: "a.png", ruta: "/tmp/a.png" }]);
  assert.equal(r.x.texto, "mirá esto");
  assert.equal(r.soloAdjunto, undefined, "sin texto ni adjuntos que existan no queda nada");
});

test("un archivo roto, de otra versión o ausente da una foto vacía, sin error", () => {
  const vacia = { version: 1, borradores: {} };
  assert.deepEqual(leerFoto(null), vacia);
  assert.deepEqual(leerFoto("{no es json"), vacia);
  assert.deepEqual(leerFoto(JSON.stringify({ version: 9, borradores: { x: { texto: "a", ts: 1 } } })), vacia);
  assert.deepEqual(leerFoto(JSON.stringify({ version: 1, borradores: { x: 7, y: { texto: 3 } } })), vacia);
});

test("el adjunto de verdad: existe, o no, en el disco", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "trama-borr-"));
  try {
    const ruta = path.join(dir, "uno.txt");
    writeFileSync(ruta, "hola");
    const json = JSON.stringify({ version: 1, borradores: { x: { texto: "t", archivos: [{ nombre: "uno.txt", ruta }, { nombre: "dos.txt", ruta: path.join(dir, "dos.txt") }, { nombre: "dir", ruta: dir }], ts: 1 } } });
    assert.deepEqual(leerFoto(json).borradores.x.archivos, [{ nombre: "uno.txt", ruta }], "un archivo que existe sí, uno perdido o una carpeta no");
    rmSync(ruta);
    assert.equal(leerFoto(json).borradores.x.archivos, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("armar: claves absurdas y entradas que no son un objeto no rompen", () => {
  assert.deepEqual(armar(null, {}, 1).borradores, {});
  assert.deepEqual(armar([1, 2], {}, 1).borradores, {});
  assert.deepEqual(armar({ ["k".repeat(300)]: { texto: "a" } }, {}, 1).borradores, {});
});
