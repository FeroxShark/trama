#!/usr/bin/env node
// latido.mjs <archivo-heartbeat> <pre|post> [leer] — port a Node (sin jq, sin bash, sin flock) de latido.sh: mismo JSON por
// stdin, mismo stdout/stderr, mismo código de salida (2 = bloquear + devolverle el motivo al modelo) y mismos archivos de
// estado (`<hb>` y `<hb>.turnos`). Hook de PreToolUse/PostToolUse para los workers de `pa`. Dos trabajos:
//
// 1. LATIDO: una línea por campo en un archivo chico que `workers` lee sin abrir el transcript. `envuelo=1` lo escribe
//    PreToolUse (la herramienta arranca), `envuelo=0` PostToolUse (terminó).
// 2. GUARDIAS: git que se come el trabajo de otra sesión (stash, add -A, commit -a), run_in_background, builds de release,
//    comandos largos sin `timeout`, cargo clean, instalar dependencias con otro writer vivo, la allowlist de `--leer` y el
//    recorte de la salida de los tests. Más el aviso de turnos (PostToolUse).
//
// El comportamiento es el del .sh línea por línea; los comentarios largos de los porqués viven allá.
// Diferencias conocidas: `desc` se corta a 160 BYTES como `cut -c` de GNU (igual que el .sh); el candado de `.turnos` es una
// carpeta (`<hb>.turnos.lock.d`) en lugar de flock, así que no excluye a un latido.sh corriendo a la vez sobre el mismo archivo.
import { mkdirSync, openSync, closeSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync, accessSync, constants, writeSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const env = process.env;
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const hb = process.argv[2] ?? "";
const fase = process.argv[3] || "pre";
const modo = process.argv[4] ?? ""; // "leer" en los workers de `pa --leer`

function leerStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
// `entrada="$(cat)"`: sin los saltos de línea del final.
const entrada = leerStdin().replace(/\n+$/, "");
let doc;
try {
  doc = JSON.parse(entrada);
} catch {
  doc = undefined;
}

/** Texto como lo deja `$(...)`: sin los saltos de línea del final. */
const sinFinales = (s) => s.replace(/\n+$/, "");
/** `a.b.c` de jq: null si falta o pasa por null; tira si pasa por algo que no es objeto. */
function ruta(o, ...claves) {
  for (const k of claves) {
    if (o === null || o === undefined) return null;
    if (typeof o !== "object" || Array.isArray(o)) throw new Error("jq");
    o = Object.hasOwn(o, k) ? o[k] : null;
  }
  return o === undefined ? null : o;
}
/** `jq -r "<ruta> // empty"` dentro de `$(...)`: "" si no hay, es false o no se puede leer. */
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

/** Escribe todo en un fd (stdout/stderr son pipes no bloqueantes: EAGAIN se reintenta). */
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
      dormir(5);
    }
  }
}
const err = (texto) => escribir(2, texto);
const salir = (codigo) => process.exit(codigo);
const bloquear = (texto) => {
  err(`${texto}\n`);
  salir(2);
};

/** Nombre del dueño: TRAMA_DUENO -> `dueno` de perfil.json -> $USER con mayúscula inicial -> "el usuario". */
function nombreDueno() {
  let n = env.TRAMA_DUENO || "";
  if (!n) {
    const casa = process.platform === "win32" ? env.USERPROFILE || env.HOME || homedir() : env.HOME || homedir();
    const config =
      process.platform === "win32"
        ? path.win32.join(env.LOCALAPPDATA || path.win32.join(casa, "AppData", "Local"), "trama", "config")
        : path.join(env.XDG_CONFIG_HOME || path.join(casa, ".config"), "trama");
    const p = env.TRAMA_PERFIL || path.join(config, "perfil.json");
    try {
      accessSync(p, constants.R_OK);
      const d = JSON.parse(readFileSync(p, "utf8"));
      const v = alt(d && typeof d === "object" && !Array.isArray(d) ? d.dueno : null, null);
      if (v !== null) n = typeof v === "string" ? sinFinales(v) : String(v);
    } catch {}
  }
  if (!n) {
    let u = env.USER || env.USERNAME || "";
    if (!u) {
      try {
        u = userInfo().username;
      } catch {}
    }
    if (u) n = u.charAt(0).toUpperCase() + u.slice(1);
  }
  return n || "el usuario";
}
const alt = (a, b) => (a === null || a === undefined || a === false ? b : a);

// 3. GUARDIA DE --leer. Es una ALLOWLIST: lo que no está acá se bloquea, incluido todo lo que no se reconoce.
const palabras = (s) => s.split(/[ \t\n]+/).filter(Boolean); // `read -ra`
function gitDeLectura(c) {
  if (!c || c.includes("\n") || c.includes("||") || c.includes("$(")) return false;
  // nada de encadenar, redirigir ni sustituir. Sobre-bloquea un `;` entre comillas: aceptable.
  if (/[;&<>`]/.test(c)) return false;
  const segs = c.split("|");
  if (segs.length > 1 && segs[segs.length - 1] === "") segs.pop(); // `read` con IFS='|' no deja un campo vacío al final
  if (segs.length === 0) return false;
  let primero = true;
  for (const seg of segs) {
    const t = palabras(seg);
    if (t.length === 0) return false;
    if (!primero) {
      // sort -o y uniq <in> <out> escriben; sed tiene `w`. Quedan los que no pueden escribir.
      if (["head", "tail", "grep", "wc", "cut"].includes(t[0])) continue;
      return false;
    }
    primero = false;
    if (t[0] !== "git") return false;
    let i = 1;
    while (t[i] === "-C" || t[i] === "--no-pager") i += t[i] === "-C" ? 2 : 1;
    const sub = t[i] ?? "";
    const resto = t.slice(i + 1);
    for (const a of resto) {
      // --output escribe un archivo; -O abre un pager (ejecuta); --ext-diff corre un programa.
      if (a.startsWith("--output") || a.startsWith("-O") || a.startsWith("--open-files-in-pager") || a === "--ext-diff") return false;
    }
    switch (sub) {
      case "log": case "diff": case "show": case "status": case "rev-list": case "rev-parse": case "merge-base":
      case "ls-files": case "ls-tree": case "blame": case "shortlog": case "describe": case "cat-file": case "grep":
        break;
      case "worktree":
        if (resto[0] !== "list") return false;
        break;
      case "stash":
        if (resto[0] !== "list" && resto[0] !== "show") return false;
        break;
      case "branch": {
        // Sin argumentos lista. Con argumentos, sólo en modo lista y sin ningún flag que borre, mueva, copie o toque el upstream.
        let lista = resto.length === 0;
        for (const a of resto) {
          if (/^(--delete|--move|--copy|--force|--set-upstream-to.*|--unset-upstream|--edit-description|--track.*|--no-track|--create-reflog)$/s.test(a)) return false;
          if (/^(--list|--all|--remotes|--verbose|--show-current|--merged.*|--no-merged.*|--contains.*|--no-contains.*|--points-at.*)$/s.test(a)) lista = true;
          else if (a.startsWith("--")) continue;
          else if (a.startsWith("-")) {
            if (/[dDmMcCfut]/.test(a)) return false;
            if (/[lavr]/.test(a)) lista = true;
          }
        }
        if (!lista) return false;
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

/** Otro worker que ESCRIBE vivo en el mismo proyecto (los --leer no cuentan). */
function otroWriterVivo() {
  if (!hb) return false;
  const propio = `${hb.endsWith(".heartbeat") ? hb.slice(0, -".heartbeat".length) : hb}.running`;
  const st = path.dirname(hb);
  const valor = (texto, clave) => {
    for (const l of texto.split("\n")) if (l.startsWith(`${clave}=`)) return l.slice(clave.length + 1);
    return "";
  };
  let slug;
  try {
    slug = valor(readFileSync(propio, "utf8"), "proyecto");
  } catch {
    return false;
  }
  if (!slug) return false;
  let candidatos = [path.join(st, `${slug}.running`)];
  try {
    candidatos = candidatos.concat(
      readdirSync(st)
        .filter((n) => n.startsWith(`${slug}@`) && n.endsWith(".running"))
        .sort()
        .map((n) => path.join(st, n)),
    );
  } catch {}
  for (const r of candidatos) {
    let texto;
    try {
      if (!statSync(r).isFile() || r === propio) continue;
      texto = readFileSync(r, "utf8");
    } catch {
      continue;
    }
    if (valor(texto, "leer") === "1") continue;
    let pid = valor(texto, "pid");
    if (!pid) pid = valor(texto, "pa_pid");
    if (/^\d+$/.test(pid) && Number(pid) > 0) {
      try {
        process.kill(Number(pid), 0);
        return true;
      } catch {}
    }
  }
  return false;
}

const herramienta = campo("tool_name");
const cmd = campo("tool_input", "command");
let desc = campo("tool_input", "description");
if (!desc) desc = cmd;
if (!desc) desc = campo("tool_input", "file_path");
if (!desc) desc = campo("tool_input", "pattern");
const bg = campo("tool_input", "run_in_background");

// --- latido -------------------------------------------------------------------------------
// Va ANTES de las guardias: si una guardia bloquea, igual queremos que el .heartbeat diga qué intentó el worker.
if (hb) {
  const envuelo = fase === "pre" ? 1 : 0;
  // El temporal es propio de esta llamada (mismo dir, para que el rename sea atómico): dos hooks a la vez no se pisan.
  const tmp = `${hb}.${randomBytes(4).toString("hex").slice(0, 6)}`;
  try {
    const fd = openSync(tmp, "wx", 0o600);
    closeSync(fd);
    const d = Buffer.from(desc.replace(/[\n\r\t]/g, " ")).subarray(0, 160); // cut -c1-160 de GNU cuenta bytes
    const cuerpo = Buffer.concat([
      Buffer.from(`epoch=${Math.floor(Date.now() / 1000)}\ntool=${herramienta || "?"}\nenvuelo=${envuelo}\ndesc=`),
      d,
      Buffer.from("\n"),
    ]);
    writeFileSync(tmp, cuerpo);
    renombrar(tmp, hb);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {}
  }
}

function renombrar(de, a) {
  const fin = Date.now() + 2000;
  let espera = 10;
  for (;;) {
    try {
      renameSync(de, a);
      return;
    } catch (e) {
      if (!["EBUSY", "EPERM", "EACCES"].includes(e.code) || Date.now() + espera > fin) throw e;
      dormir(espera);
      espera = Math.min(espera * 2, 250);
    }
  }
}

// --- guardia de --leer (va antes que las otras: acá todo lo que no es git de lectura muere) ---
if (modo === "leer" && fase === "pre" && herramienta === "Bash" && !gitDeLectura(cmd)) {
  bloquear(
    "BLOQUEADO: estás en modo LECTURA (pa --leer). Bash sólo acepta git de lectura: log, diff, show, status, rev-list, rev-parse, merge-base, ls-files, ls-tree, blame, shortlog, describe, cat-file, grep, branch --list, worktree list, stash list/show. Usá 'git -C <ruta>' en vez de cd, y como mucho un pipe a head/tail/grep/wc/cut. Nada de ;, &&, redirecciones, $(...) ni otros comandos. Para leer archivos usá Read/Grep/Glob.",
  );
}

// `[;\&\|[:space:]]` de bash: ; & | y espacios (la barra invertida NO está en el conjunto).
const INI = "(^|[;&|\\s])";
const GIT_OPS = "git\\s+((-C\\s+[^\\s]+|-[^\\s]+)\\s+)*";

// --- guardia de git (sólo antes de ejecutar, y sólo sobre Bash) --------------------------
if (fase === "pre" && herramienta === "Bash" && cmd) {
  // run_in_background: en un worker `-p` NADIE re-invoca al modelo cuando el background termina (BUGS.md bug 1).
  if (bg === "true") {
    bloquear(
      "BLOQUEADO: nada de run_in_background en un worker headless. Cuando el comando termina no hay nadie que te despierte: te ponés a pollear la salida, cada vuelta es un turno, y te quedás sin turnos con todo sin commitear. Corrélo en FOREGROUND pasándole al tool Bash su parámetro 'timeout' en MILISEGUNDOS (máximo 600000 = 10 min). OJO: 'timeout 540 <cmd>' del SHELL no sirve, el tool corta igual a los 120s por default. Si el comando no cabe en 10 min, acotálo (un test, un paquete) o commiteá lo que tengas y decí en DECISION que no cabe en una corrida.",
    );
  }
  // Build de release / install. Excepción: `--aca`/`--sucio-mio` (heartbeat `<slug>@aca.heartbeat`).
  if (
    !hb.endsWith("@aca.heartbeat") &&
    (new RegExp(`${INI}tauri\\s+(--\\s+)?build(\\s|$)`).test(cmd) ||
      new RegExp(`${INI}cargo\\s+([^;&|]*\\s)?(--release|-r|--profile[=\\s]+release)(\\s|$)`).test(cmd) ||
      new RegExp(`${INI}cargo\\s+([^\\s;&|]+\\s+)*install(\\s|$)`).test(cmd))
  ) {
    bloquear(
      `BLOQUEADO: build de release en un worker: pisa el target compartido (y el binario que usa ${nombreDueno()}). El build lo hace el jefe después de integrar. Probá con cargo test/check o build debug; si de verdad hace falta release, decilo en DECISION.`,
    );
  }
  // Comandos largos sin el parámetro `timeout` del tool: el harness los manda a background solo.
  if (
    !campo("tool_input", "timeout") &&
    new RegExp(
      `${INI}(cargo\\s+(test|build|clippy|check|bench)|(npm|pnpm|yarn|bun)\\s+(run\\s+)?(build|test|typecheck)|npx\\s+tsc|(go|pytest|make|gradle|mvn|tsc|vitest|jest)(\\s|$))`,
    ).test(cmd)
  ) {
    bloquear(
      "BLOQUEADO: a ese comando le falta el parámetro 'timeout' del tool Bash. Sin él el tool corta a los 120s y manda el comando a BACKGROUND solo; ahí te ponés a pollear la salida, cada vuelta es un turno, y te quedás sin turnos con todo sin commitear (pasó tres veces). Relanzá el MISMO comando agregando timeout: 600000 (milisegundos, 10 min, el máximo). El 'timeout 300' del shell que escribiste no cuenta: es otro reloj.",
    );
  }
  // `git stash list` y `git stash show` son de sólo lectura: no se bloquean.
  if (new RegExp(`${INI}${GIT_OPS}stash(\\s|$)`).test(cmd) && !new RegExp(`${GIT_OPS}stash\\s+(list|show)`).test(cmd)) {
    bloquear(
      "BLOQUEADO: nada de 'git stash' en un worker. Si te matan a mitad, el trabajo sin commitear de otra sesión queda en el stash y desaparece del working tree sin que nada falle. Trabajá encima de lo que haya y commiteá archivo por archivo.",
    );
  }
  // `add -u` y `commit -a` barren TODO lo modificado del working tree, incluido lo de otra sesión.
  if (new RegExp(`${INI}${GIT_OPS}add\\s+(-A|--all|-u|--update|\\.)(\\s|$)`).test(cmd)) {
    bloquear(
      "BLOQUEADO: nada de 'git add -A/-u' ni 'git add .' en un worker: te llevás cambios de otra sesión que no son tuyos. Agregá los archivos que tocaste, uno por uno.",
    );
  }
  if (new RegExp(`${INI}${GIT_OPS}commit\\s+(-[A-Za-z]*a[A-Za-z]*|--all)(\\s|$)`).test(cmd)) {
    bloquear(
      "BLOQUEADO: nada de 'git commit -a' en un worker: commitea todo lo modificado, incluido lo de otra sesión. Agregá tus archivos con git add <archivo> y commiteá sin -a.",
    );
  }
  // `cargo clean`, SIEMPRE: el target de un worker es el del tree principal del dueño.
  if (new RegExp(`${INI}cargo\\s+([^\\s]+\\s+)*clean(\\s|$)`).test(cmd)) {
    bloquear(
      "BLOQUEADO: nada de 'cargo clean' en un worker: el target es compartido con el tree principal (y con otros workers). Si sospechás de un artefacto roto, decilo en DECISION.",
    );
  }
  // Instalar/sacar dependencias con OTRO worker vivo en el mismo proyecto.
  if (
    new RegExp(
      `${INI}((npm|pnpm|yarn|bun)\\s+(install|i|add|ci|remove|rm|uninstall|un)|pip[0-9.]*\\s+install|python[0-9.]*\\s+-m\\s+pip\\s+install|uv\\s+(sync|add|remove|pip\\s+install))(\\s|$)`,
    ).test(cmd) &&
    otroWriterVivo()
  ) {
    bloquear(
      "BLOQUEADO: hay otro worker corriendo en este mismo proyecto y comparten node_modules/.venv (son los del tree principal). Instalar o sacar dependencias ahora se las cambia a él a mitad de camino. Si de verdad necesitás esa dependencia, decilo en DECISION y seguí con lo demás.",
    );
  }
  // Recorte de la salida de los TESTS (plan pro). PA_RECORTE lo exporta `pa`: 150 en plan pro, 0 (apagado) en max.
  const recorte = env.PA_RECORTE || "0";
  if (
    /^[1-9][0-9]*$/.test(recorte) &&
    modo !== "leer" &&
    /^\s*(cargo\s+(test|nextest)|(npm|pnpm|yarn|bun)\s+(run\s+)?test|npx\s+(vitest|jest)|vitest|jest|pytest|python[0-9.]*\s+-m\s+pytest|go\s+test|make\s+test|(\.\/)?tests\/run\.sh)(\s|$)/.test(cmd) &&
    !/[|><;&`]/.test(cmd) &&
    !cmd.includes("$(") &&
    !cmd.includes("\n")
  ) {
    const nuevo = `set -o pipefail; ( ${cmd} ) 2>&1 | awk -v n=${recorte} '{a[NR%n]=$0} END{if(NR>n) print "[recortado por el hook: se omitieron las primeras " NR-n " líneas; si te falta algo, volvé a correr filtrando con grep]"; s=(NR>n)?NR-n+1:1; for(i=s;i<=NR;i++) print a[i%n]}'`;
    const ti = doc && typeof doc === "object" && doc.tool_input && typeof doc.tool_input === "object" ? doc.tool_input : {};
    escribir(1, `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...ti, command: nuevo } } })}\n`);
    salir(0);
  }
}

// --- aviso de turnos ----------------------------------------------------------------------
// Se cuentan acá: un PostToolUse por herramienta, que es aproximadamente un turno.
let aviso = "";

// El harness puede mandar a background un comando que el modelo pidió en foreground: el aviso tiene que salir del RESULTADO.
// Se mira SÓLO el principio del .tool_response de un Bash, y con la frase entera del harness.
let respuestaHead = "";
if (fase === "post" && herramienta === "Bash") {
  let r = null;
  try {
    r = doc === undefined ? null : ruta(doc, "tool_response");
  } catch {}
  const texto = typeof r === "string" ? r : JSON.stringify(r ?? null);
  respuestaHead = Buffer.from(texto).subarray(0, 300).toString("utf8"); // head -c 300
}
if (/did not complete within its [\s\S]*timeout and was moved to the background/.test(respuestaHead)) {
  aviso =
    "AVISO DEL ORQUESTADOR: el harness mandó ese comando a background porque le faltó el parámetro 'timeout' del tool. NO lo pollees (ni sleep, ni cat de la salida, ni jobs: cada vuelta es un turno y nadie te va a despertar cuando termine). Relanzá el MISMO comando en foreground agregando timeout: 600000.";
}

/** leer-sumar-escribir del contador bajo un candado (los post de subagentes en paralelo perdían cuentas). */
function sumarTurno() {
  const archivo = `${hb}.turnos`;
  const candado = `${archivo}.lock.d`;
  const fin = Date.now() + 5000;
  for (;;) {
    try {
      mkdirSync(candado);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") break;
      try {
        if (Date.now() - statSync(candado).mtimeMs > 30_000) rmSync(candado, { recursive: true, force: true });
      } catch {}
      if (Date.now() >= fin) break;
      dormir(10);
    }
  }
  let m = 1;
  try {
    // `$(( $(cat) + 1 ))` con `set -u`: un contador con algo que no es un número aborta la cuenta (n = 1) y no reescribe el archivo.
    let texto = "";
    try {
      texto = readFileSync(archivo, "utf8").replace(/\n+$/, "").trim();
    } catch {}
    let previo = 0;
    if (/^0[0-9]+$/.test(texto)) previo = /^[0-7]+$/.test(texto) ? parseInt(texto, 8) : NaN; // aritmética de bash: 0NN es octal
    else if (/^[0-9]+$/.test(texto)) previo = parseInt(texto, 10);
    else if (texto !== "") previo = NaN;
    if (!Number.isNaN(previo)) {
      m = previo + 1;
      writeFileSync(archivo, String(m));
    }
  } catch {}
  try {
    rmdirSync(candado);
  } catch {}
  return m;
}

if (fase === "post" && hb && /^[0-9]+$/.test(env.PA_MAX_TURNS ?? "")) {
  const n = sumarTurno();
  const quedan = parseInt(env.PA_MAX_TURNS, 10) - n;
  if (quedan <= 5 && quedan >= 0) {
    aviso = `${aviso ? `${aviso} ` : ""}AVISO DEL ORQUESTADOR: te quedan como mucho ${quedan} turnos. Commiteá lo que hiciste (archivo por archivo) y respondé YA con RESULTADO/ARCHIVOS/DECISION, aunque falte algo: decilo en DECISION.`;
  }
}

// Un solo JSON: dos objetos seguidos harían que el CLI lea sólo el primero.
if (aviso) {
  escribir(1, `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: aviso } })}\n`);
}
salir(0);
