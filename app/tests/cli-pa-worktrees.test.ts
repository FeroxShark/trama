// cli/pa/worktrees.ts: worktree fijo por puesto, rama por corrida, trabajo huérfano, cachés compartidos y dirs de build, contra un
// repo git real en un tmp. Los nombres y la deducción de puestos son puros (también la disposición corta de Windows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { testPosix } from "./plataforma.ts";
import { prologo, type Env, type Pa } from "../electron/cli/pa/entorno.ts";
import {
  adoptarHuerfanas,
  desenlazarCaches,
  dirsDeBuild,
  enlazarCaches,
  escapar,
  limpiarBuild,
  prepararWorktree,
  puestoDeCorrida,
  puestoDeRuta,
  puestoParaRetomar,
  rutaPorcelain,
  slugDe,
  sufPuesto,
  suciosDe,
  wtDePuesto,
  wtDeRama,
  type Proyecto,
} from "../electron/cli/pa/worktrees.ts";

function armar(extra: Env = {}) {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pa-wt-")));
  const state = path.join(raiz, "estado");
  const ruta = path.join(raiz, "demo");
  mkdirSync(ruta, { recursive: true });
  const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-C", cwd, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
  git(ruta, "init", "-q", "-b", "main");
  writeFileSync(path.join(ruta, ".gitignore"), "node_modules/\n.env\n");
  git(ruta, "add", ".gitignore");
  git(ruta, "commit", "-q", "-m", "init");
  let err = "";
  const env: Env = {
    HOME: raiz,
    PA_STATE: state,
    PA_PROJ: path.join(raiz, "proj"),
    GIT_AUTHOR_NAME: "x",
    GIT_AUTHOR_EMAIL: "a@b",
    GIT_COMMITTER_NAME: "x",
    GIT_COMMITTER_EMAIL: "a@b",
    PATH: process.env.PATH,
    ...extra,
  };
  const pa = prologo([], env, { out: () => {}, err: (s) => (err += s) });
  mkdirSync(path.join(state, "demo"), { recursive: true });
  const proy = (ts: string, motor?: string): Proyecto => ({ pa, proyecto: "demo", ruta, slug: "demo", dir: path.join(state, "demo"), ts, motor });
  return { raiz, state, ruta, pa, proy, err: () => err, git };
}

test("nombres: slug, sufijo de puesto, línea porcelain y escapar como Claude Code", () => {
  assert.equal(slugDe("/home/x/Mi App (2)"), "mi-app--2-");
  assert.equal(slugDe("/home/x/llama.cpp"), "llama.cpp");
  assert.equal(sufPuesto("1"), "");
  assert.equal(sufPuesto(""), "");
  assert.equal(sufPuesto("3"), "@3");
  assert.equal(sufPuesto("aca"), "@aca");
  assert.equal(rutaPorcelain(" M src/a.ts"), "src/a.ts");
  assert.equal(rutaPorcelain("R  viejo.ts -> nuevo.ts"), "nuevo.ts");
  assert.equal(rutaPorcelain('?? "con espacio.txt"'), "con espacio.txt");
  assert.equal(escapar("/home/x/llama.cpp"), "-home-x-llama-cpp");
});

test("puestos por ruta: worktrees/<slug> es el 1, <slug>@k el k y cualquier otra el tree principal", () => {
  const pa = { state: "/e/pa", plat: "linux", env: { PA_STATE: "/e/pa" }, home: "/h" } as unknown as Pa;
  const x = { pa, slug: "demo" } as Proyecto;
  assert.equal(wtDePuesto(x, "1"), "/e/pa/worktrees/demo");
  assert.equal(wtDePuesto(x, "2"), "/e/pa/worktrees/demo@2");
  assert.equal(puestoDeRuta(x, "/e/pa/worktrees/demo"), "1");
  assert.equal(puestoDeRuta(x, "/e/pa/worktrees/demo@3"), "3");
  assert.equal(puestoDeRuta(x, "/e/pa/worktrees/demolito"), "aca");
  assert.equal(puestoDeRuta(x, "/home/x/demo"), "aca");
});

test("puestos por ruta en Windows: %LOCALAPPDATA%\\trama\\wt\\<slug>\\<k> (corto, MAX_PATH), sin distinguir mayúsculas", () => {
  const pa = { state: "C:\\U\\AppData\\Local\\trama\\estado\\pa", plat: "win32", env: { LOCALAPPDATA: "C:\\U\\AppData\\Local" }, home: "C:\\U" } as unknown as Pa;
  const x = { pa, slug: "demo" } as Proyecto;
  assert.equal(wtDePuesto(x, "1"), "C:\\U\\AppData\\Local\\trama\\wt\\demo\\1");
  assert.equal(wtDePuesto(x, "2"), "C:\\U\\AppData\\Local\\trama\\wt\\demo\\2");
  assert.equal(puestoDeRuta(x, "c:\\u\\appdata\\local\\trama\\wt\\DEMO\\2"), "2");
  assert.equal(puestoDeRuta(x, "C:\\U\\proyectos\\demo"), "aca");
  // con PA_STATE manda el estado (los tests): la disposición de siempre
  const pb = { ...pa, state: "C:\\e", env: { PA_STATE: "C:\\e" } } as unknown as Pa;
  assert.equal(wtDePuesto({ pa: pb, slug: "demo" } as Proyecto, "2"), path.win32.join("C:\\e", "worktrees", "demo@2"));
});

testPosix("preparar: rama nueva desde HEAD en el worktree del puesto, con node_modules, .env y la memoria compartidos", async () => {
  const s = armar();
  mkdirSync(path.join(s.ruta, "node_modules", "x"), { recursive: true });
  mkdirSync(path.join(s.ruta, "web", "node_modules"), { recursive: true });
  writeFileSync(path.join(s.ruta, ".env"), "CLAVE=1\n");
  writeFileSync(path.join(s.ruta, "Cargo.toml"), "[package]\n");
  const x = s.proy("20261028-100000-1");
  const t = await prepararWorktree(x, "", "2");
  assert.equal(t.codigo, 0);
  assert.equal(t.rutaTrabajo, path.join(s.state, "worktrees", "demo@2"));
  assert.equal(t.rama, "pa/demo/20261028-100000-1");
  assert.equal(t.base, s.git(s.ruta, "rev-parse", "HEAD").stdout.trim());
  assert.equal(t.usaWorktree, true);
  assert.equal(t.cargoTargetDir, path.join(s.ruta, "target"));
  assert.equal(s.git(t.rutaTrabajo, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim(), t.rama);
  assert.equal(readlinkSync(path.join(t.rutaTrabajo, "node_modules")), path.join(s.ruta, "node_modules"));
  assert.equal(readlinkSync(path.join(t.rutaTrabajo, "web", "node_modules")), path.join(s.ruta, "web", "node_modules"));
  assert.equal(readlinkSync(path.join(t.rutaTrabajo, ".env")), path.join(s.ruta, ".env"));
  const mem = path.join(s.raiz, "proj", escapar(t.rutaTrabajo), "memory");
  assert.equal(readlinkSync(mem), path.join(s.raiz, "proj", escapar(s.ruta), "memory"));
  assert.equal(await wtDeRama(x, t.rama), t.rutaTrabajo);
  // los enlaces sueltos no son trabajo (una carpeta sin trackear que sólo tiene un enlace sí aparece, como en el bash)
  assert.deepEqual(await suciosDe(x, t.rutaTrabajo), ["?? web/"]);
});

testPosix("preparar: un worker de otro proveedor no ve el .env ni las instrucciones locales (sí .venv)", async () => {
  const s = armar();
  writeFileSync(path.join(s.ruta, ".env"), "CLAVE=1\n");
  writeFileSync(path.join(s.ruta, "CLAUDE.local.md"), "local\n");
  mkdirSync(path.join(s.ruta, ".venv"));
  const t = await prepararWorktree(s.proy("t1", "agy"), "", "1");
  assert.equal(existsSync(path.join(t.rutaTrabajo, ".env")), false);
  assert.equal(existsSync(path.join(t.rutaTrabajo, "CLAUDE.local.md")), false);
  assert.equal(lstatSync(path.join(t.rutaTrabajo, ".venv")).isSymbolicLink(), true);
});

testPosix("preparar: --leer, --aca y un proyecto sin commits corren en el tree principal", async () => {
  const s = armar();
  const x = s.proy("t1");
  for (const t of [await prepararWorktree(x, "", "1", { leer: true }), await prepararWorktree(x, "", "aca")]) {
    assert.deepEqual(t, { codigo: 0, rutaTrabajo: s.ruta, rama: "", base: "", usaWorktree: false });
  }
  const vacio = path.join(s.raiz, "vacio");
  mkdirSync(vacio);
  s.git(vacio, "init", "-q");
  const t = await prepararWorktree({ ...x, ruta: vacio }, "", "1");
  assert.equal(t.rutaTrabajo, vacio);
  assert.equal(existsSync(path.join(s.state, "worktrees")), false);
});

testPosix("huérfano: lo que dejó un worker muerto se commitea en su rama, sin dirs de build ni symlinks externos", async () => {
  const s = armar();
  mkdirSync(path.join(s.ruta, "node_modules"));
  const a = await prepararWorktree(s.proy("20261028-100000-1"), "", "1");
  const wt = a.rutaTrabajo;
  writeFileSync(path.join(wt, "trabajo.txt"), "medio hecho\n");
  mkdirSync(path.join(wt, "target", "debug"), { recursive: true });
  writeFileSync(path.join(wt, "target", "debug", "bin"), "x");
  symlinkSync(os.tmpdir(), path.join(wt, "afuera"));
  const b = await prepararWorktree(s.proy("20261028-100000-2"), "", "1");
  assert.equal(b.codigo, 0);
  assert.equal(b.rama, "pa/demo/20261028-100000-2");
  assert.match(s.err(), /pa: no commiteo artefactos de build del huérfano: target\n/);
  assert.match(s.err(), /pa: OJO: 'afuera' es un symlink que apunta fuera del worktree/);
  assert.match(s.err(), /pa: el worktree demo tenía trabajo huérfano; quedó commiteado en 'pa\/demo\/20261028-100000-1'\.\n/);
  const archivos = s.git(s.ruta, "show", "--name-only", "--format=", "pa/demo/20261028-100000-1").stdout.trim().split("\n");
  assert.deepEqual(archivos, ["trabajo.txt"]);
  assert.equal(s.git(s.ruta, "log", "-1", "--format=%s", "pa/demo/20261028-100000-1").stdout.trim(), "pa: huérfano de pa/demo/20261028-100000-1");
});

testPosix("huérfano en HEAD suelto: rama pa/<slug>/huerfano-<ts> con su .corrida; adoptar las que no la tienen", async () => {
  const s = armar();
  const wt = path.join(s.state, "worktrees", "demo");
  mkdirSync(path.dirname(wt), { recursive: true });
  s.git(s.ruta, "worktree", "add", "-q", "--detach", wt, "HEAD");
  writeFileSync(path.join(wt, "suelto.txt"), "x\n");
  const t = await prepararWorktree(s.proy("20261028-100000-7"), "", "1");
  assert.equal(t.codigo, 0);
  const c = readFileSync(path.join(s.state, "demo", "huerfano-20261028-100000-7.corrida"), "utf8");
  assert.match(c, new RegExp(`^ruta_trabajo=${s.ruta}\nrama=pa/demo/huerfano-20261028-100000-7\nbase=[0-9a-f]{40}\nproyecto=demo\norigen=\nleer=0\npuesto=\njefe=\njefe_id=\n$`));
  s.git(s.ruta, "branch", "pa/demo/huerfano-20200101-000000-1");
  await adoptarHuerfanas(s.proy("x"));
  assert.match(readFileSync(path.join(s.state, "demo", "huerfano-20200101-000000-1.corrida"), "utf8"), /^ruta_trabajo=.*\nrama=pa\/demo\/huerfano-20200101-000000-1\n/);
});

testPosix("retomar: vuelve a la rama de la corrida en su puesto; rama borrada = tree principal; checkout imposible = 87", async () => {
  const s = armar();
  const x1 = s.proy("20261028-100000-1");
  const a = await prepararWorktree(x1, "", "2");
  writeFileSync(path.join(s.state, "demo", "20261028-100000-1.corrida"), `ruta_trabajo=${a.rutaTrabajo}\nrama=${a.rama}\nbase=${a.base}\npuesto=2\n`);
  // otra corrida usa el puesto 2 después
  await prepararWorktree(s.proy("20261028-100000-2"), "", "2");
  const x3 = s.proy("20261028-100000-3");
  assert.equal(await puestoParaRetomar(x3, "20261028-100000-1"), "2");
  const r = await prepararWorktree(x3, "20261028-100000-1", "2");
  assert.equal(r.codigo, 0);
  assert.equal(r.rama, a.rama);
  assert.equal(r.base, a.base);
  assert.equal(s.git(r.rutaTrabajo, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim(), a.rama);
  // sin puesto= en la .corrida: se deduce de ruta_trabajo
  writeFileSync(path.join(s.state, "demo", "viejo.corrida"), `ruta_trabajo=${path.join(s.state, "worktrees", "demo@3")}\nrama=x\n`);
  assert.equal(puestoDeCorrida(x3, path.join(s.state, "demo", "viejo.corrida")), "3");
  assert.equal(await puestoParaRetomar(x3, "-"), "aca");
  assert.equal(await puestoParaRetomar(x3, "no-existe"), "aca");
  assert.equal(await puestoParaRetomar(x3, "viejo"), "aca");
  assert.match(s.err(), /pa: la rama x de la corrida viejo ya no existe \(¿integrada o descartada\?\): la retomo en el tree principal\.\n/);
  // la rama está checkouteada en otro worktree: git se niega y pa NO cae al tree principal
  const r2 = await prepararWorktree(s.proy("20261028-100000-4"), "20261028-100000-1", "1");
  assert.equal(r2.codigo, 87);
  assert.equal(r2.rutaTrabajo, s.ruta);
  assert.match(s.err(), /pa: no pude volver a la rama pa\/demo\/20261028-100000-1 en .*demo: .*\npa: NO corro en el tree principal\./);
});

testPosix("build: dirs por nombre o CACHEDIR.TAG (no trackeados, no enlaces); borrar no atraviesa enlaces ni toca un CACHEDIR ajeno", async () => {
  const s = armar();
  const shared = path.join(s.ruta, "node_modules");
  mkdirSync(path.join(shared, "pkg"), { recursive: true });
  writeFileSync(path.join(shared, "pkg", "index.js"), "x");
  const t = await prepararWorktree(s.proy("t1"), "", "1");
  const wt = t.rutaTrabajo;
  mkdirSync(path.join(wt, "target-wt", "debug"), { recursive: true });
  mkdirSync(path.join(wt, "sub", "__pycache__"), { recursive: true });
  mkdirSync(path.join(wt, "models", "hf"), { recursive: true });
  writeFileSync(path.join(wt, "models", "hf", "CACHEDIR.TAG"), "Signature: 8a477f597d28d172789f06886806bc55");
  mkdirSync(path.join(wt, "otro-target"), { recursive: true });
  writeFileSync(path.join(wt, "otro-target", "CACHEDIR.TAG"), "x");
  writeFileSync(path.join(wt, "otro-target", ".rustc_info.json"), "{}");
  mkdirSync(path.join(wt, "dist"));
  writeFileSync(path.join(wt, "dist", "versionado.js"), "x");
  s.git(wt, "add", "-f", "dist/versionado.js");
  const x = s.proy("t1");
  assert.deepEqual((await dirsDeBuild(x, wt)).sort(), ["models/hf", "otro-target", "sub/__pycache__", "target-wt"]);
  assert.deepEqual((await dirsDeBuild(x, wt, true)).sort(), ["otro-target", "sub/__pycache__", "target-wt"]);
  // un tree principal nunca entra
  assert.deepEqual(await dirsDeBuild(x, s.ruta), []);
  await limpiarBuild(x, wt);
  assert.equal(existsSync(path.join(wt, "target-wt")), false);
  assert.equal(existsSync(path.join(wt, "otro-target")), false);
  assert.equal(existsSync(path.join(wt, "models", "hf", "CACHEDIR.TAG")), true);
  assert.equal(existsSync(path.join(wt, "dist", "versionado.js")), true);
  assert.equal(existsSync(path.join(shared, "pkg", "index.js")), true, "el node_modules compartido sigue entero");
});

/** Un repo con package.json + package-lock.json commiteados, el node_modules del tree principal y un `npm` falso (PA_NPM). */
function conLockfile(npmFalla = false) {
  const aux = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pa-npm-")));
  const log = path.join(aux, "npm.log");
  const npm = path.join(aux, "npm-falso.sh");
  writeFileSync(npm, `#!/bin/sh\necho "$PWD $*" >> "${log}"\n${npmFalla ? "exit 1" : "mkdir -p node_modules/pkg"}\n`, { mode: 0o755 });
  const s = armar({ PA_NPM: npm });
  for (const dir of ["", "web"]) {
    mkdirSync(path.join(s.ruta, dir), { recursive: true });
    writeFileSync(path.join(s.ruta, dir, "package.json"), "{}\n");
    writeFileSync(path.join(s.ruta, dir, "package-lock.json"), '{"v":1}\n');
    mkdirSync(path.join(s.ruta, dir, "node_modules", "pkg"), { recursive: true });
  }
  s.git(s.ruta, "add", "package.json", "package-lock.json", "web/package.json", "web/package-lock.json");
  s.git(s.ruta, "commit", "-q", "-m", "lock");
  return { ...s, log: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

testPosix("node_modules: con el mismo lockfile se comparte con symlink y no corre npm", async () => {
  const s = conLockfile();
  const t = await prepararWorktree(s.proy("t1"), "", "1");
  assert.equal(readlinkSync(path.join(t.rutaTrabajo, "node_modules")), path.join(s.ruta, "node_modules"));
  assert.equal(readlinkSync(path.join(t.rutaTrabajo, "web", "node_modules")), path.join(s.ruta, "web", "node_modules"));
  assert.equal(s.log(), "");
});

testPosix("node_modules: si el lockfile del worktree difiere, se instala en ese subproyecto y el resto sigue compartido", async () => {
  const s = conLockfile();
  writeFileSync(path.join(s.ruta, "web", "package-lock.json"), '{"v":2}\n'); // sin commitear: el worktree sale del HEAD
  const t = await prepararWorktree(s.proy("t1"), "", "1");
  const nm = path.join(t.rutaTrabajo, "web", "node_modules");
  assert.equal(lstatSync(nm).isSymbolicLink(), false);
  assert.equal(existsSync(path.join(nm, "pkg")), true);
  assert.equal(readFileSync(path.join(nm, ".pa-package-lock.json"), "utf8"), '{"v":1}\n');
  assert.equal(readlinkSync(path.join(t.rutaTrabajo, "node_modules")), path.join(s.ruta, "node_modules"));
  assert.equal(s.log(), `${path.join(t.rutaTrabajo, "web")} ci --prefer-offline --no-audit --no-fund\n`);
  assert.match(s.err(), /package-lock\.json de 'web' difiere/);
  // la próxima corrida del puesto: desenlazar no toca el propio y enlazar no lo rehace
  await desenlazarCaches(s.proy("t2"), t.rutaTrabajo);
  assert.equal(existsSync(path.join(nm, "pkg")), true);
  enlazarCaches(s.proy("t2"), s.ruta, t.rutaTrabajo);
  assert.equal(s.log().split("\n").filter(Boolean).length, 1);
  // pero si el lockfile del worktree cambia (otra rama), el propio queda viejo y se vuelve a compartir
  writeFileSync(path.join(t.rutaTrabajo, "web", "package-lock.json"), '{"v":2}\n');
  enlazarCaches(s.proy("t3"), s.ruta, t.rutaTrabajo);
  assert.equal(readlinkSync(nm), path.join(s.ruta, "web", "node_modules"));
});

testPosix("node_modules: si la instalación falla, avisa y cae al node_modules del tree principal", async () => {
  const s = conLockfile(true);
  writeFileSync(path.join(s.ruta, "package-lock.json"), '{"v":2}\n');
  const t = await prepararWorktree(s.proy("t1"), "", "1");
  assert.equal(readlinkSync(path.join(t.rutaTrabajo, "node_modules")), path.join(s.ruta, "node_modules"));
  assert.match(s.err(), /OJO: 'npm ci' falló en '\.'/);
});

testPosix("desenlazar: saca los enlaces y, en Windows, el .env que quedó como hardlink si es igual al del tree principal", async () => {
  const s = armar();
  writeFileSync(path.join(s.ruta, ".env"), "CLAVE=1\n");
  mkdirSync(path.join(s.ruta, "node_modules"));
  const t = await prepararWorktree(s.proy("t1"), "", "1");
  await desenlazarCaches(s.proy("t1"), t.rutaTrabajo);
  assert.equal(existsSync(path.join(t.rutaTrabajo, ".env")), false);
  assert.equal(existsSync(path.join(t.rutaTrabajo, "node_modules")), false);
  assert.equal(existsSync(path.join(s.ruta, ".env")), true);

  // Windows (simulado): el .env es un hardlink, no un symlink (sin node_modules: un junction no se puede simular en Linux)
  rmSync(path.join(s.ruta, "node_modules"), { recursive: true });
  const pw = { ...s.pa, plat: "win32" } as Pa;
  const xw = { ...s.proy("t2"), pa: pw };
  enlazarCaches(xw, s.ruta, t.rutaTrabajo);
  assert.equal(lstatSync(path.join(t.rutaTrabajo, ".env")).isSymbolicLink(), false);
  assert.equal(lstatSync(path.join(t.rutaTrabajo, ".env")).nlink, 2);
  // uno distinto (el worker lo cambió) no se toca
  writeFileSync(path.join(t.rutaTrabajo, "CLAUDE.local.md"), "del worker\n");
  await desenlazarCaches(xw, t.rutaTrabajo);
  assert.equal(existsSync(path.join(t.rutaTrabajo, ".env")), false);
  assert.equal(existsSync(path.join(t.rutaTrabajo, "CLAUDE.local.md")), true);
});
