import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { enlazarDir } from "../electron/cli/base/enlaces.ts";
import { gitOk } from "../electron/cli/base/git.ts";
import { prologo } from "../electron/cli/pa/entorno.ts";
import { lanzarClaude, type Corrida } from "../electron/cli/pa/lanzar.ts";
import { armarLlamada, type DatosLlamada } from "../electron/cli/pa/motores/llamada.ts";
import { rutasParaCommit } from "../electron/cli/pa/worktrees.ts";

function carpeta(t: TestContext): string {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pa-codex-")));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  return raiz;
}

test("elige rutas literales de altas, bajas y cambios, sin cachés ni directorios sueltos", () => {
  assert.deepEqual(rutasParaCommit([
    " M con espacios.ts", "M  con\nsalto.txt", " D borrado.txt", "?? nuevo -> archivo.ts", "?? nuevo/[a].ts",
    "?? app/node_modules", "?? app/node_modules/b.js", "?? dist/salida.js", "?? dist.txt", "?? repo-anidado/", "",
  ], ["app/node_modules", "dist"]), [
    "con espacios.ts", "con\nsalto.txt", "borrado.txt", "nuevo -> archivo.ts", "nuevo/[a].ts", "dist.txt",
  ]);
});

test("sólo el prompt de Codex escritor explica el commit de pa y el límite de los tests", (t) => {
  const raiz = carpeta(t);
  const datos = {
    modelo: "codex:gpt-6-sol-high", contrato: "Commiteá antes del test.", prompt: "Hacé el cambio.",
    rutaTrabajo: raiz, ruta: raiz, rama: "pa/demo/1", dir: raiz, ts: "1", hb: path.join(raiz, "hb"),
    mapaProy: path.join(raiz, "mapa"), gitComun: () => "", env: { CLAUDE_CONFIG_DIR: raiz }, io: { err: () => {} },
  };
  const motores: [DatosLlamada["motor"], string][] = [
    ["codex", datos.modelo], ["agy", "gemini-4-neon-high"], ["dsh", "dsh:ollama/qwen3"], ["opencode", "opencode:opencode/big-pickle"],
  ];
  for (const [motor, modelo] of motores) {
    for (const leer of [false, true]) {
      const llamada = armarLlamada({ ...datos, motor, modelo, leer });
      const prompt = llamada.tareaArchivo?.texto ?? (motor === "agy" ? llamada.args[1]! : llamada.args.at(-1)!);
      if (motor === "codex" && !leer) {
        assert.match(prompt, /No corras `git add` ni `git commit`/);
        assert.match(prompt, /pa los commitea al terminar/);
        assert.match(prompt, /sockets locales.*node scripts\/test\.mjs <archivo>.*VERIFICACION/);
      } else {
        assert.doesNotMatch(prompt, /pa los commitea al terminar|sockets locales/);
      }
    }
  }
});

async function repo(t: TestContext) {
  const raiz = carpeta(t);
  const ruta = path.join(raiz, "repo");
  const state = path.join(raiz, "estado");
  const rutaTrabajo = path.join(state, "worktrees", "demo");
  const ts = "20261121-010101-1";
  const rama = `pa/demo/${ts}`;
  const env = {
    ...process.env, PA_STATE: state, PA_PROJ: path.join(raiz, "sesiones"), CLAUDE_CONFIG_DIR: raiz,
    GIT_CONFIG_GLOBAL: path.join(raiz, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Prueba", GIT_COMMITTER_NAME: "Prueba", GIT_AUTHOR_EMAIL: "prueba@example.invalid", GIT_COMMITTER_EMAIL: "prueba@example.invalid",
  };
  const principal = (args: string[]) => gitOk(args, { cwd: ruta, env });
  const enWorktree = (args: string[]) => gitOk(args, { cwd: rutaTrabajo, env });
  mkdirSync(ruta);
  await principal(["init", "-q", "-b", "main", "--template="]);
  writeFileSync(path.join(ruta, ".gitignore"), "ignorado.txt\n");
  writeFileSync(path.join(ruta, "borrar.txt"), "anterior\n");
  writeFileSync(path.join(ruta, "editar.txt"), "anterior\n");
  await principal(["add", "--", ".gitignore", "borrar.txt", "editar.txt"]);
  await principal(["commit", "-qm", "base"]);
  const base = await principal(["rev-parse", "HEAD"]);
  await principal(["worktree", "add", "-qb", rama, rutaTrabajo]);
  let out = "";
  let err = "";
  const pa = prologo([], env, { out: (s) => { out += s; }, err: (s) => { err += s; } });
  const c: Corrida = {
    proyecto: "demo", slug: "demo", ts, ruta, rutaTrabajo, rama, base, origen: "", puesto: "1", leer: false, usaWorktree: true,
    tengoLock: true, modelo: "codex:gpt-6-sol-high", motor: "codex", esfuerzo: "", cuenta: "chatgpt", tarea: "x", tareaJefe: "x",
    lanzo: "jefe", sid: "sesion", resume: false, conMcp: false, maxTurns: "", maxBudget: "", autocompact: "", baseDelta: [], jefe: "", jefeId: "", async: true,
  };
  const correr = (cambios: () => void) => lanzarClaude(pa, c, {
    senalesProceso: false,
    async ejecutar(l) {
      cambios();
      writeFileSync(l.out, JSON.stringify({ result: "RESULTADO: listo.\nDECISION: nada\nSIGUE: nada" }));
      return 0;
    },
  });
  return { pa, c, correr, enWorktree, principal, out: () => out, err: () => err };
}

test("el cierre de Codex commitea en la rama, antes de publicar el resultado", async (t) => {
  const { c, correr, enWorktree, principal, out } = await repo(t);
  const wt = c.rutaTrabajo;
  assert.equal(await correr(() => {
    rmSync(path.join(wt, "borrar.txt"));
    writeFileSync(path.join(wt, "editar.txt"), "cambio\n");
    writeFileSync(path.join(wt, "[a] ñ.txt"), "nuevo\n");
    writeFileSync(path.join(wt, "ignorado.txt"), "ignorado\n");
    mkdirSync(path.join(wt, "nuevo", "dist"), { recursive: true });
    writeFileSync(path.join(wt, "nuevo", "dist", "salida.js"), "generado\n");
    writeFileSync(path.join(wt, "nuevo", "fuente.ts"), "fuente\n");
    mkdirSync(path.join(c.ruta, "node_modules"));
    enlazarDir(path.join(c.ruta, "node_modules"), path.join(wt, "app", "node_modules"));
  }), 0);
  assert.equal(await enWorktree(["branch", "--show-current"]), c.rama);
  assert.equal(await enWorktree(["log", "-1", "--format=%s"]), `pa: cambios del worker (${c.ts})`);
  const archivos = await enWorktree(["show", "--format=", "--name-only", "-z", "HEAD"]);
  assert.deepEqual(archivos.split("\0").filter(Boolean).sort(), ["[a] ñ.txt", "borrar.txt", "editar.txt", "nuevo/fuente.ts"]);
  assert.equal(await principal(["rev-parse", "HEAD"]), c.base);
  assert.match(out(), /1 commit\(s\)/);
  assert.equal(await correr(() => {}), 0);
  assert.equal(await enWorktree(["rev-list", "--count", `${c.base}..HEAD`]), "1");
});

test("si falla el commit de cierre, avisa y conserva el código de la corrida y los cambios", async (t) => {
  const { pa, c, correr, enWorktree, err } = await repo(t);
  pa.env.GIT_COMMITTER_NAME = "";
  const nuevo = path.join(c.rutaTrabajo, "nuevo.txt");
  assert.equal(await correr(() => writeFileSync(nuevo, "trabajo\n")), 0);
  assert.match(err(), /no pude commitear los cambios del worker/);
  assert.match(readFileSync(path.join(pa.state, c.slug, `${c.ts}.listo`), "utf8"), /^rc=0$/m);
  assert.equal(await enWorktree(["rev-parse", "HEAD"]), c.base);
  assert.equal(readFileSync(nuevo, "utf8"), "trabajo\n");
});
