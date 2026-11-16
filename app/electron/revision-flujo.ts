// Lo que el revisor va diciendo mientras trabaja («Revisar con otro modelo»): el stream de `claude -p` y el de `agy`, leídos línea
// por línea y traducidos a pasos («leyendo X», «buscando Y») y al texto que va saliendo. Puro y sin Node: lo prueba
// tests/revision-plan.test.ts con líneas de verdad. El corredor que lanza al revisor está en revision-plan.ts.
import { herramientaClaude } from "./agy-stream.ts";
import { TEXTO_VIVO_MAX, type PasoRevision } from "./revision-plan-texto.ts";

/** Lo que aporta una línea del stream: un paso nuevo, el texto vivo (entero, ya recortado) o la respuesta final. */
export type Avance = { paso?: PasoRevision; texto?: string };

const recorte = (s: string, n = 90) => (s.length > n ? `…${s.slice(-n + 1)}` : s);
const cola = (s: string) => (s.length > TEXTO_VIVO_MAX ? s.slice(-TEXTO_VIVO_MAX) : s);

/** Una herramienta (al estilo de Claude Code) como paso del revisor; las que no se conocen van con su nombre. */
export function pasoDeHerramienta(nombre: string, input: unknown, home = ""): PasoRevision {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v ? v : "");
  const corto = (r: string) => recorte(home && r.startsWith(home) ? `~${r.slice(home.length)}` : r);
  switch (nombre) {
    case "Read":
      return { k: "leer", v: corto(s(i.file_path)) };
    case "Grep":
      return { k: "buscar", v: recorte(s(i.pattern)) };
    case "Glob":
      return { k: "buscar", v: recorte(s(i.pattern)) };
    case "LS":
      return { k: "listar", v: corto(s(i.path)) };
    default:
      return { k: "otro", v: nombre || "?" };
  }
}

/**
 * Lector del stream de `claude -p --output-format stream-json --include-partial-messages`: cada línea devuelve lo que aporta.
 * El texto vivo es el del mensaje en curso (cada `message_start` lo reinicia: lo anterior era un preámbulo antes de leer algo);
 * la respuesta final es el `result` (si sale con error, `falla` dice cuál).
 */
export class LectorClaude {
  private texto = "";
  final: string | null = null;
  falla: string | null = null;
  private readonly home: string;
  constructor(home = "") {
    this.home = home;
  }
  linea(linea: string): Avance | null {
    if (!linea.startsWith("{")) return null;
    let o: any;
    try {
      o = JSON.parse(linea);
    } catch {
      return null;
    }
    if (o?.type === "stream_event") {
      const e = o.event;
      if (e?.type === "message_start") this.texto = "";
      else if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && typeof e.delta.text === "string") {
        this.texto = cola(this.texto + e.delta.text);
        return { texto: this.texto };
      }
      return null;
    }
    if (o?.type === "assistant" && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) if (b?.type === "tool_use") return { paso: pasoDeHerramienta(String(b.name ?? ""), b.input, this.home) };
      return null;
    }
    if (o?.type === "result") {
      if (o.is_error || (typeof o.subtype === "string" && o.subtype !== "success")) this.falla = typeof o.result === "string" && o.result ? o.result : String(o.subtype ?? "error");
      else if (typeof o.result === "string") this.final = o.result;
    }
    return null;
  }
  /** Lo último que dijo, por si el stream no cerró con un `result`. */
  get ultimoTexto(): string {
    return this.texto;
  }
}

/** Lector del stream de `agy --output-format stream-json`: las herramientas son pasos y el `text_delta` del `agent_response`, el texto vivo. */
export class LectorAgy {
  private texto = "";
  private paso = -1;
  private vistos = new Set<number>();
  private readonly home: string;
  constructor(home = "") {
    this.home = home;
  }
  linea(linea: string): Avance | null {
    if (!linea.startsWith("{")) return null;
    let o: any;
    try {
      o = JSON.parse(linea);
    } catch {
      return null;
    }
    const u = o?.step_update;
    if (o?.event !== "step_update" || !u) return null;
    if (u.step_type === "agent_response") {
      if (u.step_index !== this.paso) {
        this.paso = u.step_index;
        this.texto = "";
      }
      if (typeof u.text_delta === "string" && u.text_delta) {
        this.texto = cola(this.texto + u.text_delta);
        return { texto: this.texto };
      }
      return null;
    }
    if (u.step_type === "tool" && !this.vistos.has(u.step_index)) {
      this.vistos.add(u.step_index);
      const nombre = String(u.tool_name ?? u.tool_info?.name ?? "");
      const h = herramientaClaude(nombre, u.tool_info?.parameters);
      return { paso: pasoDeHerramienta(h.name, h.input, this.home) };
    }
    return null;
  }
}
