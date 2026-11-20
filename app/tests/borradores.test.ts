// Lo escrito sin mandar, en disco (electron/borradores.ts): sobrevive a un reinicio, se acota y suelta los
// adjuntos cuyo archivo ya no está. Con el disco de mentira (una variable) y nunca el estado de Ana.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { almacenBorradores, armar, BORRADOR_MAX, BORRADORES_MAX, discoImagenesFs, GRACIA_IMAGEN_MS, type ImagenRef, leerFoto, recortar } from "../electron/borradores.ts";
import { acotarImagenes, BASE64_MAX, BORRADOR_IMAGENES_BASE64, BORRADOR_IMAGENES_MAX } from "../electron/imagenes.ts";

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

// --- Imágenes pegadas (tablero 2117): cada una en su archivo por hash, el JSON sólo guarda la referencia ---

/** Una carpeta de imágenes de mentira (nombre → bytes) que cuenta las escrituras. */
function carpeta() {
  const archivos = new Map<string, Buffer>();
  const c = {
    archivos,
    escrituras: 0,
    escribir: async (n: string, b: Buffer) => void (c.escrituras++, archivos.set(n, b)),
    leer: async (n: string) => archivos.get(n) ?? null,
    listar: async () => [...archivos.keys()],
    borrar: async (n: string) => void archivos.delete(n),
  };
  return c;
}
function discoImg() {
  const img = carpeta();
  const d = { json: null as string | null, escrituras: 0, t: 1000 };
  const abrir = () =>
    almacenBorradores(
      async () => d.json,
      async (j) => void ((d.json = j), d.escrituras++),
      { ahora: () => d.t, imagenes: img },
    );
  return { img, d, abrir };
}
const datosDe = (n: number, relleno = "QUJD") => relleno.repeat(n); // base64 válido, 4 caracteres por unidad
/** Sube una imagen como lo hace la ventana y arma su referencia. */
async function subir(a: ReturnType<typeof almacenBorradores>, tipo: string, datos: string): Promise<ImagenRef> {
  return { tipo, hash: await a.guardarImagen(tipo, datos), largo: datos.length };
}

test("las imágenes pegadas sobreviven a un reinicio (cada una en su archivo) y mandar el mensaje las borra", async () => {
  const { img, d, abrir } = discoImg();
  const a = abrir();
  const r1 = await subir(a, "image/png", datosDe(10));
  const r2 = await subir(a, "image/jpeg", "QUJDRA==");
  assert.match(r1.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual([...img.archivos.keys()].sort(), [`${r1.hash}.png`, `${r2.hash}.jpg`].sort());
  await a.guardar({ "lider:s1": { texto: "", imagenes: [r1, r2] } });
  assert.ok(!d.json!.includes("QUJD"), "el JSON no lleva los datos de la imagen");
  const b = (await abrir().leer()).borradores["lider:s1"]; // "relanzar": otra trama, mismo disco
  assert.deepEqual(b.imagenes?.map((i) => [i.tipo, i.datos]), [["image/png", datosDe(10)], ["image/jpeg", "QUJDRA=="]]);
  await a.guardar({ "lider:s1": { texto: "", imagenes: [r2] } }); // sacó una con ×: su archivo se va
  assert.deepEqual([...img.archivos.keys()], [`${r2.hash}.jpg`]);
  await a.guardar({}); // lo mandó: se va el otro
  assert.equal(img.archivos.size, 0);
  assert.deepEqual((await abrir().leer()).borradores, {});
});

test("escribir texto no reescribe las imágenes: sólo el JSON de referencias", async () => {
  const { img, d, abrir } = discoImg();
  const a = abrir();
  const r = await subir(a, "image/png", datosDe(200_000)); // ~800 KB de base64
  assert.equal(img.escrituras, 1);
  await a.guardar({ x: { texto: "h", imagenes: [r] } });
  const tam = d.json!.length;
  for (const t of ["ho", "hol", "hola", "hola mundo"]) await a.guardar({ x: { texto: t, imagenes: [r] } });
  assert.equal(img.escrituras, 1, "las imágenes no se escribieron de nuevo");
  assert.ok(tam < 1000 && d.json!.length < 1000, "el JSON queda chico");
  await a.guardarImagen("image/png", datosDe(200_000)); // la misma imagen otra vez: mismo archivo, sin escribir
  assert.equal(img.escrituras, 1);
  assert.equal(img.archivos.size, 1);
});

test("una referencia a un archivo que falta se descarta sin romper (y el texto queda)", async () => {
  const { img, abrir } = discoImg();
  const a = abrir();
  const r1 = await subir(a, "image/png", datosDe(5));
  const r2 = await subir(a, "image/png", datosDe(6));
  await a.guardar({ x: { texto: "t", imagenes: [r1, r2] }, y: { texto: "", imagenes: [r1] } });
  img.archivos.delete(`${r1.hash}.png`); // se borró a mano
  const f = await abrir().leer();
  assert.deepEqual(f.borradores.x.imagenes?.map((i) => i.hash), [r2.hash]);
  assert.equal(f.borradores.x.texto, "t");
  assert.equal(f.borradores.y, undefined, "una caja que sólo tenía esa imagen ya no tiene nada");
  // referencias basura: hash malo, tipo raro, no-arreglo
  await a.guardar({ z: { texto: "t", imagenes: [{ tipo: "image/png", hash: "../../etc/passwd", largo: 4 }, { tipo: "text/html", hash: r2.hash, largo: 4 }, null, 3] }, w: { texto: "t", imagenes: "x" } });
  const g = (await abrir().leer()).borradores;
  assert.equal(g.z.imagenes, undefined);
  assert.equal(g.w.imagenes, undefined);
});

test("la limpieza no se lleva una imagen recién subida; pasada la gracia, sí", async () => {
  const { img, d, abrir } = discoImg();
  const a = abrir();
  const r = await subir(a, "image/png", datosDe(5));
  await a.guardar({ x: { texto: "escribiendo" } }); // la foto todavía no la lleva (subió justo antes)
  assert.equal(img.archivos.size, 1);
  d.t += GRACIA_IMAGEN_MS + 1;
  await a.guardar({ x: { texto: "escribiendo más" } });
  assert.equal(img.archivos.size, 0, `huérfana: ${r.hash}`);
});

test("al abrir se borran los archivos sueltos que ningún borrador referencia; lo que no es de las imágenes no se toca", async () => {
  const { img, abrir } = discoImg();
  const a = abrir();
  const r = await subir(a, "image/png", datosDe(5));
  await a.guardar({ x: { texto: "t", imagenes: [r] } });
  img.archivos.set("f".repeat(64) + ".png", Buffer.from("resto"));
  img.archivos.set("notas.txt", Buffer.from("mía"));
  await abrir().leer();
  assert.deepEqual([...img.archivos.keys()].sort(), ["notas.txt", `${r.hash}.png`].sort());
});

test("una imagen compartida por dos cajas sigue mientras una la use", async () => {
  const { img, abrir } = discoImg();
  const a = abrir();
  const r = await subir(a, "image/png", datosDe(5));
  await a.guardar({ a: { texto: "", imagenes: [r] }, b: { texto: "", imagenes: [r] } });
  await a.guardar({ b: { texto: "", imagenes: [r] } });
  assert.equal(img.archivos.size, 1);
  await a.guardar({});
  assert.equal(img.archivos.size, 0);
});

test("tope de imágenes por borrador: 4 y 8 MB; lo que pasa no se guarda y no rompe nada", async () => {
  assert.equal(BORRADOR_IMAGENES_MAX, 4);
  const { img, abrir } = discoImg();
  const a = abrir();
  const rs: ImagenRef[] = [];
  for (let i = 0; i < 6; i++) rs.push(await subir(a, "image/png", datosDe(10, "QUJD".replace("D", String.fromCharCode(65 + i)))));
  await a.guardar({ x: { texto: "t", imagenes: rs } });
  assert.equal((await abrir().leer()).borradores.x.imagenes?.length, 4);
  assert.equal(img.archivos.size, 4, "las dos que pasaron el tope ya no ocupan disco");
  const grande = await subir(a, "image/png", datosDe(BASE64_MAX / 4 - 10, "QUJE")); // ~5 MB: con la siguiente pasa los 8 MB
  const grande2 = await subir(a, "image/png", datosDe(BASE64_MAX / 4 - 10, "QUJF"));
  const chica = await subir(a, "image/png", "QUJG");
  await a.guardar({ y: { texto: "t", imagenes: [grande, grande2, chica] } });
  const y = (await abrir().leer()).borradores.y;
  assert.deepEqual(y.imagenes?.map((i) => i.hash), [grande.hash, chica.hash]); // la segunda no cabe; la chica sí
  assert.equal(acotarImagenes([{ datos: "x".repeat(BORRADOR_IMAGENES_BASE64) }, { datos: "x".repeat(BORRADOR_IMAGENES_BASE64) }]).sobran, 1);
});

test("tope total de imágenes: pasado, los borradores más viejos las pierden (y sus archivos) y conservan su texto", async () => {
  const { img, d, abrir } = discoImg();
  const a = abrir();
  const entrada: Record<string, unknown> = {};
  for (let i = 0; i < 7; i++) {
    d.t++;
    const r = await subir(a, "image/png", datosDe(1024 * 1024 - 10, "QUJ" + String.fromCharCode(65 + i))); // 7 × ~4 MB > 24 MB
    entrada[`c${i}`] = { texto: `t${i}`, imagenes: [r] };
    await a.guardar({ ...entrada });
  }
  const r = (await abrir().leer()).borradores;
  assert.equal(Object.values(r).filter((b) => b.imagenes).length, 6);
  assert.equal(Object.keys(r).length, 7, "ninguno pierde su texto");
  assert.equal(img.archivos.size, 6);
  assert.equal(r.c0.imagenes, undefined, "el más viejo es el que la pierde");
});

test("guardarImagen rechaza lo que no es una imagen en base64", async () => {
  const { abrir, img } = discoImg();
  const a = abrir();
  await assert.rejects(a.guardarImagen("text/html", "QUJD"));
  await assert.rejects(a.guardarImagen("image/png", "no es base64!"));
  await assert.rejects(a.guardarImagen("image/png", ""));
  await assert.rejects(a.guardarImagen(3, null));
  assert.equal(img.archivos.size, 0);
});

test("la carpeta de verdad: escribe, lista, lee y borra sólo sus archivos", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "borr-img-"));
  try {
    const a = almacenBorradores(async () => null, async () => {}, { imagenes: discoImagenesFs(path.join(dir, "borradores-img")) });
    const r = await subir(a, "image/png", datosDe(5));
    const nombre = `${r.hash}.png`;
    assert.deepEqual(await readdir(path.join(dir, "borradores-img")), [nombre]);
    assert.equal((await readFile(path.join(dir, "borradores-img", nombre))).toString("base64"), datosDe(5));
    await a.guardar({}); // sin referencia, pero recién subida: se protege
    assert.equal((await readdir(path.join(dir, "borradores-img"))).length, 1);
    const b = almacenBorradores(async () => null, async () => {}, { imagenes: discoImagenesFs(path.join(dir, "borradores-img")) });
    await b.leer(); // una trama nueva: lo suelto se limpia
    assert.deepEqual(await readdir(path.join(dir, "borradores-img")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("una foto sin imágenes guardada por una versión anterior se lee igual", () => {
  const f = leerFoto(JSON.stringify({ version: 1, borradores: { x: { texto: "hola", ts: 5 } } }));
  assert.deepEqual(f.borradores.x, { texto: "hola", ts: 5 });
});
