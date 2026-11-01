// El servidor MCP de Trama (electron/cli/mcp-trama.ts) anotado en la config MCP de cada motor, como las skills
// (cli/pa/skills-motores.ts): agy (`~/.gemini/config/mcp_config.json`), codex (`$CODEX_HOME/config.toml`), opencode (su
// `opencode.json` global) y Claude (su config de usuario, con `claude mcp add-json`). Sólo se toca la entrada `trama`: lo demás del
// archivo queda como estaba, y si la persona la apagó (`disabled` / `enabled: false`) sigue apagada. Idempotente: sin cambios no se
// escribe. Un archivo roto (JSON que no se entiende) o un `opencode.jsonc` (con comentarios) no se toca. Se escribe a través de los
// enlaces (las cuentas agregadas enlazan `config.toml` y `~/.gemini/config` a los de siempre). Node puro: los tests pasan las rutas.
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { caminoDe, type Plataforma } from "./rutas.ts";

type Env = Record<string, string | undefined>;

export const NOMBRE_MCP_TRAMA = "trama";

/** Cómo se lanza el servidor: un node y el script. `env` sólo si hace falta (el node es el de Electron: `ELECTRON_RUN_AS_NODE`). */
export type ServidorTrama = { comando: string; args: string[]; env?: Record<string, string> };

/** Qué pasó con un archivo. */
export type Registro = "creado" | "actualizado" | "igual" | "respetado";

/** El script del servidor al lado de quien pregunta: el `.js` compilado o, corriendo desde las fuentes (los tests), el `.ts`. Nunca dentro de un asar. */
export function scriptMcpTrama(carpetaCli: string): string | null {
  for (const f of ["mcp-trama.js", "mcp-trama.ts"]) {
    const r = path.join(carpetaCli, f);
    if (existsSync(r) && !/\.asar([\\/]|$)/.test(r)) return r;
  }
  return null;
}

const leerJson = (f: string): { ok: true; valor: Record<string, unknown> | null } | { ok: false } => {
  let t: string;
  try {
    t = readFileSync(f, "utf8");
  } catch {
    return { ok: true, valor: null };
  }
  if (!t.trim()) return { ok: true, valor: null };
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, valor: v } : { ok: false };
  } catch {
    return { ok: false };
  }
};

/** Escribe `texto` en `f` (atómico) a través de su enlace si lo es: el archivo de verdad es el que cambia. */
function escribir(f: string, texto: string) {
  let real = f;
  try {
    real = realpathSync(f);
  } catch {
    /* todavía no existe */
  }
  mkdirSync(path.dirname(real), { recursive: true });
  const tmp = `${real}.trama-${process.pid}.tmp`;
  writeFileSync(tmp, texto, { mode: 0o600 });
  renameSync(tmp, real);
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const objeto = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** Pone `trama` en `mapa` de un JSON (`clave` = `mcpServers` o `mcp`), con `entrada(previa)`. */
function enJson(f: string, clave: string, entrada: (previa: Record<string, unknown> | null) => Record<string, unknown>, base: Record<string, unknown> = {}): Registro {
  const l = leerJson(f);
  if (!l.ok) return "respetado";
  const todo = l.valor ?? { ...base };
  const mapa = objeto(todo[clave]);
  const previa = mapa[NOMBRE_MCP_TRAMA] ? objeto(mapa[NOMBRE_MCP_TRAMA]) : null;
  const nueva = entrada(previa);
  if (previa && igual(previa, nueva)) return "igual";
  todo[clave] = { ...mapa, [NOMBRE_MCP_TRAMA]: nueva };
  escribir(f, JSON.stringify(todo, null, 2) + "\n");
  return previa ? "actualizado" : "creado";
}

export const archivoMcpAgy = (home: string, plat: Plataforma) => caminoDe(plat).join(home, ".gemini", "config", "mcp_config.json");
export const archivoConfigCodex = (env: Env, home: string, plat: Plataforma) => caminoDe(plat).join(env.CODEX_HOME || caminoDe(plat).join(home, ".codex"), "config.toml");
export const carpetaConfigOpencode = (env: Env, home: string, plat: Plataforma) => caminoDe(plat).join(env.XDG_CONFIG_HOME || caminoDe(plat).join(home, ".config"), "opencode");

/** agy: `{ mcpServers: { trama: { command, args, env?, disabled } } }` (lo que escribe `agy mcp add`). */
export function registrarEnAgy(archivo: string, s: ServidorTrama): Registro {
  return enJson(archivo, "mcpServers", (p) => ({ ...(p ?? {}), command: s.comando, args: s.args, ...(s.env ? { env: s.env } : {}), disabled: p?.disabled === true }));
}

/** opencode: la sección `mcp` de su `opencode.json` global (`local`, `command` en una lista). Con un `opencode.jsonc` y sin `.json` no se toca (tiene comentarios). */
export function registrarEnOpencode(carpeta: string, s: ServidorTrama): Registro {
  const json = path.join(carpeta, "opencode.json");
  if (!existsSync(json) && existsSync(path.join(carpeta, "opencode.jsonc"))) return "respetado";
  return enJson(
    json,
    "mcp",
    (p) => ({ ...(p ?? {}), type: "local", command: [s.comando, ...s.args], ...(s.env ? { environment: s.env } : {}), enabled: p?.enabled !== false }),
    { $schema: "https://opencode.ai/config.json" },
  );
}

/** Un string básico de TOML (el de JSON lo es: comillas dobles con `\\`, `\"` y `\uXXXX`). */
const toml = (s: string) => JSON.stringify(s);

/** El bloque `[mcp_servers.trama]` de codex. */
export function bloqueCodex(s: ServidorTrama, previo = ""): string {
  const apagado = /^\s*enabled\s*=\s*false\s*$/m.test(previo);
  const env = s.env ? `env = { ${Object.entries(s.env).map(([k, v]) => `${toml(k)} = ${toml(v)}`).join(", ")} }\n` : "";
  return `[mcp_servers.${NOMBRE_MCP_TRAMA}]\ncommand = ${toml(s.comando)}\nargs = [${s.args.map(toml).join(", ")}]\n${env}${apagado ? "enabled = false\n" : ""}`;
}

/** codex: reemplaza (o agrega al final) la tabla `[mcp_servers.trama]` de `config.toml`; el resto del archivo queda igual. */
export function registrarEnCodex(archivo: string, s: ServidorTrama): Registro {
  let t = "";
  try {
    t = readFileSync(archivo, "utf8");
  } catch {
    /* no existe */
  }
  const lineas = t.split("\n");
  const ini = lineas.findIndex((l) => new RegExp(`^\\s*\\[\\s*mcp_servers\\.${NOMBRE_MCP_TRAMA}\\s*\\]\\s*(#.*)?$`).test(l));
  let nuevo: string;
  if (ini < 0) nuevo = `${t}${t && !t.endsWith("\n") ? "\n" : ""}${t ? "\n" : ""}${bloqueCodex(s)}`;
  else {
    let fin = lineas.findIndex((l, i) => i > ini && /^\s*\[/.test(l));
    if (fin < 0) fin = lineas.length;
    const previo = lineas.slice(ini, fin).join("\n");
    // Las líneas en blanco del final del bloque viejo quedan como separador.
    let blancas = 0;
    while (fin - blancas - 1 > ini && lineas[fin - blancas - 1]!.trim() === "") blancas++;
    const bloque = bloqueCodex(s, previo).replace(/\n$/, "").split("\n");
    nuevo = [...lineas.slice(0, ini), ...bloque, ...lineas.slice(fin - blancas)].join("\n");
  }
  if (nuevo === t) return "igual";
  escribir(archivo, nuevo);
  return ini < 0 ? "creado" : "actualizado";
}

/** Los motores con config propia para el MCP (los mismos de las skills). */
export type MotorMcp = "agy" | "codex" | "opencode";

/** Anota el servidor en la config del motor. */
export function registrarParaMotor(motor: MotorMcp, s: ServidorTrama, env: Env, home: string, plat: Plataforma): Registro {
  if (motor === "agy") return registrarEnAgy(archivoMcpAgy(home, plat), s);
  if (motor === "codex") return registrarEnCodex(archivoConfigCodex(env, home, plat), s);
  return registrarEnOpencode(carpetaConfigOpencode(env, home, plat), s);
}

// --- Claude -----------------------------------------------------------------------------------------------------------------------------

/** La entrada de `mcpServers` de Claude (`--mcp-config` de un líder y `claude mcp add-json`). */
export const entradaClaude = (s: ServidorTrama) => ({ type: "stdio", command: s.comando, args: s.args, ...(s.env ? { env: s.env } : {}) });

/** La entrada de ACP (`session/new`): stdio con `env` como pares. */
export const entradaAcp = (s: ServidorTrama) => ({ name: NOMBRE_MCP_TRAMA, command: s.comando, args: s.args, env: Object.entries(s.env ?? {}).map(([name, value]) => ({ name, value })) });

/** El `.claude.json` de usuario: en `CLAUDE_CONFIG_DIR` si está, si no en el home. */
export const archivoClaudeJson = (env: Env, home: string, plat: Plataforma) => caminoDe(plat).join(env.CLAUDE_CONFIG_DIR || home, ".claude.json");

/**
 * Claude: su config de usuario la reescribe Claude mismo a cada rato, así que no se edita a mano: se mira (sólo lectura) si ya tiene
 * `trama` igual y, si no, se le pide a `claude mcp add-json --scope user` (antes un `remove`, que con otra entrada `add-json` falla).
 * `correr` lanza `claude` con esos argumentos y devuelve su código. Una entrada apagada a mano no existe en Claude (se quita): se respeta lo que haya.
 */
export async function registrarEnClaude(archivo: string, s: ServidorTrama, correr: (args: string[]) => Promise<number>): Promise<Registro> {
  const l = leerJson(archivo);
  const previa = l.ok ? objeto(objeto(l.valor?.mcpServers)[NOMBRE_MCP_TRAMA]) : {};
  const nueva = entradaClaude(s);
  const hay = Object.keys(previa).length > 0;
  if (hay && igual(previa, nueva)) return "igual";
  if (hay) await correr(["mcp", "remove", "--scope", "user", NOMBRE_MCP_TRAMA]);
  const rc = await correr(["mcp", "add-json", "--scope", "user", NOMBRE_MCP_TRAMA, JSON.stringify(nueva)]);
  if (rc !== 0) throw new Error(`claude mcp add-json salió con ${rc}`);
  return hay ? "actualizado" : "creado";
}
