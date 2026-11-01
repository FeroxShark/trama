// electron/puntos.ts: puntos de control por turno, contra repos de git reales en carpetas temporales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { antes, cambios, despues, dif, lista, raizDe, volver } from "../electron/puntos.ts";

// `.native`: en Windows da el nombre largo (git lo devuelve así), no el corto 8.3 del tmp del runner.
const tmp = () => realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "trama-test-puntos-")));
const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" });

function repo() {
  const raiz = tmp();
  g(raiz, "init", "-q");
  writeFileSync(path.join(raiz, "a.txt"), "uno\ndos\n");
  writeFileSync(path.join(raiz, "b.txt"), "bé\n");
  writeFileSync(path.join(raiz, ".gitignore"), "ignorado.txt\n");
  g(raiz, "add", "-A");
  g(raiz, "commit", "-q", "-m", "base");
  return { raiz, estado: tmp() };
}
const limpiar = (...d: string[]) => d.forEach((x) => rmSync(x, { recursive: true, force: true }));

test("raizDe: un repo da su raíz; una carpeta sin git, el home o nada dan null", async () => {
  const { raiz, estado } = repo();
  try {
    mkdirSync(path.join(raiz, "sub"));
    assert.equal(await raizDe(path.join(raiz, "sub"), "/otro-home"), raiz);
    assert.equal(await raizDe(raiz, raiz), null);
    assert.equal(await raizDe(undefined), null);
    assert.equal(await raizDe(estado, "/otro-home"), null);
  } finally {
    limpiar(raiz, estado);
  }
});

test("un turno: guarda antes y después, lista lo tocado y no ensucia el índice ni la rama del usuario", async () => {
  const { raiz, estado } = repo();
  try {
    const p = await antes(estado, "s1", raiz, 1000);
    assert.ok(p);
    writeFileSync(path.join(raiz, "a.txt"), "uno\ndos\ntres\n");
    rmSync(path.join(raiz, "b.txt"));
    mkdirSync(path.join(raiz, "nuevo"));
    writeFileSync(path.join(raiz, "nuevo", "c.txt"), "c\n");
    writeFileSync(path.join(raiz, "ignorado.txt"), "x");
    const d = await despues(estado, "s1", 2000);
    assert.deepEqual(d?.archivos, [
      { ruta: "a.txt", estado: "M", mas: 1, menos: 0 },
      { ruta: "b.txt", estado: "D", mas: 0, menos: 1 },
      { ruta: "nuevo/c.txt", estado: "A", mas: 1, menos: 0 },
    ]);
    assert.equal(d?.fin, 2000);
    assert.equal(lista(estado, "s1").length, 1);
    // Lo del usuario no se tocó: nada preparado, la rama donde estaba y sin stash.
    assert.equal(g(raiz, "diff", "--cached", "--name-only"), "");
    assert.equal(g(raiz, "stash", "list"), "");
    assert.match(g(raiz, "for-each-ref", "refs/trama"), /refs\/trama\/puntos\/s1\//);
    assert.equal(g(raiz, "log", "--oneline").trim().split("\n").length, 1);
  } finally {
    limpiar(raiz, estado);
  }
});

test("un turno sin cambios queda con archivos vacíos; despues sin punto abierto no hace nada", async () => {
  const { raiz, estado } = repo();
  try {
    assert.equal(await despues(estado, "s1"), null);
    await antes(estado, "s1", raiz, 1);
    const d = await despues(estado, "s1", 2);
    assert.deepEqual(d?.archivos, []);
    assert.equal(await despues(estado, "s1"), null);
  } finally {
    limpiar(raiz, estado);
  }
});

test("dif: el diff del turno, de todos los archivos o de uno", async () => {
  const { raiz, estado } = repo();
  try {
    const p = await antes(estado, "s1", raiz, 1);
    writeFileSync(path.join(raiz, "a.txt"), "uno\nDOS\n");
    writeFileSync(path.join(raiz, "b.txt"), "otro\n");
    assert.deepEqual(await dif(estado, "s1", p!.id), { ok: false, motivo: "ocupado" });
    await despues(estado, "s1", 2);
    const todo = await dif(estado, "s1", p!.id);
    assert.ok(todo.ok && todo.valor.texto.startsWith("diff --git a/a.txt") && todo.valor.texto.includes("+DOS") && todo.valor.texto.includes("b.txt"));
    const uno = await dif(estado, "s1", p!.id, "b.txt");
    assert.ok(uno.ok && !uno.valor.texto.includes("a.txt") && uno.valor.texto.includes("+otro"));
    assert.deepEqual(await dif(estado, "s1", "nada"), { ok: false, motivo: "sinPunto" });
  } finally {
    limpiar(raiz, estado);
  }
});

test("volver: restaura lo cambiado y lo borrado, borra lo nuevo (y sus carpetas) y deja una foto para deshacer", async () => {
  const { raiz, estado } = repo();
  try {
    const p1 = await antes(estado, "s1", raiz, 1);
    writeFileSync(path.join(raiz, "a.txt"), "turno 1\n");
    await despues(estado, "s1", 2);
    await antes(estado, "s1", raiz, 3);
    rmSync(path.join(raiz, "b.txt"));
    mkdirSync(path.join(raiz, "x", "y"), { recursive: true });
    writeFileSync(path.join(raiz, "x", "y", "n.txt"), "n");
    writeFileSync(path.join(raiz, "ignorado.txt"), "se queda");
    await despues(estado, "s1", 4);

    const r = await volver(estado, "s1", p1!.id, 5);
    assert.deepEqual(r, { ok: true, valor: { restaurados: 2, borrados: 1 } });
    assert.equal(readFileSync(path.join(raiz, "a.txt"), "utf8"), "uno\ndos\n");
    assert.equal(readFileSync(path.join(raiz, "b.txt"), "utf8"), "bé\n");
    assert.ok(!existsSync(path.join(raiz, "x")));
    assert.equal(readFileSync(path.join(raiz, "ignorado.txt"), "utf8"), "se queda");
    assert.equal(lista(estado, "s1")[0].vuelto, 5);
    assert.match(g(raiz, "for-each-ref", "refs/trama"), /volver-/);
    assert.equal(g(raiz, "status", "--porcelain"), "");
  } finally {
    limpiar(raiz, estado);
  }
});

test("antes cierra el punto que quedó abierto; sin repo no hay puntos; volver a un id que no existe falla", async () => {
  const { raiz, estado } = repo();
  const suelta = tmp();
  try {
    await antes(estado, "s1", raiz, 10);
    await antes(estado, "s1", raiz, 20);
    const l = lista(estado, "s1");
    assert.equal(l[0].fin, 20);
    assert.equal(l[1].fin, null);
    assert.equal(await antes(estado, "s2", suelta, 1), null);
    assert.deepEqual(lista(estado, "s2"), []);
    assert.deepEqual(await volver(estado, "s1", "nada"), { ok: false, motivo: "sinPunto" });
    assert.deepEqual(await cambios(raiz, l[0].antes, l[0].antes), []);
  } finally {
    limpiar(raiz, estado, suelta);
  }
});
