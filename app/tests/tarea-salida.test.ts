// La salida en vivo de una tarea de fondo (electron/tarea-salida.ts): sólo el FINAL del archivo, con tope de bytes, y sólo archivos de
// salida de tareas del harness (`<tmp>/claude-<uid>/<cwd>/<sid>/tasks/<id>.output`), con los enlaces resueltos antes de validar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, truncateSync, writeFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { colaDeBytes, esSalidaDeTarea, LINEAS_SALIDA, leerSalidaTarea, limpiarSalida, TOPE_SALIDA } from "../electron/tarea-salida.ts";

// Un temporal propio hace de `os.tmpdir()`: el harness escribiría en <tmp>/claude-1000/….
const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-salida-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
const tareas = path.join(tmp, "claude-1000", "-home-ana-proyecto", "sid-1", "tasks");
mkdirSync(tareas, { recursive: true });
const salida = (id: string, contenido: string | Buffer) => {
  const r = path.join(tareas, `${id}.output`);
  writeFileSync(r, contenido);
  return r;
};
const leer = (x: unknown) => leerSalidaTarea(x, process.platform, tmp);

test("lee el FINAL: las últimas líneas, con el tope de bytes y la línea cortada al principio descartada", async () => {
  const lineas = Array.from({ length: 20000 }, (_, i) => `linea ${String(i).padStart(5, "0")} con algo de relleno para pesar`);
  const r = await leer(salida("grande", lineas.join("\n") + "\n"));
  assert.ok(r);
  assert.equal(r.recortado, true);
  const salidas = r.texto.split("\n");
  assert.equal(salidas.at(-1), lineas.at(-1));
  assert.ok(Buffer.byteLength(r.texto) <= TOPE_SALIDA);
  assert.ok(salidas.length <= LINEAS_SALIDA);
  assert.ok(!r.texto.includes("linea 00000"));
  // Todas completas: la primera que queda es una línea entera, no un pedazo.
  for (const l of salidas) assert.match(l, /^linea \d{5} con algo de relleno para pesar$/);
});

test("un archivo chico sale entero y no está recortado; vacío o inexistente no explotan", async () => {
  assert.deepEqual(await leer(salida("chico", "uno\ndos\ntres\n")), { texto: "uno\ndos\ntres", recortado: false });
  assert.deepEqual(await leer(salida("vacio", "")), { texto: "", recortado: false });
  assert.equal(await leer(path.join(tareas, "no-existe.output")), null);
});

test("un archivo de GB no se lee entero: sólo se piden los últimos bytes", async () => {
  const r = path.join(tareas, "gigante.output");
  writeFileSync(r, "");
  truncateSync(r, 3 * 1024 ** 3); // hueco de 3 GB (disperso: no ocupa disco)
  const fd = openSync(r, "a");
  writeSync(fd, "\nfin de la corrida\n");
  closeSync(fd);
  const t0 = Date.now();
  const v = await leer(r);
  assert.ok(v);
  assert.match(v.texto, /fin de la corrida$/);
  assert.ok(Buffer.byteLength(v.texto) <= TOPE_SALIDA);
  assert.ok(Date.now() - t0 < 2000);
});

test("una sola línea gigante: queda su cola sin empezar a mitad de un carácter", () => {
  const b = Buffer.from("ñ".repeat(100));
  const t = colaDeBytes(b.subarray(1), true); // empieza en la mitad de una ñ
  assert.ok(!t.includes("\ufffd"));
  assert.equal(t, "ñ".repeat(99));
});

test("limpia las secuencias ANSI y las barras de progreso con \\r", () => {
  assert.equal(limpiarSalida("\u001b[32m✔\u001b[0m ok\u001b[K\n\u001b]0;título\u0007sigue"), "✔ ok\nsigue");
  assert.equal(limpiarSalida("10%\r50%\r100%\nlisto\r\n"), "100%\nlisto\n");
  assert.equal(limpiarSalida("a\u0000b\u0007c\td"), "abc\td");
});

test("rutas rechazadas: ../, fuera del temporal, sin tasks/, otra extensión, relativas y no-cadenas", async () => {
  const afuera = path.join(mkdtempSync(path.join(os.tmpdir(), "trama-salida-fuera-")), "secreto.txt");
  writeFileSync(afuera, "contraseña");
  process.on("exit", () => rmSync(path.dirname(afuera), { recursive: true, force: true }));
  const buena = salida("buena", "hola\n");
  assert.ok(await leer(buena));
  // `../` que sale de tasks/ aunque termine en .output y pase por la carpeta buena.
  const conPuntos = path.join(tareas, "..", "..", "..", "..", path.basename(path.dirname(afuera)), "secreto.output");
  writeFileSync(path.join(path.dirname(afuera), "secreto.output"), "contraseña");
  assert.equal(await leer(conPuntos), null);
  assert.equal(await leer(tareas + "/../tasks/buena.output"), null);
  // Existe, pero no es una salida de tarea.
  assert.equal(await leer(path.join(path.dirname(afuera), "secreto.output")), null);
  const sinTasks = path.join(tmp, "claude-1000", "-home-ana-proyecto", "sid-1", "otra", "x.output");
  mkdirSync(path.dirname(sinTasks), { recursive: true });
  writeFileSync(sinTasks, "x");
  assert.equal(await leer(sinTasks), null);
  const otraCarpeta = path.join(tmp, "otro", "p", "sid", "tasks", "x.output");
  mkdirSync(path.dirname(otraCarpeta), { recursive: true });
  writeFileSync(otraCarpeta, "x");
  assert.equal(await leer(otraCarpeta), null);
  assert.equal(await leer(path.join(tareas, "buena.txt")), null);
  // La misma ruta, ya sin su raíz (`/` o `C:\`): relativa en las dos plataformas.
  const absoluta = salida("x", "a");
  assert.equal(await leer(absoluta.slice(path.parse(absoluta).root.length)), null);
  for (const raro of [null, undefined, 5, {}, "", "buena.output", "/etc/passwd", "/etc/passwd.output", buena + "\0", "a".repeat(5000)]) assert.equal(await leer(raro), null);
});

test("un enlace simbólico se resuelve antes de validar: no sirve para leer otro archivo", async () => {
  const dirFuera = mkdtempSync(path.join(os.tmpdir(), "trama-salida-ln-"));
  process.on("exit", () => rmSync(dirFuera, { recursive: true, force: true }));
  writeFileSync(path.join(dirFuera, "secreto.txt"), "contraseña");
  writeFileSync(path.join(dirFuera, "otro.output"), "contraseña");
  // El archivo de la tarea es un enlace a un archivo de afuera (con o sin extensión .output).
  const ln1 = path.join(tareas, "ln1.output");
  symlinkSync(path.join(dirFuera, "secreto.txt"), ln1);
  assert.equal(await leer(ln1), null);
  const ln2 = path.join(tareas, "ln2.output");
  symlinkSync(path.join(dirFuera, "otro.output"), ln2);
  assert.equal(await leer(ln2), null);
  // Una carpeta enlazada: .../claude-1000/…/tasks → afuera.
  const raiz = path.join(tmp, "claude-1000", "cwd-enlazada", "sid");
  mkdirSync(raiz, { recursive: true });
  symlinkSync(dirFuera, path.join(raiz, "tasks"));
  assert.equal(await leer(path.join(raiz, "tasks", "otro.output")), null);
  // Un enlace de afuera que termina en una salida legítima lee esa salida (lo que se valida es el destino ya resuelto).
  const buena = salida("destino", "ok\n");
  const ln3 = path.join(dirFuera, "vuelve.output");
  symlinkSync(buena, ln3);
  assert.deepEqual(await leer(ln3), { texto: "ok", recortado: false });
});

test("leerSalidaTarea en Windows: una ruta relativa o de unidad sin raíz no pasa, sin importar dónde corra", async () => {
  for (const r of ["Users\\ana\\claude\\p\\sid\\tasks\\b1.output", "C:claude\\p\\sid\\tasks\\b1.output", "claude/p/sid/tasks/b1.output", "C:\\t\\claude\\p\\..\\sid\\tasks\\b1.output"]) {
    assert.equal(await leerSalidaTarea(r, "win32", "C:\\t"), null, r);
  }
});

test("esSalidaDeTarea: Windows (sin distinguir mayúsculas) y Linux", () => {
  const w = "C:\\Users\\Ana Perez\\AppData\\Local\\Temp";
  assert.equal(esSalidaDeTarea(`${w}\\claude\\C--proyecto\\sid\\tasks\\b1.output`, [w], "win32"), true);
  assert.equal(esSalidaDeTarea(`${w.toUpperCase()}\\CLAUDE\\C--proyecto\\sid\\tasks\\b1.output`.replace("CLAUDE", "claude").replace("\\TASKS", "\\tasks"), [w], "win32"), true);
  assert.equal(esSalidaDeTarea(`C:\\Users\\Ana Perez\\secreto.output`, [w], "win32"), false);
  assert.equal(esSalidaDeTarea(`${w}\\claude\\C--proyecto\\sid\\tasks\\..\\..\\..\\..\\..\\x.output`, [w], "win32"), false);
  assert.equal(esSalidaDeTarea(`${w}\\otra\\C--proyecto\\sid\\tasks\\b1.output`, [w], "win32"), false);
  assert.equal(esSalidaDeTarea(`${w}\\claude\\C--proyecto\\sid\\tasks\\b1.txt`, [w], "win32"), false);
  // Barras `/` de una ruta buena: es la misma ruta. Otra unidad, una carpeta hermana del temporal o una relativa, no.
  assert.equal(esSalidaDeTarea(`${w.replace(/\\/g, "/")}/claude/C--proyecto/sid/tasks/b1.output`, [w], "win32"), true);
  assert.equal(esSalidaDeTarea(`D${w.slice(1)}\\claude\\C--proyecto\\sid\\tasks\\b1.output`, [w], "win32"), false);
  assert.equal(esSalidaDeTarea(`${w}2\\claude\\C--proyecto\\sid\\tasks\\b1.output`, [w], "win32"), false);
  assert.equal(esSalidaDeTarea("claude\\C--proyecto\\sid\\tasks\\b1.output", [w], "win32"), false);
  assert.equal(esSalidaDeTarea("C:claude\\C--proyecto\\sid\\tasks\\b1.output", ["C:\\"], "win32"), false);
  assert.equal(esSalidaDeTarea("/tmp/claude-1000/-home-ana/sid/tasks/b1.output", ["/tmp"], "linux"), true);
  assert.equal(esSalidaDeTarea("/tmp/claude-1000/tasks/b1.output", ["/tmp"], "linux"), false);
  assert.equal(esSalidaDeTarea("/tmp/claude-xx/-home-ana/sid/tasks/b1.output", ["/tmp"], "linux"), false);
  assert.equal(esSalidaDeTarea("/home/ana/.ssh/tasks/b1.output", ["/tmp"], "linux"), false);
});
