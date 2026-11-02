// El stream de un worker que no es de Claude (`<id>.stream.jsonl` de agy, codex, opencode y dsh) convertido a los mensajes de
// `pa --hilo` (el mismo contrato que el transcript de Claude). Es el port de JQ_HILO_STREAM de motor/bin/pa: si tocás uno, tocá
// el otro (lo controla tests/paridad). Primero cada línea da "ops", después las ops arman "items" (texto, herramienta, corte,
// uso) y al final los items se agrupan en mensajes del asistente: el texto primero, sus herramientas después; un texto que llega
// tras herramientas abre otro mensaje. Una línea que no parsea (la última, cortada a medio escribir) se salta. Sin timestamps por
// línea (agy, codex) el `ts` queda null: no se inventa. opencode sí trae `timestamp` (ms). El pedido (`tarea` e `inicio` del
// `.hilo`) es el primer mensaje, con la hora de inicio.
import { cortar, type J } from "./hilos.ts";

const esObj = (v: unknown): v is J => v !== null && typeof v === "object" && !Array.isArray(v);
/** `a // b` de jq: null y false caen a `b`. */
const alt = <T>(a: unknown, b: T): unknown => (a === null || a === undefined || a === false ? b : a);
/** `.x` de jq: lo que falta es null. */
const nul = (v: unknown): unknown => (v === undefined ? null : v);
const str = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v ?? null));

/** `(. / 1000 | floor | todate)`. */
const iso = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const hora = (v: unknown): string | null => (typeof v === "number" ? iso(v) : null);

const ALIAS_CLAVE: Record<string, string> = {
  CommandLine: "command",
  Command: "command",
  AbsolutePath: "file_path",
  TargetFile: "file_path",
  FilePath: "file_path",
  File: "file_path",
  filePath: "file_path",
  Path: "file_path",
  Query: "query",
  Pattern: "pattern",
  Url: "url",
  URL: "url",
};
const ALIAS_NOMBRE: Record<string, string> = {
  run_command: "Bash",
  read_file: "Read",
  edit_file: "Edit",
  write_file: "Write",
  shell: "Bash",
  edit: "Edit",
  write: "Write",
  read: "Read",
  grep: "Grep",
};
const nom = (n: unknown): string => {
  const s = String(n);
  return Object.hasOwn(ALIAS_NOMBRE, s) ? ALIAS_NOMBRE[s]! : s;
};

/** Los nombres de campo de cada motor llevados a los que ya entiende la vista; los textos largos se recortan a 2000. */
function ent(v: unknown): J {
  if (!esObj(v)) return {};
  const r: J = {};
  for (const [k, x] of Object.entries(v)) r[Object.hasOwn(ALIAS_CLAVE, k) ? ALIAS_CLAVE[k]! : k] = typeof x === "string" ? cortar(x, 0, 2000) : x;
  return r;
}

/** Del resultado de una herramienta se guarda el final: las últimas 15 líneas, hasta 1500 caracteres. */
function cola15(v: unknown): string {
  const t = (typeof v === "string" ? v : JSON.stringify(v ?? null)).replace(/\r/g, "").replace(/\n+$/, "");
  const j = t.split("\n").slice(-15).join("\n");
  const c = [...j];
  return c.length > 1500 ? c.slice(-1500).join("") : j;
}

const uso = (i: unknown, o: unknown, l: unknown, e: unknown) => ({
  input_tokens: alt(i, 0),
  output_tokens: alt(o, 0),
  cache_read_input_tokens: alt(l, 0),
  cache_creation_input_tokens: alt(e, 0),
});
const err300 = (v: unknown): string => cortar(str(alt(v, "?")), 0, 300);

type Op =
  | { op: "m"; modelo: unknown }
  | { op: "c" }
  | { op: "u"; u: J }
  | { op: "t"; step: unknown; txt: unknown; ts: string | null }
  | { op: "h"; id: unknown; nombre: string; entrada: J; ts: string | null }
  | { op: "r"; id: unknown; out: unknown; error: boolean };

const tx = (txt: unknown, ts: string | null = null, step: unknown = null): Op => ({ op: "t", step, txt, ts });
const he = (id: unknown, nombre: string, entrada: J, ts: string | null = null): Op => ({ op: "h", id: nul(id), nombre, entrada, ts });

/** Lo que dice una línea del stream (agy: `event`; opencode y codex: `type`). */
function ops(o: J): Op[] {
  if (o.event !== null && o.event !== undefined) {
    if (o.event === "init") return [{ op: "m", modelo: nul((o.init as J | undefined)?.model) }];
    if (o.event === "step_update") {
      const s = esObj(o.step_update) ? o.step_update : {};
      const info = esObj(s.tool_info) ? s.tool_info : {};
      if (s.step_type === "agent_response") {
        const r: Op[] = [];
        if (alt(s.text_delta, "") !== "") r.push(tx(s.text_delta, null, nul(s.step_index)));
        if (esObj(s.usage)) r.push({ op: "u", u: uso(s.usage.input_tokens, s.usage.output_tokens, s.usage.cache_read_tokens, 0) });
        return r;
      }
      if (s.step_type === "tool") {
        const r: Op[] = [he(s.step_index, nom(alt(s.tool_name, alt(info.name, "?"))), ent(alt(info.parameters, {})))];
        if (s.state !== "ACTIVE" && info.output !== null && info.output !== undefined)
          r.push({ op: "r", id: nul(s.step_index), out: info.output, error: typeof info.output === "string" && /^Command exited with code [1-9]/.test(info.output) });
        return r;
      }
      return [];
    }
    if (o.event === "result") {
      const r = esObj(o.result) ? o.result : {};
      return alt(r.status, "") !== "SUCCESS" ? [tx(`✗ agy: ${err300(alt(r.error, r.status))}`)] : [];
    }
    return [];
  }
  const tipo = o.type;
  if (typeof tipo !== "string") return [];
  const part = esObj(o.part) ? o.part : {};
  if (tipo === "step_start") return [{ op: "c" }];
  // opencode trae el texto en `part`; dsh, arriba (`{type:"text", text}`).
  if (tipo === "text") return [tx(alt(esObj(o.part) ? part.text : o.text, ""), hora(o.timestamp))];
  // dsh (DeepSeek Harness): status {phase, usage, reason}, tool_call {callId, tool, input}, tool_result {callId, status, result}.
  if (tipo === "status") {
    if (o.phase === "step_start") return [{ op: "c" }];
    const us = esObj(o.usage) ? o.usage : null;
    if (o.phase === "step_end" && us) return [{ op: "u", u: uso(us.inputTokens, us.outputTokens, us.cacheReadInputTokens, 0) }];
    const rz = esObj(o.reason) ? o.reason : {};
    if (o.phase === "turn_end" && alt(rz.kind, "completed") !== "completed")
      return [tx(`✗ ${err300(alt(esObj(rz.error) ? rz.error.message : undefined, rz.kind))}`)];
    return [];
  }
  if (tipo === "tool_call") return [he(o.callId, nom(alt(o.tool, "?")), ent(alt(o.input, {})))];
  if (tipo === "tool_result") return [{ op: "r", id: nul(o.callId), out: alt(o.result, ""), error: alt(o.status, "completed") !== "completed" }];
  if (tipo === "tool_use") {
    const e = esObj(part.state) ? part.state : {};
    const r: Op[] = [he(null, nom(alt(part.tool, "?")), ent(alt(e.input, {})), hora(o.timestamp))];
    const out = alt(e.output, e.error);
    if (out !== null && out !== undefined) r.push({ op: "r", id: null, out, error: alt(e.status, "completed") !== "completed" });
    return r;
  }
  if (tipo === "step_finish") {
    const k = esObj(part.tokens) ? part.tokens : {};
    return [{ op: "u", u: uso(k.input, k.output, (k.cache as J | undefined)?.read, (k.cache as J | undefined)?.write) }];
  }
  if (tipo === "error" && esObj(o.error)) {
    const d = esObj(o.error.data) ? o.error.data : {};
    return [tx(`✗ ${err300(alt(d.message, alt(o.error.name, "error")))}`, hora(o.timestamp))];
  }
  if (tipo.startsWith("item.")) {
    const i = esObj(o.item) ? o.item : {};
    if (tipo === "item.started" && i.type === "command_execution") return [he(i.id, "Bash", ent({ command: nul(i.command) }))];
    if (tipo !== "item.completed") return [];
    switch (i.type) {
      case "agent_message":
        return [tx(alt(i.text, ""))];
      case "command_execution":
        return [
          he(i.id, "Bash", ent({ command: nul(i.command) })),
          { op: "r", id: nul(i.id), out: alt(i.aggregated_output, ""), error: alt(i.exit_code, 0) !== 0 || i.status === "failed" },
        ];
      case "file_change": {
        const cs = Array.isArray(i.changes) ? i.changes : [];
        return [he(i.id, "Edit", ent({ file_path: cs.filter(esObj).map((c) => (c.path === null || c.path === undefined ? "" : String(c.path))).join(", ") }))];
      }
      case "mcp_tool_call":
        return [he(i.id, `${String(alt(i.server, "mcp"))}/${String(alt(i.tool, "?"))}`, ent(alt(i.arguments, {})))];
      case "web_search":
        return [he(i.id, "WebSearch", ent({ query: nul(i.query) }))];
      case "error":
        return [tx(`✗ ${err300(i.message)}`)];
      default:
        return [];
    }
  }
  if (tipo === "turn.completed") {
    const k = esObj(o.usage) ? o.usage : {};
    return [{ op: "u", u: uso(Number(alt(k.input_tokens, 0)) - Number(alt(k.cached_input_tokens, 0)), k.output_tokens, k.cached_input_tokens, 0) }];
  }
  if (tipo === "turn.failed") return [tx(`✗ ${err300(ruta2(o, "error", "message"))}`)];
  if (tipo === "error") return [tx(`✗ ${err300(o.message)}`)];
  return [];
}
const ruta2 = (o: J, a: string, b: string): unknown => (esObj(o[a]) ? (o[a] as J)[b] : undefined);

type Item =
  | { k: "c" }
  | { k: "u"; u: J }
  | { k: "t"; step: unknown; txt: string; ts: string | null }
  | { k: "h"; id: unknown; nombre: string; entrada: J; ts: string | null; resultado?: { texto: string; error: boolean } };

/** El último `h` (entre los 30 últimos items) con ese id; -1 si no hay. */
function idx(items: Item[], id: unknown): number {
  const n = items.length;
  for (let i = n - 1; i > Math.max(-1, n - 31); i--) {
    const x = items[i]!;
    if (x.k === "h" && x.id === id) return i;
  }
  return -1;
}

function itemsDe(objs: J[]): { items: Item[]; modelo: unknown } {
  const items: Item[] = [];
  let modelo: unknown = null;
  for (const o of objs)
    for (const p of ops(o)) {
      if (p.op === "m") modelo = p.modelo;
      else if (p.op === "c") items.push({ k: "c" });
      else if (p.op === "u") items.push({ k: "u", u: p.u });
      else if (p.op === "t") {
        const txt = typeof p.txt === "string" ? p.txt : "";
        if (txt === "") continue;
        const ult = items[items.length - 1];
        if (p.step !== null && ult && ult.k === "t" && ult.step === p.step) ult.txt += txt;
        else items.push({ k: "t", step: p.step, txt, ts: p.ts });
      } else if (p.op === "h") {
        if (p.id !== null && idx(items, p.id) !== -1) continue;
        items.push({ k: "h", id: p.id, nombre: p.nombre, entrada: p.entrada, ts: p.ts });
      } else {
        const j = idx(items, p.id);
        const x = items[j];
        if (j !== -1 && x && x.k === "h") x.resultado = { texto: cola15(p.out), error: p.error };
      }
    }
  return { items, modelo };
}

interface Borrador {
  textos: string[];
  det: J[];
  ts: string | null;
  usage: J | null;
}

const MARCAS = { meta: false, resumen_compact: false, origen: null, error_api: false, error: null };
const trim = (t: string) => t.replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");

/** Los mensajes del stream: el pedido (si lo hay) y los del asistente. Mismo molde que los del transcript de Claude. */
export function mensajesDeStream(texto: string, tarea: string, inicio: string, modeloHilo: string): J[] {
  const objs: J[] = [];
  for (const l of texto.split("\n")) {
    if (!l) continue;
    let o: unknown;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    if (esObj(o)) objs.push(o);
  }
  const { items, modelo } = itemsDe(objs);
  const ms: Borrador[] = [];
  let u: J | null = null;
  let cur = false;
  const nuevo = (ts: string | null) => {
    ms.push({ textos: [], det: [], ts, usage: u });
    cur = true;
  };
  for (const x of items) {
    if (x.k === "c") cur = false;
    else if (x.k === "u") {
      u = x.u;
      if (cur) ms[ms.length - 1]!.usage = x.u;
    } else if (x.k === "t") {
      if (!(cur && ms[ms.length - 1]!.det.length === 0)) nuevo(x.ts);
      ms[ms.length - 1]!.textos.push(x.txt);
    } else {
      if (!cur) nuevo(x.ts);
      ms[ms.length - 1]!.det.push({ nombre: x.nombre, entrada: x.entrada, ...(x.resultado ? { resultado: x.resultado } : {}) });
    }
  }
  const mod = nul(alt(modelo, modeloHilo === "" ? null : modeloHilo));
  const asistente: J[] = [];
  for (const m of ms) {
    const t = m.textos.map(trim).filter((x) => x !== "").join("\n");
    if (t === "" && m.det.length === 0) continue;
    asistente.push({
      rol: "assistant",
      ts: m.ts,
      modelo: mod,
      mid: null,
      usage: m.usage,
      imagenes: 0,
      herramientas: m.det.map((d) => d.nombre),
      herramientas_det: m.det,
      texto: t,
      ...MARCAS,
    });
  }
  const pedido: J[] =
    tarea === ""
      ? []
      : [
          {
            rol: "user",
            ts: /^[0-9]+$/.test(inicio) ? iso(Number(inicio) * 1000) : null,
            modelo: null,
            mid: null,
            usage: null,
            imagenes: 0,
            herramientas: [],
            herramientas_det: [],
            texto: tarea,
            ...MARCAS,
          },
        ];
  return [...pedido, ...asistente];
}
