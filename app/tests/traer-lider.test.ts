// Traer a la app un líder abierto en una terminal (electron/lider.ts, con el claude falso y
// "terminales" de mentira: un proceso propio con su `sessions/<pid>.json`). Cierra ese proceso
// por su pid exacto, y sólo ese; si está a mitad de algo no lo toca sin permiso; lo que no es
// de una terminal o no se puede confirmar, tampoco. Mismo armado que tests/retomar-lider.test.ts.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-traer-")));
const log = path.join(tmp, "claude.log");
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.TRAMA_FALSO_LOG = log;
process.env.TRAMA_FALSO_MS = "20";
// Lo que se espera a un SIGTERM antes del SIGKILL (6 s de verdad).
process.env.HILOS_TERM_MS = "300";
mkdirSync(process.env.HILOS_SESIONES);

const lider = await import("../electron/lider.ts");
type Ev = { sid: string; e: { tipo: string } };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
let cambios = 0;
lider.alCambiar(() => cambios++);

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}

const M = { modelo: "claude-opus-5-5", effort: "high" };
const carpeta = path.join(tmp, "proyecto");
mkdirSync(carpeta);
function transcript(sid: string, cwd = carpeta) {
  const d = path.join(tmp, "claude", "projects", "-una-carpeta");
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, `${sid}.jsonl`), [{ type: "summary", summary: "x" }, { type: "user", cwd, sessionId: sid, message: { role: "user", content: "hola" } }].map((x) => JSON.stringify(x)).join("\n") + "\n");
}
const lanzados = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.args) : []);

const hijos: ChildProcess[] = [];
after(async () => {
  for (const h of hijos) h.kill("SIGKILL");
  await lider.cerrarTodos(true);
});
const procStart = (pid: number) => {
  const t = readFileSync(`/proc/${pid}/stat`, "utf8");
  return t.slice(t.lastIndexOf(")") + 2).split(" ")[19];
};
type Terminal = { h: ChildProcess; pid: number; archivo: string; fin: () => string | null };
/** Un `claude` de terminal de mentira: un proceso propio y su archivo de sesión. `sordo`: no sale con SIGTERM. */
async function terminal(sid: string, x: Record<string, unknown> = {}, sordo = false): Promise<Terminal> {
  const h = sordo
    ? spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); console.log('listo'); setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "ignore"] })
    : spawn("sleep", ["300"], { stdio: "ignore" });
  hijos.push(h);
  if (sordo) await new Promise((ok) => h.stdout!.once("data", ok));
  const pid = h.pid!;
  let fin: string | null = null;
  h.on("exit", (_c, senal) => (fin = senal ?? "salió"));
  const archivo = path.join(process.env.HILOS_SESIONES!, `${pid}.json`);
  writeFileSync(archivo, JSON.stringify({ sessionId: sid, pid, name: "ana-t1", cwd: carpeta, kind: "interactive", entrypoint: "cli", status: "idle", procStart: procStart(pid), ...x }));
  return { h, pid, archivo, fin: () => fin };
}
const vivo = (t: Terminal) => t.h.exitCode === null && t.h.signalCode === null;
const esDeLaApp = async (sid: string) => (await lider.lideresApp()).some((l) => l.sid === sid);

test("traer: cierra el claude de la terminal (ese pid) y queda de la app; el mensaje sale con --resume en su carpeta", { timeout: 20_000 }, async () => {
  const sid = "aaaaaaaa-1111-4111-8111-111111111111";
  transcript(sid);
  const t = await terminal(sid);
  // Otra terminal, otra sesión: no se toca.
  const otra = await terminal("aaaaaaaa-9999-4999-8999-999999999999");
  // Abierto allá no se le puede escribir: el `mandar` de siempre se niega.
  await assert.rejects(lider.mandar({ sid, texto: "x", ...M }));
  const antes = cambios;
  assert.deepEqual(await lider.traer({ sid, ...M }), { ok: true });
  await hasta(() => t.fin() !== null);
  assert.equal(t.fin(), "SIGTERM");
  assert.equal(vivo(otra), true, "sólo el pid de esa sesión");
  assert.equal(cambios, antes + 1, "la barra se entera");
  assert.equal(lider.procDe(sid), null, "traer no lanza ningún proceso");
  assert.deepEqual(lanzados(), []);
  const g = (await lider.lideresApp()).find((l) => l.sid === sid)!;
  assert.deepEqual([g.nombre, g.cwd], ["ana-t1", carpeta], "sin nombre, el de la sesión");

  await lider.mandar({ sid, texto: "seguimos", ...M });
  await hasta(() => eventos.some((x) => x.sid === sid && x.e.tipo === "fin"));
  const [uno, ...mas] = lanzados();
  assert.equal(mas.length, 0);
  assert.equal(uno.args[uno.args.indexOf("--resume") + 1], sid);
  assert.equal(uno.cwd, carpeta);
});

test("traer: a mitad de algo no lo toca sin permiso; con `cortar`, sí", { timeout: 20_000 }, async () => {
  const sid = "bbbbbbbb-1111-4111-8111-111111111111";
  transcript(sid);
  const t = await terminal(sid, { status: "busy" });
  assert.deepEqual(await lider.traer({ sid, ...M }), { ok: false, motivo: "trabajando" });
  await espera(100);
  assert.equal(vivo(t), true);
  assert.equal(await esDeLaApp(sid), false, "no se anotó nada");
  // Esperando un permiso o con un shell (`!`) tampoco es reposo.
  writeFileSync(t.archivo, JSON.stringify({ ...JSON.parse(readFileSync(t.archivo, "utf8")), status: "shell" }));
  assert.deepEqual(await lider.traer({ sid, ...M, cortar: false }), { ok: false, motivo: "trabajando" });
  assert.equal(vivo(t), true);
  assert.deepEqual(await lider.traer({ sid, ...M, cortar: true, modo: "plan" }), { ok: true });
  await hasta(() => t.fin() !== null);
  assert.equal(t.fin(), "SIGTERM");
  assert.equal((await lider.lideresApp()).find((l) => l.sid === sid)!.modo, "plan");
});

test("traer: lo que no es de una terminal, o no se puede confirmar que es ese proceso, no recibe ninguna señal", { timeout: 20_000 }, async () => {
  // Un `claude -p` (otra trama, un worker de `pa`): no es una terminal.
  const sdk = "cccccccc-1111-4111-8111-111111111111";
  transcript(sdk);
  const a = await terminal(sdk, { entrypoint: "sdk-cli" });
  assert.deepEqual(await lider.traer({ sid: sdk, ...M, cortar: true }), { ok: false, motivo: "abierto" });
  // Sin `procStart` no se sabe si el pid sigue siendo de esa sesión.
  const sinArranque = "cccccccc-2222-4222-8222-222222222222";
  transcript(sinArranque);
  const b = await terminal(sinArranque, { procStart: undefined });
  assert.deepEqual(await lider.traer({ sid: sinArranque, ...M, cortar: true }), { ok: false, motivo: "abierto" });
  // El pid ya es de otro proceso (el archivo quedó de una sesión muerta): no hay nada que cerrar, y a ese otro no se lo toca.
  const reusado = "cccccccc-3333-4333-8333-333333333333";
  transcript(reusado);
  const c = await terminal(reusado, { procStart: "1" });
  assert.deepEqual(await lider.traer({ sid: reusado, ...M }), { ok: true });
  // La sesión de la propia app nunca.
  const propia = "cccccccc-4444-4444-8444-444444444444";
  transcript(propia);
  writeFileSync(path.join(process.env.HILOS_SESIONES!, `${process.pid}.json`), JSON.stringify({ sessionId: propia, pid: process.pid, kind: "interactive", entrypoint: "cli", status: "idle", procStart: procStart(process.pid) }));
  assert.deepEqual(await lider.traer({ sid: propia, ...M, cortar: true }), { ok: false, motivo: "abierto" });
  rmSync(path.join(process.env.HILOS_SESIONES!, `${process.pid}.json`));
  await espera(150);
  for (const t of [a, b, c]) assert.equal(vivo(t), true);
  for (const s of [sdk, sinArranque, propia]) assert.equal(await esDeLaApp(s), false);
});

test("traer: si no sale con SIGTERM, SIGKILL a ese pid; sin conversación en el disco no se cierra nada", { timeout: 20_000 }, async () => {
  const sid = "dddddddd-1111-4111-8111-111111111111";
  transcript(sid);
  const t = await terminal(sid, {}, true);
  assert.deepEqual(await lider.traer({ sid, ...M }), { ok: true });
  await hasta(() => t.fin() !== null);
  assert.equal(t.fin(), "SIGKILL");
  // El archivo de un proceso muerto no cuenta como "abierto en otro lado": se le puede escribir.
  assert.equal(existsSync(t.archivo), true);
  await lider.mandar({ sid, texto: "seguimos", ...M });
  await hasta(() => eventos.some((x) => x.sid === sid && x.e.tipo === "fin"));

  const sinSesion = "dddddddd-2222-4222-8222-222222222222";
  const u = await terminal(sinSesion);
  assert.deepEqual(await lider.traer({ sid: sinSesion, ...M }), { ok: false, motivo: "sinSesion" });
  await espera(100);
  assert.equal(vivo(u), true, "sin poder seguirlo acá, no se lo cierra allá");
  await assert.rejects(lider.traer({ sid: "no-es-un-id", ...M }));
});
