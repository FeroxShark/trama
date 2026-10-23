// El puente de un líder de Gemini: un proceso Node que habla el stream-json de `claude -p` por stdin/stdout (lo
// que lider.ts ya maneja: cola, interrupción, estado, fin de turno) y por dentro corre `agy` (Antigravity CLI), un
// proceso por turno. Lo lanza lider.ts en lugar de `claude` (docs/estado/lider-gemini.md). Sin Electron.
//
//   node agy-puente.js --sid <uuid> --nombre <n> --modelo <gemini-…-low|medium|high> --cwd <carpeta>
//   HILOS_AGY=<binario>                       el `agy` (default: `agy`; las pruebas ponen scripts/agy-falso.mjs)
//   TRAMA_AGY_PREFACIO=<texto>                lo que se le dice antes del primer mensaje (agy no lee CLAUDE.md)
//
// Continuidad: `agy --conversation <id>` retoma su conversación; el id queda en `$HILOS_STATE/gemini/<sid>.json`.
// Si agy no la encuentra, el turno se repite una vez en una conversación nueva con lo hablado como prefacio
// (lo que dijo el transcript de este puente: sin las herramientas, sólo su nombre). Es la limitación: Gemini
// recuerda lo dicho, no los resultados de cada comando.
//
// Escribe además, como Claude Code: su transcript (`$HILOS_STATE/gemini/<sid>.jsonl`, mismo formato que los de
// `~/.claude/projects`, aparte para que no entren al consumo ni al historial de Claude) y su
// `sessions/<pid>.json` (la barra lo ve vivo; `pa` busca al jefe de un worker subiendo por los padres hasta un pid
// con ese archivo: sin él, los workers de un líder de Gemini quedarían sueltos).
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { comandosPluginAgy, Traductor } from "./agy-stream.ts";
import { aDueno, deDueno, dueno } from "./dueno.ts";
import { modeloAgy } from "./modelos-config.ts";
import { ESTADO } from "./estado.ts";
import { SESIONES } from "./sesiones.ts";

const AGY = process.env.HILOS_AGY ?? "agy";
/** Lo máximo que agy puede tardar en un turno (`--print-timeout`): un líder que delega espera a sus workers. */
const TIMEOUT_TURNO = process.env.TRAMA_AGY_TIMEOUT ?? "6h";
/** Cuánto de lo hablado se repite si hay que empezar una conversación nueva (caracteres). */
const TOPE_REPETIR = 12000;

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const sid = arg("sid") ?? "";
const nombre = arg("nombre") ?? "";
const modelo = arg("modelo") ?? "gemini-3.8-flash-low";
const cwd = arg("cwd") || process.cwd();
const prefacio = process.env.TRAMA_AGY_PREFACIO ?? "";

const DIR = path.join(ESTADO, "gemini");
const TRANSCRIPT = path.join(DIR, `${sid}.jsonl`);
const LADO = path.join(DIR, `${sid}.json`);
mkdirSync(DIR, { recursive: true });

const salir = (o: object) => process.stdout.write(JSON.stringify(o) + "\n");
const respuesta = (id: string, r: object) => salir({ type: "control_response", response: { subtype: "success", request_id: id, response: r } });
const fallo = (id: string, error: string) => salir({ type: "control_response", response: { subtype: "error", request_id: id, error } });

// --- sessions/<pid>.json ---------------------------------------------------------------------------------------

const archivoSesion = path.join(SESIONES, `${process.pid}.json`);
const arranque = Date.now();
let procStart: string | null = null;
try {
  const t = readFileSync("/proc/self/stat", "utf8");
  procStart = t.slice(t.lastIndexOf(")") + 2).split(" ")[19] ?? null;
} catch {
  /* sin /proc: la sesión se anota sin procStart */
}

function anotarSesion(status: "busy" | "idle") {
  try {
    mkdirSync(SESIONES, { recursive: true });
    const tmp = `${archivoSesion}.${process.pid}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({ pid: process.pid, sessionId: sid, name: nombre, cwd, kind: "interactive", entrypoint: "sdk-cli", status, startedAt: arranque, updatedAt: Date.now(), ...(procStart ? { procStart } : {}) }),
    );
    renameSync(tmp, archivoSesion);
  } catch {
    /* no poder anotarla no frena al líder */
  }
}

function limpiar() {
  try {
    unlinkSync(archivoSesion);
  } catch {
    /* ya no estaba */
  }
}

// --- transcript y conversación de agy --------------------------------------------------------------------------

function anotar(o: Record<string, unknown>) {
  try {
    appendFileSync(TRANSCRIPT, JSON.stringify({ ...o, timestamp: new Date().toISOString(), sessionId: sid, uuid: randomUUID(), cwd, isSidechain: false }) + "\n");
  } catch {
    /* sin transcript la vista sigue con lo del stream */
  }
}

function leerLado(): { conversation_id: string | null } {
  try {
    const o = JSON.parse(readFileSync(LADO, "utf8"));
    return { conversation_id: typeof o?.conversation_id === "string" ? o.conversation_id : null };
  } catch {
    return { conversation_id: null };
  }
}

function guardarLado(id: string) {
  try {
    writeFileSync(LADO, JSON.stringify({ version: 1, sid, conversation_id: id, modelo }) + "\n");
  } catch {
    /* se pierde la continuidad por agy: la próxima vez se repite lo hablado */
  }
}

/** Lo hablado, del transcript propio, en texto: para empezar en una conversación nueva de agy sin perder el hilo. */
function hablado(): string {
  let texto = "";
  try {
    texto = readFileSync(TRANSCRIPT, "utf8");
  } catch {
    return "";
  }
  const partes: string[] = [];
  for (const l of texto.split("\n")) {
    if (!l) continue;
    try {
      const o = JSON.parse(l);
      const c = o?.message?.content;
      if (o.type === "user" && typeof c === "string") partes.push(`${dueno()}: ${c}`);
      else if (o.type === "user" && Array.isArray(c)) {
        const t = c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
        if (t) partes.push(`${dueno()}: ${t}`);
      } else if (o.type === "assistant" && Array.isArray(c)) {
        const t = c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
        const h = c.filter((b: any) => b?.type === "tool_use").map((b: any) => `[usaste ${b.name}]`).join(" ");
        const dicho = [t, h].filter(Boolean).join(" ");
        if (dicho) partes.push(`Vos: ${dicho}`);
      }
    } catch {
      /* línea rota */
    }
  }
  let todo = partes.join("\n\n");
  if (todo.length > TOPE_REPETIR) todo = "…" + todo.slice(-TOPE_REPETIR);
  return todo;
}

// --- un turno ---------------------------------------------------------------------------------------------------

let hijo: ChildProcess | null = null;
let interrumpido = false;
let ocupado = false;
const cola: string[] = [];
let stdinCerrado = false;

/** Lo que dice un mensaje de usuario de Claude: el texto (las imágenes no llegan a agy en `-p`: se avisa). */
function textoDeUsuario(o: any): string {
  const c = o?.message?.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  const t = c.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text);
  const imagenes = c.filter((b: any) => b?.type === "image").length;
  if (imagenes) t.push(`[${imagenes} imagen(es) adjunta(s) que no pudiste ver: el modo de agy en el que corrés no las recibe; pedile ${aDueno()} que las describa.]`);
  return t.join("\n");
}

type Vuelta = {
  pasos: number;
  /** Se pidió retomar una conversación y agy no la tenía: el turno no avanzó y no se dijo nada (se repite en una nueva). */
  sinConversacion: boolean;
  conversacion: boolean;
};

function correrAgy(prompt: string, conversacion: string | null, tr: Traductor): Promise<Vuelta> {
  return new Promise((ok) => {
    const args = ["-p", prompt, "--model", modeloAgy(modelo), "--output-format", "stream-json", "--dangerously-skip-permissions", "--print-timeout", TIMEOUT_TURNO];
    if (conversacion) args.push("--conversation", conversacion);
    // Su propio grupo: al interrumpir caen también los comandos que lanzó.
    const p = spawn(AGY, args, { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    hijo = p;
    const v: Vuelta = { pasos: 0, sinConversacion: false, conversacion: !!conversacion };
    let resto = "";
    let stderr = "";
    let termino = false;
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (t: string) => {
      resto += t;
      const i = resto.lastIndexOf("\n");
      if (i < 0) return;
      const lineas = resto.slice(0, i).split("\n");
      resto = resto.slice(i + 1);
      for (const l of lineas) emitir(l, tr, v);
    });
    p.stderr!.setEncoding("utf8");
    p.stderr!.on("data", (t: string) => {
      stderr = (stderr + t).slice(-2000);
    });
    const fin = (codigo: number | null, motivo: string | null) => {
      if (termino) return;
      termino = true;
      if (resto.trim()) emitir(resto, tr, v);
      hijo = null;
      const mal = motivo !== null || !!codigo;
      if (v.conversacion && !v.pasos && (mal || v.sinConversacion) && !interrumpido) {
        v.sinConversacion = true;
        return ok(v);
      }
      const dijo = stderr.trim().split("\n").slice(-2).join(" · ");
      const error = interrumpido ? null : (motivo ?? (codigo ? `agy salió con el código ${codigo}${dijo ? `: ${dijo}` : ""}` : null));
      for (const o of tr.fin(error)) escribir(o);
      ok(v);
    };
    p.on("error", (e) => fin(null, `${path.basename(AGY)}: ${e.message}`));
    p.on("close", (codigo) => fin(codigo, null));
  });
}

/** Una línea de agy → las de Claude, a la vista y al transcript. */
function emitir(linea: string, tr: Traductor, v: Vuelta) {
  let o: any;
  try {
    o = JSON.parse(linea);
  } catch {
    return;
  }
  if (o?.event === "step_update" && (o.step_update?.step_type === "agent_response" || o.step_update?.step_type === "tool")) v.pasos++;
  // Retomando y sin un solo paso, un `result` que no es SUCCESS es "no hay tal conversación": no se muestra, se repite.
  if (o?.event === "result" && v.conversacion && !v.pasos && o.result?.status !== "SUCCESS") {
    v.sinConversacion = true;
    return;
  }
  const antes = tr.conversacion;
  for (const x of tr.linea(o)) escribir(x);
  if (tr.conversacion && tr.conversacion !== antes) guardarLado(tr.conversacion);
}

/** Sale al stream y, lo que es de la conversación, al transcript. */
function escribir(o: Record<string, any>) {
  salir(o);
  if (o.type === "assistant" || (o.type === "user" && Array.isArray(o.message?.content) && o.message.content[0]?.type === "tool_result"))
    anotar({ type: o.type, message: o.message });
}

async function turno(texto: string) {
  ocupado = true;
  interrumpido = false;
  anotarSesion("busy");
  const lado = leerLado();
  // Lo hablado hasta ahora, antes de anotar este mensaje (por si hay que empezar una conversación nueva).
  const previo = hablado();
  anotar({ type: "user", message: { role: "user", content: texto } });
  const conPrefacio = (t: string, repetir: string) => {
    const partes = [prefacio];
    if (repetir) partes.push(`Lo que ya hablaron antes de que se perdiera tu conversación interna (los resultados de los comandos no se conservan):\n\n${repetir}`);
    partes.push(`Mensaje ${deDueno()}:\n${t}`);
    const cuerpo = partes.filter(Boolean).join("\n\n---\n\n");
    const cmd = /^\/(\S+)/.exec(t.trim())?.[1];
    return cmd && (prefacio || repetir) ? `/${cmd}\n\n${cuerpo}` : cuerpo;
  };
  const tr = new Traductor({ sid, modelo });
  tr.conversacion = lado.conversation_id;
  const v = await correrAgy(lado.conversation_id ? texto : conPrefacio(texto, previo), lado.conversation_id, tr);
  if (v.sinConversacion && !interrumpido) {
    // agy no encontró la conversación: una nueva con lo hablado.
    const nuevo = new Traductor({ sid, modelo });
    await correrAgy(conPrefacio(texto, previo), null, nuevo);
  }
  ocupado = false;
  anotarSesion("idle");
  const siguiente = cola.shift();
  if (siguiente !== undefined) void turno(siguiente);
  else if (stdinCerrado) terminar(0);
}

function interrumpir() {
  if (!hijo?.pid) return;
  interrumpido = true;
  try {
    process.kill(-hijo.pid, "SIGTERM");
  } catch {
    /* ya salió */
  }
  const pid = hijo.pid;
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* ya salió */
    }
  }, 3000).unref();
}

function terminar(codigo: number) {
  limpiar();
  process.exit(codigo);
}

// --- stdin: el protocolo de claude -------------------------------------------------------------------------------

anotarSesion("idle");
process.on("SIGTERM", () => {
  interrumpir();
  terminar(143);
});
process.on("SIGINT", () => {
  if (ocupado) interrumpir();
  else terminar(130);
});
process.on("exit", limpiar);

let comandosCache: ReturnType<typeof comandosPluginAgy> | null = null;
function comandosDeAgy() {
  if (comandosCache) return comandosCache;
  try {
    const out = execFileSync(AGY, ["plugin", "list", "--json"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
    comandosCache = comandosPluginAgy(out);
  } catch {
    comandosCache = [];
  }
  return comandosCache;
}

const lector = createInterface({ input: process.stdin });
lector.on("line", (linea) => {
  let o: any;
  try {
    o = JSON.parse(linea);
  } catch {
    return;
  }
  if (o?.type === "control_request" && typeof o.request_id === "string") {
    const q = o.request ?? {};
    switch (q.subtype) {
      case "initialize":
        // Gemini no tiene permisos que pedir (agy corre sin preguntar) ni output styles; sí expone las skills de sus plugins.
        return respuesta(o.request_id, { commands: comandosDeAgy(), current_permission_mode: "bypassPermissions", available_output_styles: [] });
      case "interrupt":
        interrumpir();
        return respuesta(o.request_id, {});
      case "set_permission_mode":
        return respuesta(o.request_id, { mode: "bypassPermissions" });
      default:
        return fallo(o.request_id, `agy: ${String(q.subtype)} no aplica a un líder de Gemini`);
    }
  }
  if (o?.type === "user") {
    const t = textoDeUsuario(o);
    if (!t.trim()) return;
    if (ocupado) cola.push(t);
    else void turno(t);
  }
});
lector.on("close", () => {
  stdinCerrado = true;
  if (!ocupado) terminar(0);
});
