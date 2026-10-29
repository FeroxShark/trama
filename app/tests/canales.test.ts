// tests/canales.test.ts: la lista única de canales (electron/canales/contrato.ts) y quienes la usan: el preload (sólo
// como tipos, pero cada canal de la lista tiene que estar en uso y ninguno de afuera), la ventana y la carcasa de Windows
// (windows/src/canales.json, generado con scripts/generar-canales.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AVISOS_VENTANA, CANALES, SOLO_VENTANA, SOLO_VENTANA_LOCAL } from "../electron/canales/contrato.ts";
import { DESTINO, generar } from "../scripts/generar-canales.mjs";

const fuente = (f: string) => readFileSync(path.join(import.meta.dirname, "..", "electron", f), "utf8");
const preload = fuente("preload.cts");
const usados = (re: RegExp) => [...preload.matchAll(re)].map((m) => m[1]);
const de = (tipo: string) => CANALES.filter((e) => e[1] === tipo).map((e) => e[0]);
// Se atiende en el main pero la página lo pide por otro camino (no por el preload).
const SIN_PRELOAD = new Set(["app:pararTodo"]);

test("contrato: sin canales repetidos (un mismo nombre puede ser de pedido y de aviso) y cada uno con tipo conocido", () => {
  const nombres = CANALES.map((e) => `${e[0]} ${e[1]}`);
  assert.equal(new Set(nombres).size, nombres.length);
  for (const [c, tipo] of CANALES) assert.match(tipo, /^(invoke|on|send)$/, c);
  for (const c of SOLO_VENTANA) assert.ok(de("invoke").includes(c), `SOLO_VENTANA es de invoke: ${c}`);
  for (const c of SOLO_VENTANA_LOCAL) assert.ok(SOLO_VENTANA.includes(c), c);
});

test("preload: usa cada canal de la lista con su tipo, y ningún otro", () => {
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\("/, "los pedidos van por `invocar` (tipado con la lista)");
  assert.match(preload, /^import type \{[^}]*\} from "\.\/canales\/contrato\.ts";$/m, "la lista entra sólo como tipos: un preload con sandbox no carga otros archivos");
  assert.deepEqual(usados(/\binvocar\("([^"]+)"/g).sort(), de("invoke").filter((c) => !SIN_PRELOAD.has(c)).sort());
  assert.deepEqual(usados(/\boir\("([^"]+)"/g).sort(), de("on").sort());
  assert.deepEqual(usados(/ipcRenderer\.send\("([^"]+)"/g).sort(), de("send").sort());
});

test("ventana: cada ipcMain.handle de la ventana es un canal de la lista, y app:pararTodo (sin preload) lo atiende el núcleo", () => {
  const manejados = ["ventana-canales.ts", "ventana-cliente.ts", "bench.ts"].flatMap((f) => [...fuente(f).matchAll(/ipcMain\.handle\("([^"]+)"/g)].map((m) => m[1]));
  for (const c of manejados) assert.ok(de("invoke").includes(c), `falta en la lista: ${c}`);
  assert.ok(SOLO_VENTANA.includes("app:pararTodo") && !manejados.includes("app:pararTodo"));
  assert.match(fuente("nucleo.ts"), /manejar\("app:pararTodo"/, "app:pararTodo lo atiende el núcleo");
});

test("windows/src/canales.json: está al día con la lista", () => {
  assert.equal(readFileSync(DESTINO, "utf8"), generar(), "desactualizado: corré `node scripts/generar-canales.mjs` desde app/");
  assert.deepEqual(JSON.parse(readFileSync(DESTINO, "utf8")).avisosVentana, [...AVISOS_VENTANA]);
});
