import { test } from "node:test";
import assert from "node:assert/strict";
import { sinReintento, sumarAviso, type AvisoVisto } from "../src/hilo/avisos.ts";
import type { AvisoLider } from "../src/datos/contrato.ts";

const juntar = (as: AvisoLider[]) => as.reduce<AvisoVisto[]>(sumarAviso, []);
const visibles = (as: AvisoVisto[]) => as.filter((a) => !a.oculto);
const reintento = (intento: number): AvisoLider => ({ clase: "reintento", intento, max: 10, espera_ms: 1000, estado: 529, error: "overloaded" });
const LIMITE = "You've hit your session limit · resets 7pm";

test("un reintento reemplaza al anterior y una respuesta lo saca", () => {
  const as = juntar([reintento(1), reintento(2), reintento(3)]);
  assert.equal(as.length, 1);
  assert.equal(as[0].clase === "reintento" && as[0].intento, 3);
  assert.deepEqual(sinReintento(as), []);
  const sin = [{ clase: "compacto", auto: true, antes: 1000 } as AvisoVisto];
  assert.equal(sinReintento(sin), sin);
});

test("el aviso de razonamiento de otra cuenta sale una vez por turno, con la cuenta de antes", () => {
  const cuenta = (anterior: string | null): AvisoLider => ({ clase: "cuenta", anterior });
  const as = juntar([cuenta(null), reintento(1), cuenta("claude")]);
  assert.deepEqual(as, [reintento(1), cuenta("claude")]);
});

test("límite rechazado + error rate_limit + result + fin con el mismo texto: un solo aviso visible", () => {
  const as = juntar([
    { clase: "limite", rechazado: true, ventana: "five_hour", hasta: 1_800_000_000, uso: null },
    { clase: "error", texto: LIMITE, codigo: "rate_limit" },
    { clase: "error", texto: LIMITE, codigo: null },
    { clase: "salio", codigo: 1, texto: LIMITE },
  ]);
  const v = visibles(as);
  assert.equal(v.filter((a) => a.clase !== "salio").length, 1);
  assert.equal(v[0].clase, "limite");
  // El salio queda, pero sin repetir el texto.
  assert.deepEqual(v.at(-1), { clase: "salio", codigo: 1, texto: null });
});

test("el error de límite que llegó antes que el rechazo se tapa", () => {
  const as = juntar([
    { clase: "error", texto: LIMITE, codigo: "rate_limit" },
    { clase: "limite", rechazado: true, ventana: "five_hour", hasta: null, uso: null },
  ]);
  assert.deepEqual(
    visibles(as).map((a) => a.clase),
    ["limite"],
  );
});

test("un límite por ventana; cerca del límite no tapa errores", () => {
  const as = juntar([
    { clase: "limite", rechazado: false, ventana: "five_hour", hasta: 1, uso: 0.8 },
    { clase: "limite", rechazado: false, ventana: "five_hour", hasta: 1, uso: 0.9 },
    { clase: "limite", rechazado: false, ventana: "seven_day", hasta: 2, uso: 0.75 },
    { clase: "error", texto: "boom", codigo: "rate_limit" },
  ]);
  assert.equal(as.filter((a) => a.clase === "limite").length, 2);
  assert.equal(visibles(as).length, 3);
});

test("errores repetidos y salio sin texto", () => {
  const e: AvisoLider = { clase: "error", texto: "se cortó", codigo: null };
  const as = juntar([e, e]);
  assert.equal(as.length, 1);
  assert.equal(sumarAviso(as, e), as);
  const s = sumarAviso(as, { clase: "salio", codigo: 2, texto: "otra cosa" });
  assert.deepEqual(s.at(-1), { clase: "salio", codigo: 2, texto: "otra cosa" });
});
