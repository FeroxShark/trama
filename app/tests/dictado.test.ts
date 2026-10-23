// Dictar (docs/estado/dictado.md): el WAV del cliente (src/hilo/dictado.ts) y la transcripción del motor
// (electron/dictado.ts) con un `handy` falso (`ejecutar`): nunca el de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { codificarWav, agregarDictado, reloj, soporte, TOPE_S } from "../src/hilo/dictado.ts";
import { DICTADO_MAX_S, WAV_MAX, entornoGrafico, textoDe, transcribir, wavDe, type Ejecutar } from "../electron/dictado.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-dictado-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const dir = path.join(tmp, "trama");
const wav = (n = 1600) => codificarWav(new Float32Array(n).fill(0.25));
const sinSobras = () => assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);

test("codificarWav: cabecera PCM de 16 bits, mono, 16 kHz, con sus muestras", () => {
  const w = codificarWav(Float32Array.from([0, 1, -1, 2, -2]));
  const v = new DataView(w.buffer);
  assert.equal(w.length, 44 + 10);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), "RIFF");
  assert.equal(v.getUint32(4, true), 36 + 10);
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(28, true), 32000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 10);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true)), [0, 32767, -32768, 32767, -32768]);
});

test("el tope del cliente y el del motor son los mismos", () => {
  assert.equal(TOPE_S, DICTADO_MAX_S);
});

test("wavDe: acepta el WAV del cliente y rechaza lo raro", () => {
  const w = wav();
  assert.equal(wavDe({ datos: w }), w);
  for (const malo of [null, {}, { datos: "x" }, { datos: new Uint8Array(10) }, { datos: new Uint8Array(100) }]) assert.throws(() => wavDe(malo), /dictadoRaro/);
  const otroHz = wav();
  new DataView(otroHz.buffer).setUint32(24, 44100, true);
  assert.throws(() => wavDe({ datos: otroHz }), /dictadoRaro/);
  assert.throws(() => wavDe({ datos: new Uint8Array(WAV_MAX + 1) }), /dictadoLargo/);
});

test("textoDe: texto plano, renglones sueltos y JSON", () => {
  assert.equal(textoDe("  hola mundo \n"), "hola mundo");
  assert.equal(textoDe("hola\n\n  qué tal \n"), "hola qué tal");
  assert.equal(textoDe('{"text": " hola "}'), "hola");
  assert.equal(textoDe("{no es json\nsigue"), "{no es json sigue");
  assert.equal(textoDe("\n \n"), "");
});

test("agregarDictado: se agrega al final con un espacio", () => {
  assert.equal(agregarDictado("", "hola"), "hola");
  assert.equal(agregarDictado("hola", " mundo "), "hola mundo");
  assert.equal(agregarDictado("hola ", "mundo"), "hola mundo");
  assert.equal(agregarDictado("hola\n", "mundo"), "hola\nmundo");
  assert.equal(agregarDictado("hola", "  "), "hola");
});

test("reloj y soporte", () => {
  assert.deepEqual([0, 7, 65, 299].map(reloj), ["0:00", "0:07", "1:05", "4:59"]);
  assert.equal(soporte({ isSecureContext: false, navigator: { mediaDevices: { getUserMedia() {} } }, MediaRecorder() {} } as never), "inseguro");
  assert.equal(soporte({ isSecureContext: true, navigator: {}, MediaRecorder() {} } as never), "sin");
  assert.equal(soporte({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } } } as never), "sin");
  assert.equal(soporte({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } }, MediaRecorder() {} } as never), "si");
});

test("transcribir: pasa el WAV por --transcribe-file, devuelve el texto y borra el archivo", async () => {
  let visto: { bin: string; args: string[]; timeout: number; bytes: number } | null = null;
  const ejecutar: Ejecutar = async (bin, args, o) => {
    visto = { bin, args, timeout: o.timeout, bytes: (await readFile(args[1])).length };
    assert.ok(args[1].startsWith(dir + path.sep));
    return " hola mundo\n";
  };
  const w = wav(3200);
  assert.equal(await transcribir({ datos: w }, { dir, bin: "handy-falso", ejecutar }), "hola mundo");
  assert.ok(visto);
  const v = visto as { bin: string; args: string[]; timeout: number; bytes: number };
  assert.equal(v.bin, "handy-falso");
  assert.equal(v.args[0], "--transcribe-file");
  assert.ok(!v.args.includes("--model"));
  assert.equal(v.bytes, w.length);
  assert.equal(v.timeout, 120_000);
  sinSobras();
});

test("transcribir: handy que falta, que falla, que tarda o que no dice nada → mensaje con clave, y el archivo se borra", async () => {
  const caso = async (ejecutar: Ejecutar, re: RegExp, timeoutMs?: number) => {
    await assert.rejects(transcribir({ datos: wav() }, { dir, ejecutar, timeoutMs }), re);
    sinSobras();
  };
  await caso(async () => Promise.reject(Object.assign(new Error("spawn handy ENOENT"), { code: "ENOENT" })), /dictadoFalta/);
  await caso(async () => Promise.reject(Object.assign(new Error("Command failed"), { stderr: "modelo roto" })), /dictadoFalla.*modelo roto/);
  await caso(async () => Promise.reject(Object.assign(new Error("killed"), { killed: true, signal: "SIGKILL" })), /dictadoTiempo.*"?5"?/, 5000);
  await caso(async () => "  \n", /dictadoVacio/);
});

test("transcribir: de a una, en el orden en que llegan", async () => {
  const orden: string[] = [];
  let libre!: () => void;
  const primera: Ejecutar = () => new Promise((ok) => (libre = () => (orden.push("a-fin"), ok("a"))));
  const segunda: Ejecutar = async () => (orden.push("b"), "b");
  const a = transcribir({ datos: wav() }, { dir, ejecutar: primera });
  const b = transcribir({ datos: wav() }, { dir, ejecutar: segunda });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(orden, []);
  libre();
  assert.deepEqual(await Promise.all([a, b]), ["a", "b"]);
  assert.deepEqual(orden, ["a-fin", "b"]);
  sinSobras();
});

test("entornoGrafico: completa la pantalla que le falta al motor de systemd (Handy abre GTK aunque sea headless)", () => {
  const run = path.join(tmp, "run");
  const x11 = path.join(tmp, "x11");
  mkdirSync(run, { recursive: true });
  mkdirSync(x11, { recursive: true });
  writeFileSync(path.join(run, "wayland-1"), "");
  writeFileSync(path.join(run, "wayland-1.lock"), "");
  writeFileSync(path.join(x11, "X1"), "");
  writeFileSync(path.join(x11, "X1_"), "");
  assert.equal(entornoGrafico({ XDG_RUNTIME_DIR: run }, 1000, x11).WAYLAND_DISPLAY, "wayland-1");
  assert.equal(entornoGrafico({ XDG_RUNTIME_DIR: run }, 1000, x11).DISPLAY, undefined);
  assert.equal(entornoGrafico({ XDG_RUNTIME_DIR: path.join(tmp, "nada") }, 1000, x11).DISPLAY, ":1");
  // lo que ya trae el entorno no se pisa
  const dado = entornoGrafico({ XDG_RUNTIME_DIR: run, WAYLAND_DISPLAY: "wayland-9" }, 1000, x11);
  assert.equal(dado.WAYLAND_DISPLAY, "wayland-9");
  assert.equal(entornoGrafico({}, 4242, x11).XDG_RUNTIME_DIR, "/run/user/4242");
});
