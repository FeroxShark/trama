#!/usr/bin/env node
// El runner de un WORKER de pa con DeepSeek Harness (`dsh`): lo llama `motor/bin/pa` para el motor `dsh` (como `codex exec` para
// codex). Corre `dsh --profile headless --json` en el worktree, copia su NDJSON al transcript de la corrida y deja el .json
// final con la forma de `codex_a_json` / `agy_a_json` (lo que `pa` mide, muestra y le pasa al jefe).
//
//   node correr.mjs --modelo dsh:<proveedor>/<modelo> --cwd <worktree> --stream <ndjson> --salida <json> [--url <baseURL>] [--imagenes] [--max-pasos N] -- "<tarea>"
//
//   --modelo   dsh:ollama/<modelo> | dsh:opencode/<modelo> | dsh:deepseek/<modelo>
//   --cwd      el worktree (dsh escribe sólo ahí: DSH_PERMISSION_MODE=workspace-write)
//   --stream   acá se copia el NDJSON de dsh a medida que sale (el «transcript» de la corrida)
//   --salida   acá queda el JSON final (se escribe siempre, también si falla)
//   --url      otra baseURL para el proveedor (Ollama en otra máquina)
//   --max-pasos N         tope de pasos del modelo (cada vuelta al modelo cuenta uno; el equivalente de --max-turns de pa): al arrancar el N+1 se
//                         corta a dsh y el .json queda con subtype "error_max_turns" (pa lo trata como el worker que se quedó sin turnos)
//   --tarea-archivo <f>   la tarea sale de un archivo (si no cabe en argv); también sirve `-- -` (stdin)
//
// Salida (`--salida`): { type:"result", motor:"dsh", subtype, is_error, result, num_turns, duration_ms, total_cost_usd, dsh_session_id,
// modelUsage:{<modelo>:{inputTokens,cacheReadInputTokens,cacheCreationInputTokens,outputTokens}} }. `total_cost_usd` es 0 para
// ollama y opencode (gratis); con deepseek no se pone (no se sabe el precio).
// Exit: 0 bien; 1 falló dsh o el modelo (el motivo, por stderr y en `result`); 2 argumentos; 127 no hay `dsh`.
// Entorno: HILOS_DSH (el binario), DSH_HOME (default ~/.local/share/trama/dsh), DEEPSEEK_API_KEY / OPENCODE_API_KEY.
// Sin imports de app/: pa corre sin la app. app/electron/dsh.ts duplica a propósito motor/dsh/config.mjs.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { entornoDsh, escribirParche, falta, parsearModelo, resolverDsh } from "./config.mjs";

function argumentos(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      o._ = argv.slice(i + 1);
      break;
    }
    if (a === "--imagenes") o.imagenes = true;
    else if (a.startsWith("--") && i + 1 < argv.length) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}

function morir(codigo, texto, salida, extra = {}) {
  process.stderr.write(`dsh/correr: ${texto}\n`);
  if (salida) escribirSalida(salida, { type: "result", motor: "dsh", subtype: "error", is_error: true, result: texto, num_turns: 0, duration_ms: 0, ...extra });
  process.exit(codigo);
}

function escribirSalida(archivo, o) {
  try {
    mkdirSync(path.dirname(archivo), { recursive: true });
    writeFileSync(archivo, JSON.stringify(o) + "\n");
  } catch (e) {
    process.stderr.write(`dsh/correr: no se pudo escribir ${archivo}: ${e.message}\n`);
  }
}

/** Los eventos de `--json` de dsh → el JSON de estado de pa. */
export function aResultado({ eventos, modelo, rc, stderr, segundos, gratis, truncado = 0 }) {
  const pasos = eventos.filter((e) => e.type === "status" && e.phase === "step_end");
  const fin = eventos.findLast?.((e) => e.type === "final") ?? [...eventos].reverse().find((e) => e.type === "final");
  const turnoFin = [...eventos].reverse().find((e) => e.type === "status" && e.phase === "turn_end");
  const textos = eventos.filter((e) => e.type === "text" && typeof e.text === "string").map((e) => e.text);
  const razon = turnoFin?.reason;
  const fallo = razon && razon.kind !== "completed" ? (razon.error?.message ?? razon.kind) : null;
  const dicho = (typeof fin?.text === "string" && fin.text) || textos.at(-1) || "";
  const error = truncado > 0 || rc !== 0 || !fin || fallo !== null;
  const motivo = truncado > 0 ? `se llegó al tope de ${truncado} pasos del modelo (--max-pasos)` : fallo ?? (stderr.trim() ? stderr.trim().split("\n").slice(-3).join(" · ") : null) ?? (rc !== 0 ? `dsh salió con el código ${rc}` : "dsh no devolvió respuesta");
  const suma = (k) => pasos.reduce((n, e) => n + (Number(e.usage?.[k]) || 0), 0);
  const sesion = eventos.find((e) => e.type === "session")?.sessionId ?? null;
  return {
    type: "result",
    motor: "dsh",
    subtype: truncado > 0 ? "error_max_turns" : error ? "error" : "success",
    is_error: error,
    result: error ? [dicho, motivo].filter(Boolean).join("\n") : dicho,
    num_turns: pasos.length,
    duration_ms: Math.round(segundos * 1000),
    ...(gratis ? { total_cost_usd: 0 } : {}),
    dsh_session_id: sesion,
    modelUsage: pasos.length ? { [modelo]: { inputTokens: suma("inputTokens"), cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: suma("outputTokens") } } : {},
  };
}

async function main() {
  const a = argumentos(process.argv.slice(2));
  const salida = a.salida ?? null;
  const modeloPa = a.modelo ?? "";
  const prov = parsearModelo(modeloPa);
  if (!prov) morir(2, `--modelo «${modeloPa}» no es de dsh (dsh:<ollama|opencode|deepseek>/<modelo>)`, salida);
  if (!a.cwd) morir(2, "falta --cwd", salida);
  if (!a.stream) morir(2, "falta --stream", salida);
  if (!salida) morir(2, "falta --salida", null);
  let tarea = a._.join(" ");
  if (a["tarea-archivo"]) tarea = readFileSync(a["tarea-archivo"], "utf8");
  else if (tarea === "-") tarea = readFileSync(0, "utf8");
  if (!tarea.trim()) morir(2, "falta la tarea (después de --)", salida);
  const falto = falta(prov.proveedor, process.env);
  if (falto) morir(1, `falta ${falto} para usar ${modeloPa}`, salida);

  const env = entornoDsh(prov.proveedor, process.env, os.homedir());
  mkdirSync(env.DSH_HOME, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-dsh-"));
  const parche = path.join(tmp, "cordis.patch.yml");
  writeFileSync(parche, escribirParche({ ...prov, baseURL: a.url || process.env.TRAMA_DSH_URL || undefined, imagenes: !!a.imagenes }));
  mkdirSync(path.dirname(a.stream), { recursive: true });
  writeFileSync(a.stream, "");

  // Los flags del launcher (--profile, --patch) van ANTES de los de la app (--json) y de la tarea; la tarea siempre por stdin
  // (`-`): cabe cualquier largo, no se confunde con un flag y no se ve en `ps`.
  const dsh = resolverDsh(process.env, os.homedir());
  const t0 = Date.now();
  const maxPasos = Number.parseInt(a["max-pasos"] ?? "", 10) > 0 ? Number.parseInt(a["max-pasos"], 10) : 0;
  let truncado = 0;
  const hijo = spawn(dsh, ["--profile", "headless", "--patch", parche, "--json", "-"], { cwd: a.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const eventos = [];
  let resto = "";
  let stderr = "";
  const linea = (l) => {
    if (!l.trim()) return;
    try {
      appendFileSync(a.stream, l + "\n");
    } catch {
      /* sin transcript la corrida sigue */
    }
    try {
      const e = JSON.parse(l);
      if (e && typeof e === "object") {
        eventos.push(e);
        // El tope de pasos: si arranca el paso N+1 se corta a dsh (si el N-ésimo era el último, termina solo y no se toca).
        if (maxPasos && !truncado && e.type === "status" && e.phase === "step_start" && eventos.filter((x) => x.type === "status" && x.phase === "step_end").length >= maxPasos) {
          truncado = maxPasos;
          hijo.kill("SIGTERM");
        }
      }
    } catch {
      /* ruido que no es un evento */
    }
  };
  hijo.stdout.setEncoding("utf8");
  hijo.stdout.on("data", (t) => {
    resto += t;
    const i = resto.lastIndexOf("\n");
    if (i < 0) return;
    const ls = resto.slice(0, i).split("\n");
    resto = resto.slice(i + 1);
    ls.forEach(linea);
  });
  hijo.stderr.setEncoding("utf8");
  hijo.stderr.on("data", (t) => {
    stderr = (stderr + t).slice(-4000);
    process.stderr.write(t);
  });
  hijo.stdin.on("error", () => {});
  hijo.stdin.end(tarea);
  // pa corta al worker con TERM (timeout, Ctrl-C): se le pasa a dsh y se sale con 143 dejando el .json.
  for (const s of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(s, () => hijo.kill("SIGTERM"));

  const rc = await new Promise((ok) => {
    hijo.on("error", (e) => {
      stderr += `no se pudo lanzar ${dsh}: ${e.message}`;
      ok(e.code === "ENOENT" ? 127 : 1);
    });
    hijo.on("close", (codigo, senal) => ok(codigo ?? (senal === "SIGTERM" ? 143 : 1)));
  });
  if (resto.trim()) linea(resto);
  rmSync(tmp, { recursive: true, force: true });

  const r = aResultado({ eventos, modelo: modeloPa, rc, stderr, segundos: (Date.now() - t0) / 1000, gratis: prov.proveedor !== "deepseek", truncado });
  escribirSalida(salida, r);
  if (rc === 127) process.stderr.write("dsh/correr: no está dsh (npm i -g @deepseek-ai/dsh, o HILOS_DSH=<ruta>)\n");
  else if (r.is_error) process.stderr.write(`dsh/correr: la corrida falló: ${r.result.split("\n").at(-1)}\n`);
  process.exit(r.is_error ? (rc === 0 || truncado ? 1 : rc) : 0);
}


if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
