// Cierre ordenado por cupo: el vigilante (electron/cierre-cupo.ts), la señal en disco (cierre-cupo-disco.ts) y `cierre` en modelos.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ajustesCierreDe, CIERRE_DEFECTO, CONFIRMAR_VOLVIO_S, crearVigilante, lecturasDeUso, leerSenal, suscripcionDeModelo, type AjustesCierre, type LecturaCupo } from "../electron/cierre-cupo.ts";
import { crearCierreCupo } from "../electron/cierre-cupo-disco.ts";
import { validarCierre } from "../electron/valida-ajustes.ts";
import { leerConfig, unir, validarConfig } from "../electron/modelos-tipos.ts";

const AHORA = 1_800_000_000;
const R5 = AHORA + 3600;
const ON: AjustesCierre = { ...CIERRE_DEFECTO };
const claude = (usado: number, vuelve = R5, ventana = "5h"): LecturaCupo => ({ proveedor: "claude", cuenta: "claude", ventana, usado, vuelve });

test("de qué suscripción sale cada modelo", () => {
  assert.equal(suscripcionDeModelo("claude-opus-5-5"), "claude");
  assert.equal(suscripcionDeModelo("gemini-4-hydrogen-xhigh"), "google");
  assert.equal(suscripcionDeModelo("agy:claude-opus-5-5-low"), "google");
  assert.equal(suscripcionDeModelo("codex:gpt-5"), "chatgpt");
  assert.equal(suscripcionDeModelo("opencode:opencode/x"), null);
  assert.equal(suscripcionDeModelo("ollama:qwen3"), null);
  assert.equal(suscripcionDeModelo("dsh:ollama/x"), null);
  assert.equal(suscripcionDeModelo(null), null);
});

test("se dispara una sola vez por ventana", () => {
  const v = crearVigilante();
  assert.equal(v.paso([claude(90)], ON, AHORA).nuevas.length, 0);
  const p = v.paso([claude(96)], ON, AHORA + 60);
  assert.deepEqual(p.nuevas, [{ proveedor: "claude", cuenta: "claude", ventana: "5h", restante: 4, umbral: 5, vuelve: R5, desde: AHORA + 60 }]);
  assert.equal(p.cambio, true);
  // Sigue bajando, o la hora de reinicio viene redondeada distinto: misma ventana, no se repite.
  const q = v.paso([claude(99, R5 + 30)], ON, AHORA + 120);
  assert.equal(q.nuevas.length, 0);
  assert.equal(q.entradas[0].restante, 1);
  assert.equal(q.entradas[0].desde, AHORA + 60);
  // Una lectura vieja que dice más cupo no la rearma.
  assert.equal(v.paso([claude(50)], ON, AHORA + 180).nuevas.length, 0);
  assert.equal(v.entradas().length, 1);
});

test("se rearma al pasar el reinicio", () => {
  const v = crearVigilante();
  v.paso([claude(97)], ON, AHORA);
  const tras = v.paso([], ON, R5 + 1);
  assert.equal(tras.entradas.length, 0);
  assert.equal(tras.cambio, true);
  const R2 = R5 + 5 * 3600;
  assert.equal(v.paso([claude(98, R2)], ON, R5 + 100).nuevas.length, 1);
});

test("varias suscripciones a la vez, cada una por su lado", () => {
  const uso = {
    five_hour: { pct: 97, resets_at: R5 },
    seven_day: { pct: 40, resets_at: AHORA + 86_400 },
    suscripciones: [
      { id: "google", proveedor: "google", grupos: [{ id: "gemini-pro", ventanas: [{ id: "5h", pct: 99, vuelve: R5 }, { id: "7d", pct: 100, vuelve: AHORA + 9000, deshabilitada: true }] }] },
      { id: "chatgpt", proveedor: "chatgpt", ventanas: [{ id: "7d", pct: 98, vuelve: AHORA + 7200 }] },
      { id: "claude-b", proveedor: "claude", cuenta: "b", ventanas: [{ id: "5h", pct: 96, vuelve: R5 }] },
      { id: "opencode", proveedor: "opencode", ventanas: [{ id: "dia", pct: 100, vuelve: R5 }] },
    ],
  };
  const l = lecturasDeUso(uso);
  assert.equal(l.some((x) => x.proveedor === ("opencode" as never)), false);
  assert.equal(l.some((x) => x.grupo === "gemini-pro" && x.ventana === "7d"), false, "una ventana deshabilitada no cuenta");
  const p = crearVigilante().paso(l, ON, AHORA);
  const claves = p.nuevas.map((e) => `${e.proveedor}/${e.cuenta}/${e.ventana}/${e.grupo ?? ""}`).sort();
  assert.deepEqual(claves, ["chatgpt/chatgpt/7d/", "claude/b/5h/", "claude/claude/5h/", "google/google/5h/gemini-pro"]);
});

test("el umbral de Ajustes manda", () => {
  const v = crearVigilante();
  assert.equal(v.paso([claude(88)], { ...ON, umbral: 10 }, AHORA).nuevas.length, 0);
  assert.equal(v.paso([claude(90)], { ...ON, umbral: 10 }, AHORA).nuevas[0].umbral, 10);
  assert.equal(crearVigilante().paso([claude(90)], ON, AHORA).nuevas.length, 0);
});

test("sin reinicio conocido se rearma cuando vuelve a haber cupo", () => {
  const v = crearVigilante();
  assert.equal(v.paso([claude(97, null as never)], ON, AHORA).nuevas.length, 1);
  assert.equal(v.paso([claude(50, null as never)], ON, AHORA + 60).entradas.length, 0);
});

test("un reinicio antes de tiempo suelta la entrada, con la misma hora o con otra", () => {
  const misma = crearVigilante();
  misma.paso([claude(96)], ON, AHORA);
  assert.equal(misma.paso([claude(0)], ON, AHORA + 60).entradas.length, 1, "una sola lectura puede ser vieja");
  const p = misma.paso([claude(0)], ON, AHORA + 120);
  assert.deepEqual(p.entradas, []);
  assert.deepEqual(p.volvieron.map((e) => e.ventana), ["5h"]);
  assert.equal(p.cambio, true);
  const otra = crearVigilante();
  otra.paso([claude(96)], ON, AHORA);
  const q = otra.paso([claude(1, R5 + 7200)], ON, AHORA + 60);
  assert.deepEqual(q.entradas, []);
  assert.equal(q.volvieron.length, 1);
  // Vuelve a gastarse: dispara de nuevo.
  assert.equal(otra.paso([claude(97, R5 + 7200)], ON, AHORA + 120).nuevas.length, 1);
});

test("una lectura vieja con más cupo no suelta la entrada aunque se repita más tarde", () => {
  const v = crearVigilante();
  v.paso([claude(96)], ON, AHORA);
  v.paso([claude(50)], ON, AHORA + 60);
  v.paso([claude(97)], ON, AHORA + 90);
  assert.equal(v.paso([claude(50)], ON, AHORA + 120).entradas.length, 1, "la lectura baja del medio reinició la cuenta");
  // Con un reinicio anterior al de la entrada también es vieja.
  const w = crearVigilante();
  w.paso([claude(96)], ON, AHORA);
  assert.equal(w.paso([claude(10, R5 - 3000)], ON, AHORA + 60).entradas.length, 1);
});

test("la suba se confirma a los 15 s y mientras tanto avisa que hay que releer", () => {
  const v = crearVigilante();
  v.paso([claude(96)], ON, AHORA);
  assert.equal(v.confirmando(), false);
  v.paso([claude(0)], ON, AHORA + 60);
  assert.equal(v.confirmando(), true);
  assert.equal(v.paso([claude(0)], ON, AHORA + 60 + CONFIRMAR_VOLVIO_S - 1).volvieron.length, 0);
  assert.equal(v.paso([claude(0)], ON, AHORA + 60 + CONFIRMAR_VOLVIO_S).volvieron.length, 1);
  assert.equal(v.confirmando(), false);
});

test("cerca del umbral una lectura que redondea distinto no suelta la entrada ni la repite", () => {
  const v = crearVigilante();
  v.paso([claude(96)], ON, AHORA);
  const p = v.paso([claude(93)], ON, AHORA + 60);
  assert.equal(p.entradas.length, 1);
  assert.equal(p.volvieron.length, 0);
  assert.equal(v.paso([claude(96)], ON, AHORA + 120).nuevas.length, 0);
});

test("pasar la hora de reinicio también cuenta como cupo vuelto", () => {
  const v = crearVigilante();
  v.paso([claude(96)], ON, AHORA);
  assert.equal(v.paso([], ON, R5 + 1).volvieron.length, 1);
});

test("en disco: alVolverCupo avisa el reinicio y borra la señal", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cierre-"));
  const c = crearCierreCupo(dir, () => ON);
  const oidos: { ventana: string; siguen: number }[] = [];
  c.alVolverCupo((e, vigentes) => oidos.push({ ventana: e.ventana, siguen: vigentes.length }));
  c.revisar({ five_hour: { pct: 96, resets_at: R5 }, seven_day: null }, AHORA);
  c.revisar({ five_hour: { pct: 0, resets_at: R5 }, seven_day: null }, AHORA + 60);
  assert.deepEqual(oidos, []);
  c.revisar({ five_hour: { pct: 0, resets_at: R5 }, seven_day: null }, AHORA + 120);
  assert.deepEqual(oidos, [{ ventana: "5h", siguen: 0 }]);
  assert.equal(existsSync(c.archivo), false);
});

test("en disco: escribe atómico, avisa una vez, borra al reinicio y no repite al reabrir", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cierre-"));
  let ajustes: AjustesCierre = { ...ON, retomar_solo: true };
  const c = crearCierreCupo(dir, () => ajustes);
  const oidos: string[] = [];
  c.alCierreCupo((e) => oidos.push(`${e.proveedor}/${e.ventana}`));
  const uso = { five_hour: { pct: 96, resets_at: R5 }, seven_day: null };
  c.revisar(uso, AHORA);
  c.revisar(uso, AHORA + 60);
  assert.deepEqual(oidos, ["claude/5h"]);
  const j = JSON.parse(readFileSync(c.archivo, "utf8"));
  assert.equal(j.version, 1);
  assert.equal(j.retomar_solo, true);
  assert.deepEqual(j.entradas, [{ proveedor: "claude", cuenta: "claude", ventana: "5h", restante: 4, umbral: 5, vuelve: R5, desde: AHORA }]);
  assert.deepEqual(readdirSync(dir), ["cierre-cupo.json"], "sin temporales sueltos");
  // Reabrir Trama: lo de disco no se vuelve a avisar.
  const otra = crearCierreCupo(dir, () => ajustes);
  const oidos2: unknown[] = [];
  otra.alCierreCupo((e) => oidos2.push(e));
  otra.revisar(uso, AHORA + 120);
  assert.equal(oidos2.length, 0);
  // Pasó el reinicio: la entrada sale y, sin ninguna, el archivo no está.
  otra.revisar({ five_hour: null, seven_day: null }, R5 + 1);
  assert.equal(existsSync(otra.archivo), false);
  // Desactivado no escribe nada.
  ajustes = { ...ON, activo: false };
  otra.revisar({ five_hour: { pct: 100, resets_at: R5 + 9000 }, seven_day: null }, R5 + 2);
  assert.equal(existsSync(otra.archivo), false);
  assert.equal(oidos2.length, 0);
});

test("una señal rota se ignora", () => {
  assert.deepEqual(leerSenal("{roto"), []);
  assert.deepEqual(leerSenal(JSON.stringify({ version: 2, entradas: [] })), []);
  assert.deepEqual(leerSenal(JSON.stringify({ version: 1, entradas: [{ proveedor: "opencode", cuenta: "x", ventana: "5h", restante: 1, umbral: 5, vuelve: 1, desde: 1 }] })), []);
  const dir = mkdtempSync(path.join(os.tmpdir(), "cierre-"));
  writeFileSync(path.join(dir, "cierre-cupo.json"), "{roto");
  assert.doesNotThrow(() => crearCierreCupo(dir, () => ON).revisar(null, AHORA));
});

test("cierre en modelos.json: defaults, lectura, validación y escritura", () => {
  assert.deepEqual(ajustesCierreDe(undefined), { activo: true, umbral: 5, retomar_solo: false });
  assert.deepEqual(ajustesCierreDe({ umbral: 50, activo: false }), { activo: false, umbral: 5, retomar_solo: false });
  assert.equal(validarCierre({ activo: true, umbral: 2, retomar_solo: false }), null);
  assert.equal(validarCierre({ umbral: 20 }), null);
  assert.equal(validarCierre({ umbral: 1 }), "ajustes.errCierreUmbral");
  assert.equal(validarCierre({ umbral: 21 }), "ajustes.errCierreUmbral");
  assert.equal(validarCierre({ umbral: 5.5 }), "ajustes.errCierreUmbral");
  assert.equal(validarCierre({ activo: "si" }), "ajustes.errCierreForma");
  assert.equal(validarCierre({ otra: 1 }), "ajustes.errCierreForma");
  assert.equal(validarCierre([]), "ajustes.errCierreForma");
  assert.deepEqual(leerConfig({ version: 1, cierre: { umbral: 99, retomar_solo: true } }).cierre, { retomar_solo: true });
  assert.equal(leerConfig({ version: 1 }).cierre, undefined);
  assert.deepEqual(validarConfig({ cierre: { umbral: 8, activo: false } }).cierre, { umbral: 8, activo: false });
  assert.throws(() => validarConfig({ cierre: { umbral: 30 } }), /2.*20/);
  assert.throws(() => validarConfig({ cierre: "no" }));
  assert.deepEqual(unir({ version: 1, otra: 1 }, validarConfig({ cierre: { umbral: 8 } })).cierre, { umbral: 8 });
  assert.equal(unir({ version: 1, cierre: { umbral: 8 } }, validarConfig({})).cierre, undefined);
});
