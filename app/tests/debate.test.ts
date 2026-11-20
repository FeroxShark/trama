// Modo debate (etapa 2, base): lectura de un turno, corte por acuerdo, tope de rondas, pregunta que pausa y reanuda, un modelo que falla
// y un solo modelo que queda (revisión simple), todo con revisores simulados (sin gastar cupo).
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { acuerdoTotal, iniciarDebate, PREGUNTA_ESPERA_MS, leerMensajeDebate, mensajeDebateParaLider, parsearConclusion, parsearTurno, transcripcionParaPrompt, type DepsDebate, type EventoDebate } from "../electron/debate.ts";
import { esperarHasta } from "./esperar.ts";

const turno = (postura: string, arg = "razón", plan = "", pregunta = "") =>
  `## Postura\n${postura}\n\n## Argumento\n${arg}\n${plan ? `\n## Plan propuesto\n${plan}\n` : ""}${pregunta ? `\n## Pregunta para el dueño\n${pregunta}\n` : ""}`;
const CONCLUSION = "## Acuerdos\n- Todo\n\n## Desacuerdos que quedan\nNinguno\n\n## Plan consensuado\n1. Final\n";

type Guion = Record<string, (string | Error)[]>;
function armar(guion: Guion, extra: Partial<DepsDebate> = {}) {
  const hecho = { llamadas: [] as { modelo: string; effort: string; prompt: string }[], negado: [] as string[], mandado: [] as string[], eventos: [] as EventoDebate[] };
  const d: DepsDebate = {
    correr: async (modelo, effort, prompt) => {
      hecho.llamadas.push({ modelo, effort, prompt });
      const r = guion[modelo]?.shift();
      if (r === undefined) throw new Error(`sin guion para ${modelo}`);
      if (r instanceof Error) throw r;
      return r;
    },
    pedidoOriginal: async () => "armá X",
    cwd: () => "/p",
    nombre: (m) => m.toUpperCase(),
    negar: (m) => hecho.negado.push(m),
    entregar: async (t) => void hecho.mandado.push(t),
    avisar: (e) => hecho.eventos.push(e),
    ...extra,
  };
  return { d, hecho };
}
const P = (modelo: string, effort = "high") => ({ modelo, effort });

test("parsearTurno: las cuatro secciones; sin postura nunca se deduce un acuerdo; una pregunta sin 2 opciones se ignora", () => {
  const t = parsearTurno(turno("cambio", "falta un test", "1. Test", "¿Con o sin mocks?\n- Con\n- Sin"));
  assert.equal(t.postura, "pregunta");
  assert.deepEqual(t.pregunta, { texto: "¿Con o sin mocks?", opciones: ["Con", "Sin"] });
  assert.equal(t.plan, "1. Test");
  assert.equal(parsearTurno(turno("de acuerdo")).postura, "acuerdo");
  assert.equal(parsearTurno(turno("Propone cambio", "x", "P")).postura, "cambio");
  assert.equal(parsearTurno("## Argumento\nsólo esto").postura, "cambio");
  assert.equal(parsearTurno(turno("acuerdo", "x", "", "¿Seguro?\n- Sí")).pregunta, null);
  assert.equal(parsearTurno("texto libre").libre, "texto libre");
});

test("acuerdoTotal: todos de acuerdo (mismo plan o ninguno); una pregunta o planes distintos no cortan", () => {
  assert.deepEqual(acuerdoTotal([{ postura: "acuerdo", plan: null }, { postura: "acuerdo", plan: null }]), { plan: "" });
  assert.deepEqual(acuerdoTotal([{ postura: "cambio", plan: "A  b" }, { postura: "acuerdo", plan: "a B" }]), null);
  assert.deepEqual(acuerdoTotal([{ postura: "cambio", plan: "A  b" }, { postura: "cambio", plan: "a B" }]), { plan: "A  b" });
  assert.equal(acuerdoTotal([{ postura: "cambio", plan: "A" }, { postura: "cambio", plan: "B" }]), null);
  assert.equal(acuerdoTotal([{ postura: "acuerdo", plan: null }, { postura: "pregunta", plan: null }]), null);
  assert.equal(acuerdoTotal([{ postura: "acuerdo", plan: null }]), null);
});

test("mensaje del debate: va y vuelve con su marca; la transcripción recorta lo muy largo por participante", () => {
  const v = { ...parsearConclusion(CONCLUSION), modelos: ["a", "b"], nombres: ["A", "B"], motivo: "acuerdo" as const, rondas: 2 };
  const m = mensajeDebateParaLider(v);
  assert.match(m, /^\[\[debate-de-plan /);
  const l = leerMensajeDebate(m)!;
  assert.deepEqual([l.nombres, l.rondas, l.motivo, l.plan], [["A", "B"], 2, "acuerdo", "1. Final"]);
  assert.equal(leerMensajeDebate("hola"), null);
  const t = transcripcionParaPrompt([{ quien: "A", ronda: 1, texto: "x".repeat(5000) }, { quien: "A", ronda: 2, texto: "y".repeat(5000) }, { quien: "B", ronda: 1, texto: "corto" }]);
  assert.ok(!t.includes("xxxx") && t.includes("yyyy") && t.includes("corto") && t.includes("se omiten"));
});

test("acuerdo total en la ronda 1 corta: no hay ronda 2, concluye y entrega al líder", async () => {
  const { d, hecho } = armar({ a: [turno("acuerdo"), CONCLUSION], b: [turno("acuerdo")] });
  const deb = iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a", "low"), P("b", "xhigh")], rondas: 3 }, d);
  const r = await deb.terminado;
  assert.equal(r.motivo, "acuerdo");
  assert.equal(hecho.llamadas.length, 3);
  // Cada participante corre con su modelo Y su esfuerzo.
  assert.deepEqual(hecho.llamadas.slice(0, 2).map((l) => [l.modelo, l.effort]), [["a", "low"], ["b", "xhigh"]]);
  assert.ok(hecho.llamadas[1].prompt.includes("Postura: acuerdo"), "el segundo lee lo que dijo el primero");
  assert.equal(hecho.negado.length, 1);
  assert.equal(leerMensajeDebate(hecho.mandado[0])?.plan, "1. Final");
  assert.equal(deb.estado().fase, "hecho");
  assert.ok(hecho.eventos.some((e) => e.linea?.tipo === "turno") && hecho.eventos.at(-1)!.estado.fase === "hecho");
});

test("tope de rondas: 9 se recorta a 3 y ningún modelo pasa de 3 turnos", async () => {
  const cambia = (n: string) => turno("cambio", "otro", `plan ${n}`);
  const { d, hecho } = armar({ a: [cambia("a1"), cambia("a2"), cambia("a3"), CONCLUSION], b: [cambia("b1"), cambia("b2"), cambia("b3")] });
  const r = await iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("b")], rondas: 9 }, d).terminado;
  assert.equal(r.motivo, "tope");
  assert.equal(hecho.llamadas.length, 7);
  assert.deepEqual(r.estado.participantes.map((p) => p.turnos), [3, 3]);
});

test("una pregunta pausa el debate hasta que el dueño contesta, y entonces sigue con la respuesta en la transcripción", async () => {
  const { d, hecho } = armar({ a: [turno("pregunta", "dudo", "", "¿Qué base?\n- Postgres\n- SQLite"), CONCLUSION], b: [turno("acuerdo")] });
  const deb = iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("b")], rondas: 1 }, d);
  await esperarHasta(() => deb.estado().fase === "esperando");
  assert.deepEqual(deb.estado().pregunta?.opciones, ["Postgres", "SQLite"]);
  assert.equal(hecho.llamadas.length, 1, "b no habla mientras el dueño no contesta");
  assert.equal(deb.responder("Mongo"), false);
  assert.equal(deb.responder("SQLite"), true);
  const r = await deb.terminado;
  assert.ok(hecho.llamadas[1].prompt.includes("SQLite"));
  assert.ok(r.estado.lineas.some((l) => l.tipo === "dueno" && l.argumento === "SQLite"));
  assert.equal(r.motivo, "tope");
});

test("un modelo falla: sale del debate con una línea visible y los demás siguen", async () => {
  const { d } = armar({ a: [turno("acuerdo"), CONCLUSION], b: [new Error("sin cupo")], c: [turno("acuerdo")] });
  const r = await iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("b"), P("c")], rondas: 1 }, d).terminado;
  assert.equal(r.motivo, "acuerdo");
  assert.deepEqual(r.estado.participantes.map((p) => p.activo), [true, false, true]);
  assert.ok(r.estado.lineas.some((l) => l.tipo === "fallo" && l.modelo === "b" && l.error?.includes("sin cupo")));
});

test("queda un solo modelo: el debate pasa a ser una revisión simple", async () => {
  const REV = "## Qué está bien\n- x\n\n## Riesgos y huecos\n- y\n\n## Mejoras concretas\n- z\n\n## Plan mejorado\n1. P\n";
  const { d, hecho } = armar({ a: [turno("cambio", "x", "P"), REV], b: [new Error("falló")] });
  const r = await iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("b")] }, d).terminado;
  assert.equal(r.motivo, "simple");
  assert.equal(r.vista, null);
  assert.equal(r.revision?.plan, "1. P");
  assert.match(hecho.mandado[0], /^\[\[revision-de-plan /);
  assert.equal(hecho.negado.length, 1);
});

test("cancelar: rechaza, no niega ni manda nada (el plan sigue pendiente)", async () => {
  const { d, hecho } = armar({ a: [turno("acuerdo")], b: [turno("acuerdo")] }, {
    correr: async (_m, _e, _p, o) => new Promise((_ok, no) => o.señal.addEventListener("abort", () => no(new Error("abortado")))),
  });
  const deb = iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("b")] }, d);
  await esperarHasta(() => deb.estado().ronda === 1);
  deb.cancelar();
  await assert.rejects(deb.terminado, /debateCancelado/);
  assert.equal(deb.estado().fase, "cancelado");
  assert.deepEqual([hecho.negado.length, hecho.mandado.length], [0, 0]);
});

test("el de más cupo habla primero y concluye; y se exigen 2 o 3 modelos distintos", async () => {
  const { d, hecho } = armar({ a: [turno("acuerdo")], b: [turno("acuerdo"), CONCLUSION] }, { cupo: (m) => (m === "b" ? 90 : 10) });
  await iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("b")], rondas: 1 }, d).terminado;
  assert.deepEqual(hecho.llamadas.map((l) => l.modelo), ["b", "a", "b"]);
  assert.throws(() => iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("a", "low")] }, d), /debateParticipantes/);
  assert.throws(() => iniciarDebate({ sid: "s", plan: "# Plan", participantes: ["a", "b", "c", "d"].map((m) => P(m)) }, d), /debateParticipantes/);
  assert.throws(() => iniciarDebate({ sid: "s", plan: "  ", participantes: [P("a"), P("b")] }, d), /revisionSinPlan/);
});

/** Cede el turno al resto de las promesas (sin reloj: con los timers de mentira, esperarHasta no avanzaría nunca). */
async function hastaQue(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((ok) => setImmediate(ok));
  assert.ok(cond(), "hastaQue: no se cumplió");
}

test("pregunta sin respuesta a los 10 min: sigue sin ella, lo deja dicho y le avisa al siguiente (reloj simulado)", async (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { d, hecho } = armar({ a: [turno("pregunta", "dudo", "", "¿Qué base?\n- Postgres\n- SQLite"), CONCLUSION], b: [turno("acuerdo")] });
  const deb = iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("b")], rondas: 1 }, d);
  await hastaQue(() => deb.estado().fase === "esperando");
  assert.equal(deb.estado().pregunta?.hasta! - deb.estado().inicio >= PREGUNTA_ESPERA_MS - 1000, true);
  t.mock.timers.tick(PREGUNTA_ESPERA_MS - 1);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(deb.estado().fase, "esperando", "a 1 ms de los 10 min todavía espera");
  assert.equal(hecho.llamadas.length, 1);
  t.mock.timers.tick(1);
  const r = await deb.terminado;
  assert.ok(r.estado.lineas.some((l) => l.tipo === "nota" && l.clave === "debate.sinRespuesta" && l.vars?.min === 10));
  assert.ok(!r.estado.lineas.some((l) => l.tipo === "dueno"));
  assert.ok(hecho.llamadas[1].prompt.includes("No contestó a tiempo"), "el siguiente lee que el dueño no contestó");
  assert.equal(deb.responder("SQLite"), false, "ya no hay pregunta pendiente");
  assert.equal(hecho.mandado.length, 1);
});

test("«Elegí vos» (null) sigue sin una respuesta del dueño y lo deja dicho", async () => {
  const { d, hecho } = armar({ a: [turno("pregunta", "dudo", "", "¿Qué base?\n- Postgres\n- SQLite"), CONCLUSION], b: [turno("acuerdo")] });
  const deb = iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("b")], rondas: 1 }, d);
  await esperarHasta(() => deb.estado().fase === "esperando");
  assert.equal(deb.responder(null), true);
  const r = await deb.terminado;
  assert.ok(r.estado.lineas.some((l) => l.tipo === "nota" && l.clave === "debate.duenoElegiVos"));
  assert.ok(hecho.llamadas[1].prompt.includes("Dejó que decidan ustedes"));
});

test("«Cortar y concluir» a mitad de un turno: el turno en curso no cuenta y concluye quien tenga más cupo con lo dicho hasta ahí", async () => {
  const guion: Guion = { a: [turno("cambio", "falta un test", "1. Test"), CONCLUSION], b: [] };
  const { d, hecho } = armar(guion, {
    cupo: (m) => (m === "a" ? 90 : 10),
    // b se queda pensando hasta que lo cortan.
    correr: async (modelo, effort, prompt, o) => {
      hecho.llamadas.push({ modelo, effort, prompt });
      if (modelo === "b") return new Promise<string>((_ok, no) => o.señal.addEventListener("abort", () => no(new Error("abortado"))));
      return guion[modelo]!.shift() as string;
    },
  });
  const deb = iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("b")], rondas: 3 }, d);
  await esperarHasta(() => hecho.llamadas.some((l) => l.modelo === "b"));
  deb.cortar();
  const r = await deb.terminado;
  assert.equal(r.motivo, "cortado");
  assert.deepEqual(r.estado.participantes.map((p) => [p.modelo, p.turnos, p.activo]), [["a", 1, true], ["b", 0, true]]);
  assert.deepEqual(hecho.llamadas.map((l) => l.modelo), ["a", "b", "a"], "después del corte sólo concluye a (más cupo)");
  assert.ok(hecho.llamadas[2].prompt.includes("falta un test"), "la conclusión lee lo que dijo a");
  assert.equal(leerMensajeDebate(hecho.mandado[0])?.motivo, "cortado");
  assert.equal(hecho.negado.length, 1);
  assert.ok(!r.estado.lineas.some((l) => l.tipo === "fallo"), "cortar no es una falla del modelo");
});

test("«Cortar y concluir» con una pregunta pendiente: la pregunta se suelta y se concluye", async () => {
  const { d, hecho } = armar({ a: [turno("pregunta", "dudo", "", "¿Qué base?\n- Postgres\n- SQLite"), CONCLUSION], b: [turno("acuerdo")] });
  const deb = iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("b")], rondas: 2 }, d);
  await esperarHasta(() => deb.estado().fase === "esperando");
  deb.cortar();
  const r = await deb.terminado;
  assert.equal(r.motivo, "cortado");
  assert.equal(deb.estado().pregunta, null);
  assert.deepEqual(hecho.llamadas.map((l) => l.modelo), ["a", "a"], "b no llegó a hablar");
  assert.equal(hecho.mandado.length, 1);
  deb.cortar(); // ya terminó: no hace nada
});

test("columnas en vivo: mientras un modelo habla su estado lleva el texto y lo que leyó; al terminar la línea del turno guarda lo leído", async () => {
  let reloj = 1000;
  const { d, hecho } = armar({ a: [turno("acuerdo"), CONCLUSION], b: [turno("acuerdo")] }, {
    ahora: () => (reloj += 300),
    correr: async (modelo, _e, _p, o) => {
      o.avance({ paso: { k: "leer", v: `plan-${modelo}.md` } });
      o.avance({ texto: "## Postura\nacuerdo" });
      return modelo === "a" ? turno("acuerdo") : turno("acuerdo");
    },
  });
  const deb = iniciarDebate({ sid: "s", plan: "# Plan", participantes: [P("a"), P("b")], rondas: 1 }, d);
  await deb.terminado;
  const vistos = hecho.eventos.flatMap((e) => e.estado.participantes.filter((p) => p.vivo));
  assert.ok(vistos.some((p) => p.modelo === "a" && p.vivo!.texto.startsWith("## Postura") && p.vivo!.pasos[0]?.v === "plan-a.md"), "a se vio escribiendo con su lectura");
  const turnoA = hecho.eventos.at(-1)!.estado.lineas.find((l) => l.tipo === "turno" && l.modelo === "a");
  assert.deepEqual(turnoA?.pasos, [{ k: "leer", v: "plan-a.md" }]);
  assert.ok(hecho.eventos.at(-1)!.estado.participantes.every((p) => !p.vivo), "al terminar nadie está escribiendo");
});
