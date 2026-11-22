// Las guardias de git y cargo de los workers de codex, dsh y opencode: los scripts de bash (Linux) y su port a Node (Windows, git.cmd →
// git.mjs) tienen que bloquear y dejar pasar lo mismo; y `conShims` arma el PATH de cada plataforma.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { codexShims, dshCorrer, opencodeCorrer } from "../electron/cli/pa/motores/chequeo.ts";
import { conShims } from "../electron/cli/pa/motores/llamada.ts";
// @ts-expect-error módulo .mjs del motor, sin tipos
import { buscarReal, guardiaCargo, guardiaGit, subcomandoGit } from "../../motor/codex/bin/guardias.mjs";

const BIN = fileURLToPath(new URL("../../motor/codex/bin/", import.meta.url));
const enWindows = process.platform === "win32";

/** Casos: [argumentos, ¿bloquea?]. */
const GIT: [string[], boolean][] = [
  [["stash"], true],
  [["stash", "push", "-u"], true],
  [["stash", "pop"], true],
  [["-C", "/x", "stash"], true],
  [["stash", "list"], false],
  [["stash", "show"], false],
  [["add", "-A"], true],
  [["add", "--all"], true],
  [["add", "-u"], true],
  [["add", "--update"], true],
  [["add", "."], true],
  [["add", "-fA"], true],
  [["add", "--", "."], true],
  [["add", "a.ts", "b.ts"], false],
  [["add", "--", "a.ts"], false],
  [["add", "-f", "x"], false],
  [["commit", "-a", "-m", "x"], true],
  [["commit", "--all", "-m", "x"], true],
  [["commit", "-am", "x"], true],
  [["-c", "a=b", "commit", "-a"], true],
  [["commit", "-m", "hay -a en el mensaje"], false],
  [["commit", "-m", "x", "--amend"], false],
  [["commit", "-F", "-a"], false],
  [["commit", "-m", "x", "--", "-a"], false],
  [["status"], false],
  [["log", "--all"], false],
  [["branch", "-a"], false],
  [[], false],
];
const CARGO: [string[], boolean][] = [
  [["build", "--release"], true],
  [["build", "-r"], true],
  [["build", "--profile=release"], true],
  [["build", "--profile", "release"], true],
  [["+nightly", "build", "--release"], true],
  [["install", "x"], true],
  [["clean"], true],
  [["+stable", "clean"], true],
  [["build"], false],
  [["test", "--", "--release"], false],
  [["test", "--profile", "dev"], false],
  [["check"], false],
  [["run", "--", "install"], false],
];

for (const [args, bloquea] of GIT) {
  test(`guardiaGit(${JSON.stringify(args)}) ${bloquea ? "bloquea" : "pasa"}`, () => assert.equal(guardiaGit(args) !== null, bloquea));
}
for (const [args, bloquea] of CARGO) {
  test(`guardiaCargo(${JSON.stringify(args)}) ${bloquea ? "bloquea" : "pasa"}`, () => assert.equal(guardiaCargo(args) !== null, bloquea));
}

test("subcomandoGit salta las opciones globales con valor", () => {
  assert.deepEqual(subcomandoGit(["-C", "x", "-c", "a=b", "--no-pager", "commit", "-m", "m"]), { sub: "commit", resto: ["-m", "m"] });
});

/** Una carpeta con un git y un cargo falsos que imprimen sus argumentos y salen con 7. */
function conFalsos(f: (d: string) => void) {
  const d = mkdtempSync(path.join(os.tmpdir(), "guardias-"));
  try {
    for (const n of ["git", "cargo"]) {
      if (enWindows) writeFileSync(path.join(d, `${n}.cmd`), `@echo off\r\necho FALSO-${n} %*\r\nexit /b 7\r\n`);
      else {
        writeFileSync(path.join(d, n), `#!/bin/sh\necho "FALSO-${n} $*"\nexit 7\n`);
        chmodSync(path.join(d, n), 0o755);
      }
    }
    f(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

const correrMjs = (n: string, args: string[], d: string) =>
  spawnSync(process.execPath, [path.join(BIN, `${n}.mjs`), ...args], { encoding: "utf8", env: { ...process.env, PATH: `${BIN}${path.delimiter}${d}${path.delimiter}${process.env.PATH ?? ""}` }, windowsHide: true });
const correrSh = (n: string, args: string[], d: string) =>
  spawnSync("/bin/bash", [path.join(BIN, n), ...args], { encoding: "utf8", env: { ...process.env, PATH: `${BIN}${path.delimiter}${d}${path.delimiter}${process.env.PATH ?? ""}` }, windowsHide: true });

test("git.mjs: lo bloqueado sale con 2 y BLOQUEADO por stderr; lo permitido llega al git de verdad con su código", () =>
  conFalsos((d) => {
    const b = correrMjs("git", ["add", "-A"], d);
    assert.equal(b.status, 2);
    assert.match(b.stderr, /^BLOQUEADO: nada de 'git add -A\/-u'/);
    assert.equal(b.stdout, "");
    const ok = correrMjs("git", ["add", "a.ts"], d);
    assert.equal(ok.status, 7);
    // en Windows el git falso es un .cmd: va por el shell con cada argumento entre comillas dobles (el git real es un .exe, sin shell)
    assert.match(ok.stdout, /FALSO-git "?add"? "?a\.ts"?/);
  }));

test("cargo.mjs: lo bloqueado sale con 2; lo permitido llega al cargo de verdad con su código", () =>
  conFalsos((d) => {
    const b = correrMjs("cargo", ["build", "--release"], d);
    assert.equal(b.status, 2);
    assert.match(b.stderr, /^BLOQUEADO: build de release/);
    const ok = correrMjs("cargo", ["build"], d);
    assert.equal(ok.status, 7);
    assert.match(ok.stdout, /FALSO-cargo "?build"?/);
  }));

test("sin el binario de verdad en el PATH sale con 127 y lo dice", () =>
  conFalsos((d) => {
    const vacio = mkdtempSync(path.join(os.tmpdir(), "guardias-vacio-"));
    try {
      const r = spawnSync(process.execPath, [path.join(BIN, "git.mjs"), "status"], { encoding: "utf8", env: { ...process.env, PATH: `${BIN}${path.delimiter}${vacio}` }, windowsHide: true });
      assert.equal(r.status, 127);
      assert.match(r.stderr, /no encuentro el git de verdad/);
    } finally {
      rmSync(vacio, { recursive: true, force: true });
    }
    assert.ok(d);
  }));

test("buscarReal salta la carpeta de los shims y respeta PATHEXT en Windows", () => {
  const existe = (set: string[]) => (f: string) => set.includes(f);
  const win = buscarReal("git", {
    plat: "win32",
    aqui: "C:\\t\\codex\\bin",
    path: "C:\\t\\codex\\bin;C:\\git\\cmd;",
    pathext: ".COM;.EXE;.CMD",
    esArchivo: (f: string) => existe(["C:\\t\\codex\\bin\\git.EXE", "C:\\git\\cmd\\git.EXE"])(f.replace(/\//g, "\\")),
  });
  assert.equal(win?.replace(/\//g, "\\"), "C:\\git\\cmd\\git.EXE");
  const barras = (f: string) => f.replace(/\\/g, "/");
  const lin = buscarReal("git", { plat: "linux", aqui: "/s", path: "/s:/usr/bin", esArchivo: (f: string) => ["/usr/bin/git", "/s/git"].includes(barras(f)) });
  assert.equal(barras(lin), "/usr/bin/git");
  assert.equal(buscarReal("git", { plat: "linux", aqui: "/s", path: "/s", esArchivo: () => true }), null);
});

// Paridad: el script de bash (Linux) y el de Node dicen y hacen lo mismo con cada caso.
test("paridad: git y cargo de bash y de Node dan el mismo código y el mismo stderr/stdout", { skip: enWindows }, () =>
  conFalsos((d) => {
    for (const [n, casos] of [["git", GIT], ["cargo", CARGO]] as const) {
      for (const [args] of casos) {
        const a = correrSh(n, args, d);
        const b = correrMjs(n, args, d);
        assert.deepEqual({ s: b.status, o: b.stdout, e: b.stderr }, { s: a.status, o: a.stdout, e: a.stderr }, `${n} ${JSON.stringify(args)}`);
      }
    }
  }));

test("conShims en Windows: los .cmd primero en el PATH (con ;) y PA_NODE con el node de pa", () => {
  const env = { PATH: "C:\\Windows", PA_CODEX_SHIMS: "C:\\t\\app\\codex\\bin" };
  const r = conShims(env, "win32");
  assert.equal(r.PATH, "C:\\t\\app\\codex\\bin;C:\\Windows");
  assert.equal(r.PA_NODE, process.execPath);
  assert.equal(conShims({ ...env, PA_NODE: "C:\\n\\node.exe" }, "win32").PA_NODE, "C:\\n\\node.exe");
  assert.equal(env.PATH, "C:\\Windows", "no toca el entorno recibido");
});

test("conShims en Linux: la carpeta de los scripts primero en el PATH, sin PA_NODE", () => {
  const r = conShims({ PATH: "/usr/bin", PA_CODEX_SHIMS: "/m/codex/bin" }, "linux");
  assert.equal(r.PATH, "/m/codex/bin:/usr/bin");
  assert.equal(r.PA_NODE, undefined);
});

test("codexShims: motor/codex/bin; en el payload de Windows (sin motor/) app/codex/bin", () => {
  const env = { TRAMA_MOTOR_DIR: path.join(os.tmpdir(), "m") };
  const motor = path.join(env.TRAMA_MOTOR_DIR, "codex", "bin");
  const payload = path.join(env.TRAMA_MOTOR_DIR, "app", "codex", "bin");
  assert.equal(codexShims(env, (f) => f === path.join(motor, "git")), motor);
  assert.equal(codexShims(env, (f) => f === path.join(payload, "git.mjs")), payload);
  assert.equal(codexShims(env, () => false), motor);
  assert.equal(codexShims({ ...env, PA_CODEX_SHIMS: "/otra" }, () => false), "/otra");
});

test("dshCorrer y opencodeCorrer: motor/<x>/correr.mjs; en el payload de Windows app/<x>/correr.mjs", () => {
  const env = { TRAMA_MOTOR_DIR: path.join(os.tmpdir(), "m") };
  for (const [fn, x, var_] of [[dshCorrer, "dsh", "PA_DSH_CORRER"], [opencodeCorrer, "opencode", "PA_OPENCODE_CORRER"]] as const) {
    const motor = path.join(env.TRAMA_MOTOR_DIR, x, "correr.mjs");
    const payload = path.join(env.TRAMA_MOTOR_DIR, "app", x, "correr.mjs");
    assert.equal(fn(env, (f) => f === motor), motor);
    assert.equal(fn(env, (f) => f === payload), payload);
    assert.equal(fn(env, () => false), motor, "sin ninguno, la de motor/ (para el «falta …»)");
    assert.equal(fn({ ...env, [var_]: "/otro.mjs" }, () => false), "/otro.mjs");
  }
});

test("los .cmd llaman a su .mjs con PA_NODE (o node), en CRLF", () => {
  for (const n of ["git", "cargo"]) {
    const cmd = readFileSync(path.join(BIN, `${n}.cmd`), "utf8");
    assert.match(cmd, /set "ELECTRON_RUN_AS_NODE=1"/, "PA_NODE puede ser el Electron de la app");
    assert.match(cmd, new RegExp(`"%PA_NODE%" "%~dp0${n}\\.mjs" %\\*`));
    assert.match(cmd, /set "PA_NODE=node"/);
    assert.ok(!cmd.replace(/\r\n/g, "").includes("\n"), "sólo CRLF");
  }
});
