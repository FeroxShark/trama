// Los candados de contenido antes de mandar una tarea a otra empresa (agy, codex, dsh/opencode remotos): un pedido con pinta de
// secreto y un repo que trackea archivos de secretos. Copia de gemini_secreto_en, gemini_secreto_trackeado y gemini_privacidad
// de motor/bin/pa. Un falso positivo sólo manda la corrida a Claude.
import { spawnSync } from "node:child_process";

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
  const r = spawnSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", "HEAD"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return "";
  for (const f of (r.stdout ?? "").split("\n")) {
    if (!f) continue;
    if (esArchivoSecreto(f.slice(f.lastIndexOf("/") + 1))) return f;
  }
  return "";
}

/** A quién no se le manda, según el motor: el texto que dice el motivo de la caída. */
export type Destino = "Google" | "OpenAI" | "OpenCode" | string;

/** Los dos candados juntos → el motivo de la caída a Claude ("" = puede ir). `ruta` es la carpeta real del proyecto. */
export function privacidad(ruta: string, tarea: string, destino: Destino = "Google"): string {
  const m = secretoEn(tarea);
  if (m) return `el pedido parece traer ${m} (no se manda a ${destino})`;
  const f = secretoTrackeado(ruta);
  if (f) return `el repo trackea un archivo de secretos (${f})`;
  return "";
}
