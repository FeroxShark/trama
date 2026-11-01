#!/usr/bin/env node
// Un `opencode acp` falso que se porta como opencode 1.19 con el uso gratis agotado: contesta initialize / session/new / set_config_option,
// y al `session/prompt` NO responde nunca (queda colgado). Según FALSO_ACP_MODO antes avisa o no del error:
//   "stderr"  escribe el AI_APICallError del límite gratis por stderr
//   "mensaje" lo manda como un agent_message_chunk (lo primero del turno)
//   "mudo"    no dice nada (el caso que sólo se detecta por el tope sin eventos)
// Sólo para las pruebas (tests/lider-opencode-colgado.test.ts).
import { createInterface } from "node:readline";

const ERROR = "AI_APICallError: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go";
const modo = process.env.FALSO_ACP_MODO || "mudo";
const enviar = (o) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
const opciones = [{ id: "model", name: "Model", type: "select", currentValue: "opencode/deepseek-v4.1-flash-free", options: [] }];

createInterface({ input: process.stdin }).on("line", (l) => {
  let m;
  try {
    m = JSON.parse(l);
  } catch {
    return;
  }
  if (m.id === undefined) return;
  switch (m.method) {
    case "initialize":
      return enviar({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} }, promptCapabilities: { image: false } } } });
    case "session/new":
      return enviar({ id: m.id, result: { sessionId: "ses_falsa", configOptions: opciones } });
    case "session/set_config_option":
      return enviar({ id: m.id, result: { configOptions: opciones } });
    case "session/prompt":
      if (modo === "stderr") process.stderr.write(`ERROR ${ERROR}\n`);
      if (modo === "mensaje") enviar({ method: "session/update", params: { sessionId: "ses_falsa", update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: ERROR } } } });
      return; // colgado: nunca contesta
    default:
      return enviar({ id: m.id, error: { code: -32601, message: `falso: ${m.method}` } });
  }
});
setInterval(() => {}, 60_000);
