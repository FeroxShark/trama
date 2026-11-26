// El puente de un líder de ChatGPT: un proceso Node que habla el stream-json de `claude -p` por stdin/stdout (lo que
// lider.ts ya maneja: cola, interrupción, estado, fin de turno) y por dentro corre `codex exec --json` (OpenAI), un
// proceso por turno. Lo lanza lider.ts en lugar de `claude`, como agy-puente.ts con Gemini, pero más simple: sin destrabar,
// y lo que llega a mitad del turno entra al terminar el turno (con su eco). Sin Electron.
//
//   node codex-puente.js --sid <uuid> --nombre <n> --modelo <codex:gpt-6.1-sol> --effort <low|medium|high> --cwd <carpeta> --modo <modo>
//   HILOS_CODEX=<binario>         el `codex` (default: el que encuentra `resolverCodex`; las pruebas ponen scripts/codex-falso.mjs)
//   TRAMA_CODEX_PREFACIO=<texto>  lo que se le dice antes del primer mensaje (codex lee AGENTS.md, no los CLAUDE.md de la persona)
//   TRAMA_CODEX_RELEVO=<archivo>  lo hablado con otro motor, si la conversación venía de uno: va después del prefacio
//
// La cuenta: el login de ChatGPT de `codex` (`codex login`). Nunca `OPENAI_API_KEY` ni `CODEX_API_KEY`: se sacan del entorno.
// Continuidad: `codex exec … resume <thread_id> -` retoma su conversación; el id queda en `$HILOS_STATE/codex/<sid>.json`. Si
// codex ya no la tiene, el turno se repite una vez en una conversación nueva con lo hablado como prefacio.
// Permisos: el modo del líder elige el sandbox de codex (plan → read-only; default y acceptEdits → workspace-write; bypass →
// danger-full-access) y codex nunca pregunta (`approval_policy="never"`).
// Escribe, como Claude Code, su transcript (`$HILOS_STATE/codex/<sid>.jsonl`) y su `sessions/<pid>.json` (la barra lo ve vivo y
// `pa` encuentra al jefe de sus workers).
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import { aliasMasNuevosCodex, leerCodexModelos } from "./cli/codex-modelos.ts";
import { entornoCodexLider, paraLanzar, resolverCodex } from "./binario.ts";
import { contextoDeThread } from "./codex-rollout.ts";
import { argsCodex, partirCodex, sandboxDe, Traductor } from "./codex-stream.ts";
import { cortesDeEntorno, sinCortadas } from "./cortes.ts";
import { deDueno, dueno } from "./dueno.ts";
import { ESTADO } from "./estado.ts";
import { hijoEnGrupo, matarArbol, matarArbolAlSalir } from "./procesos.ts";
import { SESIONES } from "./sesiones.ts";

const CODEX = resolverCodex(process.env, os.homedir());
/** Cuánto de lo hablado se repite si hay que empezar una conversación nueva (caracteres). */
const TOPE_REPETIR = 12000;

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const sid = arg("sid") ?? "";
const nombre = arg("nombre") ?? "";
const ENTORNO = entornoCodexLider(process.env, os.homedir(), { sid, nombre });
function modeloCodexPorDefecto(): string {
  const modelos = leerCodexModelos();
  return aliasMasNuevosCodex(modelos).sol?.id ?? modelos[0]!.id;
}

const pedido = arg("modelo") ?? modeloCodexPorDefecto();
const { modelo: modeloCodex, effort } = partirCodex(pedido, arg("effort"));
/** Lo que se dice en cada mensaje (el modelo del líder, con el prefijo de Trama). */
const modelo = `codex:${modeloCodex}`;
const cwd = arg("cwd") || process.cwd();
let modo = arg("modo") ?? "bypassPermissions";

const relevo = (() => {
  try {
    return process.env.TRAMA_CODEX_RELEVO ? readFileSync(process.env.TRAMA_CODEX_RELEVO, "utf8").trim() : "";
  } catch {
    return "";
  }
})();
const prefacio = [process.env.TRAMA_CODEX_PREFACIO ?? "", relevo].filter(Boolean).join("\n\n---\n\n");
const CORTES = cortesDeEntorno(process.env.TRAMA_CORTES);
const SIN_REPETIR = process.env.TRAMA_SIN_REPETIR === "1";

const DIR = path.join(ESTADO, "codex");
const TRANSCRIPT = path.join(DIR, `${sid}.jsonl`);
const LADO = path.join(DIR, `${sid}.json`);
/** Las imágenes que la persona adjuntó: van a codex como archivos (`-i <archivo>`). */
const DIR_IMAGENES = path.join(DIR, sid);
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

// --- transcript y conversación de codex --------------------------------------------------------------------------

function anotar(o: Record<string, unknown>) {
  try {
    appendFileSync(TRANSCRIPT, JSON.stringify({ ...o, timestamp: new Date().toISOString(), sessionId: sid, uuid: randomUUID(), cwd, isSidechain: false }) + "\n");
  } catch {
    /* sin transcript la vista sigue con lo del stream */
  }
}

function leerLado(): { thread_id: string | null; contexto: number | null; ventana: number | null } {
  try {
    const o = JSON.parse(readFileSync(LADO, "utf8"));
    return {
      thread_id: typeof o?.thread_id === "string" ? o.thread_id : null,
      contexto: typeof o?.contexto === "number" ? o.contexto : null,
      ventana: typeof o?.ventana === "number" ? o.ventana : null,
    };
  } catch {
    return { thread_id: null, contexto: null, ventana: null };
  }
}

function guardarLado(id: string, contexto: number | null = leerLado().contexto, ventana: number | null = leerLado().ventana) {
  try {
    const texto = JSON.stringify({ version: 1, sid, thread_id: id, modelo, ...(contexto ? { contexto } : {}), ...(ventana ? { ventana } : {}) }) + "\n";
    // Entero o nada: el main lo lee mientras el puente lo escribe, y un archivo a medias se leería como «sin conversación».
    const tmp = `${LADO}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, texto);
      renameSync(tmp, LADO);
    } catch {
      // Windows no deja renombrar encima de un archivo que otro tiene abierto: se escribe directo.
      rmSync(tmp, { force: true });
      writeFileSync(LADO, texto);
    }
  } catch {
    /* se pierde la continuidad: la próxima vez se repite lo hablado */
  }
}

/** Lo hablado, del transcript propio, en texto: para empezar en una conversación nueva de codex sin perder el hilo. */
function hablado(): string {
  if (SIN_REPETIR && !leerLado().thread_id) return "";
  let texto = "";
  try {
    texto = readFileSync(TRANSCRIPT, "utf8");
  } catch {
    return "";
  }
  const partes: string[] = [];
  for (const l of sinCortadas(texto.split("\n"), CORTES)) {
    if (!l) continue;
    try {
      const o = JSON.parse(l);
      const c = o?.message?.content;
      if (o.type === "user" && typeof c === "string") partes.push(`${dueno()}: ${c}`);
      else if (o.type === "assistant" && Array.isArray(c)) {
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
let stdinCerrado = false;

const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
type Imagen = { tipo: string; datos: string };
type Mensaje = { texto: string; imagenes: Imagen[]; directo: boolean };
const cola: Mensaje[] = [];

function mensajeDeUsuario(o: any): Mensaje {
  const c = o?.message?.content;
  const directo = o?.trama_directo === true;
  if (typeof c === "string") return { texto: c, imagenes: [], directo };
  if (!Array.isArray(c)) return { texto: "", imagenes: [], directo };
  const texto = c.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("\n");
  const imagenes: Imagen[] = c
    .filter((b: any) => b?.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string" && EXTENSION[String(b.source.media_type)])
    .map((b: any) => ({ tipo: String(b.source.media_type), datos: b.source.data }));
  return { texto, imagenes, directo };
}

function limpiarImagenes() {
  try {
    rmSync(DIR_IMAGENES, { recursive: true, force: true });
  } catch {
    /* ya no estaba */
  }
}

let nImagen = 0;
/** Las imágenes del mensaje, guardadas: cada una va a codex con `-i`. */
function guardarImagenes(m: Mensaje): string[] {
  if (!m.imagenes.length) return [];
  const rutas: string[] = [];
  try {
    mkdirSync(DIR_IMAGENES, { recursive: true, mode: 0o700 });
    for (const i of m.imagenes) {
      const ruta = path.join(DIR_IMAGENES, `img-${++nImagen}.${EXTENSION[i.tipo]}`);
      writeFileSync(ruta, Buffer.from(i.datos, "base64"), { mode: 0o600 });
      rutas.push(ruta);
    }
  } catch {
    /* sin imágenes: el texto sale igual */
  }
  return rutas;
}

/** El eco que lider.ts espera de un mensaje de mitad de turno (lo mismo que `--replay-user-messages` en Claude). */
function eco(texto: string) {
  salir({ type: "user", isReplay: true, parent_tool_use_id: null, session_id: sid, message: { role: "user", content: [{ type: "text", text: texto }] } });
}

/** ¿El mensaje de codex dice que el hilo pedido no existe o no se pudo retomar? (y no un fallo de red, de login o de cuota) */
function textoSinConversacion(t: string): boolean {
  return /no rollout found|(thread|session|conversation)[^\n]{0,60}(not found|no such|does not exist|doesn't exist|unknown|invalid|could not (?:find|load)|failed to (?:load|resume))|(not found|no such|unknown|invalid)[^\n]{0,30}(thread|session|conversation)/i.test(t);
}

type Vuelta = { pasos: number; sinConversacion: boolean; conversacion: boolean };

function correrCodex(prompt: string, thread: string | null, imagenes: string[], tr: Traductor): Promise<Vuelta> {
  return new Promise((ok) => {
    const args = argsCodex({ modelo: modeloCodex, effort, sandbox: sandboxDe(modo), cwd, imagenes, thread });
    // Windows: un `codex.cmd` de npm va por cmd.exe (`paraLanzar`); un `.exe` o Linux, tal cual. Su grupo (Linux): al parar caen sus comandos.
    const l = paraLanzar(CODEX, args, ENTORNO);
    const p = spawn(l.file, l.args, { cwd, env: ENTORNO, stdio: ["pipe", "pipe", "pipe"], detached: hijoEnGrupo(), windowsHide: true, windowsVerbatimArguments: l.verbatim });
    hijo = p;
    p.stdin!.on("error", () => {});
    p.stdin!.end(prompt);
    const v: Vuelta = { pasos: 0, sinConversacion: false, conversacion: !!thread };
    let resto = "";
    let stderr = "";
    let termino = false;
    const emitir = (linea: string) => {
      let o: any;
      try {
        o = JSON.parse(linea);
      } catch {
        return;
      }
      if (typeof o?.type === "string" && o.type.startsWith("item.")) v.pasos++;
      // El `usage` de `turn.completed` es el acumulado del turno: el contexto de verdad es el del último pedido, en el rollout.
      if (o?.type === "turn.completed") tr.rollout = contextoDeThread(tr.conversacion, { env: ENTORNO, home: os.homedir() });
      const antes = tr.conversacion;
      const fuera = tr.linea(o);
      if (tr.conversacion && tr.conversacion !== antes) guardarLado(tr.conversacion);
      for (const x of fuera) {
        if (v.conversacion && !v.pasos && x.type === "result" && x.is_error && textoSinConversacion(String(x.result ?? ""))) {
          v.sinConversacion = true;
          continue;
        }
        escribir(x);
      }
    };
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (t: string) => {
      resto += t;
      const i = resto.lastIndexOf("\n");
      if (i < 0) return;
      const lineas = resto.slice(0, i).split("\n");
      resto = resto.slice(i + 1);
      for (const l of lineas) emitir(l);
    });
    p.stderr!.setEncoding("utf8");
    p.stderr!.on("data", (t: string) => {
      stderr = (stderr + t).slice(-2000);
    });
    const fin = (codigo: number | null, motivo: string | null) => {
      if (termino) return;
      termino = true;
      if (resto.trim()) emitir(resto);
      hijo = null;
      // Sólo si codex dice que el hilo no existe: un binario ausente, la red caída o el login vencido NO tiran la conversación guardada.
      const mal = motivo === null && !!codigo && textoSinConversacion(stderr);
      if (v.conversacion && !v.pasos && (mal || v.sinConversacion) && !interrumpido) {
        v.sinConversacion = true;
        return ok(v);
      }
      const dijo = stderr.trim().split("\n").slice(-2).join(" · ");
      const error = interrumpido ? null : (motivo ?? (codigo ? `codex salió con el código ${codigo}${dijo ? `: ${dijo}` : ""}` : null));
      for (const o of tr.fin(error)) escribir(o);
      ok(v);
    };
    p.on("error", (e) => fin(null, `${path.basename(CODEX)}: ${e.message}`));
    p.on("close", (codigo) => fin(codigo, null));
  });
}

/** Sale al stream y, lo que es de la conversación, al transcript. */
function escribir(o: Record<string, any>) {
  salir(o);
  if (o.type === "assistant" || (o.type === "user" && Array.isArray(o.message?.content) && o.message.content[0]?.type === "tool_result")) anotar({ type: o.type, message: o.message });
}

/** Lo que se le manda a codex en una conversación nueva: el prefacio, lo hablado si se perdió la anterior y el mensaje. */
function conPrefacio(t: string, repetir: string) {
  const partes = [prefacio];
  if (repetir) partes.push(`Lo que ya hablaron antes de que se perdiera tu conversación interna (los resultados de los comandos no se conservan):\n\n${repetir}`);
  partes.push(`Mensaje ${deDueno()}:\n${t}`);
  return partes.filter(Boolean).join("\n\n---\n\n");
}

async function turno(m: Mensaje) {
  ocupado = true;
  interrumpido = false;
  anotarSesion("busy");
  if (m.directo) eco(m.texto); // llegó a mitad de otro turno: entra ahora, y lider.ts espera su eco
  limpiarImagenes();
  const imagenes = guardarImagenes(m);
  const lado = leerLado();
  const previo = hablado();
  // Sin esto un mensaje de sólo imágenes quedaba vacío en el transcript (y en lo hablado que se repite).
  anotar({ type: "user", message: { role: "user", content: m.imagenes.length ? `${m.texto}\n[${m.imagenes.length} imagen(es) adjunta(s)]`.trim() : m.texto } });
  // Si alguna imagen no se pudo guardar, codex lo sabe (si no, contestaría como si no hubiera venido nada).
  const textoCodex = imagenes.length < m.imagenes.length ? `${m.texto}\n[${dueno()} adjuntó ${m.imagenes.length} imagen(es), pero no se pudieron guardar para que las veas; pedile que las describa.]`.trim() : m.texto;
  const tr = new Traductor({ sid, modelo, contextoPrevio: lado.contexto, ventanaPrevia: lado.ventana });
  tr.conversacion = lado.thread_id;
  const v = await correrCodex(lado.thread_id ? textoCodex : conPrefacio(textoCodex, previo), lado.thread_id, imagenes, tr);
  let ultimo = tr;
  if (v.sinConversacion && !interrumpido) {
    // codex no encontró la conversación: una nueva con lo hablado.
    ultimo = new Traductor({ sid, modelo, contextoPrevio: lado.contexto, ventanaPrevia: lado.ventana });
    await correrCodex(conPrefacio(textoCodex, previo), null, imagenes, ultimo);
  }
  // Sin rollout el contexto quedó desconocido (0): no se guarda el del turno anterior como si siguiera valiendo.
  if (ultimo.conversacion) guardarLado(ultimo.conversacion, ultimo.contexto || null, ultimo.rollout?.ventana ?? lado.ventana);
  cerrarTurno();
}

/** `turno` sin que un throw mate el puente: el turno termina con un error que lo dice y el puente sigue atendiendo. */
async function turnoSeguro(m: Mensaje) {
  try {
    await turno(m);
  } catch (e) {
    const motivo = `el puente de ChatGPT falló: ${String((e as Error)?.message ?? e).slice(0, 300)}`;
    process.stderr.write(`codex-puente: ${motivo}\n`);
    try {
      interrumpir();
      for (const o of new Traductor({ sid, modelo }).fin(motivo)) escribir(o);
    } catch {
      /* ni el aviso se pudo escribir */
    }
    cerrarTurno();
  }
}

function cerrarTurno() {
  ocupado = false;
  anotarSesion("idle");
  const siguiente = cola.shift();
  // Un turno que arranca solo (sale de la cola) no pasa por `mandar` de lider.ts: este aviso es lo que lo vuelve a poner como ocupado.
  if (siguiente !== undefined) salir({ type: "system", subtype: "status", status: "requesting", session_id: sid });
  if (siguiente !== undefined) void turnoSeguro(siguiente);
  else if (stdinCerrado) terminar(0);
}

function interrumpir() {
  if (!hijo?.pid) return;
  interrumpido = true;
  const pid = hijo.pid;
  matarArbol(pid, "SIGTERM");
  setTimeout(() => matarArbol(pid, "SIGKILL"), 3000).unref();
}

function terminar(codigo: number) {
  limpiar();
  limpiarImagenes();
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
process.on("exit", () => {
  matarArbolAlSalir(hijo?.pid);
  limpiar();
  limpiarImagenes();
});
process.on("SIGHUP", () => terminar(129));
process.on("uncaughtException", (e) => {
  process.stderr.write(`codex-puente: error sin atrapar: ${String((e as Error)?.stack ?? e)}\n`);
  terminar(1);
});

const MODOS = new Set(["default", "acceptEdits", "plan", "bypassPermissions"]);

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
        // codex no pide permisos (corre con `approval_policy="never"` y el sandbox del modo) ni tiene output styles.
        return respuesta(o.request_id, { commands: [], current_permission_mode: modo, available_output_styles: [] });
      case "interrupt":
        interrumpir();
        return respuesta(o.request_id, {});
      case "set_permission_mode":
        // Vale desde el próximo turno de codex (el sandbox es de cada proceso).
        if (typeof q.mode === "string" && MODOS.has(q.mode)) modo = q.mode;
        return respuesta(o.request_id, { mode: modo });
      default:
        return fallo(o.request_id, `codex: ${String(q.subtype)} no aplica a un líder de ChatGPT`);
    }
  }
  if (o?.type === "user") {
    const m = mensajeDeUsuario(o);
    if (!m.texto.trim() && !m.imagenes.length) return;
    if (!ocupado) void turnoSeguro(m);
    // codex exec no se corta a mitad de turno: el «Mandar ya» entra primero en el turno que sigue (y ahí devuelve su eco).
    else if (m.directo) cola.splice(cola.findLastIndex((x) => x.directo) + 1, 0, m); // detrás de otros directos: conservan su orden
    else cola.push(m);
  }
});
lector.on("close", () => {
  stdinCerrado = true;
  if (!ocupado) terminar(0);
});
