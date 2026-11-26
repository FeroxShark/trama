// Las corridas de lectura (`--leer`) aportan señal al reparto: manda la columna `bien` (`pa --bien <id> si|no|parcial`):
// `si` → dato y ok; `no`/`parcial` → dato y no ok. Sin `bien` cuenta `is_error`: true → dato y no ok; false → dato y ok;
// vacío (la corrida murió y no dejó resultado) → sin dato. Una escritura sin dato de integración que falló (is_error=true)
// es dato y no ok. Una sola función: electron/cli/pa/dato-medicion.ts. El bash y el python congelados no miran `bien` ni
// `is_error` (divergencia a propósito).
import { test } from "node:test";
import assert from "node:assert/strict";
import { datoDeFila } from "../electron/cli/pa/dato-medicion.ts";
import { celdasPor } from "../electron/cli/pa/rinde.ts";
import { leerMedicion, muestra } from "../electron/cli/reparto-costo.ts";

const HEADER = "fecha\tid\tproyecto\tmodelo\teffort\tleer\tseguir\tis_error\tnum_turns\tduration_s\ttokens\tcosto_usd\tbien\tplan\tcompactaciones\tautocompact\torigen\tcache_read\tcache_creation\tephemeral_1h\tephemeral_5m\ttipo\tintegrada\tretrabajo\tcuenta\n";
const lectura = (id: string, bien: string, err = "false") => `2026-10-20T10:00:00+00:00\t${id}\tproy\tclaude-haiku-5-5\thigh\t1\t0\t${err}\t3\t5\t100\t0.10\t${bien}\t\t0\t\t\t\t\t\t\tlectura\t\t\t\n`;
const TSV = HEADER + lectura("l1", "si") + lectura("l2", "no") + lectura("l3", "parcial") + lectura("l4", "", "");

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

test("datoDeFila: una lectura sin `bien` cuenta por is_error; vacío nunca suma dato", () => {
  const l = (is_error: string, bien = "") => datoDeFila({ leer: true, integrada: "", retrabajo: "", bien, is_error });
  assert.deepEqual(l("true"), { dato: true, ok: false });
  assert.deepEqual(l("false"), { dato: true, ok: true });
  assert.deepEqual(l(""), { dato: false, ok: false });
  assert.deepEqual(datoDeFila({ leer: true, integrada: "", retrabajo: "" }), { dato: false, ok: false });
  // con `bien`, manda `bien` aunque is_error diga otra cosa
  assert.deepEqual(l("true", "si"), { dato: true, ok: true });
  assert.deepEqual(l("false", "no"), { dato: true, ok: false });
});

test("datoDeFila: una escritura sin integración que falló es dato y no ok; con integración, igual que siempre", () => {
  const e = (integrada: string, retrabajo: string, is_error: string) => datoDeFila({ leer: false, integrada, retrabajo, is_error });
  assert.deepEqual(e("", "", "true"), { dato: true, ok: false });
  assert.deepEqual(e("", "", "false"), { dato: false, ok: false });
  assert.deepEqual(e("", "", ""), { dato: false, ok: false });
  assert.deepEqual(e("1", "0", "true"), { dato: true, ok: true });
  assert.deepEqual(e("1", "1", "true"), { dato: true, ok: false });
  assert.deepEqual(e("0", "", "true"), { dato: true, ok: false });
  assert.deepEqual(e("1", "", "true"), { dato: false, ok: false });
});

const escritura = (id: string, err: string, integrada = "", retrabajo = "") => `2026-10-20T10:00:00+00:00\t${id}\tproy\tclaude-haiku-5-5\thigh\t0\t0\t${err}\t3\t5\t100\t0.10\t\t\t0\t\t\t\t\t\t\tcodigo\t${integrada}\t${retrabajo}\t\n`;
const TSV2 = HEADER + lectura("a", "", "true") + lectura("b", "", "false") + lectura("c", "", "") + escritura("d", "true") + escritura("e", "false") + escritura("f", "", "1", "0");

test("pa --rinde y reparto-costo: una lectura sin `bien` y una escritura fallida cuentan por is_error", () => {
  const por = celdasPor(TSV2, "2026-10-01", "tipo");
  const lec = por.find((c) => c.tipo === "lectura")!;
  assert.equal(lec.n, 3);
  assert.equal(lec.dato, 2);
  assert.equal(lec.ok, 1);
  const cod = por.find((c) => c.tipo === "codigo")!;
  assert.equal(cod.n, 3);
  assert.equal(cod.dato, 2); // la fallida y la integrada; la que terminó sin error pero sin integración sigue sin dato
  assert.equal(cod.ok, 1);
  const filas = leerMedicion(TSV2);
  const ml = muestra(filas, { tipo: "lectura", modelo: "claude-haiku-5-5", effort: "high" }, "2026-10-01");
  assert.deepEqual([ml.dato, ml.ok], [2, 1]);
  const mc = muestra(filas, { tipo: "codigo", modelo: "claude-haiku-5-5", effort: "high" }, "2026-10-01");
  assert.deepEqual([mc.dato, mc.ok], [2, 1]);
});
