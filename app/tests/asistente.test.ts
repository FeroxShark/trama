// "Pasárselo a un líder": los datos (electron/asistente.ts) y el texto en el
// idioma elegido (src/datos/asistente.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionDeConversacion, resultadoDeConversacion, seccionDecision, seccionResultado } from "../electron/asistente.ts";
import { promptPasar as pasar } from "../src/datos/asistente.ts";
import { cambiarIdioma } from "../src/i18n/index.ts";

/** En español, como lo pide Ana con el idioma en "es". */
const enEs =
  <D,>(f: (d: D) => string) =>
  (d: D) => {
    cambiarIdioma("es");
    try {
      return f(d);
    } finally {
      cambiarIdioma("en");
    }
  };
const promptPasar = enEs(pasar);

const base = {
  id: "20260101-120000-123",
  proyecto: "atlas",
  ruta: "/tmp/atlas",
  rama: "pa/atlas/20260101-120000-123",
  commits: ["abc1234 paginado por cursor", "def5678 tests del cursor"],
  tope: 20,
  tarea: "Paginar el listado",
  resultado: "Paginado por cursor. Tests verdes.",
};

test("muchos commits: lista hasta el tope", () => {
  const commits = Array.from({ length: 21 }, (_, i) => `c${i} cambio`);
  const p = promptPasar({ ...base, commits, decision: null });
  assert.ok(p.includes("Commits (más de 20):"));
  assert.ok(p.includes("c19 cambio") && !p.includes("c20 cambio"));
});

test("seccionResultado: entero, hasta ARCHIVOS o DECISION", () => {
  assert.equal(seccionResultado("Bla\nRESULTADO: hice X.\nY también.\nARCHIVOS: a.ts\nDECISION: nada"), "hice X.\nY también.");
  assert.equal(seccionResultado("**RESULTADO:** listo\n**DECISION:** nada"), "listo");
  assert.equal(seccionResultado("sin formato"), null);
});

test("resultadoDeConversacion: la última respuesta con RESULTADO", () => {
  const conv = {
    mensajes: [
      { rol: "assistant", texto: "RESULTADO: viejo" },
      { rol: "user", texto: "RESULTADO: no es del worker" },
      { rol: "assistant", texto: "RESULTADO: nuevo\nARCHIVOS: x" },
      { rol: "assistant", texto: "algo sin formato" },
    ],
  };
  assert.equal(resultadoDeConversacion(conv), "nuevo");
  assert.equal(resultadoDeConversacion({}), null);
  assert.equal(resultadoDeConversacion(null), null);
});

test("seccionDecision: la última DECISION entera; 'nada' no cuenta", () => {
  assert.equal(seccionDecision("RESULTADO: x\nDECISION: ¿integro A o B?\nA es más rápido.\nB es más seguro."), "¿integro A o B?\nA es más rápido.\nB es más seguro.");
  assert.equal(seccionDecision("**DECISION:** nada"), null);
  assert.equal(seccionDecision("sin formato"), null);
  assert.equal(
    decisionDeConversacion({ mensajes: [{ rol: "assistant", texto: "DECISION: vieja" }, { rol: "user", texto: "ok" }, { rol: "assistant", texto: "DECISION: nueva" }] }),
    "nueva",
  );
  // Sólo la última respuesta: si ya no pregunta, no hay decisión pendiente.
  assert.equal(decisionDeConversacion({ mensajes: [{ rol: "assistant", texto: "DECISION: vieja" }, { rol: "assistant", texto: "listo" }] }), null);
});

test("pasárselo a un líder: id, proyecto, rama y commits, RESULTADO, DECISION entera y el pedido en criollo", () => {
  const p = promptPasar({ ...base, decision: "¿Borro la tabla vieja?\nOcupa 2 GB." });
  for (const x of [base.id, "atlas (/tmp/atlas)", base.rama, "  - abc1234 paginado por cursor", base.resultado, "DECISION que me dejó:\n¿Borro la tabla vieja?\nOcupa 2 GB."])
    assert.ok(p.includes(x), x);
  assert.ok(p.endsWith("Explicame en criollo qué necesita de mí y seguilo vos."));
  const sin = promptPasar({ ...base, rama: null, decision: null, resultado: null });
  assert.ok(sin.includes("- Sin rama") && !sin.includes("Commits"));
  assert.ok(sin.includes("(no dejó RESULTADO)"));
  const en = pasar({ ...base, decision: null });
  for (const x of ["- Run id: 20260101-120000-123 (the whole conversation: `pa --hilo 20260101-120000-123`)", "The DECISION it left me:", "read it with `pa --hilo`"])
    assert.ok(en.includes(x), x);
});
