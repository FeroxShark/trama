// Cierre por cupo en cada chat: la tarjeta aparece sólo para la suscripción del líder, «Retomar solo» encola al pasar `vuelve`
// (prendido sí, apagado no, si la persona escribió no) y todo sobrevive a reabrir Trama (electron/cierre-chats.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearCierreChats, MARGEN_RETOMAR_S, textoRetomar, type CierreVisto, type Deps } from "../electron/cierre-chats.ts";
import type { EntradaCierre } from "../electron/cierre-cupo.ts";

const T0 = 1_800_000_000;
const VUELVE = T0 + 3600;
const entrada = (p: Partial<EntradaCierre> = {}): EntradaCierre => ({ proveedor: "claude", cuenta: "claude", ventana: "5h", restante: 4, umbral: 5, vuelve: VUELVE, desde: T0, ...p });

/** Un entorno de mentira: reloj, disco, cola y relojes a mano. */
function armar(opc: { disco?: string | null; retomarSolo?: boolean; modelos?: Record<string, string>; trabajando?: string[] } = {}) {
  const e = {
    ahora: T0,
    disco: opc.disco ?? (null as string | null),
    trabajando: opc.trabajando ?? ["a"],
    encolados: [] as { sid: string; texto: string }[],
    avisos: [] as { sid: string; e: EntradaCierre }[],
    vistas: [] as CierreVisto[][],
    relojes: new Map<number, { en: number; fn: () => void }>(),
    n: 0,
    retomarSolo: opc.retomarSolo ?? false,
  };
  const modelos = opc.modelos ?? { a: "claude-opus-5-5", b: "gemini-4-hydrogen-xhigh", c: "opencode:opencode/x" };
  const d: Deps = {
    leer: () => e.disco,
    guardar: (j) => void (e.disco = j),
    ahora: () => e.ahora,
    trabajando: () => e.trabajando,
    modeloDe: (sid) => modelos[sid] ?? null,
    relevo: (sid) => `/relevos/${sid}.md`,
    retomarSolo: () => e.retomarSolo,
    encolar: (sid, texto) => void e.encolados.push({ sid, texto }),
    avisar: (l) => void e.vistas.push(l),
    avisoChat: (sid, ent) => void e.avisos.push({ sid, e: ent }),
    poner: (ms, fn) => {
      const id = ++e.n;
      e.relojes.set(id, { en: e.ahora + ms / 1000, fn });
      return id;
    },
    cancelar: (h) => void e.relojes.delete(h as number),
  };
  const c = crearCierreChats(d);
  /** Adelanta el reloj y dispara lo que venció. */
  const pasar = (s: number) => {
    e.ahora += s;
    for (const [id, r] of [...e.relojes]) if (r.en <= e.ahora) (e.relojes.delete(id), r.fn());
  };
  return { e, c, d, pasar };
}

test("la tarjeta aparece sólo en los chats de la suscripción de la entrada y que estaban trabajando", () => {
  const { e, c } = armar({ trabajando: ["a", "b", "c", "x"] });
  assert.deepEqual(c.alCierre(entrada()), ["a"]);
  assert.deepEqual(c.lista().map((r) => r.sid), ["a"]);
  assert.equal(c.de("b"), null, "Gemini no cierra por una entrada de Claude");
  assert.equal(c.de("c"), null, "OpenCode no tiene cupo");
  assert.equal(c.de("x"), null, "un chat sin proceso no tiene modelo");
  assert.deepEqual(e.avisos.map((a) => a.sid), ["a"]);
  // La de Google toca sólo al de Gemini.
  assert.deepEqual(c.alCierre(entrada({ proveedor: "google", cuenta: "google" })), ["b"]);
});

test("un chat ocioso no entra, y una cuenta agregada de Claude sólo cierra a los chats de esa cuenta", () => {
  const ocioso = armar({ trabajando: [] });
  assert.deepEqual(ocioso.c.alCierre(entrada()), []);
  assert.equal(ocioso.e.disco, null, "sin chats no se escribe nada");
  const { c, d } = armar();
  assert.deepEqual(c.alCierre(entrada({ cuenta: "trabajo" })), [], "el chat corre con la cuenta de siempre");
  const otro = crearCierreChats({ ...d, cuentaDe: () => "trabajo" });
  assert.deepEqual(otro.alCierre(entrada({ cuenta: "trabajo" })), ["a"]);
});

test("cerrando mientras sigue el turno; al terminarlo, cerrado", () => {
  const { e, c } = armar();
  c.alCierre(entrada());
  assert.equal(c.de("a")!.fase, "cerrando");
  c.revisar();
  assert.equal(c.de("a")!.fase, "cerrando", "el turno sigue");
  e.trabajando = [];
  c.revisar();
  assert.equal(c.de("a")!.fase, "cerrado");
  assert.equal(c.de("a")!.restante, 4);
  assert.equal(c.de("a")!.relevo, "/relevos/a.md");
});

test("el interruptor arranca con retomar_solo de Ajustes y se guarda por chat", () => {
  const apagado = armar({ retomarSolo: false });
  apagado.c.alCierre(entrada());
  assert.equal(apagado.c.de("a")!.retomar, false);
  const prendido = armar({ retomarSolo: true });
  prendido.c.alCierre(entrada());
  assert.equal(prendido.c.de("a")!.retomar, true);
  prendido.c.ponerRetomar("a", false);
  assert.equal(prendido.c.de("a")!.retomar, false);
});

test("retomar encola al pasar vuelve + margen con el interruptor prendido", () => {
  const { e, c, pasar } = armar({ retomarSolo: true });
  c.alCierre(entrada());
  pasar(3600 + MARGEN_RETOMAR_S - 1);
  assert.equal(e.encolados.length, 0, "todavía no pasó el margen");
  pasar(1);
  assert.deepEqual(e.encolados, [{ sid: "a", texto: textoRetomar("/relevos/a.md") }]);
  assert.match(e.encolados[0].texto, /^Volvió el cupo: retomá desde tu resumen \/relevos\/a\.md y seguí con los workers que quedaron cortados \(pa --seguir --id /);
  assert.equal(c.de("a")!.fase, "retomado");
  pasar(86_400);
  assert.equal(e.encolados.length, 1, "una sola vez");
});

test("con el interruptor apagado no retoma, y prenderlo después arma el reloj", () => {
  const { e, c, pasar } = armar({ retomarSolo: false });
  c.alCierre(entrada());
  pasar(7200);
  assert.equal(e.encolados.length, 0);
  assert.equal(c.de("a")!.fase, "volvio");
  // Prendido ya pasada la hora: retoma en el acto.
  c.ponerRetomar("a", true);
  assert.equal(e.encolados.length, 1);
});

test("apagar el interruptor antes de la hora cancela el reloj", () => {
  const { e, c, pasar } = armar({ retomarSolo: true });
  c.alCierre(entrada());
  c.ponerRetomar("a", false);
  pasar(7200);
  assert.equal(e.encolados.length, 0);
});

test("si la persona escribió en el chat después del cierre, no se retoma solo", () => {
  const { e, c, pasar } = armar({ retomarSolo: true });
  c.duenoEscribio("a"); // antes del cierre: no cuenta
  c.alCierre(entrada());
  c.duenoEscribio("a");
  assert.equal(c.de("a")!.duenoEscribio, true);
  pasar(7200);
  assert.equal(e.encolados.length, 0);
});

test("sin hora de vuelta no se retoma solo", () => {
  const { e, c, pasar } = armar({ retomarSolo: true });
  c.alCierre(entrada({ vuelve: null }));
  pasar(10 * 86_400);
  assert.equal(e.encolados.length, 0);
});

test("dos ventanas: se retoma cuando vuelve la última", () => {
  const { e, c, pasar } = armar({ retomarSolo: true });
  c.alCierre(entrada());
  c.alCierre(entrada({ ventana: "7d", restante: 3, vuelve: T0 + 86_400 }));
  assert.equal(c.de("a")!.vuelve, T0 + 86_400);
  assert.equal(c.de("a")!.restante, 3);
  pasar(7200);
  assert.equal(e.encolados.length, 0);
  pasar(86_400);
  assert.equal(e.encolados.length, 1);
});

test("sobrevive a reabrir Trama: lo guardado vuelve y lo que ya pasó de hora se retoma al arrancar", () => {
  const antes = armar({ retomarSolo: true });
  antes.c.alCierre(entrada());
  antes.c.duenoEscribio("a");
  antes.c.parar();
  const json = antes.e.disco!;
  assert.match(json, /"estado": "cerrando"/);

  // Se reabre antes de la hora: el chat sigue ahí (ya cerrado: el turno terminó con la app) y no retoma porque la persona escribió.
  const despues = armar({ disco: json, retomarSolo: true });
  despues.c.arrancar();
  assert.equal(despues.c.de("a")!.fase, "cerrado");
  despues.pasar(7200);
  assert.equal(despues.e.encolados.length, 0);

  // Otro chat, sin escribir, con la PC apagada a la hora: al arrancar retoma igual.
  const limpio = armar({ retomarSolo: true });
  limpio.c.alCierre(entrada());
  limpio.c.parar();
  const tarde = armar({ disco: limpio.e.disco, retomarSolo: true });
  tarde.e.ahora = VUELVE + 5 * 3600;
  tarde.c.arrancar();
  assert.deepEqual(tarde.e.encolados.map((x) => x.sid), ["a"]);
  assert.equal(tarde.c.de("a")!.fase, "retomado");
  // Reabrir otra vez no lo repite.
  const otra = armar({ disco: tarde.e.disco });
  otra.e.ahora = tarde.e.ahora;
  otra.c.arrancar();
  assert.equal(otra.e.encolados.length, 0);
});

test("un archivo roto o de otra versión se ignora", () => {
  assert.deepEqual(armar({ disco: "{no" }).c.lista(), []);
  assert.deepEqual(armar({ disco: JSON.stringify({ version: 9, chats: [] }) }).c.lista(), []);
});

test("un cierre nuevo después de retomar empieza de cero", () => {
  const { e, c, pasar } = armar({ retomarSolo: true });
  c.alCierre(entrada());
  pasar(3600 + MARGEN_RETOMAR_S);
  assert.equal(e.encolados.length, 1);
  c.alCierre(entrada({ vuelve: e.ahora + 3600, desde: e.ahora }));
  assert.equal(c.de("a")!.fase, "cerrando");
  pasar(3600 + MARGEN_RETOMAR_S);
  assert.equal(e.encolados.length, 2);
});

test("un reinicio antes de tiempo pasa la tarjeta a «Volvió el cupo» y avisa a la ventana", () => {
  const { e, c } = armar();
  c.alCierre(entrada());
  c.revisar();
  const vistas = e.vistas.length;
  c.alVolvio(entrada(), []);
  assert.equal(c.de("a")?.fase, "volvio");
  assert.equal(e.vistas.length, vistas + 1);
  assert.equal(e.vistas.at(-1)?.[0].fase, "volvio");
});

test("con el interruptor prendido, el reinicio antes de tiempo retoma sin esperar la hora vieja", () => {
  const { e, c, pasar } = armar({ retomarSolo: true });
  c.alCierre(entrada());
  c.alVolvio(entrada(), []);
  pasar(MARGEN_RETOMAR_S);
  assert.deepEqual(e.encolados.map((x) => x.sid), ["a"]);
  assert.equal(c.de("a")?.fase, "retomado");
});

test("si la persona ya siguió escribiendo, al volver el cupo la tarjeta se va", () => {
  const { e, c } = armar();
  c.alCierre(entrada());
  c.duenoEscribio("a");
  c.alVolvio(entrada(), []);
  assert.equal(c.de("a"), null);
  assert.deepEqual(e.vistas.at(-1), []);
});

test("si otra ventana de la cuenta sigue baja, el chat sigue cerrado hasta esa", () => {
  const { c } = armar();
  const semana = entrada({ ventana: "7d", vuelve: VUELVE + 86_400, restante: 3 });
  c.alCierre(entrada());
  c.alCierre(semana);
  c.alVolvio(entrada(), [semana]);
  assert.equal(c.de("a")?.fase, "cerrando");
  assert.equal(c.de("a")?.vuelve, VUELVE + 86_400);
  assert.equal(c.de("a")?.restante, 3);
});

test("el cupo de otra suscripción o de otra cuenta no toca la tarjeta", () => {
  const { c } = armar();
  c.alCierre(entrada());
  c.alVolvio(entrada({ proveedor: "google", cuenta: "google" }), []);
  c.alVolvio(entrada({ cuenta: "otra" }), []);
  assert.equal(c.de("a")?.fase, "cerrando");
});

test("con el cupo ya vuelto, escribir en el chat saca la tarjeta", () => {
  const { e, c } = armar();
  c.alCierre(entrada());
  e.ahora = VUELVE + 1;
  assert.equal(c.de("a")?.fase, "volvio");
  c.duenoEscribio("a");
  assert.equal(c.de("a"), null);
  assert.deepEqual(e.vistas.at(-1), []);
});

test("al abrir Trama se va la tarjeta de un chat donde la persona ya siguió y el cupo volvió", () => {
  const a = armar();
  a.c.alCierre(entrada());
  a.c.duenoEscribio("a");
  const b = armar({ disco: a.e.disco });
  b.e.ahora = VUELVE + 1;
  b.c.arrancar();
  assert.equal(b.c.de("a"), null);
});

test("sin que la persona haya escrito, la tarjeta «Volvió el cupo» sigue al abrir Trama", () => {
  const a = armar();
  a.c.alCierre(entrada());
  const b = armar({ disco: a.e.disco });
  b.e.ahora = VUELVE + 1;
  b.c.arrancar();
  assert.equal(b.c.de("a")?.fase, "volvio");
});
