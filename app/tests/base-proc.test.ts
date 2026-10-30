// cli/base/proc.ts: correr con tope (timeout -k), árbol, vivo(pid, inicio), lanzarSuelto; Windows con la plataforma inyectada.
import { EventEmitter } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LANZADOR_JS, arbol, armarFueraDelJob, campos, correr, inicioDe, lanzarSuelto, matarArbol, parsearPares, terminar, vivo } from "../electron/cli/base/proc.ts";

const posix = process.platform !== "win32";
const node = process.execPath;
const esperar = async (cond: () => boolean, ms = 5000) => {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 25));
  assert.ok(cond(), "condición no cumplida a tiempo");
};

test("correr: captura salida y código; input por stdin; comando inexistente = 127 sin tirar", async () => {
  const r = await correr(node, ["-e", "process.stdout.write('hola\\n'); process.stderr.write('e'); process.exit(3)"]);
  assert.deepEqual([r.codigo, r.salida, r.errores, r.agotado], [3, "hola\n", "e", false]);
  const i = await correr(node, ["-e", "process.stdin.pipe(process.stdout)"], { input: "dato" });
  assert.equal(i.salida, "dato");
  const n = await correr("trama-no-existe-xyz", []);
  assert.equal(n.codigo, 127);
  assert.ok(n.error);
});

test("correr: al vencer timeoutMs manda TERM al árbol y devuelve 124", { skip: !posix }, async () => {
  const t0 = Date.now();
  const r = await correr(node, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 200, killAfterMs: 2000 });
  assert.equal(r.codigo, 124);
  assert.equal(r.agotado, true);
  assert.ok(Date.now() - t0 < 1500);
});

test("correr: killAfterMs escala a KILL si ignora TERM (137) y mata también a los nietos", { skip: !posix }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "base-proc-"));
  const pidf = path.join(dir, "nieto.pid");
  const codigo = `
    const { spawn } = require("node:child_process");
    process.on("SIGTERM", () => {});
    const n = spawn(process.execPath, ["-e", ${JSON.stringify(`process.on('SIGTERM',()=>{}); require('fs').writeFileSync(${JSON.stringify(pidf)}, String(process.pid)); setInterval(()=>{},1000)`)}], { stdio: "ignore" });
    setInterval(()=>{},1000);
  `;
  const r = await correr(node, ["-e", codigo], { timeoutMs: 400, killAfterMs: 300 });
  assert.equal(r.codigo, 137);
  const nieto = Number(readFileSync(pidf, "utf8"));
  await esperar(() => !vivo(nieto));
});

test("correr: en Windows (inyectado) vence con taskkill /T /F una sola vez, sin KILL aparte", async () => {
  const matados: [number, string][] = [];
  const falso = (_c: string, _a: string[], o: SpawnOptions): ChildProcess => {
    assert.equal(o.detached, false);
    assert.equal(o.windowsHide, true);
    return spawn(node, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  };
  const r = await correr("x", [], {
    plat: "win32", timeoutMs: 100, killAfterMs: 50, spawn: falso,
    matar: (pid, s) => { matados.push([pid, s]); process.kill(pid, "SIGKILL"); },
  });
  assert.equal(r.codigo, 124);
  assert.equal(matados.length, 1);
  assert.equal(matados[0][1], "SIGTERM");
});

test("matarArbol de procesos.ts: win32 = taskkill /T /F /PID (re-exportado)", () => {
  const args: string[][] = [];
  matarArbol(4321, "SIGTERM", { plat: "win32", taskkill: (a) => args.push(a) });
  assert.deepEqual(args, [["/T", "/F", "/PID", "4321"]]);
});

test("arbol: parseo de pares tolerante a \\r\\n y recorrido padres primero", () => {
  const pares = parsearPares("  10 1\r\n11 10\r\nbasura\r\n12 11\r\n13 10\r\n99 1\r\n");
  assert.deepEqual(pares, [[10, 1], [11, 10], [12, 11], [13, 10], [99, 1]]);
  assert.deepEqual(arbol(10, { pares }), [10, 11, 13, 12]);
  assert.deepEqual(arbol(77, { pares }), [77]);
});

test("arbol y terminar con procesos reales (Linux): encuentra al nieto aunque haya hecho setsid", { skip: !posix }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "base-proc-"));
  const pidf = path.join(dir, "n.pid");
  const hijo = spawn(node, ["-e", `
    const { spawn } = require("node:child_process");
    const n = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
    require("fs").writeFileSync(${JSON.stringify(pidf)}, String(n.pid));
    setInterval(()=>{},1000);
  `], { stdio: "ignore" });
  await esperar(() => { try { return readFileSync(pidf, "utf8") !== ""; } catch { return false; } });
  const nieto = Number(readFileSync(pidf, "utf8"));
  assert.deepEqual(arbol(hijo.pid!), [hijo.pid, nieto]);
  const salio = new Promise((r) => hijo.once("exit", r));
  assert.equal(await terminar(hijo.pid!, { graceMs: 2000 }), true);
  await salio;
  await esperar(() => !vivo(nieto));
});

test("vivo: yo sí, un pid imposible no, inicio distinto = otro proceso reciclado; zombie no cuenta", { skip: !posix }, async () => {
  assert.equal(vivo(process.pid), true);
  assert.equal(vivo(undefined), false);
  assert.equal(vivo(0), false);
  assert.equal(vivo(2 ** 22 + 12345), false);
  const ini = inicioDe(process.pid);
  assert.match(ini ?? "", /^\d+$/);
  assert.equal(vivo(process.pid, ini), true);
  assert.equal(vivo(process.pid, String(Number(ini) + 1)), false);
  // zombie: hijo que sale y nadie recoge hasta que Node procese el exit; lo simulamos con el stat inyectado
  assert.equal(vivo(process.pid, undefined, { leerStat: () => "123 (a b) Z 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22" }), false);
  const h = spawn(node, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  assert.equal(vivo(h.pid), true);
  const salio = new Promise((r) => h.once("exit", r));
  h.kill("SIGKILL");
  await salio;
  assert.equal(vivo(h.pid), false);
});

test("campos: el nombre del proceso puede tener espacios y paréntesis (campo 22 = starttime)", () => {
  const stat = "42 (mi (raro) proc) S 1 42 42 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 1000 100 18446744073709551615";
  const c = campos(stat)!;
  assert.equal(c[0], "S");
  assert.equal(c[1], "1");
  assert.equal(c[19], "987654");
});

test("vivo en win32 (inyectado): kill(pid,0) y comparar la hora de arranque sólo si hay una anotada; EPERM = vivo", () => {
  const ceros: number[] = [];
  const kill = (pid: number, s: 0) => { assert.equal(s, 0, "nunca una señal real"); ceros.push(pid); };
  assert.equal(vivo(500, undefined, { plat: "win32", kill }), true);
  assert.equal(vivo(500, "111", { plat: "win32", kill, inicioDe: () => "111" }), true);
  assert.equal(vivo(500, "111", { plat: "win32", kill, inicioDe: () => "222" }), false, "pid reciclado");
  assert.equal(vivo(500, "111", { plat: "win32", kill, inicioDe: () => undefined }), true, "no se pudo mirar: se fía del pid");
  assert.equal(vivo(500, undefined, { plat: "win32", kill: () => { throw Object.assign(new Error("x"), { code: "EPERM" }); } }), true);
  assert.equal(vivo(500, undefined, { plat: "win32", kill: () => { throw Object.assign(new Error("x"), { code: "ESRCH" }); } }), false);
  assert.ok(ceros.length >= 4);
  const argvs: string[][] = [];
  assert.equal(inicioDe(500, { plat: "win32", ejecutar: (c, a) => (argvs.push([c, ...a]), "133700000000000000\r\n") }), "133700000000000000");
  assert.equal(argvs[0][0], "powershell");
  assert.match(argvs[0].join(" "), /Get-Process -Id 500/);
});

test("lanzarSuelto: sigue vivo tras soltarlo, escribe al log en append; Windows = detached + windowsHide", { skip: !posix }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "base-proc-"));
  const log = path.join(dir, "salida.log");
  const pid = lanzarSuelto(node, ["-e", "console.log('uno'); setTimeout(()=>console.log('dos'), 150)"], { log });
  assert.ok(pid);
  await esperar(() => readFileSync(log, "utf8").includes("dos"));
  assert.equal(readFileSync(log, "utf8"), "uno\ndos\n");
  const pid2 = lanzarSuelto(node, ["-e", "console.log('tres')"], { log });
  assert.ok(pid2);
  await esperar(() => readFileSync(log, "utf8").includes("tres"));
  assert.equal(readFileSync(log, "utf8"), "uno\ndos\ntres\n");

  let visto: SpawnOptions | undefined;
  let unref = false;
  lanzarSuelto("pa.js", ["x"], {
    plat: "win32",
    spawn: (_c, _a, o) => {
      visto = o;
      return Object.assign(new EventEmitter(), { pid: 7, unref: () => void (unref = true) }) as unknown as ChildProcess;
    },
  });
  assert.equal(visto?.detached, true);
  assert.equal(visto?.windowsHide, true);
  assert.deepEqual(visto?.stdio, ["ignore", "ignore", "ignore"]);
  assert.ok(unref);
});



test("lanzarFueraDelJob: la tarea y el entorno van en un JSON, nunca en la línea de comandos que pasa por cmd.exe; el lanzador es JS válido", () => {
  const { linea, ps } = armarFueraDelJob("C:\\Users\\Ana\\trama\\node\\node.exe", "C:\\st ate\\.lanzar-1.cjs", "C:\\st ate\\.lanzar-1.json", "C:\\Max\\repo");
  assert.equal(linea, 'cmd.exe /d /s /c "set ELECTRON_RUN_AS_NODE=1&& "C:\\Users\\Ana\\trama\\node\\node.exe" "C:\\st ate\\.lanzar-1.cjs" "C:\\st ate\\.lanzar-1.json""');
  assert.match(ps, /Win32_Process -Arguments|-ClassName Win32_Process -MethodName Create/);
  assert.match(ps, /ShowWindow=\[uint16\]0/);
  assert.match(ps, /CurrentDirectory='C:\\Max\\repo'/);
  assert.match(ps, /\$r\.ReturnValue -ne 0/);
  // una comilla simple en una ruta no rompe el literal de PowerShell
  assert.match(armarFueraDelJob("n", "l", "C:\\o'neil\\p.json").ps, /o''neil/);
  assert.doesNotThrow(() => new Function("require", "process", LANZADOR_JS), "LANZADOR_JS no compila");
});

test("lanzarFueraDelJob: el lanzador suelta el proceso con su salida al log y deja el pid", { skip: !posix }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fuera-job-"));
  const log = path.join(dir, "salida.log");
  const pidf = path.join(dir, "p.pid");
  const pedidoF = path.join(dir, "pedido.json");
  writeFileSync(pedidoF, JSON.stringify({ cmd: node, args: ["-e", "console.log('desde el hijo', process.env.PA_TS)"], env: { ...process.env, PA_TS: "T1" }, log, pidf }));
  const lanzador = path.join(dir, "lanzador.cjs");
  writeFileSync(lanzador, LANZADOR_JS);
  const r = spawnSync(node, [lanzador, pedidoF]);
  assert.equal(r.status, 0, String(r.stderr));
  assert.ok(Number(readFileSync(pidf, "utf8")) > 0);
  assert.equal(existsSync(pedidoF), false, "el pedido (con la tarea) se borra apenas se lee");
  await esperar(() => existsSync(log) && readFileSync(log, "utf8").includes("desde el hijo T1"));
});
