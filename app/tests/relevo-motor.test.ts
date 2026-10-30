// El relevo de un cambio de motor (electron/relevo-motor.ts): qué entra, cómo se resume y cómo se recorta, y cómo se juntan los transcripts. Puro.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.TRAMA_DUENO = "Ana";
const { aplicarCortes, armarRelevo, hastaMensaje, unirConvs, TOPE_RELEVO } = await import("../electron/relevo-motor.ts");
const { convNueva } = await import("../electron/lider-arma.ts");

const m = (rol: "user" | "assistant", texto: string, ts: string | null, extra: object = {}) =>
  ({ rol, texto, herramientas: [], det: [], ts, modelo: rol === "assistant" ? "claude-opus-5-5" : null, mid: null, usage: null, uuid: "u-" + texto.slice(0, 4), marcas: {}, ...extra }) as any;
const est = (todos: any[]) => ({ ...convNueva(), todos });

test("armarRelevo: texto de las dos partes, una línea por herramienta, [imagen], y nada de marcas ni mensajes del sistema", () => {
  const r = armarRelevo(
    [
      m("user", "hola", "2026-01-01T10:00:00Z", { imagenes: [{ tipo: "image/png", datos: "AA" }] }),
      m("assistant", "miro", "2026-01-01T10:00:01Z", { herramientas: ["Bash: git status", "Read: /x/y.ts"], det: [{ nombre: "Bash", entrada: { command: "git status\nmás" }, id: "1" }, { nombre: "Read", entrada: {}, id: "2" }] }),
      m("user", "caveat", "2026-01-01T10:00:02Z", { marcas: { meta: true } }),
      m("assistant", "", "2026-01-01T10:00:03Z", { marcas: { compacto: { auto: true, antes: 1 } } }),
      m("user", "tarea de fondo", "2026-01-01T10:00:04Z", { marcas: { origen: "task-notification" } }),
    ],
    { de: "claude-opus-5-5", a: "gemini-4-argon" },
  );
  assert.equal(r.incluidos, 2);
  assert.match(r.texto, /Ana: hola \[imagen\]/);
  assert.match(r.texto, /Asistente \(claude-opus-5-5\): miro\n\[corrió: git status\]\n\[usó Read: \/x\/y\.ts\]/);
  assert.ok(!r.texto.includes("caveat") && !r.texto.includes("tarea de fondo"));
  assert.ok(!r.texto.includes("se omitieron"));
});

test("armarRelevo: con el tope entran los más recientes, se avisa cuántos se omitieron y un mensaje enorme se recorta", () => {
  const todos = Array.from({ length: 50 }, (_, k) => m(k % 2 ? "assistant" : "user", `msg-${k} ${"y".repeat(200)}`, null));
  const r = armarRelevo(todos, { de: "a", a: "b", tope: 2_000 });
  assert.ok(r.omitidos > 0 && r.omitidos + r.incluidos === 50);
  assert.match(r.texto, new RegExp(`\\(se omitieron ${r.omitidos} mensajes anteriores\\)`));
  assert.ok(r.texto.includes("msg-49") && !r.texto.includes("msg-0 "));
  const grande = armarRelevo([m("user", "z".repeat(100_000), null)], { de: "a", a: "b" });
  assert.ok(grande.texto.length < TOPE_RELEVO && grande.texto.includes("recortado"));
  assert.equal(armarRelevo([], { de: "a", a: "b" }).texto, "");
});

test("armarRelevo con `desde`: sólo lo posterior a esa hora (un motor que vuelve a su propia sesión)", () => {
  const r = armarRelevo([m("user", "viejo", "2026-01-01T10:00:00Z"), m("user", "nuevo", "2026-01-01T12:00:00Z")], { de: "a", a: "b", desde: Date.parse("2026-01-01T11:00:00Z") });
  assert.ok(r.texto.includes("nuevo") && !r.texto.includes("viejo"));
  assert.match(r.texto, /sin vos/);
});

test("unirConvs: cada motor en su tramo, una raya por cambio, todos conservan su uuid y llevan el motor de su tramo", () => {
  const claude = est([m("user", "c1", "2026-01-01T10:00:00Z"), m("user", "c2", "2026-01-01T12:00:00Z")]);
  const gem = est([m("user", "g1", "2026-01-01T11:00:00Z")]);
  const mapa = new Map([["claude" as const, claude], ["gemini" as const, gem]]);
  const u = unirConvs(mapa, "claude", [
    { cambio: { ts: Date.parse("2026-01-01T10:30:00Z"), de: "claude-opus-5-5", a: "gemini-4-argon" }, a: "gemini" },
    { cambio: { ts: Date.parse("2026-01-01T11:30:00Z"), de: "gemini-4-argon", a: "claude-opus-5-5" }, a: "claude" },
  ]);
  assert.deepEqual(u.todos.map((x) => x.marcas.cambio?.modelo ?? x.texto), ["c1", "gemini-4-argon", "g1", "claude-opus-5-5", "c2"]);
  // Los mensajes de todos los tramos se pueden señalar (volver atrás / editar / ramificar con un relevo); las rayas no.
  assert.deepEqual(u.todos.map((x) => x.uuid !== null), [true, false, true, false, true]);
  assert.deepEqual(u.todos.map((x) => x.motor), ["claude", undefined, "gemini", undefined, "claude"]);
});

test("aplicarCortes: quita lo que sigue al mensaje y es anterior al corte; lo posterior queda; hastaMensaje corta en un uuid", () => {
  const t = (s: string) => `2026-01-01T10:00:${s}Z`;
  const todos = [m("user", "aaaa", t("00")), m("assistant", "bbbb", t("01")), m("user", "cccc", t("02")), m("assistant", "dddd", t("03")), m("user", "eeee", t("10"))];
  const r = aplicarCortes(todos, [{ ts: Date.parse(t("05")), uuid: "u-bbbb" }]);
  assert.deepEqual(r.map((x) => x.texto), ["aaaa", "bbbb", "eeee"]);
  assert.deepEqual(aplicarCortes(todos, [{ ts: Date.parse(t("05")), uuid: "u-nada" }]).length, 5, "un uuid que no está no corta nada");
  // Dos cortes seguidos: el segundo ya ve la lista recortada.
  const dos = aplicarCortes(todos, [{ ts: Date.parse(t("05")), uuid: "u-bbbb" }, { ts: Date.parse(t("20")), uuid: "u-aaaa" }]);
  assert.deepEqual(dos.map((x) => x.texto), ["aaaa"]);
  assert.deepEqual(hastaMensaje({ ...convNueva(), todos }, "u-cccc")!.todos.map((x) => x.texto), ["aaaa", "bbbb", "cccc"]);
  assert.equal(hastaMensaje({ ...convNueva(), todos }, "u-x"), null);
});

test("armarRelevo: los mensajes seguidos del modelo (una herramienta cada uno) van en un solo bloque, sin repetir el encabezado ni la misma línea; pasado el tope, contadas", () => {
  const herr = (cmd: string) =>
    m("assistant", "", null, { herramientas: ["Bash: " + cmd], det: [{ nombre: "Bash", entrada: { command: cmd }, id: cmd }] });
  const todos = [
    m("user", "arreglá esto", null),
    herr("git status"),
    herr("git status"),
    ...Array.from({ length: 12 }, (_, k) => herr(`ls dir${k}`)),
    m("assistant", "listo, quedó arreglado", null),
    m("user", "gracias", null),
  ];
  const r = armarRelevo(todos, { de: "a", a: "b" });
  assert.equal(r.texto.match(/Asistente \(claude-opus-5-5\)/g)?.length, 1, "un solo encabezado para todo el tramo del modelo");
  assert.equal(r.texto.split("Ana: arreglá esto")[1].match(/\[corrió: git status\]/g)?.length, 1, "la misma herramienta seguida, una vez (sin contar el ejemplo de la nota)");
  assert.match(r.texto, /\[… y 5 herramientas más\]/);
  assert.ok(!r.texto.includes("ls dir11"), "las que pasan el tope no se listan una por una");
  assert.match(r.texto, /\[corrió: ls dir6\]\n\[… y 5 herramientas más\]\nlisto, quedó arreglado/);
  assert.equal(r.incluidos, todos.length, "se cuentan mensajes, no bloques");
});
