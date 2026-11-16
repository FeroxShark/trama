// «Revisar con otro modelo» en la ventana: el reloj de la revisión, los pasos y el selector de revisor con modelos sin sesión
// (atenuados, no elegibles, con su motivo), con el mismo estado de cuentas que Ajustes > Cuentas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clavePaso, duracionRevision, revisionViva, tiempoCorrido } from "../src/hilo/revision-logica.ts";
import { filasSeguir, listaSeguir, moverSeguir, noElegible, resaltadaInicial, sinSesionDe, type OpcionSeguir } from "../src/hilo/seguir-con.ts";

test("tiempoCorrido: segundos, y minutos con segundos de dos cifras", () => {
  assert.equal(tiempoCorrido(45_000), "45 s");
  assert.equal(tiempoCorrido(80_000), "1 m 20 s");
  assert.equal(tiempoCorrido(725_000), "12 m 05 s");
  assert.equal(tiempoCorrido(-5), "0 s");
  assert.equal(duracionRevision({ inicio: 1000, fin: null }, 81_000), 80_000);
  assert.equal(duracionRevision({ inicio: 1000, fin: 5000 }, 81_000), 4000);
});

test("pasos y fases: cada paso con su texto; sólo corriendo o entregando cuenta como viva", () => {
  assert.equal(clavePaso({ k: "leer", v: "a" }), "revision.pasoLeer");
  assert.equal(clavePaso({ k: "buscar", v: "a" }), "revision.pasoBuscar");
  assert.equal(clavePaso({ k: "otro", v: "a" }), "revision.pasoOtro");
  assert.deepEqual(["corriendo", "entregando", "hecha", "fallo", "cancelada"].map((fase) => revisionViva({ fase } as never)), [true, true, false, false, false]);
  assert.equal(revisionViva(null), false);
});

const ok = { logueado: true, error: null };
const sin = { logueado: false, error: null };
const OPC: OpcionSeguir[] = [
  { id: "gemini-4-argon", nombre: "Gemini 4 Argon", desc: "d", col: "google", colNombre: "Google" },
  { id: "claude-opus-5-5", nombre: "Opus 5.5", desc: "d", col: "anthropic", colNombre: "Anthropic" },
];

test("sinSesionDe: Google sin sesión se marca con su motivo; sin dato o con error de red, se deja elegir", () => {
  assert.deepEqual(sinSesionDe("gemini-4-argon", { claude: ok, agy: sin }), { v: "Google AI Pro", c: "agy" });
  assert.equal(sinSesionDe("gemini-4-argon", { claude: ok, agy: ok }), null);
  assert.equal(sinSesionDe("gemini-4-argon", { claude: ok, agy: { logueado: false, error: "sin red" } }), null);
  assert.equal(sinSesionDe("gemini-4-argon", null), null);
  assert.deepEqual(sinSesionDe("claude-opus-5-5", { claude: sin, agy: ok }), { v: "Claude", c: "claude" });
  assert.equal(sinSesionDe("ollama:qwen", { claude: sin, agy: sin }), null);
});

test("el selector: el modelo sin sesión queda al final, no es elegible y las flechas y la resaltada lo saltan", () => {
  const sesiones = new Map([["gemini-4-argon", { v: "Google AI Pro", c: "agy" }]]);
  const grupos = listaSeguir(OPC, new Map(), null, "", sesiones);
  // La sección con algo que se puede usar va primero.
  assert.deepEqual(grupos.map((g) => g.clave), ["anthropic", "google"]);
  const filas = filasSeguir(grupos);
  const g = filas.find((f) => f.opcion.id === "gemini-4-argon")!;
  assert.equal(noElegible(g), true);
  assert.equal(g.sinSesion?.c, "agy");
  assert.equal(filas[resaltadaInicial(filas)].opcion.id, "claude-opus-5-5");
  assert.equal(moverSeguir(filas, 0, "ArrowDown"), 0, "no hay otra fila elegible: queda donde estaba");
  // Sin sesiones, todo igual que antes.
  assert.equal(noElegible(filasSeguir(listaSeguir(OPC, new Map(), null, ""))[0]), false);
});
