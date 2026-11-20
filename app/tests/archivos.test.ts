// Archivos que no son imágenes a un líder: validación y guardado en el main
// (electron/archivos.ts) y el texto que lleva sus rutas (src/hilo/adjuntos.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archivoDe, guardarArchivo, nombreSeguro } from "../electron/archivos.ts";
import { ARCHIVO_MAX } from "../electron/imagenes.ts";
import { PREFIJOS_ADJUNTO, separarAdjuntos } from "../electron/adjunto.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});
const { crearImagenesGuardadas } = await import("../src/hilo/imagenes-guardadas.ts");
const { agregarAdjuntos, archivosDe, fotoImagenes, imagenesDe, imagenesSinGuardar, leerAdjuntos, quitarAdjunto, vaciarAdjuntos, prepararAdjunto, textoConArchivos } = await import("../src/hilo/adjuntos.ts");

const clave = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return String((e as Error).message).split("\u0001")[1];
  }
  return null;
};

test("nombreSeguro: sin carpetas, sin controles, sin punto inicial", () => {
  assert.equal(nombreSeguro("notas.md"), "notas.md");
  assert.equal(nombreSeguro("../../etc/passwd"), "passwd");
  assert.equal(nombreSeguro("a\\b\\c.txt"), "c.txt");
  assert.equal(nombreSeguro("..oculto"), "oculto");
  assert.equal(nombreSeguro("x\u0000y.pdf"), "xy.pdf");
  assert.equal(nombreSeguro(""), "archivo");
  assert.equal(nombreSeguro(".."), "archivo");
});

test("archivoDe: bytes y tope de tamaño", () => {
  assert.equal(clave(() => archivoDe({ nombre: "a.md", datos: "hola" })), "i18n:main.archivoRaro");
  assert.equal(clave(() => archivoDe(null)), "i18n:main.archivoRaro");
  assert.equal(clave(() => archivoDe({ nombre: "a.bin", datos: new Uint8Array(ARCHIVO_MAX + 1) })), "i18n:main.archivoGrande");
  assert.equal(archivoDe({ nombre: "a.md", datos: new Uint8Array(3) }).nombre, "a.md");
});

test("guardarArchivo: lo deja con su nombre en una carpeta propia y devuelve la ruta absoluta", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hilos-adjuntos-"));
  const datos = new TextEncoder().encode("# hola\n");
  const a = await guardarArchivo(dir, { nombre: "notas.md", datos });
  const b = await guardarArchivo(dir, { nombre: "notas.md", datos });
  assert.ok(path.isAbsolute(a));
  assert.equal(path.basename(a), "notas.md");
  assert.notEqual(a, b);
  assert.ok(a.startsWith(dir + path.sep));
  assert.equal(await readFile(a, "utf8"), "# hola\n");
});

test("caja: las imágenes van como imágenes, el resto como rutas al final del texto", async () => {
  const img = { tipo: "image/png", datos: "AAAA" };
  const md = { nombre: "notas.md", ruta: "/tmp/x/notas.md" };
  assert.equal(agregarAdjuntos("t", [img, md, { nombre: "b.pdf", ruta: "/tmp/y/b.pdf" }]), 0);
  const l = leerAdjuntos("t");
  assert.deepEqual(imagenesDe(l), [img]);
  assert.deepEqual(archivosDe(l).map((a) => a.ruta), ["/tmp/x/notas.md", "/tmp/y/b.pdf"]);
  const linea = (r: string) => `> ${r}`;
  assert.equal(textoConArchivos("hola", archivosDe(l), linea), "hola\n\n> /tmp/x/notas.md\n> /tmp/y/b.pdf");
  assert.equal(textoConArchivos("", [md], linea), "> /tmp/x/notas.md");
  assert.equal(textoConArchivos("hola", [], linea), "hola");

  // Un .md (o un SVG, que la API no toma como imagen) lo guarda `guardar`; uno de más de 25 MB, no.
  const guardados: string[] = [];
  const guardar = async (n: string) => (guardados.push(n), `/tmp/z/${n}`);
  const f = (nombre: string, tipo: string, size = 4) => ({ name: nombre, type: tipo, size, arrayBuffer: async () => new ArrayBuffer(size) }) as unknown as File;
  assert.deepEqual(await prepararAdjunto(f("leeme.md", "text/markdown"), guardar), { nombre: "leeme.md", ruta: "/tmp/z/leeme.md" });
  assert.deepEqual(await prepararAdjunto(f("logo.svg", "image/svg+xml"), guardar), { nombre: "logo.svg", ruta: "/tmp/z/logo.svg" });
  await assert.rejects(prepararAdjunto(f("enorme.bin", "", ARCHIVO_MAX + 1), guardar), (e: { grande?: string }) => e.grande === "enorme.bin");
  assert.deepEqual(guardados, ["leeme.md", "logo.svg"]);
});

test("las líneas de archivo de los diccionarios son las que reconoce separarAdjuntos", () => {
  for (const d of [en, es]) {
    const l = d["adjunto.linea"];
    assert.ok(l.endsWith("{ruta}") && (PREFIJOS_ADJUNTO as readonly string[]).includes(l.slice(0, -"{ruta}".length)), l);
  }
});

test("separarAdjuntos: el globo muestra el texto sin las rutas, y los archivos aparte", () => {
  const [en0, es0] = PREFIJOS_ADJUNTO;
  const md = { nombre: "diagnostico-sistema.md", ruta: "/home/ana/.local/state/hilos/adjuntos/1a2b/diagnostico-sistema.md" };
  const pdf = { nombre: "b.pdf", ruta: "/tmp/y/b.pdf" };
  // Ida y vuelta con lo que arma la caja, en los dos idiomas.
  for (const p of PREFIJOS_ADJUNTO) {
    const linea = (r: string) => p + r;
    assert.deepEqual(separarAdjuntos(textoConArchivos("hola\n\nchau", [md, pdf], linea)), { texto: "hola\n\nchau", archivos: [md, pdf] });
    assert.deepEqual(separarAdjuntos(textoConArchivos("", [md], linea)), { texto: "", archivos: [md] });
  }
  // Mezclados (un transcript de antes de cambiar el idioma).
  assert.deepEqual(separarAdjuntos(`mirá\n\n${en0}${md.ruta}\n${es0}${pdf.ruta}`).archivos, [md, pdf]);
  // Sin archivos, o una línea así en el medio del texto: el texto queda igual.
  assert.deepEqual(separarAdjuntos("hola  \n"), { texto: "hola  \n", archivos: [] });
  const medio = `${es0}${md.ruta}\nesto es lo que dice`;
  assert.deepEqual(separarAdjuntos(medio), { texto: medio, archivos: [] });
  // Sin ruta absoluta no es una línea de archivo.
  assert.deepEqual(separarAdjuntos(`${en0}notas.md`).archivos, []);
});

test("limpiarAdjuntos: borra las carpetas viejas y deja las nuevas", async () => {
  const { mkdtempSync, mkdirSync, existsSync, utimesSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const pathM = await import("node:path");
  const { limpiarAdjuntos } = await import("../electron/archivos.ts");
  const dir = mkdtempSync(pathM.join(tmpdir(), "adjuntos-"));
  mkdirSync(pathM.join(dir, "viejo"));
  mkdirSync(pathM.join(dir, "nuevo"));
  const hace10d = new Date(Date.now() - 10 * 24 * 3600_000);
  utimesSync(pathM.join(dir, "viejo"), hace10d, hace10d);
  assert.equal(await limpiarAdjuntos(dir), 1);
  assert.equal(existsSync(pathM.join(dir, "viejo")), false);
  assert.equal(existsSync(pathM.join(dir, "nuevo")), true);
  assert.equal(await limpiarAdjuntos(pathM.join(dir, "no-existe")), 0);
});

test("imágenes pegadas: la foto de guardado las acota, avisa las que sobran y mandar/× las saca", () => {
  const img = { tipo: "image/png", datos: "QUJD".repeat(10) };
  vaciarAdjuntos("g");
  agregarAdjuntos("g", [img, img]);
  assert.equal(fotoImagenes().g.length, 2);
  assert.equal(imagenesSinGuardar(leerAdjuntos("g")), 0);
  agregarAdjuntos("g", [img, img, img, img]); // 6 en la caja: se guardan 4
  assert.equal(fotoImagenes().g.length, 4);
  assert.equal(imagenesSinGuardar(leerAdjuntos("g")), 2);
  quitarAdjunto("g", leerAdjuntos("g")[0].id);
  assert.equal(imagenesSinGuardar(leerAdjuntos("g")), 1);
  vaciarAdjuntos("g"); // al mandar
  assert.equal(fotoImagenes().g, undefined);
});

test("imágenes guardadas: cada imagen se sube una sola vez, las fotos llevan sólo la referencia y lo que sale de la caja se olvida", async () => {
  const subidas: string[] = [];
  let avisos = 0;
  const g = crearImagenesGuardadas(async (_t, d) => (subidas.push(d), `h${subidas.length}`), () => void avisos++);
  const a = { tipo: "image/png", datos: "QUJD".repeat(10) };
  const b = { tipo: "image/jpeg", datos: "QUJE".repeat(10) };
  assert.deepEqual(g.refs({ x: [a, b] }), {}, "todavía no subieron: esta foto no las lleva");
  g.refs({ x: [a, b] }); // otro cambio mientras suben: no se suben de nuevo
  await new Promise((r) => setImmediate(r));
  assert.equal(subidas.length, 2);
  assert.equal(avisos, 2);
  assert.deepEqual(g.refs({ x: [a, b], y: [a] }), {
    x: [{ tipo: "image/png", hash: "h1", largo: 40 }, { tipo: "image/jpeg", hash: "h2", largo: 40 }],
    y: [{ tipo: "image/png", hash: "h1", largo: 40 }],
  });
  for (let i = 0; i < 5; i++) g.refs({ x: [a, b] }); // teclear: ninguna subida más
  assert.equal(subidas.length, 2);
  g.conocida("QUJF".repeat(3), "hz"); // lo que dejó el main al abrir
  assert.deepEqual(g.refs({ z: [{ tipo: "image/png", datos: "QUJF".repeat(3) }] }), { z: [{ tipo: "image/png", hash: "hz", largo: 12 }] });
  assert.equal(subidas.length, 2, "una restaurada no se vuelve a subir");
  g.refs({}); // mandó el mensaje: se olvidan
  g.refs({ x: [a] }); // un envío que falló la devuelve a la caja: el main ya la borró, se sube otra vez
  await new Promise((r) => setImmediate(r));
  assert.equal(subidas.length, 3);
});

test("imágenes guardadas: si subir falla no se rompe y se reintenta con el próximo cambio", async () => {
  let falla = true;
  let n = 0;
  const g = crearImagenesGuardadas(async () => (n++, falla ? Promise.reject(new Error("x")) : "h"), () => {});
  const a = { tipo: "image/png", datos: "QUJD" };
  g.refs({ x: [a] });
  await new Promise((r) => setImmediate(r));
  falla = false;
  assert.deepEqual(g.refs({ x: [a] }), {});
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(g.refs({ x: [a] }), { x: [{ tipo: "image/png", hash: "h", largo: 4 }] });
  assert.equal(n, 2);
});
