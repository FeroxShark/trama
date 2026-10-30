// El .json de estado de una corrida de otro motor, con la forma del de `claude -p` (lo leen medir, --esperar, --hilos y la app),
// y el latido de los motores sin hooks. Copia de agy_a_json, codex_a_json, el arreglo del .json de un local (ollama),
// codex_latido y dsh_latido de motor/bin/pa. dsh y opencode no pasan por acá: su runner node (motor/dsh/correr.mjs,
// motor/opencode/correr.mjs) ya escribe el .json final.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { sinSaltosFinales } from "./prompt.ts";

type J = unknown;
type Obj = Record<string, J>;

const esObj = (x: J): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
/** `a // b` de jq: null y false cuentan como «no hay». */
const alt = <T>(a: J, b: T): J | T => (a === null || a === undefined || a === false ? b : a);
const hay = (a: J) => a !== null && a !== undefined && a !== false;
/** `.campo` de jq sobre algo que puede no ser un objeto (null en vez de error). */
const de = (x: J, ...ruta: string[]): J => {
  let v: J = x;
  for (const k of ruta) {
    if (!esObj(v)) return null;
    v = v[k];
  }
  return v === undefined ? null : v;
};
const num = (x: J): number => (typeof x === "number" ? x : 0);
const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** `jq` sin `-c`: dos espacios, y DEL escapado como lo escapa jq. */
export const comoJq = (v: J): string => JSON.stringify(v, null, 2).replace(/\x7f/g, "\\u007f");

/** `[split("\n")[] | fromjson? | objects]`: las líneas que son un objeto JSON. */
export function eventos(texto: string): Obj[] {
  const r: Obj[] = [];
  for (const l of texto.split("\n")) {
    if (!l.trim()) continue;
    try {
      const v = JSON.parse(l) as J;
      if (esObj(v)) r.push(v);
    } catch {
      /* fromjson? */
    }
  }
  return r;
}

/** `$(tail -c 2000 archivo)`: los últimos 2000 bytes, sin los saltos del final ("" si no se puede leer). */
export function colaDe(f: string, bytes = 2000): string {
  try {
    const b = readFileSync(f);
    return sinSaltosFinales(b.subarray(Math.max(0, b.length - bytes)).toString("utf8")).replace(/\0/g, "");
  } catch {
    return "";
  }
}
const leerSinFinal = (f: string) => {
  try {
    return sinSaltosFinales(readFileSync(f, "utf8")).replace(/\0/g, "");
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------- agy

/**
 * agy (stream-json) → el .json de pa: result, is_error, num_turns (respuestas del modelo), duration_ms, modelUsage (tokens de los
 * step_update.usage; input_tokens de agy NO incluye lo leído de caché: va aparte en cache_read_tokens, y hay steps con más caché que
 * input) y total_cost_usd 0 (cupo de Google AI Pro). Sin session_id.
 */
export function agyAJson(stream: string, err: string, modelo: string, rc: number): Obj {
  const ev = eventos(stream);
  const resultados = ev.filter((e) => e.event === "result").map((e) => (e.result === undefined ? null : e.result));
  const r: J = resultados.length ? resultados[resultados.length - 1] : null;
  const st = ev.map((e) => e.step_update).filter(esObj).filter((s) => s.state === "DONE");
  const u0 = st.map((s) => s.usage).filter(esObj);
  const ru = de(r, "usage");
  const u: J[] = u0.length > 0 ? u0 : hay(ru) ? [ru] : [];
  const errores = st.map((s) => de(s, "tool_info", "error", "message")).filter(hay);
  const ultError: J = errores.length ? errores[errores.length - 1] : null;
  const status = de(r, "status");
  const ids = ev.map((e) => e.conversation_id).filter(hay);
  return {
    type: "result",
    motor: "agy",
    subtype: alt(status, "") === "SUCCESS" ? "success" : "error",
    is_error: alt(status, "") !== "SUCCESS" || rc !== 0,
    result: alt(de(r, "response"), err !== "" ? err : alt(ultError, "")),
    num_turns: st.filter((s) => s.step_type === "agent_response").length,
    duration_ms: Math.floor(num(alt(de(r, "duration_seconds"), 0)) * 1000),
    total_cost_usd: 0,
    agy_conversation_id: alt(de(r, "conversation_id"), ids.length ? ids[0] : null),
    agy_status: alt(status, null),
    modelUsage:
      u.length === 0
        ? {}
        : {
            [modelo]: {
              // Sin restar la caché (agy ya la trae aparte); la red de abajo evita negativos si el stream trae algo raro.
              inputTokens: Math.max(0, suma(u.map((x) => num(alt(de(x, "input_tokens"), 0))))),
              cacheReadInputTokens: suma(u.map((x) => num(alt(de(x, "cache_read_tokens"), 0)))),
              cacheCreationInputTokens: 0,
              outputTokens: suma(u.map((x) => num(alt(de(x, "output_tokens"), 0)) + num(alt(de(x, "thinking_tokens"), 0)))),
            },
          },
  };
}

// ---------------------------------------------------------------- codex

/**
 * codex (`exec --json`) → el .json de pa: result (el último mensaje: el de --output-last-message o el último agent_message),
 * is_error (rc, turn.failed o error), num_turns (mensajes del modelo), modelUsage con los tokens de turn.completed (input_tokens
 * de codex incluye lo cacheado) y total_cost_usd 0 (suscripción de ChatGPT). Sin session_id.
 */
export function codexAJson(stream: string, err: string, modelo: string, rc: number, ultimo: string, segundos: number): Obj {
  const ev = eventos(stream);
  const msgs = ev
    .filter((e) => e.type === "item.completed")
    .map((e) => e.item)
    .filter(esObj)
    .filter((i) => i.type === "agent_message")
    .map((i) => i.text)
    .filter(hay);
  const u = ev.filter((e) => e.type === "turn.completed").map((e) => e.usage).filter(esObj);
  const fallos = [
    ...ev.filter((e) => e.type === "turn.failed").map((e) => de(e, "error", "message")).filter(hay),
    ...ev.filter((e) => e.type === "error").map((e) => de(e, "message")).filter(hay),
  ];
  const fallo: J = fallos.length ? fallos[fallos.length - 1] : null;
  const r: J = ultimo !== "" ? ultimo : alt(msgs.length ? msgs[msgs.length - 1] : null, "");
  const texto = (x: J) => (typeof x === "string" ? x : JSON.stringify(x));
  const hilo = ev.filter((e) => e.type === "thread.started").map((e) => e.thread_id).filter(hay);
  return {
    type: "result",
    motor: "codex",
    subtype: fallo === null && rc === 0 ? "success" : "error",
    is_error: fallo !== null || rc !== 0,
    result:
      fallo !== null
        ? [r, fallo]
            .filter((x) => x !== "")
            .map(texto)
            .join("\n")
        : r !== ""
          ? r
          : err,
    num_turns: msgs.length,
    duration_ms: segundos * 1000,
    total_cost_usd: 0,
    codex_thread_id: hilo.length ? hilo[0] : null,
    modelUsage:
      u.length === 0
        ? {}
        : {
            [modelo]: {
              inputTokens: suma(u.map((x) => num(alt(x.input_tokens, 0)) - num(alt(x.cached_input_tokens, 0)))),
              cacheReadInputTokens: suma(u.map((x) => num(alt(x.cached_input_tokens, 0)))),
              cacheCreationInputTokens: 0,
              outputTokens: suma(u.map((x) => num(alt(x.output_tokens, 0)))),
            },
          },
  };
}

// ---------------------------------------------------------------- escribir el .json al terminar

/** `agy_a_json stream err modelo rc >out`: sin el stream, jq falla y el .json queda vacío. */
export function escribirAgyJson(o: { transcript: string; err: string; modelo: string; rc: number; out: string }): void {
  const txt = existsSync(o.transcript) ? readFileSync(o.transcript, "utf8") : null;
  writeFileSync(o.out, txt === null ? "" : comoJq(agyAJson(txt, colaDe(o.err), o.modelo, o.rc)) + "\n");
}

/** `codex_a_json stream err modelo rc ultimo segundos >out`. */
export function escribirCodexJson(o: { transcript: string; err: string; modelo: string; rc: number; ultimo: string; segundos: number; out: string }): void {
  const txt = existsSync(o.transcript) ? readFileSync(o.transcript, "utf8") : null;
  writeFileSync(o.out, txt === null ? "" : comoJq(codexAJson(txt, colaDe(o.err), o.modelo, o.rc, leerSinFinal(o.ultimo), o.segundos)) + "\n");
}

/** Un local: el .json de claude dice motor "ollama", el modelo de pa (ollama:…) y no cuesta US$ (el CLI podría inventar un precio). */
export function arreglarJsonOllama(out: string, modelo: string): void {
  let v: J;
  try {
    v = JSON.parse(readFileSync(out, "utf8")) as J;
  } catch {
    return;
  }
  if (!esObj(v)) return;
  const tmp = `${out}.tmp`;
  try {
    writeFileSync(tmp, comoJq({ ...v, motor: "ollama", modelo_local: modelo, total_cost_usd: 0 }) + "\n");
    renameSync(tmp, out);
  } catch {
    /* queda el de claude */
  }
}

// ---------------------------------------------------------------- latido (codex y dsh no tienen hooks)

/** `tail -n N`: las últimas N líneas (la última puede no tener salto). */
function ultimasLineas(texto: string, n: number): string[] {
  const ls = texto.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  return ls.slice(-n);
}
/** `jq -s` sobre esas líneas: todos los valores, o null si alguno no es JSON (jq falla entero). */
function valores(ls: string[]): J[] | null {
  const r: J[] = [];
  for (const l of ls) {
    if (!l.trim()) continue;
    try {
      r.push(JSON.parse(l) as J);
    } catch {
      return null;
    }
  }
  return r;
}
/** `tostring` de jq. */
const aTexto = (x: J) => (typeof x === "string" ? x : JSON.stringify(x));
const ultimo = (xs: string[]) => (xs.length ? xs[xs.length - 1]! : "");

/** Lo último que hizo un worker de codex: el comando, el texto o el tipo del último item del stream. */
export function descCodex(stream: string): string {
  const vs = valores(ultimasLineas(stream, 5));
  if (!vs) return "";
  const xs: string[] = [];
  for (const v of vs) {
    const item = esObj(v) ? v.item : null;
    if (!esObj(item)) continue;
    const x = alt(item.command, alt(item.text, item.type));
    if (hay(x)) xs.push(aTexto(x));
  }
  return sinSaltosFinales(ultimo(xs));
}

const primero = (...xs: J[]) => {
  for (const x of xs) if (hay(x)) return x;
  return "";
};
/** Lo último que hizo un worker de dsh u opencode: la herramienta y su argumento, el texto, o «pensando». */
export function descDsh(stream: string): string {
  const vs = valores(ultimasLineas(stream, 8));
  if (!vs) return "";
  const xs: string[] = [];
  for (const v of vs) {
    if (!esObj(v)) continue;
    let x: J;
    if (v.type === "tool_call") {
      const i = v.input;
      x = `${aTexto(alt(v.tool, ""))} ${aTexto(primero(de(i, "command"), de(i, "file_path"), de(i, "path"), de(i, "pattern")))}`;
    } else if (v.type === "tool_use") {
      const i = de(v, "part", "state", "input");
      x = `${aTexto(alt(de(v, "part", "tool"), ""))} ${aTexto(primero(de(i, "command"), de(i, "filePath"), de(i, "path"), de(i, "pattern")))}`;
    } else if (v.type === "text") x = alt(v.text, alt(de(v, "part", "text"), ""));
    else if (v.type === "thinking" || v.type === "reasoning") x = "pensando";
    else continue;
    xs.push(aTexto(x));
  }
  return sinSaltosFinales(ultimo(xs));
}

/** El archivo de latido (`$hb`): epoch, tool, envuelo=1 y desc (sin saltos ni tabs, cortado a 160 caracteres como `cut -c`). */
export function escribirLatido(hb: string, tool: string, desc: string, ahora = Math.floor(Date.now() / 1000)): void {
  const d = Array.from(desc.replace(/[\n\r\t]/g, " ")).slice(0, 160).join("");
  const tmp = `${hb}.tmp`;
  try {
    writeFileSync(tmp, `epoch=${ahora}\ntool=${tool}\nenvuelo=1\ndesc=${d}\n`);
    renameSync(tmp, hb);
  } catch {
    /* sin latido esta vuelta */
  }
}

/** Una vuelta del latido: lee el transcript y escribe `$hb`. */
export function latir(motor: "codex" | "dsh" | "opencode", transcript: string, hb: string): void {
  let txt = "";
  try {
    txt = readFileSync(transcript, "utf8");
  } catch {
    txt = "";
  }
  escribirLatido(hb, motor, motor === "codex" ? descCodex(txt) : descDsh(txt));
}
