// Ajustes > Modelos > DeepSeek Harness: ¿está `dsh` instalado y en qué versión?, instalarlo (`npm i -g @deepseek-ai/dsh`), qué API keys
// hay guardadas (sólo si hay, nunca el valor: claves.ts) y probar un proveedor (`GET /models` de OpenCode o DeepSeek con la key
// guardada; `GET /api/tags` de Ollama). Node puro: los tests inyectan `fetch`, el ejecutable y las URL.
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hayClaves, leerClaves, type NombreClave } from "./claves.ts";
import { PROVEEDORES, resolverDsh, type ProveedorDsh } from "./dsh.ts";
import { errorT, textoT } from "./errores.ts";
import { sondearOllama } from "./modelos-config.ts";
import { URL_OLLAMA } from "./modelos-tipos.ts";
import { normal } from "./version.ts";

/** El paquete de npm de DeepSeek Harness y el comando que lo instala (también se le muestra al usuario para copiar). */
export const PAQUETE_DSH = "@deepseek-ai/dsh";
// En ~/.local (como el instalador del producto): sin sudo y con el binario en ~/.local/bin, que ya se busca.
// npm nuevo bloquea los scripts de instalación fuera de allowScripts: sin los de dsh-subprocess-local y node-pty dsh no corre comandos.
export const SCRIPTS_DSH = "--allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs";
export const COMANDO_INSTALAR_DSH = `npm i -g --prefix ~/.local ${SCRIPTS_DSH} ${PAQUETE_DSH}`;

export const URL_MODELOS: Record<Exclude<ProveedorDsh, "ollama">, string> = {
  opencode: "https://opencode.ai/inference/v1/models",
  deepseek: "https://api.deepseek.com/models",
};
const CLAVE_DE: Record<Exclude<ProveedorDsh, "ollama">, NombreClave> = { opencode: "OPENCODE_API_KEY", deepseek: "DEEPSEEK_API_KEY" };

export type EstadoDsh = {
  version: 1;
  instalado: boolean;
  /** Lo que imprime `dsh --version` (x.y.z); `null` si no se pudo saber. */
  versionDsh: string | null;
  /** Hay `npm` para instalarlo desde acá. */
  hayNpm: boolean;
  comando: string;
  claves: Record<NombreClave, boolean>;
};

type Deps = {
  env: NodeJS.ProcessEnv;
  home: string;
  existe: (f: string) => boolean;
  /** Corre un ejecutable (sin shell) y devuelve su salida, o tira. */
  correr: (bin: string, args: string[], timeout: number) => Promise<string>;
};

const ejecutable = (f: string) => {
  try {
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Abierta desde el menú de apps la sesión gráfica puede no traer `~/.local/bin` ni `~/.npm-global/bin` en el PATH (como actualizador.ts). */
function entornoNpm(): NodeJS.ProcessEnv {
  const extra = [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), ".npm-global", "bin")];
  const resto = (process.env.PATH ?? "").split(path.delimiter).filter((d) => d && !extra.includes(d));
  return { ...process.env, PATH: [...extra, ...resto].join(path.delimiter) };
}

const depsDeVerdad = (): Deps => ({
  env: entornoNpm(),
  home: os.homedir(),
  existe: ejecutable,
  correr: (bin, args, timeout) =>
    new Promise((ok, mal) => {
      execFile(bin, args, { timeout, env: entornoNpm(), maxBuffer: 1024 * 1024 }, (err, out, errout) => (err ? mal(Object.assign(err, { stderr: String(errout) })) : ok(String(out))));
    }),
});

const hayBin = (nombre: string, d: Deps) => (d.env.PATH ?? "").split(path.delimiter).some((dir) => dir && d.existe(path.join(dir, nombre)));

/** El estado de DeepSeek Harness en esta máquina: se mira cada vez que se pide (instalarlo después lo activa sin reiniciar). */
export async function estadoDsh(d: Deps = depsDeVerdad(), claves?: Partial<Record<NombreClave, string>>): Promise<EstadoDsh> {
  const bin = resolverDsh(d.env, d.home, d.existe);
  const instalado = d.env.HILOS_DSH !== undefined ? !!d.env.HILOS_DSH && d.existe(d.env.HILOS_DSH) : bin !== "dsh";
  let versionDsh: string | null = null;
  if (instalado) versionDsh = normal(await d.correr(bin, ["--version"], 5000).catch(() => "")) ?? null;
  return { version: 1, instalado, versionDsh, hayNpm: hayBin("npm", d), comando: COMANDO_INSTALAR_DSH, claves: hayClaves(claves ?? (await leerClaves()), d.env) };
}

/** Las últimas líneas de lo que dijo npm al fallar, sin ruido (para mostrarlas). */
const cola = (s: string) => s.trim().split("\n").slice(-4).join("\n").slice(-400);

/** `npm i -g --prefix ~/.local @deepseek-ai/dsh`; tira con el motivo (sin npm, sin permiso para el prefijo global, sin red). Devuelve cómo quedó. */
export async function instalarDsh(d: Deps = depsDeVerdad()): Promise<EstadoDsh> {
  if (!hayBin("npm", d)) throw errorT("main.dshSinNpm", { cmd: COMANDO_INSTALAR_DSH });
  try {
    await d.correr("npm", ["install", "-g", "--prefix", path.join(os.homedir(), ".local"), SCRIPTS_DSH, PAQUETE_DSH], 5 * 60 * 1000);
  } catch (e) {
    const dijo = cola(String((e as { stderr?: string }).stderr || (e as Error).message));
    throw errorT("main.dshInstalarFallo", { cmd: COMANDO_INSTALAR_DSH, e: dijo });
  }
  return estadoDsh(d);
}

export type Prueba = { ok: true; modelos: number; aviso?: string } | { ok: false; motivo: string };

/**
 * `GET <proveedor>/models` con la key guardada (la del entorno gana), o `GET <url>/api/tags` si es Ollama. Nunca tira por no contestar
 * (devuelve el motivo) y nunca repite la key en el motivo. OpenCode anda sin key para sus modelos gratis: sin ella se prueba igual.
 */
export async function probarProveedor(
  proveedor: unknown,
  ollamaUrl: unknown,
  x: { fetch?: typeof fetch; urls?: typeof URL_MODELOS; env?: NodeJS.ProcessEnv; claves?: Partial<Record<NombreClave, string>>; espera_ms?: number } = {},
): Promise<Prueba> {
  if (typeof proveedor !== "string" || !(PROVEEDORES as readonly string[]).includes(proveedor)) throw errorT("main.dshProveedor", { v: String(proveedor).slice(0, 40) });
  if (proveedor === "ollama") {
    const s = await sondearOllama(typeof ollamaUrl === "string" && ollamaUrl ? ollamaUrl : URL_OLLAMA, x.espera_ms ?? 4000);
    return s.ok ? { ok: true, modelos: s.modelos.length } : s;
  }
  const p = proveedor as Exclude<ProveedorDsh, "ollama">;
  const env = x.env ?? process.env;
  const nombre = CLAVE_DE[p];
  const key = env[nombre] || (x.claves ?? (await leerClaves()))[nombre];
  if (p === "deepseek" && !key) return { ok: false, motivo: textoT("main.dshSinClave", { k: nombre }) };
  try {
    const r = await (x.fetch ?? fetch)((x.urls ?? URL_MODELOS)[p], {
      headers: { Accept: "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(x.espera_ms ?? 8000),
      redirect: "error",
    });
    if (r.status === 401 || r.status === 403) return { ok: false, motivo: textoT("main.dshClaveMala", { k: nombre }) };
    if (!r.ok) return { ok: false, motivo: textoT("main.dshHttp", { n: r.status }) };
    const j = (await r.json()) as { data?: unknown };
    if (!Array.isArray(j?.data)) return { ok: false, motivo: textoT("main.dshNoEs") };
    // `GET /models` anda con la clave pública aunque el cupo gratis compartido esté agotado: sin clave propia se avisa.
    return { ok: true, modelos: j.data.length, ...(p === "opencode" && !key ? { aviso: textoT("main.dshAvisoSinClave") } : {}) };
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
    return { ok: false, motivo: timeout ? textoT("main.dshTarda") : textoT("main.dshNoContesta") };
  }
}
