// Las corridas de lectura (`--leer`) aportan señal al reparto por su columna `bien` (`pa --bien <id> si|no|parcial`):
// `si` → dato y ok; `no`/`parcial` → dato y no ok; sin `bien` → sin dato. Una sola función: electron/cli/pa/dato-medicion.ts.
// El bash y el python congelados las ignoran (divergencia a propósito).
import { test } from "node:test";
import assert from "node:assert/strict";
import { datoDeFila } from "../electron/cli/pa/dato-medicion.ts";
import { celdasPor } from "../electron/cli/pa/rinde.ts";
import { leerMedicion, muestra } from "../electron/cli/reparto-costo.ts";

const HEADER = "fecha\tid\tproyecto\tmodelo\teffort\tleer\tseguir\tis_error\tnum_turns\tduration_s\ttokens\tcosto_usd\tbien\tplan\tcompactaciones\tautocompact\torigen\tcache_read\tcache_creation\tephemeral_1h\tephemeral_5m\ttipo\tintegrada\tretrabajo\tcuenta\n";
const lectura = (id: string, bien: string) => `2026-10-20T10:00:00+00:00\t${id}\tproy\tclaude-haiku-5-5\thigh\t1\t0\tfalse\t3\t5\t100\t0.10\t${bien}\t\t0\t\t\t\t\t\t\tlectura\t\t\t\n`;
const TSV = HEADER + lectura("l1", "si") + lectura("l2", "no") + lectura("l3", "parcial") + lectura("l4", "");

test("datoDeFila: una lectura cuenta por `bien`; lo que no es lectura no cambia", () => {
  const l = (bien: string) => datoDeFila({ leer: true, integrada: "", retrabajo: "", bien });
  assert.deepEqual(l("si"), { dato: true, ok: true });
  assert.deepEqual(l("no"), { dato: true, ok: false });
  assert.deepEqual(l("parcial"), { dato: true, ok: false });
  assert.deepEqual(l(""), { dato: false, ok: false });
  assert.deepEqual(datoDeFila({ leer: false, integrada: "1", retrabajo: "0", bien: "no" }), { dato: true, ok: true });
  assert.deepEqual(datoDeFila({ leer: false, integrada: "1", retrabajo: "1" }), { dato: true, ok: false });
  assert.deepEqual(datoDeFila({ leer: false, integrada: "", retrabajo: "", bien: "si" }), { dato: false, ok: false });
});

test("pa --rinde: una lectura con bien=si es dato y ok; no/parcial, dato sin ok; sin bien, sin dato", () => {
  const [c] = celdasPor(TSV, "2026-10-01", "tipo");
  assert.equal(c!.n, 4);
  assert.equal(c!.dato, 3);
  assert.equal(c!.ok, 1);
  assert.equal(c!.pct, "33");
});

test("reparto-costo: la muestra de lectura cuenta `bien` como dato y ok", () => {
  const m = muestra(leerMedicion(TSV), { tipo: "lectura", modelo: "claude-haiku-5-5", effort: "high" }, "2026-10-01");
  assert.equal(m.dato, 3);
  assert.equal(m.ok, 1);
});
