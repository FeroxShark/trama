#!/usr/bin/env node
// PreToolUse hook: bloquea comandos Bash catastróficos aunque la sesión corra con --dangerously-skip-permissions.
// Port a Node (sin python, sin bash, sin jq) de destructive-guard.sh: mismo JSON por stdin, mismo stderr (con el patrón
// que disparó), mismo código de salida. Exit 2 = bloquear + devolverle el motivo al modelo.
//
// Los porqués de cada bloque (backups, directorios de build en RAM, congelado del USB, sesión gráfica…) están en el .sh; acá
// van las mismas listas, en el mismo orden, y los patrones son los mismos textos (se imprimen en el motivo). Las guardas
// que parsean el comando (docker-guard.mjs) viven al lado de este archivo y se cargan sólo si el comando nombra su palabra.
//
// Diferencias conocidas con el .sh: \w, \b y \s son los de JavaScript (ASCII para \w y \b; un acento pegado a «rm» no cuenta
// como letra); y si falta docker-guard.mjs el aviso nombra a este archivo en lugar de al .sh.
import { readFileSync, statSync, existsSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const env = process.env;
const AQUI = path.dirname(fileURLToPath(import.meta.url));

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

const casa = () => (process.platform === "win32" ? env.USERPROFILE || env.HOME || homedir() : env.HOME || homedir());
const expandir = (p) => (p === "~" || p.startsWith("~/") ? casa() + p.slice(1) : p);
/** re.escape de Python 3.7+: sólo los caracteres con significado especial (el texto sale en el motivo). */
const escapar = (s) => s.replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, (c) => `\\${c}`);
const esObjeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const R = String.raw;

function leerStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function configGuard() {
  const config =
    process.platform === "win32"
      ? path.win32.join(env.LOCALAPPDATA || path.win32.join(casa(), "AppData", "Local"), "trama", "config")
      : path.join(env.XDG_CONFIG_HOME || path.join(casa(), ".config"), "trama");
  const ruta = env.TRAMA_GUARD_CONFIG || path.join(config, "guard.json");
  try {
    const c = JSON.parse(readFileSync(ruta, "utf8"));
    return esObjeto(c) ? c : {};
  } catch {
    return {};
  }
}
const listaCfg = (c, clave) => (Array.isArray(c[clave]) ? c[clave].filter((x) => typeof x === "string" && x) : []);

async function main() {
  let d;
  try {
    d = JSON.parse(leerStdin());
  } catch {
    return 0;
  }
  if (!esObjeto(d) || d.tool_name !== "Bash") return 0;
  // Se aplica en todos lados (ver el .sh): los patrones son sólo de cosas catastróficas, así que no cuesta falsos positivos.
  const cmdBruto = (esObjeto(d.tool_input) ? d.tool_input.command : "") || "";
  const cmd = typeof cmdBruto === "string" ? cmdBruto : "";
  const corto = [...cmd].slice(0, 300).join("");

  const patrones = [
    R`(?<![\w-])rm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rf][a-zA-Z]*\b.*\s(/|~|\$HOME|\.config|\.claude)`,
    R`(?<![\w-])rm\s+-[a-zA-Z]*r[a-zA-Z]*f|(?<![\w-])rm\s+-[a-zA-Z]*f[a-zA-Z]*r`,
    R`(?<![\w-])rm\s+-[rf]{1,2}\s+/`,
    R`\bdd\b.*\bof=/dev/`,
    R`\bof=/dev/(sd|nvme|disk|mmcblk)`,
    R`>\s*/dev/(sd|nvme|disk|mmcblk)`,
    R`\bmkfs(\.\w+)?\b`,
    R`\bwipefs\b`,
    R`\b(parted|fdisk|sgdisk)\b.*\b/dev/`,
    R`\bshred\b`,
    R`\btruncate\s+-s\s*0\b`,
    R`\bpacman\s+-R`,
    R`\byay\s+-R`,
    R`\bparu\s+-R`,
    R`\bgit\s+push\b.*(--force\b|-f\b)`,
    R`\bchmod\s+-R\s+0*777\s+/`,
    R`\bchown\s+-R\b.*\s/(\s|$)`,
    R`:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:`,
  ];

  // BACKUPS: cualquier VERBO destructivo cuyo objetivo caiga en un destino de backup. Leer pasa siempre. Lo propio de cada
  // instalación (etiquetas de los USB, montajes, el congelado) sale de ~/.config/trama/guard.json (TRAMA_GUARD_CONFIG).
  const CFG = configGuard();
  const ETIQUETAS_USB = listaCfg(CFG, "etiquetas_usb");
  const MONTAJES = listaCfg(CFG, "montajes");
  const CONGELADO = esObjeto(CFG.congelado) ? CFG.congelado : {};

  const DESTINOS_BACKUP =
    R`(?:/run/media/[^\s]*` +
    MONTAJES.map((m) => `|${escapar(m)}`).join("") +
    R`|/media/[^\s]*` +
    R`|~/backups|\$HOME/backups|/home/[^/\s]+/backups` +
    R`|\.papelera` +
    (ETIQUETAS_USB.length ? `|by-label/(?:${ETIQUETAS_USB.map(escapar).join("|")})` : "") +
    ")";

  patrones.push(
    // rm / mv / shred / truncate apuntando a un destino de backup
    R`(?<![\w-])rm\b[^|;&]*` + DESTINOS_BACKUP,
    R`\bmv\b[^|;&]*` + DESTINOS_BACKUP,
    R`\bshred\b[^|;&]*` + DESTINOS_BACKUP,
    R`\btruncate\b[^|;&]*` + DESTINOS_BACKUP,
    // find ... -delete / -exec rm
    R`\bfind\b[^|;&]*` + DESTINOS_BACKUP + R`[^|;&]*(-delete|-exec\s+rm)`,
    R`\bfind\b[^|;&]*(-delete|-exec\s+rm)[^|;&]*` + DESTINOS_BACKUP,
    // rsync --delete con un destino de backup
    R`\brsync\b[^|;&]*--delete[^|;&]*` + DESTINOS_BACKUP,
    // redirección que PISA un archivo de backup (el destino del > es lo que importa)
    R`>\s*\"?\x27?` + DESTINOS_BACKUP,
    // dd escribiendo sobre el USB
    R`\bdd\b[^|;&]*\bof=[^\s]*` + DESTINOS_BACKUP,
  );
  if (ETIQUETAS_USB.length) {
    // desmontar/apagar el USB de backups
    patrones.push(R`\budisksctl\s+(unmount|power-off)\b[^|;&]*(?:` + ETIQUETAS_USB.map(escapar).join("|") + ")");
  }

  // DIRECTORIOS DE BUILD EN RAM: un directorio de salida de build (cargo target-dir) que apunte a tmpfs se bloquea.
  const TMPFS_RAM = R`(?:/tmp|/dev/shm|\$TMPDIR)`;
  patrones.push(
    R`CARGO_TARGET_DIR\s*=\s*[\"\x27]?` + TMPFS_RAM,
    R`--target-dir(?:\s+|=)[\"\x27]?` + TMPFS_RAM,
    R`CARGO_BUILD_TARGET_DIR\s*=\s*[\"\x27]?` + TMPFS_RAM,
  );

  // CONGELADO TEMPORAL DE UN USB DE BACKUPS: lo manda el MARCADOR (borrarlo descongela); TRAMA_GUARD_FORZAR_CONGELADO=1
  // AGREGA el congelado, nunca lo saca. `bash -n <script>` solo (fullmatch) queda exento.
  const MARCADOR_CONGELADO = expandir(typeof CONGELADO.marcador === "string" ? CONGELADO.marcador : "");
  const ETIQUETA_CONGELADA = typeof CONGELADO.etiqueta === "string" ? CONGELADO.etiqueta : "";
  const usbCongelado = Object.keys(CONGELADO).length > 0 && ((MARCADOR_CONGELADO !== "" && existsSync(MARCADOR_CONGELADO)) || env.TRAMA_GUARD_FORZAR_CONGELADO === "1");
  const esChequeoSintaxis = /^\s*bash\s+-n\s+\S+\s*$/.test(cmd);
  if (usbCongelado && !esChequeoSintaxis) {
    if (ETIQUETA_CONGELADA) patrones.push(R`\budisksctl\s+mount\b[^|;&]*` + escapar(ETIQUETA_CONGELADA), R`\bmount\b[^|;&]*` + escapar(ETIQUETA_CONGELADA));
    patrones.push(...listaCfg(CONGELADO, "patrones"));
  }

  // Guardas que necesitan PARSEAR el comando (no alcanza un regex): módulos al lado de este archivo con revisar(d) -> 0|2.
  // Si falta un módulo se bloquean SOLO los comandos de su disparo; un error interno del módulo deja pasar.
  const guardiaExterna = async (archivo, disparo) => {
    if (!new RegExp(disparo).test(cmd)) return 0;
    const ruta = path.join(AQUI, archivo);
    let existe = false;
    try {
      existe = statSync(ruta).isFile();
    } catch {}
    if (!existe) {
      escribirErr(
        `GUARD: falta ${ruta} (lo carga destructive-guard.mjs; se copio el hook sin sus modulos o se movio?). Hasta que vuelva, bloqueo SOLO los comandos que nombran ${disparo}; el resto pasa. Restauralo desde motor/hooks de Trama. | cmd: ${corto}`,
      );
      return 2;
    }
    let rc;
    try {
      const mod = await import(pathToFileURL(ruta).href);
      rc = mod.revisar(d);
    } catch (e) {
      escribirErr(`${archivo}: error al cargarlo (deja pasar):\n${e?.stack ?? e}\n`);
      return 0;
    }
    return rc === 2 ? 2 : 0;
  };
  if ((await guardiaExterna("docker-guard.mjs", "docker|podman")) === 2) return 2;

  // SESION GRAFICA: matar o cortar la sesión gráfica (compositor, login manager, audio). Un worker mata sólo los PIDs que
  // lanzó él mismo, con kill $PID. Pasan: kill 12345, pkill -f "^mpv ..." y todo lo de LEER.
  const SESION_NOMBRES = R`(?:hyprland|sway|wayfire|river|gnome-shell|plasmashell|kwin(?:_wayland|_x11)?|xorg|xwayland|sddm|gdm3?|lightdm|pipewire|wireplumber)`;
  const cmdMin = cmd.toLowerCase(); // Sway y sway dan lo mismo
  const sesionPatrones = [
    // pkill / killall con un patron que nombra la sesion
    R`(?<![\w-])(?:pkill|killall)\b[^|;&]*` + SESION_NOMBRES,
    // pgrep / pidof / ps / grep canalizado a xargs kill
    R`(?<![\w-])(?:pgrep|pidof|ps|grep)\b[^;&]*` + SESION_NOMBRES + R`[^;&]*\|[^;&]*\bxargs\b[^;&]*\bkill\b`,
    // kill con $(...) o `...` que busca la sesion
    R`\bkill\b[^;&|]*(?:\$\(|` + "`" + R`)[^)` + "`" + R`;&]*` + SESION_NOMBRES,
    // cortar la sesion desde adentro
    R`\bhyprctl\s+dispatch\s+exit\b`,
    R`\bswaymsg\s+exit\b`,
    R`\bloginctl\s+(?:terminate|kill)-(?:session|user)\b`,
    R`\bsystemctl\b[^|;&]*\b(?:stop|restart|kill)\b[^|;&]*\b(?:sddm|gdm3?|lightdm|display-manager)(?:\.service)?\b`,
  ];
  for (const p of sesionPatrones) {
    if (new RegExp(p).test(cmdMin)) {
      escribirErr(
        `GUARD: esto mata o corta la sesion grafica (compositor, login manager, audio). Matá sólo PIDs que lanzaste vos (kill $PID). Patron: ${p} | cmd: ${corto}`,
      );
      return 2;
    }
  }

  for (const p of patrones) {
    let re;
    try {
      re = new RegExp(p);
    } catch {
      continue; // un patrón de la config que JavaScript no entiende: no frena nada por eso
    }
    if (re.test(cmd)) {
      escribirErr(
        `GUARD: comando potencialmente destructivo bloqueado por seguridad (modo asistente sin prompts). Confirma EXPLICITAMENTE con el usuario en voz/texto antes de ejecutarlo. Patron: ${p} | cmd: ${corto}`,
      );
      return 2;
    }
  }
  return 0;
}

process.exitCode = await main();
