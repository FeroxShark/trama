#!/usr/bin/env node
// docker-guard.mjs: port a Node (sin dependencias) de docker-guard.py. Bloquea docker/podman que pueden tocar el HOST de la
// sesión del dueño. Lo carga destructive-guard.mjs (hook PreToolUse de Bash) y llama a `revisar(d)` con el JSON del hook;
// 2 = bloquear, con el motivo por stderr (le vuelve al modelo). Suelto, lee el JSON por stdin y sale con ese código.
//
// Qué mira, por qué existe y sus límites honestos: ver docker-guard.py (mismo análisis, mismas reglas). Resumen: `run` y
// `create` de docker/podman/docker-compose/podman-compose y `compose run|up|create|watch|scale`, también detrás de
// sudo/env/timeout/xargs, `sh -c '…'`, `$(…)`, backticks y heredocs; --privileged, --device, -v/--mount de /dev /sys /proc
// /run/systemd…, pid/ipc/cgroupns=host, --cap-add peligrosos, --security-opt unconfined, e init/systemd como proceso
// principal (también el que trae la imagen: `image inspect`). Si el hook mismo se rompe, deja pasar (nunca frena por un bug).
//
// Diferencia conocida con el .py: el compose.yaml sólo se audita si el paquete `yaml` de npm se puede cargar (el .py usa
// PyYAML y, sin él, tampoco lo mira). Node no trae un parser de YAML y este hook no tiene dependencias.
import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync, realpathSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;

let yaml = null;
try {
  // Opcional: sólo si el paquete está a mano. Sin él, el compose.yaml no se mira (como el .py sin PyYAML).
  const m = await import("yaml");
  yaml = m.default ?? m;
} catch {
  yaml = null;
}

function escribirErr(texto) {
  const buf = Buffer.from(texto);
  let off = 0;
  let intentos = 0;
  while (off < buf.length && intentos < 2000) {
    try {
      off += writeSync(2, buf, off);
    } catch (e) {
      if (e.code !== "EAGAIN") return;
      intentos++;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}

// --- helpers de Python (posixpath, os.path, shlex) -----------------------------------------
const casa = () => (process.platform === "win32" ? env.USERPROFILE || env.HOME || homedir() : env.HOME || homedir());
const basename = (p) => p.slice(p.lastIndexOf("/") + 1);
const dirname = (p) => {
  const i = p.lastIndexOf("/") + 1;
  let h = p.slice(0, i);
  if (h && h !== "/".repeat(h.length)) h = h.replace(/\/+$/, "");
  return h;
};
const unir = (a, b) => (b.startsWith("/") ? b : !a || a.endsWith("/") ? a + b : `${a}/${b}`);
function normpath(p) {
  if (!p) return ".";
  const r = path.posix.normalize(p);
  return r.length > 1 && r.endsWith("/") ? r.slice(0, -1) : r;
}
function expandir(p) {
  if (p === "~" || p.startsWith("~/")) return casa() + p.slice(1);
  return p;
}
/** os.path.realpath: resuelve lo que existe y deja el resto como está. */
function realpath(p) {
  let resto = "";
  let actual = p;
  for (;;) {
    try {
      return path.posix.join(realpathSync(actual), resto) || "/";
    } catch {
      const padre = path.posix.dirname(actual);
      if (padre === actual) return p;
      resto = path.posix.join(path.posix.basename(actual), resto);
      actual = padre;
    }
  }
}
const esArchivo = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
/** shutil.which */
function which(nombre) {
  const exts = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const d of (env.PATH || "").split(path.delimiter)) {
    if (!d) continue;
    for (const e of exts) {
      const ruta = path.join(d, nombre + e);
      try {
        if (!statSync(ruta).isFile()) continue;
        accessSync(ruta, constants.X_OK);
        return ruta;
      } catch {}
    }
  }
  return null;
}
/** shlex.split (POSIX). Tira si hay una comilla sin cerrar o una barra al final, como ValueError. */
function shlexSplit(s) {
  const res = [];
  let cur = "";
  let hay = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (hay) res.push(cur);
      cur = "";
      hay = false;
      i++;
    } else if (c === "\\") {
      if (i + 1 >= s.length) throw new Error("No escaped character");
      cur += s[i + 1];
      hay = true;
      i += 2;
    } else if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) throw new Error("No closing quotation");
      cur += s.slice(i + 1, j);
      hay = true;
      i = j + 1;
    } else if (c === '"') {
      i++;
      for (;;) {
        if (i >= s.length) throw new Error("No closing quotation");
        if (s[i] === '"') {
          i++;
          break;
        }
        if (s[i] === "\\") {
          if (i + 1 >= s.length) throw new Error("No closing quotation");
          const n = s[i + 1];
          cur += n === '"' || n === "\\" ? n : `\\${n}`;
          i += 2;
        } else cur += s[i++];
      }
      hay = true;
    } else {
      cur += c;
      hay = true;
      i++;
    }
  }
  if (hay) res.push(cur);
  return res;
}
const esDigitos = (s) => /^[0-9]+$/.test(s);
const trimPy = (s) => s.trim();

/** TRAMA_DUENO -> `dueno` de perfil.json -> $USER con mayúscula inicial -> "el usuario". */
function nombreDueno() {
  let n = trimPy(env.TRAMA_DUENO || "");
  if (!n) {
    const config =
      process.platform === "win32"
        ? path.win32.join(env.LOCALAPPDATA || path.win32.join(casa(), "AppData", "Local"), "trama", "config")
        : path.join(env.XDG_CONFIG_HOME || path.join(casa(), ".config"), "trama");
    const perfil = env.TRAMA_PERFIL || path.join(config, "perfil.json");
    try {
      const d = JSON.parse(readFileSync(perfil, "utf8"));
      n = trimPy(String(d.dueno || ""));
    } catch {
      n = "";
    }
  }
  if (!n) {
    const u = trimPy(env.USER || env.USERNAME || "");
    n = u.slice(0, 1).toUpperCase() + u.slice(1);
  }
  return n || "el usuario";
}

const EXPLICACION =
  "Un worker corrió en el desktop de {D} un contenedor con systemd como " +
  "PID 1 (debian + systemd-sysv); ese systemd operó contra el host, el login manager cerró la " +
  "sesión gráfica y hubo que reiniciar la PC. Un contenedor con --privileged, --device, /dev, /sys, " +
  "/sys/fs/cgroup, /run/systemd, /run/udev o el D-Bus del host, con pid/ipc/cgroupns=host, " +
  "--cap-add SYS_ADMIN|ALL o seccomp/apparmor unconfined comparte kernel y servicios con la " +
  "sesión gráfica: toca el HOST, no es un sandbox. Alternativas: (1) probá sin systemd de PID 1 " +
  "(un proceso normal en el contenedor; `--init` sí está permitido); (2) si necesitás systemd o " +
  "hardware real, dejalo para una VM o para el server (ssh); (3) pedíselo al jefe/{D}, que " +
  "lo corre a mano fuera de esta sesión.";

class Bloqueo extends Error {}

// --- qué es peligroso ---------------------------------------------------------------------
const RAICES_HOST = ["/dev", "/sys", "/proc", "/run/systemd", "/run/udev", "/run/dbus", "/run/user", "/var/run/systemd", "/var/run/udev", "/var/run/dbus", "/var/run/user"];
// Contienen a las de arriba: montarlos entrega también el socket de systemd / D-Bus.
const ANCESTROS_HOST = ["/", "/run", "/var/run"];
const CAPS_PELIGROSAS = new Set(["SYS_ADMIN", "ALL", "SYS_MODULE", "SYS_RAWIO"]);
// Únicos dispositivos que se dejan pasar con --device / `devices:` (el TUN de los sidecars de tailscale).
const DEVICES_INOFENSIVOS = new Set(["/dev/net/tun"]);
const deviceInofensivo = (spec) => DEVICES_INOFENSIVOS.has(String(spec).trim().split(":")[0]);
const INIT_RE = /(?<![\w./-])(?:\/usr)?(?:\/local)?\/(?:s?bin\/init|lib\/systemd\/systemd|bin\/systemd)(?![\w./-])/;

// --- flags que llevan valor (para saber dónde termina el nombre y empieza la imagen) --------
const conPrefijo = (pre, texto) => new Set(texto.split(/\s+/).filter(Boolean).map((s) => pre + s));
const RUN_LARGAS = conPrefijo(
  "--",
  `add-host annotation attach blkio-weight blkio-weight-device cap-add
cap-drop cgroup-parent cgroupns cgroups cgroup-conf cidfile cpu-period cpu-quota cpu-rt-period cpu-rt-runtime
cpu-shares cpus cpuset-cpus cpuset-mems detach-keys device device-cgroup-rule device-read-bps device-read-iops
device-write-bps device-write-iops dns dns-option dns-search domainname entrypoint env env-file env-from-file
env-merge expose gpus group-add health-cmd health-interval health-retries health-start-interval
health-start-period health-timeout hostname ip ip6 ipc isolation label label-file link link-local-ip
log-driver log-opt mac-address memory memory-reservation memory-swap memory-swappiness mount name network
network-alias oom-score-adj pid pids-limit platform publish pull restart runtime security-opt shm-size
stop-signal stop-timeout storage-opt sysctl tmpfs ulimit umask user userns uts volume volume-driver
volumes-from workdir authfile arch os cert-dir creds decryption-key gidmap uidmap subuidname subgidname
hostuser hooks-dir image-volume init-path pod pod-id-file pidfile conmon-pidfile passwd-entry group-entry
sdnotify secret seccomp-policy timeout tz unsetenv variant preserve-fds retry retry-delay read-only-tmpfs
chrootdirs systemd mac`,
);
const RUN_CORTAS = new Set("acehlmpuvw");
const GLOBAL_LARGAS = conPrefijo(
  "--",
  `config context host log-level tlscacert tlscert tlskey connection url
identity root runroot storage-driver storage-opt cgroup-manager events-backend hooks-dir conmon runtime
network-backend network-config-dir imagestore tmpdir volumepath cni-config-dir namespace`,
);
const GLOBAL_CORTAS = new Set("Hcl");
const COMPOSE_LARGAS = conPrefijo("--", "file project-name profile project-directory env-file ansi parallel progress");
const COMPOSE_CORTAS = new Set("fp");
const union = (a, b) => new Set([...a, ...b]);

const DOCKERS = new Set(["docker", "podman", "docker-compose", "podman-compose"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash"]);
const WRAPPERS = new Set(["sudo", "doas", "pkexec", "env", "command", "exec", "nohup", "timeout", "setsid", "nice", "ionice", "stdbuf", "xargs", "watch", "unbuffer", "flock", "chrt", "taskset", "builtin", "chronic"]);
const RESERVADAS = new Set(["{", "}", "!", "if", "then", "else", "elif", "do", "while", "until", "time"]);
const ASIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const COMPOSE_NOMBRES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
// Los verbos de compose que CREAN o arrancan contenedores desde el compose.yaml.
const VERBOS_COMPOSE = ["run", "create", "up", "watch", "scale"];
const COMPOSE_OVERRIDE = ["compose.override.yaml", "compose.override.yml", "docker-compose.override.yaml", "docker-compose.override.yml"];

// --- lectura del comando --------------------------------------------------------------------
// Separadores de lista (no de pipe): lo que queda entre dos es UNA pipeline.
const SEP_LISTA = /;|&&|\|\||(?<![<>&|])&(?![>&])/;
const ultimo = (a) => a[a.length - 1];

/** ¿El comando de este segmento es un shell local, directo o detrás de wrappers? */
function segmentoEsShell(seg) {
  let i = 0;
  while (i < seg.length && (ASIGN.test(seg[i]) || RESERVADAS.has(seg[i]))) i++;
  let wrapper = false;
  for (const tok of seg.slice(i)) {
    const base = basename(tok);
    if (SHELLS.has(base)) return true;
    if (WRAPPERS.has(base)) wrapper = true;
    else if (!wrapper) return false;
  }
  return false;
}

/** ¿La pipeline donde está el heredoc (linea[ini:fin]) le pasa su cuerpo a un shell? */
function lineaCorreShell(linea, ini, fin) {
  const pipeline = `${ultimo(linea.slice(0, ini).split(SEP_LISTA))} ${linea.slice(fin).split(SEP_LISTA)[0]}`;
  const [segs] = partir(pipeline);
  return segs.some(segmentoEsShell);
}

/** (texto sin los cuerpos de heredoc, [textos que corre un shell]). */
function sacarHeredocs(texto) {
  const lineas = texto.split("\n");
  const salida = [];
  let scripts = [];
  let i = 0;
  while (i < lineas.length) {
    const linea = lineas[i];
    salida.push(linea);
    i++;
    const re = /<<-?\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_]\w*))/g;
    let m;
    while ((m = re.exec(linea)) !== null) {
      if (m.index > 0 && linea[m.index - 1] === "<") continue; // <<< here-string
      const delim = m[1] || m[2] || m[3];
      let fin = null;
      for (let j = i; j < lineas.length; j++) {
        if (lineas[j].trim() === delim) {
          fin = j;
          break;
        }
      }
      if (fin === null) break;
      const cuerpo = lineas.slice(i, fin).join("\n");
      if (lineaCorreShell(linea, m.index, m.index + m[0].length)) scripts.push(cuerpo);
      else if (!(m[1] || m[2] || m[0].includes("\\"))) scripts = scripts.concat(subcomandos(cuerpo)); // <<EOF sin comillas
      i = fin + 1;
      break;
    }
  }
  return [salida.join("\n"), scripts];
}

/** Índice justo después del `)` que cierra un `$(` cuyo contenido empieza en t[i]. */
function finSubst(t, i) {
  const n = t.length;
  let prof = 1;
  while (i < n) {
    const c = t[i];
    if (c === "\\") i += 2;
    else if (c === "'") {
      const j = t.indexOf("'", i + 1);
      i = j < 0 ? n : j + 1;
    } else if (c === '"') i = finComillas(t, i + 1);
    else if (c === "`") {
      const j = t.indexOf("`", i + 1);
      i = j < 0 ? n : j + 1;
    } else if (t.startsWith("$(", i)) {
      prof++;
      i += 2;
    } else if (c === "(") {
      prof++;
      i++;
    } else if (c === ")") {
      prof--;
      i++;
      if (prof === 0) return i;
    } else i++;
  }
  return n;
}

/** Índice justo después del `"` que cierra un string que empieza en t[i]. */
function finComillas(t, i) {
  const n = t.length;
  while (i < n) {
    const c = t[i];
    if (c === "\\") i += 2;
    else if (c === '"') return i + 1;
    else if (t.startsWith("$(", i)) i = finSubst(t, i + 2);
    else if (c === "`") {
      const j = t.indexOf("`", i + 1);
      i = j < 0 ? n : j + 1;
    } else i++;
  }
  return n;
}

/** `$(…)` (balanceado) y `…` dentro del texto de un string con comillas dobles: el shell los ejecuta. */
function subcomandos(t) {
  const res = [];
  let i = 0;
  while (i < t.length) {
    if (t.startsWith("$(", i)) {
      let prof = 1;
      let j = i + 2;
      while (j < t.length && prof) {
        prof += (t[j] === "(") - (t[j] === ")");
        j++;
      }
      res.push(prof === 0 ? t.slice(i + 2, j - 1) : t.slice(i + 2));
      i = j;
    } else if (t[i] === "`") {
      let j = t.indexOf("`", i + 1);
      if (j < 0) j = t.length;
      res.push(t.slice(i + 1, j));
      i = j + 1;
    } else i++;
  }
  return res;
}

/** Texto -> [segmentos, subtextos]. Segmento = lista de palabras ya sin comillas, cortada en ; & | ( ) $( ` y saltos de línea. */
function partir(texto) {
  texto = texto.replaceAll("\\\n", "");
  const n = texto.length;
  const segs = [[]];
  const subs = [];
  let palabra = [];
  let hay = false;
  let saltar = false;
  let i = 0;

  const cerrar = () => {
    if (hay) {
      if (saltar) saltar = false;
      else ultimo(segs).push(palabra.join(""));
    }
    palabra = [];
    hay = false;
  };
  const cortar = () => {
    cerrar();
    saltar = false;
    if (ultimo(segs).length) segs.push([]);
  };

  while (i < n) {
    const c = texto[i];
    if (c === "\\" && i + 1 < n) {
      palabra.push(texto[i + 1]);
      hay = true;
      i += 2;
    } else if (c === "'") {
      let j = texto.indexOf("'", i + 1);
      if (j < 0) j = n;
      palabra.push(texto.slice(i + 1, j));
      hay = true;
      i = j + 1;
    } else if (c === '"') {
      // Los $(…) y backticks de adentro se cortan con finSubst, que respeta SUS comillas.
      let j = i + 1;
      const buf = [];
      while (j < n && texto[j] !== '"') {
        if (texto[j] === "\\" && j + 1 < n && '"\\$`'.includes(texto[j + 1])) {
          buf.push(texto[j + 1]);
          j += 2;
        } else if (texto.startsWith("$(", j)) {
          const k = finSubst(texto, j + 2);
          subs.push(texto.slice(k - 1, k) === ")" ? texto.slice(j + 2, k - 1) : texto.slice(j + 2, k));
          buf.push(texto.slice(j, k));
          j = k;
        } else if (texto[j] === "`") {
          let k = texto.indexOf("`", j + 1);
          if (k < 0) k = n;
          subs.push(texto.slice(j + 1, k));
          buf.push(texto.slice(j, k + 1));
          j = k + 1;
        } else {
          buf.push(texto[j]);
          j++;
        }
      }
      palabra.push(buf.join(""));
      hay = true;
      i = j + 1;
    } else if (texto.startsWith("$(", i)) {
      cortar();
      i += 2;
    } else if (c === "`" || ";&|()\n".includes(c)) {
      cortar();
      i++;
    } else if (c === " " || c === "\t") {
      cerrar();
      i++;
    } else if (c === "#" && !hay) {
      const j = texto.indexOf("\n", i);
      i = j < 0 ? n : j;
    } else if (c === "<" || c === ">") {
      if (hay && esDigitos(palabra.join(""))) {
        // `2>&1`: el 2 es un fd, no una palabra
        palabra = [];
        hay = false;
      } else cerrar();
      while (i < n && "<>&|-".includes(texto[i])) i++;
      while (i < n && (texto[i] === " " || texto[i] === "\t")) i++;
      // Sólo hay objetivo que saltear si sigue una palabra: `>&-` no tiene, `<(cmd)` es un comando, y `> $(cmd)` también corre cmd.
      if (i < n && !";&|()\n`".includes(texto[i]) && !texto.startsWith("$(", i)) saltar = true;
    } else {
      palabra.push(c);
      hay = true;
      i++;
    }
  }
  cerrar();
  return [segs.filter((s) => s.length), subs];
}

class Ctx {
  constructor(cwd) {
    this.cwd = cwd;
  }
}

function analizar(texto, ctx, prof = 0) {
  if (prof > 5) return;
  const [sinHeredocs, scripts] = sacarHeredocs(texto);
  const [segs, subs] = partir(sinHeredocs);
  for (const s of scripts.concat(subs)) analizar(s, ctx, prof + 1);
  for (const seg of segs) analizarSegmento(seg, ctx, prof);
}

/** El argumento de `-c` de un shell (null si corre un archivo o no hay -c). */
function scriptDeShell(args) {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(a)) return i + 1 < args.length ? args[i + 1] : null;
    if (["-o", "+o", "-O", "+O"].includes(a)) {
      i += 2;
      continue;
    }
    if (!a.startsWith("-") && !a.startsWith("+")) return null;
    i++;
  }
  return null;
}

function analizarSegmento(seg, ctx, prof) {
  let i = 0;
  while (i < seg.length && (ASIGN.test(seg[i]) || RESERVADAS.has(seg[i]))) i++;
  if (i >= seg.length) return;
  if (seg[i] === "cd") {
    let destino = seg.slice(i + 1).find((a) => !a.startsWith("-")) ?? "~";
    if (!destino.includes("$")) {
      destino = expandir(destino);
      ctx.cwd = normpath(unir(ctx.cwd || "/", destino));
    }
    return;
  }
  let wrapper = false;
  for (let j = i; j < seg.length; j++) {
    const base = basename(seg[j]);
    if (DOCKERS.has(base)) {
      analizarDocker(base, seg.slice(j + 1), ctx);
      return;
    }
    if (SHELLS.has(base)) {
      const script = scriptDeShell(seg.slice(j + 1));
      if (script !== null) analizar(script, ctx, prof + 1);
      return;
    }
    if (base === "eval") {
      analizar(seg.slice(j + 1).join(" "), ctx, prof + 1);
      return;
    }
    if (WRAPPERS.has(base)) wrapper = true;
    else if (!wrapper) return;
  }
}

// --- docker/podman ---------------------------------------------------------------------------
/** Opciones desde args[i] hasta el primer posicional. -> [[(nombre, valor|null)], índice del posicional]. */
function parsear(args, largas, cortas, i = 0) {
  const opts = [];
  const n = args.length;
  while (i < n) {
    const a = args[i];
    if (a === "--") return [opts, i + 1];
    if (a === "-" || !a.startsWith("-")) return [opts, i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) opts.push([a.slice(0, eq), a.slice(eq + 1)]);
      else if (largas.has(a)) {
        opts.push([a, i + 1 < n ? args[i + 1] : ""]);
        i++;
      } else opts.push([a, null]);
    } else {
      // cluster corto: -itv /dev:/dev, -p8080:80
      for (let j = 1; j < a.length; j++) {
        if (cortas.has(a[j])) {
          let resto = a.slice(j + 1);
          if (resto.startsWith("=")) resto = resto.slice(1);
          if (resto) opts.push([`-${a[j]}`, resto]);
          else {
            opts.push([`-${a[j]}`, i + 1 < n ? args[i + 1] : ""]);
            i++;
          }
          break;
        }
        opts.push([`-${a[j]}`, null]);
      }
    }
    i++;
  }
  return [opts, i];
}

function siguiente(args, i, largas, cortas) {
  const [opts, k] = parsear(args, largas, cortas, i);
  return k < args.length ? [opts, args[k], k + 1] : [opts, null, k];
}

function analizarDocker(base, args, ctx) {
  const esComposeBin = base.endsWith("-compose");
  let sub;
  let i;
  let compose;
  let optsC = [];
  let globales = [];
  if (esComposeBin) {
    [optsC, sub, i] = siguiente(args, 0, union(COMPOSE_LARGAS, GLOBAL_LARGAS), union(COMPOSE_CORTAS, GLOBAL_CORTAS));
    compose = true;
  } else {
    [globales, sub, i] = siguiente(args, 0, GLOBAL_LARGAS, GLOBAL_CORTAS);
    compose = sub === "compose";
    if (compose) [optsC, sub, i] = siguiente(args, i, COMPOSE_LARGAS, COMPOSE_CORTAS);
    else if (sub === "container") [, sub, i] = siguiente(args, i, new Set(), new Set());
  }
  if (compose) {
    if (VERBOS_COMPOSE.includes(sub)) revisarComposeArchivos(optsC, ctx, base.startsWith("podman") ? "podman" : "docker");
    if (sub !== "run") return;
  } else if (sub !== "run" && sub !== "create") return;
  const [opts, k] = parsear(args, RUN_LARGAS, RUN_CORTAS, i);
  const imagen = k < args.length ? args[k] : null;
  const comando = imagen !== null ? args.slice(k + 1) : [];
  revisarOpciones(opts);
  const entrypoint = [...opts].reverse().find(([nombre]) => nombre === "--entrypoint")?.[1] ?? null;
  revisarInit(entrypoint, comando);
  const remoto = globales.some(([nombre]) => ["-H", "--host", "-c", "--context", "--connection", "--url", "-r", "--remote"].includes(nombre));
  if (!compose && imagen && entrypoint === null && !remoto) revisarImagen(base, imagen, comando);
}

const falso = (v) => v !== null && v !== undefined && ["false", "0", "no", "f", "n"].includes(v.trim().toLowerCase());

/** ¿Este origen de bind mount es (o contiene) algo del host que no se puede compartir? */
function fuentePeligrosa(src) {
  if (!src.startsWith("/")) return false; // volumen con nombre, relativo, ~ o $VAR: no lo sé
  const norm = normpath(src.replace(/^\/+/, "/"));
  const reales = new Set([norm]);
  try {
    reales.add(realpath(norm));
  } catch {}
  for (const c of reales) {
    if (ANCESTROS_HOST.includes(c)) return true;
    if (RAICES_HOST.some((r) => c === r || c.startsWith(`${r}/`))) return true;
  }
  return false;
}

function revisarOpciones(opts) {
  for (const [nombre, val] of opts) {
    const v = (val ?? "").trim();
    if (nombre === "--privileged" && !falso(val)) throw new Bloqueo("--privileged le da al contenedor todos los dispositivos y capacidades del host");
    if (nombre === "--device-cgroup-rule" || (nombre === "--device" && !deviceInofensivo(v))) throw new Bloqueo(`${nombre} ${v}: expone dispositivos del host`);
    if ((nombre === "-v" || nombre === "--volume") && v.includes(":") && fuentePeligrosa(v.split(":")[0])) throw new Bloqueo(`montar ${v.split(":")[0]} del host (${nombre} ${v})`);
    if (nombre === "--mount") {
      for (const campo of v.split(",")) {
        const eq = campo.indexOf("=");
        const k = eq < 0 ? campo : campo.slice(0, eq);
        const x = eq < 0 ? "" : campo.slice(eq + 1);
        if (["source", "src"].includes(k.trim()) && fuentePeligrosa(x.trim())) throw new Bloqueo(`montar ${x.trim()} del host (--mount ${v})`);
      }
    }
    if (["--pid", "--ipc", "--cgroupns"].includes(nombre) && v.toLowerCase() === "host") throw new Bloqueo(`${nombre}=${v} comparte ese namespace con el host`);
    if (nombre === "--cap-add") {
      for (let cap of v.toUpperCase().split(",")) {
        cap = cap.trim();
        cap = cap.startsWith("CAP_") ? cap.slice(4) : cap;
        if (CAPS_PELIGROSAS.has(cap)) throw new Bloqueo(`--cap-add ${v}: la capacidad ${cap} actúa sobre el host`);
      }
    }
    if (nombre === "--security-opt" && v.toLowerCase().includes("unconfined")) throw new Bloqueo(`--security-opt ${v} apaga el aislamiento (seccomp/apparmor/systempaths)`);
  }
}

// `systemd` pelado como comando de un script: al principio, tras ; & | o tras exec.
const SYSTEMD_EN_SCRIPT = /(?:^|[;&|(]|\bexec)\s*systemd(?![\w./-])/;

/** ¿El primer proceso sería systemd / un init de verdad? */
function esInit(tokens) {
  if (tokens.length && basename(String(tokens[0])) === "systemd") return true;
  // un `sh -c "exec systemd"`: el script es un token con espacios, o el que sigue a un -c
  const toks = tokens.map(String);
  for (let k = 1; k < toks.length; k++) {
    const esScript = toks[k].includes(" ") || toks[k].includes(";") || /^-[A-Za-z]*c[A-Za-z]*$/.test(toks[k - 1]);
    if (esScript && SYSTEMD_EN_SCRIPT.test(toks[k])) return true;
  }
  return toks.some((t) => INIT_RE.test(t));
}

/** `command:`/`entrypoint:` de compose: lista tal cual, o string partido como lo parte compose (shlex). */
function tokensCompose(val) {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string") {
    try {
      return shlexSplit(val);
    } catch {
      return val.split(/\s+/).filter(Boolean);
    }
  }
  return [];
}

function revisarInit(entrypoint, comando) {
  if (entrypoint !== null && esInit([entrypoint.trim()])) throw new Bloqueo(`--entrypoint ${entrypoint}: systemd/init como proceso principal`);
  if (esInit(comando)) throw new Bloqueo(`${comando.join(" ").slice(0, 80)}: systemd/init como proceso principal`);
}

/** El init también puede venir de la imagen (CMD /lib/systemd/systemd). Cualquier falla = no sé = pasa. */
function revisarImagen(base, imagen, comando) {
  if (base !== "docker" && base !== "podman") return;
  const r = initDeImagen(base, imagen, true);
  if (!r) return;
  const [ent, cmd] = r;
  const efectivo = ent.concat(comando && comando.length ? comando : cmd);
  if (esInit(efectivo)) throw new Bloqueo(`la imagen ${imagen} arranca systemd/init como proceso principal (${efectivo.map(String).join(" ").slice(0, 80)})`);
}

// --- compose.yaml ----------------------------------------------------------------------------
function revisarComposeArchivos(optsC, ctx, exe = "docker") {
  if (!yaml) return;
  const base = ctx.cwd || process.cwd();
  let archivos = optsC.filter(([n, v]) => (n === "-f" || n === "--file") && v && !v.includes("$")).map(([, v]) => v);
  // Sin -f, compose busca el archivo en --project-directory, no en el cwd.
  const proyecto = [...optsC].reverse().find(([n, v]) => n === "--project-directory" && v && !v.includes("$"))?.[1] ?? null;
  if (archivos.length) archivos = archivos.map((a) => unir(base, expandir(a)));
  else {
    let d = proyecto ? unir(base, expandir(proyecto)) : base;
    for (let n = 0; n < 12; n++) {
      // compose busca hacia arriba
      const hallados = COMPOSE_NOMBRES.map((x) => unir(d, x)).filter(esArchivo);
      if (hallados.length) {
        archivos = hallados.slice(0, 1).concat(COMPOSE_OVERRIDE.map((x) => unir(d, x)).filter(esArchivo));
        break;
      }
      const padre = dirname(d);
      if (padre === d) break;
      d = padre;
    }
  }
  for (const a of archivos) {
    let doc;
    try {
      if (statSync(a).size > 2_000_000) continue;
      doc = yaml.parse(readFileSync(a, "utf8"));
    } catch {
      continue;
    }
    try {
      auditarCompose(doc, a, exe);
    } catch (e) {
      if (e instanceof Bloqueo) throw e;
    }
  }
}

const verdad = (v) => v === true || (typeof v === "string" && ["true", "yes", "on"].includes(v.trim().toLowerCase()));
const esObjeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** `s.get(k) or []` de Python. */
const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function auditarCompose(doc, archivo, exe = "docker") {
  const servicios = esObjeto(doc) ? doc.services : null;
  if (!esObjeto(servicios)) return;
  for (const [nombre, s] of Object.entries(servicios)) {
    if (!esObjeto(s)) continue;
    const donde = `${archivo}, servicio ${nombre}`;
    if (verdad(s.privileged)) throw new Bloqueo(`privileged: true (${donde})`);
    for (const k of ["pid", "ipc", "cgroup"]) {
      if (String(s[k] ?? "").trim().toLowerCase() === "host") throw new Bloqueo(`${k}: host (${donde})`);
    }
    if (s.device_cgroup_rules && (!Array.isArray(s.device_cgroup_rules) || s.device_cgroup_rules.length)) throw new Bloqueo(`device_cgroup_rules (${donde})`);
    for (const d of lista(s.devices)) {
      if (!deviceInofensivo(esObjeto(d) ? (d.source ?? "") : d)) throw new Bloqueo(`devices: ${typeof d === "string" ? d : JSON.stringify(d)} (${donde})`);
    }
    for (let cap of lista(s.cap_add)) {
      cap = String(cap).trim().toUpperCase();
      if (CAPS_PELIGROSAS.has(cap.startsWith("CAP_") ? cap.slice(4) : cap)) throw new Bloqueo(`cap_add: ${cap} (${donde})`);
    }
    for (const so of lista(s.security_opt)) {
      if (String(so).toLowerCase().includes("unconfined")) throw new Bloqueo(`security_opt: ${so} (${donde})`);
    }
    for (const v of lista(s.volumes)) {
      let src;
      if (esObjeto(v)) src = (v.type ?? "bind") === "bind" ? String(v.source ?? "") : "";
      else src = String(v).includes(":") ? String(v).split(":")[0] : "";
      if (src && fuentePeligrosa(src)) throw new Bloqueo(`monta ${src} del host (${donde})`);
    }
    for (const campo of ["entrypoint", "command"]) {
      if (esInit(tokensCompose(s[campo]))) throw new Bloqueo(`${campo}: systemd/init como proceso principal (${donde})`);
    }
    revisarInitDeServicio(s, archivo, donde, exe);
  }
}

/** Entrypoint+Cmd de una imagen local por `image inspect` (lee config, no corre nada), o null si no se sabe. */
function initDeImagen(exe, imagen, solo = false) {
  if (typeof imagen !== "string" || !imagen || /[$`\s]/.test(imagen) || imagen.startsWith("-")) return null;
  const otro = exe === "podman" ? "docker" : "podman";
  let ent = null;
  let cmd = null;
  for (const nombre of solo ? [exe] : [exe, otro]) {
    const ruta = which(nombre);
    if (!ruta) continue;
    try {
      const r = spawnSync(ruta, ["image", "inspect", "--format", "{{json .Config.Entrypoint}}\t{{json .Config.Cmd}}", imagen], {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (r.error || r.status !== 0) continue;
      const salida = r.stdout.trim();
      const t = salida.indexOf("\t");
      const e = t < 0 ? salida : salida.slice(0, t);
      const c = t < 0 ? "" : salida.slice(t + 1);
      ent = JSON.parse(e) || [];
      cmd = JSON.parse(c) || [];
      break;
    } catch {}
  }
  if (ent === null) return null;
  ent = typeof ent === "string" ? [ent] : ent.map(String);
  cmd = typeof cmd === "string" ? [cmd] : cmd.map(String);
  return [ent, cmd];
}

/** CMD/ENTRYPOINT de un Dockerfile: forma exec (JSON) o forma shell (`/bin/sh -c "…"`). */
function instruccionDockerfile(valor) {
  valor = valor.trim();
  if (valor.startsWith("[")) {
    try {
      const v = JSON.parse(valor);
      if (Array.isArray(v)) return v.map(String);
    } catch {}
  }
  return ["/bin/sh", "-c", valor];
}

/** [entrypoint, cmd] efectivos de un Dockerfile: su último CMD/ENTRYPOINT de la última etapa, y lo que no defina lo hereda del FROM. */
function initDeDockerfile(ruta, exe) {
  let texto;
  try {
    if (statSync(ruta).size > 1_000_000) return null;
    texto = readFileSync(ruta, "utf8");
  } catch {
    return null;
  }
  texto = texto.replace(/\\\n/g, " ");
  let desde = null;
  let ent = null;
  let cmd = null;
  for (const linea of texto.split("\n")) {
    const m = /^\s*(FROM|CMD|ENTRYPOINT)\s+(.*)$/i.exec(linea);
    if (!m) continue;
    const k = m[1].toUpperCase();
    const v = m[2];
    if (k === "FROM") {
      // etapa nueva: lo de la anterior no cuenta
      const partes = v.split(/\s+/).filter((p) => p && !p.startsWith("--"));
      desde = partes.length ? partes[0] : null;
      ent = null;
      cmd = null;
    } else if (k === "CMD") cmd = instruccionDockerfile(v);
    else {
      ent = instruccionDockerfile(v);
      cmd = null; // ENTRYPOINT resetea el CMD heredado
    }
  }
  if (ent === null || cmd === null) {
    const base = desde && desde.toLowerCase() !== "scratch" ? initDeImagen(exe, desde) : null;
    if (base && ent === null) {
      ent = base[0];
      if (cmd === null) cmd = base[1];
    }
  }
  return [ent || [], cmd || []];
}

/** El init que trae la imagen del servicio (o su Dockerfile de `build:`), como en `docker run`. */
function revisarInitDeServicio(s, archivo, donde, exe) {
  if (s.entrypoint !== undefined && s.entrypoint !== null) return; // un entrypoint propio descarta el de la imagen y su CMD
  const comando = s.command !== undefined && s.command !== null ? tokensCompose(s.command) : null;
  const efectivos = [];
  const build = s.build;
  if (build !== undefined && build !== null) {
    let contexto;
    let dockerfile;
    if (typeof build === "string") [contexto, dockerfile] = [build, "Dockerfile"];
    else if (esObjeto(build)) [contexto, dockerfile] = [String(build.context || "."), String(build.dockerfile || "Dockerfile")];
    else [contexto, dockerfile] = [null, null];
    if (contexto && !contexto.includes("://") && !(contexto + dockerfile).includes("$")) {
      let ruta = unir(unir(dirname(archivo), expandir(contexto)), dockerfile);
      if (!esArchivo(ruta) && dockerfile === "Dockerfile") {
        const alt = unir(unir(dirname(archivo), expandir(contexto)), "Containerfile");
        ruta = esArchivo(alt) ? alt : ruta;
      }
      const r = initDeDockerfile(ruta, exe);
      if (r) efectivos.push([r, `Dockerfile ${ruta}`]);
    }
  }
  if (typeof s.image === "string") {
    const r = initDeImagen(exe, s.image);
    if (r) efectivos.push([r, `imagen ${s.image}`]);
  }
  for (const [[ent, cmd], origen] of efectivos) {
    const final = ent.concat(comando !== null ? comando : cmd);
    if (esInit(final)) throw new Bloqueo(`${origen} arranca systemd/init como proceso principal (${final.join(" ").slice(0, 80)}; ${donde})`);
  }
}

/** d = JSON del hook. 2 = bloquear (motivo por stderr), 0 = pasa. Lo llama destructive-guard.mjs. */
export function revisar(d) {
  if (!esObjeto(d) || d.tool_name !== "Bash") return 0;
  const ti = esObjeto(d.tool_input) ? d.tool_input : {};
  const cmd = ti.command || "";
  if (typeof cmd !== "string" || !/docker|podman/.test(cmd)) return 0;
  try {
    analizar(cmd, new Ctx(typeof d.cwd === "string" ? d.cwd : null));
  } catch (e) {
    if (e instanceof Bloqueo) {
      escribirErr(`GUARD: docker/podman bloqueado: ${e.message}. ${EXPLICACION.replaceAll("{D}", nombreDueno())} | cmd: ${[...cmd].slice(0, 300).join("")}`);
      return 2;
    }
    escribirErr(`docker-guard: error interno (deja pasar):\n${e?.stack ?? e}\n`);
    return 0;
  }
  return 0;
}

function main() {
  let d;
  try {
    d = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  return revisar(d);
}

const comoPrograma = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (comoPrograma) process.exitCode = main();
