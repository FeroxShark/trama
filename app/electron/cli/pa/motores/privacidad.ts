// Los candados de contenido antes de mandar una tarea a otra empresa (agy, codex, dsh/opencode remotos): un pedido con pinta de
// secreto, un repo que trackea archivos de secretos y un pedido que necesita red o leer fuera del worktree. Copia de
// gemini_secreto_en, gemini_secreto_trackeado, gemini_afuera_en y gemini_privacidad de motor/bin/pa. Un falso positivo sólo manda
// la corrida a Claude.
import { spawnSync } from "node:child_process";
import os from "node:os";

/** grep -E mira línea por línea: `^`/`$` son los bordes de cada línea y ningún patrón cruza un salto. */
const enAlgunaLinea = (re: RegExp, t: string) => t.split("\n").some((l) => re.test(l));

const CLAVE_API = /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{4,}|gh[pousr]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,}|AIza[0-9A-Za-z_-]{8,}|xox[abprs]-[A-Za-z0-9-]{4,}|AKIA[0-9A-Z]{12,}/;
const MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const TELEFONO = /(^|[^0-9])(\+[0-9]{1,3}[ -]?[0-9]{2,4}[ -]?[0-9]{3,4}[ -]?[0-9]{3,4}|\(?0?[0-9]{2,4}\)?[ -][0-9]{3,4}[ -][0-9]{4})([^0-9]|$)/;

/** Qué encontró el pedido con pinta de secreto («una clave de API», «un mail»…), o "" si nada. */
export function secretoEn(t: string): string {
  if (enAlgunaLinea(CLAVE_API, t)) return "una clave de API";
  if (t.includes("-----BEGIN")) return "una clave privada (-----BEGIN)";
  if (enAlgunaLinea(MAIL, t)) return "un mail";
  if (enAlgunaLinea(TELEFONO, t)) return "un teléfono";
  for (const l of t.split("\n")) {
    for (const tok of l.match(/[A-Za-z0-9_+=]{32,}/g) ?? []) if (/[0-9]/.test(tok) && /[A-Za-z]/.test(tok)) return "un token largo";
  }
  return "";
}

/** ¿El nombre de un archivo trackeado es de secretos? (el `case` del bash, en orden). */
export function esArchivoSecreto(nombre: string): boolean {
  if (/\.(example|sample|template|dist|pub)$/.test(nombre)) return false;
  if (nombre === ".env" || nombre.startsWith(".env.") || nombre === ".netrc") return true;
  if (/\.(pem|key|p12|pfx|kdbx|keystore)$/.test(nombre)) return true;
  if (/^(id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials|secrets)/.test(nombre)) return true;
  return nombre.startsWith("id_") && !nombre.includes(".");
}

/** El primer archivo de secretos trackeado en el HEAD del repo (de ahí sale el worktree), o "". */
export function secretoTrackeado(repo: string): string {
  const r = spawnSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", "HEAD"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.error) return "";
  for (const f of (r.stdout ?? "").split("\n")) {
    if (!f) continue;
    if (esArchivoSecreto(f.slice(f.lastIndexOf("/") + 1))) return f;
  }
  return "";
}

// `[[:alnum:]]` de grep con locale UTF-8 incluye las letras con tilde: \p{L}\p{N}.
const RED_PROGRAMA = /(^|[^\p{L}\p{N}_./-])(ssh|scp|sftp|rsync|curl|wget|telnet|nc)\s+[^\s-]/u;
const URL_RE = /https?:\/\//;
const GIT_REMOTO = /(^|[^\p{L}\p{N}_-])git\s+(clone|fetch|pull|push|ls-remote)([^\p{L}\p{N}_-]|$)/u;
const INSTALAR =
  /(^|[^\p{L}\p{N}_-])((npm|pnpm|yarn|bun)\s+(install|add|i)|pip3?\s+install|cargo\s+(install|add|update)|makepkg|pacman\s+-S|paru|yay\s|apt(-get)?\s+install|docker\s+(compose|stats|ps|exec|logs|pull|run))([^\p{L}\p{N}_-]|$)/iu;
const IPV4 = /(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)/;
const RUTA = /(^|[\s`"(])(~|\$HOME|\/home|\/etc|\/var|\/opt|\/mnt|\/srv|\/root)(\/[^\s`"')]*)?/g;
// Las rutas de Windows (sólo cuando la carpeta del proyecto es de Windows): letra de unidad, UNC y las variables de perfil de cmd.
const RUTA_WIN = /(^|[\s`"(])([A-Za-z]:[\\/][^\s`"')]*|\\\\[^\s`"')]+|%(?:USERPROFILE|APPDATA|LOCALAPPDATA|HOMEPATH|TEMP|TMP)%[^\s`"')]*)/g;
/** ¿La carpeta del proyecto es una ruta de Windows (`C:\...` o `\\servidor\...`)? */
const esRutaWin = (r: string) => /^[A-Za-z]:[\\/]/.test(r) || r.startsWith("\\\\");
/** Rutas de Windows comparables: barras `/`, sin barra final y en minúsculas (el disco no distingue mayúsculas). */
const normWin = (r: string) => r.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * ¿El pedido necesita red o leer fuera del worktree? → qué encontró («una URL», «una ruta fuera del proyecto: …»), o "" si nada.
 * agy, codex, dsh y opencode corren sin red y sin leer fuera del worktree: una tarea así falla seguro. `/home` y `/home/…` solos
 * son marcadores de ejemplo; una ruta dentro de `ruta` (la carpeta real del proyecto) pasa.
 */
export function afueraEn(t: string, ruta: string, home: string = process.env.HOME || os.homedir()): string {
  if (enAlgunaLinea(RED_PROGRAMA, t)) return "ssh/curl/rsync";
  if (URL_RE.test(t)) return "una URL";
  if (enAlgunaLinea(GIT_REMOTO, t)) return "git contra un remoto";
  if (enAlgunaLinea(INSTALAR, t)) return "instalar paquetes o tocar docker";
  if (enAlgunaLinea(IPV4, t)) return "una IP";
  const r = ruta.replace(/\/$/, "");
  if (esRutaWin(ruta)) {
    const rw = normWin(ruta);
    for (const l of t.split("\n")) {
      for (const m of l.matchAll(RUTA_WIN)) {
        const p = m[2]!.replace(/[.,:;]$/, "");
        const n = normWin(p);
        if (rw && (n === rw || n.startsWith(rw + "/"))) continue;
        return `una ruta fuera del proyecto: ${p}`;
      }
    }
  }
  for (const l of t.split("\n")) {
    for (const m of l.matchAll(RUTA)) {
      let p = m[0].replace(/^[\s`"(]/, "");
      if (p === "~") continue;
      if (p.startsWith("~")) p = home + p.slice(1);
      else if (p.startsWith("$HOME")) p = home + p.slice(5);
      p = p.replace(/\/$/, "").replace(/[.,:;]$/, "");
      if (p === "/home" || p === "/home/…" || p === "/home/...") continue;
      if (r && (p === r || p.startsWith(r + "/"))) continue;
      return `una ruta fuera del proyecto: ${p}`;
    }
  }
  return "";
}

/** A quién no se le manda, según el motor: el texto que dice el motivo de la caída. */
export type Destino = "Google" | "OpenAI" | "OpenCode" | string;

/** Los tres candados juntos → el motivo de la caída a Claude ("" = puede ir). `ruta` es la carpeta real del proyecto. */
export function privacidad(ruta: string, tarea: string, destino: Destino = "Google", home?: string): string {
  const m = secretoEn(tarea);
  if (m) return `el pedido parece traer ${m} (no se manda a ${destino})`;
  const f = secretoTrackeado(ruta);
  if (f) return `el repo trackea un archivo de secretos (${f})`;
  const a = afueraEn(tarea, ruta, home);
  if (a) return `el pedido necesita red o leer fuera del worktree (${a})`;
  return "";
}
