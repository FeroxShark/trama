// El stream de `codex exec --json` (ChatGPT) traducido al de Claude Code, que es el que pinta la app (`parsearLinea`,
// lider-arma.ts). Puro y sin Electron: lo usa el puente (codex-puente.ts) y lo prueba `tests/codex-stream.test.ts`.
//
// Lo que dice codex (una línea JSON por evento; el mismo formato que lee `pa` en cli/pa/hilo-stream.ts):
//   thread.started  { thread_id }                       el id con que se retoma (`codex exec resume <id>`)
//   turn.started    {}
//   item.started    { item: { id, type, … } }           command_execution empieza (con su `command`)
//   item.updated    { item }                            (todo_list): no se pinta
//   item.completed  { item: { id, type, … } }           agent_message {text}, reasoning {text}, command_execution {command,
//                                                       aggregated_output, exit_code, status}, file_change {changes[{path,kind}]},
//                                                       mcp_tool_call {server, tool, arguments, result?, error?}, web_search {query},
//                                                       error {message}
//   turn.completed  { usage: { input_tokens, cached_input_tokens, output_tokens } }
//   turn.failed     { error: { message } }
//   error           { message }

/** La ventana de contexto de los modelos de ChatGPT que corre codex (lo que dice el medidor del chat). */
export const VENTANA_CODEX = 400_000;

type Obj = Record<string, any>;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Un ítem de codex como la herramienta de Claude Code que hace lo mismo (`null`: no es una herramienta). */
export function herramientaCodex(i: Obj): { name: string; input: Obj } | null {
  switch (i?.type) {
    case "command_execution":
      return { name: "Bash", input: { command: str(i.command) ?? "" } };
    case "file_change": {
      const cs = Array.isArray(i.changes) ? i.changes.filter((c: unknown) => c && typeof c === "object") : [];
      const rutas = cs.map((c: Obj) => str(c.path)).filter(Boolean) as string[];
      const kinds = new Set(cs.map((c: Obj) => c.kind));
      return { name: kinds.size === 1 && kinds.has("add") ? "Write" : "Edit", input: { file_path: rutas.join(", ") } };
    }
    case "mcp_tool_call":
      return { name: `mcp__${str(i.server) ?? "mcp"}__${str(i.tool) ?? "?"}`, input: i.arguments && typeof i.arguments === "object" ? { ...i.arguments } : {} };
    case "web_search":
      return { name: "WebSearch", input: { query: str(i.query) ?? "" } };
    default:
      return null;
  }
}

/** Lo que devolvió un ítem de herramienta, como el `tool_result` de Claude: el texto y si falló. */
function resultadoDe(i: Obj): { texto: string; error: boolean } {
  if (i.type === "command_execution") {
    const codigo = num(i.exit_code);
    return { texto: String(i.aggregated_output ?? "").replace(/\r\n/g, "\n"), error: (codigo !== null && codigo !== 0) || i.status === "failed" };
  }
  if (i.type === "file_change") {
    const cs = Array.isArray(i.changes) ? i.changes : [];
    return { texto: cs.map((c: Obj) => `${String(c?.kind ?? "update")} ${String(c?.path ?? "")}`).join("\n"), error: i.status === "failed" };
  }
  if (i.type === "mcp_tool_call") {
    const err = str(i.error?.message) ?? str(i.error);
    if (err) return { texto: err, error: true };
    const r = i.result;
    const texto = Array.isArray(r?.content) ? r.content.map((b: Obj) => (typeof b?.text === "string" ? b.text : "")).join("\n") : r === undefined || r === null ? "" : JSON.stringify(r);
    return { texto, error: i.status === "failed" };
  }
  return { texto: "", error: i.status === "failed" };
}

type Uso = { input_tokens: number; output_tokens: number };

export type Opciones = {
  /** El id de sesión de Claude (el del líder en la barra): va en cada línea como `session_id`. */
  sid: string;
  /** El modelo que se dice en cada mensaje (el que se pidió: `codex:gpt-6.1-sol`). */
  modelo: string;
};

/**
 * Traduce los eventos de UN turno de codex. `linea(obj)` devuelve las líneas del stream de Claude (objetos) que corresponden;
 * `fin(error)` cierra el turno si codex se fue sin decir `turn.completed`.
 */
export class Traductor {
  /** El `thread_id` de codex: con él se retoma la conversación. */
  conversacion: string | null = null;
  private herramientas = new Map<string, { id: string; resultado: boolean }>();
  private usoTurno: Uso = { input_tokens: 0, output_tokens: 0 };
  private textos: string[] = [];
  private n = 0;
  private cerrado = false;
  /** Lo que pesaba el contexto en lo último que contestó el modelo (0: este turno no contestó nada). */
  contexto = 0;
  private readonly o: Opciones;

  constructor(o: Opciones) {
    this.o = o;
  }

  private base() {
    return { parent_tool_use_id: null, session_id: this.o.sid };
  }

  private ev(event: Obj): Obj {
    return { type: "stream_event", event, ...this.base() };
  }

  private idDe(prefijo: string, item: string) {
    return `${prefijo}_${this.conversacion ?? this.o.sid}_${item || ++this.n}`;
  }

  private mensaje(id: string, content: Obj[]): Obj {
    return { type: "assistant", message: { id, role: "assistant", model: this.o.modelo, content }, ...this.base() };
  }

  /** Un evento de codex → las líneas de Claude. */
  linea(o: Obj): Obj[] {
    if (!o || typeof o !== "object" || this.cerrado) return [];
    switch (o.type) {
      case "thread.started":
        this.conversacion = str(o.thread_id) ?? this.conversacion;
        return [];
      case "item.started":
        return o.item?.type === "command_execution" ? this.herramienta(o.item, false) : [];
      case "item.completed":
        return this.completo(o.item ?? {});
      case "turn.completed":
        return this.resultado(o.usage ?? {});
      case "turn.failed":
        return this.fin(`codex: ${str(o.error?.message) ?? "el turno falló"}`);
      case "error":
        // Un `error` suelto (reintento de red) no cierra el turno: si fue fatal, viene un `turn.failed` o codex sale con error.
        return [];
      default:
        return [];
    }
  }

  private completo(i: Obj): Obj[] {
    const item = String(i.id ?? "");
    if (i.type === "agent_message") {
      const texto = String(i.text ?? "").replace(/\s+$/, "");
      if (!texto) return [];
      this.textos.push(texto);
      const id = this.idDe("msg_codex", item);
      return [
        this.ev({ type: "message_start", message: { id, usage: { input_tokens: this.contexto, output_tokens: 0 } } }),
        this.ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
        this.ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: texto } }),
        this.ev({ type: "content_block_stop", index: 0 }),
        this.mensaje(id, [{ type: "text", text: texto }]),
        this.ev({ type: "message_stop" }),
      ];
    }
    if (i.type === "reasoning") {
      const pen = String(i.text ?? "").trim();
      if (!pen) return [];
      const id = this.idDe("msg_codex_p", item);
      return [
        this.ev({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
        this.ev({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: pen } }),
        this.ev({ type: "content_block_stop", index: 0 }),
        this.mensaje(id, [{ type: "thinking", thinking: pen }]),
      ];
    }
    if (i.type === "error") {
      const t = str(i.message);
      return t ? [this.mensaje(this.idDe("msg_codex_e", item), [{ type: "text", text: `✗ codex: ${t}` }])] : [];
    }
    return this.herramienta(i, true);
  }

  private herramienta(i: Obj, hecho: boolean): Obj[] {
    const traducida = herramientaCodex(i);
    if (!traducida) return [];
    const item = String(i.id ?? "");
    const out: Obj[] = [];
    let h = item ? this.herramientas.get(item) : undefined;
    if (!h) {
      h = { id: this.idDe("toolu_codex", item), resultado: false };
      if (item) this.herramientas.set(item, h);
      // Como el real: el bloque empieza (sólo el nombre) y después sale el mensaje entero con su entrada.
      out.push(this.ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: h.id, name: traducida.name, input: {} } }));
      out.push(this.mensaje(this.idDe("msg_codex_t", item), [{ type: "tool_use", id: h.id, name: traducida.name, input: traducida.input }]));
    }
    if (hecho && !h.resultado) {
      h.resultado = true;
      const r = resultadoDe(i);
      out.push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: h.id, content: r.texto, ...(r.error ? { is_error: true } : {}) }] }, ...this.base() });
    }
    return out;
  }

  /** Se cortó el turno con herramientas a medias: cada una queda cerrada con un error, para que el chat no la muestre corriendo. */
  cerrarAbiertas(motivo: string): Obj[] {
    const out: Obj[] = [];
    for (const h of this.herramientas.values()) {
      if (h.resultado) continue;
      h.resultado = true;
      out.push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: h.id, content: motivo, is_error: true }] }, ...this.base() });
    }
    return out;
  }

  private resultado(u: Obj): Obj[] {
    // `input_tokens` de codex es lo que entró en el turno (con lo cacheado incluido): es el contexto de ahora.
    this.contexto = num(u.input_tokens) ?? this.contexto;
    this.usoTurno = { input_tokens: this.contexto, output_tokens: (num(u.output_tokens) ?? 0) + (num(u.reasoning_output_tokens) ?? 0) };
    return this.cerrar(null);
  }

  /** codex se fue sin `turn.completed` (se cayó, o lo cortaron): el turno termina igual, con el motivo. */
  fin(error: string | null): Obj[] {
    return this.cerrar(error);
  }

  private cerrar(error: string | null): Obj[] {
    if (this.cerrado) return [];
    this.cerrado = true;
    return [
      ...this.cerrarAbiertas(error ?? "El turno terminó antes de que este paso devolviera algo."),
      {
        type: "result",
        subtype: error ? "error_during_execution" : "success",
        is_error: !!error,
        result: error ?? this.textos.at(-1) ?? "",
        num_turns: 1,
        usage: this.usoTurno,
        modelUsage: { [this.o.modelo]: { contextWindow: VENTANA_CODEX } },
        ...this.base(),
      },
    ];
  }
}

/** `codex:gpt-6.1-sol` (+ `high`) o `codex:gpt-6.1-sol-high` → el modelo de `codex -m` y el esfuerzo (`model_reasoning_effort`). */
export function partirCodex(modelo: string, effort?: string | null): { modelo: string; effort: string } {
  const base = modelo.replace(/^codex:/, "");
  const m = /^(.+?)-(low|medium|high)$/.exec(base);
  if (m) return { modelo: m[1]!, effort: m[2]! };
  return { modelo: base, effort: effort && ["low", "medium", "high"].includes(effort) ? effort : "medium" };
}

/** El sandbox de codex para el modo de permisos del líder. */
export const sandboxDe = (m: string): string => (m === "plan" ? "read-only" : m === "bypassPermissions" ? "danger-full-access" : "workspace-write");

/** Lo que se le pasa a codex: el turno por la entrada estándar (`-`) y, si hay, la conversación que retoma. */
export function argsCodex(x: { modelo: string; effort: string; sandbox: string; cwd: string; imagenes: string[]; thread: string | null }): string[] {
  return [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-m",
    x.modelo,
    "-c",
    `model_reasoning_effort="${x.effort}"`,
    "-c",
    'approval_policy="never"',
    "--sandbox",
    x.sandbox,
    "-C",
    x.cwd,
    ...x.imagenes.flatMap((i) => ["-i", i]),
    ...(x.thread ? ["resume", x.thread] : []),
    "-",
  ];
}
