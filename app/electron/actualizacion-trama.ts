// El aviso de "hay una Trama nueva" (pie de la barra, hermano de los de Claude Code y agy): la instalada es la
// `version` de app/package.json; la última, el release más nuevo de GitHub (`releases/latest` del repo que dice el campo
// `repository` de app/package.json: ni el dueño ni el repo van escritos en el código), API pública, sin token. Se chequea al abrir (cuando
// la interfaz lo pide), cada 2 min, al enfocar la ventana y al volver de la suspensión (`refrescarAvisoTrama`), sin bloquear nada. La
// consulta va con ETag (un 304 no gasta el límite de la API sin token); si GitHub limita (403/429) se espera lo que dice y no se muestra
// nada. Sin red o con GitHub caído, silencio: queda lo último que se supo y nunca se muestra un error por eso.
//
// Actualizar corre en el checkout de donde se instaló Trama, que anota `instalar-producto.sh` en
// `~/.config/trama/checkout` (una línea: la ruta). Sin ese archivo (instalación que no viene de un checkout git,
// como el payload de Windows) no hay aviso: no hay de dónde actualizar. Los pasos, por argv y sin shell:
//   git fetch --tags  ·  git checkout --detach refs/tags/<tag>  ·  bash motor/scripts/instalar-producto.sh
// El tag sale del release consultado y pasa por `TAG_RE` antes de llegar a git; el IPC de Actualizar no recibe
// argumentos. Es de la PC sola (SOLO_PC_TAILNET): corre un instalador. Con cambios sin commitear en el checkout no
// se toca nada. La instalada es la del proceso que corre: hasta reiniciar Trama sigue diciendo la vieja.
//
// El instalador reinicia `trama-motor.service`: los líderes con turno en curso se cortan (quedan `dormido` y vuelven con
// `--resume`, sin perder historial) y lo que espera un worker se pierde. Por eso Actualizar tiene dos modos (`pedir`): "ya"
// (la UI lo confirma diciendo qué se corta) y "esperar" (espera a que no haya líder trabajando ni worker vivo, dos miradas
// seguidas, y actualiza solo). El instalador corre suelto (detached, su salida a un archivo): el motor que lo lanzó muere a
// mitad, así que el estado (`trama-actualizacion.json`: esperando / instalando / hecho / error) vive en disco y el motor nuevo
// lo cierra (`estadoActual`: si el instalador ya no corre, mira su salida) para que la ventana avise "Trama X.Y.Z instalada".
//   TRAMA_RELEASES_URL   la URL de `releases/latest` (en la prueba, un servidor local).
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ESTADO, escribirAtomico } from "./pa.js";
import { textoT } from "./errores.js";
import { configTrama } from "./rutas.js";
import { silencio } from "./log.js";
import { comparar, desdeArchivo, hayQueConsultar, normal, type Chequeo } from "./version.js";

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

/** `registro`: el paso corre suelto (detached) con su salida a ese archivo, para sobrevivir al motor que reinicia (ver arriba). */
export type Paso = { cmd: string; args: string[]; cwd: string; env?: Record<string, string>; timeoutMs: number; registro?: string };

/**
 * Los pasos de Actualizar, como argv (nada de shell). Tira si el tag no es `vX.Y.Z` o la ruta no es absoluta: el que
 * llama ya validó, esto es la última puerta antes de git. `--detach refs/tags/…` no puede leerse como opción ni como rama.
 * `TRAMA_SIN_REINICIO_VENTANA=1`: el instalador no reinicia la ventana (sería matar a quien lo corre): el usuario la reinicia.
 */
export function pasosActualizar(tag: string, checkout: string, registro?: string): Paso[] {
  if (!tagValido(tag)) throw new Error(`tag inválido: ${String(tag)}`);
  if (!path.isAbsolute(checkout) || checkout.includes("\0")) throw new Error("checkout inválido");
  return [
    { cmd: "git", args: ["fetch", "--tags"], cwd: checkout, timeoutMs: 2 * 60_000 },
    { cmd: "git", args: ["-c", "advice.detachedHead=false", "checkout", "--detach", `refs/tags/${tag}`], cwd: checkout, timeoutMs: 2 * 60_000 },
    // `--fuente` explícito: la raíz del checkout, nunca lo que el script crea ser (así compila la app y anota el checkout).
    { cmd: "bash", args: [path.join(checkout, "motor", "scripts", "instalar-producto.sh"), "--fuente", checkout], cwd: checkout, env: { TRAMA_SIN_REINICIO_VENTANA: "1" }, timeoutMs: 30 * 60_000, ...(registro ? { registro } : {}) },
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
export type Correr = (paso: Pick<Paso, "cmd" | "args" | "cwd" | "timeoutMs" | "registro"> & { env?: Record<string, string>; alPid?: (pid: number) => void }) => Promise<Corrida>;

/** execFile (argv, sin shell) con el PATH de siempre; nunca rechaza. */
export const correrReal: Correr = (p) =>
  p.registro ? correrSuelto(p) : new Promise((listo) =>
    execFile(p.cmd, p.args, { cwd: p.cwd, timeout: p.timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...p.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : null) : 0;
      listo({ code, salida: `${String(stderr ?? "")}\n${String(stdout ?? "")}${err && code === null ? `\n${err.message}` : ""}` });
    }),
  );

/**
 * Un paso suelto: detached, con su salida a un archivo (no a un pipe: si muere quien lo lanzó, un pipe roto lo mataría por SIGPIPE).
 * Si el motor sigue vivo espera el final; si no, lo cierra `estadoActual` mirando el archivo. Nunca rechaza.
 */
function correrSuelto(p: Parameters<Correr>[0]): Promise<Corrida> {
  return new Promise((listo) => {
    let fd = -1;
    try {
      fd = openSync(p.registro!, "w");
      const hijo = spawn(p.cmd, p.args, { cwd: p.cwd, detached: true, stdio: ["ignore", fd, fd], env: { ...process.env, ...p.env, GIT_TERMINAL_PROMPT: "0" } });
      const reloj = setTimeout(() => hijo.kill("SIGTERM"), p.timeoutMs);
      const leer = () => { try { return readFileSync(p.registro!, "utf8"); } catch { return ""; } };
      hijo.on("error", (e) => (clearTimeout(reloj), listo({ code: null, salida: e.message })));
      hijo.on("exit", (code) => (clearTimeout(reloj), listo({ code, salida: leer() })));
      if (hijo.pid) p.alPid?.(hijo.pid);
      hijo.unref();
    } catch (e) {
      listo({ code: null, salida: e instanceof Error ? e.message : String(e) });
    } finally {
      if (fd >= 0) closeSync(fd);
    }
  });
}

/** La última línea con algo (el motivo corto de una falla). */
export const ultimaLinea = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).pop()?.slice(0, 200) ?? null;

/** El instalador sale 0 aunque algo no se haya podido: las líneas `AVISO  app…` son la app que no quedó. */
export const falloDelInstalador = (salida: string): string | null => {
  const l = salida.split("\n").find((x) => /^AVISO\s+app/.test(x));
  return l ? l.replace(/^AVISO\s+/, "").trim().slice(0, 200) : null;
};

export type Aviso = { instalada: string; ultima: string; sucio: boolean; notas: string | null };
/** Ajustes > "Check for updates": lo último que dijo GitHub (null si no se pudo saber) y si es más nueva que la instalada. */
export type Buscada = { ultima: string | null; nueva: boolean };
export type Actualizado = { ok: true; version: string } | { ok: false; error: string };
/** Lo que un reinicio del motor cortaría: líderes con un turno o un mensaje saliendo, workers vivos, integraciones; `leyendo`: la lista de workers se está releyendo (no se sabe). */
export type Ocupacion = { lideres: number; workers: number; otras: number; leyendo: boolean };
export const total = (o: Ocupacion) => o.lideres + o.workers + o.otras + (o.leyendo ? 1 : 0);
/** En qué anda Actualizar (sobrevive al reinicio del motor, ver arriba). */
export type EstadoAct =
  | { fase: "nada" }
  | { fase: "esperando"; version: string }
  | { fase: "instalando"; version: string }
  | { fase: "hecho"; version: string }
  | { fase: "error"; error: string };
export type Modo = "ya" | "esperar";
export const modoValido = (x: unknown): x is Modo => x === "ya" || x === "esperar";

type Respuesta = { ok: boolean; status?: number; headers?: { get(nombre: string): string | null }; json(): Promise<unknown> };
type Traer = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Respuesta>;

export type Deps = {
  archivo?: string;
  traer?: Traer;
  correr?: Correr;
  checkout?: () => string | null;
  instalada?: () => string | null;
  ahora?: () => number;
  repo?: () => string | null;
  /** El ciclo del aviso y el reintento tras una falla de red (default: timers reales, sin retener el proceso). */
  cada?: (f: () => void, ms: number) => void;
  despues?: (f: () => void, ms: number) => void;
  /** Qué cortaría reiniciar el motor ahora (lo arma nucleo.ts). Sin esto, nada ocupa. */
  ocupacion?: () => Ocupacion;
  /** Dónde se anota el estado de Actualizar y la salida del instalador (default: junto a `archivo`). */
  archivoAct?: string;
  registro?: string;
  /** ¿Sigue vivo ese pid? */
  vivo?: (pid: number) => boolean;
  /** Cada cuánto mira la espera (ms); tiene que ver `quietas` miradas seguidas sin nada ocupado. */
  esperaMs?: number;
  quietas?: number;
};

const SIN_OCUPAR: Ocupacion = { lideres: 0, workers: 0, otras: 0, leyendo: false };
const vivoReal = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
};

/** Lo que contestó GitHub: un release (con su ETag), lo mismo que antes (304), un límite (403/429), otra falla o sin red. */
export type Consulta = { estado: "nueva"; tag: string; etag: string | null } | { estado: "igual" } | { estado: "limite"; retryAfter: string | null; reset: string | null } | { estado: "fallo" } | { estado: "red" };

/**
 * Pregunta a GitHub por el último release. Con el ETag de la última respuesta va condicional: el 304 no gasta el límite de la API
 * sin token. Nunca rechaza ni muestra nada: sin red es "red", un límite es "limite" (se espera), lo demás es "fallo".
 */
export async function consultarRelease(traer: Traer = fetch, repo: string | null = repoDelPaquete(), etag: string | null = null): Promise<Consulta> {
  const url = URL_RELEASE(repo);
  if (!url) return { estado: "fallo" };
  try {
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "trama" };
    if (etag) headers["if-none-match"] = etag;
    const r = await traer(url, { signal: AbortSignal.timeout(15_000), headers });
    if (r.status === 304) return { estado: "igual" };
    if (r.status === 403 || r.status === 429) return { estado: "limite", retryAfter: r.headers?.get("retry-after") ?? null, reset: r.headers?.get("x-ratelimit-reset") ?? null };
    if (!r.ok) return { estado: "fallo" };
    const tag = tagDeRelease(await r.json().catch(() => null));
    return tag ? { estado: "nueva", tag, etag: r.headers?.get("etag") ?? null } : { estado: "fallo" };
  } catch {
    return { estado: "red" };
  }
}

/** Cuánto esperar tras un límite de GitHub: Retry-After (segundos) o hasta x-ratelimit-reset (epoch); sin dato, 15 min. Entre 1 min y 1 h. */
export function pausaDeLimite(retryAfter: string | null, reset: string | null, ahora: number): number {
  const ra = Number(retryAfter);
  const rs = Number(reset);
  const ms = retryAfter && ra > 0 ? ra * 1000 : reset && rs > 0 ? rs * 1000 - ahora : PAUSA_LIMITE_MS;
  return Math.min(PAUSA_MAX_MS, Math.max(60_000, ms));
}

const PAUSA_LIMITE_MS = 15 * 60_000;
const PAUSA_MAX_MS = 60 * 60_000;
/** Cada cuánto se mira si hay una Trama nueva (los releases salen varias veces por día; CADA_MS de version.ts es el de Claude Code). */
export const CADA_TRAMA_MS = 2 * 60_000;
/** Entre dos consultas que salieron, como mínimo esto: los focos seguidos no martillan a GitHub. */
export const MINIMO_TRAMA_MS = 15_000;
/** Tras un fallo de red se reintenta a este plazo: la vuelta de la red se nota sin esperar al ciclo. */
export const REINTENTO_RED_MS = 30_000;
/** El ciclo corre un poco antes que la cadencia: setInterval y Date.now no siempre coinciden al milisegundo. */
const TOLERANCIA_MS = 5_000;

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
  // La consulta a GitHub: el ETag va con `ultima` (es del mismo release); la pausa y el mínimo entre intentos espacian sin mostrar nada.
  let etag: string | null = null;
  let intentoEn = 0;
  let pausaHasta = 0;
  let reintentoArmado = false;
  const cada = deps.cada ?? ((f: () => void, ms: number) => void setInterval(f, ms).unref());
  const despues = deps.despues ?? ((f: () => void, ms: number) => void setTimeout(f, ms).unref());
  const oyentes = new Set<(a: Aviso | null) => void>();
  // --- Actualizar: la espera y el estado que sobrevive al reinicio del motor ---
  const archivoAct = deps.archivoAct ?? path.join(path.dirname(archivo), "trama-actualizacion.json");
  const registro = deps.registro ?? path.join(path.dirname(archivo), "trama-actualizacion.log");
  const ocupacion = deps.ocupacion ?? (() => SIN_OCUPAR);
  const vivo = deps.vivo ?? vivoReal;
  const esperaMs = deps.esperaMs ?? 5000;
  const quietas = deps.quietas ?? 2;
  let act: (EstadoAct & { pid?: number }) | null = null;
  let reloj: NodeJS.Timeout | null = null;
  const oyentesAct = new Set<(e: EstadoAct) => void>();

  async function cargar(): Promise<Chequeo> {
    if (estado) return estado;
    try {
      const j = JSON.parse(await readFile(archivo, "utf8")) as Record<string, unknown>;
      estado = desdeArchivo(j, 1);
      etag = typeof j.etag === "string" ? j.etag : null;
    } catch {
      estado = desdeArchivo(null, 1);
    }
    return estado;
  }
  const guardar = (c: Chequeo) => escribirAtomico(archivo, JSON.stringify({ version: 1, ...c, etag })).catch(silencio("actualizacion-trama"));

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

  /**
   * Una consulta a GitHub si toca: la cadencia (salvo `forzar`), la pausa de un límite y un mínimo entre intentos. Lo que contesta se
   * guarda (con su ETag); un límite espera; una falla de red reintenta pronto. Nunca rechaza ni muestra nada. Null: no salió.
   */
  async function consultar(forzar: boolean): Promise<Consulta | null> {
    const c = await cargar();
    const t = ahora();
    if (t < pausaHasta || t - intentoEn < MINIMO_TRAMA_MS) return null;
    if (!forzar && !hayQueConsultar(c.chequeado, t, CADA_TRAMA_MS - TOLERANCIA_MS)) return null;
    intentoEn = t;
    const r = await consultarRelease(deps.traer, repoDeAqui(), etag);
    if (r.estado === "nueva") {
      etag = r.etag;
      estado = { ...c, ultima: versionDeTag(r.tag), chequeado: t };
      await guardar(estado);
    } else if (r.estado === "igual") {
      estado = { ...c, chequeado: t };
      await guardar(estado);
    } else if (r.estado === "limite") pausaHasta = t + pausaDeLimite(r.retryAfter, r.reset, t);
    else if (r.estado === "red") reintentarEnRed();
    return r;
  }

  /** Un solo reintento armado a la vez: sin red, la vuelta se nota a los 30 s (no hace falta esperar al ciclo). */
  function reintentarEnRed() {
    if (reintentoArmado) return;
    reintentoArmado = true;
    despues(() => {
      reintentoArmado = false;
      void refrescar(true);
    }, REINTENTO_RED_MS);
  }

  /** El aviso de ahora (consulta si toca). Sin checkout anotado, nada. Nunca rechaza ni muestra errores. */
  function chequear(forzar: boolean): Promise<Aviso | null> {
    enCurso ??= (async () => {
      const checkout = checkoutDe();
      if (!checkout) return null;
      await consultar(forzar);
      return avisoDeEstado(estado ?? (await cargar()), checkout);
    })()
      .catch(() => null)
      .finally(() => (enCurso = null));
    return enCurso;
  }

  /** Lo que dispara una consulta sin que nadie la pida (el ciclo, el foco, la suspensión, el reintento): avisa a la barra. */
  function refrescar(forzar: boolean): Promise<Aviso | null> {
    return chequear(forzar).then((a) => (oyentes.forEach((f) => f(a)), a));
  }

  /** La primera vez que alguien pide el aviso (o el foco) arma el ciclo, cada 2 min. */
  function armar() {
    if (armado) return;
    armado = true;
    cada(() => void refrescar(false), CADA_TRAMA_MS);
  }

  /** El aviso de ahora (o null). Al abrir, consulta si la cadencia lo pide. */
  function leerAviso(): Promise<Aviso | null> {
    armar();
    return chequear(false);
  }

  /** Foco de la ventana y vuelta de la suspensión: consulta ya (salvo el mínimo entre intentos) y avisa a la barra si cambió. */
  async function refrescarAviso(): Promise<void> {
    armar();
    await refrescar(true);
  }

  /**
   * Ajustes > "Check for updates": consulta ya (ni el ciclo ni el reintento) y avisa a la barra. Con un límite o sin consulta, lo
   * último que se supo; sin red o si GitHub no contesta bien, null (no sabe). Nunca rechaza.
   */
  async function buscar(): Promise<Buscada> {
    const checkout = checkoutDe();
    if (!checkout) return { ultima: null, nueva: false };
    const r = await consultar(true);
    if (r?.estado === "red" || r?.estado === "fallo") return { ultima: null, nueva: false };
    const c = estado ?? (await cargar());
    for (const f of oyentes) f(await avisoDeEstado(c, checkout));
    const ultima = normal(c.ultima);
    return { ultima, nueva: esMasNueva(instaladaDe(), ultima ? `v${ultima}` : null) };
  }

  /** "Ahora no": no avisar de esta versión (sí de la próxima). */
  async function descartar(): Promise<void> {
    const c = await cargar();
    if (!c.ultima || c.descartada === c.ultima) return;
    estado = { ...c, descartada: c.ultima };
    await guardar(estado);
    for (const f of oyentes) f(null);
  }

  const publico = (e: EstadoAct & { pid?: number }): EstadoAct => {
    const { pid: _pid, ...resto } = e;
    return resto as EstadoAct;
  };
  async function poner(e: EstadoAct & { pid?: number }): Promise<void> {
    act = e;
    await escribirAtomico(archivoAct, JSON.stringify({ version: 1, ...e })).catch(silencio("actualizacion-trama"));
    for (const f of oyentesAct) f(publico(e));
  }
  async function cargarAct(): Promise<EstadoAct & { pid?: number }> {
    if (act) return act;
    try {
      const j = JSON.parse(await readFile(archivoAct, "utf8")) as Record<string, unknown>;
      const v = typeof j.version === "string" ? j.version : "";
      const pid = typeof j.pid === "number" ? j.pid : undefined;
      if (j.fase === "esperando" && v) act = { fase: "esperando", version: v };
      else if (j.fase === "instalando" && v) act = { fase: "instalando", version: v, ...(pid ? { pid } : {}) };
      else if (j.fase === "hecho" && v) act = { fase: "hecho", version: v };
      else if (j.fase === "error" && typeof j.error === "string") act = { fase: "error", error: j.error };
      else act = { fase: "nada" };
    } catch {
      act = { fase: "nada" };
    }
    return act;
  }

  /**
   * El estado de Actualizar. Un "instalando" que dejó un motor anterior (el instalador lo reinició) se cierra acá, mire lo
   * que mire la memoria o el disco (`cargarAct`): con el pid muerto, si es de una versión anterior a la instalada se descarta
   * sin avisar (es un estado viejo); si no, la salida del instalador dice si quedó (`AVISO app…` = no) y la ventana avisa
   * "instalada" o el motivo. Con el instalador vivo no se toca.
   */
  async function estadoActual(): Promise<EstadoAct> {
    const e = await cargarAct();
    if (e.fase === "instalando" && !actualizando && !(e.pid && vivo(e.pid))) {
      const instalada = normal(instaladaDe());
      if (instalada && comparar(e.version, instalada) < 0) {
        await poner({ fase: "nada" });
      } else {
        let salida = "";
        try {
          salida = await readFile(registro, "utf8");
        } catch {}
        const falla = falloDelInstalador(salida);
        await poner(falla ? { fase: "error", error: falla } : e.pid ? { fase: "hecho", version: e.version } : { fase: "error", error: textoT("main.tramaInterrumpida") });
      }
    }
    return publico(act ?? e);
  }

  function pararEspera() {
    if (reloj) clearInterval(reloj);
    reloj = null;
  }
  /** La espera: mira cada `esperaMs`; con `quietas` miradas seguidas sin nada ocupado, actualiza. */
  function armarEspera() {
    pararEspera();
    let seguidas = 0;
    reloj = setInterval(() => {
      if (total(ocupacion()) > 0) {
        seguidas = 0;
        return;
      }
      if (++seguidas < quietas) return;
      pararEspera();
      void actualizar();
    }, esperaMs);
    reloj.unref();
  }

  /** Lo que se puede decir ya, sin tocar nada: el checkout anotado, una versión nueva y limpio. */
  async function validar(): Promise<{ checkout: string; tag: string } | { error: string }> {
    const checkout = checkoutDe();
    if (!checkout) return { error: textoT("main.tramaSinCheckout") };
    const c = await cargar();
    const ultima = normal(c.ultima);
    const tag = ultima ? `v${ultima}` : null;
    if (!tag || !tagValido(tag) || !esMasNueva(instaladaDe(), tag)) return { error: textoT("main.tramaSinNueva") };
    if (await sucioEn(checkout)) return { error: textoT("main.tramaSucio", { ruta: checkout }) };
    return { checkout, tag };
  }

  /**
   * Lo que pide la UI. "ya": actualiza ahora; "esperar": espera a que no haya líder trabajando ni worker vivo (si ya no hay, es
   * lo mismo que "ya"). Contesta en cuanto arranca (el instalador reinicia al motor: la respuesta no puede esperar al final); el
   * progreso es el estado (`estadoActual`, `alCambiarActualizacion`). Nunca rechaza.
   */
  async function pedir(modo: Modo): Promise<Actualizado> {
    try {
      // Un "instalando" de un instalador que murió después de que arrancó este motor (seguía vivo al reiniciarlo) se cierra acá:
      // si no, Actualizar quedaba trabado en "ya en curso" para siempre.
      await estadoActual();
      const e = await cargarAct();
      if (e.fase === "esperando" || e.fase === "instalando" || actualizando) return { ok: false, error: textoT("main.tramaYaEnCurso") };
      const v = await validar();
      if ("error" in v) return { ok: false, error: v.error };
      const version = versionDeTag(v.tag);
      if (modo === "esperar" && total(ocupacion()) > 0) {
        await poner({ fase: "esperando", version });
        armarEspera();
      } else void actualizar();
      return { ok: true, version };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Se arrepintió mientras esperaba. */
  async function cancelarEspera(): Promise<void> {
    if ((await cargarAct()).fase !== "esperando") return;
    pararEspera();
    await poner({ fase: "nada" });
  }

  /** Reconoció el "instalada" (o el error): vuelve a nada. No toca una espera ni una instalación en curso. */
  async function limpiar(): Promise<void> {
    const e = await cargarAct();
    if (e.fase === "hecho" || e.fase === "error") await poner({ fase: "nada" });
  }

  /** Al arrancar el motor: una espera que dejó el anterior sigue; una instalación que dejó el anterior se cierra. */
  async function retomar(): Promise<void> {
    const e = await cargarAct();
    if (e.fase === "esperando") armarEspera();
    else await estadoActual();
  }

  /** Actualizar: valida, mira que el checkout esté limpio y corre los tres pasos. Nunca rechaza. */
  function actualizar(): Promise<Actualizado> {
    actualizando ??= (async (): Promise<Actualizado> => {
      pararEspera();
      const v = await validar();
      if ("error" in v) {
        if ((act?.fase ?? "nada") === "esperando") await poner({ fase: "error", error: v.error });
        return { ok: false, error: v.error };
      }
      const { checkout, tag } = v;
      await poner({ fase: "instalando", version: versionDeTag(tag) });
      const fallo = async (error: string): Promise<Actualizado> => (await poner({ fase: "error", error }), { ok: false, error });
      for (const paso of pasosActualizar(tag, checkout, registro)) {
        // El instalador reinicia al motor: este proceso puede morir acá. El pid queda anotado para que el motor nuevo sepa si sigue.
        const r = await correr({ ...paso, alPid: (pid) => void poner({ fase: "instalando", version: versionDeTag(tag), pid }) });
        if (r.code !== 0) return fallo(ultimaLinea(r.salida) ?? `${paso.cmd} ${paso.args[0]}`);
        const falla = paso.cmd === "bash" ? falloDelInstalador(r.salida) : null;
        if (falla) return fallo(falla);
      }
      await poner({ fase: "hecho", version: versionDeTag(tag) });
      return { ok: true, version: versionDeTag(tag) };
    })()
      .catch(async (e: unknown): Promise<Actualizado> => {
        const error = e instanceof Error ? e.message : String(e);
        await poner({ fase: "error", error });
        return { ok: false, error };
      })
      .finally(() => (actualizando = null));
    return actualizando;
  }

  return {
    leerAviso,
    refrescar: refrescarAviso,
    buscar,
    descartar,
    actualizar,
    pedir,
    cancelarEspera,
    limpiar,
    retomar,
    estadoActual,
    ocupacion,
    alCambiarAviso: (f: (a: Aviso | null) => void) => void oyentes.add(f),
    alCambiarActualizacion: (f: (e: EstadoAct) => void) => void oyentesAct.add(f),
  };
}

let ocupacionDelMotor: () => Ocupacion = () => SIN_OCUPAR;
/** nucleo.ts le da la ocupación del motor (líderes, workers); sin llamarla nada ocupa. */
export const armarActualizacionTrama = (ocupacion: () => Ocupacion) => void (ocupacionDelMotor = ocupacion);
const trama = crearActualizacionTrama({ ocupacion: () => ocupacionDelMotor() });
export const leerAvisoTrama = () => trama.leerAviso();
/** Foco de la ventana y vuelta de la suspensión (main.ts): consulta ya y avisa a la barra si cambió. */
export const refrescarAvisoTrama = () => trama.refrescar();
export const buscarTrama = () => trama.buscar();
export const descartarTrama = () => trama.descartar();
/** Un modo que no es "ya" se toma como "esperar": lo que no se entiende nunca corta nada. */
export const pedirTrama = (modo: unknown) => trama.pedir(modoValido(modo) ? modo : "esperar");
export const cancelarEsperaTrama = () => trama.cancelarEspera();
export const limpiarTrama = () => trama.limpiar();
export const retomarTrama = () => trama.retomar();
export const estadoActualizacionTrama = () => trama.estadoActual();
export const ocupacionTrama = () => trama.ocupacion();
export const alCambiarAvisoTrama = (f: (a: Aviso | null) => void) => trama.alCambiarAviso(f);
export const alCambiarActualizacionTrama = (f: (e: EstadoAct) => void) => trama.alCambiarActualizacion(f);
