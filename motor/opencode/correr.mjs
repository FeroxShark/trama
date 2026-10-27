#!/usr/bin/env node
// El runner de un WORKER de pa con el programa `opencode`: lo llama `motor/bin/pa` para el motor `opencode` (como `codex exec` para codex
// o motor/dsh/correr.mjs para dsh). Corre `opencode run --format json -m <proveedor>/<modelo>` en el worktree, copia su NDJSON al transcript
// de la corrida y deja el .json final con la forma de `codex_a_json` / `dsh/correr.mjs` (lo que `pa` mide, muestra y le pasa al jefe).
//
//   node correr.mjs --modelo opencode:<proveedor>/<modelo> --cwd <worktree> --stream <ndjson> --salida <json> [--effort <nivel>] [--max-pasos N] -- "<tarea>"
//
//   --effort   nivel de razonamiento del modelo (se pasa como `--variant` a opencode); sin él, el del modelo
//   --modelo   opencode:<proveedor>/<modelo> (lo que imprime `opencode models`, con el prefijo)
//   --cwd      el worktree (opencode rechaza solo lo que sale de ahí: `run` rechaza los permisos que no están permitidos)
//   --stream   acá se copia el NDJSON de opencode a medida que sale (el «transcript» de la corrida)
//   --salida   acá queda el JSON final (se escribe siempre, también si falla)
//   --max-pasos N         tope de pasos del modelo (el equivalente de --max-turns de pa): al arrancar el N+1 se corta a opencode y el .json
//                         queda con subtype "error_max_turns"
//   --tarea-archivo <f>   la tarea sale de un archivo (si no cabe en argv); también sirve `-- -` (stdin)
//
// Eventos de `opencode run --format json` (verificado con opencode 1.19): {type:"step_start"|"text"|"reasoning"|"tool_use"|"step_finish"|"error", part:{…}}.
// `text.part.text` es el texto; `tool_use.part.{tool,state:{status,input,output}}`; `step_finish.part.{tokens:{input,output,reasoning,cache:{read,write}},cost}`;
// `error.error.{name,data:{message,statusCode}}`.
// Salida (`--salida`): { type:"result", motor:"opencode", subtype, is_error, result, num_turns, duration_ms, total_cost_usd, opencode_session_id,
// modelUsage:{<modelo>:{inputTokens,cacheReadInputTokens,cacheCreationInputTokens,outputTokens}} }. `total_cost_usd` es 0 para los gratis; para
// los de pago, la suma de lo que opencode calculó (si calculó algo). Los de OpenCode Go también 0: es un plan fijo, el costo marginal es ~0.
// Exit: 0 bien; 1 falló opencode o el modelo (el motivo, por stderr y en `result`); 2 argumentos; 127 no hay `opencode`.
// Entorno: HILOS_OPENCODE (el binario). El login y la config de OpenCode son los de la persona (HOME/XDG tal cual), salvo en una cuenta agregada
// (`cuentas env`, que pa pone sólo en este proceso): XDG_DATA_HOME (el login vive en su opencode.db) y XDG_STATE_HOME propios, y con
// el runner le agrega `--standalone` a `opencode run` (siempre que lo tenga): sin él, opencode 2.x habla con el servicio de fondo de la persona, que
// no aplica la config de este proceso (permission.external_directory).
// Sin imports de app/: pa corre sin la app. app/electron/opencode.ts duplica a propósito motor/opencode/config.mjs.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { conModeloChico, conPermisoFuera, esErrorCuota, esGratis, esModeloGo, mensajeCuotaGo, mensajeCuotaOpencode, parsearModelo, resolverOpencode } from "./config.mjs";

/** ¿Es una cuenta agregada de OpenCode (la que pone `cuentas env`: TRAMA_OPENCODE_CUENTA con un id válido que no es la de siempre)? */
export const cuentaAgregada = (env = process.env) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(env.TRAMA_OPENCODE_CUENTA ?? "") && env.TRAMA_OPENCODE_CUENTA !== "opencode";

function argumentos(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      o._ = argv.slice(i + 1);
      break;
    }
    if (a.startsWith("--") && i + 1 < argv.length) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}

function morir(codigo, texto, salida, extra = {}) {
  process.stderr.write(`opencode/correr: ${texto}\n`);
  if (salida) escribirSalida(salida, { type: "result", motor: "opencode", subtype: "error", is_error: true, result: texto, num_turns: 0, duration_ms: 0, ...extra });
  process.exit(codigo);
}

function escribirSalida(archivo, o) {
  try {
    mkdirSync(path.dirname(archivo), { recursive: true });
    writeFileSync(archivo, JSON.stringify(o) + "\n");
  } catch (e) {
    process.stderr.write(`opencode/correr: no se pudo escribir ${archivo}: ${e.message}\n`);
  }
}

/** El texto de un error de opencode (`{type:"error", error:{name, data:{message}}}`). */
const textoDeError = (e) => {
  const m = e?.error?.data?.message ?? e?.error?.message ?? e?.error?.name ?? "error";
  const cod = e?.error?.data?.statusCode;
  return `${cod ? `${cod}: ` : ""}${String(m)}`;
};

/** Los eventos de `opencode run --format json` → el JSON de estado de pa. */
export function aResultado({ eventos, modelo, rc, stderr, segundos, gratis, truncado = 0 }) {
  const pasos = eventos.filter((e) => e.type === "step_finish");
  const error = eventos.findLast?.((e) => e.type === "error") ?? [...eventos].reverse().find((e) => e.type === "error");
  const textos = eventos.filter((e) => e.type === "text" && typeof e.part?.text === "string" && e.part.text.trim());
  // Lo que dijo en el último paso (el resto es lo que fue contando entre herramientas).
  const ultimoFin = [...eventos].reverse().find((e) => e.type === "step_finish");
  const dicho = (textos.at(-1)?.part?.text ?? "").trim();
  const razon = ultimoFin?.part?.reason;
  // opencode 2.x no emite el step_finish del último paso: si el paso abierto (último step_start, después del último step_finish) dijo algo, cuenta como turno cerrado.
  const iIni = eventos.findLastIndex((e) => e.type === "step_start");
  const iFin = eventos.findLastIndex((e) => e.type === "step_finish");
  const dijoAbierto = iIni > iFin && eventos.slice(iIni + 1).some((e) => e.type === "text" && typeof e.part?.text === "string" && e.part.text.trim());
  const cerrado = truncado === 0 && !error && rc === 0 && dijoAbierto;
  const cortado = !cerrado && truncado === 0 && !error && rc === 0 && eventos.length > 0 && razon !== undefined && razon !== "stop";
  const malo = truncado > 0 || rc !== 0 || !!error || (!ultimoFin && !cerrado) || cortado;
  let motivo = truncado > 0 ? `se llegó al tope de ${truncado} pasos del modelo (--max-pasos)` : error ? textoDeError(error) : cortado ? `opencode terminó sin cerrar el turno (razón: ${razon})` : stderr.trim() ? stderr.trim().split("\n").slice(-3).join(" · ") : rc !== 0 ? `opencode salió con el código ${rc}` : "opencode no devolvió respuesta";
  if (malo && !truncado && esErrorCuota(`${error ? JSON.stringify(error) : ""}\n${stderr}`)) motivo = esModeloGo(modelo) ? mensajeCuotaGo(modelo) : mensajeCuotaOpencode(modelo);
  const suma = (f) => pasos.reduce((n, e) => n + (Number(f(e.part)) || 0), 0);
  const sesion = eventos.find((e) => typeof e.sessionID === "string")?.sessionID ?? null;
  const costo = suma((p) => p?.cost);
  return {
    type: "result",
    motor: "opencode",
    subtype: truncado > 0 ? "error_max_turns" : malo ? "error" : "success",
    is_error: malo,
    result: malo ? [dicho, motivo].filter(Boolean).join("\n") : dicho,
    num_turns: eventos.filter((e) => e.type === "step_start").length,
    duration_ms: Math.round(segundos * 1000),
    ...(gratis ? { total_cost_usd: 0 } : costo > 0 ? { total_cost_usd: costo } : {}),
    opencode_session_id: sesion,
    // opencode 2.x no cierra el último paso: sus tokens no se conocen, se suman sólo los step_finish que hay.
    modelUsage: pasos.length
      ? {
          [modelo]: {
            inputTokens: suma((p) => p?.tokens?.input),
            cacheReadInputTokens: suma((p) => p?.tokens?.cache?.read),
            cacheCreationInputTokens: suma((p) => p?.tokens?.cache?.write),
            outputTokens: suma((p) => (Number(p?.tokens?.output) || 0) + (Number(p?.tokens?.reasoning) || 0)),
          },
        }
      : {},
  };
}

/**
 * Los pedidos de esta corrida al cupo de OpenCode (los gratis comparten uno; cada modelo de Go tiene el suyo): una línea en `opencode-pedidos.jsonl`,
 * junto al agotado.json de `reparto` (REPARTO_STATE, o <PA_STATE o ~/.local/state/pa>/reparto). Lo lee la barra de la app (app/electron/opencode-pedidos.ts,
 * mismo formato). Los de pago por uso no se anotan. Si no se puede escribir, la corrida sigue igual.
 */
export function anotarPedidos(modelo, n, env = process.env, home = os.homedir(), ahoraMs = Date.now()) {
  const m = String(modelo).replace(/^opencode:/, "").toLowerCase();
  if (!(n >= 1) || !(esGratis(m) || esModeloGo(m))) return false;
  const dir = env.REPARTO_STATE || path.join(env.PA_STATE || path.join(home, ".local", "state", "pa"), "reparto");
  try {
    mkdirSync(dir, { recursive: true });
    // `c`: la cuenta agregada de OpenCode con que corrió (TRAMA_OPENCODE_CUENTA, de `cuentas env`); sin ella, la de siempre.
    const c = cuentaAgregada(env) ? { c: env.TRAMA_OPENCODE_CUENTA } : {};
    appendFileSync(path.join(dir, "opencode-pedidos.jsonl"), JSON.stringify({ t: Math.floor(ahoraMs / 1000), m, n: Math.round(n), ...c }) + "\n");
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const a = argumentos(process.argv.slice(2));
  const salida = a.salida ?? null;
  const modeloPa = a.modelo ?? "";
  const prov = parsearModelo(modeloPa);
  if (!prov) morir(2, `--modelo «${modeloPa}» no es de opencode (opencode:<proveedor>/<modelo>)`, salida);
  if (!a.cwd) morir(2, "falta --cwd", salida);
  if (!a.stream) morir(2, "falta --stream", salida);
  if (!salida) morir(2, "falta --salida", null);
  let tarea = a._.join(" ");
  if (a["tarea-archivo"]) tarea = readFileSync(a["tarea-archivo"], "utf8");
  else if (tarea === "-") tarea = readFileSync(0, "utf8");
  if (!tarea.trim()) morir(2, "falta la tarea (después de --)", salida);

  mkdirSync(path.dirname(a.stream), { recursive: true });
  writeFileSync(a.stream, "");
  // Sin Go, el modelo chico de opencode (título, resumen) va a uno gratis: ver conModeloChico en config.mjs.
  const env = { ...conPermisoFuera(conModeloChico(process.env, os.homedir()), "deny") };
  delete env.CLAUDE_CONFIG_DIR;
  env.PWD = path.resolve(a.cwd); // opencode toma su directorio de PWD, no de getcwd(): sin esto escribiría donde estaba el que lanzó a pa
  const bin = resolverOpencode(process.env, os.homedir());
  const t0 = Date.now();
  const maxPasos = Number.parseInt(a["max-pasos"] ?? "", 10) > 0 ? Number.parseInt(a["max-pasos"], 10) : 0;
  let truncado = 0;
  // La tarea siempre por stdin (cabe cualquier largo, no se confunde con un flag y no se ve en `ps`): `run` la lee si no hay mensaje.
  // El esfuerzo (--effort) es el `--variant` de opencode; vacío o con pinta rara: no se pasa (el modelo usa el suyo).
  // Cada versión de opencode trae otros flags en `run` (2.x no tiene --dir): sólo se pasan los que su --help nombra.
  // El directorio ya va por cwd y PWD; --dir es redundante donde existe.
  const ayuda = spawnSync(bin, ["run", "--help"], { encoding: "utf8", timeout: 10_000 });
  const textoAyuda = `${ayuda.stdout ?? ""}${ayuda.stderr ?? ""}`;
  const tiene = (f) => !textoAyuda.trim() || new RegExp(`(^|\\s)${f}(\\s|=|,|$)`, "m").test(textoAyuda);
  const variante = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(a.effort ?? "") && tiene("--variant") ? ["--variant", a.effort] : [];
  const pensar = tiene("--thinking") ? ["--thinking"] : [];
  // Siempre un servidor propio (--standalone), también con la cuenta de siempre: el servicio de fondo de la persona no aplica la config de este
  // proceso (el `permission.external_directory` de conPermisoFuera); con él, un worker escribía fuera de su carpeta. Sin ese flag (opencode 1.x,
  // sin servicio) no hace falta.
  const aparte = tiene("--standalone") ? ["--standalone"] : [];
  const hijo = spawn(bin, ["run", "--format", "json", ...aparte, ...pensar, "-m", prov.valor, ...variante], { cwd: a.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const eventos = [];
  let resto = "";
  let stderr = "";
  const linea = (l) => {
    if (!l.trim()) return;
    let e = null;
    try {
      e = JSON.parse(l);
    } catch {
      return; // ruido que no es un evento (avisos de permisos, logs)
    }
    if (!e || typeof e !== "object") return;
    try {
      appendFileSync(a.stream, l + "\n");
    } catch {
      /* sin transcript la corrida sigue */
    }
    eventos.push(e);
    // El tope de pasos: si arranca el paso N+1 se corta a opencode (si el N-ésimo era el último, termina solo y no se toca).
    if (maxPasos && !truncado && e.type === "step_start" && eventos.filter((x) => x.type === "step_finish").length >= maxPasos) {
      truncado = maxPasos;
      hijo.kill("SIGTERM");
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
  // pa corta al worker con TERM (timeout, Ctrl-C): se le pasa a opencode y se sale dejando el .json.
  for (const s of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(s, () => hijo.kill("SIGTERM"));

  const rc = await new Promise((ok) => {
    hijo.on("error", (e) => {
      stderr += `no se pudo lanzar ${bin}: ${e.message}`;
      ok(e.code === "ENOENT" ? 127 : 1);
    });
    hijo.on("close", (codigo, senal) => ok(codigo ?? (senal === "SIGTERM" ? 143 : 1)));
  });
  if (resto.trim()) linea(resto);

  const r = aResultado({ eventos, modelo: modeloPa, rc, stderr, segundos: (Date.now() - t0) / 1000, gratis: esGratis(prov.valor) || esModeloGo(prov.valor), truncado });
  escribirSalida(salida, r);
  anotarPedidos(prov.valor, r.num_turns);
  if (rc === 127) process.stderr.write("opencode/correr: no está opencode (npm i -g opencode-ai, o HILOS_OPENCODE=<ruta>)\n");
  else if (r.is_error) process.stderr.write(`opencode/correr: la corrida falló: ${r.result.split("\n").at(-1)}\n`);
  process.exit(r.is_error ? (rc === 0 || truncado ? 1 : rc) : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
