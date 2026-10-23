// El uso del plan (electron/uso.ts): de qué lectura sale cada ventana, entre los statusline
// y el stream de los líderes de la app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deStatusline, deUsoOficial, guardada, igual, juntar, lecturaDe, oficialDe, proximoReinicio, usoDe } from "../electron/uso.ts";

const AHORA = 1_791_849_000;
const sl = (ts: number, h: [number, number | null] | null, s: [number, number | null] | null) =>
  deStatusline({
    version: 1,
    ts,
    rate_limits: { five_hour: h && { used_percentage: h[0], resets_at: h[1] }, seven_day: s && { used_percentage: s[0], resets_at: s[1] } },
  });
const evento = (info: object) => JSON.stringify({ type: "rate_limit_event", rate_limit_info: info, session_id: "x" });

test("statusline: el más nuevo sin límites no tapa al anterior que los trae", () => {
  // Lo que pasó el 2026-10-12: una sesión que no llegó a contestar dejó `rate_limits` en null.
  const vieja = sl(AHORA - 3600, [52, AHORA + 1800], [7, AHORA + 86_400]);
  const vacia = sl(AHORA - 60, null, null);
  assert.deepEqual(usoDe([vacia, vieja], AHORA), { ts: AHORA - 3600, five_hour: { pct: 52, resets_at: AHORA + 1800 }, seven_day: { pct: 7, resets_at: AHORA + 86_400 } });
});

test("sin ninguna lectura con límites: las dos ventanas en null (sin dato)", () => {
  assert.deepEqual(usoDe([sl(AHORA - 60, null, null), null], AHORA), { ts: 0, five_hour: null, seven_day: null });
  assert.deepEqual(usoDe([], AHORA), { ts: 0, five_hour: null, seven_day: null });
});

test("una ventana que ya se reinició no se afirma; la otra sigue", () => {
  const l = sl(AHORA - 7200, [52, AHORA - 60], [7, AHORA + 86_400]);
  assert.deepEqual(usoDe([l], AHORA), { ts: AHORA - 7200, five_hour: null, seven_day: { pct: 7, resets_at: AHORA + 86_400 } });
  // Justo en el reinicio ya no vale.
  assert.equal(usoDe([sl(AHORA - 10, [99, AHORA], null)], AHORA).five_hour, null);
});

test("cada ventana sale de la lectura más nueva que la trae, sea statusline o stream", () => {
  const statusline = sl(AHORA - 600, [40, AHORA + 3000], [6, AHORA + 86_400]);
  const stream = lecturaDe(evento({ status: "allowed", unifiedWindows: { five_hour: { utilization: 0.45, resetsAt: AHORA + 3000 }, seven_day: { utilization: 0.07, resetsAt: AHORA + 86_400 } } }), AHORA - 30)!;
  const u = usoDe([statusline, stream], AHORA);
  assert.equal(u.five_hour?.pct, 45);
  assert.equal(Math.round(u.seven_day!.pct), 7);
  assert.equal(u.ts, AHORA - 30);
  // Y al revés: un statusline posterior le gana a lo que dijo el stream.
  assert.equal(usoDe([sl(AHORA - 5, [48, AHORA + 3000], null), stream], AHORA).five_hour?.pct, 48);
  assert.equal(Math.round(usoDe([sl(AHORA - 5, [48, AHORA + 3000], null), stream], AHORA).seven_day!.pct), 7);
});

test("stream: el rate_limit_event de un turno normal trae las dos ventanas (fixture real)", () => {
  const lineas = readFileSync(path.join(import.meta.dirname, "fixtures", "stream-real.jsonl"), "utf8").split("\n").filter(Boolean);
  const ls = lineas.map((l) => lecturaDe(l, AHORA)).filter((l) => l !== null);
  assert.equal(ls.length, 1);
  assert.deepEqual(ls[0], { five_hour: { pct: 25, resets_at: 1791060600, ts: AHORA }, seven_day: { pct: 50, resets_at: 1791126000, ts: AHORA } });
});

test("stream: sin unifiedWindows vale la ventana que nombra; rechazada, entera", () => {
  const aviso = lecturaDe(evento({ status: "allowed_warning", rateLimitType: "seven_day", utilization: 0.82, resetsAt: AHORA + 500 }), AHORA);
  assert.deepEqual(aviso, { five_hour: null, seven_day: { pct: 82, resets_at: AHORA + 500, ts: AHORA } });
  const tope = lecturaDe(evento({ status: "rejected", rateLimitType: "five_hour", resetsAt: AHORA + 7200 }), AHORA);
  assert.deepEqual(tope, { five_hour: { pct: 100, resets_at: AHORA + 7200, ts: AHORA }, seven_day: null });
  // Lo que no dice nada del uso.
  assert.equal(lecturaDe(evento({ status: "allowed" }), AHORA), null);
  assert.equal(lecturaDe(evento({ status: "allowed", rateLimitType: "overage", resetsAt: AHORA + 9 }), AHORA), null);
  assert.equal(lecturaDe('{"type":"assistant","message":{"content":[{"type":"text","text":"\\"rate_limit_event\\""}]}}', AHORA), null);
  assert.equal(lecturaDe('"rate_limit_event" roto', AHORA), null);
});

test("juntar: una lectura a medias pisa sólo la ventana que trae; igual no mira el ts", () => {
  const todo = lecturaDe(evento({ status: "allowed", unifiedWindows: { five_hour: { utilization: 0.2, resetsAt: AHORA + 100 }, seven_day: { utilization: 0.3, resetsAt: AHORA + 900 } } }), AHORA - 50)!;
  const medio = lecturaDe(evento({ status: "rejected", rateLimitType: "five_hour", resetsAt: AHORA + 100 }), AHORA)!;
  const j = juntar(todo, medio);
  assert.deepEqual(j.five_hour, { pct: 100, resets_at: AHORA + 100, ts: AHORA });
  assert.deepEqual(j.seven_day, todo.seven_day);
  assert.equal(igual(todo, j), false);
  assert.equal(igual(todo, { five_hour: { ...todo.five_hour!, ts: 1 }, seven_day: { ...todo.seven_day!, ts: 2 } }), true);
  assert.equal(igual(null, null), true);
  assert.equal(igual(null, todo), false);
});

test("guardada: lo que quedó en uso.json vuelve igual; lo raro, null", () => {
  const l = lecturaDe(evento({ status: "allowed", unifiedWindows: { five_hour: { utilization: 0.2, resetsAt: AHORA + 100 } } }), AHORA)!;
  assert.deepEqual(guardada(JSON.parse(JSON.stringify({ version: 1, ...l }))), l);
  assert.equal(guardada({ version: 2, ...l }), null);
  assert.equal(guardada(null), null);
  assert.equal(guardada({ version: 1, five_hour: { pct: "20" }, seven_day: null }), null);
});

test("proximoReinicio: el más cercano de lo que se muestra", () => {
  assert.equal(proximoReinicio({ five_hour: { pct: 1, resets_at: 500 }, seven_day: { pct: 1, resets_at: 900 } }), 500);
  assert.equal(proximoReinicio({ five_hour: null, seven_day: { pct: 1, resets_at: 900 } }), 900);
  assert.equal(proximoReinicio({ five_hour: null, seven_day: null }), null);
});

test("un porcentaje sin hora de reinicio vale igual (resets_at null), en el statusline, el stream y uso.json", () => {
  // Hay porcentaje: no se pierde por no saber cuándo se reinicia.
  const sinHora = sl(AHORA - 60, [34, null], [61, AHORA + 86_400]);
  assert.deepEqual(usoDe([sinHora], AHORA), { ts: AHORA - 60, five_hour: { pct: 34, resets_at: null }, seven_day: { pct: 61, resets_at: AHORA + 86_400 } });
  const stream = lecturaDe(evento({ status: "allowed", unifiedWindows: { five_hour: { utilization: 0.34 } } }), AHORA)!;
  assert.deepEqual(stream.five_hour, { pct: 34, resets_at: null, ts: AHORA });
  assert.deepEqual(guardada(JSON.parse(JSON.stringify({ version: 1, ...stream }))), stream);
  // Sin hora no se puede afirmar que ya pasó: vale hasta que una lectura nueva lo pise.
  assert.deepEqual(usoDe([sinHora], AHORA + 10 * 86_400).five_hour, { pct: 34, resets_at: null });
  // Pero sin porcentaje sigue siendo sin dato.
  assert.equal(usoDe([sl(AHORA - 60, null, null)], AHORA).five_hour, null);
  assert.equal(guardada({ version: 1, five_hour: { pct: 34, ts: AHORA }, seven_day: null })?.five_hour?.resets_at, null);
});

// El atraso del 2026-10-14: la barra decía menos que la página de uso de claude.ai, aun después de
// Actualizar límites. El statusline de una terminal ociosa se reescribe con lo último que vio su
// sesión (horas atrás) y la hora de ahora: por ser "más nuevo" le ganaba a lo que dijo el stream.
const R5 = AHORA + 3000;
const RS = AHORA + 86_400;
const stream = (h: number, s: number, ts: number) =>
  lecturaDe(evento({ status: "allowed", unifiedWindows: { five_hour: { utilization: h / 100, resetsAt: R5 }, seven_day: { utilization: s / 100, resetsAt: RS } } }), ts)!;
/** El stream dice de 0 a 1: el porcentaje, redondeado. */
const pct = (v: { pct: number } | null | undefined) => (v ? Math.round(v.pct) : null);
const oficial = (h: number | null, s: number | null, ts: number, r5 = R5) =>
  deUsoOficial(
    {
      rate_limits: {
        five_hour: { utilization: h, resets_at: new Date(r5 * 1000).toISOString() },
        seven_day: { utilization: s, resets_at: new Date(RS * 1000).toISOString() },
      },
    },
    ts,
  );

test("atraso: un statusline viejo con la hora de ahora no baja lo que ya se vio en la misma ventana", () => {
  const visto = stream(58, 21, AHORA - 600);
  const viejo = sl(AHORA - 5, [40, R5], [17, RS]);
  const u = usoDe([viejo, visto], AHORA);
  assert.equal(pct(u.five_hour), 58);
  assert.equal(pct(u.seven_day), 21);
  // Y "visto" es cuándo se vio eso, no cuándo se reescribió el statusline.
  assert.equal(u.ts, AHORA - 600);
  // Lo mismo guardado en uso.json: una lectura posterior con menos no lo pisa.
  assert.equal(pct(juntar(visto, stream(50, 19, AHORA)).five_hour), 58);
});

test("atraso: en una ventana nueva vale lo nuevo aunque diga menos; una vieja no vuelve", () => {
  const antes = stream(90, 21, AHORA - 9000);
  const nueva = sl(AHORA - 60, [3, R5 + 5 * 3600], [22, RS]);
  const u = usoDe([antes, nueva], AHORA);
  assert.equal(pct(u.five_hour), 3);
  assert.equal(pct(u.seven_day), 22);
  // Una lectura posterior de la ventana anterior (otra terminal ociosa) no la tapa.
  assert.equal(usoDe([nueva, sl(AHORA - 1, [95, R5], null)], AHORA).five_hour?.pct, 3);
});

test("get_usage: lo que dice claude.ai manda aunque diga menos; después, sólo lo que suba", () => {
  const alto = stream(58, 21, AHORA - 600);
  const of = oficial(52, 20, AHORA - 30)!;
  assert.deepEqual(of.five_hour, { pct: 52, resets_at: R5, ts: AHORA - 30, oficial: true });
  assert.equal(pct(usoDe([alto, of], AHORA).five_hour), 52);
  assert.equal(usoDe([alto, of], AHORA).ts, AHORA - 30);
  // Un statusline viejo posterior no la baja; uno que sube sí cuenta.
  assert.equal(usoDe([alto, of, sl(AHORA - 5, [40, R5], null)], AHORA).five_hour?.pct, 52);
  assert.equal(usoDe([alto, of, sl(AHORA - 5, [55, R5], null)], AHORA).five_hour?.pct, 55);
  // El endpoint redondea el reinicio: unos segundos de diferencia siguen siendo la misma ventana.
  assert.equal(pct(usoDe([alto, oficial(52, 20, AHORA - 30, R5 - 1)], AHORA).five_hour), 52);
  // En uso.json la oficial vuelve como oficial.
  const j = juntar(alto, of);
  assert.deepEqual(guardada(JSON.parse(JSON.stringify({ version: 1, ...j }))), j);
});

test("get_usage: la respuesta se lee del stdout de claude; lo que no es, null", () => {
  const linea = (o: object) => JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "trama-uso", response: o } });
  const l = oficialDe(linea({ rate_limits: { five_hour: { utilization: 61, resets_at: "2026-10-14T21:00:00.000Z" }, seven_day: null } }), AHORA);
  assert.deepEqual(l, { five_hour: { pct: 61, resets_at: Date.parse("2026-10-14T21:00:00Z") / 1000, ts: AHORA, oficial: true }, seven_day: null });
  // Sin suscripción (todo null), un error, otra respuesta o algo roto: nada.
  assert.equal(oficialDe(linea({ rate_limits: { five_hour: { utilization: null, resets_at: null }, seven_day: null } }), AHORA), null);
  assert.equal(oficialDe(JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: "x", error: "Unsupported control request subtype: get_usage", rate_limits: 1 } }), AHORA), null);
  assert.equal(oficialDe(linea({ commands: [] }), AHORA), null);
  assert.equal(oficialDe('"rate_limits" roto', AHORA), null);
  // Sin hora de reinicio (o una que no se entiende) el porcentaje vale igual.
  assert.deepEqual(deUsoOficial({ rate_limits: { five_hour: { utilization: 7, resets_at: "mañana" } } }, AHORA)?.five_hour, { pct: 7, resets_at: null, ts: AHORA, oficial: true });
});
