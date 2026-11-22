#!/usr/bin/env node
// Un `opencode acp` falso que se porta como opencode 1.19 con el uso gratis agotado: contesta initialize / session/new / set_config_option,
// y al `session/prompt` NO responde nunca (queda colgado). Según FALSO_ACP_MODO antes avisa o no del error:
//   "stderr"  escribe el AI_APICallError del límite gratis por stderr
//   "mensaje" lo manda como un agent_message_chunk (lo primero del turno)
//   "mudo"    no dice nada (el caso que sólo se detecta por el tope sin eventos)
// Modos para el puente de dsh (tests/dsh-puente-acp-falso.test.ts); todos anotan cada pedido en FALSO_ACP_LOG (un JSON por línea):
//   "corte"     `session/resume` falla; el primer prompt (de todo el log) queda colgado y `session/cancel` se ignora (el puente lo mata); los demás contestan
//   "pensando"  un agent_thought_chunk y después el error de uso gratis en un agent_message_chunk (sin cerrar el prompt)
//   "partido"   el error de uso gratis partido en dos agent_message_chunk (sin cerrar el prompt)
//   "stderr-partido"  el error de uso gratis por stderr en dos escrituras (sin cerrar el prompt)
//   "error-data"      el prompt responde un error JSON-RPC cuyo detalle (cuota) viene sólo en `error.data`
//   "sin-modelo"      session/new y session/resume traen `configOptions: []` (sin la opción `model`); los prompts contestan
//   "colgado"   el prompt no contesta nunca y `session/cancel` se ignora (para probar el plazo de parar)
//   "sin-id"          contesta "Ho" + "la" en dos agent_message_chunk SIN messageId y cierra el turno
// Sólo para las pruebas (tests/lider-opencode-colgado.test.ts, tests/dsh-puente-acp-falso.test.ts).
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const ERROR = "AI_APICallError: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go";
const modo = process.env.FALSO_ACP_MODO || "mudo";
const enviar = (o) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
const log = process.env.FALSO_ACP_LOG;
const anotar = (m) => log && appendFileSync(log, JSON.stringify({ method: m.method, params: m.params }) + "\n");
const prompts = () => (log && existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l.includes('"session/prompt"')).length : 0);
const chunk = (tipo, text) => enviar({ method: "session/update", params: { sessionId: "ses_falsa", update: { sessionUpdate: tipo, content: { type: "text", text } } } });
const opciones = [{ id: "model", name: "Model", type: "select", currentValue: "opencode/deepseek-v4.1-flash-free", options: [] }];

createInterface({ input: process.stdin }).on("line", (l) => {
  let m;
  try {
    m = JSON.parse(l);
  } catch {
    return;
  }
  if (m.method) anotar(m);
  if (m.id === undefined) return;
  switch (m.method) {
    case "initialize":
      return enviar({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} }, promptCapabilities: { image: false } } } });
    case "session/resume":
      if (modo === "corte") return enviar({ id: m.id, error: { code: -32002, message: "Resource not found" } });
      return enviar({ id: m.id, result: { configOptions: modo === "sin-modelo" ? [] : opciones } });
    case "session/new":
      return enviar({ id: m.id, result: { sessionId: "ses_falsa", configOptions: modo === "sin-modelo" ? [] : opciones } });
    case "session/set_config_option":
      return enviar({ id: m.id, result: { configOptions: opciones } });
    case "session/prompt":
      if (modo === "corte" || modo === "sin-modelo") {
        if (modo === "corte" && prompts() <= 1) return; // el primero (ya anotado) queda colgado
        chunk("agent_message_chunk", "listo");
        return enviar({ id: m.id, result: { stopReason: "end_turn" } });
      }
      if (modo === "colgado") return;
      if (modo === "sin-id") {
        chunk("agent_message_chunk", "Ho");
        chunk("agent_message_chunk", "la");
        return enviar({ id: m.id, result: { stopReason: "end_turn" } });
      }
      if (modo === "pensando") {
        chunk("agent_thought_chunk", "pienso");
        chunk("agent_message_chunk", ERROR);
        return;
      }
      if (modo === "partido") {
        chunk("agent_message_chunk", "AI_APICallError: ");
        chunk("agent_message_chunk", ERROR.slice("AI_APICallError: ".length));
        return;
      }
      if (modo === "stderr-partido") {
        const corte = ERROR.indexOf("Free usa") + "Free usa".length; // parte la frase: ninguna mitad sola es el error
        process.stderr.write(`ERROR ${ERROR.slice(0, corte)}`);
        setTimeout(() => process.stderr.write(`${ERROR.slice(corte)}\n`), 50);
        return;
      }
      if (modo === "error-data") return enviar({ id: m.id, error: { code: -32000, message: "Provider error", data: ERROR } });
      if (modo === "stderr") process.stderr.write(`ERROR ${ERROR}\n`);
      if (modo === "mensaje") enviar({ method: "session/update", params: { sessionId: "ses_falsa", update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: ERROR } } } });
      return; // colgado: nunca contesta
    default:
      return enviar({ id: m.id, error: { code: -32601, message: `falso: ${m.method}` } });
  }
});
setInterval(() => {}, 60_000);
