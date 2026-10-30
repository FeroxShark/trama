// Leer un archivo de la actividad de un worker para el visor (archivo-ver.ts) y abrirlo con la app del sistema
// (archivo-abrir.ts): imagen, PDF, texto, markdown, audio; lo que ya no está, lo que miente su extensión y los secretos son null.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { abrirArchivo } from "../electron/archivo-abrir.ts";
import { candidatasArchivo } from "../electron/archivo-candidatas.ts";
import { archivoVistoDe, abribleConSistema } from "../electron/archivo-ruta.ts";
import { esSecreto, leerArchivoVisto, TOPES_ARCHIVO } from "../electron/archivo-ver.ts";

// Un PNG de 1×1 (inventado, público).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const dir = mkdtempSync(path.join(os.tmpdir(), "trama-archivo-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const en = (n: string, contenido: Buffer | string) => {
  const r = path.join(dir, n);
  mkdirSync(path.dirname(r), { recursive: true });
  writeFileSync(r, contenido);
  return r;
};

test("leerArchivoVisto: una imagen, por sus bytes y no por su extensión", async () => {
  const v = await leerArchivoVisto(en("captura.png", PNG));
  assert.deepEqual(v, { tipo: "imagen", mime: "image/png", datos: PNG.toString("base64") });
  // Un .jpg que por dentro es PNG se sirve como PNG; un .png que no es imagen, no.
  assert.equal((await leerArchivoVisto(en("rara.jpg", PNG)))?.tipo === "imagen" && ((await leerArchivoVisto(en("rara.jpg", PNG))) as { mime: string }).mime, "image/png");
  assert.equal(await leerArchivoVisto(en("falsa.png", "esto no es una imagen")), null);
});

test("leerArchivoVisto: un SVG, un PDF y un audio", async () => {
  const svg = await leerArchivoVisto(en("logo.svg", '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'));
  assert.equal(svg?.tipo === "imagen" && svg.mime, "image/svg+xml");
  const pdf = await leerArchivoVisto(en("doc.pdf", "%PDF-1.4\n1 0 obj\n"));
  assert.equal(pdf?.tipo === "pdf" && pdf.mime, "application/pdf");
  assert.equal(await leerArchivoVisto(en("falso.pdf", "<html>no soy pdf</html>")), null);
  const mp3 = await leerArchivoVisto(en("pista.mp3", Buffer.from([0x49, 0x44, 0x33, 3, 0])));
  assert.equal(mp3?.tipo === "audio" && mp3.mime, "audio/mpeg");
});

test("leerArchivoVisto: texto y markdown, recortado al tope; un binario con extensión de texto no es texto", async () => {
  assert.deepEqual(await leerArchivoVisto(en("src/a.ts", "const a = 1;\n")), { tipo: "texto", texto: "const a = 1;\n", recortado: false });
  assert.deepEqual(await leerArchivoVisto(en("nota.md", "# hola\n")), { tipo: "markdown", texto: "# hola\n", recortado: false });
  const grande = await leerArchivoVisto(en("grande.log", "x".repeat(TOPES_ARCHIVO.texto + 10)));
  assert.equal(grande?.tipo === "texto" && grande.recortado, true);
  assert.equal(grande?.tipo === "texto" && grande.texto.length, TOPES_ARCHIVO.texto);
  assert.equal(await leerArchivoVisto(en("bin.txt", Buffer.from([0x61, 0, 0x62]))), null);
});

test("leerArchivoVisto: lo que no está, una carpeta, una ruta relativa o no mostrable es null (nunca lanza)", async () => {
  assert.equal(await leerArchivoVisto(path.join(dir, "ya-no-existe", "a.png")), null);
  assert.equal(await leerArchivoVisto(dir), null);
  assert.equal(await leerArchivoVisto("src/a.ts"), null);
  assert.equal(await leerArchivoVisto(en("lleno.zip", "PK")), null);
  assert.equal(await leerArchivoVisto(42), null);
  assert.equal(await leerArchivoVisto(path.join(dir, "..", "x.txt")), null);
});

test("candidatasArchivo: rutas de Windows sólo en Windows (o por /mnt en WSL); las de Linux no en Windows", () => {
  assert.deepEqual(candidatasArchivo("C:\\proy\\a.txt", "win32"), ["C:\\proy\\a.txt"]);
  assert.deepEqual(candidatasArchivo("C:\\proy\\a.txt", "linux"), ["/mnt/c/proy/a.txt"]);
  assert.deepEqual(candidatasArchivo("C:\\proy\\a.txt", "darwin"), []);
  assert.deepEqual(candidatasArchivo("/tmp/a.txt", "linux"), ["/tmp/a.txt"]);
  assert.deepEqual(candidatasArchivo("/tmp/a.txt", "win32"), []);
});

test("esSecreto: claves y credenciales no se muestran", () => {
  for (const r of ["/home/ana/.config/trama/claves.env", "/p/.env", "/p/.env.local", "/home/ana/.ssh/config", "C:\\Users\\ana\\.aws\\credentials", "/p/id_ed25519", "/p/server.pem", "/p/secrets.json"])
    assert.equal(esSecreto(r), true, r);
  for (const r of ["/p/src/entorno.ts", "/p/README.md", "C:\\p\\ambiente.txt"]) assert.equal(esSecreto(r), false, r);
});

test("leerArchivoVisto: un secreto es null aunque exista", async () => {
  assert.equal(await leerArchivoVisto(en("proy/.env", "TOKEN=inventado")), null);
  assert.equal(await leerArchivoVisto(en("home/.ssh/config", "Host x")), null);
});

test("abribleConSistema: documentos y medios sí; programas, scripts y texto no", () => {
  for (const r of ["/p/a.pdf", "C:\\p\\a.docx", "/p/a.xlsx", "/p/a.png", "/p/a.mp4", "/p/a.zip", "/p/a.md"]) assert.equal(abribleConSistema(r), true, r);
  for (const r of ["C:\\p\\setup.exe", "/p/run.sh", "C:\\p\\a.bat", "/p/a.py", "/p/a.docm", "/p/a.svg", "/p/a.desktop", "/p/sin-extension", "/p/a.ts"]) assert.equal(abribleConSistema(r), false, r);
});

test("abrirArchivo: abre un archivo que existe y es abrible; el resto, no", async () => {
  const abiertos: string[] = [];
  const abrir = async (r: string) => (abiertos.push(r), "");
  const pdf = en("abrir/doc.pdf", "%PDF-1.4");
  assert.equal(await abrirArchivo(pdf, abrir), true);
  assert.deepEqual(abiertos, [pdf]);
  assert.equal(await abrirArchivo(path.join(dir, "abrir", "no-esta.pdf"), abrir), false);
  assert.equal(await abrirArchivo(en("abrir/prog.sh", "echo"), abrir), false);
  assert.equal(await abrirArchivo(en("abrir/prog.exe", "MZ"), abrir), false);
  assert.equal(await abrirArchivo("relativa/doc.pdf", abrir), false);
  assert.equal(await abrirArchivo(path.join(dir, "abrir"), abrir), false);
  assert.equal(await abrirArchivo(pdf, async () => "no se pudo"), false);
  assert.equal(await abrirArchivo(pdf, async () => Promise.reject(new Error("x"))), false);
  assert.equal(abiertos.length, 1);
});

test("archivoVistoDe: lo que llega por IPC se valida", () => {
  assert.deepEqual(archivoVistoDe({ tipo: "texto", texto: "x", recortado: true }), { tipo: "texto", texto: "x", recortado: true });
  assert.deepEqual(archivoVistoDe({ tipo: "pdf", mime: "application/pdf", datos: "AAAA" }), { tipo: "pdf", mime: "application/pdf", datos: "AAAA" });
  assert.equal(archivoVistoDe({ tipo: "pdf", mime: "application/pdf", datos: "" }), null);
  assert.equal(archivoVistoDe({ tipo: "pdf", mime: "no es un mime", datos: "AAAA" }), null);
  assert.equal(archivoVistoDe({ tipo: "otro" }), null);
  assert.equal(archivoVistoDe(null), null);
});
