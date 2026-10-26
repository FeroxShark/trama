// Un cliente mínimo de ACP (Agent Client Protocol): JSON-RPC 2.0 por stdio, una línea JSON por mensaje. Genérico (no sabe
// de dsh ni de Trama) y sin Electron: lo usa el puente de dsh (dsh-puente.ts) y lo prueba tests/acp.test.ts con dsh de verdad.
//
//   const c = new ClienteAcp({ comando: "dsh", args: ["--profile", "acp"], env, alActualizar: (sid, u) => … });
//   await c.iniciar();                                   // spawn + `initialize`
//   const { sessionId } = await c.nuevaSesion(cwd);      // `session/new`    (o `retomar(sid, cwd)`: `session/resume`)
//   const { stopReason } = await c.prompt(sessionId, [{ type: "text", text: "hola" }]);
//   c.cancelar(sessionId);                               // `session/cancel`: el prompt en curso termina con "cancelled"
//
// Lo que dice el agente por `session/update` llega a `alActualizar` en el orden en que salió, siempre antes de que se resuelva el
// `prompt` que lo causó. Los pedidos del agente al cliente (`session/request_permission`) se contestan con `permiso` (por default:
// permitir una vez lo que cae dentro del workspace, rechazar lo que lo escapa). Que el hijo se vaya rechaza todo lo pendiente.
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

type Obj = Record<string, any>;

/** Un bloque de contenido de un prompt: texto, o una imagen en base64 (`mimeType`: image/png, jpeg, webp o gif). */
export type BloqueAcp = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export type OpcionPermiso = { optionId: string; name?: string; kind: string };
export type PedidoPermiso = {
  sessionId: string;
  /** El `rawInput` del `tool_call` con ese `toolCallId` (el pedido sólo trae el id), si ya se vio. */
  entrada: Obj | null;
  toolCall: Obj;
  opciones: OpcionPermiso[];
};
export type DecisionPermiso = "permitir" | "rechazar" | "cancelar";
export type Politica = (p: PedidoPermiso) => DecisionPermiso | Promise<DecisionPermiso>;

/** Un error JSON-RPC del agente (`{ code, message }`). */
export class ErrorAcp extends Error {
  code: number;
  metodo: string;
  /** El `error.data` del agente, si trajo (suele tener el motivo real de un «Internal error»). */
  data: unknown;
  constructor(metodo: string, code: number, message: string, data?: unknown) {
    super(`${metodo}: ${message}`);
    this.name = "ErrorAcp";
    this.code = code;
    this.metodo = metodo;
    this.data = data;
  }
}

/** Saca de un texto lo que parece una clave: los valores de `secretos`, `sk-…` y los tokens largos tipo base64 (32+ caracteres). */
export function redactar(texto: string, secretos: Array<string | undefined> = []): string {
  let t = texto;
  for (const s of secretos) if (s && s.length >= 4) t = t.split(s).join("«clave»");
  return t.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "«clave»").replace(/[A-Za-z0-9+_-]{32,}={0,2}/g, "«clave»");
}

/**
 * El texto de un error para mostrárselo a la persona. Un error JSON-RPC genérico (-32603 «Internal error») no dice nada: se le
 * suma `error.data` (si hay) y las últimas líneas del stderr de dsh, donde aparece el motivo real. Todo sin claves, en ~`max` caracteres.
 */
export function describirError(e: unknown, stderr = "", secretos: Array<string | undefined> = [], max = 400): string {
  const base = String((e as Error)?.message ?? e);
  const partes = [base];
  if (e instanceof ErrorAcp && (e.code === -32603 || /internal error/i.test(base))) {
    const d = e.data === undefined || e.data === null ? "" : typeof e.data === "string" ? e.data : JSON.stringify(e.data);
    if (d && d !== "{}" && !base.includes(d)) partes.push(d);
    const cola = stderr
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-3)
      .join(" · ");
    if (cola && !partes.some((p) => p.includes(cola))) partes.push(cola);
  }
  const t = redactar(partes.join(" — "), secretos);
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

export type OpcionesAcp = {
  comando: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Cada `session/update` del agente (`update.sessionUpdate`: agent_message_chunk, tool_call, usage_update…). */
  alActualizar?: (sessionId: string, update: Obj) => void;
  /** Cómo contestar un `session/request_permission`. Default: {@link politicaEnWorkspace} con `raiz` (o el cwd). */
  permiso?: Politica;
  raiz?: string;
  alStderr?: (texto: string) => void;
  alSalir?: (codigo: number | null, senal: NodeJS.Signals | null) => void;
  /** Tiempo máximo de una petición que no sea `session/prompt` (que dura lo que dure el turno). Default 60 s. */
  tiempoMs?: number;
};

export type RespuestaInicio = { protocolVersion: number; agentCapabilities: Obj; agentInfo?: Obj; authMethods?: unknown[] };

/**
 * La política por default: permitir una vez, salvo que la herramienta pida salir del sandbox a todo el disco
 * (`sandbox_permissions: "danger-full-access"`) o toque una ruta (`file_path`, `path`, `cwd`) fuera de `raiz`.
 */
export function politicaEnWorkspace(raiz: string): Politica {
  const base = path.resolve(raiz);
  const dentro = (p: string) => {
    const r = path.relative(base, path.resolve(base, p));
    return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
  };
  return ({ entrada }) => {
    if (!entrada) return "permitir";
    if (entrada.sandbox_permissions === "danger-full-access") return "rechazar";
    for (const k of ["file_path", "path", "cwd"]) if (typeof entrada[k] === "string" && !dentro(entrada[k])) return "rechazar";
    return "permitir";
  };
}

type Pendiente = { resolve: (r: any) => void; reject: (e: Error) => void; metodo: string; timer: NodeJS.Timeout | null };

export class ClienteAcp {
  private hijo: ChildProcess | null = null;
  private pendientes = new Map<number, Pendiente>();
  private siguiente = 1;
  private llamadas = new Map<string, Obj>();
  private vivo = false;
  /** Lo que respondió `initialize` (capacidades del agente: `promptCapabilities.image`, `sessionCapabilities.resume`…). */
  inicio: RespuestaInicio | null = null;
  /** Lo último que salió por stderr del agente (para explicar por qué se cayó). */
  stderr = "";
  salio: { codigo: number | null; senal: NodeJS.Signals | null } | null = null;

  private readonly o: OpcionesAcp;

  constructor(o: OpcionesAcp) {
    this.o = o;
  }

  get activo(): boolean {
    return this.vivo;
  }

  get pid(): number | undefined {
    return this.hijo?.pid;
  }

  /** ¿Anuncia el agente poder retomar sesiones (`session/resume`)? */
  get puedeRetomar(): boolean {
    return !!this.inicio?.agentCapabilities?.sessionCapabilities?.resume;
  }

  /** ¿Acepta imágenes en el prompt del modelo actual? */
  get aceptaImagenes(): boolean {
    return this.inicio?.agentCapabilities?.promptCapabilities?.image === true;
  }

  /** Lanza el agente y hace el `initialize` (protocolo 1, sin `fs` ni terminal del cliente). */
  async iniciar(): Promise<RespuestaInicio> {
    if (this.hijo) throw new Error("acp: el agente ya está lanzado");
    const p = spawn(this.o.comando, this.o.args ?? [], {
      cwd: this.o.cwd,
      env: this.o.env as NodeJS.ProcessEnv | undefined,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.hijo = p;
    this.vivo = true;
    p.stdin!.on("error", () => {
      /* EPIPE: el hijo se fue; lo cuenta `close` */
    });
    p.stderr!.setEncoding("utf8");
    p.stderr!.on("data", (t: string) => {
      this.stderr = (this.stderr + t).slice(-4000);
      this.o.alStderr?.(t);
    });
    createInterface({ input: p.stdout! }).on("line", (l) => this.linea(l));
    p.on("error", (e) => this.caer(`no se pudo lanzar ${this.o.comando}: ${e.message}`));
    p.on("close", (codigo, senal) => {
      this.salio = { codigo, senal };
      const dijo = this.stderr.trim().split("\n").slice(-2).join(" · ");
      this.caer(`${path.basename(this.o.comando)} salió${codigo !== null ? ` con el código ${codigo}` : ` por ${senal}`}${dijo ? `: ${dijo}` : ""}`);
      this.o.alSalir?.(codigo, senal);
    });
    const r = (await this.pedir(
      "initialize",
      { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } },
      Math.max(this.o.tiempoMs ?? 60_000, 60_000),
    )) as RespuestaInicio;
    this.inicio = r;
    return r;
  }

  /** `session/new`: `cwd` absoluto. Devuelve el id de la sesión y las opciones de configuración (el modelo, el razonamiento…). */
  async nuevaSesion(cwd: string): Promise<{ sessionId: string; configOptions: Obj[] }> {
    const r = await this.pedir("session/new", { cwd: path.resolve(cwd), mcpServers: [] });
    if (typeof r?.sessionId !== "string") throw new Error("acp: session/new no devolvió sessionId");
    return { sessionId: r.sessionId, configOptions: Array.isArray(r.configOptions) ? r.configOptions : [] };
  }

  /** `session/resume`: la misma sesión de antes (el agente la guardó) sin reenviar la historia. Falla si no la tiene o el cwd no coincide. */
  async retomar(sessionId: string, cwd: string): Promise<{ configOptions: Obj[] }> {
    const r = await this.pedir("session/resume", { sessionId, cwd: path.resolve(cwd), mcpServers: [] });
    return { configOptions: Array.isArray(r?.configOptions) ? r.configOptions : [] };
  }

  /** `session/set_config_option`; `value` va tal cual (dsh pide el modelo como string JSON `["proveedor","modelo"]`). */
  async configurar(sessionId: string, configId: string, value: string): Promise<{ configOptions: Obj[] }> {
    const r = await this.pedir("session/set_config_option", { sessionId, configId, value });
    return { configOptions: Array.isArray(r?.configOptions) ? r.configOptions : [] };
  }

  /** `session/prompt`: termina cuando el agente cierra el turno. Sin tiempo máximo (un turno puede tardar horas). */
  async prompt(sessionId: string, contenido: BloqueAcp[]): Promise<{ stopReason: string }> {
    const r = await this.pedir("session/prompt", { sessionId, prompt: contenido }, 0);
    return { stopReason: typeof r?.stopReason === "string" ? r.stopReason : "end_turn" };
  }

  /** `session/cancel` (notificación): el `prompt` en curso termina con `stopReason: "cancelled"`. */
  cancelar(sessionId: string): void {
    this.enviar({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
  }

  /** Cierra stdin (dsh sale solo) y, si no se va en `espera` ms, lo mata. */
  async cerrar(espera = 2000): Promise<void> {
    const p = this.hijo;
    if (!p || !this.vivo) return;
    const fin = new Promise<void>((ok) => p.once("close", () => ok()));
    try {
      p.stdin!.end();
    } catch {
      /* ya cerrado */
    }
    const t = setTimeout(() => p.kill("SIGKILL"), espera);
    await fin;
    clearTimeout(t);
  }

  /** Mata al agente ya (SIGKILL al proceso). */
  matar(): void {
    this.hijo?.kill("SIGKILL");
  }

  // --- JSON-RPC -------------------------------------------------------------------------------------------------

  private enviar(o: Obj): boolean {
    if (!this.vivo || !this.hijo?.stdin?.writable) return false;
    try {
      this.hijo.stdin.write(JSON.stringify(o) + "\n");
      return true;
    } catch {
      return false;
    }
  }

  private pedir(metodo: string, params: Obj, tiempo: number = this.o.tiempoMs ?? 60_000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.vivo) return reject(new Error(`acp: ${metodo}: el agente no está corriendo`));
      const id = this.siguiente++;
      const timer = tiempo > 0 ? setTimeout(() => {
        this.pendientes.delete(id);
        reject(new Error(`acp: ${metodo}: sin respuesta en ${Math.round(tiempo / 1000)} s`));
      }, tiempo) : null;
      timer?.unref();
      this.pendientes.set(id, { resolve, reject, metodo, timer });
      if (!this.enviar({ jsonrpc: "2.0", id, method: metodo, params })) {
        if (timer) clearTimeout(timer);
        this.pendientes.delete(id);
        reject(new Error(`acp: ${metodo}: no se pudo escribir al agente`));
      }
    });
  }

  /** El hijo se fue (o no arrancó): todo lo pendiente falla con el motivo. */
  private caer(motivo: string) {
    this.vivo = false;
    const e = new Error(`acp: ${motivo}`);
    for (const [id, p] of this.pendientes) {
      if (p.timer) clearTimeout(p.timer);
      this.pendientes.delete(id);
      p.reject(e);
    }
  }

  private linea(l: string) {
    let m: Obj;
    try {
      m = JSON.parse(l);
    } catch {
      return; // ruido en stdout que no es JSON-RPC
    }
    if (!m || typeof m !== "object") return;
    const tieneMetodo = typeof m.method === "string";
    if (!tieneMetodo && m.id !== undefined) {
      const p = this.pendientes.get(m.id);
      if (!p) return;
      this.pendientes.delete(m.id);
      if (p.timer) clearTimeout(p.timer);
      if (m.error) p.reject(new ErrorAcp(p.metodo, Number(m.error.code ?? 0), String(m.error.message ?? "error"), m.error.data));
      else p.resolve(m.result);
      return;
    }
    if (!tieneMetodo) return;
    if (m.id === undefined) return this.notificacion(m.method, m.params ?? {});
    void this.pedidoDelAgente(m.id, m.method, m.params ?? {});
  }

  private notificacion(metodo: string, params: Obj) {
    if (metodo !== "session/update") return;
    const u = params.update;
    if (!u || typeof u !== "object" || typeof params.sessionId !== "string") return;
    if (u.sessionUpdate === "tool_call" && typeof u.toolCallId === "string" && u.rawInput && typeof u.rawInput === "object") this.llamadas.set(u.toolCallId, u.rawInput);
    try {
      this.o.alActualizar?.(params.sessionId, u);
    } catch (e) {
      this.o.alStderr?.(`acp: alActualizar falló: ${String((e as Error)?.message ?? e)}\n`);
    }
  }

  private async pedidoDelAgente(id: unknown, metodo: string, params: Obj) {
    const responder = (extra: Obj) => this.enviar({ jsonrpc: "2.0", id, ...extra });
    if (metodo !== "session/request_permission") return void responder({ error: { code: -32601, message: `el cliente no implementa ${metodo}` } });
    const opciones: OpcionPermiso[] = Array.isArray(params.options) ? params.options.filter((x: any) => x && typeof x.optionId === "string").map((x: any) => ({ optionId: x.optionId, name: x.name, kind: String(x.kind ?? "") })) : [];
    const toolCall: Obj = params.toolCall ?? {};
    const politica = this.o.permiso ?? politicaEnWorkspace(this.o.raiz ?? this.o.cwd ?? process.cwd());
    let d: DecisionPermiso;
    try {
      d = await politica({ sessionId: String(params.sessionId ?? ""), entrada: this.llamadas.get(String(toolCall.toolCallId)) ?? null, toolCall, opciones });
    } catch {
      d = "rechazar";
    }
    const quiero = d === "permitir" ? "allow_once" : "reject_once";
    const op = opciones.find((x) => x.kind === quiero) ?? opciones.find((x) => x.kind.startsWith(d === "permitir" ? "allow" : "reject"));
    if (d === "cancelar" || !op) return void responder({ result: { outcome: { outcome: "cancelled" } } });
    responder({ result: { outcome: { outcome: "selected", optionId: op.optionId } } });
  }
}
