#!/usr/bin/env node
// Un servidor falso compatible con OpenAI (`GET /v1/models`, `POST /v1/chat/completions` con SSE) para probar a `dsh` (y lo que
// lo use) sin gastar nada ni necesitar Ollama. Imprime una línea JSON `{ port, baseURL }` al escucharse. Lo que contesta depende de
// la ÚLTIMA entrada de la conversación (el mensaje de la persona, o el resultado de una herramienta):
//   (nada especial)  "eco: <texto del mensaje>" (más "[imagen]" si el mensaje trae una imagen)
//   "RAZONA"         primero un bloque de razonamiento (`reasoning_content`), después lo que corresponda (eco o herramienta)
//   "HERRAMIENTA"    pide la herramienta `bash` (`echo hola-desde-bash`, con su `description`); con el resultado contesta "listo: <salida>"
//   "ESCALA"         pide `write` con `sandbox_permissions` (escalar el sandbox: dsh pregunta por session/request_permission en modo read-only)
//   "HERRAMIENTA_LENTA"  igual, pero el comando es `sleep 30` (para cortarlo con session/cancel)
//   "DESPACIO"       tarda OPENAI_FALSO_MS_LENTO (default 400) ms entre cada uno de 12 deltas de texto (para cortar el turno a mitad)
//   "TARDA"          tarda OPENAI_FALSO_TARDA (default 2500) ms en decir algo (se combina con los demás)
//   "ERROR500"       contesta 500
// Entorno:  OPENAI_FALSO_PORT (0 = cualquiera), OPENAI_FALSO_MODELO (default fake-model), OPENAI_FALSO_LOG (archivo: una línea JSON por
// pedido de chat con sus headers y su body), OPENAI_FALSO_MS (ms entre deltas, default 5).
import http from "node:http";
import { appendFileSync } from "node:fs";

const MODELO = process.env.OPENAI_FALSO_MODELO ?? "fake-model";
const LOG = process.env.OPENAI_FALSO_LOG ?? null;
const MS = Number(process.env.OPENAI_FALSO_MS ?? 5);
const MS_LENTO = Number(process.env.OPENAI_FALSO_MS_LENTO ?? 400);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const aTexto = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p?.type === "text" ? p.text : p?.type === "image_url" ? "[imagen]" : "")).join("") : "");

async function chat(req, res, body) {
  const json = JSON.parse(body || "{}");
  if (LOG) appendFileSync(LOG, JSON.stringify({ t: Date.now(), headers: req.headers, body: json }) + "\n");
  const msgs = Array.isArray(json.messages) ? json.messages : [];
  // dsh agrega al final un "Current runtime context…" como mensaje de usuario: no es de la persona ni cuenta como lo último.
  const contexto = (m) => m?.role === "user" && aTexto(m.content).startsWith("Current runtime context");
  const reales = msgs.filter((m) => !contexto(m));
  const ultimo = reales.at(-1) ?? {};
  // El pedido de título de sesión de dsh no lleva herramientas: se contesta corto y sin gatillos.
  const sinTools = !Array.isArray(json.tools) || json.tools.length === 0;
  const persona = [...reales].reverse().find((m) => m.role === "user");
  const texto = aTexto(persona?.content);
  if (texto.includes("ERROR500") && !sinTools && ultimo.role !== "tool") {
    res.writeHead(500, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "boom falso", type: "server_error" } }));
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  let abierto = true;
  res.on("close", () => (abierto = false));
  const id = "chatcmpl-falso-" + Date.now();
  const mk = (delta, fin = null, extra = {}) => ({ id, object: "chat.completion.chunk", created: 1700000000, model: MODELO, choices: [{ index: 0, delta, finish_reason: fin }], ...extra });
  const mandar = async (c, ms = MS) => {
    if (!abierto) return;
    res.write(`data: ${JSON.stringify(c)}\n\n`);
    if (ms) await dormir(ms);
  };
  const cerrar = async (fin, usage) => {
    await mandar(mk({}, fin, { usage }));
    if (abierto) res.write("data: [DONE]\n\n");
    res.end();
  };

  if (sinTools) {
    await mandar(mk({ role: "assistant", content: "titulo falso" }));
    return cerrar("stop", { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  }
  if (ultimo.role === "tool") {
    await mandar(mk({ role: "assistant", content: `listo: ${aTexto(ultimo.content).trim()}` }));
    return cerrar("stop", { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 });
  }
  // "TARDA": el modelo todavía no dijo nada (para cortar el turno antes de su primer token).
  if (texto.includes("TARDA")) await dormir(Number(process.env.OPENAI_FALSO_TARDA ?? 2500));
  await mandar(mk({ role: "assistant", content: "" }));
  if (texto.includes("RAZONA")) {
    await mandar(mk({ reasoning_content: "Pienso " }));
    await mandar(mk({ reasoning_content: "en la respuesta." }));
  }
  const llamar = async (nombre, args) => {
    await mandar(mk({ content: null, tool_calls: [{ index: 0, id: "call_falso_1", type: "function", function: { name: nombre, arguments: "" } }] }));
    await mandar(mk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }));
    return cerrar("tool_calls", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  };
  if (texto.includes("ESCALA")) return llamar("write", { file_path: "escalado.txt", content: "x\n", sandbox_permissions: "workspace-write", justification: "prueba de permisos" });
  if (texto.includes("HERRAMIENTA")) return llamar("bash", { command: texto.includes("HERRAMIENTA_LENTA") ? "sleep 30" : "echo hola-desde-bash", description: "una herramienta de prueba" });
  if (texto.includes("DESPACIO")) {
    for (let i = 0; i < 12; i++) await mandar(mk({ content: `parte${i} ` }), MS_LENTO);
  } else {
    await mandar(mk({ content: "eco: " }));
    await mandar(mk({ content: texto }));
  }
  return cerrar("stop", { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 });
}

const servidor = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: MODELO, object: "model", created: 1700000000, owned_by: "falso" }] }));
    }
    if (req.method === "POST" && req.url?.startsWith("/v1/chat/completions")) return void chat(req, res, body).catch(() => res.end());
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "no existe", url: req.url }));
  });
});
servidor.listen(Number(process.env.OPENAI_FALSO_PORT ?? 0), "127.0.0.1", () => {
  const { port } = servidor.address();
  console.log(JSON.stringify({ port, baseURL: `http://127.0.0.1:${port}/v1` }));
});
