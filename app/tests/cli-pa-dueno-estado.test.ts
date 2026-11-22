// PA-CLI-3 / B079: dos proyectos con la misma carpeta final (mismo slug) comparten `$STATE/<slug>`. La marca `ruta` del estado dice de
// quién es: el segundo proyecto sale 87 (también con --leer y --aca, que no pasan por el worktree) sin tocar el estado del primero.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { testPosix } from "./plataforma.ts";
import { main, type Deps } from "../electron/cli/pa/cli.ts";
import { prologo, type Env, type Io } from "../electron/cli/pa/entorno.ts";
import { cmdHilos } from "../electron/cli/pa/hilos.ts";
import { lanzarProyecto } from "../electron/cli/pa/orquesta.ts";
import type { Reparto } from "../electron/cli/pa/programas.ts";
import { guardarDuenoDelEstado, type Proyecto } from "../electron/cli/pa/worktrees.ts";

const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pa-dueno-")));
after(() => rmSync(raiz, { recursive: true, force: true }));

const captura = (): Io & { o: string; e: string } => {
  const c = { o: "", e: "", out: (s: string) => void (c.o += s), err: (s: string) => void (c.e += s) };
  return c;
};

const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-C", cwd, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });

function repo(ruta: string): string {
  mkdirSync(ruta, { recursive: true });
  git(ruta, "init", "-q", "-b", "main");
  writeFileSync(path.join(ruta, "a.txt"), "a\n");
  git(ruta, "add", "a.txt");
  git(ruta, "commit", "-q", "-m", "init");
  return ruta;
}

let n = 0;
/** Un sandbox: estado, registry con `uno` (/…/uno/demo) y `dos` (/…/dos/demo, otro repo): los dos con slug `demo`. */
function sandbox() {
  const base = path.join(raiz, `s${++n}`);
  const home = path.join(base, "home");
  const estado = path.join(base, "estado");
  const uno = repo(path.join(base, "uno", "demo"));
  const dos = repo(path.join(base, "dos", "demo"));
  mkdirSync(path.join(home, ".config", "proyectos"), { recursive: true });
  const reg = path.join(home, ".config", "proyectos", "registry.json");
  writeFileSync(reg, JSON.stringify({ projects: [{ name: "uno", path: uno }, { name: "dos", path: dos }] }));
  const env: Env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|REPARTO_|CLAUDE)/.test(k)) env[k] = v;
  Object.assign(env, { HOME: home, USER: "gonza", XDG_CONFIG_HOME: path.join(home, ".config"), PA_STATE: estado, PROYECTOS_REGISTRY: reg, TRAMA_MODELOS: path.join(home, "no-hay.json"), PA_JEFE: "", PA_JEFE_ID: "" });
  const dir = path.join(estado, "demo");
  return { base, env, estado, uno, dos, dir, marca: path.join(dir, "ruta"), reg };
}

const repartoFalso = (): Reparto => ({ ruta: "/falso/reparto", ejecutable: () => true, enfriado: async () => null, elegir: async () => ({ rc: 1, salida: "" }), tabla: async () => "", plan: () => 0 });

async function pa(argv: string[], env: Env, deps: Deps = {}) {
  const io = captura();
  const rc = await main(argv, env, io, { reparto: () => repartoFalso(), proyecto: { lanzar: lanzarProyecto() }, ...deps });
  return { rc, o: io.o, e: io.e };
}

/** Lo que hay en el estado del slug (para comprobar que el segundo no lo tocó). */
const estadoDe = (dir: string) => (existsSync(dir) ? spawnSync("find", [dir, "-type", "f"], { encoding: "utf8" }).stdout.split("\n").sort().join("\n") : "");

const BRIEF = "Objetivo: x\nArchivos: a.ts\nListo cuando: pasa\nCómo verificar: npm test\nNo tocar: b.ts";

for (const [nombre, extra] of [
  ["normal", []],
  ["--leer", ["--leer"]],
  ["--aca", ["--aca"]],
] as const) {
  testPosix(`dos clones con la misma carpeta (${nombre}): el segundo sale 87 y no toca el estado`, async () => {
    const s = sandbox();
    // el primero reclama el estado: la marca se escribe aunque el lanzamiento siga después (acá sale por no tener claude, da igual)
    mkdirSync(s.dir, { recursive: true });
    writeFileSync(s.marca, `${s.uno}\n`);
    const antes = estadoDe(s.dir);
    const r = await pa(["dos", "--sin-jefe", ...extra, BRIEF], s.env);
    assert.equal(r.rc, 87, r.e);
    assert.match(r.e, new RegExp(`ya es del proyecto en ${s.uno}`));
    assert.ok(r.e.includes(s.dos), r.e);
    assert.match(r.e, /Renombrá una carpeta/);
    assert.equal(readFileSync(s.marca, "utf8"), `${s.uno}\n`);
    assert.equal(estadoDe(s.dir), antes);
  });
}

testPosix("--hilos sigue andando con dos proyectos del mismo slug (no pasa por la guarda)", async () => {
  const s = sandbox();
  mkdirSync(s.dir, { recursive: true });
  writeFileSync(s.marca, `${s.uno}\n`);
  const r = await pa(["--hilos", "--json"], s.env, { globales: { hilos: (a, p) => cmdHilos(p, a) } });
  assert.equal(r.rc, 0, r.e);
  assert.doesNotMatch(r.e, /Renombrá/);
});

/** Un Proyecto para la guarda sola (sin pasar por main). */
function proy(s: ReturnType<typeof sandbox>, ruta: string, plat: "linux" | "win32" = "linux", io = captura()): Proyecto {
  const p = prologo([], s.env, io, plat);
  return { pa: p, proyecto: "demo", ruta, slug: "demo", dir: s.dir, ts: "", motor: "claude" };
}

testPosix("guarda: sin marca la escribe; la misma ruta sigue", async () => {
  const s = sandbox();
  assert.equal(await guardarDuenoDelEstado(proy(s, s.uno)), true);
  assert.equal(readFileSync(s.marca, "utf8"), `${s.uno}\n`);
  assert.equal(await guardarDuenoDelEstado(proy(s, s.uno)), true);
});

testPosix("guarda: otro repo en otra ruta que existe sale false con las dos rutas en el aviso", async () => {
  const s = sandbox();
  await guardarDuenoDelEstado(proy(s, s.uno));
  const io = captura();
  assert.equal(await guardarDuenoDelEstado(proy(s, s.dos, "linux", io)), false);
  assert.ok(io.e.includes(s.uno) && io.e.includes(s.dos), io.e);
  assert.equal(readFileSync(s.marca, "utf8"), `${s.uno}\n`);
});

testPosix("guarda: proyecto movido (la ruta anotada ya no existe) adopta la nueva", async () => {
  const s = sandbox();
  await guardarDuenoDelEstado(proy(s, s.uno));
  const movido = path.join(s.base, "mudado", "demo");
  mkdirSync(path.dirname(movido), { recursive: true });
  renameSync(s.uno, movido);
  assert.equal(await guardarDuenoDelEstado(proy(s, movido)), true);
  assert.equal(readFileSync(s.marca, "utf8"), `${movido}\n`);
});

testPosix("guarda: el mismo repo en otra ruta (clon de worktree) sigue y no cambia la marca", async () => {
  const s = sandbox();
  await guardarDuenoDelEstado(proy(s, s.uno));
  const wt = path.join(s.base, "wt", "demo");
  mkdirSync(path.dirname(wt), { recursive: true });
  git(s.uno, "worktree", "add", "--detach", wt, "HEAD");
  assert.equal(await guardarDuenoDelEstado(proy(s, wt)), true);
  assert.equal(readFileSync(s.marca, "utf8"), `${s.uno}\n`);
});

test("guarda en Windows (plat win32): la misma ruta con otras mayúsculas y barras sigue; una ruta anotada que no existe se adopta", async () => {
  const s = sandbox();
  mkdirSync(s.dir, { recursive: true });
  // rutas de Windows de mentira: no existen en este disco, así que no se mezclan con las reales de Linux
  writeFileSync(s.marca, "C:\\Proyectos\\Demo\n");
  assert.equal(await guardarDuenoDelEstado(proy(s, "c:\\proyectos\\demo", "win32")), true);
  assert.equal(readFileSync(s.marca, "utf8"), "C:\\Proyectos\\Demo\n");
  // otra ruta, la anotada no existe en este disco: se adopta
  assert.equal(await guardarDuenoDelEstado(proy(s, "D:\\Otro\\demo", "win32")), true);
  assert.equal(readFileSync(s.marca, "utf8"), "D:\\Otro\\demo\n");
});
