// La caja del líder mientras responde (lider.phOcupado) es lo único que dice cuándo entra un mensaje encolado. El aviso de
// arriba de la caja (directo.espera) se sacó: repetía lo mismo y decía otra cosa. Lo encolado a mitad de un turno de la app
// entra en el próximo límite de herramienta (electron/lider.ts, mandarDirecto): al terminar el paso en curso.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";

test("la caja mientras responde dice cuándo entra: al terminar el paso en curso", () => {
  assert.equal(en["lider.phOcupado"], "Joins when this step finishes");
  assert.equal(es["lider.phOcupado"], "Se suma al terminar este paso");
});

test("no queda el aviso de arriba de la caja ni sus textos", () => {
  for (const k of [...Object.keys(en), ...Object.keys(es)]) assert.doesNotMatch(k, /^directo\.espera/, k);
  const vista = readFileSync(new URL("../src/hilo/Lider.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(vista, /directo\.espera|data-directo-espera/);
});
