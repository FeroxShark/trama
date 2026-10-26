#!/usr/bin/env node
// Mide, con un `claude` REAL descartable (Haiku, esfuerzo low, unos centavos), qué pasa si a un líder de la app
// se le escribe una línea `user` por stdin EN MEDIO de un turno.
// El test que la fija: tests/mensaje-en-turno.test.ts (HILOS_CLAUDE_REAL=1 corre esto).
//   node scripts/medir-mensaje-en-turno.mjs <escenario> [--replay]
//   herramienta  el mensaje sale 3 s después de que arranca una herramienta larga (TRAMA_MEDIR_SEG, default 25 s)
//   texto        el mensaje sale con el primer delta de la respuesta final (sin herramientas): la carrera con el `result`
//   dos          dos mensajes seguidos durante la herramienta larga
//   rebobinar    como herramienta y después Volver acá (--resume-session-at) antes del mensaje, en él y después: ¿el modelo lo conoce?
// Imprime UNA línea JSON con números. Corre en una carpeta temporal con los mismos argumentos que `argvLider` y el
// entorno que `entornoLider` le deja a un líder. El transcript de la sesión se borra al terminar.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

const escenario = process.argv[2] ?? "herramienta";
const replay = process.argv.includes("--replay");
const SEG = Number(process.env.TRAMA_MEDIR_SEG ?? (escenario === "rebobinar" ? 10 : 25));
const CLAVE = "CLAVE-ZETA-77";
const CLAVE2 = "CLAVE-OMEGA-88";
const sid = randomUUID();
const cwd = mkdtempSync(path.join(tmpdir(), "mensaje-en-turno-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC_)/.test(k)));
const args = [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
  "--dangerously-skip-permissions", "--permission-prompt-tool", "stdio", "--model", process.env.TRAMA_MEDIR_MODELO ?? "claude-haiku-5-5", "--effort", "low",
  "--session-id", sid, ...(replay ? ["--replay-user-messages"] : []),
];
const p = spawn(process.env.HILOS_CLAUDE ?? "claude", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
const t0 = Date.now();
const ms = () => Date.now() - t0;
const linea = (t) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: t }] } }) + "\n";

const largo = `python3 -c "import time; time.sleep(${SEG}); print('TOOL-TERMINO')"`;
const pedido =
  escenario === "texto"
    ? "Redactá un texto de unas 200 palabras sobre los faros marítimos. No uses herramientas."
    : `Usá la herramienta Bash para correr exactamente este comando, sin cambiarlo, en primer plano: ${largo}\nCuando termine contestá "fin-1".`;

const r = { escenario, replay, sid, escritos: [], linea: [], tool: { inicio: null, fin: null, ok: null }, results: [], eventosUser: [], textoFinal: [] };
let disparado = false;
let ultimoResult = 0;
const escribir = (n) => {
  const t = linea(`MENSAJE-${n}: en tu respuesta final incluí la palabra ${n === 1 ? CLAVE : CLAVE2}.`);
  r.escritos.push(ms());
  p.stdin.write(t);
};
let toolId = null;
createInterface({ input: p.stdout }).on("line", (l) => {
  // TRAMA_MEDIR_VOLCAR=<archivo>: cada línea cruda del stdout con su hora (de ahí salen los fixtures del test).
  if (process.env.TRAMA_MEDIR_VOLCAR && !l.includes('"stream_event"')) appendFileSync(process.env.TRAMA_MEDIR_VOLCAR, `${ms()}\t${l}\n`);
  let j;
  try {
    j = JSON.parse(l);
  } catch {
    return;
  }
  if (j.type !== "stream_event" && j.subtype !== "thinking_tokens") r.linea.push(`${ms()} ${j.type}${j.subtype ? "/" + j.subtype : ""}`);
  if (j.type === "stream_event") {
    const d = j.event?.delta;
    if (escenario === "texto" && !disparado && d?.type === "text_delta") {
      disparado = true;
      escribir(1);
    }
    return;
  }
  if (j.type === "assistant") {
    for (const c of j.message.content) {
      if (c.type === "tool_use" && c.name === "Bash" && toolId === null) {
        toolId = c.id;
        r.tool.inicio = ms();
        if (escenario !== "texto" && !disparado) {
          disparado = true;
          setTimeout(() => {
            escribir(1);
            if (escenario === "dos") setTimeout(() => escribir(2), 1500);
          }, 3000);
        }
      }
      if (c.type === "text") r.textoFinal.push({ t: ms(), texto: c.text.slice(0, 160) });
    }
  }
  if (j.type === "user") {
    const c = j.message?.content;
    const res = Array.isArray(c) ? c.find((b) => b.type === "tool_result" && b.tool_use_id === toolId) : null;
    if (res) {
      r.tool.fin = ms();
      r.tool.ok = JSON.stringify(res.content).includes("TOOL-TERMINO");
    } else r.eventosUser.push({ t: ms(), replay: j.isReplay === true, texto: JSON.stringify(c).slice(0, 120) });
  }
  if (j.type === "result") {
    r.results.push({ t: ms(), turnos: j.num_turns, tieneClave: String(j.result).includes(CLAVE), tieneClave2: String(j.result).includes(CLAVE2) });
    ultimoResult = ms();
    // Si quedó algo pendiente, un segundo turno arranca solo; si no hay nada en 12 s, se cierra.
    setTimeout(() => {
      if (ms() - ultimoResult >= 11500) p.stdin.end();
    }, 12000);
  }
});
let err = "";
p.stderr.on("data", (d) => (err += d));
const limite = setTimeout(() => {
  r.timeout = true;
  p.kill("SIGTERM");
}, (SEG + 300) * 1000);
// Volver acá (o Ramificar) en tres puntos: antes del mensaje, en el mensaje y después. Cada uno es un `claude -p --resume … --fork-session
// --resume-session-at <uuid>` (la copia no toca el original) al que se le pregunta si sabe de la palabra clave.
function preguntar(uuid) {
  return new Promise((ok) => {
    const q = spawn(process.env.HILOS_CLAUDE ?? "claude", ["-p", "--model", "claude-haiku-5-5", "--effort", "low", "--dangerously-skip-permissions", "--resume", sid, "--fork-session", "--session-id", randomUUID(), "--resume-session-at", uuid, "¿Hubo algún mensaje que te pidiera incluir una palabra clave? Respondé sólo la palabra clave, o NINGUNA."], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let o = "";
    q.stdout.on("data", (d) => (o += d));
    const t = setTimeout(() => q.kill("SIGTERM"), 90000);
    q.on("exit", () => {
      clearTimeout(t);
      ok({ uuid, respuesta: o.trim().slice(0, 120), sabe: o.includes(CLAVE) });
    });
  });
}
async function rebobinar(pt, adjunto) {
  if (!pt.antes || !adjunto || !pt.despues) return { error: "sin puntos", pt, adjunto };
  const [antes, enElMensaje, despues] = await Promise.all([preguntar(pt.antes), preguntar(adjunto), preguntar(pt.despues)]);
  return { antes, enElMensaje, despues };
}
p.on("exit", async () => {
  clearTimeout(limite);
  r.salida = ms();
  // El transcript: cuándo se absorbió, cómo quedó y con qué `uuid`.
  const f = path.join(homedir(), ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sid}.jsonl`);
  r.transcript = { existe: existsSync(f), queued: [], ops: [], mensajesUser: 0 };
  const pt = {};
  if (r.transcript.existe) {
    for (const x of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
      let o;
      try {
        o = JSON.parse(x);
      } catch {
        continue;
      }
      if (o.type === "attachment" && o.attachment?.type === "queued_command")
        r.transcript.queued.push({ uuid: o.uuid, padre: o.parentUuid, ts: o.timestamp, texto: o.attachment.prompt?.[0]?.text?.slice(0, 40) });
      if (o.type === "queue-operation" && o.operation !== "enqueue" && o.content) r.transcript.ops.push({ op: o.operation, razon: o.reason, ts: o.timestamp });
      if (o.type === "queue-operation" && o.operation === "enqueue" && o.content === undefined) r.transcript.ops.push({ op: "enqueue", ts: o.timestamp });
      if (o.type === "user" && JSON.stringify(o.message?.content).includes("MENSAJE-")) r.transcript.mensajesUser++;
      // Para rebobinar: el último tool_result de antes del adjunto y el último texto del modelo (después).
      if (o.type === "user" && JSON.stringify(o.message?.content).includes('"tool_result"') && !r.transcript.queued.length) pt.antes = o.uuid;
      if (o.type === "assistant" && o.message?.content?.some((b) => b.type === "text")) pt.despues = o.uuid;
    }
    if (escenario === "rebobinar") r.rebobinar = await rebobinar(pt, r.transcript.queued[0]?.uuid);
    if (!process.env.TRAMA_MEDIR_CONSERVAR) rmSync(path.dirname(f), { recursive: true, force: true });
  }
  r.stderr = err.slice(0, 300);
  console.log(JSON.stringify(r));
  rmSync(cwd, { recursive: true, force: true });
  process.exit(0);
});
p.stdin.write(linea(pedido));
