import assert from "node:assert/strict";
import test from "node:test";
import { generarSiHaceFalta, generadoDe, limpiarTitulo, pedidoTitulo, reiniciarTitulos } from "../electron/titulo-chat.ts";
import { tituloCorto, tituloLider, tienePropio } from "../electron/tema.ts";

const LARGO =
  "Hola soy Gonza y necesito ayuda con mi PC estuve utilizando Gemini 3.8 flash en high para hacer algunas tareas y me empezó a spamear ventanas de CMD a la vez";

test("tituloCorto: saludo y presentación afuera, una frase corta de ≤60 caracteres", () => {
  const t = tituloCorto(LARGO);
  assert.ok(t.length <= 60, t);
  assert.ok(t.startsWith("Necesito ayuda con mi PC"), t);
  assert.ok(!/hola|gonza/i.test(t), t);
  assert.equal(tituloCorto("Hola, soy Ana. Revisá el build de omc. Falla en CI"), "Revisá el build de omc");
  assert.equal(tituloCorto("  Retomá omc v2.   Leé ~/omc/PLAN.md\nsegunda línea"), "Retomá omc v2. Leé ~/omc/PLAN.md");
  // Un mensaje que es sólo un saludo no queda vacío.
  assert.equal(tituloCorto("Hola"), "Hola");
});

test("tituloLider: lo de la persona o de Claude Code gana al generado, y éste al recorte", () => {
  const primero = LARGO;
  assert.equal(tituloLider({ custom: "Mi título", ai: null, primero }, "trama-aaaa", "Ventanas CMD en PC"), "Mi título");
  assert.equal(tituloLider({ custom: null, ai: null, primero }, "ana-e4", "Ventanas CMD en PC"), "ana-e4");
  assert.equal(tituloLider({ custom: null, ai: "De Claude Code", primero }, "trama-aaaa", "Ventanas CMD en PC"), "De Claude Code");
  assert.equal(tituloLider({ custom: null, ai: null, primero }, "trama-aaaa", "Ventanas CMD en PC"), "Ventanas CMD en PC");
  assert.equal(tituloLider({ custom: null, ai: null, primero }, "trama-aaaa", null), tituloCorto(primero));
});

test("limpiarTitulo: una línea corta sin comillas ni punto; lo que no sirve es null", () => {
  assert.equal(limpiarTitulo('"Ventanas CMD y Flash en PC de Gonza."\n'), "Ventanas CMD y Flash en PC de Gonza");
  assert.equal(limpiarTitulo("Título: arreglar build"), "Arreglar build");
  assert.equal(limpiarTitulo(""), null);
  assert.equal(limpiarTitulo("Claro, te armo un título para esta conversación que sea bastante descriptivo del tema tratado"), null);
});

test("pedidoTitulo: lleva el mensaje y el tope de palabras", () => {
  const p = pedidoTitulo("hola mundo");
  assert.ok(p.includes("6 palabras") && p.endsWith("hola mundo"));
});

test("generarSiHaceFalta: genera tras el primer intercambio y guarda; no pisa un título de la persona", async () => {
  reiniciarTitulos();
  const llamadas: string[] = [];
  const guardados: Record<string, string>[] = [];
  const o = {
    correr: async (p: string) => (llamadas.push(p), "Ventanas CMD en PC de Gonza"),
    guardar: async (x: Record<string, string>) => void guardados.push(x),
  };
  const t = { custom: null, ai: null, primero: LARGO, respondio: true };
  // Todavía sin respuesta del modelo: espera.
  assert.equal(generarSiHaceFalta("s0", { ...t, respondio: false }, "trama-aaaa", o), null);
  // Con un /rename de la persona o el nombre de su sesión: nunca.
  assert.equal(generarSiHaceFalta("s1", { ...t, custom: "Mi chat" }, "trama-aaaa", o), null);
  assert.equal(generarSiHaceFalta("s2", t, "ana-e4", o), null);
  assert.equal(generarSiHaceFalta("s3", { ...t, ai: "De Claude Code" }, "trama-aaaa", o), null);
  assert.ok(tienePropio({ custom: "x", ai: null }, "trama-aaaa"));
  assert.equal(llamadas.length, 0);
  await generarSiHaceFalta("s4", t, "trama-aaaa", o);
  assert.equal(llamadas.length, 1);
  assert.equal(generadoDe("s4"), "Ventanas CMD en PC de Gonza");
  assert.equal(guardados.at(-1)?.s4, "Ventanas CMD en PC de Gonza");
  // Ya generado: no se vuelve a pedir.
  assert.equal(generarSiHaceFalta("s4", t, "trama-aaaa", o), null);
});

test("generarSiHaceFalta: si el modelo falla o contesta cualquier cosa, no hay título generado (queda el recorte) y reintenta poco", async () => {
  reiniciarTitulos();
  let n = 0;
  const o = {
    correr: async () => {
      n++;
      throw new Error("sin modelo");
    },
    guardar: async () => {},
  };
  const t = { custom: null, ai: null, primero: LARGO, respondio: true };
  await generarSiHaceFalta("f1", t, "trama-aaaa", o);
  await generarSiHaceFalta("f1", t, "trama-aaaa", o);
  assert.equal(generarSiHaceFalta("f1", t, "trama-aaaa", o), null, "tras 2 intentos fallidos no insiste");
  assert.equal(n, 2);
  assert.equal(generadoDe("f1"), undefined);
  assert.equal(tituloLider(t, "trama-aaaa", generadoDe("f1")), tituloCorto(LARGO));
});
