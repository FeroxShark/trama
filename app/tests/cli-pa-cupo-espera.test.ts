// cupo.ts, `esperarCupo` (sin_cupo=esperar del hijo de --async): al volver el cupo, la corrida corre con el candidato que reparto ofrece,
// con su motor, su cuenta y su effort (en los dos sentidos entre Claude y otro motor); un candidato que no se puede usar no corta la espera.
// Reparto es un script de mentira y el chequeo del motor se inyecta: no se lanza nada.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import { esperarCupo } from "../electron/cli/pa/cupo.ts";
import type { Pa } from "../electron/cli/pa/entorno.ts";
import { llamadaDe, type Llamada, type Motores } from "../electron/cli/pa/politica.ts";

const raiz = mkdtempSync(path.join(os.tmpdir(), "cupo-espera-"));
after(() => rmSync(raiz, { recursive: true, force: true }));

function armar(nombre: string, oferta: object, inicial: { modelo: string; motor: Llamada["motor"]; cuentaUsada: string }, env: Record<string, string> = {}) {
  const dir = path.join(raiz, nombre);
  mkdirSync(path.join(dir, "estado", "demo"), { recursive: true });
  const reparto = path.join(dir, "reparto");
  writeFileSync(reparto, `#!/bin/sh\ncase "$1" in --tipo) cat <<'FIN'\n${JSON.stringify(oferta)}\nFIN\n;; esac\nexit 0\n`);
  chmodSync(reparto, 0o755);
  let avisos = "";
  const pa: Pa = {
    env: { PATH: process.env.PATH, PA_REPARTO: reparto, PA_GEMINI_ESPERA_S: "0", TRAMA_MODELOS: path.join(dir, "no-hay.json"), ...env },
    io: { out: () => {}, err: (t: string) => void (avisos += t) },
    plat: "linux",
    home: path.join(dir, "home"),
    state: path.join(dir, "estado"),
    lockdir: path.join(dir, "estado", "lock"),
    bin: path.join(dir, "motor", "bin"),
    plan: "pro",
    autocompact: null,
    puestos: 3,
    tope: 10,
    ramWorkerMb: 2048,
    ramReservaMb: 6144,
    ramRecienMin: 3,
  };
  const l = { ...llamadaDe({} as never), repartoEsperar: true, repartoTipoRelanzable: "codigo-acotado", esfuerzo: "high", efVacio: "", ...inicial } as Llamada;
  const adm = { escribirCola: () => {}, reiniciarCola: () => {} };
  const esperar = (motores: Partial<Motores>) => esperarCupo(pa, l, adm, path.join(pa.state, "demo"), "20261110-000000-1", motores);
  return { pa, l, esperar, avisos: () => avisos };
}

const oferta = (modelo: string, effort = "") => ({ modelo, effort, motivo: "con cupo" });

test("volvió el cupo con un modelo de otro motor: la corrida pasa a ese motor, con su cuenta, sin effort, y pasó el chequeo (B089)", async () => {
  const chequeado: string[] = [];
  const t = armar("a-gemini", oferta("gemini-3.8-flash-high"), { modelo: "claude-opus-5-5", motor: "claude", cuentaUsada: "claude" });
  assert.equal(await t.esperar({ chequearGemini: async (m) => (chequeado.push(m), "") }), null);
  assert.equal(t.l.modelo, "gemini-3.8-flash-high");
  assert.equal(t.l.motor, "agy");
  assert.equal(t.l.cuentaUsada, "google");
  assert.equal(t.l.esfuerzo, "");
  assert.equal(t.l.efVacio, "-");
  assert.deepEqual(chequeado, ["gemini-3.8-flash-high"]);
  assert.doesNotMatch(t.avisos(), /sólo Claude|este pa de TypeScript/);
});

test("y al revés: de un motor que se quedó sin cupo vuelve a Claude con su cuenta y su effort", async () => {
  const t = armar("b-claude", oferta("claude-sonnet-5-5", "medium"), { modelo: "gemini-3.8-flash-high", motor: "agy", cuentaUsada: "google" });
  assert.equal(await t.esperar({}), null);
  assert.equal(t.l.modelo, "claude-sonnet-5-5");
  assert.equal(t.l.motor, "claude");
  assert.equal(t.l.cuentaUsada, "claude");
  assert.equal(t.l.esfuerzo, "medium");
  assert.equal(t.l.efVacio, "");
});

test("un candidato que no puede correr (el chequeo lo rechaza) no corta la espera: sigue hasta que haya uno usable", async () => {
  let vez = 0;
  const t = armar("c-rechazo", oferta("gemini-3.8-flash-high"), { modelo: "claude-opus-5-5", motor: "claude", cuentaUsada: "claude" });
  assert.equal(await t.esperar({ chequearGemini: async () => (++vez === 1 ? "agy no tiene sesión de Google" : "") }), null);
  assert.equal(vez, 2);
  assert.match(t.avisos(), /gemini-3\.8-flash-high pero no puede correr \(agy no tiene sesión de Google\); sigo esperando cupo/);
  assert.equal(t.l.motor, "agy");
});

test("si nunca hay un candidato usable, al vencer la espera sale 96 sin cambiar la llamada", async () => {
  const t = armar("d-vence", oferta("gemini-3.8-flash-high"), { modelo: "claude-opus-5-5", motor: "claude", cuentaUsada: "claude" }, { PA_GEMINI_ESPERA_MAX_MIN: "0" });
  assert.equal(await t.esperar({ chequearGemini: async () => "agy no está en el PATH" }), 96);
  assert.equal(t.l.modelo, "claude-opus-5-5");
  assert.equal(t.l.motor, "claude");
});
