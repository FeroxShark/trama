// El aviso de "hay una Trama nueva" (pie de la barra, hermano de los de Claude Code y agy): la instalada es la
// `version` de app/package.json; la última, el release más nuevo de GitHub (`releases/latest` del repo que dice el campo
// `repository` de app/package.json: ni el dueño ni el repo van escritos en el código), API pública, sin token. Se chequea cuando la interfaz lo pide por primera vez (al abrir) y después cada 6 h, sin
// bloquear nada; sin red o con GitHub caído, silencio: queda lo último que se supo y nunca se muestra un error por eso.
//
// Actualizar corre en el checkout de donde se instaló Trama, que anota `instalar-producto.sh` en
// `~/.config/trama/checkout` (una línea: la ruta). Sin ese archivo (instalación que no viene de un checkout git,
// como el payload de Windows) no hay aviso: no hay de dónde actualizar. Los pasos, por argv y sin shell:
//   git fetch --tags  ·  git checkout --detach refs/tags/<tag>  ·  bash motor/scripts/instalar-producto.sh
// El tag sale del release consultado y pasa por `TAG_RE` antes de llegar a git; el IPC de Actualizar no recibe
// argumentos. Es de la PC sola (SOLO_PC_TAILNET): corre un instalador. Con cambios sin commitear en el checkout no
// se toca nada. La instalada es la del proceso que corre: hasta reiniciar Trama sigue diciendo la vieja.
//   TRAMA_RELEASES_URL   la URL de `releases/latest` (en la prueba, un servidor local).
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ESTADO, escribirAtomico } from "./pa.js";
import { textoT } from "./errores.js";
import { configTrama } from "./rutas.js";
import { silencio } from "./log.js";
import { CADA_MS, comparar, desdeArchivo, hayQueConsultar, normal, type Chequeo } from "./version.js";

const URL_RELEASE = (repo: string | null) => process.env.TRAMA_RELEASES_URL ?? (repo ? `https://api.github.com/repos/${repo}/releases/latest` : null);
/** Un tag de versión estricto: es lo único que llega a `git`. */
export const TAG_RE = /^v\d+\.\d+\.\d+$/;
export const tagValido = (s: unknown): s is string => typeof s === "string" && TAG_RE.test(s);

/** Lo que dijo GitHub → el tag ("v0.1.4"), o null si no es un release publicado con un tag como los nuestros. */
export function tagDeRelease(j: unknown): string | null {
  if (!j || typeof j !== "object") return null;
  const o = j as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
  if (o.draft === true || o.prerelease === true) return null;
  return tagValido(o.tag_name) ? o.tag_name : null;
}

/** "v0.1.4" → "0.1.4". */
export const versionDeTag = (tag: string) => tag.slice(1);

/** ¿La del release es más nueva que la instalada? Por semver (número a número), nunca por texto. */
export const esMasNueva = (instalada: string | null, tag: string | null) => !!tag && tagValido(tag) && normal(instalada) !== null && comparar(versionDeTag(tag), instalada) > 0;

/** "dueño/repo" de GitHub, de la URL o la abreviatura de `repository` ("https://github.com/o/r.git", "github:o/r"); null si no es de GitHub. */
export function repoDe(r: unknown): string | null {
  const url = typeof r === "string" ? r : r && typeof r === "object" ? (r as { url?: unknown }).url : null;
  const m = typeof url === "string" ? /^(?:github:|(?:git\+)?https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim()) : null;
  return m ? m[1] : null;
}

/** Las notas del release (un link para el navegador); sólo de un tag y un repo válidos. */
export const urlNotas = (tag: string, repo: string | null) => (tagValido(tag) && repo && repoDe(`github:${repo}`) ? `https://github.com/${repo}/releases/tag/${tag}` : null);

export type Paso = { cmd: string; args: string[]; cwd: string; env?: Record<string, string>; timeoutMs: number };

/**
 * Los pasos de Actualizar, como argv (nada de shell). Tira si el tag no es `vX.Y.Z` o la ruta no es absoluta: el que
 * llama ya validó, esto es la última puerta antes de git. `--detach refs/tags/…` no puede leerse como opción ni como rama.
 * `TRAMA_SIN_REINICIO_VENTANA=1`: el instalador no reinicia la ventana (sería matar a quien lo corre): el usuario la reinicia.
 */
export function pasosActualizar(tag: string, checkout: string): Paso[] {
  if (!tagValido(tag)) throw new Error(`tag inválido: ${String(tag)}`);
  if (!path.isAbsolute(checkout) || checkout.includes("\0")) throw new Error("checkout inválido");
  return [
    { cmd: "git", args: ["fetch", "--tags"], cwd: checkout, timeoutMs: 2 * 60_000 },
    { cmd: "git", args: ["-c", "advice.detachedHead=false", "checkout", "--detach", `refs/tags/${tag}`], cwd: checkout, timeoutMs: 2 * 60_000 },
    { cmd: "bash", args: [path.join(checkout, "motor", "scripts", "instalar-producto.sh")], cwd: checkout, env: { TRAMA_SIN_REINICIO_VENTANA: "1" }, timeoutMs: 30 * 60_000 },
  ];
}

/** El checkout anotado por el instalador, si sigue siendo un checkout de Trama; si no, null. */
export function leerCheckout(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const l = readFileSync(path.join(configTrama(env), "checkout"), "utf8").split("\n")[0].trim();
    if (!l || l.includes("\0") || !path.isAbsolute(l)) return null;
    return existsSync(path.join(l, ".git")) && existsSync(path.join(l, "motor", "scripts", "instalar-producto.sh")) ? l : null;
  } catch {
    return null;
  }
}

/** app/package.json (el del proceso que corre: electron/ y dist-electron/ están a la misma profundidad). */
function paquete(): { version?: unknown; repository?: unknown } {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  } catch {
    return {};
  }
}
export const versionInstalada = (): string | null => normal(paquete().version);
export const repoDelPaquete = (): string | null => repoDe(paquete().repository);

export type Corrida = { code: number | null; salida: string };
export type Correr = (paso: Pick<Paso, "cmd" | "args" | "cwd" | "timeoutMs"> & { env?: Record<string, string> }) => Promise<Corrida>;

/** execFile (argv, sin shell) con el PATH de siempre; nunca rechaza. */
export const correrReal: Correr = (p) =>
  new Promise((listo) =>
    execFile(p.cmd, p.args, { cwd: p.cwd, timeout: p.timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...p.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : null) : 0;
      listo({ code, salida: `${String(stderr ?? "")}\n${String(stdout ?? "")}${err && code === null ? `\n${err.message}` : ""}` });
    }),
  );

/** La última línea con algo (el motivo corto de una falla). */
export const ultimaLinea = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).pop()?.slice(0, 200) ?? null;

/** El instalador sale 0 aunque algo no se haya podido: las líneas `AVISO  app…` son la app que no quedó. */
export const falloDelInstalador = (salida: string): string | null => {
  const l = salida.split("\n").find((x) => /^AVISO\s+app/.test(x));
  return l ? l.replace(/^AVISO\s+/, "").trim().slice(0, 200) : null;
};

export type Aviso = { instalada: string; ultima: string; sucio: boolean; notas: string | null };
export type Actualizado = { ok: true; version: string } | { ok: false; error: string };

type Traer = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export type Deps = {
  archivo?: string;
  traer?: Traer;
  correr?: Correr;
  checkout?: () => string | null;
  instalada?: () => string | null;
  ahora?: () => number;
  repo?: () => string | null;
};

/** Lo que dice GitHub hoy (el tag), o null si algo falló (sin red, límite de la API, otra forma). */
export async function ultimaTag(traer: Traer = fetch, repo: string | null = repoDelPaquete()): Promise<string | null> {
  try {
    const url = URL_RELEASE(repo);
    if (!url) return null;
    const r = await traer(url, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/vnd.github+json", "user-agent": "trama" } });
    return r.ok ? tagDeRelease(await r.json()) : null;
  } catch {
    return null;
  }
}

const REINTENTO_MS = 15 * 60_000;

export function crearActualizacionTrama(deps: Deps = {}) {
  const archivo = deps.archivo ?? path.join(ESTADO, "trama-version.json");
  const correr = deps.correr ?? correrReal;
  const checkoutDe = deps.checkout ?? (() => leerCheckout());
  const instaladaDe = deps.instalada ?? versionInstalada;
  const ahora = deps.ahora ?? Date.now;
  const repoDeAqui = deps.repo ?? repoDelPaquete;
  let estado: Chequeo | null = null;
  let enCurso: Promise<Aviso | null> | null = null;
  let actualizando: Promise<Actualizado> | null = null;
  let armado = false;
  let falloEn = 0;
  const oyentes = new Set<(a: Aviso | null) => void>();

  async function cargar(): Promise<Chequeo> {
    if (estado) return estado;
    try {
      estado = desdeArchivo(JSON.parse(await readFile(archivo, "utf8")), 1);
    } catch {
      estado = desdeArchivo(null, 1);
    }
    return estado;
  }
  const guardar = (c: Chequeo) => escribirAtomico(archivo, JSON.stringify({ version: 1, ...c })).catch(silencio("actualizacion-trama"));

  /** ¿El checkout tiene cambios sin commitear? (Lo sin seguimiento no cuenta: no frena un checkout de tag.) */
  async function sucioEn(checkout: string): Promise<boolean> {
    const r = await correr({ cmd: "git", args: ["status", "--porcelain", "--untracked-files=no"], cwd: checkout, timeoutMs: 15_000 });
    return r.code === 0 && r.salida.trim() !== "";
  }

  /** El aviso de ahora a partir de lo guardado (sin red). */
  async function avisoDeEstado(c: Chequeo, checkout: string): Promise<Aviso | null> {
    const instalada = normal(instaladaDe());
    const ultima = normal(c.ultima);
    if (!instalada || !ultima || comparar(ultima, instalada) <= 0) return null;
    if (c.descartada && comparar(ultima, c.descartada) <= 0) return null;
    return { instalada, ultima, sucio: await sucioEn(checkout), notas: urlNotas(`v${ultima}`, repoDeAqui()) };
  }

  /** Un chequeo: nunca rechaza ni muestra errores; sin checkout anotado, nada. */
  function chequear(): Promise<Aviso | null> {
    enCurso ??= (async () => {
      const checkout = checkoutDe();
      if (!checkout) return null;
      const c = await cargar();
      const t = ahora();
      if (hayQueConsultar(c.chequeado, t) && t - falloEn >= REINTENTO_MS) {
        const tag = await ultimaTag(deps.traer, repoDeAqui());
        if (tag) {
          estado = { ...(estado ?? c), ultima: versionDeTag(tag), chequeado: t };
          await guardar(estado);
        } else falloEn = t;
      }
      return avisoDeEstado(estado ?? c, checkout);
    })()
      .catch(() => null)
      .finally(() => (enCurso = null));
    return enCurso;
  }

  /** El aviso de ahora (o null). La primera vez arma el chequeo cada 6 h. */
  function leerAviso(): Promise<Aviso | null> {
    if (!armado) {
      armado = true;
      setInterval(() => void chequear().then((a) => oyentes.forEach((f) => f(a))), CADA_MS + 60_000).unref();
    }
    return chequear();
  }

  /** "Ahora no": no avisar de esta versión (sí de la próxima). */
  async function descartar(): Promise<void> {
    const c = await cargar();
    if (!c.ultima || c.descartada === c.ultima) return;
    estado = { ...c, descartada: c.ultima };
    await guardar(estado);
    for (const f of oyentes) f(null);
  }

  /** Actualizar: valida, mira que el checkout esté limpio y corre los tres pasos. Nunca rechaza. */
  function actualizar(): Promise<Actualizado> {
    actualizando ??= (async (): Promise<Actualizado> => {
      const checkout = checkoutDe();
      if (!checkout) return { ok: false, error: textoT("main.tramaSinCheckout") };
      const c = await cargar();
      const ultima = normal(c.ultima);
      const tag = ultima ? `v${ultima}` : null;
      if (!tag || !tagValido(tag) || !esMasNueva(instaladaDe(), tag)) return { ok: false, error: textoT("main.tramaSinNueva") };
      if (await sucioEn(checkout)) return { ok: false, error: textoT("main.tramaSucio", { ruta: checkout }) };
      for (const paso of pasosActualizar(tag, checkout)) {
        const r = await correr(paso);
        if (r.code !== 0) return { ok: false, error: ultimaLinea(r.salida) ?? `${paso.cmd} ${paso.args[0]}` };
        const falla = paso.cmd === "bash" ? falloDelInstalador(r.salida) : null;
        if (falla) return { ok: false, error: falla };
      }
      return { ok: true, version: versionDeTag(tag) };
    })()
      .catch((e: unknown): Actualizado => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => (actualizando = null));
    return actualizando;
  }

  return { leerAviso, descartar, actualizar, alCambiarAviso: (f: (a: Aviso | null) => void) => void oyentes.add(f) };
}

const trama = crearActualizacionTrama();
export const { leerAviso: leerAvisoTrama, descartar: descartarTrama, actualizar: actualizarTrama, alCambiarAviso: alCambiarAvisoTrama } = trama;
