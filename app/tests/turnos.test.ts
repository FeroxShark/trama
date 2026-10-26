import { test } from "node:test";
import assert from "node:assert/strict";
import { juntar, partirDecision, repiteElPrimero, turnos } from "../src/hilo/turnos.ts";
import { tituloLider } from "../electron/tema.ts";
import type { Mensaje } from "../src/datos/contrato.ts";

let n = 0;
const ts = (s: number) => new Date(s * 1000).toISOString();
const yo = (texto: string, s: number): Mensaje => ({ i: n++, rol: "user", texto, herramientas: [], ts: ts(s), modelo: null });
const el = (texto: string, herramientas: string[], s: number): Mensaje => ({
  i: n++,
  rol: "assistant",
  texto,
  herramientas,
  ts: ts(s),
  modelo: "claude-opus-5-5",
});

test("pedido, trabajo colapsado y la última respuesta", () => {
  n = 0;
  const its = turnos([
    yo("hacé X", 1000),
    el("Leo.", ["Read"], 1010),
    el("", ["Bash"], 1020),
    el("", ["Edit", "Edit"], 1030),
    el("RESULTADO: listo", [], 1600),
  ]);
  assert.equal(its.length, 2);
  assert.deepEqual(its[0], { tipo: "yo", key: "m0", texto: "hacé X", ts: 1000 });
  const t = its[1];
  assert.equal(t.tipo, "turno");
  if (t.tipo !== "turno") return;
  assert.equal(t.texto, "RESULTADO: listo");
  assert.equal(t.desde, 1000);
  assert.equal(t.hasta, 1600);
  assert.deepEqual(
    t.pasos.map((p) => ({ texto: p.texto, nombres: p.usos.map((u) => u.nombre) })),
    [
      { texto: "Leo.", nombres: ["Read"] },
      { texto: "", nombres: ["Bash", "Edit", "Edit"] },
    ],
  );
});

test("trabajando: sin texto todavía, todo es trabajo", () => {
  n = 0;
  const its = turnos([yo("y", 0), el("", ["Read"], 5), el("", ["Grep"], 9)]);
  const t = its[1];
  assert.ok(t.tipo === "turno" && t.texto === null && t.pasos.length === 1);
});

test("dos pedidos, dos turnos; página que empieza a mitad de turno", () => {
  n = 0;
  const its = turnos([el("", ["Read"], 50), el("listo 1", [], 60), yo("seguí", 100), el("listo 2", ["Bash"], 160)]);
  assert.deepEqual(
    its.map((x) => x.tipo),
    ["turno", "yo", "turno"],
  );
  const a = its[0];
  assert.ok(a.tipo === "turno" && a.desde === 50 && a.texto === "listo 1");
  const b = its[2];
  assert.ok(b.tipo === "turno" && b.desde === 100 && b.pasos[0].usos[0].nombre === "Bash");
});

test("juntar", () => {
  n = 0;
  const a = [yo("a", 0), el("b", [], 1)];
  const b = [el("b", [], 1), yo("c", 2)];
  b[0].i = 1;
  b[1].i = 2;
  assert.deepEqual(
    juntar(a, b).map((m) => m.i),
    [0, 1, 2],
  );
});

test("partirDecision: lo de DECISION va aparte, entero", () => {
  const t = "RESULTADO: hecho.\nARCHIVOS: a.ts\nDECISION:\n- **Uno:** esto\n- **Dos:** aquello";
  assert.deepEqual(partirDecision(t), { antes: "RESULTADO: hecho.\nARCHIVOS: a.ts", decision: "- **Uno:** esto\n- **Dos:** aquello" });
  assert.deepEqual(partirDecision("Listo.\n**DECISION:** ¿corto ya?"), { antes: "Listo.", decision: "¿corto ya?" });
  assert.equal(partirDecision("RESULTADO: x\nDECISION: nada"), null);
  assert.equal(partirDecision("sin nada que decidir"), null);
  // "DECISION" a mitad de renglón no cuenta.
  assert.equal(partirDecision("la DECISION: queda para después"), null);
});

test("repiteElPrimero: el título que salió del primer mensaje no se muestra otra vez arriba de su burbuja", () => {
  n = 0;
  const largo = "¿Sabés qué?   Quiero saber si salió un modelo nuevo\ny me gustaría integrarlo en trama, con todas sus herramientas y sus límites";
  const its = turnos([yo(largo, 1000), el("Existe.", [], 1060)]);
  // Lo que arma el main sin /rename ni ai-title: la primera línea del primer mensaje, sin espacios de más.
  const titulo = tituloLider({ custom: null, ai: null, primero: largo }, "trama-dce1");
  assert.equal(titulo, "¿Sabés qué? Quiero saber si salió un modelo nuevo");
  assert.ok(repiteElPrimero(titulo, its));
  assert.ok(!repiteElPrimero("omc v2", its));
  assert.ok(!repiteElPrimero("", its));
  // Una conversación retomada, cuya primera página no trae el primer mensaje, no tiene burbuja que lo repita.
  assert.ok(!repiteElPrimero(titulo, turnos([el("Existe.", [], 1060)])));
  // Un título que sólo está adentro del mensaje no es un eco.
  assert.ok(!repiteElPrimero("modelo nuevo", its));
});

test("el razonamiento de un turno: un texto por mensaje, en orden, y el junto de siempre", () => {
  n = 0;
  const con = (m: Mensaje, pensado: string): Mensaje => ({ ...m, pensado });
  const its = turnos([yo("hacé X", 1000), con(el("", ["Read"], 1010), "uno"), con(el("", ["Bash"], 1020), "dos"), con(el("Listo.", [], 1030), "tres")]);
  const t = its.at(-1)!;
  assert.equal(t.tipo, "turno");
  if (t.tipo !== "turno") return;
  assert.deepEqual(t.pensamientos, ["uno", "dos", "tres"]);
  assert.equal(t.pensado, "uno\n\ndos\n\ntres");
});
