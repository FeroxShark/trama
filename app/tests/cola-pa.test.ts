import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { completarCola, conLider, jefeDeCorrida, tareaDeArgv } from "../electron/cola-pa.ts";

const ID = "20261014-213605-613661";
const MUERTO = "20261014-213511-587917";

/** Un `$PA_STATE` y un `/proc` de mentira: lo que `pa` deja de un worker en cola. */
function armar() {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "cola-pa-"));
  const proc = path.join(raiz, "proc");
  mkdirSync(path.join(raiz, "atlas"), { recursive: true });
  mkdirSync(path.join(proc, "4242"), { recursive: true });
  const f = (id: string, ext: string, texto: string) => writeFileSync(path.join(raiz, "atlas", `${id}.${ext}`), texto);
  f(ID, "cola", "tope global: 5 workers vivos");
  f(ID, "jefe", "jefe=ana-a3\njefe_id=s-fix-a3\n");
  f(ID, "pid", "4242");
  writeFileSync(path.join(proc, "4242", "cmdline"), ["bash", "/home/ana/.local/bin/pa", "atlas", "-m", "claude-haiku-5-5", "--", "Índice por fecha", "en envíos"].join("\0") + "\0");
  // Murió en la cola: el `.cola` sigue, el proceso ya no.
  f(MUERTO, "cola", "los 3 puestos ocupados");
  f(MUERTO, "jefe", "jefe=ana-a3\njefe_id=s-fix-a3\n");
  f(MUERTO, "pid", "9999");
  return { raiz, proc, limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}

const fila = (id: string, p: object) => ({ id, proyecto: "atlas", estado: "trabajando", en_cola: false, tarea: null, rama: null, jefe: null, jefe_id: null, ...p });

test("tareaDeArgv: lo que sigue al primer `--`, sólo si es un `pa`", () => {
  assert.equal(tareaDeArgv(["bash", "/x/pa", "p", "--", "Hacé", "esto  ", "otro"]), "Hacé esto otro");
  assert.equal(tareaDeArgv(["/x/pa", "p", "--tipo", "x"]), null, "sin `--` no hay tarea");
  assert.equal(tareaDeArgv(["sleep", "10", "--", "algo"]), null, "un pid reusado por otra cosa");
  assert.equal(tareaDeArgv(["/x/pa", "p", "--", "a".repeat(900)])?.length, 500);
});

test("en cola: el motivo, el líder (del .jefe) y la tarea (de la línea de comando del pid) se completan", async () => {
  const { raiz, proc, limpiar } = armar();
  try {
    const h = fila(ID, { en_cola: true });
    assert.equal(await completarCola([h], raiz, proc), 3);
    assert.equal(h.tarea, "Índice por fecha en envíos");
    assert.equal(h.jefe_id, "s-fix-a3");
    assert.equal(h.jefe, "ana-a3");
    assert.equal((h as any).cola_motivo, "tope global: 5 workers vivos");
    assert.equal(await completarCola([h], raiz, proc), 0, "la segunda vez no hay nada nuevo");
  } finally {
    limpiar();
  }
});

test("en cola: lo que `pa` ya dijo no se pisa, y sin pid vivo queda sin tarea (no se inventa)", async () => {
  const { raiz, proc, limpiar } = armar();
  try {
    const h = fila(ID, { en_cola: true, tarea: "La de pa", jefe_id: "otro", jefe: "ana-z" });
    await completarCola([h], raiz, proc);
    assert.equal(h.tarea, "La de pa");
    assert.equal(h.jefe_id, "otro");
    const sin = fila(MUERTO, { en_cola: true });
    await completarCola([sin], raiz, proc);
    assert.equal(sin.tarea, null);
    assert.equal(sin.jefe_id, "s-fix-a3");
  } finally {
    limpiar();
  }
});

test("murió en la cola sin arrancar: pid muerto + `.cola` que quedó → sin_arrancar; un muerto común no", async () => {
  const { raiz, proc, limpiar } = armar();
  try {
    const m = fila(MUERTO, { estado: "murio" });
    await completarCola([m], raiz, proc);
    assert.equal((m as any).sin_arrancar, true);
    assert.equal(m.jefe_id, "s-fix-a3", "queda bajo su líder");
    const comun = fila("20261014-100000-1", { estado: "murio" });
    await completarCola([comun], raiz, proc);
    assert.equal((comun as any).sin_arrancar, undefined);
    const conRama = fila(MUERTO, { estado: "murio", rama: "pa/atlas/x" });
    await completarCola([conRama], raiz, proc);
    assert.equal((conRama as any).sin_arrancar, undefined, "si llegó a tener rama, arrancó");
  } finally {
    limpiar();
  }
});

test("ids y carpetas raras no salen de $PA_STATE", async () => {
  const { raiz, proc, limpiar } = armar();
  try {
    const h = fila("../../etc/passwd", { en_cola: true });
    assert.equal(await completarCola([h, fila(ID, { proyecto: "../x", en_cola: true })], raiz, proc), 0);
  } finally {
    limpiar();
  }
});

test("jefeDeCorrida / conLider: el `inicio` de un worker recién lanzado trae su líder (de .corrida, o de .jefe si falta)", async () => {
  const { raiz, limpiar } = armar();
  try {
    const NUEVO = "20261021-195500-1111";
    const f = (id: string, ext: string, texto: string) => writeFileSync(path.join(raiz, "atlas", `${id}.${ext}`), texto);
    f(NUEVO, "jefe", "jefe=ana-1b\njefe_id=s-uno\n");
    assert.deepEqual(await jefeDeCorrida(raiz, "atlas", NUEVO), { jefe_id: "s-uno", jefe: "ana-1b" }, "sólo .jefe");
    f(NUEVO, "corrida", "rama=pa/x\njefe=ana-1b\njefe_id=s-dos\n");
    assert.equal((await jefeDeCorrida(raiz, "atlas", NUEVO))?.jefe_id, "s-dos", "la .corrida manda");
    assert.equal(await jefeDeCorrida(raiz, "atlas", "20261021-195500-2222"), null, "sin archivos no se inventa");
    assert.equal(await jefeDeCorrida(raiz, "../x", NUEVO), null, "proyecto raro");
    const es = await conLider(
      [
        { tipo: "inicio", id: NUEVO, proyecto: "atlas", ts: 1 },
        { tipo: "fin", id: NUEVO, proyecto: "atlas", ts: 2 },
        { tipo: "inicio", id: "20261021-195500-3333", proyecto: "atlas", ts: 3 },
      ],
      raiz,
    );
    assert.equal(es[0].jefe_id, "s-dos");
    assert.equal(es[1].jefe_id, undefined, "sólo el inicio");
    assert.equal(es[2].jefe_id, undefined, "un inicio sin dato queda igual");
  } finally {
    limpiar();
  }
});
