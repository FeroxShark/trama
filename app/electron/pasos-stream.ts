// Los pasos de un worker que NO es de Claude (agy, opencode, codex, dsh), armados desde su `<id>.stream.jsonl`: lo mismo que
// `ArmadorPasos` (electron/pasos.ts) hace con el transcript de Claude Code, para que la vista de worker (tarjeta del paso en
// curso con su reloj, tira de colores, lista de pasos, panel con la salida del comando) sea una sola. Tiene la misma forma
// por fuera (`gen`, `v`, `leer`, `vista`, `cambio`) y lo usa `pasos-worker.ts` cuando no hay transcript.
//
// Lo que cada motor trae (y por lo tanto lo que se puede mostrar):
//  - agy: `step_update` por paso. Un paso de herramienta llega ACTIVE (empezó) y DONE/ERROR (con `duration_seconds` y la salida);
//    un `agent_response` sin texto es el modelo pensando (con su duración y sus tokens); con `text_delta`, un mensaje. NO trae hora
//    por línea: la hora de cada paso se arma sumando las duraciones desde el arranque del worker (`inicio`), y al leer en vivo
//    (el archivo se acaba de escribir) el paso que está corriendo se ancla a la hora real, así el reloj de la tarjeta no se corre.
//  - opencode: hora real (`timestamp`, `part.state.time`) y una sola línea por herramienta (ya con su salida).
//  - codex y dsh: sin hora ni duración; sólo se pone hora a lo que aparece mientras se lee en vivo, el resto queda sin hora
//    (la tira lo apoya en el paso anterior).
// Sin Electron: lo prueba `tests/pasos-stream.test.ts` con un stream de agy con la forma real.
import { stat } from "node:fs/promises";
import { ColaDeLineas, TOPES, contarDiff, cortar, encabezadoVacio, lineasDe, type Cambio, type CambioPasos, type Detalle, type Encabezado, type Paso, type VistaPasos, type ArchivoTocado } from "./pasos.ts";
import { sumaVacia, totalDe, type Suma } from "./transcripts.ts";

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const str = (x: unknown): string => (typeof x === "string" ? x : "");
const nat = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
const una = (s: string, tope: number): string => {
  const l = s.trim().split("\n", 1)[0] ?? "";
  return l.length > tope ? `${l.slice(0, tope - 1)}…` : l;
};
const primero = (e: Record<string, unknown>, claves: string[]): string => {
  for (const k of claves) if (typeof e[k] === "string" && e[k]) return e[k] as string;
  return "";
};
/** Lo que un resultado trae como texto: cadena, o lo que se pueda serializar. */
const textoDe = (x: unknown): string => {
  if (typeof x === "string") return x;
  if (x === null || x === undefined) return "";
  try {
    return JSON.stringify(x);
  } catch {
    return "";
  }
};

/** Que un archivo se haya escrito hace menos de esto es "se está escribiendo ahora": ahí la hora real de la línea es la del archivo. */
const FRESCO_MS = 5000;

type Categoria = "correr" | "leer" | "buscar" | "editar" | "escribir" | "otro";
/** De qué clase es una herramienta, por su nombre (agy, opencode, codex y dsh las llaman distinto). */
export function categoriaDe(nombre: string): Categoria {
  const n = nombre.toLowerCase();
  if (/^(run_command|bash|shell|command|exec|execute|terminal)$/.test(n)) return "correr";
  if (/^(read_file|view_file|view_file_outline|read|list_dir|ls|list)$/.test(n)) return "leer";
  if (/^(grep_search|grep|find_by_name|glob|find|search|search_web|read_url_content|webfetch|websearch|web_search)$/.test(n)) return "buscar";
  if (/^(edit_file|replace_file_content|multi_replace_file_content|edit|multiedit|sed_file|apply_patch|patch|file_change)$/.test(n)) return "editar";
  if (/^(write_to_file|write_file|write)$/.test(n)) return "escribir";
  return "otro";
}

/** La ruta de una herramienta de archivos, según cómo la llame cada motor. */
const rutaDe = (e: Record<string, unknown>): string => primero(e, ["AbsolutePath", "TargetFile", "FilePath", "File", "Path", "file_path", "filePath", "path", "DirectoryPath", "directory"]);
const comandoDe = (e: Record<string, unknown>): string => primero(e, ["CommandLine", "Command", "command", "cmd"]);

/** El código y la salida de lo que contestó un comando de agy ("Command exited with code N.\n\nCommand output:\n…"). */
export function salidaDeComando(out: string): { codigo: number | null; salida: string } {
  const limpio = out.replace(/\r\n/g, "\n");
  const m = /Command exited with code (-?\d+)\.\s*\n\s*Command output:\n?/.exec(limpio);
  if (!m) return { codigo: null, salida: limpio };
  return { codigo: Number(m[1]), salida: limpio.slice(m.index + m[0].length) };
}

/** Lo que dice una línea del stream, ya sin saber de qué motor es. */
type Evento =
  | { e: "init"; cwd: string | null; modelo: string | null }
  | { e: "uso"; uso: Suma; turno: boolean }
  | { e: "texto"; clave: string; delta: string; hecho: boolean; dur: number | null; hora: number | null }
  | { e: "pensar"; dur: number | null; hora: number | null; texto: string | null }
  | { e: "herr"; clave: string; nombre: string; entrada: Record<string, unknown>; hora: number | null }
  | { e: "res"; clave: string; nombre: string; entrada: Record<string, unknown>; salida: string; error: string | null; dur: number | null; hora: number | null }
  | { e: "pausa"; dur: number }
  | { e: "falla"; texto: string };

const uso = (entrada: unknown, salida: unknown, cache: unknown, creado: unknown): Suma => ({ entrada: nat(entrada) ?? 0, cacheCreado: nat(creado) ?? 0, cacheLeido: nat(cache) ?? 0, salida: nat(salida) ?? 0 });

/** Una línea de agy (`event`). */
function deAgy(o: Record<string, unknown>): Evento[] {
  if (o.event === "init") {
    const i = obj(o.init);
    return [{ e: "init", cwd: str(i?.cwd) || null, modelo: str(i?.model) || null }];
  }
  if (o.event === "result") {
    const r = obj(o.result);
    if (str(r?.status) === "SUCCESS" || !r) return [];
    return [{ e: "falla", texto: `agy: ${una(textoDe(r.error) || str(r.status), TOPES.error)}` }];
  }
  if (o.event !== "step_update") return [];
  const s = obj(o.step_update);
  if (!s) return [];
  const idx = `${str(s.conversation_id)}:${String(s.step_index ?? "")}`;
  const durS = nat(s.duration_seconds);
  const dur = durS !== null ? Math.round(durS * 1000) : null;
  const hecho = s.state === "DONE" || s.state === "ERROR";
  if (s.step_type === "agent_response") {
    const u = obj(s.usage);
    const r: Evento[] = [{ e: "texto", clave: `a${idx}`, delta: str(s.text_delta), hecho, dur, hora: null }];
    if (u) r.push({ e: "uso", uso: uso(u.input_tokens, u.output_tokens, u.cache_read_tokens, 0), turno: true });
    return r;
  }
  if (s.step_type === "tool") {
    const info = obj(s.tool_info) ?? {};
    const nombre = str(s.tool_name) || str(info.name) || "?";
    const entrada = obj(info.parameters) ?? {};
    if (!hecho) return [{ e: "herr", clave: `a${idx}`, nombre, entrada, hora: null }];
    const err = obj(info.error);
    return [{ e: "res", clave: `a${idx}`, nombre, entrada, salida: err ? textoDe(err.message) : textoDe(info.output), error: err ? una(textoDe(err.message) || "error", TOPES.error) : null, dur, hora: null }];
  }
  // Un checkpoint (agy guarda el contexto) tarda lo suyo y no es un paso: sólo corre el reloj.
  if (s.step_type === "checkpoint" && dur !== null) return [{ e: "pausa", dur }];
  return [];
}

/** Una línea de opencode, codex o dsh (`type`). */
function deOtro(o: Record<string, unknown>): Evento[] {
  const tipo = o.type;
  if (typeof tipo !== "string") return [];
  const ts = nat(o.timestamp);
  const part = obj(o.part) ?? {};
  switch (tipo) {
    case "text": {
      const t = obj(o.part) ? str(part.text) : str(o.text);
      return t ? [{ e: "texto", clave: str(part.id) || `t${ts ?? ""}${t.length}`, delta: t, hecho: true, dur: null, hora: ts }] : [];
    }
    case "reasoning": {
      const tm = obj(part.time);
      const ini = nat(tm?.start);
      const fin = nat(tm?.end);
      return [{ e: "pensar", dur: ini !== null && fin !== null ? Math.max(0, fin - ini) : null, hora: fin ?? ts, texto: str(part.text) || null }];
    }
    case "tool_use": {
      const st = obj(part.state) ?? {};
      const nombre = str(part.tool) || "?";
      const tm = obj(st.time);
      const ini = nat(tm?.start);
      const fin = nat(tm?.end);
      const malo = st.status !== "completed" && st.status !== undefined;
      const clave = str(part.id) || `u${ts ?? ""}${nombre}`;
      const entrada = obj(st.input) ?? {};
      if (st.status === "pending" || st.status === "running") return [{ e: "herr", clave, nombre, entrada, hora: ini ?? ts }];
      const salida = textoDe(st.output ?? st.error);
      return [{ e: "res", clave, nombre, entrada, salida, error: malo ? una(textoDe(st.error) || salida || String(st.status), TOPES.error) : null, dur: ini !== null && fin !== null ? Math.max(0, fin - ini) : null, hora: ini ?? ts }];
    }
    case "step_finish": {
      const k = obj(part.tokens) ?? {};
      const c = obj(k.cache);
      return [{ e: "uso", uso: uso(k.input, k.output, c?.read, c?.write), turno: true }];
    }
    case "error": {
      const er = obj(o.error);
      const d = obj(er?.data);
      return [{ e: "falla", texto: una(str(d?.message) || str(er?.name) || str(o.message) || "error", TOPES.error) }];
    }
    // dsh: tool_call {callId, tool, input} y tool_result {callId, status, result}.
    case "tool_call":
      return [{ e: "herr", clave: `d${str(o.callId)}`, nombre: str(o.tool) || "?", entrada: obj(o.input) ?? {}, hora: ts }];
    case "tool_result":
      return [{ e: "res", clave: `d${str(o.callId)}`, nombre: "", entrada: {}, salida: textoDe(o.result), error: o.status !== undefined && o.status !== "completed" ? una(textoDe(o.result) || String(o.status), TOPES.error) : null, dur: null, hora: ts }];
    case "status": {
      const u = obj(o.usage);
      if (o.phase === "step_end" && u) return [{ e: "uso", uso: uso(u.inputTokens, u.outputTokens, u.cacheReadInputTokens, 0), turno: true }];
      return [];
    }
    case "turn.completed": {
      const u = obj(o.usage) ?? {};
      const cache = nat(u.cached_input_tokens) ?? 0;
      return [{ e: "uso", uso: uso(Math.max(0, (nat(u.input_tokens) ?? 0) - cache), u.output_tokens, cache, 0), turno: true }];
    }
    case "turn.failed":
      return [{ e: "falla", texto: una(textoDe(obj(o.error)?.message) || "turno fallido", TOPES.error) }];
    case "item.started":
    case "item.completed": {
      const i = obj(o.item) ?? {};
      const hecho = tipo === "item.completed";
      const clave = `x${str(i.id)}`;
      if (i.type === "command_execution") {
        const entrada = { command: str(i.command) };
        if (!hecho) return [{ e: "herr", clave, nombre: "shell", entrada, hora: null }];
        const malo = (nat(i.exit_code) ?? 0) !== 0 || i.status === "failed";
        return [{ e: "res", clave, nombre: "shell", entrada, salida: str(i.aggregated_output), error: malo ? `exit ${String(i.exit_code ?? "?")}` : null, dur: null, hora: null }];
      }
      if (!hecho) return [];
      if (i.type === "agent_message") return str(i.text) ? [{ e: "texto", clave, delta: str(i.text), hecho: true, dur: null, hora: null }] : [];
      if (i.type === "file_change") {
        const cs = Array.isArray(i.changes) ? i.changes.map((c) => obj(c)).filter((c): c is Record<string, unknown> => !!c) : [];
        return [{ e: "res", clave, nombre: "file_change", entrada: { file_path: cs.map((c) => str(c.path)).join(", ") }, salida: "", error: null, dur: null, hora: null }];
      }
      if (i.type === "web_search") return [{ e: "res", clave, nombre: "web_search", entrada: { query: str(i.query) }, salida: "", error: null, dur: null, hora: null }];
      if (i.type === "mcp_tool_call") return [{ e: "res", clave, nombre: `${str(i.server) || "mcp"}/${str(i.tool) || "?"}`, entrada: obj(i.arguments) ?? {}, salida: "", error: null, dur: null, hora: null }];
      if (i.type === "error") return [{ e: "falla", texto: una(str(i.message) || "error", TOPES.error) }];
      return [];
    }
    default:
      return [];
  }
}

export type OpcionesStream = {
  /** Arranque del worker en ms (el `inicio` de su `.hilo`): de ahí se cuentan las horas de agy. */
  inicio: number | null;
  /** De dónde sacar la hora de "ahora" y la del archivo; los tests lo fijan. */
  ahora?: () => number;
};

export class ArmadorStream {
  ruta: string;
  gen = 0;
  v = 0;
  pasos: Paso[] = [];
  omitidos = 0;
  private cola = new ColaDeLineas();
  private contador = 0;
  private porClave = new Map<string, Paso>();
  private textos = new Map<string, { paso: Paso; txt: string }>();
  private suma = sumaVacia();
  private turnos = 0;
  private cwd: string | null = null;
  private inicio: number | null;
  /** El reloj de agy: dónde terminó el último paso (el inicio más lo que duraron los anteriores). `null` si el motor trae hora propia. */
  private cursor: number | null;
  private reloj = false;
  private fin: number | null = null;
  private archivos = new Map<string, ArchivoTocado>();
  private ultimoTexto: Paso | null = null;
  private fresco = false;
  /** Desde qué paso es lo que se leyó en esta vuelta (sólo a esos se les ancla la hora). */
  private nuevoDesde = 0;
  private ahora: () => number;
  private pendiente = new Map<string, Record<string, unknown>[]>();

  constructor(ruta: string, o: OpcionesStream) {
    this.ruta = ruta;
    this.inicio = o.inicio;
    this.cursor = o.inicio;
    this.ahora = o.ahora ?? Date.now;
  }

  private reiniciar(): void {
    this.gen++;
    this.v++;
    this.pasos = [];
    this.omitidos = 0;
    this.contador = 0;
    this.porClave.clear();
    this.textos.clear();
    this.suma = sumaVacia();
    this.turnos = 0;
    this.cwd = null;
    this.cursor = this.inicio;
    this.reloj = false;
    this.fin = null;
    this.archivos.clear();
    this.ultimoTexto = null;
    this.pendiente.clear();
  }

  /** Lee lo que creció. `true` si algo cambió. */
  async leer(): Promise<boolean> {
    const antes = this.v;
    const m = await stat(this.ruta).then((s) => s.mtimeMs, () => null);
    // Lo que llega con el archivo recién escrito pasó ahora: ahí la hora de la línea es la del archivo.
    this.fresco = m !== null && this.ahora() - m < FRESCO_MS;
    this.nuevoDesde = this.contador;
    await this.cola.avanzar(this.ruta, (l) => this.linea(l), () => this.reiniciar());
    if (this.fresco && m !== null) this.anclar(m);
    return this.v !== antes;
  }

  cambiosDesde(v: number): Paso[] {
    return this.pasos.filter((p) => p.v > v);
  }

  vista(id: string): VistaPasos {
    return { id, hay: this.v > 0, gen: this.gen, v: this.v, omitidos: this.omitidos, encabezado: this.encabezado(), pasos: this.pasos };
  }

  cambio(id: string, desde: number): CambioPasos {
    return { id, gen: this.gen, desde, v: this.v, omitidos: this.omitidos, total: this.contador, encabezado: this.encabezado(), cambios: this.cambiosDesde(desde) };
  }

  encabezado(): Encabezado {
    const e = encabezadoVacio();
    const entro = this.suma.entrada + this.suma.cacheCreado + this.suma.cacheLeido;
    const archivos = [...this.archivos.values()];
    const fin = this.reloj ? this.cursor : this.fin;
    return {
      ...e,
      cwd: this.cwd,
      turnos: this.turnos,
      tokens: { ...this.suma },
      total: totalDe(this.suma),
      cache: entro > 0 ? this.suma.cacheLeido / entro : null,
      inicio: this.inicio,
      fin: this.inicio !== null && fin !== null ? Math.max(this.inicio, fin) : null,
      dur: this.inicio !== null && fin !== null ? Math.max(0, fin - this.inicio) : null,
      pasos: this.contador,
      archivos: archivos.slice(0, TOPES.archivos),
      mas: archivos.reduce((n, a) => n + a.mas, 0),
      menos: archivos.reduce((n, a) => n + a.menos, 0),
    };
  }

  /** El paso que quedó último y sigue corriendo (o recién terminó) se apoya en la hora real del archivo, así el reloj no se corre con lo que agy no cuenta. */
  private anclar(mtime: number): void {
    if (!this.reloj || this.cursor === null) return;
    const p = this.pasos[this.pasos.length - 1];
    if (!p) return;
    if (p.estado === "corriendo" && p.t !== null) {
      if (p.n < this.nuevoDesde || p.t === mtime) return;
      p.t = mtime;
      p.v = ++this.v;
      this.cursor = mtime;
    } else if (mtime < this.cursor) {
      // La suma de duraciones se pasó de la hora real: se vuelve a ella.
      this.cursor = mtime;
    }
  }

  /** Hora de arranque de un paso nuevo: la del motor, la del reloj de agy, la de ahora si se lee en vivo, o ninguna. */
  private horaNueva(propia: number | null): number | null {
    if (propia !== null) {
      this.cursor = Math.max(this.cursor ?? 0, propia);
      return propia;
    }
    if (this.reloj && this.cursor !== null) return this.cursor;
    return this.fresco ? this.ahora() : null;
  }

  /** Un paso terminó: el reloj de agy sigue desde donde acabó. */
  private avanzar(p: Paso, dur: number | null): void {
    if (dur === null || p.t === null) return;
    const fin = p.tipo === "pensar" ? p.t : p.t + dur;
    if (this.cursor === null || fin > this.cursor || this.reloj) this.cursor = fin;
    this.fin = Math.max(this.fin ?? 0, fin);
  }

  private agregar(p: Omit<Paso, "n" | "v">): Paso {
    const paso: Paso = { ...p, n: this.contador++, v: this.v };
    this.pasos.push(paso);
    if (this.pasos.length > TOPES.pasos + 100) {
      for (const viejo of this.pasos.splice(0, 100)) {
        for (const [k, x] of this.porClave) if (x === viejo) this.porClave.delete(k);
      }
      this.omitidos += 100;
    }
    return paso;
  }

  private linea(linea: string): void {
    let d: Record<string, unknown> | null;
    try {
      d = obj(JSON.parse(linea));
    } catch {
      return;
    }
    if (!d) return;
    const evs = d.event !== undefined ? deAgy(d) : deOtro(d);
    if (!evs.length) return;
    if (d.event !== undefined) this.reloj = true;
    this.v++;
    for (const e of evs) this.evento(e);
  }

  private evento(e: Evento): void {
    switch (e.e) {
      case "init":
        if (e.cwd) this.cwd = e.cwd;
        return;
      case "uso":
        this.suma.entrada += e.uso.entrada;
        this.suma.cacheCreado += e.uso.cacheCreado;
        this.suma.cacheLeido += e.uso.cacheLeido;
        this.suma.salida += e.uso.salida;
        if (e.turno) this.turnos++;
        return;
      case "pausa":
        if (this.cursor !== null) this.cursor += e.dur;
        return;
      case "falla": {
        const p = this.agregar({ id: `falla:${this.contador}`, tipo: "texto", titulo: una(e.texto, TOPES.titulo), t: this.horaNueva(null), dur: null, estado: "fallo", error: una(e.texto, TOPES.error), detalle: { clase: "texto", texto: cortar(e.texto, TOPES.texto), final: false } });
        this.ultimoTexto = p;
        return;
      }
      case "texto":
        this.texto(e);
        return;
      case "pensar": {
        const hora = e.hora;
        const t = hora !== null ? this.horaNueva(hora) : this.horaNueva(null);
        const texto = e.texto?.trim();
        this.agregar({ id: `pensar:${this.contador}`, tipo: "pensar", titulo: "", t, dur: e.dur, estado: "ok", error: null, detalle: texto ? { clase: "pensar", texto: cortar(texto, TOPES.texto) } : { clase: "pensar" } });
        return;
      }
      case "herr":
        this.herramienta(e.clave, e.nombre, e.entrada, e.hora);
        return;
      case "res": {
        const p = this.porClave.get(e.clave) ?? this.herramienta(e.clave, e.nombre, e.entrada, e.hora);
        this.resultado(p, e.salida, e.error, e.dur);
        return;
      }
    }
  }

  /** Un mensaje de texto (en agy llega en pedazos; la respuesta sin texto es el modelo pensando). */
  private texto(e: Extract<Evento, { e: "texto" }>): void {
    let x = this.textos.get(e.clave);
    if (e.delta && (x || e.delta.trim())) {
      if (!x) {
        const paso = this.agregar({ id: e.clave, tipo: "texto", titulo: "", t: this.horaNueva(e.hora), dur: null, estado: "corriendo", error: null, detalle: { clase: "texto", texto: cortar("", TOPES.texto), final: true } });
        this.cerrarFinal(paso);
        x = { paso, txt: "" };
        this.textos.set(e.clave, x);
      }
      x.txt += e.delta;
      x.paso.titulo = una(x.txt, TOPES.titulo);
      x.paso.detalle = { clase: "texto", texto: cortar(x.txt, TOPES.texto), final: true };
      x.paso.v = this.v;
    }
    if (!e.hecho) return;
    if (x && x.txt.trim()) {
      x.paso.estado = "ok";
      x.paso.dur = e.dur;
      x.paso.v = this.v;
      this.avanzar(x.paso, e.dur);
      this.textos.delete(e.clave);
      return;
    }
    // Sin texto: el modelo estuvo pensando. Como en Claude, un paso de pensar lleva la hora de cuando terminó.
    if (e.dur === null) return;
    const ini = this.horaNueva(e.hora);
    const t = ini !== null ? ini + e.dur : null;
    const paso = this.agregar({ id: `pensar:${e.clave}`, tipo: "pensar", titulo: "", t, dur: e.dur, estado: "ok", error: null, detalle: { clase: "pensar" } });
    this.avanzar(paso, e.dur);
  }

  /** Lo que se dijo antes de este mensaje deja de ser "el último". */
  private cerrarFinal(nuevo: Paso | null): void {
    const u = this.ultimoTexto;
    if (u && u !== nuevo && u.detalle.clase === "texto" && u.detalle.final) {
      u.detalle = { ...u.detalle, final: false };
      u.v = this.v;
    }
    this.ultimoTexto = nuevo;
  }

  private herramienta(clave: string, nombre: string, e: Record<string, unknown>, hora: number | null): Paso {
    const ya = this.porClave.get(clave);
    if (ya) return ya;
    // Una herramienta después de un mensaje: ese mensaje no era el final.
    this.cerrarFinal(null);
    const t = this.horaNueva(hora);
    const base = { id: clave, t, dur: null, estado: "corriendo" as const, error: null };
    const cat = categoriaDe(nombre);
    let paso: Paso;
    if (cat === "correr") {
      const comando = comandoDe(e);
      paso = this.agregar({ ...base, tipo: "correr", titulo: una(comando, TOPES.titulo), detalle: { clase: "correr", comando: cortar(comando, TOPES.entrada * 4), descripcion: str(e.Description) || str(e.description) || null, salida: null, codigo: null, interrumpido: false, fondo: e.WaitMsBeforeAsync !== undefined || e.run_in_background === true } });
    } else if (cat === "leer") {
      const ruta = rutaDe(e);
      paso = this.agregar({ ...base, tipo: "leer", titulo: ruta, detalle: { clase: "leer", ruta, desde: nat(e.StartLine) ?? nat(e.offset), lineas: null, total: null, imagen: false, texto: null } });
    } else if (cat === "buscar") {
      const patron = primero(e, ["Query", "query", "Pattern", "pattern", "Url", "URL", "url", "SearchPattern"]);
      const ruta = primero(e, ["SearchPath", "SearchDirectory", "Path", "path", "DirectoryPath"]) || null;
      paso = this.agregar({ ...base, tipo: "buscar", titulo: una(patron, TOPES.titulo), detalle: { clase: "buscar", herramienta: nombre, patron, ruta, resultados: null, texto: null } });
    } else if (cat === "editar") {
      const ruta = rutaDe(e);
      const trozos = Array.isArray(e.ReplacementChunks) ? e.ReplacementChunks.map((x) => obj(x) ?? {}) : [e];
      const lista = trozos.map((c) => ({ old_string: primero(c, ["TargetContent", "old_string", "oldString"]), new_string: primero(c, ["ReplacementContent", "new_string", "newString"]) }));
      const cambios: Cambio[] = lista.slice(0, TOPES.cambios).map((c) => ({ viejo: cortar(c.old_string, TOPES.lado), nuevo: cortar(c.new_string, TOPES.lado), todo: false, desde: null }));
      paso = this.agregar({ ...base, tipo: "editar", titulo: ruta, detalle: { clase: "editar", ruta, cambios, masCambios: Math.max(0, lista.length - cambios.length), mas: 0, menos: 0 } });
      this.pendiente.set(clave, lista);
    } else if (cat === "escribir") {
      const ruta = rutaDe(e);
      const contenido = primero(e, ["CodeContent", "Content", "content", "FileContent"]);
      paso = this.agregar({ ...base, tipo: "escribir", titulo: ruta, detalle: { clase: "escribir", ruta, contenido: cortar(contenido, TOPES.escrito), lineas: lineasDe(contenido), nuevo: null, mas: 0, menos: 0 } });
      this.pendiente.set(clave, [{ old_string: "", new_string: contenido }]);
    } else {
      paso = this.agregar({ ...base, tipo: "otro", titulo: nombre || "?", detalle: { clase: "otro", nombre, entrada: cortar(textoDe(e), TOPES.entrada).t, salida: null } });
    }
    this.porClave.set(clave, paso);
    return paso;
  }

  private resultado(p: Paso, salida: string, error: string | null, dur: number | null): void {
    p.v = this.v;
    p.dur = dur ?? p.dur;
    const det: Detalle = p.detalle;
    if (det.clase === "correr") {
      const { codigo, salida: s } = error ? { codigo: null, salida } : salidaDeComando(salida);
      const mal = error !== null || (codigo !== null && codigo !== 0);
      det.salida = s.trim() ? cortar(s.replace(/\r\n/g, "\n"), TOPES.salida, "extremos") : null;
      det.codigo = error ? null : (codigo ?? 0);
      p.estado = mal ? "fallo" : "ok";
      p.error = mal ? (error ?? (una(s, TOPES.error) || `exit ${codigo}`)) : null;
    } else {
      p.estado = error ? "fallo" : "ok";
      p.error = error;
      if (det.clase === "leer" && !error) {
        det.texto = cortar(salida, TOPES.lectura);
        det.lineas = lineasDe(salida);
      } else if (det.clase === "buscar" && !error) {
        det.texto = cortar(salida, TOPES.lectura);
        det.resultados = salida.trim() ? lineasDe(salida.trim()) : 0;
      } else if (det.clase === "otro") {
        det.salida = salida ? cortar(salida, TOPES.lectura) : null;
      } else if ((det.clase === "editar" || det.clase === "escribir") && !error) {
        this.tocado(p, det);
      }
    }
    this.pendiente.delete(p.id);
    this.avanzar(p, p.dur);
  }

  /** Lo que sumó y quitó un cambio que entró, y el archivo al encabezado. */
  private tocado(p: Paso, det: Extract<Detalle, { clase: "editar" | "escribir" }>): void {
    const lista = this.pendiente.get(p.id) ?? [];
    let mas = 0;
    let menos = 0;
    for (const c of lista) {
      const x = contarDiff(str(c.old_string), str(c.new_string));
      mas += x.mas;
      menos += x.menos;
    }
    det.mas = mas;
    det.menos = menos;
    const a = this.archivos.get(det.ruta) ?? { ruta: det.ruta, mas: 0, menos: 0, ediciones: 0, nuevo: false };
    a.mas += mas;
    a.menos += menos;
    a.ediciones++;
    this.archivos.set(det.ruta, a);
  }
}
