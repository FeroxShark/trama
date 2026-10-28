// Etapa 8 del pa en TS (electron/cli/pa/async.ts, matar.ts, resultado.ts, corridas.ts): lo que la paridad no alcanza a ver.
// El --async de verdad (relanzarse y esperar el puesto) con un hijo falso, el matar de Windows (pedir que pare y taskkill) con
// la plataforma inyectada, la línea de la rama con commits (los shas cambian entre sandboxes) y el --esperar-todos que se
// cruza con otra espera.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { tomar } from "../electron/cli/base/lock.ts";
import { argsHijo, cmdEsperar, cmdEsperarTodos, lanzarAsync, OTRA_ESPERA } from "../electron/cli/pa/async.ts";
import { comparadorGlob, idCorrida } from "../electron/cli/pa/corridas.ts";
import { prologo, Salida, type Pa } from "../electron/cli/pa/entorno.ts";
import { matarArbolPa, ORDEN_PARAR, pidsDelSid } from "../electron/cli/pa/matar.ts";
import { lineaRama, verificacionDe, verificadoDe } from "../electron/cli/pa/resultado.ts";
import { soloPosix } from "./plataforma.ts";

function armar(extra: Record<string, string> = {}): { pa: Pa; raiz: string; out: () => string; err: () => string } {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pa-async-")));
  let o = "";
  let e = "";
  const env = { HOME: raiz, USERPROFILE: raiz, PA_STATE: path.join(raiz, "estado"), PA_JEFE: "", PA_JEFE_ID: "", PATH: process.env.PATH, ...extra };
  const pa = prologo([], env, { out: (s) => (o += s), err: (s) => (e += s) });
  return { pa, raiz, out: () => o, err: () => e };
}

const hijoFalso = (cuerpo: string) => [process.execPath, "-e", cuerpo];

test("argsHijo: el orden del bash, --max-turns siempre y la tarea después de --", () => {
  assert.deepEqual(argsHijo({ proyecto: "demo", modelo: "m", tarea: "-x raro" }), ["demo", "-m", "m", "--max-turns", "0", "--", "-x raro"]);
  assert.deepEqual(
    argsHijo({ proyecto: "demo", modelo: "m", tarea: "t", leer: true, seguir: true, mcp: true, maxTurns: 100, maxBudget: "2", runId: "i", tipo: "debug", okDueno: true, effortPedido: "high" }),
    ["demo", "-m", "m", "--leer", "--seguir", "--mcp", "--max-turns", "100", "--max-budget-usd", "2", "--id", "i", "--tipo", "debug", "--ok-dueno", "--effort", "high", "--", "t"],
  );
});

test("idCorrida: AAAAMMDD-HHMMSS-pid en hora local", () => {
  assert.equal(idCorrida(42, new Date(2026, 9, 28, 7, 5, 9)), "20261028-070509-42");
});

test("lanzarAsync: deja .jefe/.log/.pid antes de volver, el hijo recibe PA_TS y avisa el puesto", { skip: soloPosix("hijo suelto con señales POSIX") }, async () => {
  const { pa, out } = armar({ PA_JEFE: "jefe-1", PA_JEFE_ID: "id-1" });
  const dir = path.join(pa.state, "demo");
  mkdirSync(dir, { recursive: true });
  // el hijo: anota lo que recibió, toma "puesto 2" y se queda un rato (como el pa real corriendo)
  const cuerpo = `const fs=require("fs"),p=require("path");const d=${JSON.stringify(dir)};fs.writeFileSync(p.join(d,process.env.PA_TS+".args"),JSON.stringify({argv:process.argv.slice(1),async:process.env.PA_ASYNC,jefe:process.env.PA_JEFE_ID}));fs.writeFileSync(p.join(d,process.env.PA_TS+".puesto"),"2");setTimeout(()=>{},3000);`;
  let avisado = "";
  const ts = await lanzarAsync(pa, { proyecto: "Demo", slug: "demo", dir, leer: false, hijoArgs: ["demo", "--", "tarea"], comando: hijoFalso(cuerpo), avisarParalelo: (t, p) => void (avisado = `${t} ${p}`) });
  assert.match(ts, /^\d{8}-\d{6}-\d+$/);
  assert.equal(readFileSync(path.join(dir, `${ts}.jefe`), "utf8"), "jefe=jefe-1\njefe_id=id-1\n");
  assert.ok(existsSync(path.join(dir, `${ts}.log`)));
  const pid = Number(readFileSync(path.join(dir, `${ts}.pid`), "utf8"));
  assert.ok(pid > 0);
  const args = JSON.parse(readFileSync(path.join(dir, `${ts}.args`), "utf8")) as { argv: string[]; async: string; jefe: string };
  assert.deepEqual(args, { argv: ["demo", "--", "tarea"], async: "1", jefe: "id-1" });
  assert.equal(avisado, `${ts} 2`);
  assert.equal(out(), `pa: 'demo' lanzado en background en el puesto 2 (id: ${ts}, log: ${path.join(dir, `${ts}.log`)}).\npa: para esperarlo: pa --esperar 'Demo' --id ${ts}\n`);
  process.kill(pid, "SIGKILL");
});

test("lanzarAsync: --leer en cola (sin .jefe) y uno que muere antes de tomar puesto sale 1", { skip: soloPosix("hijo suelto con señales POSIX") }, async () => {
  const { pa, out, err } = armar();
  const dir = path.join(pa.state, "demo");
  mkdirSync(dir, { recursive: true });
  const cola = `require("fs").writeFileSync(require("path").join(${JSON.stringify(dir)},process.env.PA_TS+".cola"),"tope global: 10 workers vivos");setTimeout(()=>{},3000);`;
  const ts = await lanzarAsync(pa, { proyecto: "demo", slug: "demo", dir, leer: true, hijoArgs: [], comando: hijoFalso(cola) });
  assert.ok(existsSync(path.join(dir, `${ts}.leer`)));
  assert.ok(!existsSync(path.join(dir, `${ts}.jefe`)));
  assert.match(out(), /EN COLA: tope global: 10 workers vivos \(id: /);
  process.kill(Number(readFileSync(path.join(dir, `${ts}.pid`), "utf8")), "SIGKILL");

  // otra carpeta: el id lleva el pid de este proceso y en el mismo segundo sería el mismo
  const dir2 = path.join(pa.state, "otro");
  mkdirSync(dir2, { recursive: true });
  await assert.rejects(
    lanzarAsync(pa, { proyecto: "otro", slug: "otro", dir: dir2, leer: false, hijoArgs: [], comando: hijoFalso("process.exit(3)") }),
    (e: unknown) => e instanceof Salida && e.codigo === 1,
  );
  assert.match(err(), /murió antes de tomar el lock de un puesto\. Mirá el log: /);
});

test("verificacion: la sección, con tilde, ** y hasta el próximo encabezado; «ninguna» no cuenta", () => {
  const r = "RESULTADO: x\n**VERIFICACIÓN:** npm test\n  ok 3\nDECISION: nada";
  assert.equal(verificacionDe(r), " npm test\n  ok 3");
  assert.equal(verificadoDe(r), true);
  assert.equal(verificadoDe("RESULTADO: x\nVERIFICACION: ninguna, no hay tests"), false);
  assert.equal(verificadoDe("RESULTADO: x\nVERIFICACION:\nSIGUE: nada"), false);
  assert.equal(verificadoDe("RESULTADO: x"), false);
});

test("comparadorGlob: C por bytes, UTF-8 sin la puntuación", () => {
  const n = ["proy.running", "proy@2.running", "Proy.running"];
  assert.deepEqual([...n].sort(comparadorGlob({ LC_ALL: "C" })), ["Proy.running", "proy.running", "proy@2.running"]);
  assert.deepEqual([...n].sort(comparadorGlob({ LANG: "en_US.UTF-8" })), ["proy@2.running", "proy.running", "Proy.running"]);
});

test("matarArbolPa (POSIX): TERM y CONT a todo el árbol, KILL al que no salió y al pa el último", async () => {
  const senales: string[] = [];
  const vivos = new Set([10, 11, 12]);
  const r = await matarArbolPa("sid-1", 10, [10], {
    plat: "linux",
    escala: 0.01,
    arbolDe: (ps) => (ps.includes(10) ? [10, 11] : []),
    delSid: () => [12],
    vive: (p) => vivos.has(p),
    senal: (p, s) => {
      senales.push(`${s}:${p}`);
      if (s === "SIGKILL" || (s === "SIGTERM" && p === 11)) vivos.delete(p);
    },
  });
  assert.deepEqual(r, []);
  assert.deepEqual(senales, ["SIGTERM:10", "SIGTERM:11", "SIGTERM:12", "SIGCONT:10", "SIGCONT:11", "SIGCONT:12", "SIGKILL:12", "SIGKILL:10"]);
});

test("matarArbolPa (Windows): le pide al pa que pare por su lock y corta con taskkill lo que queda", async () => {
  const vivos = new Set([20, 21]);
  const pedidos: string[] = [];
  const cortados: number[] = [];
  const opciones = {
    plat: "win32" as const,
    escala: 0.01,
    arbolDe: () => [20, 21],
    delSid: () => [],
    vive: (p: number) => vivos.has(p),
    cortar: (p: number) => {
      cortados.push(p);
      vivos.delete(p);
    },
    pedir: async (c: string) => {
      pedidos.push(c);
      vivos.delete(20); // el pa sale solo
    },
  };
  assert.deepEqual(await matarArbolPa("", 20, [20], { ...opciones, canal: "/estado/lock/proy@2" }), []);
  assert.deepEqual(pedidos, ["/estado/lock/proy@2"]);
  assert.deepEqual(cortados, [21]);
  // sin canal (un --leer): taskkill a todos
  vivos.add(20).add(21);
  cortados.length = 0;
  assert.deepEqual(await matarArbolPa("", 20, [20], opciones), []);
  assert.deepEqual(cortados, [20, 21]);
});

test("canal de control: el pa que tiene el lock de puesto recibe la orden de parar", async () => {
  const canal = path.join(os.tmpdir(), `pa-async-canal-${process.pid}`);
  const recibidos: unknown[] = [];
  const lock = await tomar(canal, { alMensaje: (m) => void recibidos.push(m) });
  const { consultar } = await import("../electron/cli/base/lock.ts");
  assert.deepEqual(await consultar(canal, ORDEN_PARAR), { ok: true });
  assert.deepEqual(recibidos, [{ orden: "parar" }]);
  await lock?.liberar();
});

test("pidsDelSid: sólo los claude -p de esa conversación", () => {
  const procs = [
    { pid: 1, args: ["claude", "-p", "--session-id", "s1", "tarea con -p"], linea: "" },
    { pid: 2, args: ["claude", "--resume", "s1"], linea: "" }, // interactivo: no
    { pid: 3, args: ["tail", "-f", "/x/s1.jsonl"], linea: "" },
    { pid: 4, args: ["claude", "--print", "--resume", "s1"], linea: "" },
    { pid: 5, args: ["claude", "-p", "--session-id", "s2"], linea: "" },
  ];
  assert.deepEqual(pidsDelSid("s1", "linux", procs), [1, 4]);
  assert.deepEqual(pidsDelSid("", "linux", procs), []);
});

test("lineaRama: commits sin integrar y el solapamiento con otra rama", { skip: soloPosix("git con sh") }, async () => {
  const { pa } = armar();
  const repo = path.join(pa.home, "proy");
  mkdirSync(repo, { recursive: true });
  const g = (...a: string[]) => spawnSync("git", ["-C", repo, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" }).stdout.trim();
  g("init", "-q", "-b", "main");
  g("commit", "-q", "--allow-empty", "-m", "init");
  const base = g("rev-parse", "HEAD");
  for (const [rama, archivo] of [["pa/proy/a", "x.ts"], ["pa/proy/b", "x.ts"]] as const) {
    g("checkout", "-q", "-b", rama, base);
    writeFileSync(path.join(repo, archivo), rama);
    g("add", archivo);
    g("commit", "-q", "-m", `cambio ${rama}`);
  }
  g("checkout", "-q", "main");
  const dir = path.join(pa.state, "proy");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "T1.corrida"), `rama=pa/proy/a\nbase=${base}\nruta_trabajo=${repo}\nproyecto=demo\n`);
  writeFileSync(path.join(dir, "T2.corrida"), `rama=pa/proy/b\nbase=${base}\nruta_trabajo=${repo}\nproyecto=demo\n`);
  const s = await lineaRama(pa, path.join(dir, "T1.json"));
  assert.equal(
    s,
    `— rama pa/proy/a: 1 commit(s) sobre ${base.slice(0, 7)}. NO está en main hasta que la integres: pa 'demo' --integrar T1\n` +
      "— ojo: la corrida T2 (sin integrar) también toca x.ts: la que se integre segunda puede chocar.\n",
  );
  // integrada a mano: ya no hay nada que integrar
  g("merge", "-q", "--ff-only", "pa/proy/a");
  assert.equal(await lineaRama(pa, path.join(dir, "T1.json")), "— rama pa/proy/a: sus commits ya están todos en el tree principal. Nada que integrar.\n");
});

test("esperar --id debajo de --esperar-todos: la que ya cobró otra espera sale OTRA_ESPERA y no se cuenta", async () => {
  const { pa, out, err } = armar();
  const dir = path.join(pa.state, "proy");
  mkdirSync(path.join(pa.state, "lock"), { recursive: true });
  writeFileSync(path.join(pa.state, "lock", "proy"), "");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "T1.entregado"), "rc=0\n");
  writeFileSync(path.join(dir, "T1.log"), "");
  const hijo: Pa = { ...pa, env: { ...pa.env, PA_ESPERA_TODOS: "1" } };
  await assert.rejects(cmdEsperar(hijo, ["proy", "--id", "T1"]), (e: unknown) => e instanceof Salida && e.codigo === OTRA_ESPERA);
  // en la cola de --esperar-todos: T3 vive cuando se arma la lista y T4 ya tiene resultado; mientras se espera a T3, otra espera
  // se lleva el de T4 (lo renombra a .entregado) y T3 termina
  writeFileSync(path.join(dir, "T3.pid"), String(process.pid));
  writeFileSync(path.join(dir, "T3.log"), "");
  writeFileSync(path.join(dir, "T4.pid"), "999999999");
  writeFileSync(path.join(dir, "T4.log"), "");
  writeFileSync(path.join(dir, "T4.listo"), "rc=0\n");
  const t = setTimeout(() => {
    renameSync(path.join(dir, "T4.listo"), path.join(dir, "T4.entregado"));
    writeFileSync(path.join(dir, "T3.listo"), "rc=4\n");
  }, 50);
  const rc = await cmdEsperarTodos(pa, [], { pausaMs: 20 });
  clearTimeout(t);
  assert.equal(rc, 4);
  assert.match(out(), /══ proy \(corrida T3\) ══\n— corrida T3 · rc=4\n\n— 1 corrida\(s\) cobradas \(1 ya las había entregado otra espera\) · rc=4\n$/);
  assert.match(err(), /pa: esperando 2 corrida\(s\)…/);
});
