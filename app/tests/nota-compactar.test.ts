import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contarNota, partirNotaCompactar, turnoTieneNota } from "../src/hilo/nota-compactar.ts";
import { turnos } from "../src/hilo/turnos.ts";
import type { Mensaje } from "../src/datos/contrato.ts";

const msg = (i: number, rol: Mensaje["rol"], texto: string, extra?: Partial<Mensaje>): Mensaje => ({
  i,
  rol,
  ts: null,
  texto,
  herramientas: [],
  det: [],
  modelo: null,
  error: null,
  imagenes: [],
  ...extra,
});

describe("partirNotaCompactar", () => {
  it("devuelve null si no hay etiqueta", () => {
    assert.equal(partirNotaCompactar("Texto común sin nota."), null);
    assert.equal(partirNotaCompactar(""), null);
  });

  it("separa antes, nota y después en una nota cerrada y cuenta secciones y palabras", () => {
    const cuerpo = [
      "## Objetivo",
      "Implementar tarjetas plegables en el hilo.",
      "",
      "## Decisiones",
      "Usar el mismo estilo visual de las revisiones.",
    ].join("\n");
    const r = partirNotaCompactar(`Listo, preparé la nota:\n\n[[nota-compactar]]\n${cuerpo}\n[[/nota-compactar]]\n\nYa podés compactar.`);
    assert.ok(r);
    assert.equal(r.cerrada, true);
    assert.equal(r.antes, "Listo, preparé la nota:");
    assert.equal(r.nota, cuerpo);
    assert.equal(r.despues, "Ya podés compactar.");
    assert.equal(r.secciones, 2);
    assert.equal(r.palabras, 16);
  });

  it("maneja streaming sin etiqueta de cierre sólo con vivo=true", () => {
    const parcial = "Voy dejando todo anotado:\n\n[[nota-compactar]]\n## Objetivo\nCerrar fase 2B";
    assert.equal(partirNotaCompactar(parcial), null);
    assert.equal(partirNotaCompactar(parcial, { vivo: false }), null);

    const vivo = partirNotaCompactar(parcial, { vivo: true });
    assert.ok(vivo);
    assert.equal(vivo.cerrada, false);
    assert.equal(vivo.antes, "Voy dejando todo anotado:");
    assert.equal(vivo.despues, "");
    assert.equal(vivo.secciones, 1);
    assert.equal(vivo.palabras, 4);

    // Recién abrió la etiqueta mientras streamea
    const recienAbierta = partirNotaCompactar("[[nota-compactar]]\n", { vivo: true });
    assert.ok(recienAbierta);
    assert.equal(recienAbierta.cerrada, false);
    assert.equal(recienAbierta.nota, "");
  });

  it("descarta etiquetas cerradas vacías", () => {
    assert.equal(partirNotaCompactar("[[nota-compactar]]   \n  [[/nota-compactar]]"), null);
  });

  it("ignora menciones literales dentro de cercas de código o comillas invertidas", () => {
    const conEjemplo = [
      "Usá `[[nota-compactar]]...[[/nota-compactar]]` cuando falte poco.",
      "",
      "```md",
      "[[nota-compactar]]",
      "## Ejemplo",
      "[[/nota-compactar]]",
      "```",
    ].join("\n");
    assert.equal(partirNotaCompactar(conEjemplo), null);

    const conCercaYNotaReal = `${conEjemplo}\n\n[[nota-compactar]]\n## Estado\nTodo listo.\n[[/nota-compactar]]`;
    const r = partirNotaCompactar(conCercaYNotaReal);
    assert.ok(r);
    assert.equal(r.cerrada, true);
    assert.equal(r.nota, "## Estado\nTodo listo.");
    assert.ok(r.antes.includes("```md"));
  });

  it("no cierra la nota prematuramente si menciona [[/nota-compactar]] en inline code adentro", () => {
    const texto = "[[nota-compactar]]\n## Regla\nCerrá con `[[/nota-compactar]]` al terminar.\n[[/nota-compactar]]";
    const r = partirNotaCompactar(texto);
    assert.ok(r);
    assert.equal(r.nota, "## Regla\nCerrá con `[[/nota-compactar]]` al terminar.");
    assert.equal(r.despues, "");
  });

  it("cuenta viñetas con título en negrita cuando no hay encabezados Markdown", () => {
    const c = contarNota("- **Objetivo**: Migrar hilos\n- **Próximo paso**: Correr tests");
    assert.equal(c.secciones, 2);
    assert.equal(c.palabras, 7);
  });
});

describe("turnoTieneNota y turnos() con compacto", () => {
  it("marca el divisor compacto con la key del último turno del asistente si trajo nota", () => {
    const lista: Mensaje[] = [
      msg(1, "user", "Preparame la nota antes de compactar"),
      msg(2, "assistant", "Acá tenés:\n[[nota-compactar]]\n## Objetivo\nSeguir con fase 2B\n[[/nota-compactar]]"),
      msg(3, "system", "", { compacto: { auto: false, antes: 120000 } }),
    ];
    const its = turnos(lista);
    const sis = its.find((it) => it.tipo === "sistema");
    assert.ok(sis && sis.tipo === "sistema" && sis.s.tipo === "linea" && sis.s.clase === "compacto");
    assert.equal(sis.s.nota, "m2");
  });

  it("no asocia una nota vieja si hubo otro turno del asistente después sin nota", () => {
    const lista: Mensaje[] = [
      msg(1, "assistant", "[[nota-compactar]]\n## Viejo\nAlgo\n[[/nota-compactar]]"),
      msg(2, "user", "Otro pedido"),
      msg(3, "assistant", "Contestación común sin nota."),
      msg(4, "system", "", { compacto: { auto: true, antes: 160000 } }),
    ];
    const its = turnos(lista);
    const sis = its.find((it) => it.tipo === "sistema");
    assert.ok(sis && sis.tipo === "sistema" && sis.s.tipo === "linea" && sis.s.clase === "compacto");
    assert.equal(sis.s.nota, undefined);
  });

  it("detecta notas tanto en texto lineal como en pasos intercalados", () => {
    assert.equal(turnoTieneNota({ texto: "[[nota-compactar]]\n## Fin\nListo\n[[/nota-compactar]]" }), true);
    assert.equal(
      turnoTieneNota({
        texto: null,
        orden: [{ texto: "Paso 1" }, { texto: "[[nota-compactar]]\n## Paso 2\nCerrado\n[[/nota-compactar]]" }],
      }),
      true,
    );
    assert.equal(turnoTieneNota({ texto: "[[nota-compactar]]abierta sin cerrar" }), false);
  });
});
