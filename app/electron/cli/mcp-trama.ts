// mcp-trama — el servidor MCP de Trama para líderes y workers de cualquier motor (Claude, agy, codex, opencode): lanzar un worker
// (`pa <proyecto> --async`), ver el estado de los workers y buscar en el historial de hilos (`pa --hilos --json`), y dejarle un mensaje
// a otro líder por su cola (electron/cola.ts, por el socket local del motor: el canal `lider:encolarAgente` de nucleo.ts).
// stdio con JSON-RPC 2.0, un mensaje por línea (el transporte stdio de MCP), sin dependencias. Sin bash: en Windows `pa` se corre con
// node (`resolverComando` de binario.ts). Se anota solo en la config MCP de cada motor (electron/mcp-trama-registro.ts).
// Uso: `node mcp-trama.js` (lo lanza el motor; a mano no sirve de nada). Lo prueba tests/mcp-trama.test.ts con un `pa` de mentira.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { createInterface } from "node:readline";
import { entornoPa, resolverComando } from "../binario.ts";
import { carpetaMotor, homeDe, socketMotor } from "../rutas.ts";
import { esPrincipal } from "./base/principal.ts";

type Env = Record<string, string | undefined>;
type J = Record<string, unknown>;

export const VERSION_MCP = "1";
const PROTOCOLOS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** Lo de afuera: correr `pa` y pedirle algo al motor. Los tests lo cambian. */
export type Deps = {
  pa(args: string[], ms: number): Promise<{ rc: number; out: string; err: string }>;
  motor(canal: string, args: unknown[]): Promise<unknown>;
};

/** Corre `pa` (el de `HILOS_PA`, el del PATH o `~/.local/bin`; en Windows con node) y junta su salida. */
export function paReal(env: Env = process.env): Deps["pa"] {
  const home = homeDe(env);
  return (args, ms) =>
    new Promise((resolve) => {
      const [cmd, ...pre] = resolverComando("pa", "HILOS_PA", env, home);
      let out = "";
      let err = "";
      const p = spawn(cmd!, [...pre, ...args], { env: entornoPa(env, home) as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const t = setTimeout(() => p.kill(), ms);
      p.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
      p.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));
      p.on("error", (e) => {
        clearTimeout(t);
        resolve({ rc: 127, out, err: err + `no pude correr pa: ${e.message}\n` });
      });
      p.on("close", (rc) => {
        clearTimeout(t);
        resolve({ rc: rc ?? 1, out, err });
      });
    });
}

/** Un pedido al motor de Trama por su socket local (el mismo `/rpc` que la ventana: electron/remoto.ts). */
export function motorReal(env: Env = process.env): Deps["motor"] {
  const sock = socketMotor(carpetaMotor(env), env);
  const cliente = randomBytes(8).toString("hex");
  return (canal, args) =>
    new Promise((resolve, reject) => {
      const cuerpo = JSON.stringify({ canal, args });
      const req = http.request(
        { socketPath: sock, path: "/rpc", method: "POST", headers: { "content-type": "application/json", "x-trama-cliente": cliente, "content-length": Buffer.byteLength(cuerpo) } },
        (res) => {
          let t = "";
          res.on("data", (b: Buffer) => (t += b.toString("utf8")));
          res.on("end", () => {
            try {
              const r = JSON.parse(t) as { ok?: boolean; valor?: unknown; error?: string };
              if (r.ok) resolve(r.valor);
              else reject(new Error(r.error ?? `el motor contestó ${res.statusCode}`));
            } catch {
              reject(new Error(`el motor contestó ${res.statusCode}`));
            }
          });
        },
      );
      req.setTimeout(15_000, () => req.destroy(new Error("el motor no contestó")));
      req.on("error", (e: NodeJS.ErrnoException) =>
        reject(e.code === "ENOENT" || e.code === "ECONNREFUSED" ? new Error("Trama no está abierta (no hay un motor escuchando): el mensaje no salió") : e),
      );
      req.end(cuerpo);
    });
}

// ---------------------------------------------------------------- herramientas

const texto = (x: unknown) => (typeof x === "string" ? x.trim() : "");
const corto = (s: unknown, n: number) => {
  const t = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const SLUG = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
const SUELTO = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/;
const SID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const HERRAMIENTAS = [
  {
    name: "lanzar_worker",
    description:
      "Lanza un worker de pa en un proyecto (pa <proyecto> --async): vuelve enseguida con el id de la corrida. El resultado llega después como aviso de Trama, o con estado_workers.",
    inputSchema: {
      type: "object",
      properties: {
        proyecto: { type: "string", description: "El proyecto (slug o nombre del registry de pa)." },
        tarea: { type: "string", description: "La tarea completa para el worker." },
        modelo: { type: "string", description: "Opcional: el modelo (-m). Sin él, pa elige según --tipo y el cupo." },
        effort: { type: "string", description: "Opcional: el esfuerzo (--effort)." },
        tipo: { type: "string", description: "Opcional: el tipo de tarea (--tipo), para que pa elija el modelo." },
      },
      required: ["proyecto", "tarea"],
    },
  },
  {
    name: "estado_workers",
    description: "Los workers de pa (corridas recientes) con su estado, modelo, rama y resultado. Por defecto sólo los que siguen trabajando o en cola.",
    inputSchema: {
      type: "object",
      properties: {
        proyecto: { type: "string", description: "Opcional: sólo los de este proyecto." },
        todos: { type: "boolean", description: "También los que ya terminaron (de los últimos días)." },
      },
    },
  },
  {
    name: "buscar_hilos",
    description: "Busca en el historial de hilos (corridas de pa de todos los proyectos) por palabras en la tarea, el resultado, la decisión o la rama.",
    inputSchema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Las palabras a buscar (todas tienen que aparecer; sin importar mayúsculas)." },
        proyecto: { type: "string", description: "Opcional: sólo los de este proyecto." },
        limite: { type: "number", description: "Cuántos devolver como mucho (default 20, máximo 100)." },
      },
      required: ["texto"],
    },
  },
  {
    name: "mandar_mensaje",
    description:
      "Le deja un mensaje a otro líder de Trama: entra por su cola, como lo que escribe el usuario, y le llega cuando pueda recibirlo (a mitad de su turno o al terminar). Necesita Trama abierta.",
    inputSchema: {
      type: "object",
      properties: {
        sid: { type: "string", description: "El id de sesión del líder (el jefe_id de sus workers en estado_workers)." },
        texto: { type: "string", description: "El mensaje." },
      },
      required: ["sid", "texto"],
    },
  },
] as const;

class ErrorHerramienta extends Error {}
const falla = (m: string): never => {
  throw new ErrorHerramienta(m);
};

/** Una fila de `pa --hilos --json`, achicada para el modelo. */
function fila(h: J): J {
  return {
    id: h.id,
    proyecto: h.proyecto,
    estado: h.estado,
    ...(h.en_cola ? { en_cola: true } : {}),
    tarea: corto(h.tarea, 240),
    modelo: h.modelo ?? null,
    rama: h.rama ?? null,
    jefe: h.jefe ?? null,
    jefe_id: h.jefe_id ?? null,
    inicio: h.inicio ?? null,
    ...(h.resultado ? { resultado: h.resultado } : {}),
    ...(h.decision && !h.decision_nada ? { decision: corto(h.decision, 240) } : {}),
  };
}

async function hilos(d: Deps, todo: boolean): Promise<J[]> {
  const r = await d.pa(["--hilos", "--json", ...(todo ? ["--todo"] : [])], 60_000);
  if (r.rc !== 0) falla(`pa --hilos salió con ${r.rc}: ${corto(r.err, 400)}`);
  let v: unknown;
  try {
    v = JSON.parse(r.out);
  } catch {
    falla("pa --hilos no devolvió JSON");
  }
  const lista = Array.isArray(v) ? v : Array.isArray((v as J)?.hilos) ? ((v as J).hilos as unknown[]) : [];
  return lista.filter((x): x is J => !!x && typeof x === "object").sort((a, b) => Number(b.inicio ?? 0) - Number(a.inicio ?? 0));
}

const ACTIVOS = new Set(["trabajando", "colgado"]);

/** Corre una herramienta; devuelve el texto para el modelo (o tira con el motivo). */
export async function llamarHerramienta(nombre: string, a: J, d: Deps, env: Env = process.env): Promise<string> {
  if (nombre === "lanzar_worker") {
    const proyecto = texto(a.proyecto);
    const tarea = typeof a.tarea === "string" ? a.tarea.trim() : "";
    if (!SLUG.test(proyecto)) falla("proyecto inválido");
    if (!tarea) falla("falta la tarea");
    const extra: string[] = [];
    for (const [k, flag] of [["modelo", "-m"], ["effort", "--effort"], ["tipo", "--tipo"]] as const) {
      const v = texto(a[k]);
      if (!v) continue;
      if (!SUELTO.test(v)) falla(`${k} inválido: ${corto(v, 40)}`);
      extra.push(flag, v);
    }
    const r = await d.pa([proyecto, "--async", ...extra, "--", tarea], 120_000);
    const salida = [r.out.trim(), r.err.trim()].filter(Boolean).join("\n");
    if (r.rc !== 0) falla(`pa salió con ${r.rc}${salida ? `:\n${salida}` : ""}`);
    return salida || "lanzado";
  }
  if (nombre === "estado_workers") {
    const proyecto = texto(a.proyecto);
    const todos = a.todos === true;
    const l = (await hilos(d, false)).filter((h) => (!proyecto || h.proyecto === proyecto) && (todos || ACTIVOS.has(String(h.estado)) || h.en_cola === true));
    return JSON.stringify(l.slice(0, 60).map(fila), null, 1);
  }
  if (nombre === "buscar_hilos") {
    const palabras = texto(a.texto).toLowerCase().split(/\s+/).filter(Boolean);
    if (!palabras.length) falla("falta el texto a buscar");
    const proyecto = texto(a.proyecto);
    const limite = Math.max(1, Math.min(100, Math.floor(Number(a.limite) || 20)));
    const l = (await hilos(d, true)).filter((h) => {
      if (proyecto && h.proyecto !== proyecto) return false;
      const t = [h.id, h.proyecto, h.tarea, h.resultado, h.decision, h.sigue, h.rama].filter((x) => typeof x === "string").join("\n").toLowerCase();
      return palabras.every((p) => t.includes(p));
    });
    return JSON.stringify(l.slice(0, limite).map(fila), null, 1);
  }
  if (nombre === "mandar_mensaje") {
    const sid = texto(a.sid);
    const cuerpo = typeof a.texto === "string" ? a.texto.trim() : "";
    if (!SID.test(sid)) falla("sid inválido: tiene que ser el id de sesión de un líder");
    if (!cuerpo) falla("falta el texto");
    const de = texto(env.PA_JEFE) || texto(env.TRAMA_MCP_DE) || "otro agente";
    const r = (await d.motor("lider:encolarAgente", [{ sid, texto: `Mensaje de ${de} (por el MCP de Trama):\n\n${cuerpo}` }])) as J | null;
    return `encolado para ${typeof r?.nombre === "string" && r.nombre ? r.nombre : sid}: le llega cuando pueda recibirlo`;
  }
  return falla(`herramienta desconocida: ${nombre}`);
}

// ---------------------------------------------------------------- JSON-RPC

type Pedido = { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: unknown };

/** Atiende un mensaje; devuelve la respuesta (o null para una notificación). */
export async function atender(m: Pedido, d: Deps, env: Env = process.env): Promise<J | null> {
  const tieneId = m.id !== undefined && m.id !== null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  if (typeof m.method !== "string") return tieneId ? error(-32600, "pedido inválido") : null;
  const p = (m.params && typeof m.params === "object" ? m.params : {}) as J;
  switch (m.method) {
    case "initialize": {
      const pedido = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return ok({
        protocolVersion: PROTOCOLOS.includes(pedido) ? pedido : PROTOCOLOS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "trama", version: VERSION_MCP },
        instructions: "Trama: lanzar workers de pa, ver su estado, buscar en el historial de hilos y dejarle un mensaje a otro líder.",
      });
    }
    case "ping":
      return tieneId ? ok({}) : null;
    case "tools/list":
      return ok({ tools: HERRAMIENTAS });
    case "tools/call": {
      const nombre = typeof p.name === "string" ? p.name : "";
      if (!HERRAMIENTAS.some((h) => h.name === nombre)) return error(-32602, `herramienta desconocida: ${nombre}`);
      try {
        const t = await llamarHerramienta(nombre, (p.arguments && typeof p.arguments === "object" ? p.arguments : {}) as J, d, env);
        return ok({ content: [{ type: "text", text: t }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    default:
      if (m.method.startsWith("notifications/")) return null;
      return tieneId ? error(-32601, `método desconocido: ${m.method}`) : null;
  }
}

/** El servidor: lee de `entrada` un mensaje por línea y escribe cada respuesta en `salida`. Termina cuando se cierra la entrada. */
export function servir(entrada: NodeJS.ReadableStream, salida: (linea: string) => void, d: Deps, env: Env = process.env): Promise<void> {
  const rl = createInterface({ input: entrada, crlfDelay: Infinity });
  const pendientes = new Set<Promise<void>>();
  rl.on("line", (l) => {
    if (!l.trim()) return;
    let m: unknown;
    try {
      m = JSON.parse(l);
    } catch {
      salida(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }));
      return;
    }
    const lote = Array.isArray(m) ? m : [m];
    for (const x of lote) {
      const t = atender((x && typeof x === "object" ? x : {}) as Pedido, d, env).then(
        (r) => void (r && salida(JSON.stringify(r))),
        (e) => salida(JSON.stringify({ jsonrpc: "2.0", id: (x as Pedido)?.id ?? null, error: { code: -32603, message: String((e as Error)?.message ?? e) } })),
      );
      pendientes.add(t);
      void t.finally(() => pendientes.delete(t));
    }
  });
  return new Promise((resolve) => rl.on("close", () => void Promise.all(pendientes).then(() => resolve())));
}

if (esPrincipal(import.meta.url)) {
  await servir(process.stdin, (l) => process.stdout.write(l + "\n"), { pa: paReal(), motor: motorReal() });
}
