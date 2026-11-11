// Un solo nombre por modelo al leer medicion.tsv (electron/cli/pa/modelo-canonico.ts): `pa --rinde`, el historial del
// reparto y las muestras de costo juntan `sonnet` con `claude-sonnet-5-5`, sacan el effort del nombre de agy/codex/dsh y
// tratan `settings`, `-` y "" como un solo effort. El bash y el python congelados siguen agrupando crudo (divergencia a propósito).
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonico, cuentaCanonica, effortCanonico } from "../electron/cli/pa/modelo-canonico.ts";
import { celdasPor } from "../electron/cli/pa/rinde.ts";
import { leerMedicion, muestra, muestraModelo } from "../electron/cli/reparto-costo.ts";

test("canonico: alias corto → id completo de la familia", () => {
  assert.deepEqual(canonico("sonnet", "high"), { modelo: "claude-sonnet-5-5", effort: "high" });
  assert.deepEqual(canonico("haiku", "xhigh"), { modelo: "claude-haiku-5-5", effort: "xhigh" });
  assert.deepEqual(canonico("opus", "medium"), { modelo: "claude-opus-5-5", effort: "medium" });
  assert.deepEqual(canonico("fable", ""), { modelo: "claude-fable-5-2", effort: "" });
  assert.deepEqual(canonico(" Claude-Sonnet-5-5 ", "high"), { modelo: "claude-sonnet-5-5", effort: "high" });
});

test("canonico: el effort pegado al nombre de agy/codex/dsh pasa a la columna y el prefijo queda", () => {
  assert.deepEqual(canonico("agy:claude-sonnet-5-5-high", "-"), { modelo: "agy:claude-sonnet-5-5", effort: "high" });
  assert.deepEqual(canonico("agy:claude-opus-5-5-high", ""), { modelo: "agy:claude-opus-5-5", effort: "high" });
  assert.deepEqual(canonico("gemini-3.8-flash-medium", "-"), { modelo: "gemini-3.8-flash", effort: "medium" });
  assert.deepEqual(canonico("gemini-4-argon-high", "-"), { modelo: "gemini-4-argon", effort: "high" });
  assert.deepEqual(canonico("codex:gpt-6-luna-low", null), { modelo: "codex:gpt-6-luna", effort: "low" });
  assert.deepEqual(canonico("dsh:deepseek/deepseek-v4-max", ""), { modelo: "dsh:deepseek/deepseek-v4", effort: "max" });
  // un claude sin prefijo no se toca aunque termine parecido, ni un opencode
  assert.deepEqual(canonico("opencode:opencode/deepseek-v4.1-flash-free", "high"), { modelo: "opencode:opencode/deepseek-v4.1-flash-free", effort: "high" });
  assert.deepEqual(canonico("ollama:qwen3-coder-high", ""), { modelo: "ollama:qwen3-coder-high", effort: "" });
});

test("effort sin anotar: settings, - y vacío son uno", () => {
  for (const e of ["settings", "-", "", " ", null, undefined]) assert.equal(effortCanonico(e), "");
  assert.equal(canonico("claude-opus-5-5", "settings").effort, canonico("claude-opus-5-5", "").effort);
});

test("cuenta: la de siempre (claude, google, chatgpt, opencode) no se muestra; otra sí", () => {
  for (const c of ["claude", "google", "chatgpt", "opencode", ""]) assert.equal(cuentaCanonica(c), "");
  assert.equal(cuentaCanonica("trabajo"), "trabajo");
});

// --- filas reales de medicion.tsv (columnas recortadas) --------------------------------------------------
const COLS = ["fecha", "id", "proyecto", "modelo", "effort", "leer", "seguir", "is_error", "num_turns", "duration_s", "tokens", "costo_usd", "bien", "plan", "compactaciones", "autocompact", "origen", "cache_read", "cache_creation", "ephemeral_1h", "ephemeral_5m", "tipo", "integrada", "retrabajo", "cuenta"];
let n = 0;
const fila = (modelo: string, effort: string, cuenta: string, tipo = "codigo-acotado", integrada = "1", retrabajo = "0") => {
  const v: Record<string, string> = { fecha: "2026-11-05T10:00:00-03:00", id: `r${n++}`, proyecto: "trama", modelo, effort, leer: "0", seguir: "0", is_error: "false", num_turns: "10", costo_usd: "0.5", compactaciones: "0", tipo, integrada, retrabajo, cuenta };
  return COLS.map((c) => v[c] ?? "").join("\t");
};
const TSV = [
  COLS.join("\t"),
  fila("claude-sonnet-5-5", "high", ""),
  fila("claude-sonnet-5-5", "high", "claude"),
  fila("sonnet", "high", "claude"),
  fila("sonnet", "high", ""),
  fila("claude-haiku-5-5", "xhigh", ""),
  fila("haiku", "xhigh", "claude"),
  fila("claude-opus-5-5", "settings", ""),
  fila("claude-opus-5-5", "", "claude"),
  fila("opus", "-", ""),
  fila("agy:claude-sonnet-5-5-high", "-", "google"),
  fila("agy:claude-sonnet-5-5-high", "-", ""),
  fila("opencode:opencode/deepseek-v4.1-flash-free", "-", "opencode"),
  fila("opencode:opencode/deepseek-v4.1-flash-free", "-", ""),
  "",
].join("\n");

test("pa --rinde: una fila por modelo con filas reales de ejemplo", () => {
  const celdas = celdasPor(TSV, "2026-10-01", "tipo");
  const filas = celdas.map((c) => `${c.modelo}${c.cuenta ? `@${c.cuenta}` : ""} ${c.effort} ${c.n}`);
  assert.deepEqual(filas, [
    "agy:claude-sonnet-5-5 high 2",
    "claude-haiku-5-5 xhigh 2",
    "claude-opus-5-5 settings 3",
    "claude-sonnet-5-5 high 4",
    "opencode:opencode/deepseek-v4.1-flash-free settings 2",
  ]);
});

test("reparto-costo: la muestra junta alias y busca al candidato agy por su effort", () => {
  const filas = leerMedicion(TSV);
  assert.equal(muestra(filas, { tipo: "codigo-acotado", modelo: "claude-sonnet-5-5", effort: "high" }, "2026-10-01").dato, 4);
  assert.equal(muestra(filas, { tipo: "codigo-acotado", modelo: "sonnet", effort: "high" }, "2026-10-01").dato, 4);
  assert.equal(muestra(filas, { tipo: "codigo-acotado", modelo: "agy:claude-sonnet-5-5-high", effort: null }, "2026-10-01").dato, 2);
  assert.equal(muestra(filas, { tipo: "codigo-acotado", modelo: "claude-opus-5-5", effort: "settings" }, "2026-10-01").dato, 3);
  assert.equal(muestraModelo(filas, ["claude-opus-5-5", "opus"], "2026-10-01").dato, 3);
});
