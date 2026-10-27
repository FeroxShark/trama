// motor/bin/gate: la compuerta de cada corrida (F6) del protocolo de orquestación. Con un repo git de verdad en un tmp
// (main + una rama pa/<slug>/<id> por caso), un registry de prueba (PROYECTOS_REGISTRY) y el estado en el tmp (PA_STATE):
// verde, y un exit propio por cada falla (21 alcance, 22 test congelado, 23 chequeo, 24 rojos nuevos), más la base de
// rojos por sha de main y el aviso de compactación. También que el instalador enlaza el script.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const GATE = path.join(MOTOR, "bin", "gate");
const tmp = mkdtempSync(path.join(os.tmpdir(), "gate-"));
after(() => {
  const sha = spawnSync("git", ["-C", repo, "rev-parse", "--short", "main"], { encoding: "utf8" }).stdout.trim();
  if (sha) rmSync(path.join("/tmp", `base-${sha}`), { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
});

const repo = path.join(tmp, "Mi-Proyecto");
const estado = path.join(tmp, "estado");
const registry = path.join(tmp, "registry.json");
const git = (...a: string[]) => {
  const r = spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const escribir = (rel: string, txt: string) => {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), txt);
};

mkdirSync(repo, { recursive: true });
git("init", "-q", "-b", "main");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
escribir("src/a.txt", "a\n");
escribir("tests/viejo.txt", "falla-previa\n");
escribir("tests/t1.test.txt", "congelado\n");
git("add", ".");
git("commit", "-qm", "base");
writeFileSync(registry, JSON.stringify({ projects: [{ name: "mi-proyecto", path: repo }] }));
writeFileSync(path.join(tmp, "permitidos.txt"), "# comentario\nsrc/\ndocs/*.md\n");
writeFileSync(path.join(tmp, "t1.test.txt"), "congelado\n");

let n = 0;
/** Una rama desde main con los cambios dados; vuelve a main. Devuelve el id (lo que va después de pa/mi-proyecto/). */
function rama(cambios: Record<string, string>): string {
  const id = `r${n++}`;
  git("checkout", "-q", "-b", `pa/mi-proyecto/${id}`, "main");
  for (const [f, t] of Object.entries(cambios)) escribir(f, t);
  git("add", ".");
  git("commit", "-qm", id, "--allow-empty");
  git("checkout", "-q", "main");
  return id;
}

function gate(id: string, extra: string[] = [], o: { chequeo?: string } = {}) {
  const r = spawnSync(
    GATE,
    ["mi-proyecto", id, "--chequeo", o.chequeo ?? "true", "--permitidos", path.join(tmp, "permitidos.txt"), "--test", path.join(tmp, "t1.test.txt"), ...extra],
    { encoding: "utf8", env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado } },
  );
  return { exit: r.status, sal: r.stdout + r.stderr };
}

test("verde: dentro de lo permitido, test intacto, chequeo en 0", () => {
  const r = gate(rama({ "src/b.txt": "b\n", "docs/x.md": "x\n" }));
  assert.equal(r.exit, 0, r.sal);
  assert.match(r.sal, /GATE VERDE/);
  assert.match(r.sal, /OK\s+1 alcance/);
  assert.match(r.sal, /OK\s+2 test congelado \(tests\/t1\.test\.txt pisado/);
});

test("21: un archivo fuera de lo permitido, y dice cuál", () => {
  const r = gate(rama({ "src/b.txt": "b\n", "package.json": "{}\n" }));
  assert.equal(r.exit, 21, r.sal);
  assert.match(r.sal, /1 alcance: 1 archivo/);
  assert.match(r.sal, /package\.json/);
  assert.doesNotMatch(r.sal, /src\/b\.txt/);
});

test("2: el test congelado cambiado en la rama avisa, y tampoco lo rechaza por sí solo", () => {
  // tests/ no está en permitidos: falla también el alcance, pero manda el primer paso que falló (21) y se ven ambos
  const r = gate(rama({ "tests/t1.test.txt": "tocado\n" }), [], {});
  assert.equal(r.exit, 21, r.sal);
  assert.match(r.sal, /AVISO 2 la rama cambió tests\/t1\.test\.txt/);
  assert.doesNotMatch(r.sal, /ROJO\s+2/);
});

test("2: pisa el test con la copia: el chequeo ve la copia y no lo que la rama cambió", () => {
  writeFileSync(path.join(tmp, "permitidos4.txt"), "src/\ntests/\n");
  const id = rama({ "tests/t1.test.txt": "tocado\n" });
  const gateConPisado = (chequeo: string) =>
    spawnSync(GATE, ["mi-proyecto", id, "--chequeo", chequeo, "--permitidos", path.join(tmp, "permitidos4.txt"), "--test", path.join(tmp, "t1.test.txt")], {
      encoding: "utf8",
      env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
    });
  const ok = gateConPisado("grep -qx congelado tests/t1.test.txt");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /OK\s+2 test congelado \(tests\/t1\.test\.txt pisado/);
  const mal = gateConPisado("grep -qx tocado tests/t1.test.txt");
  assert.equal(mal.status, 23, mal.stdout + mal.stderr);
});

test("2: el worktree del worker queda con su archivo de test como estaba", () => {
  writeFileSync(path.join(tmp, "permitidos5.txt"), "src/\ntests/\n");
  const id = rama({ "tests/t1.test.txt": "tocado\n" });
  const wtw = path.join(tmp, "wt-worker");
  git("worktree", "add", "-q", wtw, `pa/mi-proyecto/${id}`);
  try {
    const r = spawnSync(GATE, ["mi-proyecto", id, "--chequeo", "true", "--permitidos", path.join(tmp, "permitidos5.txt"), "--test", path.join(tmp, "t1.test.txt")], {
      encoding: "utf8",
      env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(path.join(wtw, "tests", "t1.test.txt"), "utf8"), "tocado\n");
  } finally {
    git("worktree", "remove", "--force", wtw);
  }
});

test("22: el test congelado no tiene una ruta única en la rama (dos archivos con su nombre)", () => {
  const r = gate(rama({ "src/t1.test.txt": "x\n" }));
  assert.equal(r.exit, 22, r.sal);
  assert.match(r.sal, /ROJO\s+2 test congelado/);
});

test("3b: un *.extra.test.* que falla con --extras da 23; si pasa, OK", () => {
  const malo = gate(rama({ "src/x.extra.test.txt": "x\n" }), ["--extras", "false"]);
  assert.equal(malo.exit, 23, malo.sal);
  assert.match(malo.sal, /3b extras: exit 1/);
  const bueno = gate(rama({ "src/y.extra.test.txt": "y\n" }), ["--extras", "true"]);
  assert.equal(bueno.exit, 0, bueno.sal);
  assert.match(bueno.sal, /OK\s+3b extras \(1\)/);
});

test("3b: un *.extra.test.* sin --extras avisa que no corrió y no rechaza", () => {
  const r = gate(rama({ "src/z.extra.test.txt": "z\n" }));
  assert.equal(r.exit, 0, r.sal);
  assert.match(r.sal, /AVISO 3b 1 extra/);
});

test("23: el chequeo da rojo, con el final de su salida", () => {
  const r = gate(rama({ "src/b.txt": "b\n" }), [], { chequeo: "echo explotó-aca; exit 3" });
  assert.equal(r.exit, 23, r.sal);
  assert.match(r.sal, /3 chequeo: exit 3/);
  assert.match(r.sal, /explotó-aca/);
});

test("el chequeo corre en la rama, no en main", () => {
  const id = rama({ "src/b.txt": "b\n" });
  assert.equal(gate(id, [], { chequeo: "test -f src/b.txt" }).exit, 0);
  assert.equal(gate(id, [], { chequeo: "test -f src/nada.txt" }).exit, 23);
});

test("24: rojos nuevos contra main; los de main de antes no cuentan; la base queda por sha", () => {
  // «tests» imprime los archivos de tests/ cuyo contenido empieza con falla-
  const rojos = "grep -rl '^falla-' tests || true";
  const ok = gate(rama({ "src/b.txt": "b\n" }), ["--rojos", rojos]);
  assert.equal(ok.exit, 0, ok.sal);
  assert.match(ok.sal, /OK\s+4 rojos nuevos/);
  const sha = git("rev-parse", "--short", "main").trim();
  const base = path.join(estado, "mi-proyecto", `base-${sha}.txt`);
  assert.equal(readFileSync(base, "utf8").trim(), "tests/viejo.txt");

  writeFileSync(path.join(tmp, "permitidos3.txt"), "src/\ntests/\n");
  const id = rama({ "tests/nuevo.txt": "falla-nueva\n" });
  const r = spawnSync(GATE, ["mi-proyecto", id, "--chequeo", "true", "--permitidos", path.join(tmp, "permitidos3.txt"), "--test", path.join(tmp, "t1.test.txt"), "--rojos", rojos], {
    encoding: "utf8",
    env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
  });
  assert.equal(r.status, 24, r.stdout + r.stderr);
  assert.match(r.stdout, /tests\/nuevo\.txt/);
  assert.doesNotMatch(r.stdout, /viejo/);
});

test("sin --rojos se saltea el paso 4 y lo dice; --log avisa de la compactación sin rechazar", () => {
  const id = rama({ "src/b.txt": "b\n" });
  const log = path.join(tmp, "worker.log");
  writeFileSync(log, "fin\n1 compactación(es)\n");
  const r = gate(id, ["--log", log]);
  assert.equal(r.exit, 0, r.sal);
  assert.match(r.sal, /SALTEADO 4/);
  assert.match(r.sal, /AVISO 5/);
});

test("sin --test es el camino trivial: el paso 2 se saltea y el resto corre", () => {
  const r = spawnSync(GATE, ["mi-proyecto", rama({ "src/b.txt": "b\n" }), "--chequeo", "true", "--permitidos", path.join(tmp, "permitidos.txt")], {
    encoding: "utf8",
    env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SALTEADO 2 test congelado/);
  assert.match(r.stdout, /OK\s+3 chequeo/);
  assert.match(r.stdout, /GATE VERDE/);
});

test("--help documenta los pasos y los exits, y sale en 0", () => {
  const r = spawnSync(GATE, ["--help"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--test COPIA/);
  for (const e of ["21", "22", "23", "24"]) assert.match(r.stdout, new RegExp(`\\b${e}\\b`));
});

test("2 y 3 los muestra aunque el 1 falle; el exit es el del primero", () => {
  const r = gate(rama({ "afuera.txt": "x\n" }), [], { chequeo: "exit 1" });
  assert.equal(r.exit, 21, r.sal);
  assert.match(r.sal, /ROJO\s+3 chequeo/);
});

test("3: proyecto o rama que no existen; 2: uso", () => {
  assert.equal(gate("no-existe").exit, 3);
  const mal = spawnSync(GATE, ["mi-proyecto"], { encoding: "utf8" });
  assert.equal(mal.status, 2);
  const sin = spawnSync(GATE, ["nada-registrado", "x", "--chequeo", "true", "--permitidos", path.join(tmp, "permitidos.txt"), "--test", path.join(tmp, "t1.test.txt")], {
    encoding: "utf8",
    env: { ...process.env, PROYECTOS_REGISTRY: registry },
  });
  assert.equal(sin.status, 3);
});

test("acepta la rama entera como id y la deja sin worktrees desechables", () => {
  const id = rama({ "src/b.txt": "b\n" });
  const r = gate(`pa/mi-proyecto/${id}`);
  assert.equal(r.exit, 0, r.sal);
  assert.equal(existsSync(path.join("/tmp", `gate-pa-mi-proyecto-${id}`)), false);
});

test("el instalador del producto enlaza gate junto a los otros bin", () => {
  assert.ok((readFileSync(path.join(MOTOR, "scripts", "instalar-producto.sh"), "utf8").match(/for b in proyecto-ruta workers reparto cuentas gate;/) ?? []).length === 1);
  chmodSync(GATE, 0o755);
});
