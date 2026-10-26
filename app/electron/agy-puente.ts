// El puente de un líder de Gemini: un proceso Node que habla el stream-json de `claude -p` por stdin/stdout (lo
// que lider.ts ya maneja: cola, interrupción, estado, fin de turno) y por dentro corre `agy` (Antigravity CLI), un
// proceso por turno. Lo lanza lider.ts en lugar de `claude`. Sin Electron.
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
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import { resolverAgy, entornoAgy } from "./binario.ts";
import { comandosPluginAgy, Traductor } from "./agy-stream.ts";
import { deDueno, dueno } from "./dueno.ts";
import { avisoDestrabo, REINTENTOS_MAX, Vigilante, type Bucle, type Senal } from "./destrabar.ts";
import { cerrarDestrabo, registrarDestrabo } from "./destrabar-registro.ts";
import { destrabarModelo, modeloAgy } from "./modelos-config.ts";
import { ESTADO } from "./estado.ts";
import { matarArbol } from "./procesos.ts";
import { SESIONES } from "./sesiones.ts";

/** El `agy` de verdad: bajo la unidad de systemd el PATH no trae `~/.local/bin` y el binario pelado no se encuentra. */
const AGY = resolverAgy(process.env, os.homedir());
/** Con `~/.local/bin` y la carpeta del `pa` en el PATH: es donde el líder de Gemini lo llama para delegar. */
// Sin CLAUDE_CONFIG_DIR: el líder lo hereda para que Claude escriba donde la app lee, pero agy no es Claude.
const ENTORNO = entornoAgy(Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "CLAUDE_CONFIG_DIR")), os.homedir());
/** Lo máximo que agy puede tardar en un turno (`--print-timeout`): un líder que delega espera a sus workers. */
const TIMEOUT_TURNO = process.env.TRAMA_AGY_TIMEOUT ?? "6h";
/** Cuánto de lo hablado se repite si hay que empezar una conversación nueva (caracteres). */
const TOPE_REPETIR = 12000;

/** Donde agy deja el razonamiento de cada conversación (`<id>/.system_generated/logs/transcript_full.jsonl`). */
const BRAIN = process.env.HILOS_AGY_BRAIN ?? path.join(os.homedir(), ".gemini", "antigravity-cli", "brain");

/** El razonamiento de un paso (agy no lo manda por el stream, sí lo escribe en su transcript al cerrar el paso). */
function razonamiento(conversacion: string, paso: number, esperado: boolean): string | null {
  const archivo = path.join(BRAIN, conversacion, ".system_generated", "logs", "transcript_full.jsonl");
  for (let intento = 0; intento < (esperado ? 4 : 1); intento++) {
    if (intento) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
    if (!existsSync(archivo)) continue;
    try {
      for (const l of readFileSync(archivo, "utf8").split("\n")) {
        if (!l.includes('"thinking"')) continue;
        const o = JSON.parse(l);
        if (o?.step_index === paso && typeof o.thinking === "string" && o.thinking.trim()) return o.thinking;
      }
    } catch {
      /* a medio escribir: se reintenta o se sigue sin él */
    }
  }
  return null;
}

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
/** Las imágenes que la persona adjuntó (agy `-p` no las recibe por stdin): archivos que el modelo abre con su herramienta de lectura. */
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

// --- transcript y conversación de agy --------------------------------------------------------------------------

function anotar(o: Record<string, unknown>) {
  try {
    appendFileSync(TRANSCRIPT, JSON.stringify({ ...o, timestamp: new Date().toISOString(), sessionId: sid, uuid: randomUUID(), cwd, isSidechain: false }) + "\n");
  } catch {
    /* sin transcript la vista sigue con lo del stream */
  }
}

function leerLado(): { conversation_id: string | null; contexto: number | null } {
  try {
    const o = JSON.parse(readFileSync(LADO, "utf8"));
    return {
      conversation_id: typeof o?.conversation_id === "string" ? o.conversation_id : null,
      contexto: typeof o?.contexto === "number" ? o.contexto : null,
    };
  } catch {
    return { conversation_id: null, contexto: null };
  }
}

/** `contexto`: lo que pesaba la conversación al terminar el último turno (el "antes" de un `/compact`). */
function guardarLado(id: string, contexto: number | null = leerLado().contexto) {
  try {
    writeFileSync(LADO, JSON.stringify({ version: 1, sid, conversation_id: id, modelo, ...(contexto ? { contexto } : {}) }) + "\n");
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
const cola: Mensaje[] = [];
let stdinCerrado = false;

const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

type Imagen = { tipo: string; datos: string };
/** Un mensaje de la persona: el texto, sus imágenes y si es un «Mandar ya» (`trama_directo`: entra a mitad del turno). */
type Mensaje = { texto: string; imagenes: Imagen[]; directo: boolean };

/** Lo que dice un mensaje de usuario de Claude: el texto y las imágenes (bloques `image` con base64). */
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

let nImagen = 0;

/** Borra las imágenes de los turnos anteriores (y la carpeta, al salir). */
function limpiarImagenes() {
  try {
    rmSync(DIR_IMAGENES, { recursive: true, force: true });
  } catch {
    /* ya no estaba */
  }
}

/** El texto del mensaje más, por cada imagen, el archivo donde quedó: agy las lee con `view_file` como cualquier otro. */
function textoConImagenes(m: Mensaje): string {
  if (!m.imagenes.length) return m.texto;
  const lineas: string[] = [];
  try {
    mkdirSync(DIR_IMAGENES, { recursive: true, mode: 0o700 });
    for (const i of m.imagenes) {
      const ruta = path.join(DIR_IMAGENES, `img-${++nImagen}.${EXTENSION[i.tipo]}`);
      writeFileSync(ruta, Buffer.from(i.datos, "base64"), { mode: 0o600 });
      lineas.push(`[${dueno()} adjuntó una imagen: ${ruta} — abrila con tu herramienta para leer archivos (view_file) para verla.]`);
    }
  } catch (e) {
    lineas.push(`[${dueno()} adjuntó ${m.imagenes.length} imagen(es), pero no se pudieron guardar para que las veas (${(e as Error).message}); pedile que las describa.]`);
  }
  return [m.texto, ...lineas].filter((x) => x.trim()).join("\n");
}

/** «Mandar ya» pendientes: se entregan en el próximo límite de paso de agy (o a los `MS_DIRECTO`). */
const directos: Mensaje[] = [];
/** Cuánto se espera un límite de paso antes de cortar a agy igual. */
const MS_DIRECTO = Number(process.env.TRAMA_AGY_DIRECTO_MS ?? 5000);
const NOTA_DIRECTO = () => `[Mensaje ${deDueno()} a mitad del turno, mientras trabajabas: tenelo en cuenta y seguí con lo que estabas haciendo si no dice otra cosa.]`;
let temporizadorDirecto: NodeJS.Timeout | null = null;
let actual: { v: Vuelta; tr: Traductor } | null = null;

/** El eco que lider.ts espera de un «Mandar ya» (lo mismo que `--replay-user-messages` en Claude): el mensaje ya llegó al modelo. */
function eco(texto: string) {
  salir({ type: "user", isReplay: true, parent_tool_use_id: null, session_id: sid, message: { role: "user", content: [{ type: "text", text: texto }] } });
}

function cortarPorDirecto(v: Vuelta) {
  if (v.corte || v.bucle || v.exito !== null || interrumpido || !directos.length) return;
  v.corte = true;
  if (temporizadorDirecto) clearTimeout(temporizadorDirecto);
  temporizadorDirecto = null;
  cortarGrupo();
}

/** Entre dos pasos (ninguno abierto) y con la conversación ya conocida, el mensaje puede entrar sin perder nada. */
function intentarCorte(v: Vuelta, tr: Traductor) {
  if (!directos.length || v.abiertos.size || !tr.conversacion) return;
  cortarPorDirecto(v);
}

function pedirDirecto(m: Mensaje) {
  directos.push(m);
  if (!actual) return; // entre vueltas: sale al terminar el turno
  intentarCorte(actual.v, actual.tr);
  if (!temporizadorDirecto && !actual.v.corte)
    temporizadorDirecto = setTimeout(() => {
      temporizadorDirecto = null;
      if (actual) cortarPorDirecto(actual.v);
    }, MS_DIRECTO);
}

type Vuelta = {
  pasos: number;
  /** Se pidió retomar una conversación y agy no la tenía: el turno no avanzó y no se dijo nada (se repite en una nueva). */
  sinConversacion: boolean;
  conversacion: boolean;
  /** El vigilante vio un bucle y se cortó a agy: el turno sigue (sin `result`) con el aviso de destrabar. */
  bucle: Bucle | null;
  /** Cómo terminó esta vuelta: `true` con un `result` SUCCESS, `false` con otro o con un error, `null` si no se sabe (la cortaron). */
  exito: boolean | null;
  /** Llegó un «Mandar ya» y se cortó a agy en un límite de paso: el turno sigue (sin `result`) con ese mensaje, en la misma conversación. */
  corte: boolean;
  /** Pasos (herramienta o respuesta) empezados y todavía no terminados. */
  abiertos: Set<string>;
};

/** Quien mira el turno en curso (`null`: «Destrabar solo cuando se repite» apagado para este modelo). */
let vigilante: Vigilante | null = null;

function correrAgy(prompt: string, conversacion: string | null, tr: Traductor): Promise<Vuelta> {
  return new Promise((ok) => {
    const args = ["-p", prompt, "--model", modeloAgy(modelo), "--output-format", "stream-json", "--dangerously-skip-permissions", "--print-timeout", TIMEOUT_TURNO];
    if (conversacion) args.push("--conversation", conversacion);
    // Su propio grupo: al interrumpir caen también los comandos que lanzó.
    const p = spawn(AGY, args, { cwd, env: ENTORNO, stdio: ["ignore", "pipe", "pipe"], detached: true, windowsHide: true });
    hijo = p;
    const v: Vuelta = { pasos: 0, sinConversacion: false, conversacion: !!conversacion, bucle: null, exito: null, corte: false, abiertos: new Set() };
    actual = { v, tr };
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
      if (actual?.v === v) actual = null;
      if (v.corte) {
        for (const o of tr.cerrarAbiertas("El mensaje que mandaste a mitad del turno cortó este paso.")) escribir(o);
        return ok(v);
      }
      if (v.bucle) {
        // Lo cortó trama: no hay `result` (el turno sigue con el aviso); lo que quedó a medias se cierra con un error.
        for (const o of tr.cerrarAbiertas("Trama cortó este paso: se repetía.")) escribir(o);
        return ok(v);
      }
      const mal = motivo !== null || !!codigo;
      if (v.conversacion && !v.pasos && (mal || v.sinConversacion) && !interrumpido) {
        v.sinConversacion = true;
        return ok(v);
      }
      const dijo = stderr.trim().split("\n").slice(-2).join(" · ");
      const error = interrumpido ? null : (motivo ?? (codigo ? `agy salió con el código ${codigo}${dijo ? `: ${dijo}` : ""}` : null));
      if (error) v.exito = false;
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
  if (v.bucle || v.corte) return;
  if (o?.event === "step_update" && ["agent_response", "tool"].includes(o.step_update?.step_type)) {
    const k = String(o.step_update.step_index);
    if (o.step_update.state === "DONE") v.abiertos.delete(k);
    else v.abiertos.add(k);
  }
  if (o?.event === "result") v.exito = o.result?.status === "SUCCESS";
  if (o?.event === "step_update" && ["agent_response", "tool", "checkpoint"].includes(o.step_update?.step_type)) v.pasos++;
  // Retomando y sin un solo paso, un `result` que no es SUCCESS es "no hay tal conversación": no se muestra, se repite.
  if (o?.event === "result" && v.conversacion && !v.pasos && o.result?.status !== "SUCCESS") {
    v.sinConversacion = true;
    return;
  }
  const antes = tr.conversacion;
  for (const x of tr.linea(o)) {
    escribir(x);
    const b = vigilar(x);
    if (b && !v.bucle) {
      v.bucle = b;
      cortarGrupo();
    }
  }
  if (tr.conversacion && tr.conversacion !== antes) guardarLado(tr.conversacion);
  if (!v.bucle) intentarCorte(v, tr);
}

/** Lo que salió al stream → lo que mira el vigilante (llamadas, lo que devolvieron y los mensajes enteros). */
function vigilar(o: Record<string, any>): Bucle | null {
  if (!vigilante) return null;
  const c = o.message?.content;
  if (!Array.isArray(c)) return null;
  let b: Bucle | null = null;
  for (const bloque of c) {
    let s: Senal | null = null;
    if (o.type === "assistant" && bloque?.type === "tool_use") s = { tipo: "llamada", id: String(bloque.id), nombre: String(bloque.name), entrada: bloque.input };
    else if (o.type === "assistant" && bloque?.type === "text" && typeof bloque.text === "string") s = { tipo: "texto", texto: bloque.text };
    else if (o.type === "user" && bloque?.type === "tool_result")
      s = { tipo: "resultado", id: String(bloque.tool_use_id), texto: typeof bloque.content === "string" ? bloque.content : JSON.stringify(bloque.content ?? ""), error: !!bloque.is_error };
    if (s) b = vigilante.ver(s) ?? b;
  }
  return b;
}

/** Sale al stream y, lo que es de la conversación, al transcript. */
function escribir(o: Record<string, any>) {
  salir(o);
  if (o.type === "system" && o.subtype === "compact_boundary")
    anotar({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: o.compact_metadata?.trigger, preTokens: o.compact_metadata?.pre_tokens } });
  else if (o.type === "assistant" || (o.type === "user" && Array.isArray(o.message?.content) && o.message.content[0]?.type === "tool_result"))
    anotar({ type: o.type, message: o.message });
}

/** Lo que se le manda a agy: el prefacio, lo hablado si la conversación es nueva y el mensaje. */
function conPrefacio(t: string, repetir: string) {
  const partes = [prefacio];
  if (repetir) partes.push(`Lo que ya hablaron antes de que se perdiera tu conversación interna (los resultados de los comandos no se conservan):\n\n${repetir}`);
  partes.push(`Mensaje ${deDueno()}:\n${t}`);
  const cuerpo = partes.filter(Boolean).join("\n\n---\n\n");
  const cmd = /^\/(\S+)/.exec(t.trim())?.[1];
  return cmd && (prefacio || repetir) ? `/${cmd}\n\n${cuerpo}` : cuerpo;
}

/**
 * Corre una vuelta de agy y, mientras la haya cortado un «Mandar ya», sigue con ese mensaje en la misma conversación de agy
 * (una vuelta nueva, un `Traductor` nuevo y ningún `result` en el medio: para el chat es un solo turno).
 */
async function conDirectos(v: Vuelta, tr: Traductor): Promise<{ v: Vuelta; tr: Traductor }> {
  while (v.corte && !interrumpido) {
    const conversacion = tr.conversacion ?? leerLado().conversation_id;
    const lote = directos.splice(0);
    if (!lote.length) break;
    const previo = conversacion ? "" : hablado();
    for (const m of lote) eco(m.texto);
    const t = `${NOTA_DIRECTO()}\n${lote.map(textoConImagenes).join("\n\n")}`;
    anotar({ type: "user", message: { role: "user", content: t } });
    tr = new Traductor({ sid, modelo, contextoPrevio: leerLado().contexto, pensamiento: razonamiento });
    tr.conversacion = conversacion;
    v = await correrAgy(conversacion ? t : conPrefacio(t, previo), conversacion, tr);
  }
  if (v.corte) for (const o of tr.fin(null)) escribir(o); // lo cortaron (parar) justo entonces
  return { v, tr };
}

async function turno(m: Mensaje) {
  ocupado = true;
  interrumpido = false;
  anotarSesion("busy");
  if (m.directo) eco(m.texto); // llegó sin turno en curso: es un mensaje normal, pero lider.ts espera su eco
  limpiarImagenes();
  const texto = textoConImagenes(m);
  const lado = leerLado();
  // Lo hablado hasta ahora, antes de anotar este mensaje (por si hay que empezar una conversación nueva).
  const previo = hablado();
  anotar({ type: "user", message: { role: "user", content: texto } });
  // `/compact` solo (o con un mensaje detrás): agy compacta de verdad la conversación. Sin conversación no hay qué compactar.
  const compactar = /^\/compact(?:\s|$)/i.test(texto.trim());
  const tr = new Traductor({ sid, modelo, compactar, contextoPrevio: lado.contexto, pensamiento: razonamiento });
  tr.conversacion = lado.conversation_id;
  if (compactar && !lado.conversation_id && texto.trim().toLowerCase() === "/compact") {
    for (const o of tr.fin(null)) escribir(o);
    return cerrarTurno();
  }
  for (const o of tr.inicio()) escribir(o);
  vigilante = destrabarModelo(modelo) ? new Vigilante() : null;
  let { v, tr: ultimo } = await conDirectos(await correrAgy(lado.conversation_id ? texto : conPrefacio(texto, previo), lado.conversation_id, tr), tr);
  if (v.sinConversacion && !interrumpido) {
    // agy no encontró la conversación: una nueva con lo hablado.
    const nuevo = new Traductor({ sid, modelo, compactar, contextoPrevio: lado.contexto, pensamiento: razonamiento });
    ({ v, tr: ultimo } = await conDirectos(await correrAgy(conPrefacio(texto, previo), null, nuevo), nuevo));
  }
  ultimo = await destrabar(v, ultimo);
  vigilante = null;
  recordarContexto(ultimo);
  cerrarTurno();
}

/**
 * `turno` sin que un throw (un archivo que no se puede escribir, un evento raro de agy) mate el puente: se corta lo que
 * haya corriendo, el turno termina con un error que lo dice y el puente sigue atendiendo los mensajes que vengan.
 */
async function turnoSeguro(m: Mensaje) {
  try {
    await turno(m);
  } catch (e) {
    const motivo = `el puente de Gemini falló: ${String((e as Error)?.message ?? e).slice(0, 300)}`;
    process.stderr.write(`agy-puente: ${motivo}\n`);
    try {
      interrumpido = true;
      cortarGrupo();
      vigilante = null;
      const tr = actual?.tr ?? new Traductor({ sid, modelo, contextoPrevio: null, pensamiento: razonamiento });
      for (const o of tr.fin(motivo)) escribir(o);
    } catch {
      /* ni el aviso se pudo escribir: se sigue igual */
    }
    actual = null;
    cerrarTurno();
  }
}

/** Lo que pesa la conversación al terminar el turno; tras compactar, lo que pesa ahora (o nada hasta que conteste). */
function recordarContexto(tr: Traductor) {
  if (tr.conversacion && (tr.contexto || tr.compactado)) guardarLado(tr.conversacion, tr.contexto || null);
}

function cerrarTurno() {
  ocupado = false;
  anotarSesion("idle");
  if (temporizadorDirecto) clearTimeout(temporizadorDirecto);
  temporizadorDirecto = null;
  // Un «Mandar ya» que no alcanzó a entrar (llegó entre vueltas o con el `result` ya dado) sale primero, como turno propio.
  cola.unshift(...directos.splice(0));
  const siguiente = cola.shift();
  if (siguiente !== undefined) void turnoSeguro(siguiente);
  else if (stdinCerrado) terminar(0);
}

/** TERM al grupo de agy y, 3 s después, KILL (caen también los comandos que lanzó). */
function cortarGrupo() {
  if (!hijo?.pid) return;
  const pid = hijo.pid;
  matarArbol(pid, "SIGTERM");
  setTimeout(() => matarArbol(pid, "SIGKILL"), 3000).unref();
}

function interrumpir() {
  if (!hijo?.pid) return;
  interrumpido = true;
  cortarGrupo();
}

/**
 * «Destrabar solo cuando se repite»: mientras la última vuelta se haya cortado por un bucle, se anota la marca del chat
 * (`system/trama_destrabo`), se cuenta en el registro y se le manda el aviso a la misma conversación. A los
 * `REINTENTOS_MAX` avisos del turno se para y el turno termina con un error que lo dice. Cada destrabo se cierra con
 * cómo terminó el turno: bien, mal (volvió a trabarse o falló) o cortado (lo interrumpió la persona).
 */
async function destrabar(primera: Vuelta, trPrimera: Traductor): Promise<Traductor> {
  let v = primera;
  let tr = trPrimera;
  let intento = 0;
  const abiertos: string[] = [];
  while (v.bucle && !interrumpido) {
    const b = v.bucle;
    const agotado = intento >= REINTENTOS_MAX;
    anotar({ type: "system", subtype: "trama_destrabo", que: b.que, clase: b.clase, veces: b.veces, intento: intento + 1, ...(agotado ? { agotado: true } : {}) });
    if (agotado) {
      for (const id of abiertos.splice(0)) cerrarDestrabo(id, "mal");
      for (const o of tr.fin(`Gemini sigue repitiendo ${b.que}: trama lo destrabó ${REINTENTOS_MAX} veces y paró. Decile qué lo frena o cortalo.`)) escribir(o);
      return tr;
    }
    intento++;
    abiertos.push(registrarDestrabo(modelo, b.que));
    vigilante?.reiniciar();
    const conversacion = tr.conversacion ?? leerLado().conversation_id;
    tr = new Traductor({ sid, modelo, contextoPrevio: leerLado().contexto });
    tr.conversacion = conversacion;
    ({ v, tr } = await conDirectos(await correrAgy(avisoDestrabo(b.que, intento), conversacion, tr), tr));
  }
  // Sin bucle: el turno terminó (o lo cortaron). El último destrabo cuenta por cómo terminó; los de antes, no sirvieron.
  if (v.bucle && interrumpido) for (const o of tr.fin(null)) escribir(o);
  const ultimoId = abiertos.pop();
  for (const id of abiertos) cerrarDestrabo(id, "mal");
  if (ultimoId) cerrarDestrabo(ultimoId, interrumpido ? "cortado" : v.exito ? "bien" : "mal");
  return tr;
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
  // agy corre en su propio grupo (detached): si el puente se va (exit, SIGTERM, error sin atrapar), no queda huérfano hasta el tope de 6 h.
  matarArbol(hijo?.pid, "SIGKILL");
  limpiar();
  limpiarImagenes();
});
process.on("SIGHUP", () => terminar(129));
process.on("uncaughtException", (e) => {
  process.stderr.write(`agy-puente: error sin atrapar: ${String((e as Error)?.stack ?? e)}\n`);
  terminar(1);
});
process.on("unhandledRejection", (e) => {
  process.stderr.write(`agy-puente: promesa rechazada sin atrapar: ${String((e as Error)?.stack ?? e)}\n`);
});

let comandosCache: ReturnType<typeof comandosPluginAgy> | null = null;
function comandosDeAgy() {
  if (comandosCache) return comandosCache;
  try {
    const out = execFileSync(AGY, ["plugin", "list", "--json"], { env: ENTORNO, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
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
    const m = mensajeDeUsuario(o);
    if (!m.texto.trim() && !m.imagenes.length) return;
    if (!ocupado) void turnoSeguro(m);
    else if (m.directo) pedirDirecto(m);
    else cola.push(m);
  }
});
lector.on("close", () => {
  stdinCerrado = true;
  if (!ocupado) terminar(0);
});
