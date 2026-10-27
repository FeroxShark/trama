#!/usr/bin/env node
// agy-pa.mjs <pre|post|inv> — hooks de agy (Antigravity CLI) para los workers Gemini de `pa`. Port a Node (sin jq, sin bash) de
// agy-pa.sh: mismo JSON por stdin (camelCase, `toolCall.name`/`toolCall.args`), misma salida (`{"decision":"deny","reason":…}`)
// y mismo código. Traduce y llama a LAS MISMAS guardias que un worker Claude: destructive-guard (siempre) y latido (sólo en un
// worker de pa: pa exporta PA_AGY_HB), y en un worker Gemini suma la allowlist de herramientas, las escrituras sólo adentro
// del worktree o de /tmp, la privacidad (nada fuera del worktree, nada de red) y las guardias de git.
//
// Un hook que falla (exit != 0, JSON roto, timeout) hace FALLAR la herramienta en agy: cerrado por defecto. Sin nada que
// decir, PreToolUse no imprime NADA (`{}` sin "decision" agy lo toma como deny). Los porqués largos viven en agy-pa.sh.
//
// Diferencias conocidas con el .sh: las guardias que llama son las versiones .mjs de al lado (PA_AGY_GUARD / PA_AGY_LATIDO
// pueden apuntar a un .sh —se corre con bash— o a un .mjs); y la lógica de rutas es POSIX (/home, /etc, /tmp…): en Windows
// el chequeo de privacidad no conoce las raíces de Windows (C:\Users…), eso queda para cuando agy corra nativo.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
const fase = process.argv[2] || "pre";
const aqui = path.dirname(fileURLToPath(import.meta.url));
const GUARD = env.PA_AGY_GUARD || path.join(aqui, "destructive-guard.mjs");
const LATIDO = env.PA_AGY_LATIDO || path.join(aqui, "latido.mjs");

function leerStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
const entrada = leerStdin().replace(/\n+$/, "");
let doc;
try {
  doc = JSON.parse(entrada);
} catch {
  doc = undefined;
}

function escribir(fd, texto) {
  const buf = Buffer.from(texto);
  let off = 0;
  let intentos = 0;
  while (off < buf.length && intentos < 2000) {
    try {
      off += writeSync(fd, buf, off);
    } catch (e) {
      if (e.code !== "EAGAIN") return;
      intentos++;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}
const nada = () => process.exit(0); // PreToolUse sin opinión: salida vacía
const decir = (obj) => escribir(1, `${JSON.stringify(obj)}\n`);
const negar = (razon) => {
  decir({ decision: "deny", reason: razon });
  process.exit(0);
};

const sinFinales = (s) => s.replace(/\n+$/, "");
function ruta(o, ...claves) {
  for (const k of claves) {
    if (o === null || o === undefined) return null;
    if (typeof o !== "object" || Array.isArray(o)) throw new Error("jq");
    o = Object.hasOwn(o, k) ? o[k] : null;
  }
  return o === undefined ? null : o;
}
/** `jq -r "<ruta> // empty"` dentro de `$(...)`. */
function campo(...claves) {
  if (doc === undefined) return "";
  let v;
  try {
    v = ruta(doc, ...claves);
  } catch {
    return "";
  }
  if (v === null || v === false) return "";
  if (typeof v === "string") return sinFinales(v);
  if (typeof v === "object") return sinFinales(JSON.stringify(v, null, 2));
  return String(v);
}

const HOME = process.platform === "win32" ? env.USERPROFILE || env.HOME || homedir() : env.HOME || homedir();
const worker = !!env.PA_AGY_HB;
const herramienta = campo("toolCall", "name");
const cmd = campo("toolCall", "args", "CommandLine");

/** Corre una guardia (.mjs con node, lo demás con bash). Devuelve {status, stdout, stderr}. */
function correrHook(archivo, args, input) {
  const [programa, base] = archivo.endsWith(".mjs") ? [process.execPath, [archivo]] : ["bash", [archivo]];
  const r = spawnSync(programa, [...base, ...args], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// --- PostInvocation: tope de turnos -----------------------------------------------------------
if (fase === "inv") {
  if (!worker) {
    escribir(1, "{}\n");
    process.exit(0);
  }
  const n = campo("invocationNum");
  if (!/^[1-9][0-9]*$/.test(env.PA_MAX_TURNS ?? "") || !/^[0-9]+$/.test(n)) {
    escribir(1, "{}\n");
    process.exit(0);
  }
  const quedan = parseInt(env.PA_MAX_TURNS, 10) - parseInt(n, 10);
  if (quedan < 0) decir({ terminationBehavior: "terminate" });
  else if (quedan <= 5) {
    decir({
      injectSteps: [
        {
          ephemeralMessage: `AVISO DEL ORQUESTADOR: te quedan como mucho ${quedan} turnos. Commiteá lo que hiciste (archivo por archivo) y respondé YA con RESULTADO/ARCHIVOS/DECISION, aunque falte algo: decilo en DECISION.`,
        },
      ],
    });
  } else escribir(1, "{}\n");
  process.exit(0);
}

// El JSON que esperan los hooks de Claude. run_command es Bash; el timeout va puesto porque en agy no existe el corte a los
// 120 s que la guardia de timeout de latido previene.
let archivo = campo("toolCall", "args", "TargetFile");
if (!archivo) archivo = campo("toolCall", "args", "AbsolutePath");
const NOMBRES = {
  run_command: "Bash",
  write_to_file: "Write",
  replace_file_content: "Edit",
  multi_replace_file_content: "Edit",
  sed_file: "Edit",
  notebook_edit: "Edit",
  view_file: "Read",
  grep_search: "Grep",
  find_by_name: "Glob",
  list_dir: "Glob",
};
const nombre = Object.hasOwn(NOMBRES, herramienta) ? NOMBRES[herramienta] : herramienta;
const claudeJson = JSON.stringify({
  tool_name: nombre,
  tool_input: { ...(cmd !== "" ? { command: cmd, timeout: 600000 } : {}), ...(archivo !== "" ? { file_path: archivo } : {}) },
});

if (fase === "post") {
  if (worker) correrHook(LATIDO, [env.PA_AGY_HB, "post"], claudeJson);
  escribir(1, "{}\n");
  process.exit(0);
}

// --- PreToolUse ------------------------------------------------------------------------------
if (herramienta === "run_command" && cmd) {
  const g = correrHook(GUARD, [], claudeJson);
  if (g.status === 2) negar(sinFinales(g.stderr) || "BLOQUEADO por destructive-guard.");
}
if (!worker) nada();

const leer = env.PA_AGY_MODO === "leer";

// Allowlist de herramientas: lo que no está acá no corre.
const lectura = "view_file|list_dir|find_by_name|grep_search|run_command|command_status|wait|wait_5_seconds|finish";
const escritura = "write_to_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit|send_command_input|manage_task";
if (leer) {
  if (!new RegExp(`^(${lectura})$`).test(herramienta)) {
    negar(`BLOQUEADO: estás en modo LECTURA (pa --leer): '${herramienta}' no está permitida. Para leer: view_file, list_dir, find_by_name, grep_search, y run_command sólo con git de lectura.`);
  }
} else if (!new RegExp(`^(${lectura}|${escritura})$`).test(herramienta)) {
  negar(`BLOQUEADO: '${herramienta}' no está permitida en un worker de pa (ni navegador, ni MCP, ni subagentes, ni mensajes, ni tareas programadas). Hacé el trabajo con los archivos y la terminal; si de verdad hace falta, decilo en DECISION.`);
}

// --- Privacidad: nada de leer fuera del worktree ni de salir a la red -------------------------
// El chequeo es LÉXICO (ve las rutas escritas en el comando, no lo que un intérprete arme por dentro): es una barrera, no una jaula.
const posix = (p) => p.replaceAll("\\", "/");
/** `realpath -ms`: ruta absoluta normalizada sin resolver symlinks ni exigir que exista. */
function lex(p) {
  const abs = p.startsWith("/") ? p : path.posix.resolve(posix(process.cwd()), p);
  const r = path.posix.normalize(abs);
  return r.length > 1 && r.endsWith("/") ? r.slice(0, -1) : r;
}
/** `realpath -m`: resuelve los symlinks de lo que existe y deja el resto como está. */
function realpathM(p) {
  const abs = lex(p);
  let resto = "";
  let actual = abs;
  for (;;) {
    try {
      return posix(path.posix.join(posix(realpathSync(actual)), resto)) || "/";
    } catch {
      const padre = path.posix.dirname(actual);
      if (padre === actual) return abs;
      resto = path.posix.join(path.posix.basename(actual), resto);
      actual = padre;
    }
  }
}
const raizN = lex(env.PA_AGY_RAIZ || "/nonexistent");
const homeN = lex(posix(HOME));
const mapaN = env.PA_AGY_MAPA ? lex(env.PA_AGY_MAPA) : "";
const raicesProhibidas = [homeN, "/home", "/root", "/etc", "/var", "/mnt", "/media", "/run", "/srv", "/boot", "/sys", "/proc", "/opt", "/dev"];
const dentro = (a, b) => a === b || a.startsWith(`${b}/`);
function permitida(p) {
  if (dentro(p, raizN)) return true;
  if (p === "/tmp" || p.startsWith("/tmp/")) return true;
  if (mapaN && p === mapaN) return true;
  return ["/dev/null", "/dev/zero", "/dev/stdin", "/dev/stdout", "/dev/stderr", "/dev/urandom", "/dev/random"].includes(p);
}
function prohibida(p) {
  if (permitida(p)) return false;
  if (p === "/") return true;
  return raicesProhibidas.some((r) => dentro(p, r));
}
/** t = token tal como lo escribió el modelo, cwd = el directorio de trabajo. true si toca algo fuera del worktree. */
function tokenSale(t, cwd) {
  t = t.replaceAll("${HOME}", "$HOME");
  const casa = posix(HOME);
  if (t === "~" || t.startsWith("~/")) t = casa + t.slice(1);
  else if (t.startsWith("~")) return true; // ~otro_usuario
  else if (t === "$HOME" || t.startsWith("$HOME/")) t = casa + t.slice("$HOME".length);
  else if (t.startsWith("$XDG_") || t.startsWith("$PA_") || t.startsWith("$OLDPWD")) return true;
  else if (t === "$PWD" || t.startsWith("$PWD/")) t = cwd + t.slice("$PWD".length);
  else if (t === "$TMPDIR" || t.startsWith("$TMPDIR/")) return false;
  else if (/^\$[A-Za-z_][\s\S]*\/[\s\S]*$/.test(t)) return true; // $LO_QUE_SEA/… : no se sabe adónde apunta
  let p;
  if (t.startsWith("/")) {
    // con glob: se mira el tramo fijo; si algún prohibido empieza igual, se niega
    if (/[*?]/.test(t)) {
      const pre = t.slice(0, t.search(/[*?]/));
      if (dentro(pre.replace(/\/$/, ""), raizN)) return false;
      if (pre.startsWith("/tmp/")) return false;
      for (const r of [...raicesProhibidas, "/"]) {
        if (`${r}/`.startsWith(pre) || pre.startsWith(`${r}/`) || pre === r) return true;
      }
      return false;
    }
    p = t;
  } else if (`/${t}/`.includes("/../")) p = `${cwd}/${t}`;
  else return false;
  return prohibida(lex(p));
}
/** Todo token de un texto de comando que salga del worktree -> lo devuelve (o null). */
function comandoSale(c, cwd) {
  // el mensaje de un commit puede nombrar rutas sin leerlas; sólo si no ejecuta nada adentro (sed trabaja línea por línea)
  c = c
    .split("\n")
    .map((l) => l.replace(/(-m|--message)[\s=]+("[^"$`]*"|'[^']*')/g, " "))
    .join("\n");
  c = c.replaceAll("${HOME}", "$HOME");
  for (const tok of c.split(/[ \t\n;|&<>()"'`=:,{}[\]]+/)) {
    if (!tok) continue;
    if (tokenSale(tok, cwd)) return tok;
  }
  return null;
}

if (worker) {
  let cwdPedido = campo("toolCall", "args", "Cwd");
  if (cwdPedido.startsWith('"')) cwdPedido = cwdPedido.slice(1);
  if (cwdPedido.endsWith('"')) cwdPedido = cwdPedido.slice(0, -1);
  let cwd = raizN;
  const msgFuera = (x) =>
    `BLOQUEADO (privacidad): '${x}' está fuera de tu worktree (${env.PA_AGY_RAIZ || "?"}). Un worker Gemini no lee, lista, busca ni ejecuta nada fuera de su worktree (ni ~/.ssh, ~/.config, ~/.gemini, ~/.claude, /etc, otros proyectos, $HOME): lo que lee viaja a Google. Si hace falta, decilo en DECISION.`;
  const sospechosa = (v) => v.startsWith("/") || v.startsWith("~") || v.startsWith("$") || `/${v}/`.includes("/../");
  if (cwdPedido) {
    if (sospechosa(cwdPedido) && tokenSale(cwdPedido, raizN)) negar(msgFuera(cwdPedido));
    if (cwdPedido.startsWith("/")) cwd = lex(cwdPedido);
  }
  const args = (() => {
    try {
      const a = ruta(doc, "toolCall", "args");
      return a !== null && typeof a === "object" && !Array.isArray(a) ? a : null;
    } catch {
      return null;
    }
  })();
  switch (herramienta) {
    case "view_file": case "list_dir": case "find_by_name": case "grep_search": case "sed_file": case "notebook_edit":
    case "write_to_file": case "replace_file_content": case "multi_replace_file_content":
      if (args) {
        for (const [k, val] of Object.entries(args)) {
          if (!/(Path|Dir|Directory|File)$/i.test(k) || typeof val !== "string") continue;
          for (let v of val.split("\n")) {
            if (v.startsWith('"')) v = v.slice(1);
            if (v.endsWith('"')) v = v.slice(0, -1);
            if (!v) continue;
            if (sospechosa(v) && tokenSale(v, cwd)) negar(msgFuera(v));
          }
        }
      }
      break;
    case "send_command_input": {
      const texto = args ? Object.values(args).filter((x) => typeof x === "string").join(" ") : "";
      const t = comandoSale(texto, cwd);
      if (t !== null) negar(msgFuera(t));
      break;
    }
  }
  if (herramienta === "run_command" && cmd) {
    const t = comandoSale(cmd, cwd);
    if (t !== null) negar(msgFuera(t));
    // cd sin argumento (o a -) lleva a $HOME
    if (/(^|[;&|(])\s*(cd|pushd)\s*($|[;&|)]|\s-(\s|$))/.test(cmd)) {
      negar(`BLOQUEADO (privacidad): 'cd'/'pushd' sin ruta (o a '-') te saca del worktree (${env.PA_AGY_RAIZ || "?"}). Quedate adentro.`);
    }
    if (/(^|[^A-Za-z0-9_])eval\s/.test(cmd)) {
      negar("BLOQUEADO (privacidad): 'eval' no va en un worker Gemini: arma comandos que el guard no puede leer.");
    }
    // red: sólo lo que agy necesita para hablar con el modelo; nada de run_command
    const preCmd = String.raw`(sudo|env|command|exec|nohup|time|xargs|timeout\s+[0-9.]+[smhd]?)\s+`;
    const red = "(curl|wget|nc|ncat|netcat|socat|ssh|scp|sftp|rsync|ftp|tftp|telnet|lftp|aria2c|nmap|ssh-keyscan|gh|glab|aws|gcloud|gsutil|mail|sendmail|msmtp|mutt)";
    const reRed = new RegExp(String.raw`(^|[;&|(` + "`" + String.raw`]|\$\(|-c\s+["'])\s*(` + preCmd + String.raw`)*([^\s;&|]*/)?` + red + String.raw`(\s|"|'|$)`);
    if (reRed.test(cmd) || cmd.includes("/dev/tcp/") || cmd.includes("/dev/udp/")) {
      negar("BLOQUEADO (privacidad): sin red en un worker Gemini (curl, wget, nc, ssh, scp, rsync, gh…): lo que sale de la máquina sale a un tercero. Sólo habla con el modelo la propia agy.");
    }
    const gr = String.raw`(^|[;&|\s(])git\s+((-C\s+[^\s]+|-c\s+[^\s]+|-[^\s]+)\s+)*`;
    const reGit = new RegExp(`${gr}(clone|fetch|pull|ls-remote|submodule|remote\\s+(add|set-url))(\\s|$)`);
    const rePub = /(^|[^A-Za-z0-9_-])(npm|pnpm|yarn|cargo|twine)\s+(publish|upload)(\s|$)/;
    if (reGit.test(cmd) || rePub.test(cmd)) {
      negar("BLOQUEADO (privacidad): sin red en un worker Gemini (git clone/fetch/pull/ls-remote, publish…). El repo ya está en tu worktree.");
    }
  }
}

// Escrituras: sólo adentro del worktree (o del tree, con --aca), /tmp y el archivo del mapa.
if (nombre === "Write" || nombre === "Edit") {
  const raiz = env.PA_AGY_RAIZ || "";
  if (!archivo) negar(`BLOQUEADO: no se pudo saber qué archivo escribe '${herramienta}'.`);
  const real = realpathM(archivo);
  let ok = false;
  if (raiz && (real === realpathM(raiz) || real.startsWith(`${realpathM(raiz)}/`))) ok = true;
  if (real.startsWith("/tmp/")) ok = true;
  if (env.PA_AGY_MAPA && real === realpathM(env.PA_AGY_MAPA)) ok = true;
  if (!ok) negar(`BLOQUEADO: '${archivo}' está fuera de tu worktree (${raiz}). Un worker escribe sólo ahí (y en /tmp); el tree principal y el resto de la máquina los toca el jefe.`);
}

if (herramienta === "run_command" && cmd) {
  // Guardia de git que en Claude es sólo contrato: acá no hay forma de saber si el modelo la leyó.
  const g = String.raw`(^|[;&|\s(])git\s+((-C\s+[^\s]+|-c\s+[^\s]+|-[^\s]+)\s+)*`;
  const t = (resto) => new RegExp(g + resto).test(cmd);
  if (t(String.raw`push(\s|$)`)) negar("BLOQUEADO: nada de 'git push' en un worker. La rama la integra el jefe y main se empuja solo al remoto.");
  if (
    t(String.raw`(switch|merge|cherry-pick|update-ref|filter-branch|replace)(\s|$)`) ||
    (t(String.raw`checkout(\s|$)`) && !cmd.includes(" -- ")) ||
    t(String.raw`reset\s+([^;&|]*\s)?--hard`) ||
    t(String.raw`branch\s+([^;&|]*\s)?(-[a-zA-Z]*[dDmMcCf][a-zA-Z]*|--delete|--move|--copy|--force)(\s|$)`) ||
    t(String.raw`worktree\s+(add|remove|move|prune|repair|lock|unlock)(\s|$)`) ||
    (t(String.raw`rebase(\s|$)`) && (env.PA_AGY_REBASE ?? "0") !== "1")
  ) {
    negar(`BLOQUEADO: no cambies de rama, no mergees, no rebasees, no borres ramas, no toques worktrees ni hagas reset --hard: estás en la rama ${env.PA_AGY_RAMA || "de tu worktree"} y la integra el jefe. Para descartar un cambio tuyo de un archivo: git checkout -- <archivo>.`);
  }
  const ppal = env.PA_AGY_PPAL || "";
  let ppalTocado = false;
  if (ppal && ppal !== (env.PA_AGY_RAIZ || "")) {
    for (const pre of ["cd ", "pushd ", "-C "]) for (const q of ["", '"', "'"]) if (cmd.includes(pre + q + ppal)) ppalTocado = true;
  }
  if (ppalTocado) negar(`BLOQUEADO: '${ppal}' es el tree principal del proyecto: no se toca desde un worker. Trabajá en tu worktree (${env.PA_AGY_RAIZ || ""}).`);
}

// latido: el latido, y todas las guardias de un worker Claude (stash, add -A, commit -a, release, cargo clean, dependencias con
// otro writer, allowlist de --leer, recorte de tests).
const argsLatido = [env.PA_AGY_HB, "pre", ...(leer ? ["leer"] : [])];
const l = correrHook(LATIDO, argsLatido, claudeJson);
if (l.status === 2) negar(sinFinales(l.stderr) || "BLOQUEADO por latido.sh.");
let nuevo = "";
try {
  const o = JSON.parse(l.stdout);
  const v = ruta(o, "hookSpecificOutput", "updatedInput", "command");
  if (typeof v === "string") nuevo = sinFinales(v);
} catch {}
if (nuevo && herramienta === "run_command") {
  decir({ decision: "allow", overwrite: { CommandLine: nuevo } });
  process.exit(0);
}
nada();
