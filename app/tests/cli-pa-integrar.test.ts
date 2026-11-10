// cli/pa/ramas.ts: --integrar y la búsqueda de repos-empujar.
//  · --integrar no compite con los workers: si la rama no está checkouteada en ningún worktree, rebasea en el PUESTO RESERVADO
//    de integrar (`<slug>@integrar`), que tiene su propio candado (dos --integrar no se pisan).
//  · repos-empujar no es del repo (vive en ~/.local/bin): si el motor no la trae, se busca en el PATH antes de avisar que falta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prologo, type Env } from "../electron/cli/pa/entorno.ts";
import { cmdIntegrar, empujarMain, rutaEmpujar } from "../electron/cli/pa/ramas.ts";
import { fijarProyecto, lockDePuesto, PUESTO_INTEGRAR, type Proy } from "../electron/cli/pa/ramas-base.ts";
import { probar, tomar, type Lock } from "../electron/cli/base/lock.ts";
import { testPosix } from "./plataforma.ts";

const ID = "20261110-100000-1";

function armar(extra: Env = {}) {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pa-integrar-"));
  const state = path.join(raiz, "estado");
  const ruta = path.join(raiz, "demo");
  mkdirSync(ruta, { recursive: true });
  const git = (...a: string[]) => spawnSync("git", ["-C", ruta, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "init");
  let err = "";
  let out = "";
  const env: Env = {
    HOME: raiz,
    PA_STATE: state,
    PROYECTOS_REGISTRY: path.join(raiz, "registry.json"),
    PATH: process.env.PATH ?? "",
    // sin configuración de empuje: el empuje no hace nada (nada de ~/.config/trama/empuje.json de la máquina)
    TRAMA_EMPUJE: path.join(raiz, "no-hay-empuje.json"),
    ...extra,
  };
  const pa = prologo([], env, { out: (s) => (out += s), err: (s) => (err += s) });
  const x = fijarProyecto(pa, "demo", ruta);
  return { raiz, state, ruta, pa, x, git, err: () => err, out: () => out };
}

/** Una rama con un commit y su `.corrida` (como la de un worker que ya terminó). */
function corrida(s: ReturnType<typeof armar>, id = ID) {
  const base = s.git("rev-parse", "HEAD").stdout.trim();
  s.git("checkout", "-q", "-b", `pa/demo/${id}`);
  writeFileSync(path.join(s.ruta, "a.txt"), "x\n");
  s.git("add", "-A");
  s.git("commit", "-q", "-m", "trabajo");
  s.git("checkout", "-q", "main");
  mkdirSync(s.x.dir, { recursive: true });
  writeFileSync(path.join(s.x.dir, `${id}.corrida`), `ruta_trabajo=${s.ruta}\nrama=pa/demo/${id}\nbase=${base}\nproyecto=demo\norigen=\nleer=0\npuesto=1\n`);
  return base;
}

/** Un `pa` con el motor vacío (sin repos-empujar) y otro PATH. */
function paConPath(s: ReturnType<typeof armar>, bin: string, extra: Env = {}) {
  const env: Env = { ...s.pa.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, ...extra };
  return { ...s.pa, bin: path.join(s.raiz, "motor-vacio"), env };
}

test("integrar: con los 3 puestos ocupados por workers, integra igual (puesto reservado de integrar)", async () => {
  const s = armar();
  corrida(s);
  // los tres puestos tomados por workers vivos
  const locks: Lock[] = [];
  for (const k of ["1", "2", "3"]) {
    const l = await tomar(lockDePuesto(s.x, k), { plat: s.pa.plat, env: s.pa.env });
    assert.ok(l, `no se pudo tomar el puesto ${k}`);
    locks.push(l);
  }
  try {
    const rc = await cmdIntegrar(s.x, ID);
    assert.equal(rc, 0, s.err());
    // la rama entró a main
    assert.match(s.git("log", "--oneline", "main").stdout, /trabajo/);
    // y se rebaseó en el puesto reservado, no en uno de los workers
    assert.equal(existsSync(path.join(s.state, "worktrees", `demo@${PUESTO_INTEGRAR}`)), true);
    // los puestos de los workers siguen tomados por sus workers (integrar no los tocó)
    for (const k of ["1", "2", "3"]) assert.equal(await probar(lockDePuesto(s.x, k), { plat: s.pa.plat, env: s.pa.env }), true, `el puesto ${k} se soltó`);
  } finally {
    for (const l of locks) await l.liberar();
  }
});

test("integrar: dos --integrar no se pisan (el candado del puesto de integrar)", async () => {
  const s = armar({ PA_INTEGRAR_ESPERA_S: "1" });
  corrida(s);
  const l = await tomar(lockDePuesto(s.x, PUESTO_INTEGRAR), { plat: s.pa.plat, env: s.pa.env });
  assert.ok(l);
  try {
    const rc = await cmdIntegrar(s.x, ID);
    assert.equal(rc, 75);
    assert.match(s.err(), /otro --integrar de 'demo' está usando el puesto de integrar/);
    // no entró nada a main
    assert.doesNotMatch(s.git("log", "--oneline", "main").stdout, /trabajo/);
  } finally {
    await l.liberar();
  }
});

test("integrar: con el puesto de integrar libre, dos integraciones seguidas entran (la segunda ya está integrada)", async () => {
  const s = armar();
  corrida(s);
  assert.equal(await cmdIntegrar(s.x, ID), 0, s.err());
  assert.equal(await cmdIntegrar(s.x, ID), 0, s.err());
  assert.match(s.git("log", "--oneline", "main").stdout, /trabajo/);
});

test("repos-empujar: si el motor no la tiene, se busca en el PATH", () => {
  const s = armar();
  const bin = path.join(s.raiz, "bin");
  mkdirSync(bin, { recursive: true });
  const falso = path.join(bin, s.pa.plat === "win32" ? "repos-empujar.cmd" : "repos-empujar");
  writeFileSync(falso, "echo falso\n");
  if (s.pa.plat !== "win32") chmodSync(falso, 0o755);
  const pa = paConPath(s, bin);
  assert.equal(rutaEmpujar(pa), falso);
  // PA_EMPUJAR gana sobre todo
  assert.equal(rutaEmpujar({ ...pa, env: { ...pa.env, PA_EMPUJAR: "/opt/otro/repos-empujar" } }), "/opt/otro/repos-empujar");
  // y la del motor, si está, gana sobre el PATH
  const motor = path.join(s.raiz, "motor-bin");
  mkdirSync(motor, { recursive: true });
  const delMotor = path.join(motor, s.pa.plat === "win32" ? "repos-empujar.cmd" : "repos-empujar");
  writeFileSync(delMotor, "echo motor\n");
  if (s.pa.plat !== "win32") chmodSync(delMotor, 0o755);
  assert.equal(rutaEmpujar({ ...pa, bin: motor }), delMotor);
});

testPosix("empujar: con la herramienta en el PATH, main se empuja y no avisa que falta", async () => {
  const s = armar();
  const bin = path.join(s.raiz, "bin");
  mkdirSync(bin, { recursive: true });
  const marca = path.join(s.raiz, "empujado.txt");
  writeFileSync(path.join(bin, "repos-empujar"), `#!/bin/sh\necho "$@" >> "${marca}"\n`);
  chmodSync(path.join(bin, "repos-empujar"), 0o755);
  s.git("remote", "add", "origin", s.raiz);
  writeFileSync(path.join(s.raiz, "empuje.json"), JSON.stringify({ remotos: ["origin"], etiqueta: "Remoto" }));
  const pa = paConPath(s, bin, { TRAMA_EMPUJE: path.join(s.raiz, "empuje.json") });
  const x: Proy = { ...s.x, pa };
  await empujarMain(x, s.ruta);
  assert.doesNotMatch(s.err(), /no encuentro repos-empujar/);
  assert.match(readFileSync(marca, "utf8"), /--repo .*--tope 10/);
});
