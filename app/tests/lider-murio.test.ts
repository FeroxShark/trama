// Un líder de Trama al que le matan el proceso: Murió + Retomar (electron/lider.ts, statusline.ts, con
// el claude falso). Y el aviso de recoger a los workers en el primer mensaje de un líder traído de una
// terminal. Mismo armado que tests/retomar-lider.test.ts.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
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

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-murio-")));
const dicho = path.join(tmp, "dicho.jsonl");
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = path.join(tmp, "pa");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "registry.json");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.TRAMA_FALSO_DICHO = dicho;
process.env.TRAMA_FALSO_MS = "20";
mkdirSync(process.env.HILOS_SESIONES);
writeFileSync(process.env.PROYECTOS_REGISTRY, "{}");

const lider = await import("../electron/lider.ts");
const arma = await import("../electron/lider-arma.ts");
const { leerStatusline } = await import("../electron/statusline.ts");
type Ev = { sid: string; e: { tipo: string; error?: string | null } };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(() => lider.cerrarTodos(true));

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
const M = { modelo: "claude-opus-5-5", effort: "high" };
const guardado = async (sid: string) => (await lider.lideresApp()).find((l) => l.sid === sid);
const enDisco = (sid: string) => JSON.parse(readFileSync(path.join(tmp, "estado", "lideres.json"), "utf8")).lideres.find((l: { sid: string }) => l.sid === sid);
const dichos = (): { sid: string; texto: string }[] => (existsSync(dicho) ? readFileSync(dicho, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

test("murioProceso: lo que mata una señal o sale con error murió; lo que cierra la app o sale en paz, no", () => {
  assert.equal(arma.murioProceso(false, null, null), true, "una señal (OOM, kill -9)");
  assert.equal(arma.murioProceso(false, 1, ""), true, "salió con error");
  assert.equal(arma.murioProceso(false, 0, null), false, "salió en paz");
  assert.equal(arma.murioProceso(true, null, null), false, "lo cerró la app");
  assert.equal(arma.murioProceso(true, 1, ""), false);
});

test("un líder de la app al que le matan el proceso queda Murió hasta que se lo retoma", { timeout: 30_000 }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "hola" });
  await hasta(() => eventos.some((x) => x.sid === sid && x.e.tipo === "fin"));
  assert.equal((await guardado(sid))!.murio, undefined, "vivo: no murió");
  const pid = lider.procDe(sid)!.pid!;
  process.kill(pid, "SIGKILL");
  await hasta(() => lider.procDe(sid) === null);
  const g = (await guardado(sid))!;
  assert.ok(g.murio! > 0, "queda anotado");
  await hasta(() => enDisco(sid)?.murio > 0);
  assert.equal(lider.procDe(sid), null);

  // La barra lo recibe como líder de la app sin proceso, marcado Murió (la fila y la vista salen de `caido`).
  const lideres = (await leerStatusline()).lideres.lideres;
  const l = lideres.find((x) => x.id === sid)!;
  assert.deepEqual([l.origen, l.vivo, l.caido], ["app", false, "murio"]);

  // Retomar: ya no es Murió, y lo relanza ya con --resume (ocioso, sin mandarle nada).
  assert.deepEqual(await lider.retomar({ sid, ...M }), { ok: true });
  assert.equal((await guardado(sid))!.murio, undefined);
  assert.equal(enDisco(sid).murio, undefined, "también en disco");
  assert.equal((await leerStatusline()).lideres.lideres.find((x) => x.id === sid)!.caido, undefined);
  assert.ok(lider.procDe(sid), "retomar lo relanza ya");
  assert.equal(lider.procDe(sid)!.ocupado, false, "sin mandarle nada");
  await lider.mandar({ sid, texto: "seguimos", ...M });
  assert.ok(lider.procDe(sid), "el primer mensaje entra a ese proceso");
});

test("lo que cierra la app no es morir: Cerrar y reiniciar los ociosos", { timeout: 30_000 }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "hola" });
  await hasta(() => eventos.some((x) => x.sid === sid && x.e.tipo === "fin"));
  const antes = eventos.length;
  const r = await lider.reiniciarOciosos();
  assert.ok(r.reiniciados >= 1);
  await hasta(() => lider.procDe(sid) === null);
  assert.equal((await guardado(sid))!.murio, undefined, "reiniciarlo adrede no es morir");
  assert.ok(eventos.slice(antes).some((x) => x.sid === sid && x.e.tipo === "salio"));
  await lider.cerrar(sid);
  assert.equal(await guardado(sid), undefined);
});

test("un líder que murió hace más de un día no deja la barra: sigue listado (la barra lo pliega en Dormidos)", async () => {
  const sid = await lider.nuevo({ ...M, texto: "hola" });
  await hasta(() => eventos.some((x) => x.sid === sid && x.e.tipo === "fin"));
  process.kill(lider.procDe(sid)!.pid!, "SIGKILL");
  await hasta(() => lider.procDe(sid) === null);
  const g = (await guardado(sid))!;
  g.ultimo = 1;
  g.creado = 1;
  assert.ok((await leerStatusline()).lideres.lideres.some((x) => x.id === sid), "lo mataron hace un instante: se ve aunque su último turno sea viejo");
  g.murio = Math.floor(Date.now() / 1000) - 2 * 24 * 3600;
  assert.ok((await leerStatusline()).lideres.lideres.some((x) => x.id === sid), "hace dos días: nada se esconde por tiempo");
});

test("avisoTraido / sinAviso: la línea sólo con workers vivos, y la vista no la muestra", () => {
  assert.equal(arma.avisoTraido(0), "");
  const a = arma.avisoTraido(1);
  assert.match(a, /^\[trama\] .*1 worker corriendo.*pa --esperar-todos/);
  assert.match(arma.avisoTraido(3), /3 workers corriendo/);
  assert.match(arma.avisoTraido(2, "murio"), /^\[trama\] Te retomaron en Trama después de que murió tu proceso y se cortaron tus esperas: tenés 2 workers corriendo/);
  assert.equal(arma.avisoTraido(0, "murio"), "");
  assert.equal(arma.sinAviso(a + "seguimos"), "seguimos");
  assert.equal(arma.sinAviso("seguimos"), "seguimos");
  assert.equal(arma.sinAviso("[trama] algo sin cierre"), "[trama] algo sin cierre");
  // El transcript lo guarda entero; la conversación que ve Ana, sin el aviso.
  const linea = JSON.stringify({ type: "user", message: { role: "user", content: a + "seguimos" }, timestamp: "2026-10-14T10:00:00Z" });
  const c = arma.conversacionDe("x", null, linea + "\n");
  assert.equal(c.mensajes[0].texto, "seguimos");
});

test("un líder traído de una terminal recibe, en su primer mensaje y sólo en el primero, el aviso de sus workers", { timeout: 30_000 }, async () => {
  const sid = "cccccccc-1111-4111-8111-111111111111";
  const carpeta = path.join(tmp, "proyecto");
  mkdirSync(carpeta);
  const d = path.join(tmp, "claude", "projects", "-una-carpeta");
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, `${sid}.jsonl`), [{ type: "user", cwd: carpeta, sessionId: sid, message: { role: "user", content: "hola" } }].map((x) => JSON.stringify(x)).join("\n") + "\n");
  const { spawn } = await import("node:child_process");
  const h = spawn("sleep", ["300"], { stdio: "ignore" });
  after(() => void h.kill("SIGKILL"));
  const t = readFileSync(`/proc/${h.pid}/stat`, "utf8");
  const procStart = t.slice(t.lastIndexOf(")") + 2).split(" ")[19];
  writeFileSync(path.join(process.env.HILOS_SESIONES!, `${h.pid}.json`), JSON.stringify({ sessionId: sid, pid: h.pid, name: "ana-t1", cwd: carpeta, kind: "interactive", entrypoint: "cli", status: "idle", procStart }));

  lider.ponerWorkersVivos((x) => (x === sid ? 2 : 0));
  assert.deepEqual(await lider.traer({ sid, ...M }), { ok: true });
  await lider.mandar({ sid, texto: "seguimos", ...M });
  await hasta(() => eventos.filter((x) => x.sid === sid && x.e.tipo === "fin").length >= 1);
  const [uno] = dichos().filter((x) => x.sid === sid);
  assert.match(uno.texto, /^\[trama\] .*2 workers corriendo.*pa --esperar-todos/);
  assert.ok(uno.texto.endsWith("\n\nseguimos"), "después del aviso, el mensaje tal cual");

  await lider.mandar({ sid, texto: "otra cosa", ...M });
  await hasta(() => eventos.filter((x) => x.sid === sid && x.e.tipo === "fin").length >= 2);
  assert.equal(dichos().filter((x) => x.sid === sid)[1].texto, "otra cosa", "el segundo, sin aviso");
});

test("un líder traído sin workers vivos no lleva ningún aviso", { timeout: 30_000 }, async () => {
  const sid = "dddddddd-1111-4111-8111-111111111111";
  const carpeta = path.join(tmp, "proyecto2");
  mkdirSync(carpeta);
  const d = path.join(tmp, "claude", "projects", "-una-carpeta");
  writeFileSync(path.join(d, `${sid}.jsonl`), [{ type: "user", cwd: carpeta, sessionId: sid, message: { role: "user", content: "hola" } }].map((x) => JSON.stringify(x)).join("\n") + "\n");
  const { spawn } = await import("node:child_process");
  const h = spawn("sleep", ["300"], { stdio: "ignore" });
  after(() => void h.kill("SIGKILL"));
  const t = readFileSync(`/proc/${h.pid}/stat`, "utf8");
  const procStart = t.slice(t.lastIndexOf(")") + 2).split(" ")[19];
  writeFileSync(path.join(process.env.HILOS_SESIONES!, `${h.pid}.json`), JSON.stringify({ sessionId: sid, pid: h.pid, name: "ana-t2", cwd: carpeta, kind: "interactive", entrypoint: "cli", status: "idle", procStart }));
  lider.ponerWorkersVivos(() => 0);
  assert.deepEqual(await lider.traer({ sid, ...M }), { ok: true });
  await lider.mandar({ sid, texto: "seguimos", ...M });
  await hasta(() => dichos().some((x) => x.sid === sid));
  assert.equal(dichos().find((x) => x.sid === sid)!.texto, "seguimos");
});

/** El transcript de una sesión de terminal, en una carpeta que existe (para retomarla). */
function transcriptDeTerminal(sid: string, cwd: string) {
  const d = path.join(tmp, "claude", "projects", "-terminal");
  mkdirSync(d, { recursive: true });
  const f = path.join(d, `${sid}.jsonl`);
  writeFileSync(f, JSON.stringify({ type: "user", cwd, sessionId: sid, message: { role: "user", content: "hola" } }) + "\n");
  return f;
}

test("retomar un líder que murió: su primer mensaje lleva el aviso de recoger a sus workers, una sola vez", { timeout: 30_000 }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "hola" });
  await hasta(() => eventos.some((x) => x.sid === sid && x.e.tipo === "fin"));
  process.kill(lider.procDe(sid)!.pid!, "SIGKILL");
  await hasta(() => lider.procDe(sid) === null);
  await hasta(() => enDisco(sid)?.murio > 0);
  const delSid = () => dichos().filter((d) => d.sid === sid);
  const fines = () => eventos.filter((x) => x.sid === sid && x.e.tipo === "fin").length;

  lider.ponerWorkersVivos(() => 2);
  assert.deepEqual(await lider.retomar({ sid, ...M }), { ok: true });
  await lider.mandar({ sid, texto: "seguimos", ...M });
  // El fake anota cada mensaje al recibirlo: mandar() resuelve antes, así que se espera que aparezca.
  await hasta(() => delSid().some((d) => d.texto.endsWith("seguimos")));
  const primero = delSid().find((d) => d.texto.endsWith("seguimos"))!.texto;
  assert.match(primero, /^\[trama\] Te retomaron en Trama después de que murió tu proceso .*2 workers corriendo.*pa --esperar-todos/);
  assert.ok(primero.endsWith("seguimos"), "el aviso va antes del mensaje, no lo reemplaza");

  // Mandar mientras el turno anterior sigue responde "respondiendo": se espera su fin.
  await hasta(() => fines() >= 2);
  await lider.mandar({ sid, texto: "y ahora", ...M });
  await hasta(() => delSid().some((d) => d.texto === "y ahora"));
  assert.equal(delSid().at(-1)!.texto, "y ahora", "el aviso sólo va en el primero");
  lider.ponerWorkersVivos(() => 0);
});

test("retomar un líder de terminal: avisa sólo si murió (caidos.json), no si sólo cerró", { timeout: 30_000 }, async () => {
  const muerto = "22222222-2222-4222-8222-222222222222";
  const cerro = "33333333-3333-4333-8333-333333333333";
  const carpeta = path.join(tmp, "terminal");
  mkdirSync(carpeta, { recursive: true });
  for (const sid of [muerto, cerro]) transcriptDeTerminal(sid, carpeta);
  mkdirSync(path.join(tmp, "estado"), { recursive: true });
  writeFileSync(path.join(tmp, "estado", "caidos.json"), JSON.stringify({ version: 1, caidos: [{ id: muerto, nombre: "ana-t", ts: Math.floor(Date.now() / 1000) }] }));
  const delSid = (s: string) => dichos().filter((d) => d.sid === s).at(-1)!.texto;

  lider.ponerWorkersVivos(() => 1);
  assert.deepEqual(await lider.retomar({ sid: muerto, ...M }), { ok: true });
  assert.deepEqual(await lider.retomar({ sid: cerro, ...M }), { ok: true });
  await lider.mandar({ sid: muerto, texto: "seguimos", ...M });
  await lider.mandar({ sid: cerro, texto: "seguimos", ...M });
  await hasta(() => dichos().some((d) => d.sid === muerto && d.texto.endsWith("seguimos")) && dichos().some((d) => d.sid === cerro && d.texto.endsWith("seguimos")));
  assert.match(delSid(muerto), /^\[trama\] Te retomaron en Trama .*1 worker corriendo/);
  assert.equal(delSid(cerro), "seguimos", "sin muerte, no hay aviso");
  lider.ponerWorkersVivos(() => 0);
});

test("cerrar un líder deja rastro en el log: quién, por qué y cómo estaba", async () => {
  const sid = await lider.nuevo({ ...M, texto: "hola" });
  await hasta(() => eventos.some((x) => x.sid === sid && x.e.tipo === "fin"));
  await lider.cerrar(sid, "archivar");
  const log = readFileSync(path.join(process.env.HILOS_STATE!, "trama.log"), "utf8");
  assert.match(log, new RegExp(`info \\[lider\\] archivar: ".*" \\(${sid}\\) · `));
  await lider.nuevo({ ...M, texto: "otro" }).then(async (s2) => {
    await hasta(() => eventos.some((x) => x.sid === s2 && x.e.tipo === "fin"));
    await lider.cerrar(s2, "cualquier cosa");
    assert.match(readFileSync(path.join(process.env.HILOS_STATE!, "trama.log"), "utf8"), new RegExp(`sin-motivo: ".*" \\(${s2}\\)`));
  });
});
