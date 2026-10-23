import { test } from "node:test";
import assert from "node:assert/strict";
import { alScroll, anotar, bajar, seguidor, seguir, type Zona } from "../src/hilo/seguir.ts";
import { pasoActual, turnos } from "../src/hilo/turnos.ts";
import type { Mensaje } from "../src/datos/contrato.ts";

/** Un scroll de mentira: 400 de alto a la vista, el contenido crece con `alto`. */
const zona = (alto: number): Zona & { scrollHeight: number } => ({ scrollTop: 0, scrollHeight: alto, clientHeight: 400 });

test("pegado al fondo, lo que llega lo deja al fondo", () => {
  const z = zona(1000);
  const s = seguidor();
  seguir(z, s);
  assert.equal(z.scrollTop, 1000);
  z.scrollHeight = 1300;
  seguir(z, s);
  assert.equal(z.scrollTop, 1300);
  assert.equal(s.pegado, true);
});

test("que el contenido crezca no suelta: el scroll no se movió", () => {
  const z = zona(1000);
  const s = seguidor();
  bajar(z, s);
  z.scrollTop = 600; // lo que deja el navegador: scrollHeight - clientHeight
  alScroll(z, s);
  z.scrollHeight = 2000;
  alScroll(z, s);
  assert.equal(s.pegado, true);
  seguir(z, s);
  assert.equal(z.scrollTop, 2000);
});

test("Ana sube: deja de seguir; vuelve al final: sigue de nuevo", () => {
  const z = zona(1000);
  const s = seguidor();
  bajar(z, s);
  z.scrollTop = 600;
  alScroll(z, s);
  z.scrollTop = 450;
  alScroll(z, s);
  assert.equal(s.pegado, false);
  z.scrollHeight = 1500;
  seguir(z, s);
  assert.equal(z.scrollTop, 450);
  // Baja, pero no hasta el final: sigue suelto.
  z.scrollTop = 900;
  alScroll(z, s);
  assert.equal(s.pegado, false);
  z.scrollTop = 1100;
  alScroll(z, s);
  assert.equal(s.pegado, true);
  z.scrollHeight = 1800;
  seguir(z, s);
  assert.equal(z.scrollTop, 1800);
});

test("volvió al fondo y llegó contenido antes que el evento scroll: sigue de nuevo", () => {
  const z = zona(1000);
  const s = seguidor();
  bajar(z, s);
  z.scrollTop = 600;
  alScroll(z, s);
  z.scrollTop = 0;
  alScroll(z, s);
  assert.equal(s.pegado, false);
  // Baja al final de lo que hay; antes del `scroll` ya creció: quien avisa primero es el contenido.
  z.scrollTop = 600;
  z.scrollHeight = 1200;
  seguir(z, s);
  assert.equal(s.pegado, true);
  assert.equal(z.scrollTop, 1200);
  // O avisa primero el `scroll`, con el contenido ya crecido: lo mismo.
  z.scrollTop = 0;
  alScroll(z, s);
  assert.equal(s.pegado, false);
  z.scrollTop = 800; // el final de 1200
  z.scrollHeight = 1500;
  alScroll(z, s);
  assert.equal(s.pegado, true);
  // Suelto y a mitad de camino, que crezca no lo pega.
  z.scrollTop = 300;
  alScroll(z, s);
  z.scrollHeight = 1900;
  seguir(z, s);
  assert.equal(s.pegado, false);
  assert.equal(z.scrollTop, 300);
});

test("subió y llegó contenido antes que el evento scroll: no lo arrastra al fondo", () => {
  const z = zona(1000);
  const s = seguidor();
  z.scrollTop = 600;
  alScroll(z, s);
  z.scrollTop = 500;
  z.scrollHeight = 1200;
  seguir(z, s);
  assert.equal(z.scrollTop, 500);
  assert.equal(s.pegado, false);
});

test("el contenido se achica (el navegador recorta el scroll): sigue pegado", () => {
  const z = zona(1000);
  const s = seguidor();
  z.scrollTop = 600;
  alScroll(z, s);
  z.scrollHeight = 900;
  z.scrollTop = 500;
  alScroll(z, s);
  assert.equal(s.pegado, true);
});

test("anteponer una página mueve el scroll a propósito: ni suelta ni pega", () => {
  const z = zona(1000);
  const s = seguidor();
  z.scrollTop = 100;
  s.pegado = false;
  s.top = 100;
  z.scrollHeight = 3000;
  z.scrollTop = 2100;
  anotar(z, s);
  assert.equal(s.pegado, false);
  assert.equal(s.top, 2100);
});

/** Con `display: none` (un panel encima) el elemento no mide nada; al volver, el navegador le devuelve su scroll. */
const esconder = (z: Zona) => {
  const antes = { ...z };
  Object.assign(z, { scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  return (alto: number) => void Object.assign(z, antes, { scrollHeight: alto });
};

test("escondida no mide nada: suelto, al volver sigue donde estaba aunque haya llegado contenido", () => {
  const z = zona(1000);
  const s = seguidor();
  bajar(z, s);
  z.scrollTop = 600;
  alScroll(z, s);
  z.scrollTop = 200; // Ana subió
  alScroll(z, s);
  assert.equal(s.pegado, false);
  const mostrar = esconder(z);
  seguir(z, s); // el ResizeObserver avisa que pasó a medir cero
  alScroll(z, s);
  anotar(z, s);
  assert.equal(s.pegado, false);
  mostrar(1500);
  seguir(z, s);
  assert.equal(z.scrollTop, 200);
  assert.equal(s.pegado, false);
});

test("escondida y pegado: al volver, lo que llegó mientras tanto queda al fondo", () => {
  const z = zona(1000);
  const s = seguidor();
  bajar(z, s);
  const mostrar = esconder(z);
  seguir(z, s);
  assert.equal(s.pegado, true);
  mostrar(1500);
  seguir(z, s);
  assert.equal(z.scrollTop, 1500);
  assert.equal(s.pegado, true);
});

let n = 0;
const el = (texto: string, herramientas: string[], det?: Mensaje["det"]): Mensaje => ({
  i: n++,
  rol: "assistant",
  texto,
  herramientas,
  ts: null,
  modelo: "claude-opus-5-5",
  ...(det ? { det } : {}),
});
const pasos = (ms: Mensaje[]) => {
  const t = turnos(ms).at(-1);
  assert.equal(t?.tipo, "turno");
  return t?.tipo === "turno" ? t.pasos : [];
};

test("el paso en curso: la última herramienta con su descripción", () => {
  n = 0;
  const p = pasoActual(
    pasos([
      el("Miro los workers.", ["Read"]),
      el("", ["Bash"], [{ nombre: "Bash", entrada: { command: "pa --hilos", description: "Check which of the 18 workers finished" }, resultado: null }]),
    ]),
  );
  assert.deepEqual(p, { nombre: "Bash", texto: "Check which of the 18 workers finished", veces: 1 });
});

test("el paso en curso: la misma herramienta repetida se cuenta, y sin herramienta va lo que dijo", () => {
  n = 0;
  assert.deepEqual(pasoActual(pasos([el("Listo el plan.", []), el("", ["Edit", "Edit"])])), { nombre: "Edit", texto: "", veces: 2 });
  n = 0;
  assert.deepEqual(pasoActual(pasos([el("Primero leo todo.\nDespués edito.", []), el("Respuesta", [])])), {
    nombre: null,
    texto: "Primero leo todo.",
    veces: 1,
  });
  assert.equal(pasoActual([]), null);
});
