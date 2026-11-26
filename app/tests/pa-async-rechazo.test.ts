// `pa --async`: el hijo que rechaza el pedido con un error de uso (rc 2) antes de tomar puesto no deja una corrida «muerta en cola»
// en `pa --estado` (medido: shell/20261119-034945-1556780, `--effort` con un modelo de agy). El padre ya valida antes de soltar al hijo;
// esto cubre al hijo que se entera tarde (después de que el padre volvió).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { cmdEstado } from "../electron/cli/pa/async.ts";
import { main, type Deps } from "../electron/cli/pa/cli.ts";
import { prologo, type Env } from "../electron/cli/pa/entorno.ts";
import type { Reparto } from "../electron/cli/pa/programas.ts";

const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pa-async-rechazo-")));
after(() => rmSync(raiz, { recursive: true, force: true }));

const home = path.join(raiz, "home");
const proyecto = path.join(raiz, "demo");
const estado = path.join(raiz, "estado");
mkdirSync(path.join(home, ".config", "proyectos"), { recursive: true });
mkdirSync(proyecto, { recursive: true });
spawnSync("git", ["-C", proyecto, "init", "-q", "-b", "main"], { windowsHide: true });
const registry = path.join(home, ".config", "proyectos", "registry.json");
writeFileSync(registry, JSON.stringify({ projects: [{ name: "demo", path: proyecto }] }));

const entorno = (extra: Env = {}): Env => {
  const env: Env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|REPARTO_|CLAUDE)/.test(k)) env[k] = v;
  return Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    USER: "gonza",
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PA_STATE: estado,
    PROYECTOS_REGISTRY: registry,
    TRAMA_MODELOS: path.join(home, "no-hay.json"),
    PA_JEFE: "",
    PA_JEFE_ID: "",
    ...extra,
  });
};

const repartoFalso: Reparto = {
  ruta: "/falso/reparto",
  ejecutable: () => true,
  enfriado: async () => null,
  elegir: async () => ({ rc: 1, salida: "" }),
  tabla: async () => "",
  cuentaPara: async () => "",
  plan: () => 0,
};
const deps: Deps = { reparto: () => repartoFalso, proyecto: { lanzar: () => 0 } };

/** Lo que deja `lanzarAsync` antes del fork: `.log`, `.jefe` y `.pid` (más `.leer`). */
function rastroDelPadre(d: string, id: string, leer = false): void {
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, `${id}.log`), "");
  writeFileSync(path.join(d, `${id}.jefe`), "jefe=x\njefe_id=y\n");
  writeFileSync(path.join(d, `${id}.pid`), "999999999");
  if (leer) writeFileSync(path.join(d, `${id}.leer`), "");
}

const salida = async (): Promise<string> => {
  let o = "";
  await cmdEstado(prologo([], entorno(), { out: (s) => (o += s), err: () => {} }));
  return o;
};

test("hijo de --async con un error de uso (rc 2) antes de tomar puesto: no queda .pid ni .jefe y --estado no lo lista", async () => {
  const id = "20261125-120000-111";
  const d = path.join(estado, "demo");
  rastroDelPadre(d, id);
  let e = "";
  const rc = await main(["demo", "-m", "agy:claude-sonnet-5-5-high", "--effort", "high", "--", "tarea"], entorno({ PA_ASYNC: "1", PA_TS: id }), { out: () => {}, err: (s) => (e += s) }, deps);
  assert.equal(rc, 2);
  assert.match(e, /--effort no va con 'agy:claude-sonnet-5-5-high'/);
  for (const x of ["pid", "jefe"]) assert.equal(existsSync(path.join(d, `${id}.${x}`)), false, x);
  assert.equal(existsSync(path.join(d, `${id}.log`)), true, "el .log se queda");
  assert.doesNotMatch(await salida(), /MURIÓ/);
});

test("lo mismo con --leer: se va también la marca .leer", async () => {
  const id = "20261125-120000-222";
  const d = path.join(estado, "demo");
  rastroDelPadre(d, id, true);
  const rc = await main(["demo", "--leer", "-m", "agy:claude-sonnet-5-5-high", "--effort", "high", "--", "tarea"], entorno({ PA_ASYNC: "1", PA_TS: id }), { out: () => {}, err: () => {} }, deps);
  assert.equal(rc, 2);
  for (const x of ["pid", "jefe", "leer"]) assert.equal(existsSync(path.join(d, `${id}.${x}`)), false, x);
  assert.doesNotMatch(await salida(), /MURIÓ/);
});

test("sin PA_ASYNC (primer plano) o con la corrida ya con puesto, no se borra nada", async () => {
  const d = path.join(estado, "demo");
  const a = "20261125-120000-333";
  rastroDelPadre(d, a);
  const rc = await main(["demo", "-m", "agy:claude-sonnet-5-5-high", "--effort", "high", "--", "tarea"], entorno({ PA_TS: a }), { out: () => {}, err: () => {} }, deps);
  assert.equal(rc, 2);
  assert.equal(existsSync(path.join(d, `${a}.pid`)), true);

  const b = "20261125-120000-444";
  rastroDelPadre(d, b);
  writeFileSync(path.join(d, `${b}.puesto`), "1");
  await main(["demo", "-m", "agy:claude-sonnet-5-5-high", "--effort", "high", "--", "tarea"], entorno({ PA_ASYNC: "1", PA_TS: b }), { out: () => {}, err: () => {} }, deps);
  assert.equal(existsSync(path.join(d, `${b}.pid`)), true);
  assert.equal(readFileSync(path.join(d, `${b}.puesto`), "utf8"), "1");
});
