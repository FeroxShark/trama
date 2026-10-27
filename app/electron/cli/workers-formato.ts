// Formateo de transcripts para `workers`: una línea por bloque de contenido. Reemplaza a los filtros jq de motor/bin/workers
// (FMT, FMT_AGY, FMT_CODEX, FMT_DSH, FMT_OC) con la misma salida, línea por línea. Cinco formatos:
//   claude    el .jsonl de Claude ({type: user|assistant, message.content[…]})
//   agy       el stream-json de agy (step_update…), que llega en deltas de un mismo paso
//   codex     el --json de codex (item.started / item.completed…)
//   dsh       el --json de dsh (session|status|thinking|text|tool_call|tool_result|final)
//   opencode  el --format json de opencode (step_start|text|reasoning|tool_use|step_finish|error)
// Como jq: un error de tipos en un evento deja lo que ese evento ya mostró y sigue con el próximo (en agy, que es un solo
// programa sobre todas las líneas, corta el resto); una línea que no es JSON corta el flujo de Claude y se saltea en los otros
// cuatro (`try fromjson catch empty`).

export type Colores = { D: string; B: string; R: string; C_TOOL: string; C_TXT: string; C_RES: string; C_HEAD: string; C_OK: string; C_WARN: string };
export type Formato = "claude" | "agy" | "codex" | "dsh" | "opencode";

export const SIN_COLOR: Colores = { D: "", B: "", R: "", C_TOOL: "", C_TXT: "", C_RES: "", C_HEAD: "", C_OK: "", C_WARN: "" };
export const CON_COLOR: Colores = { D: "\x1b[2m", B: "\x1b[1m", R: "\x1b[0m", C_TOOL: "\x1b[36m", C_TXT: "\x1b[38;5;250m", C_RES: "\x1b[38;5;244m", C_HEAD: "\x1b[35m", C_OK: "\x1b[32m", C_WARN: "\x1b[33m" };

export interface Formateador {
  /** Una línea del transcript (sin el salto); devuelve las líneas formateadas (sin salto). */
  linea(l: string): string[];
  /** Fin del transcript: lo que el formato guardaba (agy junta el texto de un paso hasta que cambia). */
  fin(): string[];
}

class ErrorJq extends Error {}

type Obj = Record<string, unknown>;
const esObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
/** `.k` de jq: null si falta; indexar algo que no es objeto ni null es un error (que ni `//` suprime). */
const g = (o: unknown, k: string): unknown => {
  if (o === null || o === undefined) return null;
  if (!esObj(o)) throw new ErrorJq("Cannot index");
  return o[k] ?? null;
};
const ge = g;
/** `a // b // c`: el primero que no sea null/false; si ninguno, el último. */
const alt = (...vs: unknown[]): unknown => {
  for (const v of vs.slice(0, -1)) if (v !== null && v !== undefined && v !== false) return v;
  return vs[vs.length - 1] ?? null;
};
/** `\(x)` de jq. */
const interp = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v ?? null));
const aTexto = (s: string) => s.replace(/[\r\t]/g, " ").replace(/\n/g, " ⏎ ").replace(/ +/g, " ");
const cortar = (s: string, n: number) => {
  const cs = Array.from(s);
  return cs.length > n ? cs.slice(0, n).join("") + "…" : s;
};

/** `limpio | corto($n)` de los filtros de Claude/agy/codex: sólo acepta texto (si no, jq falla). */
function corto(v: unknown, n: number): string {
  const x = v === null || v === undefined || v === false ? "" : v;
  if (typeof x !== "string") throw new ErrorJq("no es texto");
  return cortar(aTexto(x), n);
}
/** El `limpio | corto($n)` de dsh y opencode: lo que no es texto se pasa a JSON. */
function cortoJson(v: unknown, n: number): string {
  const x = v === null || v === undefined || v === false ? "" : v;
  return cortar(aTexto(typeof x === "string" ? x : JSON.stringify(x)), n);
}

const horaDe = (e: unknown) => {
  const ts = alt(g(e, "timestamp"), "");
  const s = typeof ts === "string" ? ts : interp(ts);
  return s.length > 0 ? Array.from(s).slice(11, 19).join("") : "--:--:--";
};

// ------------------------------------------------------------------------------------------------ claude

function* bloquesClaude(e: Obj): Generator<unknown> {
  const contenido = alt(g(g(e, "message"), "content"), []);
  if (typeof contenido === "string") yield { type: "text", text: contenido };
  else if (Array.isArray(contenido)) yield* contenido;
  else if (esObj(contenido)) yield* Object.values(contenido);
  else throw new ErrorJq("Cannot iterate");
}

function textoResultado(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((el) => {
        const t = g(el, "text");
        if (t !== null && t !== false) {
          if (typeof t === "string") return t;
          if (typeof t === "number") return String(t);
          throw new ErrorJq("join");
        }
        return "[" + interp(alt(ge(el, "type"), "?")) + "]";
      })
      .join(" ");
  }
  return JSON.stringify(content ?? null);
}

function eventoClaude(e: unknown, desde: string, c: Colores, pensar: boolean, salida: string[]): void {
  if (e === null) return;
  if (!esObj(e)) throw new ErrorJq("Cannot index");
  if (e.type !== "user" && e.type !== "assistant") return;
  const ts = alt(e.timestamp, "");
  if (desde !== "" && !(String(ts) >= desde)) return;
  const h = horaDe(e);
  for (const b of bloquesClaude(e)) {
    if (b === null) continue;
    if (!esObj(b)) throw new ErrorJq("Cannot index");
    if (b.type === "text" && e.type === "assistant") salida.push(`${h} ${c.C_TXT}· ${corto(b.text, 400)}${c.R}`);
    else if (b.type === "text") salida.push(`${h} ${c.C_HEAD}▸ ${corto(b.text, 300)}${c.R}`);
    else if (b.type === "thinking") {
      if (pensar) salida.push(`${h} ${c.D}~ ${corto(b.thinking, 300)}${c.R}`);
    } else if (b.type === "tool_use") {
      const arg = alt(g(b.input, "command"), g(b.input, "file_path"), g(b.input, "pattern"), g(b.input, "description"), g(b.input, "prompt"), interp(b.input));
      salida.push(`${h} ${c.C_TOOL}▶ ${interp(b.name)}${c.R} ${c.D}${corto(arg, 180)}${c.R}`);
    } else if (b.type === "tool_result") {
      salida.push(`${h}   ${c.C_RES}⤷ ${corto(textoResultado(b.content), 160)}${c.R}`);
    }
  }
}

// ------------------------------------------------------------------------------------------------ agy

function argAgy(s: Obj): string {
  const p = alt(g(g(s, "tool_info"), "parameters"), {});
  if (esObj(p)) {
    return corto(alt(p.CommandLine, p.Command, p.AbsolutePath, p.TargetFile, p.File, p.FilePath, p.Path, p.Query, p.Pattern, p.SearchPath, p.Url, p.URL, interp(p)), 180);
  }
  return corto(interp(p), 180);
}

function formateadorAgy(c: Colores): Formateador {
  const h = "--:--:--";
  let txt: string | null = null;
  let paso: unknown = null;
  let emit: string[] = [];
  const flush = () => {
    if (txt !== null && txt !== "") emit.push(`${h} ${c.C_TXT}· ${corto(txt, 400)}${c.R}`);
    txt = null;
    paso = null;
  };
  const procesar = (l: unknown) => {
    if (l === null) return flush();
    if (!esObj(l)) return;
    if (l.event === "init") emit.push(`${h} ${c.D}· agy ${interp(alt(g(l.init, "model"), "?"))}${c.R}`);
    else if (l.event === "step_update") {
      const s = alt(l.step_update, {}) as Obj;
      const tipo = g(s, "step_type");
      const delta = alt(g(s, "text_delta"), "");
      if (tipo === "agent_response" && delta !== "") {
        if (paso !== null && paso !== (g(s, "step_index") ?? null)) flush();
        paso = g(s, "step_index");
        txt = (txt ?? "") + interp(delta);
      } else if (tipo === "agent_response") flush();
      else if (tipo === "tool") {
        flush();
        if (g(s, "state") === "ACTIVE") emit.push(`${h} ${c.C_TOOL}▶ ${interp(alt(g(s, "tool_name"), g(g(s, "tool_info"), "name"), "?"))}${c.R} ${c.D}${argAgy(s)}${c.R}`);
        else {
          const o = alt(g(g(s, "tool_info"), "output"), "");
          emit.push(`${h}   ${c.C_RES}⤷ ${corto(typeof o === "string" ? o : JSON.stringify(o), 160)}${c.R}`);
        }
      } else flush();
    } else if (l.event === "result") {
      flush();
      if (g(l.result, "status") !== "SUCCESS") emit.push(`${h} ${c.C_HEAD}✗ agy: ${interp(alt(g(l.result, "status"), "?"))}${c.R}`);
    }
  };
  let roto = false;
  return {
    linea(raw) {
      if (roto) return [];
      let v: unknown;
      try {
        v = JSON.parse(raw);
      } catch {
        return [];
      }
      emit = [];
      try {
        procesar(v);
      } catch {
        roto = true; // error de tipos: el programa de jq termina; lo que esta línea iba a mostrar se pierde
        emit = [];
      }
      return emit;
    },
    fin() {
      emit = [];
      if (!roto) procesar(null);
      return emit;
    },
  };
}

// ------------------------------------------------------------------------------------------------ codex / dsh / opencode

function eventoCodex(o: Obj, c: Colores, pensar: boolean): string[] {
  const h = "--:--:--";
  const item = g(o, "item");
  if (o.type === "item.started" && g(item, "type") === "command_execution") return [`${h} ${c.C_TOOL}▶ Bash${c.R} ${c.D}${corto(g(item, "command"), 180)}${c.R}`];
  if (o.type === "item.completed") {
    const i = item;
    const t = g(i, "type");
    if (t === "agent_message") return [`${h} ${c.C_TXT}· ${corto(g(i, "text"), 400)}${c.R}`];
    if (t === "reasoning") return pensar ? [`${h} ${c.D}~ ${corto(g(i, "text"), 300)}${c.R}`] : [];
    if (t === "command_execution") {
      const rc = alt(g(i, "exit_code"), 0);
      return [`${h}   ${c.C_RES}⤷ ${rc !== 0 ? `[rc ${interp(g(i, "exit_code"))}] ` : ""}${corto(g(i, "aggregated_output"), 160)}${c.R}`];
    }
    if (t === "file_change") {
      const cs = g(i, "changes");
      const paths = (Array.isArray(cs) ? cs : []).map((x) => {
        const p = ge(x, "path");
        return p === null ? "" : interp(p);
      }).join(", ");
      return [`${h} ${c.C_TOOL}▶ Edit${c.R} ${c.D}${corto(paths, 180)}${c.R}`];
    }
    if (t === "mcp_tool_call") return [`${h} ${c.C_TOOL}▶ ${interp(alt(g(i, "server"), "mcp"))}/${interp(alt(g(i, "tool"), "?"))}${c.R}`];
    if (t === "web_search") return [`${h} ${c.C_TOOL}▶ WebSearch${c.R} ${c.D}${corto(g(i, "query"), 180)}${c.R}`];
    if (t === "error") return [`${h} ${c.C_HEAD}✗ ${corto(g(i, "message"), 300)}${c.R}`];
    return [];
  }
  if (o.type === "turn.failed") return [`${h} ${c.C_HEAD}✗ ${corto(alt(g(o.error, "message"), "turn.failed"), 300)}${c.R}`];
  if (o.type === "error") return [`${h} ${c.C_HEAD}✗ ${corto(o.message, 300)}${c.R}`];
  return [];
}

function eventoDsh(o: Obj, c: Colores, pensar: boolean): string[] {
  const h = "--:--:--";
  if (o.type === "session") return [`${h} ${c.D}· dsh ${interp(alt(o.sessionId, ""))}${c.R}`];
  if (o.type === "text") return [`${h} ${c.C_TXT}· ${cortoJson(o.text, 400)}${c.R}`];
  if (o.type === "thinking") return pensar ? [`${h} ${c.D}~ ${cortoJson(o.text, 300)}${c.R}`] : [];
  if (o.type === "tool_call") {
    const inp = alt(o.input, {});
    const arg = esObj(inp) ? alt(inp.command, inp.file_path, inp.path, inp.pattern, inp.url, inp.query, inp.description, JSON.stringify(inp)) : interp(inp);
    return [`${h} ${c.C_TOOL}▶ ${interp(alt(o.tool, "?"))}${c.R} ${c.D}${cortoJson(arg, 180)}${c.R}`];
  }
  if (o.type === "tool_result") {
    const st = alt(o.status, "completed");
    return [`${h}   ${c.C_RES}⤷ ${st !== "completed" ? `[${interp(o.status)}] ` : ""}${cortoJson(o.result, 160)}${c.R}`];
  }
  if (o.type === "status" && o.phase === "turn_end" && alt(g(o.reason, "kind"), "completed") !== "completed") {
    return [`${h} ${c.C_HEAD}✗ ${cortoJson(alt(g(g(o.reason, "error"), "message"), g(o.reason, "kind")), 300)}${c.R}`];
  }
  if (o.type === "result" && alt(o.is_error, false)) return [`${h} ${c.C_HEAD}✗ ${cortoJson(o.result, 300)}${c.R}`];
  return [];
}

function eventoOpencode(o: Obj, c: Colores, pensar: boolean, out: string[] = []): string[] {
  const h = "--:--:--";
  const part = g(o, "part");
  if (o.type === "text") return [`${h} ${c.C_TXT}· ${cortoJson(g(part, "text"), 400)}${c.R}`];
  if (o.type === "reasoning") return pensar ? [`${h} ${c.D}~ ${cortoJson(g(part, "text"), 300)}${c.R}`] : [];
  if (o.type === "tool_use") {
    const e = alt(g(part, "state"), {});
    const inp = alt(g(e, "input"), {});
    const arg = esObj(inp) ? alt(inp.command, inp.filePath, inp.path, inp.pattern, inp.url, inp.query, inp.description, JSON.stringify(inp)) : interp(inp);
    const st = alt(g(e, "status"), "completed");
    out.push(`${h} ${c.C_TOOL}▶ ${interp(alt(g(part, "tool"), "?"))}${c.R} ${c.D}${cortoJson(arg, 180)}${c.R}`);
    out.push(`${h}   ${c.C_RES}⤷ ${st !== "completed" ? `[${interp(g(e, "status"))}] ` : ""}${cortoJson(alt(g(e, "output"), g(e, "error"), ""), 160)}${c.R}`);
    return out;
  }
  if (o.type === "error") return [`${h} ${c.C_HEAD}✗ ${cortoJson(alt(g(g(o.error, "data"), "message"), g(o.error, "name"), "error"), 300)}${c.R}`];
  if (o.type === "result" && alt(o.is_error, false)) return [`${h} ${c.C_HEAD}✗ ${cortoJson(o.result, 300)}${c.R}`];
  return [];
}

// ------------------------------------------------------------------------------------------------ fábrica

/** `desde`: sólo para Claude, descarta los eventos con timestamp anterior (cuando el mismo jsonl trae turnos de corridas previas). */
export function crearFormateador(formato: Formato, c: Colores, o: { desde?: string; pensar?: boolean } = {}): Formateador {
  const pensar = !!o.pensar;
  if (formato === "agy") return formateadorAgy(c);
  if (formato === "claude") {
    let roto = false;
    return {
      linea(l) {
        if (roto || l.trim() === "") return [];
        let v: unknown;
        try {
          v = JSON.parse(l);
        } catch {
          roto = true; // jq aborta al primer JSON roto y no muestra más
          return [];
        }
        const out: string[] = [];
        try {
          eventoClaude(v, o.desde ?? "", c, pensar, out);
        } catch {
          /* error de tipos: se pierde el resto de ESTE evento y sigue con el próximo */
        }
        return out;
      },
      fin: () => [],
    };
  }
  return {
    linea(l) {
      let v: unknown;
      try {
        v = JSON.parse(l);
      } catch {
        return [];
      }
      if (!esObj(v)) return [];
      const out: string[] = [];
      try {
        if (formato === "opencode") {
          // el de tool_use son dos líneas: si la segunda falla, la primera ya salió
          const parcial: string[] = [];
          try {
            const r = eventoOpencode(v, c, pensar, parcial);
            if (r !== parcial) out.push(...r);
          } finally {
            out.push(...parcial);
          }
        } else out.push(...(formato === "codex" ? eventoCodex : eventoDsh)(v, c, pensar));
      } catch {
        /* error de tipos: sigue con el próximo evento */
      }
      return out;
    },
    fin: () => [],
  };
}

/** Qué formato tiene un transcript: por el modelo de la corrida si se sabe, y si no, mirando su primera línea (300 caracteres). */
export function formatoDe(modelo: string, primeraLinea: string): Formato {
  const m = modelo.toLowerCase();
  if (m.startsWith("codex:")) return "codex";
  if (m.startsWith("dsh:")) return "dsh";
  if (m.startsWith("opencode:")) return "opencode";
  if (m.startsWith("gemini") || m.startsWith("agy:")) return "agy";
  if (m.startsWith("claude-") || m.startsWith("ollama:")) return "claude";
  const p = primeraLinea.slice(0, 300);
  if (p.includes('"event":')) return "agy";
  if (p.includes('"type":"thread.started"') || p.includes('"type":"turn.started"')) return "codex";
  if (p.includes('"type":"session"')) return "dsh";
  if (p.includes('"type":"step_start"')) return "opencode";
  return "claude";
}
