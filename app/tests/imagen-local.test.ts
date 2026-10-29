// Las imágenes que un líder muestra en su texto (`![](ruta)`, una ruta suelta) y las que devuelve una herramienta:
// qué rutas valen (Windows y Linux), la lectura segura del archivo, el markdown y el bloque base64 del transcript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nombreDe, rutaImagen, rutaWsl, tipoPorBytes } from "../electron/imagen-ruta.ts";
import { candidatas, IMAGEN_LOCAL_MAX, leerImagenLocal } from "../electron/imagen-local.ts";
import { imagenDe } from "../electron/imagenes.ts";
import { conversacionDe, parsearLinea } from "../electron/lider-arma.ts";
import { trozos } from "../src/hilo/markdown.ts";
import { turnos } from "../src/hilo/turnos.ts";
import type { Mensaje } from "../src/datos/contrato.ts";

// Un PNG de 1×1 (inventado, público).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("rutaImagen: rutas absolutas de Windows y de Linux, con comillas, <> o file://", () => {
  assert.deepEqual(rutaImagen("C:\\Users\\ana\\Pictures\\captura 1.png"), { estilo: "win32", ruta: "C:\\Users\\ana\\Pictures\\captura 1.png" });
  assert.deepEqual(rutaImagen("d:/fotos/x.JPG"), { estilo: "win32", ruta: "d:/fotos/x.JPG" });
  assert.deepEqual(rutaImagen("/tmp/trama/x.webp"), { estilo: "posix", ruta: "/tmp/trama/x.webp" });
  assert.deepEqual(rutaImagen('"C:\\Program Files (x86)\\a.gif"'), { estilo: "win32", ruta: "C:\\Program Files (x86)\\a.gif" });
  assert.deepEqual(rutaImagen("<C:\\a b\\c.bmp>"), { estilo: "win32", ruta: "C:\\a b\\c.bmp" });
  assert.deepEqual(rutaImagen("file:///C:/Users/ana/a%20b.png"), { estilo: "win32", ruta: "C:/Users/ana/a b.png" });
  assert.deepEqual(rutaImagen("file:///home/ana/x.png"), { estilo: "posix", ruta: "/home/ana/x.png" });
  assert.deepEqual(rutaImagen("file://localhost/home/ana/x.png"), { estilo: "posix", ruta: "/home/ana/x.png" });
});

test("rutaImagen: nada que no sea la ruta absoluta de una imagen", () => {
  for (const x of [
    "captura.png", // relativa
    "./captura.png",
    "~/x.png",
    "\\\\servidor\\recurso\\x.png", // carpeta de red de Windows
    "//servidor/recurso/x.png",
    "file://servidor/recurso/x.png",
    "https://example.com/x.png",
    "/tmp/../etc/x.png", // sube de nivel
    "C:\\a\\..\\b\\x.png",
    "/etc/passwd", // no es una imagen
    "/tmp/notas.txt",
    "/tmp/dibujo.svg",
    "/tmp/sinextension",
    "/tmp/x.png\u0000.txt",
    "",
    "/" + "a".repeat(2000) + ".png",
    42,
    null,
    undefined,
    { ruta: "/tmp/x.png" },
  ])
    assert.equal(rutaImagen(x), null, String(x).slice(0, 40));
});

test("nombreDe, rutaWsl y tipoPorBytes", () => {
  assert.equal(nombreDe("C:\\Users\\ana\\Pictures\\captura 1.png"), "captura 1.png");
  assert.equal(nombreDe("/tmp/trama/x.png"), "x.png");
  assert.equal(rutaWsl("C:\\Users\\ana\\x.png"), "/mnt/c/Users/ana/x.png");
  assert.equal(tipoPorBytes(Buffer.from(PNG, "base64")), "image/png");
  assert.equal(tipoPorBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(tipoPorBytes(Buffer.from("GIF89a")), "image/gif");
  assert.equal(tipoPorBytes(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(tipoPorBytes(Buffer.from("<svg><script>alert(1)</script></svg>")), null);
  assert.equal(tipoPorBytes(Buffer.from("hola")), null);
});

test("candidatas: una ruta de Windows sólo se lee en Windows (o por /mnt en WSL), una de Linux no en Windows", () => {
  assert.deepEqual(candidatas("C:\\Users\\ana\\x.png", "win32"), ["C:\\Users\\ana\\x.png"]);
  assert.deepEqual(candidatas("C:\\Users\\ana\\x.png", "linux"), ["/mnt/c/Users/ana/x.png"]);
  assert.deepEqual(candidatas("C:\\Users\\ana\\x.png", "darwin"), []);
  assert.deepEqual(candidatas("/tmp/x.png", "linux"), ["/tmp/x.png"]);
  assert.deepEqual(candidatas("/tmp/x.png", "win32"), []);
  assert.deepEqual(candidatas("captura.png", "linux"), []);
});

test("leerImagenLocal: una imagen de verdad se lee; lo demás es null y nunca lanza", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-imagen-local-"));
  try {
    const ok = path.join(tmp, "captura 1.png");
    writeFileSync(ok, Buffer.from(PNG, "base64"));
    assert.deepEqual(await leerImagenLocal(ok, "linux"), { tipo: "image/png", datos: PNG });
    // El tipo sale de los bytes, no de la extensión.
    const jpg = path.join(tmp, "foto.png");
    writeFileSync(jpg, Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]));
    assert.equal((await leerImagenLocal(jpg, "linux"))?.tipo, "image/jpeg");
    // Con extensión de imagen pero no es una imagen (un secreto, un SVG con script).
    const falsa = path.join(tmp, "falsa.png");
    writeFileSync(falsa, "API_KEY=inventada\n");
    assert.equal(await leerImagenLocal(falsa, "linux"), null);
    const enlace = path.join(tmp, "enlace.png");
    writeFileSync(path.join(tmp, "secreto.txt"), "inventado");
    symlinkSync(path.join(tmp, "secreto.txt"), enlace);
    assert.equal(await leerImagenLocal(enlace, "linux"), null);
    // No existe, es una carpeta, pesa de más, no es absoluta, es de Windows en un Linux sin /mnt/c.
    assert.equal(await leerImagenLocal(path.join(tmp, "falta.png"), "linux"), null);
    mkdirSync(path.join(tmp, "carpeta.png"));
    assert.equal(await leerImagenLocal(path.join(tmp, "carpeta.png"), "linux"), null);
    const grande = path.join(tmp, "grande.png");
    writeFileSync(grande, Buffer.from(PNG, "base64"));
    truncateSync(grande, IMAGEN_LOCAL_MAX + 1);
    assert.equal(await leerImagenLocal(grande, "linux"), null);
    assert.equal(await leerImagenLocal("captura.png", "linux"), null);
    assert.equal(await leerImagenLocal("Z:\\no\\esta\\x.png", "linux"), null);
    assert.equal(await leerImagenLocal(ok, "win32"), null); // una ruta de Linux no se lee en Windows
    assert.equal(await leerImagenLocal(42, "linux"), null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("imagenDe: lo que llega por IPC se valida", () => {
  assert.deepEqual(imagenDe({ tipo: "image/png", datos: PNG }), { tipo: "image/png", datos: PNG });
  for (const x of [null, undefined, "x", {}, { tipo: "text/html", datos: PNG }, { tipo: "image/png", datos: "" }, { tipo: "image/png", datos: 3 }]) assert.equal(imagenDe(x), null);
});

test("markdown: `![alt](ruta)` es una imagen, con rutas de Windows, espacios y paréntesis", () => {
  assert.deepEqual(trozos("mirá ![captura](C:\\Users\\ana\\Pictures\\x.png) listo"), [
    { tipo: "texto", texto: "mirá " },
    { tipo: "img", texto: "captura", url: "C:\\Users\\ana\\Pictures\\x.png" },
    { tipo: "texto", texto: " listo" },
  ]);
  assert.deepEqual(trozos("![](C:\\Program Files (x86)\\Trama\\a b.png)"), [{ tipo: "img", texto: "", url: "C:\\Program Files (x86)\\Trama\\a b.png" }]);
  assert.deepEqual(trozos("![](<C:\\a (1)\\b.png>)"), [{ tipo: "img", texto: "", url: "C:\\a (1)\\b.png" }]);
  assert.deepEqual(trozos("![](/tmp/x.png) y ![otra](file:///home/ana/y.jpg)"), [
    { tipo: "img", texto: "", url: "/tmp/x.png" },
    { tipo: "texto", texto: " y " },
    { tipo: "img", texto: "otra", url: "file:///home/ana/y.jpg" },
  ]);
  // Los enlaces de siempre siguen igual, y adentro de un enlace una imagen es su texto.
  assert.deepEqual(trozos("[doc](https://example.com/a)"), [{ tipo: "link", texto: "doc", url: "https://example.com/a" }]);
  assert.deepEqual(trozos("![a](/tmp/x.png)", { enlaces: false }), [{ tipo: "texto", texto: "a" }]);
});

test("transcript: el bloque image de un tool_result llega con su herramienta (y nada de imágenes sueltas en el mensaje)", () => {
  const linea = (o: object) => JSON.stringify(o);
  const t = [
    linea({ type: "user", uuid: "u1", timestamp: "2026-10-04T10:00:00Z", message: { role: "user", content: "mirá la captura" } }),
    linea({
      type: "assistant",
      uuid: "a1",
      parentUuid: "u1",
      timestamp: "2026-10-04T10:00:05Z",
      message: { id: "m1", model: "claude-opus-5-5", role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "Read", input: { file_path: "C:\\Users\\ana\\x.png" } }] },
    }),
    linea({
      type: "user",
      uuid: "u2",
      parentUuid: "a1",
      timestamp: "2026-10-04T10:00:06Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }, { type: "text", text: "listo" }] }],
      },
    }),
  ].join("\n");
  const r = conversacionDe("s", "/t.jsonl", t);
  assert.equal(r.total, 2);
  assert.deepEqual(r.mensajes[1].det?.[0].resultado, { texto: "listo", error: false, imagenes: [{ tipo: "image/png", datos: PNG }] });
  assert.equal(r.mensajes[1].imagenes, undefined);
  // Se llega a la vista: el turno trae el uso con su resultado.
  const items = turnos(r.mensajes as Mensaje[]);
  assert.ok(JSON.stringify(items).includes(PNG));
});

test("stream: el tool_result con una imagen se cuenta al vuelo; uno de sólo texto no trae `imagenes`", () => {
  const res = (content: unknown) => parsearLinea(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content }] } }));
  assert.deepEqual(res([{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: PNG } }]), [
    { tipo: "resultado", id: "tu1", texto: "", error: false, imagenes: [{ tipo: "image/jpeg", datos: PNG }] },
  ]);
  assert.deepEqual(res("hecho"), [{ tipo: "resultado", id: "tu1", texto: "hecho", error: false }]);
  // Un tipo raro o un bloque que no es base64 se descarta; hay un tope de imágenes por resultado.
  assert.deepEqual(res([{ type: "image", source: { type: "url", url: "https://x" } }]), [{ tipo: "resultado", id: "tu1", texto: "", error: false }]);
  const seis = Array.from({ length: 6 }, () => ({ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }));
  const [e] = res(seis);
  assert.equal(e.tipo === "resultado" ? e.imagenes?.length : -1, 4);
});
