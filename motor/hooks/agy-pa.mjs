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
// pueden apuntar a un .sh —se corre con bash— o a un .mjs); y en Windows (win32, inyectable vía PA_AGY_PLAT para tests)
// el chequeo de privacidad soporta unidades (C:\...), barras mezcladas (/ y \), %USERPROFILE%/variables Windows y raíces
// sensibles de Windows (USERPROFILE, Users, Windows, ProgramData, raíces de unidad, UNC).
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

const plat = env.PA_AGY_PLAT || process.platform;
const win = plat === "win32";
const HOME = win ? env.USERPROFILE || env.HOME || homedir() : env.HOME || homedir();
const worker = !!env.PA_AGY_HB;
// agy nuevo: read_file/write_file/edit_file (parámetro `Path`) en vez de view_file/write_to_file/replace_file_content, y `bash`
// como alias de run_command (mismo `CommandLine`). Se normaliza a los nombres de siempre para que valgan todas las guardias.
const ALIAS = { read_file: "view_file", write_file: "write_to_file", edit_file: "replace_file_content", bash: "run_command" };
const herramientaCruda = campo("toolCall", "name");
const herramienta = Object.hasOwn(ALIAS, herramientaCruda) ? ALIAS[herramientaCruda] : herramientaCruda;
const cmd = campo("toolCall", "args", "CommandLine");

/** Corre una guardia (.mjs con node, lo demás con bash). Devuelve {status, signal, error, stdout, stderr}. */
function correrHook(archivo, args, input) {
  const [programa, base] = archivo.endsWith(".mjs") ? [process.execPath, [archivo]] : ["bash", [archivo]];
  const r = spawnSync(programa, [...base, ...args], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  return { status: r.status, signal: r.signal ?? null, error: r.error ?? null, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
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
if (!archivo) archivo = campo("toolCall", "args", "Path");
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
  search_web: "WebSearch",
  read_url_content: "WebFetch",
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
  if (g.error || g.signal || g.status !== 0) {
    const det = sinFinales(g.stderr) || g.error?.message || (g.signal ? `señal ${g.signal}` : `código ${g.status}`);
    negar(`BLOQUEADO: falló destructive-guard (${path.basename(GUARD)}): ${det}`);
  }
}
if (!worker) nada();

const leer = env.PA_AGY_MODO === "leer";

// Allowlist de herramientas: lo que no está acá no corre.
const lectura = "view_file|list_dir|find_by_name|grep_search|run_command|command_status|wait|wait_5_seconds|finish";
const escritura = "write_to_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit|send_command_input|manage_task";
// Internet: sólo en --leer (search_web = WebSearch, read_url_content = WebFetch). curl/wget siguen bloqueados por run_command.
const web = "search_web|read_url_content";
if (leer) {
  if (!new RegExp(`^(${lectura}|${web})$`).test(herramienta)) {
    negar(`BLOQUEADO: estás en modo LECTURA (pa --leer): '${herramientaCruda}' no está permitida. Para leer: view_file, list_dir, find_by_name, grep_search, y run_command sólo con git de lectura. Para internet: search_web y read_url_content (nada de curl ni wget).`);
  }
} else if (!new RegExp(`^(${lectura}|${escritura})$`).test(herramienta)) {
  negar(`BLOQUEADO: '${herramientaCruda}' no está permitida en un worker de pa (ni navegador, ni MCP, ni subagentes, ni mensajes, ni tareas programadas). Hacé el trabajo con los archivos y la terminal; si de verdad hace falta, decilo en DECISION.`);
}

// --- Privacidad: nada de leer fuera del worktree ni de salir a la red -------------------------
// El chequeo es LÉXICO (ve las rutas escritas en el comando, no lo que un intérprete arme por dentro): es una barrera, no una jaula.
const posix = (p) => p.replaceAll("\\", "/");
const normCmp = (p) => (win ? p.toLowerCase() : p);
const esWinAbs = (p) => /^[A-Za-z]:/.test(posix(p));
const esAbsoluta = (p) => (win ? posix(p).startsWith("/") || esWinAbs(p) : p.startsWith("/"));
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sinBarraFinal = (r) => (/^[A-Za-z]:\/$/.test(r) ? r : r.length > 1 && r.endsWith("/") ? r.slice(0, -1) : r);
/** `realpath -ms`: ruta absoluta normalizada sin resolver symlinks ni exigir que exista. */
function lex(p) {
  if (!win) {
    const abs = p.startsWith("/") ? p : path.posix.resolve(posix(process.cwd()), p);
    const r = path.posix.normalize(abs);
    return r.length > 1 && r.endsWith("/") ? r.slice(0, -1) : r;
  }
  let s = posix(p);
  if (/^\/\/\?\/[A-Za-z]:\//.test(s)) s = s.slice(4);
  else if (/^\/\/\?\/UNC\//i.test(s)) s = `//${s.slice(8)}`;
  let r;
  if (/^[A-Za-z]:$/.test(s)) {
    r = `${s}/`;
  } else if (/^[A-Za-z]:\//.test(s)) {
    const norm = path.posix.normalize(s.slice(2));
    r = `${s.slice(0, 2)}${norm.startsWith("/") ? norm : `/${norm}`}`;
  } else if (s.startsWith("//")) {
    r = posix(path.win32.normalize(s));
  } else if (s.startsWith("/")) {
    r = path.posix.normalize(s);
  } else {
    const base = env.PA_AGY_CWD || (process.platform === "win32" ? process.cwd() : esWinAbs(env.PA_AGY_RAIZ || "") ? env.PA_AGY_RAIZ : "C:\\");
    r = posix(path.win32.resolve(base, s));
  }
  return sinBarraFinal(r);
}
/** `realpath -m`: resuelve los symlinks de lo que existe y deja el resto como está. */
function realpathM(p) {
  const abs = lex(p);
  if (win) {
    // En tests con PA_AGY_PLAT=win32 desde Linux o rutas POSIX sintéticas (/tmp/...), no tocar realpathSync del host.
    if (process.platform !== "win32" || (abs.startsWith("/") && !abs.startsWith("//"))) return abs;
    let resto = "";
    let actual = abs;
    for (;;) {
      try {
        return sinBarraFinal(posix(path.win32.join(posix(realpathSync(actual)), resto)));
      } catch {
        const padre = posix(path.win32.dirname(actual));
        if (normCmp(padre) === normCmp(actual)) return abs;
        resto = posix(path.win32.join(path.win32.basename(actual), resto));
        actual = padre;
      }
    }
  }
  if (process.platform === "win32") return abs;
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
const tempRaw = win ? env.TEMP || env.TMP || env.TMPDIR || "" : "";
const tempCand = tempRaw && !/^\/tmp\/?$/.test(posix(tempRaw)) && (process.platform === "win32" || esWinAbs(tempRaw)) ? lex(tempRaw) : "";
const raizN = lex(env.PA_AGY_RAIZ || "/nonexistent");
const raizReal = realpathM(env.PA_AGY_RAIZ || "/nonexistent");
const homeN = lex(posix(HOME));
const homeReal = realpathM(posix(HOME));
const tempN = tempCand && normCmp(tempCand) !== normCmp(homeN) && !/^(?:\/|[a-z]:\/)$/.test(normCmp(tempCand)) ? tempCand : "";
const tempReal = tempN ? realpathM(tempN) : "";
const mapaN = env.PA_AGY_MAPA ? lex(env.PA_AGY_MAPA) : "";
const mapaReal = env.PA_AGY_MAPA ? realpathM(env.PA_AGY_MAPA) : "";
const raicesProhibidas = [homeN, "/home", "/root", "/etc", "/var", "/mnt", "/media", "/run", "/srv", "/boot", "/sys", "/proc", "/opt", "/dev"];
const WIN_RAICES = ["users", "documents and settings", "windows", "programdata", "recovery", "system volume information", "$recycle.bin"];
const WIN_PROHIBIDAS = new RegExp(`^(?:[a-z]:/(?:${WIN_RAICES.map(escRe).join("|")})(?:/|$)|[a-z]:/$|//)`);
const WIN_VARS_SENSIBLES = new Set([
  "USERPROFILE", "HOME", "LOCALAPPDATA", "APPDATA", "ROAMINGAPPDATA",
  "PROGRAMDATA", "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "HOMEDRIVE",
  "HOMEPATH", "ALLUSERSPROFILE", "PUBLIC", "ONEDRIVE",
]);
const igual = (a, b) => normCmp(a) === normCmp(b);
const dentro = (a, b) => {
  const x = normCmp(a);
  const y = normCmp(b);
  if (!y) return false;
  return x === y || x.startsWith(y.endsWith("/") ? y : `${y}/`);
};
function permitida(p, real = false) {
  const r = real ? raizReal : raizN;
  const h = real ? homeReal : homeN;
  const t = real ? tempReal : tempN;
  const m = real ? mapaReal : mapaN;
  if (dentro(p, r)) return true;
  if ((p === "/tmp" || p.startsWith("/tmp/")) && !(dentro(h, "/tmp") && dentro(p, h))) return true;
  if (t && dentro(p, t)) return true;
  if (m && igual(p, m)) return true;
  return ["/dev/null", "/dev/zero", "/dev/stdin", "/dev/stdout", "/dev/stderr", "/dev/urandom", "/dev/random"].includes(p) || (win && normCmp(p) === "nul");
}
function prohibida(p, real = false) {
  if (permitida(p, real)) return false;
  if (p === "/") return true;
  if (win && WIN_PROHIBIDAS.test(normCmp(p))) return true;
  const h = real ? homeReal : homeN;
  return [h, ...raicesProhibidas].some((r) => dentro(p, r));
}
function rutaSale(p) {
  const pLex = lex(p);
  if (prohibida(pLex, false)) return true;
  const pReal = realpathM(p);
  if (prohibida(pReal, true)) return true;
  if ((dentro(pLex, raizN) || dentro(pLex, raizReal)) && !dentro(pReal, raizReal)) return true;
  return false;
}
function expandirWin(s, cwd) {
  const casa = posix(HOME);
  const mapear = (nombre, orig) => {
    const u = nombre.toUpperCase();
    if (u === "USERPROFILE" || u === "HOME") return casa;
    if (u === "PWD") return cwd;
    if (u === "TEMP" || u === "TMP" || u === "TMPDIR") return tempN || "$TMPDIR";
    if (u === "LOCALAPPDATA" && env.LOCALAPPDATA && (process.platform === "win32" || esWinAbs(env.LOCALAPPDATA))) return posix(env.LOCALAPPDATA);
    if (u === "APPDATA" && env.APPDATA && (process.platform === "win32" || esWinAbs(env.APPDATA))) return posix(env.APPDATA);
    return orig;
  };
  return s
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, v) => mapear(v, m))
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (m, v) => mapear(v, m));
}
/** t = token tal como lo escribió el modelo, cwd = el directorio de trabajo. true si toca algo fuera del worktree. */
function tokenSale(t, cwd) {
  t = t.replaceAll("${HOME}", "$HOME");
  const casa = posix(HOME);
  if (win) {
    t = expandirWin(posix(t), cwd);
    const mVar = /^(?:%([A-Za-z_][A-Za-z0-9_]*)%|\$env:([A-Za-z_][A-Za-z0-9_]*))/i.exec(t);
    if (mVar && (WIN_VARS_SENSIBLES.has((mVar[1] || mVar[2]).toUpperCase()) || t.slice(mVar[0].length).includes("/"))) return true;
  }
  if (t === "~" || t.startsWith("~/")) t = casa + t.slice(1);
  else if (t.startsWith("~")) return true; // ~otro_usuario (comandoSale ya descartó los "~" de prosa o de código)
  else if (t === "$HOME" || t.startsWith("$HOME/")) t = casa + t.slice("$HOME".length);
  else if (t.startsWith("$XDG_") || t.startsWith("$PA_") || t.startsWith("$OLDPWD")) return true;
  else if (t === "$PWD" || t.startsWith("$PWD/")) t = cwd + t.slice("$PWD".length);
  else if (t === "$TMPDIR" || t.startsWith("$TMPDIR/")) return win && `/${t}/`.includes("/../");
  else if (/^\$[A-Za-z_][\s\S]*\/[\s\S]*$/.test(t)) return true; // $LO_QUE_SEA/… : no se sabe adónde apunta
  let p;
  if (esAbsoluta(t)) {
    // con glob: se mira el tramo fijo; si algún prohibido empieza igual, se niega
    if (/[*?]/.test(t)) {
      const pre = t.slice(0, t.search(/[*?]/));
      let preNorm = pre;
      if (win) {
        const sep = pre.lastIndexOf("/");
        if (sep >= 0) {
          const d = lex(pre.slice(0, sep + 1));
          preNorm = `${d}${d.endsWith("/") ? "" : "/"}${pre.slice(sep + 1)}`;
        }
        if (preNorm.startsWith("//")) return true;
      }
      const preSin = /^[A-Za-z]:\/$/.test(preNorm) ? preNorm : preNorm.replace(/\/$/, "");
      if (preSin && rutaSale(preSin)) return true;
      if (dentro(preSin, raizN)) return false;
      if (preNorm.startsWith("/tmp/") && !(dentro(homeN, "/tmp") && dentro(preSin, homeN))) return false;
      if (tempN && dentro(preSin, tempN) && normCmp(preNorm).startsWith(`${normCmp(tempN)}/`)) return false;
      const raices = [...raicesProhibidas, "/"];
      if (win) {
        const mDrv = /^([a-z]:\/)/.exec(normCmp(preNorm));
        if (mDrv) raices.push(mDrv[1], ...WIN_RAICES.map((g) => `${mDrv[1]}${g}`));
      }
      for (const r of raices) {
        const rn = normCmp(r);
        const pn = normCmp(preNorm);
        const rBarra = rn.endsWith("/") ? rn : `${rn}/`;
        if (rBarra.startsWith(pn) || pn.startsWith(rBarra) || pn === rn) return true;
      }
      return false;
    }
    p = t;
  } else {
    const sub = /[*?]/.test(t) ? t.slice(0, t.search(/[*?]/)) : t;
    if (!sub) return false;
    p = `${cwd}/${sub}`;
  }
  return rutaSale(p);
}
/**
 * Tokens que por sí solos no nombran nada sensible: "/", "//", "/**" (división, comentarios, JSX, prosa), "~", "~algo" (markdown,
 * regex). Sólo cuentan si aparecen como PALABRA suelta del shell: fuera de comillas y fuera del cuerpo de un heredoc.
 * Una ruta de verdad (/etc/x, ~/.ssh/x, /home/…) siempre se mira, esté donde esté.
 */
const ambiguo = (t) => /^\/[*/]*$/.test(t) || (win && /^\\+$/.test(t)) || t === "~" || /^~[A-Za-z_]/.test(t);
function sinTexto(c) {
  return c
    .replace(/(<<-?\s*(['"]?)([A-Za-z_]\w*)\2[^\n]*\n)[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g, "$1")
    .replace(/"(?:[^"\\]|\\[\s\S])*"|'[^']*'/g, " ");
}
/** En Windows conserva `C:\…`, URLs `scheme://…` y `$env:VAR` al dividir por `:` en comandoSale. */
function partirDosPuntos(w) {
  if (!win) return [w];
  const out = [];
  let i = 0;
  while (i < w.length) {
    const resto = w.slice(i);
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]/.test(resto)) {
      const fin = w.indexOf(":", i + resto.indexOf("://") + 3);
      if (fin === -1) { out.push(resto); break; }
      out.push(w.slice(i, fin));
      i = fin + 1;
      continue;
    }
    if (/^(?:[A-Za-z]:(?:[\\/]|\.\.)|\$env:[A-Za-z_][A-Za-z0-9_]*)/i.test(resto)) {
      const desde = resto[0] === "$" ? i + 5 : i + 2;
      const sig = w.indexOf(":", desde);
      if (sig === -1) { out.push(resto); break; }
      out.push(w.slice(i, sig));
      i = sig + 1;
      continue;
    }
    const sig = w.indexOf(":", i);
    if (sig === -1) { out.push(resto); break; }
    if (sig > i) out.push(w.slice(i, sig));
    i = sig + 1;
  }
  return out;
}
/**
 * Una raíz con espacios entre comillas (`cat "/home/x/mi carpeta/wt/a.ts"`) es UN argumento: se marca el espacio para que el corte por
 * palabras no la parta en «/home/x/mi» y «carpeta/wt/a.ts». Sólo cuando la raíz abre una comilla (sin comillas el shell sí la parte) y
 * termina en una barra, una comilla o un final: una ruta externa con el mismo prefijo (`…/wt-otro`) no se junta y se mira como siempre.
 */
const MARCA_ESPACIO = "\u0001";
function protegerRaiz(c) {
  const raiz = (env.PA_AGY_RAIZ || "").replace(/[\\/]+$/, "");
  if (!/[ \t]/.test(raiz)) return c;
  const sep = win ? "[\\\\/]+" : "/+";
  const cuerpo = raiz.split(win ? /[\\/]+/ : /\/+/).map(escRe).join(sep);
  const re = new RegExp(`(["'])${cuerpo}(?=$|[\\s"'/\\\\;&|)<>])`, win ? "gi" : "g");
  return c.replace(re, (m) => m.replace(/[ \t]/g, MARCA_ESPACIO));
}
/** Todo token de un texto de comando que salga del worktree -> lo devuelve (o null). */
function comandoSale(c, cwd) {
  const suelto = sinTexto(c);
  // el mensaje de un commit puede nombrar rutas sin leerlas; sólo si no ejecuta nada adentro (sed trabaja línea por línea)
  c = c
    .split("\n")
    .map((l) => l.replace(/(-m|--message)[\s=]+("[^"$`]*"|'[^']*')/g, " "))
    .join("\n");
  c = protegerRaiz(c.replaceAll("${HOME}", "$HOME"));
  if (win) c = c.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/gi, "$env:$1");
  const delim = win ? /[ \t\n;|&<>()"'`=,{}[\]]+/ : /[ \t\n;|&<>()"'`=:,{}[\]]+/;
  for (const bruto of c.split(delim)) {
    for (const parte of partirDosPuntos(bruto)) {
      const tok = parte.replaceAll(MARCA_ESPACIO, " ");
      if (!tok) continue;
      if (ambiguo(tok) && !new RegExp(`(^|[\\s;&|(<>=])${escRe(tok)}($|[\\s;&|)<>])`).test(suelto)) continue;
      if (tokenSale(tok, cwd)) return tok;
    }
  }
  return null;
}

let cwd = raizN;
if (worker) {
  let cwdPedido = campo("toolCall", "args", "Cwd");
  if (cwdPedido.startsWith('"')) cwdPedido = cwdPedido.slice(1);
  if (cwdPedido.endsWith('"')) cwdPedido = cwdPedido.slice(0, -1);
  const msgFuera = (x) =>
    `BLOQUEADO (privacidad): '${x}' está fuera de tu worktree (${env.PA_AGY_RAIZ || "?"}). Un worker Gemini no lee, lista, busca ni ejecuta nada fuera de su worktree (ni ~/.ssh, ~/.config, ~/.gemini, ~/.claude, /etc, otros proyectos, $HOME): lo que lee viaja a Google. Si hace falta, decilo en DECISION.`;
  const sospechosa = (v) => {
    const s = win ? posix(v) : v;
    return s.startsWith("/") || (win && (/^[A-Za-z]:/.test(s) || s.startsWith("%"))) || s.startsWith("~") || s.startsWith("$") || `/${s}/`.includes("/../");
  };
  if (cwdPedido) {
    if (tokenSale(cwdPedido, raizN)) negar(msgFuera(cwdPedido));
    const cwdExp = win ? expandirWin(posix(cwdPedido), raizN) : cwdPedido;
    cwd = lex(esAbsoluta(cwdExp) ? cwdExp : `${raizN}/${cwdExp}`);
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
            if (tokenSale(v, cwd)) negar(msgFuera(v));
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
    const sepDir = win ? String.raw`[^\s;&|]*[/\\]` : String.raw`[^\s;&|]*/`;
    const extWin = win ? String.raw`(?:\.(?:exe|cmd|bat))?` : "";
    const reRed = new RegExp(String.raw`(^|[;&|(` + "`" + String.raw`]|\$\(|-c\s+["'])\s*(` + preCmd + String.raw`)*(${sepDir})?` + red + extWin + String.raw`(\s|"|'|$)`, win ? "i" : "");
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
  if (!archivo) negar(`BLOQUEADO: no se pudo saber qué archivo escribe '${herramientaCruda}'.`);
  const archExp = win ? expandirWin(posix(archivo), cwd) : archivo;
  const archAbs = esAbsoluta(archExp) ? archExp : `${cwd}/${archExp}`;
  const archLex = lex(archAbs);
  const real = realpathM(archAbs);
  const rReal = raiz ? realpathM(raiz) : "";
  const saleDeRaiz = rReal && (dentro(archLex, raizN) || dentro(archLex, rReal)) && !dentro(real, rReal);
  let ok = false;
  if (rReal && dentro(real, rReal)) ok = true;
  if (!saleDeRaiz && real.startsWith("/tmp/") && !(dentro(homeReal, "/tmp") && dentro(real, homeReal))) ok = true;
  if (!saleDeRaiz && tempReal && dentro(real, tempReal) && !igual(real, tempReal)) ok = true;
  if (env.PA_AGY_MAPA && igual(real, mapaReal)) ok = true;
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
  if (ppal && !igual(ppal, env.PA_AGY_RAIZ || "")) {
    const cmdC = win ? posix(cmd).toLowerCase() : cmd;
    const ppalC = win ? posix(ppal).toLowerCase() : ppal;
    const pres = win ? ["cd ", "cd /d ", "pushd ", "-c "] : ["cd ", "pushd ", "-C "];
    for (const pre of pres) for (const q of ["", '"', "'"]) if (cmdC.includes(pre + q + ppalC)) ppalTocado = true;
  }
  if (ppalTocado) negar(`BLOQUEADO: '${ppal}' es el tree principal del proyecto: no se toca desde un worker. Trabajá en tu worktree (${env.PA_AGY_RAIZ || ""}).`);
}

// latido: el latido, y todas las guardias de un worker Claude (stash, add -A, commit -a, release, cargo clean, dependencias con
// otro writer, allowlist de --leer, recorte de tests).
const argsLatido = [env.PA_AGY_HB, "pre", ...(leer ? ["leer"] : [])];
const l = correrHook(LATIDO, argsLatido, claudeJson);
if (l.status === 2) negar(sinFinales(l.stderr) || "BLOQUEADO por latido.sh.");
if (l.error || l.signal || l.status !== 0) {
  const det = sinFinales(l.stderr) || l.error?.message || (l.signal ? `señal ${l.signal}` : `código ${l.status}`);
  negar(`BLOQUEADO: falló latido (${path.basename(LATIDO)}): ${det}`);
}
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
