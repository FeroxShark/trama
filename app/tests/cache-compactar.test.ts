import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { candidatosCompactarClaude, opcionCompactarCache, type ModeloCandidatoBase } from "../src/hilo/cache-compactar.ts";
import { TABLA } from "../src/hilo/modelos.ts";
import { compactadoDespuesDeUltimoTurno, tokensParaAviso } from "../src/hilo/contexto-logica.ts";
import type { Mensaje } from "../src/datos/contrato.ts";

const conEstado = (conectadas: readonly string[]): ModeloCandidatoBase[] =>
  TABLA.map((m) => ({
    ...m,
    sinConectar: !conectadas.includes(m.empresa),
  }));

const msg = (i: number, rol: Mensaje["rol"], extra?: Partial<Mensaje>): Mensaje => ({
  i,
  rol,
  ts: null,
  texto: "",
  herramientas: [],
  det: [],
  modelo: null,
  error: null,
  imagenes: [],
  ...extra,
});

describe("opcionCompactarCache", () => {
  it("sólo un proveedor conectado (sólo Anthropic): elige Haiku como barato por defecto para Opus", () => {
    const r = opcionCompactarCache({
      modeloLider: "claude-opus-5-5",
      modeloDestino: "claude-opus-5-5",
      modelos: conEstado(["anthropic"]),
      tokens: 128_000,
    });
    assert.ok(r && r.tipo === "claude");
    assert.equal(r.elegidoDefecto.id, "claude-haiku-5-5");
    assert.deepEqual(
      r.candidatos.map((c) => c.id),
      ["claude-haiku-5-5", "claude-sonnet-5-5"],
    );
  });

  it("sólo un proveedor conectado (sólo Google): ofrece Gemini con el mismo modelo y omite Claude si no está conectado", () => {
    const gemini = opcionCompactarCache({
      modeloLider: "gemini-4-argon",
      modeloDestino: "gemini-4-argon",
      modelos: conEstado(["google"]),
      claudeConectado: false,
      tokens: 128_000,
    });
    assert.deepEqual(gemini, { tipo: "gemini", modelo: "gemini-4-argon" });

    const claudeDesconectado = opcionCompactarCache({
      modeloLider: "claude-opus-5-5",
      modeloDestino: "claude-opus-5-5",
      modelos: conEstado(["google"]),
      claudeConectado: false,
      tokens: 128_000,
    });
    assert.equal(claudeDesconectado, null);
  });

  it("sólo un modelo de Claude habilitado: no ofrece compactar con un barato inexistente", () => {
    const soloOpus = opcionCompactarCache({
      modeloLider: "claude-opus-5-5",
      modeloDestino: "claude-opus-5-5",
      modelos: conEstado(["anthropic"]),
      excluir: ["haiku", "sonnet", "fable"],
      tokens: 128_000,
    });
    assert.equal(soloOpus, null);

    // También si apagó los esfuerzos de un candidato en Ajustes > Modelos
    const soloPorEfforts = opcionCompactarCache({
      modeloLider: "claude-opus-5-5",
      modeloDestino: "claude-opus-5-5",
      modelos: conEstado(["anthropic"]),
      excluir: ["haiku"],
      effortsPermitidos: { "claude-sonnet-5-5": [] },
      tokens: 128_000,
    });
    assert.equal(soloPorEfforts, null);

    // Con un solo candidato más barato habilitado (Haiku excluido, Sonnet habilitado)
    const soloSonnet = opcionCompactarCache({
      modeloLider: "claude-opus-5-5",
      modeloDestino: "claude-opus-5-5",
      modelos: conEstado(["anthropic"]),
      excluir: ["haiku"],
      tokens: 128_000,
    });
    assert.ok(soloSonnet && soloSonnet.tipo === "claude");
    assert.equal(soloSonnet.elegidoDefecto.id, "claude-sonnet-5-5");
    assert.equal(soloSonnet.candidatos.length, 1);
  });

  it("chat más grande que la ventana del barato (250k > 200k de Haiku): salta Haiku y elige Sonnet", () => {
    const r = opcionCompactarCache({
      modeloLider: "claude-opus-5-5",
      modeloDestino: "claude-opus-5-5",
      modelos: conEstado(["anthropic"]),
      tokens: 250_000,
    });
    assert.ok(r && r.tipo === "claude");
    assert.equal(r.elegidoDefecto.id, "claude-sonnet-5-5");
    assert.deepEqual(
      r.candidatos.map((c) => c.id),
      ["claude-sonnet-5-5"],
    );

    // Si ya está en Sonnet y Haiku (200k) no entra para 250k, tampoco ofrece compactar
    const enSonnet = candidatosCompactarClaude({
      modeloActual: "claude-sonnet-5-5",
      modelos: conEstado(["anthropic"]),
      tokens: 250_000,
    });
    assert.deepEqual(enSonnet, []);
  });

  it("no muestra la 3ª opción en Codex, DeepSeek, OpenCode ni locales", () => {
    const modelos = conEstado(["anthropic", "google", "openai", "dsh", "opencode", "local", "ollama"]);
    for (const id of ["codex:gpt-6.1-sol", "dsh:deepseek-chat", "opencode:opencode/big-pickle", "local:qwen", "ollama:qwen3-coder:30b"]) {
      assert.equal(
        opcionCompactarCache({ modeloLider: id, modeloDestino: id, modelos, tokens: 128_000 }),
        null,
        `No debía ofrecer 3ª opción para ${id}`,
      );
    }
  });
});

describe("tokensParaAviso (bug 2477)", () => {
  const usageViejo = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 179000, cache_creation_input_tokens: 0 };
  const usageNuevo = { input_tokens: 500, output_tokens: 150, cache_read_input_tokens: 25500, cache_creation_input_tokens: 0 };

  it("descarta pag.usage pre-compactación si hubo compacto después del último turno y usa vivoUsage (o 0)", () => {
    const mensajes: Mensaje[] = [
      msg(1, "user"),
      msg(2, "assistant"),
      msg(3, "system", { compacto: { auto: false, antes: 180000 } }),
    ];
    assert.equal(compactadoDespuesDeUltimoTurno(mensajes), true);
    assert.equal(tokensParaAviso({ pagUsage: usageViejo, vivoUsage: null, mensajes }), 0);
    assert.equal(tokensParaAviso({ pagUsage: usageViejo, vivoUsage: usageNuevo, mensajes }), 26000);
  });

  it("respeta el flag compactada del transcript incluso si los mensajes vinieron sin el divisor", () => {
    const mensajes: Mensaje[] = [msg(1, "user"), msg(2, "assistant")];
    assert.equal(tokensParaAviso({ pagUsage: usageViejo, vivoUsage: null, compactada: true, mensajes }), 0);
    assert.equal(tokensParaAviso({ pagUsage: usageViejo, vivoUsage: usageNuevo, compactada: true, mensajes }), 26000);
  });

  it("usa vivoUsage o pagUsage normalmente cuando hay un turno del asistente después de compactar", () => {
    const mensajes: Mensaje[] = [
      msg(1, "assistant"),
      msg(2, "system", { compacto: { auto: true, antes: 180000 } }),
      msg(3, "user"),
      msg(4, "assistant"),
    ];
    assert.equal(compactadoDespuesDeUltimoTurno(mensajes), false);
    assert.equal(tokensParaAviso({ pagUsage: usageNuevo, vivoUsage: null, mensajes }), 26000);
  });
});
