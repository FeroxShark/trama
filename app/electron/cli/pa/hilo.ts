// `pa --hilo <id> [--json] [-n N] [--antes N]` (cmd_hilo de motor/bin/pa): los mensajes del transcript de una corrida (user y asistente,
// sin sidechain ni tool_result; los tool_use de un mismo mensaje van juntos), los N últimos (default 50) antes del índice --antes.
// `usage`/`modelo` = los del último mensaje del asistente. Lectura pura; el jq del bash está acá en TypeScript.
import { readFileSync } from "node:fs";
import path from "node:path";
import { proyectoDeId } from "./corridas.ts";
import type { Pa } from "./entorno.ts";
import { leerLineaSid } from "./hilo-sid.ts";
import { comoString, cortar, ruta, transcriptDe, type J } from "./hilos.ts";

const USO = "uso: pa --hilo <id> [--json] [-n N] [--antes N]\n";
const esObj = (v: unknown): v is J => v !== null && typeof v === "object" && !Array.isArray(v);

interface Msg extends J {
  rol: string;
  texto: string;
  herramientas: unknown[];
  herramientas_det: unknown[];
  imagenes: number;
  mid: unknown;
  usage: unknown;
  modelo: unknown;
  error_api: boolean;
  error: unknown;
}

/** `join` de jq: null → "", el resto como texto. */
const textoDe = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));

/** `(.input // {}) | if object then with_entries(.value |= (string → .[0:2000])) else {} end`. */
function entrada(inp: unknown): J {
  if (!esObj(inp)) return {};
  const r: J = {};
  for (const [k, v] of Object.entries(inp)) r[k] = typeof v === "string" ? cortar(v, 0, 2000) : v;
  return r;
}

/** Los mensajes del transcript ya armados y con los fragmentos de un mismo mensaje del asistente juntos. */
function mensajes(texto: string): Msg[] {
  const sueltos: Msg[] = [];
  for (const l of texto.split("\n")) {
    if (!l) continue;
    let o: unknown;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    if (!esObj(o) || o.isSidechain === true) continue;
    const tipo = o.type;
    if (!(tipo === "user" || tipo === "assistant" || (tipo === "system" && o.subtype === "compact_boundary"))) continue;
    const marcas = {
      meta: o.isMeta === true,
      resumen_compact: o.isCompactSummary === true,
      origen: ruta(o, "origin", "kind") ?? null,
      error_api: o.isApiErrorMessage === true,
      error: o.error === undefined || o.error === false ? null : o.error,
    };
    const contenido = ruta(o, "message", "content");
    const bloques = Array.isArray(contenido) ? contenido : [];
    let m: J;
    if (tipo === "system") {
      const c = o.content === undefined || o.content === null || o.content === false ? "" : o.content;
      m = {
        rol: "system",
        subtipo: o.subtype,
        ts: o.timestamp ?? null,
        modelo: null,
        mid: null,
        usage: null,
        herramientas: [],
        herramientas_det: [],
        imagenes: 0,
        texto: typeof c === "string" ? c : comoString(c),
      };
    } else if (tipo === "user") {
      m = {
        rol: "user",
        ts: o.timestamp ?? null,
        modelo: null,
        mid: null,
        usage: null,
        herramientas: [],
        herramientas_det: [],
        imagenes: bloques.filter((b) => esObj(b) && b.type === "image").length,
        texto: typeof contenido === "string" ? contenido : bloques.filter((b) => esObj(b) && b.type === "text").map((b) => textoDe((b as J).text)).join("\n"),
      };
    } else {
      const usos = bloques.filter((b): b is J => esObj(b) && b.type === "tool_use");
      m = {
        rol: "assistant",
        ts: o.timestamp ?? null,
        modelo: ruta(o, "message", "model") ?? null,
        mid: ruta(o, "message", "id") ?? null,
        usage: ruta(o, "message", "usage") ?? null,
        imagenes: 0,
        herramientas: usos.map((b) => b.name ?? null),
        herramientas_det: usos.map((b) => ({ nombre: b.name ?? null, entrada: entrada(b.input) })),
        texto: bloques.filter((b) => esObj(b) && b.type === "text").map((b) => textoDe((b as J).text)).join("\n"),
      };
    }
    const f = { ...m, ...marcas } as unknown as Msg;
    if (f.rol !== "user" || f.texto !== "" || f.imagenes > 0) sueltos.push(f);
  }
  const juntos: Msg[] = [];
  for (const m of sueltos) {
    const ult = juntos[juntos.length - 1];
    if (m.rol === "assistant" && ult && ult.rol === "assistant" && m.mid !== null && ult.mid === m.mid) {
      ult.texto = [ult.texto, m.texto].filter((x) => x !== "").join("\n");
      ult.herramientas = [...ult.herramientas, ...m.herramientas];
      ult.herramientas_det = [...ult.herramientas_det, ...m.herramientas_det];
      ult.usage = m.usage ?? ult.usage;
      ult.modelo = m.modelo ?? ult.modelo;
      ult.error_api = ult.error_api || m.error_api;
      ult.error = m.error ?? ult.error;
    } else juntos.push(m);
  }
  return juntos.filter((m) => m.rol !== "assistant" || m.texto !== "" || m.herramientas.length > 0);
}

export function cmdHilo(pa: Pa, args: string[]): number {
  const { io } = pa;
  const id = args[0] ?? "";
  if (!id || id.startsWith("-")) {
    io.err(USO);
    return 2;
  }
  let n = "50";
  let antes = "";
  const r = args.slice(1);
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    if (a === "--json") continue;
    if (a === "-n" || a === "--antes") {
      // el bash hace `shift` dos veces: con la opción de última, el segundo falla bajo `set -e` y sale 1 sin decir nada
      if (i + 1 >= r.length) return 1;
      if (a === "-n") n = r[++i]!;
      else antes = r[++i]!;
    }
    else {
      io.err(USO);
      return 2;
    }
  }
  if (!(/^[0-9]+$/.test(n) && (antes === "" || /^[0-9]+$/.test(antes)))) {
    io.err("pa: --hilo: -n y --antes son números.\n");
    return 2;
  }
  const s = proyectoDeId(pa.state, id);
  if (!s) {
    io.err(`pa: no encuentro la corrida '${id}' en ${pa.state}.\n`);
    return 1;
  }
  const d = path.join(pa.state, s);
  const t = transcriptDe(pa, leerLineaSid(d, id));
  let texto = "";
  if (t) {
    try {
      texto = readFileSync(t, "utf8");
    } catch {
      texto = "";
    }
  }
  const todos = t ? mensajes(texto) : [];
  const total = todos.length;
  const hasta = Math.min(total, antes === "" ? total : Number(antes));
  const desde = Math.max(0, hasta - Number(n));
  const asist = todos.filter((m) => m.rol === "assistant");
  const ult = asist[asist.length - 1];
  const salida = {
    version: 1,
    id,
    proyecto: s,
    transcript: t || null,
    total,
    desde,
    hasta,
    mensajes: todos.slice(desde, hasta).map((m, k) => ({
      i: desde + k,
      rol: m.rol,
      texto: m.texto,
      herramientas: m.herramientas,
      ts: m.ts ?? null,
      modelo: m.modelo ?? null,
      herramientas_det: m.herramientas_det,
      imagenes: m.imagenes,
      meta: m.meta,
      resumen_compact: m.resumen_compact,
      origen: m.origen,
      error_api: m.error_api,
      error: m.error,
      ...(m.rol === "system" ? { subtipo: m.subtipo ?? null } : {}),
    })),
    usage: ult?.usage ?? null,
    modelo: ult?.modelo ?? null,
  };
  io.out(`${JSON.stringify(salida, null, 2)}\n`);
  return 0;
}
