// motor/bin/gate: la compuerta de cada corrida (F6) del protocolo de orquestación. Con un repo git de verdad en un tmp
// (main + una rama pa/<slug>/<id> por caso), un registry de prueba (PROYECTOS_REGISTRY) y el estado en el tmp (PA_STATE):
// verde, y un exit propio por cada falla (21 alcance, 22 test congelado, 23 chequeo, 24 rojos nuevos, 29 espejo), más la base de
// rojos por sha de main y el aviso de compactación. También gate --plan (compuerta del plan) con un 20-plan.md de fixture,
// y que el instalador enlaza el script.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const GATE = path.join(MOTOR, "bin", "gate");
const tmp = mkdtempSync(path.join(os.tmpdir(), "gate-"));
// gate deja sus worktrees (base de rojos y desechables) en GATE_TMP: que sea este tmp, así no ensucia /tmp ni choca con otras corridas
process.env.GATE_TMP = tmp;
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const repo = path.join(tmp, "Mi-Proyecto");
const repoPlan = path.join(tmp, "Plan-Proy"); // un segundo repo, sólo para gate --plan (así no toca el main de los otros casos)
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
writeFileSync(path.join(repo, ".git", "info", "exclude"), "node_modules/\n"); // las dependencias no van a git (ni a las ramas)
escribir("src/a.txt", "a\n");
escribir("src/viejo.ts", "const v = 1 as any;\n"); // ya estaba en main: los anti-patrones de líneas viejas no cuentan
escribir("tests/viejo.txt", "falla-previa\n");
escribir("tests/t1.test.txt", "congelado\n");
git("add", ".");
git("commit", "-qm", "base");
mkdirSync(repoPlan, { recursive: true });
const gitPlan = (...a: string[]) => {
  const r = spawnSync("git", ["-C", repoPlan, ...a], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
};
gitPlan("init", "-q", "-b", "main");
gitPlan("config", "user.email", "t@t");
gitPlan("config", "user.name", "t");
for (const [f, t] of Object.entries({
  "src/barra/Barra.tsx": "export const Barra = 1;\n",
  "src/barra/estado.ts": "x".repeat(20_000), // 20 KB: solo ya es mediano
  "src/i18n/en.ts": "export default {};\n",
  "src/i18n/es.ts": "export default {};\n",
  "src/main/nucleo.ts": "export {};\n",
  "src/enorme.ts": "y".repeat(41_000),
  "src/a.ts": "a\n",
  "src/b.ts": "b\n",
  "src/c.ts": "c\n",
  "src/d.ts": "d\n",
})) {
  mkdirSync(path.dirname(path.join(repoPlan, f)), { recursive: true });
  writeFileSync(path.join(repoPlan, f), t);
}
gitPlan("add", ".");
gitPlan("commit", "-qm", "base");
writeFileSync(registry, JSON.stringify({ projects: [{ name: "mi-proyecto", path: repo }, { name: "plan-proy", path: repoPlan }] }));
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

test("3c: --espejo-cmd con {} corre la copia en el worktree: verde pasa, rojo da 29 y la copia no queda", () => {
  const id = rama({ "src/b.txt": "b\n" });
  const wtw = path.join(tmp, "wt-espejo");
  git("worktree", "add", "-q", wtw, `pa/mi-proyecto/${id}`);
  const espejo = path.join(tmp, "T1.gate.test.txt");
  const correr = (contenido: string) => {
    writeFileSync(espejo, contenido);
    return spawnSync(GATE, ["mi-proyecto", id, "--chequeo", "true", "--permitidos", path.join(tmp, "permitidos.txt"), "--espejo", espejo, "--espejo-cmd", "grep -qx verde {}"], {
      encoding: "utf8",
      env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
    });
  };
  try {
    const verde = correr("verde\n");
    assert.equal(verde.status, 0, verde.stdout + verde.stderr);
    assert.match(verde.stdout, /OK\s+3c espejo \(T1\.gate\.test\.txt\)/);
    const rojo = correr("rojo\n");
    assert.equal(rojo.status, 29, rojo.stdout + rojo.stderr);
    assert.match(rojo.stdout, /ROJO\s+3c espejo: exit 1/);
    assert.deepEqual(readdirSync(wtw).filter((f) => f.includes("espejo")), []);
  } finally {
    git("worktree", "remove", "--force", wtw);
  }
});

test("3c: sin --espejo-cmd corre el chequeo con la ruta del test congelado cambiada por la del espejo; si no la nombra, es 3", () => {
  const id = rama({ "src/b.txt": "b\n" });
  const wtw = path.join(tmp, "wt-espejo-chequeo");
  git("worktree", "add", "-q", wtw, `pa/mi-proyecto/${id}`);
  const espejo = path.join(tmp, "T2.gate.test.txt");
  const correr = (chequeo: string) =>
    spawnSync(GATE, ["mi-proyecto", id, "--chequeo", chequeo, "--permitidos", path.join(tmp, "permitidos.txt"), "--test", `${path.join(tmp, "t1.test.txt")}:tests/t1.test.txt`, "--espejo", espejo], {
      encoding: "utf8",
      env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
    });
  try {
    // el chequeo nombra el test congelado: con el espejo en su lugar, pasa sólo si el espejo tiene lo que el chequeo espera
    const chequeo = "grep -qx congelado tests/t1.test.txt";
    writeFileSync(espejo, "congelado\n");
    const ok = correr(chequeo);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /OK\s+3c espejo \(T2\.gate\.test\.txt\)/);
    writeFileSync(espejo, "otro\n");
    const mal = correr(chequeo);
    assert.equal(mal.status, 29, mal.stdout + mal.stderr);
    assert.deepEqual(readdirSync(path.join(wtw, "tests")).filter((f) => f.includes("espejo")), []);
    const sin = correr("true");
    assert.equal(sin.status, 3, sin.stdout + sin.stderr);
    assert.match(sin.stdout, /3c espejo: no sé cómo correrlo/);
  } finally {
    git("worktree", "remove", "--force", wtw);
  }
});

test("3c: --espejo a un archivo que no existe es 3; --espejo-cmd sin --espejo es uso (2)", () => {
  const sinArchivo = gate(rama({ "src/b.txt": "b\n" }), ["--espejo", path.join(tmp, "no-hay.test.txt"), "--espejo-cmd", "true"]);
  assert.equal(sinArchivo.exit, 3, sinArchivo.sal);
  assert.match(sinArchivo.sal, /no existe o no se puede leer el espejo/);
  const sinEspejo = gate(rama({ "src/b.txt": "b\n" }), ["--espejo-cmd", "true"]);
  assert.equal(sinEspejo.exit, 2, sinEspejo.sal);
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

test("26: un snapshot cambiado que --permitidos cubre sólo con un dir/ se rechaza, y lo dice", () => {
  writeFileSync(path.join(tmp, "permitidos-snap.txt"), "src/\n");
  const r = spawnSync(GATE, ["mi-proyecto", rama({ "src/__snapshots__/a.snap": "snap\n" }), "--chequeo", "true", "--permitidos", path.join(tmp, "permitidos-snap.txt")], {
    encoding: "utf8",
    env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
  });
  assert.equal(r.status, 26, r.stdout + r.stderr);
  assert.match(r.stdout, /ROJO\s+1b snapshots/);
  assert.match(r.stdout, /src\/__snapshots__\/a\.snap/);
});

test("26: un snapshot con su ruta nombrada en --permitidos pasa", () => {
  writeFileSync(path.join(tmp, "permitidos-snap2.txt"), "# snapshots aprobados\nsrc/__snapshots__/a.snap\n");
  const r = spawnSync(GATE, ["mi-proyecto", rama({ "src/__snapshots__/a.snap": "snap\n" }), "--chequeo", "true", "--permitidos", path.join(tmp, "permitidos-snap2.txt")], {
    encoding: "utf8",
    env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK\s+1b snapshots/);
});

test("26: un glob que nombra __snapshots__ también cuenta como ruta explícita", () => {
  writeFileSync(path.join(tmp, "permitidos-snap3.txt"), "src/*/__snapshots__/*.snap\n");
  const r = spawnSync(GATE, ["mi-proyecto", rama({ "src/x/__snapshots__/b.snap": "snap\n" }), "--chequeo", "true", "--permitidos", path.join(tmp, "permitidos-snap3.txt")], {
    encoding: "utf8",
    env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// 1c: un caso por cada anti-patrón, en código (fuera de tests) y en un test
const permAnti = path.join(tmp, "permitidos-anti.txt");
writeFileSync(permAnti, "src/\ntests/\ndocs/*.md\n");
const gateAnti = (id: string, extra: string[] = []) =>
  spawnSync(GATE, ["mi-proyecto", id, "--chequeo", "true", "--permitidos", permAnti, ...extra], {
    encoding: "utf8",
    env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
  });

const ANTI_CODIGO: [string, string][] = [
  ["@ts-ignore", "// @ts-ignore\nconst x = f();\n"],
  ["as any", "const x = y as any;\n"],
  [".skip(", "const r = lista.skip(1);\n"],
  [".only(", "const r = lista.only(1);\n"],
  ["xit(", 'xit("caso", () => {});\n'],
  ["xdescribe(", 'xdescribe("caso", () => {});\n'],
  ["it.todo", 'it.todo("caso");\n'],
  [".fails(", "const r = f().fails(1);\n"],
];
for (const [nombre, texto] of ANTI_CODIGO) {
  test(`25: ${nombre} en código (fuera de tests) rechaza`, () => {
    const r = gateAnti(rama({ "src/c.ts": texto }));
    assert.equal(r.status, 25, r.stdout + r.stderr);
    assert.match(r.stdout, /ROJO\s+1c anti-patrones/);
    assert.match(r.stdout, /src\/c\.ts:1/);
  });
}

const ANTI_TEST: [string, string][] = [
  [".skip(", 'test.skip("caso", () => {});\n'],
  [".only(", 'test.only("caso", () => {});\n'],
  ["xit(", 'xit("caso", () => {});\n'],
  ["xdescribe(", 'xdescribe("caso", () => {});\n'],
  ["it.todo", 'it.todo("caso");\n'],
  [".fails(", 'test.fails("caso", () => {});\n'],
  ["return; al inicio de un test", 'test("caso", () => {\n  return;\n});\n'],
];
for (const [nombre, texto] of ANTI_TEST) {
  test(`25: ${nombre} en un test rechaza`, () => {
    const r = gateAnti(rama({ "tests/nuevo.test.ts": texto }));
    assert.equal(r.status, 25, r.stdout + r.stderr);
    assert.match(r.stdout, /ROJO\s+1c anti-patrones/);
  });
}

test("25: as any y @ts-ignore dentro de un test no rechazan (son de código, no de test)", () => {
  const r = gateAnti(rama({ "tests/casteo.test.ts": "const x = y as any;\n// @ts-ignore\n" }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK\s+1c anti-patrones/);
});

test("25: return; que no es la primera línea de un test no rechaza", () => {
  const r = gateAnti(rama({ "tests/orden.test.ts": 'test("caso", () => {\n  expect(1).toBe(1);\n  return;\n});\n' }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("25: return; en una función de ayuda de un archivo de tests no rechaza", () => {
  const r = gateAnti(rama({ "tests/ayuda.test.ts": "function ayuda() {\n  return;\n}\n" }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("25: @ts-expect-error y eslint-disable-next-line react-hooks/exhaustive-deps avisan y no rechazan", () => {
  const r = gateAnti(rama({ "src/w.ts": "// @ts-expect-error\nconst x: number = 'a';\n// eslint-disable-next-line react-hooks/exhaustive-deps\nconst y = 1;\n" }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /AVISO 1c src\/w\.ts:1/);
  assert.match(r.stdout, /AVISO 1c src\/w\.ts:3/);
});

test("25: sólo cuentan las líneas agregadas: un as any que ya estaba en main no rechaza", () => {
  const r = gateAnti(rama({ "src/viejo.ts": "const v = 1 as any;\nconst w = 2;\n" }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("25: un .md con el anti-patrón escrito como texto no rechaza", () => {
  const r = gateAnti(rama({ "docs/nota.md": "no uses @ts-ignore ni as any\n" }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("--help documenta los pasos y los exits, y sale en 0", () => {
  const r = spawnSync(GATE, ["--help"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--test COPIA/);
  for (const e of ["21", "22", "23", "24", "25", "26"]) assert.match(r.stdout, new RegExp(`\\b${e}\\b`));
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
  assert.equal(existsSync(path.join(tmp, `gate-pa-mi-proyecto-${id}`)), false);
});

test("node_modules: el worktree sin dependencias las enlaza durante el chequeo; el enlace no queda, ni con el chequeo rojo", () => {
  // el checkout tiene node_modules en la raíz y en app/ (no van a git); la rama trae package.json en las dos
  for (const d of [path.join(repo, "node_modules"), path.join(repo, "app", "node_modules")]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "marca.txt"), "dep\n");
  }
  writeFileSync(path.join(tmp, "permitidos-deps.txt"), "app/package.json\npackage.json\n");
  const id = rama({ "app/package.json": "{}\n", "package.json": "{}\n" });
  const wtw = path.join(tmp, "wt-deps");
  git("worktree", "add", "-q", wtw, `pa/mi-proyecto/${id}`);
  const correr = (chequeo: string) =>
    spawnSync(GATE, ["mi-proyecto", id, "--chequeo", chequeo, "--permitidos", path.join(tmp, "permitidos-deps.txt")], {
      encoding: "utf8",
      env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
    });
  const sinEnlace = (p: string) => assert.throws(() => lstatSync(p), { code: "ENOENT" });
  try {
    const ok = correr("test -L node_modules && test -L app/node_modules && test -f app/node_modules/marca.txt && test -f node_modules/marca.txt");
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /OK\s+3 chequeo/);
    sinEnlace(path.join(wtw, "node_modules"));
    sinEnlace(path.join(wtw, "app", "node_modules"));
    assert.equal(readFileSync(path.join(repo, "app", "node_modules", "marca.txt"), "utf8"), "dep\n"); // unlink: el del checkout sigue

    const malo = correr("exit 3");
    assert.equal(malo.status, 23, malo.stdout + malo.stderr);
    sinEnlace(path.join(wtw, "app", "node_modules"));
  } finally {
    git("worktree", "remove", "--force", wtw);
  }
});

test("tarea: anota el exit en la columna gate de la fila del id; si no hay fila la agrega con '-'", () => {
  const idA = rama({ "src/b.txt": "b\n" });
  const idB = rama({ "src/c.txt": "c\n" });
  const f = path.join(estado, "mi-proyecto", "tareas", "t-prueba", "estado.tsv");
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, ["subtarea\tintento\tid\tmodelo\teffort\texit\tgate\tusd", `T1\t1\t${idA}\thaiku\tlow\t0\t-\t0.01`, "T2\t1\totro\tsonnet\tmedium\t0\t-\t0.2", ""].join("\n"));
  const verde = gate(idA, ["--tarea", "t-prueba"]);
  assert.equal(verde.exit, 0, verde.sal);
  assert.match(verde.sal, /OK\s+estado\.tsv \(t-prueba\): gate 0/);
  const malo = gate(`pa/mi-proyecto/${idB}`, ["--tarea", "t-prueba"], { chequeo: "exit 3" });
  assert.equal(malo.exit, 23, malo.sal);
  assert.equal(
    readFileSync(f, "utf8"),
    ["subtarea\tintento\tid\tmodelo\teffort\texit\tgate\tusd", `T1\t1\t${idA}\thaiku\tlow\t0\t0\t0.01`, "T2\t1\totro\tsonnet\tmedium\t0\t-\t0.2", `-\t-\t${idB}\t-\t-\t-\t23\t-`, ""].join("\n"),
  );
});

test("tarea: la toma de PA_TAREA si no hay --tarea (y crea el estado.tsv); un slug con / da uso", () => {
  const id = rama({ "src/d.txt": "d\n" });
  const r = spawnSync(GATE, ["mi-proyecto", id, "--chequeo", "true", "--permitidos", path.join(tmp, "permitidos.txt")], {
    encoding: "utf8",
    env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado, PA_TAREA: "t-env" },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(
    readFileSync(path.join(estado, "mi-proyecto", "tareas", "t-env", "estado.tsv"), "utf8"),
    `subtarea\tintento\tid\tmodelo\teffort\texit\tgate\tusd\n-\t-\t${id}\t-\t-\t-\t0\t-\n`,
  );
  assert.equal(gate(id, ["--tarea", "../x"]).exit, 2);
});

// --- gate --plan: 20-plan.md inventado ------------------------------------------------------------------------------------
const PLAN_OK = `# Plan de prueba

## T0 Claves i18n
Depende de: —
Leer: src/i18n/en.ts (0.0 KB)
Modificar: src/i18n/en.ts, src/i18n/es.ts
Calientes: —
Chequeo: grep -q reintento src/i18n/en.ts                                   # rojo en main
Rúbrica: A=chico B=ejecutar C=completo D=bajo E=si

## T1 Botón de reintento en la barra
Depende de: T0
Leer: src/barra/Barra.tsx (0.0 KB), src/barra/estado.ts (20 KB)
Modificar: src/barra/Barra.tsx, src/barra/Barra.test.tsx, src/i18n/en.ts
Calientes: src/barra/Barra.tsx
Chequeo: \`grep -q reintento src/barra/Barra.tsx\`
Rúbrica: A=mediano B=ejecutar C=completo D=bajo E=si

## T2 Núcleo y barra
Depende de: T0
Leer: src/barra/Barra.tsx
Modificar: src/main/nucleo.ts, src/barra/Barra.tsx
Chequeo: true
Rúbrica: A=mediano B=decidir C=completo D=alto E=si

## T3 Sin chequeo
Leer: src/a.ts
Modificar: src/a.ts
Chequeo: —
`;
const planDir = path.join(estado, "plan-proy", "tareas", "demo");
mkdirSync(planDir, { recursive: true });
writeFileSync(path.join(planDir, "20-plan.md"), PLAN_OK);
const gatePlan = (slug: string, extra: string[] = []) => {
  const r = spawnSync(GATE, ["plan-proy", "--plan", slug, ...extra], {
    encoding: "utf8",
    env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado },
  });
  return { exit: r.status, sal: r.stdout + r.stderr };
};

test("--plan --json: A sin tests ni archivos de T0, piso de D, calientes, KB y rojo en main", () => {
  const r = gatePlan("demo", ["--json"]);
  assert.equal(r.exit, 28, r.sal); // T2 tiene el chequeo en verde en main
  const j = JSON.parse(r.sal);
  assert.equal(j.ok, false);
  const [t0, t1, t2, t3] = j.subtareas;
  assert.deepEqual(j.subtareas.map((s: { id: string }) => s.id), ["T0", "T1", "T2", "T3"]);
  // T0: sus propios archivos cuentan (en.ts y es.ts: mediano); rojo (grep no encuentra la clave)
  assert.equal(t0.archivos_contados, 2);
  assert.equal(t0.a, "mediano");
  assert.equal(t0.rojo_en_main, "rojo");
  // T1: el test y en.ts (de T0) no cuentan: 1 archivo; manda el KB (20 000 bytes de estado.ts: mediano)
  assert.equal(t1.archivos_contados, 1);
  assert.equal(t1.leer_bytes, 20_000 + 24);
  assert.equal(t1.leer_kb, 20);
  assert.equal(t1.a, "mediano");
  assert.equal(t1.d_piso, "bajo");
  assert.equal(t1.rojo_en_main, "rojo");
  assert.deepEqual(t1.calientes, { "src/barra/Barra.tsx": ["T2"], "src/i18n/en.ts": ["T0"] });
  // T2: nucleo.ts sube el piso de D; chequeo en verde en main es un problema
  assert.equal(t2.a, "mediano");
  assert.equal(t2.d_piso, "alto");
  assert.deepEqual(t2.d_motivos, ["nucleo.ts/puente.ts"]);
  assert.equal(t2.rojo_en_main, "verde");
  assert.match(t2.problemas.join("\n"), /verde en main/);
  // T3: chico, sin chequeo
  assert.equal(t3.a, "chico");
  assert.equal(t3.rojo_en_main, "sin-chequeo");
  assert.deepEqual(t3.calientes, {});
});

test("--plan en texto: imprime A, D, calientes y chequeo por subtarea, y avisa que el líder sólo contesta B, C y E", () => {
  const r = gatePlan("demo");
  assert.equal(r.exit, 28, r.sal);
  assert.match(r.sal, /T1  Botón de reintento en la barra\n\s+A\s+mediano  \(1 archivo\(s\) sin tests ni T0, 20\.0 KB/);
  assert.match(r.sal, /D \(piso\)\s+alto  \(nucleo\.ts\/puente\.ts\)/);
  assert.match(r.sal, /calientes src\/barra\/Barra\.tsx \(con T2\)/);
  assert.match(r.sal, /chequeo\s+VERDE en main/);
  assert.match(r.sal, /PROBLEMA\s+el chequeo da verde en main/);
  assert.match(r.sal, /El líder contesta B, C y E/);
  assert.match(r.sal, /PLAN CON PROBLEMAS \(exit 28\)/);
});

test("--plan: más de 40 000 bytes de lectura o más de 3 archivos es A=grande y problema; plan sano sale 0; --no-correr no corre el chequeo", () => {
  const dir = path.join(estado, "plan-proy", "tareas", "grande");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "20-plan.md"),
    ["## T1 Lee de más", "Leer: src/enorme.ts", "Modificar: src/a.ts", "Chequeo: false", "", "## T2 Toca de más", "Modificar: src/a.ts, src/b.ts, src/c.ts, src/d.ts, src/a.test.ts", "Chequeo: false", ""].join("\n"),
  );
  const g = JSON.parse(gatePlan("grande", ["--json"]).sal);
  assert.equal(g.subtareas[0].a, "grande");
  assert.match(g.subtareas[0].problemas.join(), /40 000/);
  assert.equal(g.subtareas[1].a, "grande");
  assert.equal(g.subtareas[1].archivos_contados, 4);
  assert.match(g.subtareas[1].problemas.join(), /más de 3 archivos/);

  const sano = path.join(estado, "plan-proy", "tareas", "sano");
  mkdirSync(sano, { recursive: true });
  writeFileSync(path.join(sano, "20-plan.md"), "## T1 Una\nLeer: src/a.ts\nModificar: src/a.ts\nChequeo: false\n");
  const ok = gatePlan("sano");
  assert.equal(ok.exit, 0, ok.sal);
  assert.match(ok.sal, /ROJO en main \(exit 1\)/);
  assert.match(ok.sal, /PLAN LISTO/);

  const sinCorrer = gatePlan("demo", ["--json", "--no-correr"]);
  const j = JSON.parse(sinCorrer.sal);
  assert.equal(j.subtareas[2].rojo_en_main, "no-corrido");
  assert.equal(sinCorrer.exit, 0, sinCorrer.sal); // sin correr, el verde de T2 no se detecta
});

test("--plan: sin plan es exit 3; slug inválido o argumento de más es uso (2)", () => {
  assert.equal(gatePlan("no-existe").exit, 3);
  assert.equal(gatePlan("../x").exit, 2);
  const r = spawnSync(GATE, ["plan-proy", "otro", "--plan", "demo"], { encoding: "utf8", env: { ...process.env, PROYECTOS_REGISTRY: registry, PA_STATE: estado } });
  assert.equal(r.status, 2);
});

test("el instalador del producto enlaza gate junto a los otros bin", () => {
  assert.ok((readFileSync(path.join(MOTOR, "scripts", "instalar-producto.sh"), "utf8").match(/for b in proyecto-ruta workers reparto cuentas gate;/) ?? []).length === 1);
  chmodSync(GATE, 0o755);
});
