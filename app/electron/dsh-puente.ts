// (También sirve a los líderes de `opencode:<proveedor>/<modelo>`: el mismo puente con `opencode acp` por detrás; el motor sale del prefijo del modelo.)
// El puente de un líder de DeepSeek Harness (`dsh`): un proceso Node que habla el stream-json de `claude -p` por
// stdin/stdout (lo que lider.ts ya maneja: cola, interrupción, estado, fin de turno) y por dentro corre UN `dsh --profile acp`
// vivo por líder, hablándole ACP (acp.ts). Lo lanza lider.ts en lugar de `claude` (como agy-puente.ts con Gemini). Sin Electron.
//
//   node dsh-puente.js --sid <uuid> --nombre <n> --modelo dsh:<proveedor>/<modelo> --cwd <carpeta>
//   HILOS_DSH=<binario>             el `dsh` (default: HILOS_DSH → PATH → ~/.local/bin → prefijo de npm; ver dsh.ts)
//   TRAMA_DSH_PREFACIO=<texto>      lo que se le dice antes del primer mensaje de una sesión nueva (dsh no lee CLAUDE.md)
//   TRAMA_DSH_URL=<url>             otra baseURL para el proveedor (Ollama en otra máquina)
//   TRAMA_DSH_IMAGENES=1            el modelo (de Ollama) acepta imágenes: se declara en el parche
//   TRAMA_DSH_CONTEXTO=<n>          ventana de contexto del modelo de Ollama
//
// Continuidad: la sesión ACP (`session/new` la primera vez) queda en `$HILOS_STATE/dsh/<sid>.json`; al volver (otro puente, otro
// `dsh`) se retoma con `session/resume` —dsh guarda la sesión en su DSH_HOME, con los resultados de cada herramienta—. Si no se
// puede retomar, sesión nueva con lo hablado (del transcript de este puente) como prefacio.
//
// dsh no hace streaming token a token: ACP entrega un bloque entero por paso del modelo (razonamiento, texto, herramienta).
// Eso sale como `thinking` / `text` / `tool_use` / `tool_result` de Claude, con sus `stream_event` de un solo delta.
//
// Escribe además, como Claude Code: su transcript (`$HILOS_STATE/dsh/<sid>.jsonl`, mismo formato que el de agy-puente) y su
// `sessions/<pid>.json` (la barra lo ve vivo; `pa` busca al jefe de un worker subiendo por los padres hasta un pid con ese archivo).
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import { ClienteAcp, ErrorAcp, describirError, type BloqueAcp } from "./acp.ts";
import { entornoAgy } from "./binario.ts";
import { entornoDsh, escribirParche, esErrorCuota, falta, mensajeCuotaOpencode, parsearModelo, resolverDsh, valorModeloAcp } from "./dsh.ts";
import { effortParaAcp, politicaOpencode, entornoOpencode, esErrorCuota as esCuotaOc, mensajeCuotaOpencode as mensajeCuotaOc, parsearModelo as parsearOpencode, resolverOpencode } from "./opencode.ts";
import { leerClavesSync, type NombreClave } from "./claves.ts";
import { deDueno, dueno } from "./dueno.ts";
import { ESTADO } from "./estado.ts";
import { SESIONES } from "./sesiones.ts";

type Obj = Record<string, any>;

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const sid = arg("sid") ?? "";
const nombre = arg("nombre") ?? "";
const modelo = arg("modelo") ?? "";
const cwd = arg("cwd") || process.cwd();
/** El esfuerzo del líder (sólo opencode lo usa: `variant` del modelo por ACP). Cambiarlo relanza el puente (lider.ts), así que vale para toda su vida. */
const effort = arg("effort") ?? "";
const prefacio = process.env.TRAMA_DSH_PREFACIO ?? "";
/** Cuánto de lo hablado se repite si hay que empezar una sesión nueva (caracteres). */
const TOPE_REPETIR = 12000;
/** Lo que se espera a que dsh cierre el turno tras un `session/cancel` antes de matarlo (se retoma la sesión después). */
const MS_CANCELAR = Number(process.env.TRAMA_DSH_CANCELAR_MS ?? 10000);
const EXTENSIONES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** El motor de este puente: `dsh:<proveedor>/<modelo>` (dsh --profile acp) u `opencode:<proveedor>/<modelo>` (opencode acp; mismo puente, otro agente ACP). */
const oc = parsearOpencode(modelo);
const MOTOR = oc ? "opencode" : "dsh";

const DIR = path.join(ESTADO, MOTOR);
const TRANSCRIPT = path.join(DIR, `${sid}.jsonl`);
const LADO = path.join(DIR, `${sid}.json`);
const PARCHE = path.join(DIR, `${sid}.patch.yml`);
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

// --- transcript y sesión de dsh ----------------------------------------------------------------------------------

function anotar(o: Record<string, unknown>) {
  try {
    appendFileSync(TRANSCRIPT, JSON.stringify({ ...o, timestamp: new Date().toISOString(), sessionId: sid, uuid: randomUUID(), cwd, isSidechain: false }) + "\n");
  } catch {
    /* sin transcript la vista sigue con lo del stream */
  }
}

function leerLado(): { acp_session: string | null; contexto: number | null } {
  try {
    const o = JSON.parse(readFileSync(LADO, "utf8"));
    return { acp_session: typeof o?.acp_session === "string" ? o.acp_session : null, contexto: typeof o?.contexto === "number" ? o.contexto : null };
  } catch {
    return { acp_session: null, contexto: null };
  }
}

function guardarLado(acp: string | null, contexto: number | null = leerLado().contexto) {
  try {
    writeFileSync(LADO, JSON.stringify({ version: 1, sid, acp_session: acp, modelo, ...(contexto ? { contexto } : {}) }) + "\n");
  } catch {
    /* se pierde la continuidad por dsh: la próxima vez se repite lo hablado */
  }
}

/** Lo hablado, del transcript propio, en texto: para empezar en una sesión nueva de dsh sin perder el hilo. */
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

// --- las herramientas de dsh como las de Claude -------------------------------------------------------------------

const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Una herramienta de dsh como la de Claude Code que hace lo mismo: el nombre y los campos que la vista sabe leer. */
function herramientaClaude(nombre: string, entrada: unknown): { name: string; input: Obj } {
  const p = (entrada && typeof entrada === "object" ? entrada : {}) as Obj;
  const ruta = texto(p.file_path) ?? texto(p.filePath) ?? texto(p.filepath) ?? texto(p.path);
  const con = (name: string, campos: Obj) => ({ name, input: Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== null && v !== undefined)) });
  switch (nombre) {
    case "bash":
      return con("Bash", { command: texto(p.command), description: texto(p.description) });
    case "read":
      return con("Read", { file_path: ruta });
    case "write":
      return con("Write", { file_path: ruta, content: texto(p.content) });
    case "edit":
      return con("Edit", { file_path: ruta, old_string: texto(p.old_string) ?? texto(p.oldString), new_string: texto(p.new_string) ?? texto(p.newString) });
    case "glob":
      return con("Glob", { pattern: texto(p.pattern), path: texto(p.path) });
    case "grep":
      return con("Grep", { pattern: texto(p.pattern), path: texto(p.path) });
    case "web_fetch":
    case "webfetch":
      return con("WebFetch", { url: texto(p.url) });
    case "web_search":
    case "websearch":
      return con("WebSearch", { query: texto(p.query) });
    case "list":
      return con("LS", { path: ruta });
    case "task":
      return con("Task", { description: texto(p.description), prompt: texto(p.prompt) });
    default:
      return { name: nombre || "?", input: { ...p } };
  }
}

/** Lo que devolvió una herramienta (`tool_call_update.content`) en texto. */
function textoDeContenido(c: unknown): string {
  if (!Array.isArray(c)) return "";
  return c
    .map((x: any) => (typeof x?.content?.text === "string" ? x.content.text : typeof x?.text === "string" ? x.text : x?.type === "diff" && typeof x.path === "string" ? `editado ${x.path}` : ""))
    .filter(Boolean)
    .join("\n");
}

type Uso = { input_tokens: number; output_tokens: number };

/** Traduce los `session/update` de UN turno de dsh a las líneas del stream de Claude. */
class Traductor {
  /** Lo último que dijo `usage_update`: lo que pesa el contexto y la ventana del modelo. */
  usado = 0;
  ventana = 0;
  private buf: { id: string; pensado: string; texto: string; bloque: "" | "thinking" | "text"; indice: number } | null = null;
  private herramientas = new Map<string, { name: string; input: Obj; emitida: boolean; resultado: boolean }>();
  private n = 0;
  private cerrado = false;
  private readonly base = () => ({ parent_tool_use_id: null, session_id: sid });

  private ev(event: Obj): Obj {
    return { type: "stream_event", event, ...this.base() };
  }

  private uso(): Uso | null {
    return this.usado ? { input_tokens: this.usado, output_tokens: 0 } : null;
  }

  /** Un `session/update` → las líneas de Claude. */
  actualizacion(u: Obj): Obj[] {
    switch (u.sessionUpdate) {
      case "agent_thought_chunk":
        return this.trozo(u, "thinking");
      case "agent_message_chunk":
        return this.trozo(u, "text");
      case "tool_call":
        return this.llamada(u);
      case "tool_call_update":
        return this.resultado(u);
      case "usage_update":
        if (typeof u.used === "number") this.usado = u.used;
        if (typeof u.size === "number") this.ventana = u.size;
        return [];
      default:
        return []; // config_option_update y lo que venga
    }
  }

  private trozo(u: Obj, tipo: "thinking" | "text"): Obj[] {
    const t = typeof u.content?.text === "string" ? u.content.text : "";
    if (!t) return [];
    const out: Obj[] = [];
    const id = texto(u.messageId) ?? `m${++this.n}`;
    if (this.buf && this.buf.id !== id) out.push(...this.vaciar());
    if (!this.buf) {
      this.buf = { id, pensado: "", texto: "", bloque: "", indice: -1 };
      out.push(this.ev({ type: "message_start", message: { id: `msg_dsh_${id}`, usage: { input_tokens: this.usado, output_tokens: 0 } } }));
    }
    const b = this.buf;
    if (b.bloque !== tipo) {
      if (b.bloque) out.push(this.ev({ type: "content_block_stop", index: b.indice }));
      b.bloque = tipo;
      b.indice++;
      out.push(this.ev({ type: "content_block_start", index: b.indice, content_block: tipo === "thinking" ? { type: "thinking", thinking: "" } : { type: "text", text: "" } }));
    }
    if (tipo === "thinking") b.pensado += t;
    else b.texto += t;
    out.push(this.ev({ type: "content_block_delta", index: b.indice, delta: tipo === "thinking" ? { type: "thinking_delta", thinking: t } : { type: "text_delta", text: t } }));
    return out;
  }

  /** Cierra el mensaje en curso (razonamiento + texto del mismo paso) como un `assistant` entero. */
  private vaciar(): Obj[] {
    const b = this.buf;
    if (!b) return [];
    this.buf = null;
    const out: Obj[] = [];
    if (b.bloque) out.push(this.ev({ type: "content_block_stop", index: b.indice }));
    const pensado = b.pensado.trim();
    const dicho = b.texto.replace(/\s+$/, "");
    if (pensado || dicho) {
      const u = this.uso();
      out.push({
        type: "assistant",
        message: { id: `msg_dsh_${b.id}`, role: "assistant", model: modelo, content: [...(pensado ? [{ type: "thinking", thinking: pensado }] : []), ...(dicho ? [{ type: "text", text: dicho }] : [])], ...(u ? { usage: u } : {}) },
        ...this.base(),
      });
    }
    out.push(this.ev({ type: "message_stop" }));
    return out;
  }

  /**
   * dsh manda el `tool_call` con la entrada completa. opencode lo manda con el nombre de la herramienta (`title: "bash"`) y sólo el
   * `cwd` en `rawInput`: la entrada llega en los `tool_call_update` siguientes (donde el `title` pasa a ser el comando). Por eso la
   * herramienta de opencode se anuncia recién cuando trae su entrada (o al terminar), con el nombre del primer aviso.
   */
  private llamada(u: Obj): Obj[] {
    const id = texto(u.toolCallId);
    if (!id || this.herramientas.has(id)) return [];
    const out = this.vaciar();
    const t = herramientaClaude(texto(u.title) ?? "?", u.rawInput);
    this.herramientas.set(id, { name: texto(u.title) ?? "?", input: u.rawInput && typeof u.rawInput === "object" ? u.rawInput : {}, emitida: false, resultado: false });
    if (!oc || this.conEntrada(u.rawInput)) out.push(...this.anunciar(id, t));
    return out;
  }

  private conEntrada = (raw: unknown) => !!raw && typeof raw === "object" && Object.keys(raw as Obj).some((k) => k !== "cwd");

  /** El `tool_use` de la herramienta `id` (una sola vez), con el nombre y la entrada que se le conocen hasta ahora. */
  private anunciar(id: string, t?: { name: string; input: Obj }): Obj[] {
    const h = this.herramientas.get(id);
    if (!h || h.emitida) return [];
    h.emitida = true;
    const c = t ?? herramientaClaude(h.name, h.input);
    return [
      this.ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: c.name, input: {} } }),
      { type: "assistant", message: { id: `msg_dsh_t_${id}`, role: "assistant", model: modelo, content: [{ type: "tool_use", id, name: c.name, input: c.input }] }, ...this.base() },
    ];
  }

  private resultado(u: Obj): Obj[] {
    const id = texto(u.toolCallId);
    const h = id ? this.herramientas.get(id) : undefined;
    if (!id || !h || h.resultado) return [];
    const terminada = u.status === "completed" || u.status === "failed";
    if (u.rawInput && typeof u.rawInput === "object") h.input = { ...h.input, ...u.rawInput };
    if (!terminada) return oc && this.conEntrada(h.input) ? this.anunciar(id) : [];
    const out = this.anunciar(id);
    h.resultado = true;
    const malo = u.status === "failed";
    let contenido = textoDeContenido(u.content);
    if (!contenido && typeof u.rawOutput?.output === "string") contenido = u.rawOutput.output;
    contenido = contenido.replace(/^Error: /, malo ? "Error: " : "");
    out.push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: contenido, ...(malo ? { is_error: true } : {}) }] }, ...this.base() });
    return out;
  }

  /** Se cortó el turno con herramientas a medias: cada una queda cerrada con un error, para que el chat no la muestre corriendo. */
  cerrarAbiertas(motivo: string): Obj[] {
    const out = this.vaciar();
    for (const [id, h] of this.herramientas) {
      if (h.resultado) continue;
      out.push(...this.anunciar(id));
      h.resultado = true;
      out.push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: motivo, is_error: true }] }, ...this.base() });
    }
    return out;
  }

  /** El `result` del turno (o su error). */
  fin(error: string | null, duracionMs: number): Obj[] {
    if (this.cerrado) return [];
    this.cerrado = true;
    return [
      ...this.cerrarAbiertas(error ?? "El turno terminó antes de que esta herramienta contestara."),
      {
        type: "result",
        subtype: error ? "error_during_execution" : "success",
        is_error: !!error,
        result: error ?? "",
        duration_ms: duracionMs,
        num_turns: 1,
        usage: { input_tokens: this.usado, output_tokens: 0 },
        modelUsage: { [modelo]: { contextWindow: this.ventana || 262144 } },
        ...this.base(),
      },
    ];
  }
}

// --- dsh ---------------------------------------------------------------------------------------------------------

type Imagen = { tipo: string; datos: string };
/** Un mensaje de la persona: el texto, sus imágenes y si es un «Mandar ya» (`trama_directo`: entra a mitad del turno). */
type Mensaje = { texto: string; imagenes: Imagen[]; directo: boolean };

function mensajeDeUsuario(o: any): Mensaje {
  const c = o?.message?.content;
  const directo = o?.trama_directo === true;
  if (typeof c === "string") return { texto: c, imagenes: [], directo };
  if (!Array.isArray(c)) return { texto: "", imagenes: [], directo };
  const t = c.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("\n");
  const imagenes: Imagen[] = c
    .filter((b: any) => b?.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string" && EXTENSIONES.has(String(b.source.media_type)))
    .map((b: any) => ({ tipo: String(b.source.media_type), datos: b.source.data }));
  return { texto: t, imagenes, directo };
}

const salida = (o: Record<string, any>) => {
  salir(o);
  if (o.type === "assistant" || (o.type === "user" && Array.isArray(o.message?.content) && o.message.content[0]?.type === "tool_result")) anotar({ type: o.type, message: o.message });
};

const eco = (t: string) => salir({ type: "user", isReplay: true, parent_tool_use_id: null, session_id: sid, message: { role: "user", content: [{ type: "text", text: t }] } });

const NOTA_DIRECTO = () => `[Mensaje ${deDueno()} a mitad del turno, mientras trabajabas: tenelo en cuenta y seguí con lo que estabas haciendo si no dice otra cosa.]`;

const prov = parsearModelo(modelo);
let cliente: ClienteAcp | null = null;
/** El stderr del `dsh` que no arrancó bien (se descarta el cliente, pero el error que sube todavía lo necesita). */
let stderrPerdido = "";
let acpSid: string | null = null;
/** El turno en curso (para traducir lo que dsh va diciendo). */
let actual: Traductor | null = null;
let iniciando: Promise<void> | null = null;
/** Se abrió una sesión de dsh nueva y todavía no se le dio el prefacio (ni lo hablado, si se perdió la anterior). */
let faltaPrefacio = false;

/** La key (de claves.env) que usa el proveedor, si usa una. */
const claveDelProveedor = (): NombreClave | null => (prov?.proveedor === "opencode" ? "OPENCODE_API_KEY" : prov?.proveedor === "deepseek" ? "DEEPSEEK_API_KEY" : null);
/** Lo que decía claves.env cuando arrancó este puente (lider.ts la puso en el entorno si no había otra): para saber si el valor del entorno era esa. */
let guardadaAlArrancar: string | undefined = claveDelProveedor() ? leerClavesSync()[claveDelProveedor()!] : undefined;
/** La key con que se lanzó el `dsh` vivo (`""`: ninguna). */
let claveLevantada = "";

/**
 * Una key guardada, cambiada o borrada en Ajustes mientras el líder vive tiene que valer en el próximo turno: se vuelve a leer claves.env
 * y, si cambió la del proveedor, se descarta el `dsh` (el siguiente `asegurar` lo relanza y retoma la MISMA sesión: la conversación sigue).
 * Una key puesta en el entorno de verdad (distinta de la que había guardada al arrancar) gana, como siempre.
 */
function refrescarClave() {
  const n = claveDelProveedor();
  if (!n) return;
  const hoy = leerClavesSync()[n];
  if (hoy !== guardadaAlArrancar) {
    if (process.env[n] === guardadaAlArrancar) {
      if (hoy) process.env[n] = hoy;
      else delete process.env[n];
    }
    guardadaAlArrancar = hoy;
  }
  if (cliente && claveLevantada !== (process.env[n] ?? "")) {
    cliente.matar();
    cliente = null;
    acpSid = null;
  }
}

/** El `dsh` vivo con su sesión lista (lanzándolo y retomando o abriendo la sesión si hace falta). */
function asegurar(): Promise<void> {
  if (cliente?.activo && acpSid) return Promise.resolve();
  return (iniciando ??= levantar().finally(() => (iniciando = null)));
}

async function levantar(): Promise<void> {
  stderrPerdido = "";
  if (!prov && !oc) throw new Error(`modelo «${modelo}» no es de dsh ni de opencode (dsh:<proveedor>/<modelo>, opencode:<proveedor>/<modelo>)`);
  const env0 = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "CLAUDE_CONFIG_DIR"));
  let env: Record<string, string | undefined>;
  let comando: string;
  let args: string[];
  if (oc) {
    // opencode usa el login y la config de la persona (su HOME/XDG, sin tocarlos): el modelo se elige por ACP después de abrir la sesión.
    env = { ...entornoOpencode(entornoAgy(env0, os.homedir())), PWD: path.resolve(cwd) }; // opencode toma su directorio de PWD
    comando = resolverOpencode(process.env, os.homedir());
    args = ["acp"];
  } else {
    const falto = falta(prov!.proveedor, env0);
    if (falto) throw new Error(`falta ${falto} para usar ${modelo}`);
    claveLevantada = (claveDelProveedor() && process.env[claveDelProveedor()!]) || "";
    env = entornoDsh(prov!.proveedor, entornoAgy(env0, os.homedir()));
    writeFileSync(PARCHE, escribirParche({ ...prov!, baseURL: process.env.TRAMA_DSH_URL || undefined, imagenes: process.env.TRAMA_DSH_IMAGENES === "1", contexto: Number(process.env.TRAMA_DSH_CONTEXTO) || undefined }));
    mkdirSync(env.DSH_HOME!, { recursive: true });
    comando = resolverDsh(process.env, os.homedir());
    args = ["--profile", "acp", "--patch", PARCHE];
  }
  const c = new ClienteAcp({
    comando,
    args,
    cwd,
    env,
    raiz: cwd,
    ...(oc ? { permiso: politicaOpencode(cwd) } : {}),
    alActualizar: (s, u) => {
      if (s !== acpSid || !actual) return;
      for (const o of actual.actualizacion(u)) salida(o);
    },
    alStderr: (t) => process.stderr.write(`${MOTOR}: ${t}`),
  });
  cliente = c;
  acpSid = null;
  try {
    await c.iniciar();
    const lado = leerLado();
    let nueva = true;
    let opciones: Obj[] = [];
    if (lado.acp_session && c.puedeRetomar) {
      try {
        opciones = (await c.retomar(lado.acp_session, cwd)).configOptions;
        acpSid = lado.acp_session;
        nueva = false;
      } catch (e) {
        if (!(e instanceof ErrorAcp)) throw e; // se cayó dsh: eso no es "no hay sesión"
        process.stderr.write(`dsh-puente: no se pudo retomar ${lado.acp_session} (${e.message}): sesión nueva\n`);
      }
    }
    if (!acpSid) {
      const s = await c.nuevaSesion(cwd);
      acpSid = s.sessionId;
      opciones = s.configOptions;
      guardarLado(acpSid);
    }
    // Una sesión retomada trae el modelo con el que se guardó: si el líder cambió de modelo, se le dice.
    const quiero = oc ? oc.valor : valorModeloAcp(prov!.proveedor, prov!.modelo);
    const actualOpt = opciones.find((o) => o?.id === "model")?.currentValue;
    if (actualOpt !== undefined && actualOpt !== quiero) opciones = (await c.configurar(acpSid, "model", quiero)).configOptions;
    // opencode: el esfuerzo es el `variant` del modelo; va DESPUÉS de elegir el modelo (si no, se aplica al de antes). Un modelo que no razona lo
    // rechaza: se avisa por stderr y el turno sigue sin esfuerzo (nunca falla por esto).
    if (oc) {
      const nivel = effortParaAcp(opciones, effort);
      if (nivel) await c.configurar(acpSid, "effort", nivel).catch((e) => process.stderr.write(`opencode: esfuerzo «${nivel}» no aplicado (${String((e as Error)?.message ?? e).slice(0, 200)})\n`));
    }
    faltaPrefacio = faltaPrefacio || nueva;
  } catch (e) {
    stderrPerdido = c.stderr;
    c.matar();
    cliente = null;
    acpSid = null;
    throw e;
  }
}

/**
 * Lo que se le muestra a la persona cuando falla un turno: el error con su causa real (`error.data`, el stderr de dsh) sin claves;
 * y si es de cuota de OpenCode, el mensaje que dice qué hacer (distinto con clave propia que con la pública).
 */
function textoDeError(e: unknown): string {
  const secretos = [process.env.OPENCODE_API_KEY, process.env.DEEPSEEK_API_KEY];
  const err = cliente?.stderr || stderrPerdido;
  if (oc && esCuotaOc(`${String((e as Error)?.message ?? e)}\n${err}`)) return mensajeCuotaOc(oc.valor);
  if (prov?.proveedor === "opencode" && esErrorCuota(`${String((e as Error)?.message ?? e)}\n${err}`)) return mensajeCuotaOpencode(!!process.env.OPENCODE_API_KEY);
  return describirError(e, err, secretos, 400);
}

/** Los bloques del prompt: el texto y las imágenes (si el modelo no las acepta, un aviso en su lugar). */
function bloques(t: string, imagenes: Imagen[]): BloqueAcp[] {
  const out: BloqueAcp[] = [];
  let tx = t;
  if (imagenes.length && !cliente?.aceptaImagenes) {
    tx += `${tx ? "\n" : ""}[${dueno()} adjuntó ${imagenes.length} imagen(es), pero ${modelo} no acepta imágenes: pedile que las describa.]`;
    imagenes = [];
  }
  if (tx.trim()) out.push({ type: "text", text: tx });
  for (const i of imagenes) out.push({ type: "image", data: i.datos, mimeType: i.tipo });
  return out;
}

function conPrefacio(t: string, repetir: string): string {
  const partes = [prefacio];
  if (repetir) partes.push(`Lo que ya hablaron antes de que se perdiera tu sesión interna (los resultados de los comandos no se conservan):\n\n${repetir}`);
  partes.push(`Mensaje ${deDueno()}:\n${t}`);
  return partes.filter(Boolean).join("\n\n---\n\n");
}

// --- un turno ---------------------------------------------------------------------------------------------------

let ocupado = false;
let interrumpido = false;
let stdinCerrado = false;
const cola: Mensaje[] = [];
/** «Mandar ya» pendientes: entran apenas dsh cierra el paso cortado. */
const directos: Mensaje[] = [];
/** Llegó un «Mandar ya»: se cortó el prompt en curso (`session/cancel`) y el turno sigue con ese mensaje. */
let corte = false;
let temporizadorCancelar: NodeJS.Timeout | null = null;

/** `session/cancel`; si dsh no cierra el turno a tiempo se lo mata (la sesión se retoma después). */
function cancelarPrompt() {
  if (!cliente || !acpSid) return;
  cliente.cancelar(acpSid);
  if (temporizadorCancelar) clearTimeout(temporizadorCancelar);
  const c = cliente;
  temporizadorCancelar = setTimeout(() => c.matar(), MS_CANCELAR);
  temporizadorCancelar.unref();
}

function pedirDirecto(m: Mensaje) {
  directos.push(m);
  if (!actual || corte || interrumpido) return; // entre vueltas: sale al terminar el turno; o ya se está cortando
  corte = true;
  cancelarPrompt();
}

function interrumpir() {
  if (!ocupado) return;
  interrumpido = true;
  cancelarPrompt();
}

/** Un `session/prompt` hasta que dsh lo cierra. Devuelve cómo terminó; si se cayó dsh, lanza. */
async function correrPrompt(contenido: BloqueAcp[]): Promise<string> {
  try {
    return (await cliente!.prompt(acpSid!, contenido)).stopReason;
  } finally {
    if (temporizadorCancelar) clearTimeout(temporizadorCancelar);
    temporizadorCancelar = null;
  }
}

/**
 * Los «Mandar ya» pendientes, a la vista (su eco) y al transcript, como el texto que se le manda a dsh: la nota y los mensajes,
 * con `previo` por delante si el prompt anterior no llegó a dsh.
 */
function plegar(previo: string | null, imagenesPrevias: Imagen[]): { texto: string; imagenes: Imagen[] } {
  const lote = directos.splice(0);
  for (const d of lote) eco(d.texto);
  const t = `${NOTA_DIRECTO()}\n${lote.map((d) => d.texto).join("\n\n")}`;
  anotar({ type: "user", message: { role: "user", content: t } });
  return { texto: previo === null ? t : `${previo}\n\n${t}`, imagenes: [...imagenesPrevias, ...lote.flatMap((d) => d.imagenes)] };
}

async function turno(m: Mensaje) {
  ocupado = true;
  interrumpido = false;
  corte = false;
  anotarSesion("busy");
  if (m.directo) eco(m.texto); // llegó sin turno en curso: es un mensaje normal, pero lider.ts espera su eco
  const t0 = Date.now();
  const previo = hablado(); // antes de anotar este mensaje (por si hay que empezar una sesión nueva)
  anotar({ type: "user", message: { role: "user", content: m.imagenes.length ? `${m.texto}\n[${m.imagenes.length} imagen(es) adjunta(s)]`.trim() : m.texto } });
  let tr = (actual = new Traductor());
  tr.usado = leerLado().contexto ?? 0;
  let error: string | null = null;
  try {
    refrescarClave();
    await asegurar();
    let enviado = { texto: faltaPrefacio ? conPrefacio(m.texto, previo) : m.texto, imagenes: m.imagenes };
    faltaPrefacio = false;
    // Un «Mandar ya» que llegó mientras arrancaba dsh (todavía no había qué cancelar) va junto con el mensaje, en el mismo prompt.
    if (corte && !interrumpido) {
      corte = false;
      enviado = plegar(enviado.texto, enviado.imagenes);
    }
    for (;;) {
      const motivo = await correrPrompt(bloques(enviado.texto, enviado.imagenes)).catch((e: Error) => {
        if (corte || interrumpido) return "cancelled"; // lo mató el plazo de cancelar: la sesión se retoma en el próximo turno
        throw e;
      });
      if (corte && !interrumpido) {
        for (const o of tr.cerrarAbiertas("El mensaje que mandaste a mitad del turno cortó este paso.")) salida(o);
        corte = false;
        if (cliente && !cliente.activo) await asegurar();
        enviado = plegar(null, []); // dsh guarda el mensaje cortado: el nuevo va solo
        continue;
      }
      if (motivo === "max_tokens") error = `${modelo} llegó al máximo de tokens de salida y cortó la respuesta.`;
      break;
    }
  } catch (e) {
    error = interrumpido ? null : textoDeError(e);
  }
  actual = null;
  const ultimo = tr;
  for (const o of ultimo.cerrarAbiertas(interrumpido ? "Interrumpido." : (error ?? "El turno terminó antes de que esta herramienta contestara."))) salida(o);
  for (const o of ultimo.fin(error, Date.now() - t0)) salir(o);
  if (ultimo.usado) guardarLado(acpSid ?? leerLado().acp_session, ultimo.usado);
  cerrarTurno();
}

/** `turno` sin que un throw mate el puente: el turno termina con un error que lo dice y el puente sigue atendiendo. */
async function turnoSeguro(m: Mensaje) {
  try {
    await turno(m);
  } catch (e) {
    const motivo = `el puente de dsh falló: ${String((e as Error)?.message ?? e).slice(0, 300)}`;
    process.stderr.write(`dsh-puente: ${motivo}\n`);
    try {
      for (const o of new Traductor().fin(motivo, 0)) salir(o);
    } catch {
      /* ni el aviso se pudo escribir: se sigue igual */
    }
    actual = null;
    cerrarTurno();
  }
}

function cerrarTurno() {
  ocupado = false;
  corte = false;
  anotarSesion("idle");
  // Un «Mandar ya» que no alcanzó a entrar (llegó entre vueltas o con el `result` ya dado) sale primero, como turno propio.
  cola.unshift(...directos.splice(0));
  const siguiente = cola.shift();
  if (siguiente !== undefined) void turnoSeguro(siguiente);
  else if (stdinCerrado) terminar(0);
}

function terminar(codigo: number) {
  limpiar();
  cliente?.matar();
  process.exit(codigo);
}

// --- stdin: el protocolo de claude -------------------------------------------------------------------------------

anotarSesion("idle");
process.on("SIGTERM", () => terminar(143));
process.on("SIGINT", () => {
  if (ocupado) interrumpir();
  else terminar(130);
});
process.on("exit", () => {
  // dsh es hijo directo y no tiene stdin: si el puente se va (exit, SIGTERM, error sin atrapar), no queda huérfano.
  cliente?.matar();
  limpiar();
});
process.on("SIGHUP", () => terminar(129));
process.on("uncaughtException", (e) => {
  process.stderr.write(`dsh-puente: error sin atrapar: ${String((e as Error)?.stack ?? e)}\n`);
  terminar(1);
});
process.on("unhandledRejection", (e) => {
  process.stderr.write(`dsh-puente: promesa rechazada sin atrapar: ${String((e as Error)?.stack ?? e)}\n`);
});

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
        // dsh corre en `workspace-write` (escribe sólo bajo el cwd, sin preguntar); sin comandos ni output styles.
        return respuesta(o.request_id, { commands: [], current_permission_mode: "acceptEdits", available_output_styles: [] });
      case "interrupt":
        interrumpir();
        return respuesta(o.request_id, {});
      case "set_permission_mode":
        return respuesta(o.request_id, { mode: "acceptEdits" });
      default:
        return fallo(o.request_id, `dsh: ${String(q.subtype)} no aplica a un líder de dsh`);
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
