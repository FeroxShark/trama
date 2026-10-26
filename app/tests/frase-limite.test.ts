// El límite de la SUSCRIPCIÓN de Claude no se confunde con el 429 de otro proveedor (OpenCode, DeepSeek...): un error de dsh se ve con su texto real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fraseConocida, fraseError, t } from "../src/i18n/index.ts";

const limite = t("error.limite");

test("los textos del límite de Claude siguen dando la frase simple", () => {
  assert.equal(fraseConocida("You've hit your session limit · resets 7pm"), limite);
  assert.equal(fraseConocida("Llegaste al límite de sesión"), limite);
  assert.equal(fraseConocida("5-hour limit reached ∙ resets 3pm"), limite);
  assert.equal(fraseConocida("cualquier cosa", 76), limite, "el código 76 de pa sigue siendo el límite");
});

test("un 429 de un proveedor (dsh/OpenCode/DeepSeek) no es el límite de Claude: se ve el texto real", () => {
  for (const x of [
    "OpenCode: se terminó el uso gratis de la clave pública. Creá una clave gratis en opencode.ai",
    "OpenCode: tu clave llegó al límite de uso. Esperá un rato",
    "dsh: 429: Rate limit exceeded, usage limit reached",
    "DeepSeek: rate limit reached (429)",
    "ollama: too many requests, rate limit",
  ])
    assert.equal(fraseError(x), x);
  assert.equal(fraseError("opencode: session limit exceeded"), "opencode: session limit exceeded", "si nombra a otro proveedor, no es de Claude");
});
