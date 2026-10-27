// La cola de un líder contra el main de verdad (electron/lider.ts con el claude falso y una
// "terminal" de mentira), armada como en electron/nucleo.ts: lo que se manda a mitad de un turno
// queda en cola y sale solo cuando el turno termina, también al que está abierto en una
// terminal (ahí recién se lo trae, y sólo a ese pid). Mismo armado que tests/traer-lider.test.ts.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-cola-")));
const log = path.join(tmp, "claude.log");
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.TRAMA_FALSO_LOG = log;
process.env.TRAMA_FALSO_MS = "40";
process.env.HILOS_TERM_MS = "300";
mkdirSync(process.env.HILOS_SESIONES);

const lider = await import("../electron/lider.ts");
const { crearCola } = await import("../electron/cola.ts");
type AvisoCola = import("../electron/cola.ts").AvisoCola;

// Lo que pasó, en orden: fines de turno y salidas de la cola.
const pasos: string[] = [];
const avisos: AvisoCola[] = [];
let disco = "";
const cola = crearCola({
  disponible: (sid) => lider.disponible(sid),
  traer: (sid, x, cortar) => lider.traer({ sid, modelo: x.modelo, effort: x.effort, nombre: x.nombre, modo: x.modo, cortar }),
  mandar: (sid, x) => lider.mandar({ sid, texto: x.texto, imagenes: x.imagenes, modelo: x.modelo, effort: x.effort }),
  total: async (sid) => (await lider.conversacionLider({ sid, n: 1 })).total,
  textoError: (x) => ("motivo" in x ? x.motivo : String(x.error)),
  guardar: async (json) => void (disco = json),
  avisar: (a) => {
    avisos.push(a);
    if (a.salio) pasos.push(`salio:${a.salio.item.texto}`);
  },
});
lider.alEvento((sid, e) => {
  const ev = e as { tipo: string; ocupado?: boolean };
  if (ev.tipo === "fin") pasos.push("fin");
  if (ev.tipo === "estado" && !ev.ocupado) void cola.libre(sid);
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error(`no pasó a tiempo: ${JSON.stringify(pasos)} ${JSON.stringify(avisos.at(-1))}`);
    await espera(20);
  }
}
const M = { modelo: "claude-opus-5-5", effort: "high" };
const fines = () => pasos.filter((p) => p === "fin").length;
const lanzados = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.args) : []);

const hijos: ChildProcess[] = [];
after(async () => {
  for (const h of hijos) h.kill("SIGKILL");
  await lider.cerrarTodos(true);
});

test("líder de la app respondiendo: lo que se manda queda en cola y sale al terminar el turno, todo junto", { timeout: 30_000 }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "hola" });
  assert.equal(await lider.disponible(sid), "ocupado");
  // El `mandar` de siempre se niega a mitad de un turno: por eso la cola.
  await assert.rejects(lider.mandar({ sid, texto: "x", ...M }));
  cola.encolar(sid, { ...M, texto: "uno" });
  cola.encolar(sid, { ...M, texto: "dos" });
  const tres = cola.encolar(sid, { ...M, texto: "tres" });
  await espera(30);
  assert.deepEqual(cola.lista(sid).map((x) => x.texto), ["uno", "dos", "tres"], "en cola, visible");
  assert.equal(fines(), 0);
  assert.deepEqual(JSON.parse(disco).colas[sid].map((x: { texto: string }) => x.texto), ["uno", "dos", "tres"], "y en disco");
  // Cancelar uno de la cola: ese no sale.
  cola.quitar(sid, tres.id);

  await hasta(() => fines() === 2);
  assert.deepEqual(pasos, ["fin", "salio:Mensaje 1 de 2:\nuno\n\n---\n\nMensaje 2 de 2:\ndos", "fin"], "sin canal a mitad de turno: los dos juntos, en un solo mensaje, al terminar el turno");
  assert.deepEqual(cola.lista(sid), []);
  assert.equal(avisos.find((a) => a.salio)!.salio!.traido, false);
  assert.equal(lanzados().length, 1, "el mismo proceso, sin relanzar");
  assert.equal(await lider.disponible(sid), "app");
});

test("líder abierto en una terminal a mitad de un turno: espera sin tocarlo; al terminar lo trae (ese pid) y manda", { timeout: 30_000 }, async () => {
  pasos.length = 0;
  const sid = "eeeeeeee-1111-4111-8111-111111111111";
  const carpeta = path.join(tmp, "proyecto");
  mkdirSync(carpeta);
  const d = path.join(tmp, "claude", "projects", "-una-carpeta");
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, `${sid}.jsonl`), JSON.stringify({ type: "user", cwd: carpeta, sessionId: sid, message: { role: "user", content: "hola" } }) + "\n");
  const h = spawn("sleep", ["300"], { stdio: "ignore" });
  hijos.push(h);
  let fin: string | null = null;
  h.on("exit", (_c, senal) => (fin = senal ?? "salió"));
  const st = readFileSync(`/proc/${h.pid}/stat`, "utf8");
  const sesion = { sessionId: sid, pid: h.pid, name: "ana-t1", cwd: carpeta, kind: "interactive", entrypoint: "cli", status: "busy", procStart: st.slice(st.lastIndexOf(")") + 2).split(" ")[19] };
  const archivo = path.join(process.env.HILOS_SESIONES!, `${h.pid}.json`);
  writeFileSync(archivo, JSON.stringify(sesion));
  const antes = lanzados().length;

  assert.equal(await lider.disponible(sid), "terminalOcupada");
  cola.encolar(sid, { ...M, texto: "seguimos", modo: "acceptEdits", nombre: "ana-t1" });
  await espera(150);
  await cola.revisar();
  assert.equal(fin, null, "no se lo corta");
  assert.equal(lanzados().length, antes, "ni sale ningún claude");
  assert.deepEqual(cola.lista(sid).map((x) => x.texto), ["seguimos"]);
  assert.equal(cola.error(sid), null);

  // Terminó su turno allá: el archivo de la sesión cambia (inotify, en la app) y la cola revisa.
  writeFileSync(archivo, JSON.stringify({ ...sesion, status: "idle" }));
  assert.equal(await lider.disponible(sid), "terminal");
  await cola.revisar();
  await hasta(() => fines() === 1);
  assert.equal(fin, "SIGTERM", "se cerró ese proceso");
  const nuevo = lanzados().slice(antes);
  assert.equal(nuevo.length, 1);
  assert.equal(nuevo[0].args[nuevo[0].args.indexOf("--resume") + 1], sid);
  assert.equal(nuevo[0].cwd, carpeta);
  assert.deepEqual(pasos, ["salio:seguimos", "fin"]);
  assert.equal(avisos.findLast((a) => a.salio)!.salio!.traido, true);
  assert.equal((await lider.lideresApp()).find((l) => l.sid === sid)!.modo, "acceptEdits", "con el modo de la caja");
  assert.deepEqual(cola.lista(sid), []);
});
