// `pa --avisar-a <sid>` (B156): un worker lanzado desde un servicio avisa a ese líder, no a la sesión de arriba (que no existe).
import assert from "node:assert/strict";
import { test } from "node:test";
import { opcionesIniciales, parsearOpciones } from "../electron/cli/pa/opciones.ts";

const ctx = (env: Record<string, string>, err: string[] = []) => ({ env, io: { out: () => {}, err: (s: string) => void err.push(s) }, dueno: "", anotar: () => {} });

test("--avisar-a pone el id del líder al que se avisa y consume su valor", () => {
  const env: Record<string, string> = {};
  const o = parsearOpciones(["--avisar-a", "s-fix-a3", "--", "hacé algo"], opcionesIniciales("demo", env, "max"), ctx(env));
  assert.equal(env.PA_JEFE_ID, "s-fix-a3");
  assert.equal(o.tarea, "hacé algo");
});

test("--avisar-a sin valor o con un id raro corta con 2", () => {
  for (const a of [["--avisar-a"], ["--avisar-a", "no vale; rm"], ["--avisar-a", "--", "t"]]) {
    const err: string[] = [];
    assert.throws(() => parsearOpciones(a, opcionesIniciales("demo", {}, "max"), ctx({}, err)));
    assert.match(err.join(""), /--avisar-a/);
  }
});
