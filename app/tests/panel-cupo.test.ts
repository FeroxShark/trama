// Prueba la lógica pura del panel acoplable de Cupo: ventanas, suscripciones, cuentas y ritmo semanal.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Uso } from "../src/datos/contrato.ts";
import type { ListaCuentas } from "../src/datos/cuentas.ts";
import { armarSuscripcionesPanel, formatearAusente, MARCHAS_PLAN_DIA, redondearPct, ritmoPanel, ventanaDeCupo } from "../src/barra/panel-cupo-logica.ts";

const NOMBRES = { claude: "Claude", principal: "Principal" };
const AHORA = 1_750_000_000;
const SEMANA = 7 * 24 * 3600;

describe("redondearPct", () => {
  it("mantiene null y acota entre 0 y 100 sin inflar 99.6 a 100", () => {
    assert.equal(redondearPct(null), null);
    assert.equal(redondearPct(-3), 0);
    assert.equal(redondearPct(99.6), 99);
    assert.equal(redondearPct(100), 100);
    assert.equal(redondearPct(104), 100);
  });
});

describe("ventanaDeCupo", () => {
  it("oculta reinicio con 0 %, marca atención desde 80 % y agotado en 100 %", () => {
    const cero = ventanaDeCupo({ id: "5h", pct: 0, vuelve: AHORA + 3600 }, AHORA);
    assert.equal(cero.nivel, "bien");
    assert.equal(cero.vuelve, null);

    const ambar = ventanaDeCupo({ id: "5h", pct: 80, vuelve: AHORA + 3600 }, AHORA);
    assert.equal(ambar.nivel, "atencion");
    assert.equal(ambar.vuelve, AHORA + 3600);

    const rojo = ventanaDeCupo({ id: "5h", pct: 100, vuelve: AHORA + 1800 }, AHORA);
    assert.equal(rojo.nivel, "agotado");
    assert.equal(rojo.vuelve, AHORA + 1800);
  });

  it("maneja deshabilitada (off), sin dato, gratis y marca 429 vigente", () => {
    const off = ventanaDeCupo({ id: "5h", pct: 0, vuelve: null, deshabilitada: true }, AHORA);
    assert.equal(off.nivel, "off");
    assert.equal(off.pct, null);

    const gratis = ventanaDeCupo({ id: "5h", pct: null, vuelve: null, pedidos: 12 }, AHORA);
    assert.equal(gratis.nivel, "sin");
    assert.equal(gratis.gratis, true);
    assert.equal(gratis.pedidos, 12);

    const marcado = ventanaDeCupo({ id: "7d", pct: 40, vuelve: null }, AHORA, { marcado: AHORA + 900 });
    assert.equal(marcado.nivel, "agotado");
    assert.equal(marcado.marcado, true);
    assert.equal(marcado.vuelve, AHORA + 900);
  });
});

describe("armarSuscripcionesPanel", () => {
  it("arma una cuenta de Claude y las demás suscripciones con sus grupos", () => {
    const uso: Extract<Uso, { ts: number }> = {
      version: 1,
      ts: AHORA - 120,
      five_hour: { pct: 18, resets_at: AHORA + 7200 },
      seven_day: { pct: 42, resets_at: AHORA + 3 * 86400 },
      suscripciones: [
        {
          id: "google",
          nombre: "Google AI Pro",
          proveedor: "google",
          ts: AHORA - 60,
          grupos: [
            { id: "gemini", nombre: "Gemini", ventanas: [{ id: "5h", pct: 12, vuelve: AHORA + 1000 }] },
            {
              id: "claude-gpt",
              nombre: "Claude y GPT",
              ventanas: [
                { id: "5h", pct: 0, vuelve: null, deshabilitada: true },
                { id: "7d", pct: 100, vuelve: AHORA + 50000 },
              ],
            },
          ],
        },
        {
          id: "opencode",
          nombre: "OpenCode Gratis",
          proveedor: "opencode",
          ts: AHORA - 30,
          ventanas: [{ id: "5h", pct: null, vuelve: null, pedidos: 9 }],
        },
      ],
    };

    const lista = armarSuscripcionesPanel(uso, null, AHORA, NOMBRES);
    assert.equal(lista.length, 3);
    assert.equal(lista[0].titulo, "Claude");
    assert.equal(lista[0].enUso, undefined);
    assert.equal(lista[0].grupos[0].ventanas[0].pct, 18);
    assert.equal(lista[0].grupos[0].ventanas[1].pct, 42);

    assert.equal(lista[1].titulo, "Google AI Pro");
    assert.equal(lista[1].grupos.length, 2);
    assert.equal(lista[1].grupos[1].ventanas[0].nivel, "off");
    assert.equal(lista[1].grupos[1].ventanas[1].nivel, "agotado");

    assert.equal(lista[2].grupos[0].ventanas[0].gratis, true);
    assert.equal(lista[2].grupos[0].ventanas[0].pedidos, 9);
  });

  it("prioriza la cuenta preferida de Claude cuando hay varias cuentas", () => {
    const cuentas: ListaCuentas = {
      version: 1,
      cuentas: [
        { id: "claude", proveedor: "claude", nombre: "Personal", defecto: true, preferida: false, logueado: true },
        { id: "claude-2", proveedor: "claude", nombre: "Trabajo", defecto: false, preferida: true, logueado: true },
      ],
    };
    const uso: Extract<Uso, { ts: number }> = {
      version: 1,
      ts: AHORA - 10,
      claudeNombre: "Personal",
      five_hour: { pct: 90, resets_at: AHORA + 1000 },
      seven_day: { pct: 60, resets_at: AHORA + 400000 },
      suscripciones: [
        {
          id: "claude-2",
          nombre: "Claude · Trabajo",
          proveedor: "claude",
          cuenta: "claude-2",
          ts: AHORA - 5,
          ventanas: [
            { id: "5h", pct: 10, vuelve: AHORA + 3600 },
            { id: "7d", pct: 25, vuelve: AHORA + 500000 },
          ],
        },
      ],
    };

    const lista = armarSuscripcionesPanel(uso, cuentas, AHORA, NOMBRES);
    assert.equal(lista[0].enUso, true);
    assert.match(lista[0].titulo, /Trabajo/);
    assert.equal(lista[0].grupos[0].ventanas[0].pct, 10);
    assert.equal(lista[1].enUso, false);
    assert.equal(lista[1].grupos[0].ventanas[0].pct, 90);
  });
});

describe("ritmoPanel", () => {
  it("indica si llega al reinicio o si se acaba antes con marca esperada", () => {
    const mitadSemana = AHORA + SEMANA / 2;
    const bien = ritmoPanel(
      { version: 1, ts: AHORA, five_hour: null, seven_day: { pct: 40, resets_at: mitadSemana } },
      null,
      AHORA,
      NOMBRES,
    );
    assert.ok(bien);
    assert.equal(bien.estadoRitmo, "llega");
    assert.equal(bien.esperadoPct, 50);
    assert.equal(bien.seAcabaEn, null);
    assert.equal(bien.nivel, "bien");

    const rapido = ritmoPanel(
      { version: 1, ts: AHORA, five_hour: null, seven_day: { pct: 75, resets_at: mitadSemana } },
      null,
      AHORA,
      NOMBRES,
    );
    assert.ok(rapido);
    assert.equal(rapido.estadoRitmo, "seAcaba");
    assert.equal(rapido.nivel, "atencion");
    assert.ok((rapido.seAcabaEn ?? 0) > 0);
  });

  it("devuelve null sin porcentaje semanal", () => {
    const r = ritmoPanel({ version: 1, ts: AHORA, five_hour: { pct: 20, resets_at: null }, seven_day: null }, null, AHORA, NOMBRES);
    assert.equal(r, null);
  });
});

describe("plan del día en panel Cupo", () => {
  it("expone las tres marchas en orden y formatea los días ausentes", () => {
    assert.deepEqual(MARCHAS_PLAN_DIA, ["ahorrar", "normal", "gastar"]);
    assert.equal(formatearAusente(["2026-11-15", "2026-11-16"]), "15/11, 16/11");
    assert.equal(formatearAusente([]), "");
  });
});
