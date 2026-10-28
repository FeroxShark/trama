// OpenCode en la barra lateral como cualquier otro proveedor: los pedidos que cuenta Trama (opencode-pedidos.jsonl, lo escriben el runner de
// workers y el puente de los líderes), la ventana de 5 h, el % contra los topes de go-topes.json con Go, los gratis sin tope (se dice cuántos van),
// las marcas de los 429 y cómo lo dicen la barra y Plan y cupos (siempre con texto, no sólo color). Sin opencode ni red.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { anotarPedidos, archivoPedidos, cuentaPedidos, leerPedidos, suscripcionOpencode, ventanaActual, VENTANA_OC_S } from "../electron/opencode-pedidos.ts";
import { cargarTablaGo } from "../electron/opencode-go.ts";
import { GRUPO_OPENCODE_GRATIS } from "../electron/opencode-agotado.ts";
import { anotarPedidos as anotarMotor } from "../../motor/opencode/correr.mjs";
import { goAgotadosDe, opencodeAgotadoDe } from "../src/hilo/agotados.ts";
import { resumenGrupo, resumenSusc } from "../src/barra/cuposVista.ts";
import { textoEstado } from "../src/barra/cuposTextos.ts";
import { nombreGrupoCorto } from "../src/barra/cuposNombres.ts";
import { filasDeCupos } from "../src/datos/cuentas.ts";
import { cambiarIdioma } from "../src/i18n/index.ts";
import type { Uso } from "../src/datos/contrato.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "oc-ped-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const carpeta = () => {
  const d = path.join(tmp, `c${n++}`);
  mkdirSync(d, { recursive: true });
  return d;
};
const AHORA = Date.parse("2026-10-27T10:00:00Z");
const S = AHORA / 1000;
const tabla = cargarTablaGo()!;
const base = { tabla, pedidos: [], gratisHasta: null, goAgotados: {}, ahoraMs: AHORA } as const;

test("se cuentan sólo los que tienen cupo: los gratis y los de Go (los de pago por uso, no)", () => {
  assert.ok(cuentaPedidos("opencode:opencode/beam-free"));
  assert.ok(cuentaPedidos("opencode/big-pickle"));
  assert.ok(cuentaPedidos("opencode:opencode-go/kimi-k3.1-pro"));
  assert.ok(!cuentaPedidos("opencode:opencode/gpt-5"));
  assert.ok(!cuentaPedidos("anthropic/claude-x"));
});

test("anotar y leer: una línea por corrida, sin el prefijo y en minúsculas; lo de más de un día y lo roto no cuenta", () => {
  const env = { REPARTO_STATE: carpeta() } as NodeJS.ProcessEnv;
  assert.equal(anotarPedidos("opencode:opencode-go/Kimi-K3.1-Pro", 3, env, AHORA - 60_000), true);
  assert.equal(anotarPedidos("opencode/gpt-5", 2, env, AHORA), false, "de pago por uso: no se anota");
  assert.equal(anotarPedidos("opencode/beam-free", 0, env, AHORA), false, "cero pedidos: nada");
  anotarPedidos("opencode/beam-free", 1, env, AHORA - 2 * 86400_000);
  writeFileSync(archivoPedidos(env), readFileSync(archivoPedidos(env), "utf8") + "{roto\n");
  assert.deepEqual(leerPedidos(env, AHORA), [{ t: S - 60, m: "opencode-go/kimi-k3.1-pro", n: 3 }]);
});

test("el runner de workers (motor/opencode/correr.mjs) anota con el mismo formato y en el mismo lugar que lee la app", () => {
  const dir = carpeta();
  const env = { REPARTO_STATE: dir } as NodeJS.ProcessEnv;
  assert.equal(anotarMotor("opencode-go/glm-5.3-flash", 4, env, os.homedir(), AHORA), true);
  assert.equal(anotarMotor("opencode/gpt-5", 4, env, os.homedir(), AHORA), false);
  assert.equal(anotarMotor("opencode:nvidia/deepseek-ai/deepseek-v4.1-flash", 2, env, os.homedir(), AHORA), true, "NVIDIA NIM también se anota");
  assert.deepEqual(leerPedidos(env, AHORA), [
    { t: S, m: "opencode-go/glm-5.3-flash", n: 4 },
    { t: S, m: "nvidia/deepseek-ai/deepseek-v4.1-flash", n: 2 },
  ]);
  // Sin REPARTO_STATE: <PA_STATE>/reparto, como agotado.json.
  const pa = carpeta();
  anotarMotor("opencode/beam-free", 1, { PA_STATE: pa }, os.homedir(), AHORA);
  assert.equal(leerPedidos({ PA_STATE: pa } as NodeJS.ProcessEnv, AHORA).length, 1);
});

test("la ventana: arranca con el primer pedido y dura 5 h; pasada, no hay ventana abierta", () => {
  const p = (t: number, n = 1) => ({ t, m: "x", n });
  assert.equal(ventanaActual([], S), null);
  assert.deepEqual(ventanaActual([p(S - 3600, 2), p(S - 60, 3)], S), { usados: 5, vuelve: S - 3600 + VENTANA_OC_S });
  // El de hace 6 h abrió una ventana que ya cerró; el de hace 1 h abrió la de ahora.
  assert.deepEqual(ventanaActual([p(S - 6 * 3600, 9), p(S - 3600, 1)], S), { usados: 1, vuelve: S - 3600 + VENTANA_OC_S });
  assert.equal(ventanaActual([p(S - 6 * 3600, 9)], S), null);
});

test("sin Go: un solo grupo, el de los gratis, sin % (no hay tope publicado) y con los pedidos que van; la marca del 429 se ve", () => {
  const s = suscripcionOpencode({ ...base, plan: "gratis", pedidos: [{ t: S - 600, m: "opencode/beam-free", n: 3 }, { t: S - 300, m: "opencode/gpt-5", n: 9 }] });
  assert.equal(s.id, "opencode");
  assert.equal(s.proveedor, "opencode");
  assert.deepEqual(s.grupos!.map((g) => g.id), [GRUPO_OPENCODE_GRATIS]);
  assert.deepEqual(s.grupos![0]!.ventanas, [{ id: "5h", pct: null, vuelve: S - 600 + VENTANA_OC_S, pedidos: 3 }]);
  const r = resumenGrupo(s.grupos![0]!, S);
  assert.equal(r.estado, "sin");
  assert.equal(r.pedidos, 3);
  cambiarIdioma("es");
  assert.equal(textoEstado(r, S), "Pedidos en 5 h: 3 (sin tope publicado)");
  assert.equal(nombreGrupoCorto(s.grupos![0]!), "Gratis");
  cambiarIdioma("en");
  assert.equal(nombreGrupoCorto(s.grupos![0]!), "Free");

  const agotado = suscripcionOpencode({ ...base, plan: "gratis", gratisHasta: AHORA + 3600_000 });
  assert.equal(agotado.grupos![0]!.agotado, S + 3600);
  assert.equal(resumenGrupo(agotado.grupos![0]!, S).estado, "marcado");
  assert.equal(opencodeAgotadoDe({ version: 1, ts: S, five_hour: null, seven_day: null, suscripciones: [agotado] } as Uso, S), S + 3600, "el selector lo sigue encontrando");
});

test("con Go: cada modelo usado en su ventana contra su tope de go-topes.json; los que no se usaron no llenan la fila", () => {
  const s = suscripcionOpencode({ ...base, plan: "go", pedidos: [{ t: S - 1800, m: "opencode-go/kimi-k3.1-pro", n: 120 }, { t: S - 900, m: "opencode-go/kimi-k3.1-pro", n: 27 }] });
  assert.deepEqual(s.grupos!.map((g) => g.id), [GRUPO_OPENCODE_GRATIS, "opencode:opencode-go/kimi-k3.1-pro"]);
  const kimi = s.grupos![1]!;
  assert.equal(kimi.nombre, "Kimi K3.1 Pro");
  assert.deepEqual(kimi.ventanas, [{ id: "5h", pct: 100, vuelve: S - 1800 + VENTANA_OC_S, pedidos: 147, tope: 147 }]);
  assert.equal(resumenGrupo(kimi, S).estado, "lleno", "147 de 147: agotado, con cuándo vuelve");
  const plus = suscripcionOpencode({ ...base, plan: "go-plus", pedidos: [{ t: S - 60, m: "opencode-go/kimi-k3.1-pro", n: 147 }] });
  assert.equal(plus.grupos![1]!.ventanas[0]!.pct, 25, "Go Plus: 147 de 588");
  assert.equal(resumenSusc(plus, S).nivel, "ok");
});

test("con Go y nada usado: un solo grupo «Go» en 0 % (no una fila por cada modelo de la tabla)", () => {
  const s = suscripcionOpencode({ ...base, plan: "go" });
  assert.deepEqual(s.grupos!.map((g) => g.id), [GRUPO_OPENCODE_GRATIS, "opencode-go"]);
  assert.deepEqual(s.grupos![1]!.ventanas, [{ id: "5h", pct: 0, vuelve: null, pedidos: 0 }]);
  cambiarIdioma("es");
  assert.equal(nombreGrupoCorto(s.grupos![1]!), "Go");
});

test("un modelo de Go marcado por un 429 se ve aunque no se haya usado (o con otro slug), y el selector lo sigue rotulando", () => {
  const s = suscripcionOpencode({ ...base, plan: "go", goAgotados: { "opencode:opencode-go/glm-5.3-flash": AHORA + 7200_000, "opencode:opencode-go/viejo": AHORA - 1 } });
  const glm = s.grupos!.find((g) => g.id === "opencode:opencode-go/glm-5.3-flash")!;
  assert.equal(glm.agotado, S + 7200);
  assert.equal(resumenGrupo(glm, S).estado, "marcado");
  assert.ok(!s.grupos!.some((g) => g.id.endsWith("/viejo")), "una marca vencida no cuenta");
  const uso = { version: 1, ts: S, five_hour: null, seven_day: null, suscripciones: [s] } as Uso;
  assert.deepEqual([...goAgotadosDe(uso, S)], ["opencode:opencode-go/glm-5.3-flash"]);
  // Sin plan Go (lo apagaron), la marca de antes igual se dice.
  const sin = suscripcionOpencode({ ...base, plan: "gratis", goAgotados: { "opencode:opencode-go/glm-5.3-flash": AHORA + 60_000 } });
  assert.deepEqual(sin.grupos!.map((g) => g.id), [GRUPO_OPENCODE_GRATIS, "opencode:opencode-go/glm-5.3-flash"]);
});

test("la fila de OpenCode va en la barra como otro proveedor: con su separador, después de los de reparto", () => {
  const google = { id: "google", nombre: "Google AI Pro", proveedor: "google", ts: S, grupos: [] };
  const f = filasDeCupos([google, suscripcionOpencode({ ...base, plan: "gratis" })], undefined, "principal");
  assert.deepEqual(f.filas.map((x) => [x.proveedor, x.corto, x.primera]), [["google", "Google AI Pro", true], ["opencode", "OpenCode", true]]);
});

test("Ajustes: el plan de OpenCode se busca en Plan y cupos (es parte de la cuenta), no en Ajustes > OpenCode", () => {
  const nav = readFileSync(path.join(import.meta.dirname, "..", "src", "paneles", "ajustes-nav.ts"), "utf8");
  assert.match(nav, /\{ cat: "cupos", nombre: "ajustes\.ocPlan"/, "el buscador lleva el plan a Plan y cupos");
  assert.doesNotMatch(nav, /\{ cat: "opencode", nombre: "ajustes\.ocPlan"/);
  const fuente = readFileSync(path.join(import.meta.dirname, "..", "src", "paneles", "AjustesOpencode.tsx"), "utf8");
  assert.ok(!fuente.includes("radiogroup"), "el selector del plan ya no está duplicado en Ajustes > OpenCode");
  const cupos = readFileSync(path.join(import.meta.dirname, "..", "src", "paneles", "AjustesCupos.tsx"), "utf8");
  assert.ok(cupos.includes('opc="ajustes.ocPlan"') && cupos.includes('<Cabecera id="opencode"'), "la tarjeta de OpenCode lleva el plan y el logo como las demás");
});
