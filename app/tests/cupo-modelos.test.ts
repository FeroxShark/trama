// El cupo de cada modelo y de cada proveedor del selector (src/hilo/cupo-modelos.ts): sale del mismo `Uso` que la tarjeta de cupos,
// así que estos casos usan las mismas cifras que la tarjeta (Claude al 55 % y 31 %; Google con Claude y GPT lleno y Argon al 91 %).
import test from "node:test";
import assert from "node:assert/strict";
import { estadoCupoModelo, estadosCupoModelos, estadosCupoProveedores, POCO_LIBRE, ubicacionDe } from "../src/hilo/cupo-modelos.ts";
import type { Uso } from "../src/datos/contrato.ts";

const AHORA = 1_000_000;
const HORA = 3600;

const claude = (cinco: number, semana: number): Uso => ({
  version: 1,
  ts: AHORA,
  five_hour: { pct: cinco, resets_at: AHORA + HORA },
  seven_day: { pct: semana, resets_at: AHORA + 4 * 86400 },
});

const google = (argon: number, claudeGpt: number): Uso => ({
  ...claude(55, 31),
  suscripciones: [
    {
      id: "google",
      nombre: "Google AI Pro",
      ts: AHORA,
      grupos: [
        { id: "gemini", nombre: "Gemini", ventanas: [{ id: "5h", pct: 6, vuelve: AHORA + HORA }, { id: "7d", pct: 5, vuelve: AHORA + 5 * 86400 }] },
        { id: "claude-gpt", nombre: "Claude y GPT por Google", ventanas: [{ id: "5h", pct: 0, vuelve: null, deshabilitada: true }, { id: "7d", pct: claudeGpt, vuelve: AHORA + 3 * 86400 + 10 * HORA }] },
        { id: "gemini-4-argon", nombre: "Gemini 4 Argon", ventanas: [{ id: "7d", pct: argon, vuelve: AHORA + 5 * 86400 + 6 * HORA }] },
      ],
    },
  ],
});

test("cada modelo cae en la ventana o el grupo que le cobra", () => {
  assert.deepEqual(ubicacionDe("claude-opus-5-5"), { suscripcion: "claude" });
  assert.deepEqual(ubicacionDe("gemini-4-argon"), { suscripcion: "google", grupo: "gemini-4-argon" });
  assert.deepEqual(ubicacionDe("gemini-3.8-flash"), { suscripcion: "google", grupo: "gemini" });
  assert.deepEqual(ubicacionDe("agy:claude-sonnet-5-5"), { suscripcion: "google", grupo: "claude-gpt" });
  assert.deepEqual(ubicacionDe("agy:gpt-oss-120b"), { suscripcion: "google", grupo: "claude-gpt" });
  assert.deepEqual(ubicacionDe("opencode:opencode/big-pickle"), { suscripcion: "opencode", grupo: "opencode-free" });
  assert.deepEqual(ubicacionDe("opencode:opencode-go/Kimi-K2"), { suscripcion: "opencode", grupo: "opencode:opencode-go/kimi-k2" });
  // Sin cupo medido: un local, DeepSeek Harness y un modelo de pago de OpenCode.
  for (const id of ["llama:mistral", "dsh:deepseek/deepseek-v4-flash", "opencode:anthropic/claude-x", "ollama:qwen"]) assert.equal(ubicacionDe(id), null, id);
});

test("un modelo de Claude sigue la ventana de 5 h y la semana, con la misma cifra que la tarjeta", () => {
  assert.deepEqual(estadoCupoModelo("claude-opus-5-5", claude(55, 31), AHORA), { sin: false, vuelve: null, poco: false, libre: 45 }, "55 % usado: el dato lo mide, pero no se marca");
  const poco = estadoCupoModelo("claude-haiku-5-5", claude(88, 31), AHORA);
  assert.deepEqual(poco, { sin: false, vuelve: null, poco: true, libre: 12 });
  const lleno = estadoCupoModelo("claude-sonnet-5-5", claude(100, 31), AHORA);
  assert.deepEqual(lleno, { sin: true, vuelve: AHORA + HORA, poco: false, libre: 0 });
});

test("un modelo de Google con su grupo lleno sale sin cupo hasta la hora del grupo", () => {
  const u = google(91, 100);
  assert.deepEqual(estadoCupoModelo("agy:claude-opus-5-5", u, AHORA), { sin: true, vuelve: AHORA + 3 * 86400 + 10 * HORA, poco: false, libre: 0 });
  assert.deepEqual(estadoCupoModelo("agy:gpt-oss-120b", u, AHORA), { sin: true, vuelve: AHORA + 3 * 86400 + 10 * HORA, poco: false, libre: 0 });
  // Argon al 91 % usado: se puede elegir, pero queda con poco cupo (menos del 15 % libre).
  assert.deepEqual(estadoCupoModelo("gemini-4-argon", u, AHORA), { sin: false, vuelve: null, poco: true, libre: 9 });
  // Gemini Flash (el grupo más usado, 6 %): medido, sin marca.
  assert.deepEqual(estadoCupoModelo("gemini-3.8-flash", u, AHORA), { sin: false, vuelve: null, poco: false, libre: 94 });
});

test("un grupo marcado sin cupo por un 429 cuenta como sin cupo, con cuándo vuelve", () => {
  const u: Uso = { ...google(40, 40), suscripciones: [{ ...google(40, 40).suscripciones![0], grupos: [{ id: "claude-gpt", nombre: "x", ventanas: [], agotado: AHORA + 600 }] }] };
  assert.deepEqual(estadoCupoModelo("agy:claude-sonnet-5-5", u, AHORA), { sin: true, vuelve: AHORA + 600, poco: false, libre: null });
  // Vencida la marca, ya no cuenta.
  assert.equal(estadoCupoModelo("agy:claude-sonnet-5-5", u, AHORA + 601), null);
});

test("el umbral de poco cupo es menos del 15 % libre, y el sin cupo gana sobre el poco", () => {
  assert.equal(POCO_LIBRE, 15);
  assert.equal(estadoCupoModelo("claude-opus-5-5", claude(85, 0), AHORA)?.poco, false, "15 % libre exacto no es poco");
  assert.equal(estadoCupoModelo("claude-opus-5-5", claude(86, 0), AHORA)?.poco, true);
  assert.equal(estadoCupoModelo("claude-opus-5-5", claude(100, 0), AHORA)?.poco, false);
});

test("sin dato del `Uso` (o un error), ningún modelo lleva nada", () => {
  assert.equal(estadoCupoModelo("claude-opus-5-5", null, AHORA), null);
  assert.equal(estadoCupoModelo("claude-opus-5-5", { version: 9, error: "x" } as Uso, AHORA), null);
  assert.equal(estadoCupoModelo("claude-opus-5-5", { version: 1, ts: 0, five_hour: null, seven_day: null }, AHORA), null);
  assert.equal(estadoCupoModelo("agy:claude-opus-5-5", claude(10, 10), AHORA), null, "Google sin su suscripción en el dato");
});

test("el OpenCode gratis agotado lleva su hora; el de pago y el de Go andando, nada", () => {
  const u: Uso = {
    ...claude(10, 10),
    suscripciones: [
      { id: "opencode", nombre: "OpenCode", ts: AHORA, grupos: [{ id: "opencode-free", nombre: "Gratis", ventanas: [], agotado: AHORA + 900 }, { id: "opencode:opencode-go/glm-5", nombre: "Go", ventanas: [{ id: "5h", pct: 20, vuelve: null }] }] },
    ],
  };
  assert.deepEqual(estadoCupoModelo("opencode:opencode/big-pickle", u, AHORA), { sin: true, vuelve: AHORA + 900, poco: false, libre: null });
  assert.deepEqual(estadoCupoModelo("opencode:opencode-go/glm-5", u, AHORA), { sin: false, vuelve: null, poco: false, libre: 80 }, "20 % usado: medido, sin marca");
  assert.equal(estadoCupoModelo("opencode:anthropic/claude-x", u, AHORA), null);
});

test("el mapa de modelos guarda a cada uno que el dato mide", () => {
  const m = estadosCupoModelos(["claude-opus-5-5", "claude-haiku-5-5", "llama:x"], claude(100, 10), AHORA);
  assert.deepEqual([...m.keys()], ["claude-opus-5-5", "claude-haiku-5-5"]);
});

test("un proveedor: Anthropic sigue a Claude; Google sin cupo sólo si lo están sus tres grupos", () => {
  assert.deepEqual(estadosCupoProveedores(claude(100, 10), AHORA).get("anthropic"), { sin: true, vuelve: AHORA + HORA, poco: false, libre: 0 });
  assert.deepEqual(estadosCupoProveedores(claude(10, 10), AHORA).get("anthropic"), { sin: false, vuelve: null, poco: false, libre: 90 });

  // Claude y GPT lleno y Argon al 91 %: Google sigue, con poco cupo por Argon (el más usado que queda).
  const parcial = estadosCupoProveedores(google(91, 100), AHORA).get("google");
  assert.deepEqual(parcial, { sin: false, vuelve: null, poco: true, libre: 9 });

  // Los tres grupos llenos: Google sin cupo hasta que vuelva el primero.
  const todo: Uso = {
    ...claude(10, 10),
    suscripciones: [
      {
        id: "google",
        nombre: "Google AI Pro",
        ts: AHORA,
        grupos: [
          { id: "gemini", nombre: "Gemini", ventanas: [{ id: "7d", pct: 100, vuelve: AHORA + 2 * HORA }] },
          { id: "claude-gpt", nombre: "Claude y GPT", ventanas: [{ id: "7d", pct: 100, vuelve: AHORA + 5 * HORA }] },
          { id: "gemini-4-argon", nombre: "Argon", ventanas: [{ id: "7d", pct: 100, vuelve: AHORA + 9 * HORA }] },
        ],
      },
    ],
  };
  assert.deepEqual(estadosCupoProveedores(todo, AHORA).get("google"), { sin: true, vuelve: AHORA + 2 * HORA, poco: false, libre: 0 });
});

test("OpenCode, DeepSeek Harness y lo local no tienen estado de proveedor", () => {
  const m = estadosCupoProveedores(google(100, 100), AHORA);
  for (const k of ["opencode", "dsh", "local", "ollama"]) assert.equal(m.has(k), false, k);
  assert.equal(estadosCupoProveedores(null, AHORA).size, 0);
});
