// `pa --estado` (B155): las corridas muertas en cola hace más de 7 días no tapan lo que corre ahora; salen contadas en una línea.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { cmdEstado } from "../electron/cli/pa/async.ts";
import { prologo } from "../electron/cli/pa/entorno.ts";

const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pa-estado-cola-")));
after(() => rmSync(raiz, { recursive: true, force: true }));

test("estado: una corrida muerta en cola de hace semanas se cuenta en una línea y la reciente se lista", async () => {
  let o = "";
  const env = { HOME: raiz, USERPROFILE: raiz, PA_STATE: path.join(raiz, "estado"), PA_JEFE: "", PA_JEFE_ID: "", PATH: process.env.PATH };
  const pa = prologo([], env, { out: (s) => (o += s), err: () => {} });
  const d = path.join(raiz, "estado", "demo");
  mkdirSync(d, { recursive: true });
  // pid inexistente (muerta); una vieja (--leer o no) y una de ahora
  const vieja = (id: string) => {
    writeFileSync(path.join(d, `${id}.pid`), "999999999");
    const hace = new Date(Date.now() - 40 * 86_400_000);
    utimesSync(path.join(d, `${id}.pid`), hace, hace);
  };
  vieja("20261001-100000-1");
  vieja("20261001-100001-2");
  writeFileSync(path.join(d, "20261001-100001-2.leer"), "");
  writeFileSync(path.join(d, "20261122-100000-3.pid"), "999999999");
  await cmdEstado(pa);
  assert.match(o, /MURIÓ EN COLA hace más de 7 días: 2 /);
  assert.match(o, /MURIÓ EN COLA demo\s+\(id: 20261122-100000-3,/);
  assert.doesNotMatch(o, /20261001-100000-1/);
  assert.doesNotMatch(o, /20261001-100001-2/);
});
