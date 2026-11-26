// Un worker que despierta solo después de su respuesta final (una tarea de fondo que terminó) deja en el `.json` sólo ese
// último mini-turno: 1 turno, 2 s y un RESULTADO sin verificación. `corregirDespertar` (electron/cli/pa/despertar.ts) lo
// arregla con el transcript. Y `decisionEsNada` (decision-nada.ts): «nada» seguido sólo de negaciones es nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { corregirDespertar, esDespertar, resumenTranscript } from "../electron/cli/pa/despertar.ts";
import { decisionEsNada } from "../electron/cli/pa/decision-nada.ts";
import { decisionEsNada as deHilos } from "../electron/cli/pa/hilos.ts";
import { decisionDe, decisionEsNada as deLanzar, verificadoDe } from "../electron/cli/pa/resultado-lanzar.ts";

const l = (o: unknown) => JSON.stringify(o) + "\n";
const asistente = (ts: string, id: string, texto: string) => l({ type: "assistant", timestamp: ts, message: { id, content: [{ type: "text", text: texto }] } });
const BUENO = "RESULTADO: Cerré el bug.\n\nARCHIVOS: a.ts\n\nVERIFICACION: `npm test`\n5 pass\n\nDECISION: nada\n\nSIGUE: Integrar la rama.\n\nFRENÓ: nada";
const DESPERTO = "RESULTADO: Nada nuevo: el aviso es de mi comando de espera.\n\nARCHIVOS: ninguno\n\nVERIFICACION: ninguna, no corrí nada nuevo.\n\nDECISION: nada\n\nSIGUE: nada\n\nFRENÓ: nada";
const TRANSCRIPT =
  l({ type: "user", timestamp: "2026-11-22T10:22:00.000Z", message: { content: "la tarea" } }) +
  // un mismo mensaje en dos líneas (un bloque por línea): cuenta una vez
  l({ type: "assistant", timestamp: "2026-11-22T10:22:05.000Z", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } }) +
  l({ type: "assistant", timestamp: "2026-11-22T10:22:06.000Z", message: { id: "m1", content: [{ type: "tool_use", id: "t2", name: "Read", input: {} }] } }) +
  l({ type: "assistant", timestamp: "2026-11-22T10:30:00.000Z", isSidechain: true, message: { id: "s1", content: [{ type: "text", text: "RESULTADO: de un subagente" }] } }) +
  asistente("2026-11-22T10:59:50.000Z", "m2", BUENO) +
  l({ type: "user", timestamp: "2026-11-22T11:09:10.000Z", message: { content: "<task-notification>…</task-notification>" } }) +
  asistente("2026-11-22T11:09:12.000Z", "m3", DESPERTO);
const JSON_DESPERTO = { type: "result", is_error: false, num_turns: 1, duration_ms: 2433, total_cost_usd: 1.65, result: DESPERTO, result_index: 1, origin: { kind: "task-notification" }, session_id: "s" };

function conCarpeta(f: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "despertar-"));
  try {
    f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("esDespertar: por result_index o por el origen; un resultado común no", () => {
  assert.equal(esDespertar({ result_index: 1 }), true);
  assert.equal(esDespertar({ origin: { kind: "task-notification" } }), true);
  assert.equal(esDespertar({ result_index: 0, origin: { kind: "user" } }), false);
  assert.equal(esDespertar({ num_turns: 30 }), false);
  assert.equal(esDespertar(null), false);
});

test("resumenTranscript: turnos por mensaje (no por línea), sin subagentes, y la duración de punta a punta", () => {
  conCarpeta((dir) => {
    const t = path.join(dir, "t.jsonl");
    writeFileSync(t, TRANSCRIPT);
    const r = resumenTranscript(t)!;
    assert.equal(r.turnos, 3);
    assert.equal(r.duracionMs, Date.parse("2026-11-22T11:09:12.000Z") - Date.parse("2026-11-22T10:22:00.000Z"));
    assert.deepEqual(r.resultados, [BUENO, DESPERTO]);
    // de una corrida anterior de la misma sesión no se cuenta nada
    assert.equal(resumenTranscript(t, Date.parse("2026-11-22T11:00:00.000Z"))!.turnos, 1);
    assert.equal(resumenTranscript(path.join(dir, "no-existe.jsonl")), null);
  });
});

test("corregirDespertar: vuelven los turnos, la duración y el RESULTADO verificado; lo que dijo al despertar queda en una línea", () => {
  conCarpeta((dir) => {
    const t = path.join(dir, "t.jsonl");
    const out = path.join(dir, "c.json");
    writeFileSync(t, TRANSCRIPT);
    writeFileSync(out, JSON.stringify(JSON_DESPERTO));
    assert.equal(corregirDespertar(out, t), true);
    const j = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>;
    assert.equal(j.num_turns, 3);
    assert.equal(j.duration_ms, 2832000);
    assert.deepEqual(j.despertar, { num_turns: 1, duration_ms: 2433 });
    assert.equal(j.total_cost_usd, 1.65);
    const res = String(j.result);
    assert.ok(res.startsWith(BUENO));
    assert.equal(verificadoDe(res), true);
    // los campos son los del resultado bueno: la línea agregada no trae encabezados
    assert.equal(decisionDe(res), "nada");
    assert.match(res, /\n\n— Después de este resultado el worker despertó por una tarea de fondo y agregó: Nada nuevo: el aviso es de mi comando de espera\.$/);
    // ya corregido: no se toca dos veces
    assert.equal(corregirDespertar(out, t), false);
  });
});

test("corregirDespertar: si al despertar trajo su propia verificación, ese RESULTADO manda; sin transcript no se toca", () => {
  conCarpeta((dir) => {
    const t = path.join(dir, "t.jsonl");
    const out = path.join(dir, "c.json");
    const fallo = "RESULTADO: El test de fondo falló.\n\nVERIFICACION: `npm test`\n3 fail\n\nDECISION: nada\n\nSIGUE: Arreglar los 3 tests.";
    writeFileSync(t, TRANSCRIPT + asistente("2026-11-22T11:10:00.000Z", "m4", fallo));
    writeFileSync(out, JSON.stringify({ ...JSON_DESPERTO, result: fallo }));
    assert.equal(corregirDespertar(out, t), true);
    const j = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>;
    assert.equal(j.result, fallo);
    assert.equal(j.num_turns, 4);

    const crudo = JSON.stringify(JSON_DESPERTO);
    writeFileSync(out, crudo);
    assert.equal(corregirDespertar(out, path.join(dir, "no-existe.jsonl")), false);
    assert.equal(readFileSync(out, "utf8"), crudo);
    // un resultado común no se toca aunque haya transcript
    writeFileSync(out, JSON.stringify({ ...JSON_DESPERTO, result_index: 0, origin: { kind: "user" } }));
    assert.equal(corregirDespertar(out, t), false);
  });
});

test("decisionEsNada: «nada» y «nada.» seguido sólo de negaciones; lo que trae algo para leer sigue pendiente", () => {
  for (const f of [decisionEsNada, deHilos, deLanzar]) {
    for (const s of ["nada", "Nada.", "**nada**", " nada ", "nada que decidir.", "Nada para decidir", "nada. No hay cambios propios que commitear, así que no hice ningún commit. Ningún trabajo quedó sin terminar.", "nada. Sin cambios."])
      assert.equal(f(s), true, s);
    for (const s of [
      "",
      "nada. Supuestos: usé la v2.",
      "nada. Supuesto: el diff suelto se descartó.",
      "nada, salvo que haya que decidir el nombre",
      "nada. Quedó sin terminar todo lo demás: pasar la prueba.",
      "nada que decidir. Quedó sin terminar:",
      "nada. (Falta que el dueño confirme en el overlay real.)",
      "nada. Conviene que alguien renombre punto.css.",
      "nada. Faltó revisar a fondo 290 y 302.",
      "nada. No hay tests para esto, hay que escribirlos.",
      "nada. No pude correr los tests.",
      "nada. ¿No hay que borrar la tabla?",
      "Decidir si se borra la tabla vieja de sesiones.",
      "nadador",
    ])
      assert.equal(f(s), false, s);
  }
});
