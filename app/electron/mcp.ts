// `/mcp` y Ajustes > Conectores en el main: qué servidores MCP ve un líder y en qué estado. Claude: lo que dice `claude mcp list` (los
// de su config, los de sus plugins y los conectores de claude.ai), que tarda porque prueba cada uno; más los propios de Trama
// (`mcp-config.ts`), que le llegan al líder de cada motor que los soporta. Node puro: los tests inyectan el ejecutable y las rutas.
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { enmascarar } from "./conectores-claude.ts";
import { entornoLider } from "./lider-arma.ts";
import { jsonClaude, leerMcpSync, resueltos, type ServidorMcp, type ServidorResuelto } from "./mcp-config.ts";
import { estadoHilos } from "./rutas.ts";
import { entornoCuenta } from "./uso-cuentas.ts";
import { configActiva } from "./mcp-apagados.ts";

export type EstadoServidor = "ok" | "auth" | "falla" | "sin-configurar" | "desconocido";

/** Un renglón de `claude mcp list`. */
export type ServidorVisto = {
  nombre: string;
  /** El comando con sus argumentos o la URL, tal cual los imprime `claude`. */
  destino: string;
  /** `HTTP`, `SSE` o `stdio` si lo dijo. */
  tipo: string | null;
  estado: EstadoServidor;
  /** Lo que sigue al estado ("Failed to connect — …"); puede traer el motivo. */
  detalle: string | null;
};

const SIMBOLOS = "✓✔!×✗✘⚠-";

/**
 * `nombre: destino (TIPO) - ✓ Connected`. El nombre puede llevar `:` (plugin:x:y) y espacios, y el destino también ` - `: se corta en
 * el último ` - ` seguido del símbolo de estado. Los renglones que no encajan (el «Checking MCP server health…», líneas vacías) se ignoran.
 */
export function parsearMcpList(salida: string): ServidorVisto[] {
  const r: ServidorVisto[] = [];
  const re = new RegExp(`^(.+?): (.*) - ([${SIMBOLOS}])\\s*(.*)$`);
  for (const crudo of salida.split(/\r?\n/)) {
    const linea = crudo.replace(/\x1b\[[0-9;]*m/g, "").trim();
    const m = re.exec(linea);
    if (!m) continue;
    const [, nombre, resto, simbolo, texto] = m;
    const t = /^(.*?)\s*\((HTTP|SSE|stdio)\)\s*$/i.exec(resto);
    const destino = (t ? t[1] : resto).trim();
    const tipo = t ? t[2] : null;
    const estado: EstadoServidor =
      simbolo === "✓" || simbolo === "✔" ? "ok" : simbolo === "!" || simbolo === "⚠" ? (/auth/i.test(texto) ? "auth" : "falla") : simbolo === "×" || simbolo === "✗" || simbolo === "✘" ? "falla" : /not configured/i.test(texto) ? "sin-configurar" : "desconocido";
    r.push({ nombre: nombre.trim(), destino, tipo: tipo && (tipo.toLowerCase() === "stdio" ? "stdio" : tipo.toUpperCase()), estado, detalle: texto.trim() || null });
  }
  return r;
}

export type Motor = "claude" | "agy" | "dsh" | "opencode";
export const MOTORES: readonly Motor[] = ["claude", "agy", "dsh", "opencode"];

/** Un servidor de Trama como lo ve el panel: qué es y si le llega al líder de ese motor. Sin valores. */
export type ServidorTrama = { nombre: string; tipo: ServidorMcp["tipo"]; destino: string; pasa: boolean };

export type EstadoMcp = {
  version: 1;
  motor: Motor;
  /** Lo que ve `claude` (sólo un líder de Claude); `null` en los demás motores. */
  claude: { servidores: ServidorVisto[]; error: string | null } | null;
  trama: ServidorTrama[];
  /** Por qué los de Trama no le llegan a este líder, si no le llegan: `local` (modelo en la GPU: sin MCP a propósito) o `agy` (Gemini). */
  sinTrama: "local" | "agy" | null;
};

type Deps = {
  /** Corre `claude mcp list` y devuelve su salida, o tira. */
  listar: () => Promise<string>;
  trama: () => ServidorMcp[];
};

const destinoDe = (s: ServidorMcp) => (s.tipo === "stdio" ? [s.comando, ...(s.args ?? [])].join(" ") : (s.url ?? ""));

let cache: { en: number; r: { servidores: ServidorVisto[]; error: string | null } } | null = null;
const VIGENCIA_MS = 30_000;

const listarDeVerdad = (): Promise<string> =>
  new Promise((ok, mal) => {
    const home = os.homedir();
    // De la cuenta activa (la preferida), la misma de la que se leen los conectores apagados.
    const activa = configActiva(process.env, home);
    const env = activa.cuenta ? entornoCuenta(entornoLider(process.env, home), activa.dir) : entornoLider(process.env, home);
    execFile(process.env.HILOS_CLAUDE ?? "claude", ["mcp", "list"], { timeout: 40_000, cwd: home, env, maxBuffer: 1024 * 1024 }, (err, out) => {
      // `claude mcp list` sale con 0 aunque haya servidores caídos; un error de verdad (no está claude, se pasó el tiempo) es otra cosa.
      if (err && !String(out).trim()) mal(err);
      else ok(String(out));
    });
  });

/**
 * El estado para un líder de ese motor. `local`: el líder corre en la GPU de esta máquina (`--strict-mcp-config` a propósito: sin MCP).
 * `claude mcp list` se pide una vez cada medio minuto como mucho (prueba cada servidor y tarda); `fresco` lo vuelve a pedir.
 */
export async function estadoMcp(motor: unknown, local = false, fresco = false, d: Deps = { listar: listarDeVerdad, trama: () => leerMcpSync() }): Promise<EstadoMcp> {
  const m: Motor = (MOTORES as readonly unknown[]).includes(motor) ? (motor as Motor) : "claude";
  const sinTrama = m === "claude" && local ? "local" : m === "agy" ? "agy" : null;
  const trama = d.trama().map((s) => ({ nombre: s.nombre, tipo: s.tipo, destino: enmascarar(destinoDe(s)), pasa: sinTrama === null }));
  let claude: EstadoMcp["claude"] = null;
  if (m === "claude" && !local) {
    if (!fresco && cache && Date.now() - cache.en < VIGENCIA_MS) claude = cache.r;
    else {
      try {
        claude = { servidores: parsearMcpList(await d.listar()).map((s) => ({ ...s, destino: enmascarar(s.destino) })), error: null };
      } catch (e) {
        claude = { servidores: [], error: String((e as Error).message ?? e).split("\n")[0].slice(0, 200) };
      }
      if (!claude.error) cache = { en: Date.now(), r: claude };
    }
  }
  return { version: 1, motor: m, claude, trama, sinTrama };
}

/** Sólo para los tests. */
export const olvidarCache = () => {
  cache = null;
};

// --- Lo que se le pasa al líder ------------------------------------------------------------------------------------------------------

/**
 * El archivo de `--mcp-config` de un líder de Claude: los servidores de Trama con sus valores. En un archivo 0600 y no en el argv, que
 * cualquiera ve con `ps`. `null` si no hay ninguno. Se reescribe en cada lanzamiento (atómico: dos líderes a la vez no se pisan).
 */
export function archivoMcpClaudeSync(x: { servidores?: ServidorResuelto[]; dir?: string } = {}): string | null {
  const servidores = x.servidores ?? resueltos();
  if (!servidores.length) return null;
  const dir = x.dir ?? path.join(estadoHilos(), "mcp");
  const ruta = path.join(dir, "claude.json");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${ruta}.${process.pid}.tmp`;
  writeFileSync(tmp, jsonClaude(servidores), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, ruta);
  return ruta;
}
