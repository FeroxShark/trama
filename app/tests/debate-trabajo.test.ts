// El cableado del modo debate: iniciar → evento `debate:turno` en cada turno → cierre con la marca `[[debate-de-plan …]]` entregada al
// líder, con modelos simulados (sin Electron, sin gastar cupo). El moderador en sí: tests/debate.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearDebates, type PreparacionDebate } from "../electron/debate-trabajo.ts";
import { leerMensajeDebate, type EventoDebate } from "../electron/debate.ts";
import { esperarHasta } from "./esperar.ts";

const turno = (postura: string, plan = "", pregunta = "") => `## Postura\n${postura}\n\n## Argumento\nrazón\n${plan ? `\n## Plan propuesto\n${plan}\n` : ""}${pregunta ? `\n## Pregunta para el dueño\n${pregunta}\n` : ""}`;
const CONCLUSION = "## Acuerdos\n- Todo\n\n## Desacuerdos que quedan\nNinguno\n\n## Plan consensuado\n1. Final\n";
const P = (modelo: string) => ({ modelo, effort: "high" });

function armar(guion: Record<string, string[]>, rechazo?: Error) {
  const hecho = { eventos: [] as EventoDebate[], mandado: [] as string[], negado: [] as string[], guardado: [] as string[], preparados: 0 };
  const debates = crearDebates({
    avisar: (e) => hecho.eventos.push(e),
    preparar: async (x): Promise<PreparacionDebate> => {
      hecho.preparados++;
      if (rechazo) throw rechazo;
      assert.equal(x.id, "plan-1");
      return {
        plan: "# Plan del líder",
        deps: {
          correr: async (m) => guion[m]!.shift()!,
          pedidoOriginal: async () => "armá X",
          cwd: () => "/p",
          nombre: (m) => m.toUpperCase(),
          negar: (m) => hecho.negado.push(m),
          guardar: async (m) => void hecho.guardado.push(m),
          entregar: async (t) => void hecho.mandado.push(t),
        },
      };
    },
  });
  return { debates, hecho };
}

test("iniciar devuelve el estado enseguida, avisa cada turno por debate:turno y cierra entregando la marca al líder", async () => {
  const { debates, hecho } = armar({ a: [turno("cambio", "1. Test"), turno("acuerdo", "1. Test"), CONCLUSION], b: [turno("acuerdo", "1. Test"), turno("acuerdo", "1. Test")] });
  const inicial = await debates.iniciar({ sid: "lid", id: "plan-1", participantes: [P("a"), P("b")], rondas: 2 });
  assert.equal(inicial.sid, "lid");
  assert.equal(inicial.fase, "corriendo");
  assert.deepEqual(inicial.participantes.map((p) => p.nombre), ["A", "B"]);
  assert.equal(debates.estado("lid")?.id, inicial.id);

  await esperarHasta(() => debates.estado("lid")?.fase === "hecho");
  const turnos = hecho.eventos.filter((e) => e.linea?.tipo === "turno");
  assert.deepEqual(turnos.map((e) => [e.linea!.modelo, e.linea!.ronda]), [["a", 1], ["b", 1], ["a", 2], ["b", 2]]);
  assert.ok(hecho.eventos.every((e) => e.estado.id === inicial.id && e.estado.sid === "lid"));
  assert.equal(hecho.eventos.at(-1)!.estado.fase, "hecho");
  assert.ok(hecho.eventos.some((e) => e.estado.fase === "entregando"));

  // El cierre entra al líder con la marca, tras guardarlo; el plan pendiente se niega una vez.
  assert.equal(hecho.mandado.length, 1);
  assert.equal(hecho.guardado[0], hecho.mandado[0]);
  const m = leerMensajeDebate(hecho.mandado[0])!;
  assert.deepEqual([m.nombres, m.plan, m.motivo, m.rondas], [["A", "B"], "1. Final", "acuerdo", 2]);
  assert.equal(hecho.negado.length, 1);
});

test("responder, cortar y cancelar llegan al debate del líder indicado; un líder sin debate no los recibe", async () => {
  const { debates, hecho } = armar({ a: [turno("pregunta", "", "¿Qué base?\n- Postgres\n- SQLite"), CONCLUSION], b: [turno("acuerdo")] });
  await debates.iniciar({ sid: "lid", id: "plan-1", participantes: [P("a"), P("b")], rondas: 1 });
  await esperarHasta(() => debates.estado("lid")?.fase === "esperando");
  assert.equal(debates.responder("otro", "SQLite"), false);
  assert.equal(debates.responder("lid", "Mongo"), false);
  assert.equal(debates.responder("lid", "SQLite"), true);
  await esperarHasta(() => debates.estado("lid")?.fase === "hecho");
  assert.ok(debates.estado("lid")!.lineas.some((l) => l.tipo === "dueno" && l.argumento === "SQLite"));
  assert.equal(hecho.mandado.length, 1);
  debates.descartar("lid");
  assert.equal(debates.estado("lid"), null);
  assert.doesNotThrow(() => (debates.cortar("lid"), debates.cancelar("lid")));
});

test("cancelar: no se niega ni se entrega nada y el estado queda «cancelado»", async () => {
  const { debates, hecho } = armar({});
  // Un modelo que nunca contesta hasta que lo cortan.
  const d2 = crearDebates({
    avisar: (e) => hecho.eventos.push(e),
    preparar: async () => ({
      plan: "# Plan",
      deps: { correr: (_m, _e, _p, o) => new Promise<string>((_ok, no) => o.señal.addEventListener("abort", () => no(new Error("abortado")))), pedidoOriginal: async () => null, cwd: () => undefined, nombre: (m) => m, negar: (m) => hecho.negado.push(m), entregar: async (t) => void hecho.mandado.push(t) },
    }),
  });
  await d2.iniciar({ sid: "lid", id: "x", participantes: [P("a"), P("b")] });
  await esperarHasta(() => (d2.estado("lid")?.ronda ?? 0) === 1);
  assert.equal(d2.viva("lid"), true);
  d2.cancelar("lid");
  await esperarHasta(() => d2.estado("lid")?.fase === "cancelado");
  assert.deepEqual([hecho.negado.length, hecho.mandado.length], [0, 0]);
  assert.equal(debates.viva("lid"), false);
});

test("un debate por líder a la vez, y si preparar rechaza (plan ausente, modelo que no sirve) el rechazo sube sin dejar estado", async () => {
  const { debates } = armar({ a: [turno("acuerdo")], b: [turno("acuerdo")] }, new Error("sin plan pendiente"));
  await assert.rejects(debates.iniciar({ sid: "lid", id: "plan-1", participantes: [P("a"), P("b")] }), /sin plan pendiente/);
  assert.equal(debates.estado("lid"), null);

  const colgado = crearDebates({
    avisar: () => {},
    preparar: async () => ({ plan: "# P", deps: { correr: (_m, _e, _p, o) => new Promise<string>((_ok, no) => o.señal.addEventListener("abort", () => no(new Error("x")))), pedidoOriginal: async () => null, cwd: () => undefined, nombre: (m) => m, negar: () => {}, entregar: async () => {} } }),
  });
  await colgado.iniciar({ sid: "lid", id: "x", participantes: [P("a"), P("b")] });
  await assert.rejects(colgado.iniciar({ sid: "lid", id: "x", participantes: [P("a"), P("b")] }), /revisionYaCorre/);
  colgado.cancelar("lid");
  await esperarHasta(() => !colgado.viva("lid"));
});
