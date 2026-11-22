// CTX-43: el tope `--autocompact` con que `pa` lanzó un worker queda en su `.hilo` y el panel lo lee de ahí.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { topeDeWorker } from "../electron/consumo.ts";

const ID = "20261122-052822-3341071";

test("topeDeWorker: lee autocompact= del .hilo; vacío, cero o sin campo es la ventana nativa", async () => {
  const estado = mkdtempSync(path.join(os.tmpdir(), "tope-worker-"));
  try {
    mkdirSync(path.join(estado, "demo"));
    const hilo = (texto: string) => writeFileSync(path.join(estado, "demo", `${ID}.hilo`), texto);
    hilo("tarea=x\nautocompact=150000\nsubtarea=\n");
    assert.equal(await topeDeWorker(estado, ID), 150_000);
    hilo("tarea=x\nautocompact=\n");
    assert.equal(await topeDeWorker(estado, ID), null);
    hilo("tarea=x\nautocompact=0\n");
    assert.equal(await topeDeWorker(estado, ID), null);
    hilo("tarea=x\n");
    assert.equal(await topeDeWorker(estado, ID), null);
    assert.equal(await topeDeWorker(estado, "otro"), null);
    assert.equal(await topeDeWorker(path.join(estado, "no-existe"), ID), null);
  } finally {
    rmSync(estado, { recursive: true, force: true });
  }
});
