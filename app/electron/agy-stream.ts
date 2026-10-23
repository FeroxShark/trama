// El stream de `agy` (Antigravity CLI, `--output-format stream-json`) traducido al de Claude Code, que es el
// que pinta la app (`parsearLinea`, lider-arma.ts). Puro y sin Electron: lo usa el puente (agy-puente.ts) y
// lo prueban `tests/agy-stream.test.ts` con un stream de verdad (tests/fixtures/agy-*.jsonl).
//
// Lo que dice agy (una línea JSON por evento):
//   init         { conversation_id, init: { model, cwd, tools } }
//   step_update  { step_type: user_input | agent_response | tool, state: ACTIVE | DONE, step_index,
//                  text_delta?, tool_name?, tool_info?: { name, parameters, output }, usage? }
//   result       { status: SUCCESS | …, response, usage, duration_seconds }
// El texto llega en `text_delta` incrementales de un paso `agent_response`; una herramienta pasa por ACTIVE
// (con sus parámetros) y DONE (con `tool_info.output`). Su razonamiento no sale en el stream (sólo
// `thinking_tokens`): no hay bloque `thinking`.

/** La ventana de contexto de Gemini 4 Argon / 3.8 Flash (1M tokens): lo que dice el medidor del chat. */
export const VENTANA_GEMINI = 1_000_000;

type Obj = Record<string, any>;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Un parámetro de agy por varios nombres posibles (sin importar mayúsculas ni guiones). */
function param(p: Obj, ...nombres: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[_-]/g, "");
  const quiero = nombres.map(norm);
  for (const [k, v] of Object.entries(p)) if (quiero.includes(norm(k)) && str(v)) return v as string;
  return null;
}

/**
 * Una herramienta de agy como la de Claude Code que hace lo mismo: el nombre y los campos que la vista
 * sabe leer (`command`, `file_path`, `pattern`…). Lo que no se conoce pasa con su nombre y sus parámetros tal cual.
 */
export function herramientaClaude(nombre: string, parametros: unknown): { name: string; input: Obj } {
  const p = (parametros && typeof parametros === "object" ? parametros : {}) as Obj;
  const ruta = () => param(p, "AbsolutePath", "TargetFile", "File", "FilePath", "Path", "FileName", "Uri", "SearchPath", "DirectoryPath", "SearchDirectory");
  const con = (name: string, campos: Obj) => ({ name, input: Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== null)) });
  switch (nombre) {
    case "run_command":
      return con("Bash", { command: param(p, "CommandLine", "Command"), description: param(p, "Description", "Purpose"), cwd: param(p, "Cwd") });
    case "view_file":
    case "view_file_outline":
    case "view_code_item":
      return con("Read", { file_path: ruta() });
    case "list_dir":
      return con("LS", { path: ruta() });
    case "find_by_name":
      return con("Glob", { pattern: param(p, "Pattern", "Query", "Name", "SearchTerm"), path: param(p, "SearchDirectory", "SearchPath", "Directory", "Path") });
    case "grep_search":
      return con("Grep", { pattern: param(p, "Query", "Pattern", "SearchTerm"), path: param(p, "SearchPath", "SearchDirectory", "Path") });
    case "write_to_file":
      return con("Write", { file_path: ruta(), content: param(p, "CodeContent", "Content") });
    case "replace_file_content":
    case "multi_replace_file_content":
    case "sed_file":
      return con("Edit", { file_path: ruta() });
    case "search_web":
      return con("WebSearch", { query: param(p, "query", "Query") });
    case "read_url_content":
      return con("WebFetch", { url: param(p, "Url", "URL") });
    default:
      return { name: nombre || "?", input: { ...p } };
  }
}

/** Lo que un paso de herramienta devolvió, como el `tool_result` de Claude: el texto, y si falló. */
function resultadoDe(output: unknown): { texto: string; error: boolean } {
  const t = typeof output === "string" ? output : output === undefined || output === null ? "" : JSON.stringify(output);
  // run_command lo dice: "Command exited with code 1." y después la salida.
  const m = /^Command exited with code (-?\d+)\./.exec(t);
  const limpio = m ? t.replace(/^Command exited with code -?\d+\.\s*\n*(Command output:\n)?/, "") : t;
  return { texto: limpio.replace(/\r\n/g, "\n"), error: !!m && m[1] !== "0" };
}

type Uso = { input_tokens: number; output_tokens: number };

/** El `usage` de agy como el de Claude. Sin campos de caché: el numerito de la barra es del caché de Anthropic, no del de Gemini. */
const usoClaude = (u: Obj | undefined): Uso => ({ input_tokens: num(u?.input_tokens) ?? 0, output_tokens: (num(u?.output_tokens) ?? 0) + (num(u?.thinking_tokens) ?? 0) });

export type Opciones = {
  /** El id de sesión de Claude (el del líder en la barra): va en cada línea como `session_id`. */
  sid: string;
  /** El modelo que se dice en cada mensaje (el que se pidió, p. ej. `gemini-3.8-flash-low`). */
  modelo: string;
  /** Para los ids de mensaje y herramienta. */
  azar?: () => string;
};

/**
 * Traduce los eventos de UN turno de agy. `linea(obj)` devuelve las líneas del stream de Claude
 * (objetos) que corresponden; `fin(error)` cierra el turno si agy se fue sin decir `result`.
 */
export class Traductor {
  conversacion: string | null = null;
  /** El modelo que dijo agy en su `init` (si no, el pedido). */
  modelo: string;
  /** Lo que se dijo en el turno: el transcript lo escribe quien traduce (el puente). */
  private texto = new Map<number, { id: string; acumulado: string }>();
  private herramientas = new Map<number, { id: string; name: string; input: Obj; resultado: boolean }>();
  private usoTurno: Uso = { input_tokens: 0, output_tokens: 0 };
  private ultimaEntrada = 0;
  private cerrado = false;
  private readonly o: Opciones;

  constructor(o: Opciones) {
    this.o = o;
    this.modelo = o.modelo;
  }

  private id(prefijo: string, paso: number) {
    return `${prefijo}_${this.conversacion ?? this.o.sid}_${paso}`;
  }

  private base() {
    return { parent_tool_use_id: null, session_id: this.o.sid };
  }

  private ev(event: Obj): Obj {
    return { type: "stream_event", event, ...this.base() };
  }

  private mensaje(id: string, content: Obj[], usage: Uso | null): Obj {
    return { type: "assistant", message: { id, role: "assistant", model: this.modelo, content, ...(usage ? { usage } : {}) }, ...this.base() };
  }

  /** Un evento de agy → las líneas de Claude. */
  linea(o: Obj): Obj[] {
    if (!o || typeof o !== "object") return [];
    if (o.event === "init") {
      this.conversacion = str(o.conversation_id) ?? this.conversacion;
      return [];
    }
    if (o.event === "step_update" && o.step_update) return this.paso(o.step_update);
    if (o.event === "result" && o.result) return this.resultado(o.result);
    return [];
  }

  private paso(s: Obj): Obj[] {
    this.conversacion = str(s.conversation_id) ?? this.conversacion;
    const i = num(s.step_index) ?? 0;
    const hecho = s.state === "DONE";
    if (s.step_type === "agent_response") return this.respuesta(s, i, hecho);
    if (s.step_type === "tool") return this.herramienta(s, i, hecho);
    return [];
  }

  private respuesta(s: Obj, i: number, hecho: boolean): Obj[] {
    const out: Obj[] = [];
    const delta = typeof s.text_delta === "string" ? s.text_delta : "";
    let t = this.texto.get(i);
    if (s.usage) {
      // `input_tokens` de un paso es el contexto con el que contestó: el último manda.
      const u = usoClaude(s.usage);
      this.ultimaEntrada = u.input_tokens;
      this.usoTurno.output_tokens += u.output_tokens;
    }
    if (delta) {
      if (!t) {
        t = { id: this.id("msg_agy", i), acumulado: "" };
        this.texto.set(i, t);
        out.push(this.ev({ type: "message_start", message: { id: t.id, usage: { input_tokens: this.ultimaEntrada, output_tokens: 0 } } }));
        out.push(this.ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
      }
      t.acumulado += delta;
      out.push(this.ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } }));
    }
    if (hecho && t) {
      this.texto.delete(i);
      const completo = t.acumulado.replace(/\s+$/, "");
      out.push(this.ev({ type: "content_block_stop", index: 0 }));
      if (completo) {
        const u = s.usage ? usoClaude(s.usage) : null;
        out.push(this.mensaje(t.id, [{ type: "text", text: completo }], u));
      }
      out.push(this.ev({ type: "message_stop" }));
    }
    return out;
  }

  private herramienta(s: Obj, i: number, hecho: boolean): Obj[] {
    const out: Obj[] = [];
    const info = (s.tool_info ?? {}) as Obj;
    let h = this.herramientas.get(i);
    if (!h) {
      const traducida = herramientaClaude(str(s.tool_name) ?? str(info.name) ?? "?", info.parameters);
      h = { id: this.id("toolu_agy", i), name: traducida.name, input: traducida.input, resultado: false };
      this.herramientas.set(i, h);
      // Como el real: el bloque empieza (sólo el nombre) y después sale el mensaje entero con su entrada.
      out.push(this.ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: h.id, name: h.name, input: {} } }));
      out.push(this.mensaje(this.id("msg_agy_t", i), [{ type: "tool_use", id: h.id, name: h.name, input: h.input }], null));
    }
    if (hecho && !h.resultado) {
      h.resultado = true;
      const r = resultadoDe(info.output);
      out.push({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: h.id, content: r.texto, ...(r.error ? { is_error: true } : {}) }] },
        ...this.base(),
      });
    }
    return out;
  }

  private resultado(r: Obj): Obj[] {
    if (this.cerrado) return [];
    this.cerrado = true;
    const ok = r.status === "SUCCESS";
    const u = usoClaude(r.usage);
    const respuesta = str(r.response) ?? "";
    return [
      {
        type: "result",
        subtype: ok ? "success" : "error_during_execution",
        is_error: !ok,
        result: ok ? respuesta : respuesta || `agy: ${String(r.status ?? "error")}`,
        duration_ms: Math.round((num(r.duration_seconds) ?? 0) * 1000),
        num_turns: num(r.num_turns) ?? 1,
        // Lo último que entró es el contexto de ahora; lo que salió, la suma del turno.
        usage: { input_tokens: this.ultimaEntrada || u.input_tokens, output_tokens: u.output_tokens },
        modelUsage: { [this.modelo]: { contextWindow: VENTANA_GEMINI } },
        ...this.base(),
      },
    ];
  }

  /** agy se fue sin `result` (se cayó, o lo cortaron): el turno termina igual, con el motivo. */
  fin(error: string | null): Obj[] {
    if (this.cerrado) return [];
    this.cerrado = true;
    return [
      {
        type: "result",
        subtype: error ? "error_during_execution" : "success",
        is_error: !!error,
        result: error ?? "",
        usage: { input_tokens: this.ultimaEntrada, output_tokens: this.usoTurno.output_tokens },
        modelUsage: { [this.modelo]: { contextWindow: VENTANA_GEMINI } },
        ...this.base(),
      },
    ];
  }
}

/**
 * Las skills y comandos de los plugins habilitados de `agy` (`agy plugin list --json`),
 * con el prefijo `<plugin>:<skill>` que `agy -p` expande en sus prompts.
 */
export function comandosPluginAgy(json: string): { name: string; description: string; argumentHint: string | null }[] {
  let lista: unknown;
  try {
    lista = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(lista)) return [];
  const out: { name: string; description: string; argumentHint: string | null }[] = [];
  const vistos = new Set<string>();
  for (const p of lista) {
    if (!p || typeof p !== "object" || (p as Obj).enabled === false) continue;
    const plugin = str((p as Obj).name)?.trim() ?? null;
    for (const k of ["skills", "commands"] as const) {
      const items = (p as Obj)[k];
      for (const s of Array.isArray(items) ? items : []) {
        const raw = typeof s === "string" ? s.trim() : str((s as Obj)?.name)?.trim() ?? "";
        if (!raw || /\s/.test(raw)) continue;
        const name = plugin && !raw.includes(":") ? `${plugin}:${raw}` : raw;
        if (vistos.has(name)) continue;
        vistos.add(name);
        const desc =
          (typeof s === "object" && str((s as Obj)?.description)?.trim()) ||
          (plugin ? `Skill (${plugin})` : "Skill");
        const argumentHint = typeof s === "object" ? str((s as Obj)?.argumentHint)?.trim() ?? null : null;
        out.push({ name, description: desc, argumentHint });
      }
    }
  }
  return out;
}
