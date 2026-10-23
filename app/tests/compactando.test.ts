import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crearCompactando, type Compactando } from "../electron/compactando.ts";

const HOOK = path.join(import.meta.dirname, "..", "scripts", "hook-compactando.sh");

const temporal = () => mkdtempSync(path.join(tmpdir(), "trama-compactando-"));
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** El hook como lo corre Claude Code: el evento por stdin, y un entorno limpio de worker. */
function hook(estado: string, entrada: object, env: Record<string, string> = {}, args: string[] = []) {
  const { PA_WORKER: _w, PA_TS: _t, ...limpio } = process.env;
  return execFileSync(HOOK, args, { input: JSON.stringify(entrada), env: { ...limpio, HILOS_STATE: estado, ...env }, encoding: "utf8" });
}

async function hasta(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await espera(20);
  return cond();
}

test("hook: PreCompact deja la marca del líder (su session_id) y PostCompact la saca", () => {
  const estado = temporal();
  const dir = path.join(estado, "compactando");
  assert.equal(hook(estado, { session_id: "s-falso-lider", hook_event_name: "PreCompact", trigger: "auto" }), "", "no imprime nada");
  assert.deepEqual(readdirSync(dir), ["s-falso-lider"]);
  hook(estado, { session_id: "s-falso-lider", hook_event_name: "PostCompact", trigger: "auto" });
  assert.deepEqual(readdirSync(dir), []);
  rmSync(estado, { recursive: true });
});

test("hook: en un worker de pa la marca lleva el id de su run, no el de la sesión", () => {
  const estado = temporal();
  const dir = path.join(estado, "compactando");
  const worker = { PA_WORKER: "1", PA_TS: "20261003-100300-44444" };
  hook(estado, { session_id: "s-de-un-worker", hook_event_name: "PreCompact" }, worker);
  assert.deepEqual(readdirSync(dir), ["20261003-100300-44444"]);
  hook(estado, { session_id: "s-de-un-worker", hook_event_name: "PostCompact" }, worker);
  assert.deepEqual(readdirSync(dir), []);
  rmSync(estado, { recursive: true });
});

test("hook: la acción a mano manda, y un id raro o ausente no escribe nada", () => {
  const estado = temporal();
  const dir = path.join(estado, "compactando");
  hook(estado, { session_id: "s-a-mano" }, {}, ["empieza"]);
  assert.deepEqual(readdirSync(dir), ["s-a-mano"]);
  hook(estado, { session_id: "s-a-mano" }, {}, ["termina"]);
  assert.deepEqual(readdirSync(dir), []);
  hook(estado, { session_id: "../afuera", hook_event_name: "PreCompact" });
  hook(estado, { hook_event_name: "PreCompact" });
  hook(estado, { session_id: "s-x", hook_event_name: "PreCompact" }, { PA_WORKER: "1", PA_TS: "../../afuera" });
  assert.deepEqual(readdirSync(dir), []);
  assert.ok(!existsSync(path.join(estado, "afuera")));
  rmSync(estado, { recursive: true });
});

test("compactando: lee las marcas con su hora, y no las vencidas ni lo que no es un id", async () => {
  const dir = path.join(temporal(), "compactando");
  mkdirSync(dir);
  const ahora = Math.floor(Date.now() / 1000);
  writeFileSync(path.join(dir, "s-viva"), "");
  utimesSync(path.join(dir, "s-viva"), ahora - 40, ahora - 40);
  writeFileSync(path.join(dir, "s-vieja"), "");
  utimesSync(path.join(dir, "s-vieja"), ahora - 3600, ahora - 3600);
  writeFileSync(path.join(dir, ".tmp raro"), "");
  mkdirSync(path.join(dir, "s-carpeta"));
  const c = crearCompactando(dir, () => {});
  assert.deepEqual(await c.leer(), { "s-viva": ahora - 40 });
  assert.ok(await hasta(() => !existsSync(path.join(dir, "s-vieja"))), "la vencida se borra");
  c.cerrar();
  rmSync(path.dirname(dir), { recursive: true });
});

test("compactando: sin carpeta no hay nadie; al mirar la crea y avisa cada cambio, una vez", async () => {
  const estado = temporal();
  const dir = path.join(estado, "compactando");
  const avisos: Compactando[] = [];
  const c = crearCompactando(dir, (x) => avisos.push(x));
  assert.deepEqual(await c.leer(), {});
  c.mirar();
  c.mirar();
  assert.ok(existsSync(dir));
  hook(estado, { session_id: "s-falso-lider", hook_event_name: "PreCompact" });
  assert.ok(await hasta(() => avisos.length === 1), "avisa que empezó");
  assert.deepEqual(Object.keys(avisos[0]), ["s-falso-lider"]);
  hook(estado, { session_id: "s-falso-lider", hook_event_name: "PostCompact" });
  assert.ok(await hasta(() => avisos.length === 2), "avisa que terminó");
  assert.deepEqual(avisos[1], {});
  await espera(250);
  assert.equal(avisos.length, 2, "sin cambios no avisa de nuevo");
  c.cerrar();
  rmSync(estado, { recursive: true });
});

test("compactando: una marca que nadie sacó vence sola y avisa", async () => {
  const estado = temporal();
  const dir = path.join(estado, "compactando");
  const avisos: Compactando[] = [];
  const c = crearCompactando(dir, (x) => avisos.push(x), 400);
  c.mirar();
  hook(estado, { session_id: "s-lo-mataron", hook_event_name: "PreCompact" });
  assert.ok(await hasta(() => avisos.length === 1));
  assert.ok(await hasta(() => avisos.length === 2 && Object.keys(avisos[1]).length === 0), "venció sin que nadie la saque");
  assert.ok(await hasta(() => readdirSync(dir).length === 0), "y se borró");
  c.cerrar();
  rmSync(estado, { recursive: true });
});
