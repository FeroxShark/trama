// «Revisar con otro modelo» (segunda opinión sobre el plan de un líder): el prompt del revisor, cómo se lee lo que contesta, el
// mensaje que recibe el líder (con una marca para que la ventana lo dibuje como tarjeta del revisor y no como un mensaje de la
// persona) y la orquestación (negar el plan, mandar la revisión). Lo que toca el sistema (correr el modelo, el transcript, el
// permiso) entra por `DepsRevision`: lo prueba tests/revision-plan.test.ts con un revisor simulado. El corredor real
// (`correrRevisor`) usa la suscripción de siempre (claude / agy), nunca una clave de API. Diseño de lo que sigue (el modo debate):
// docs/modo-debate-diseno.md.
import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { entornoAgy, paraLanzar, resolverAgy, resolverClaude, resolverCodex } from "./binario.ts";
import { argsCodex, partirCodex } from "./codex-stream.ts";
import { correrReal, sondearCodex } from "./cuentas.ts";
import { llamadaAgy } from "./agy-llamada.ts";
import { errorT } from "./errores.ts";
import { entornoLider } from "./lider-arma.ts";
import { claseDeModelo, idAgy, modeloAgy, partirGemini } from "./modelos-config.ts";
import { reglaDeExcluir, familiaClaude } from "./reparto-claude.ts";
import { hijoEnGrupo, matarArbol } from "./procesos.ts";
import { LectorAgy, LectorClaude, LectorCodex, type Avance } from "./revision-flujo.ts";
import { mensajeParaLider, parsearRevision, PLAN_MAX, promptRevisor, sinComillas, type ArchivoAdjunto, type RevisionVista } from "./revision-plan-texto.ts";

export * from "./revision-plan-texto.ts";
export type { Avance } from "./revision-flujo.ts";

export { PLAN_MAX };
/** Cuánto como mucho espera a que el revisor conteste. */
export const ESPERA_REVISOR_MS = 10 * 60_000;

/**
 * Los modelos que se pueden usar de revisor, de entre `ids`: de Claude, de Gemini o de ChatGPT (codex; los tres corren de una sola
 * vez y por la suscripción) y que Ajustes > Modelos no tenga desactivados (`excluir`: familia, id o prefijo con `*`, la regla de
 * `reparto`). ChatGPT sólo entra con `codexListo` (codex instalado y con sesión: `codexListo()` lo mira).
 */
export function revisoresPermitidos(ids: readonly string[], excluir: readonly string[], codexListo = false): string[] {
  return ids.filter((id) => {
    const c = claseDeModelo(id);
    if (c === "codex") return codexListo && !reglaDeExcluir(excluir, id, "codex");
    if (c !== "claude" && c !== "gemini") return false;
    return !reglaDeExcluir(excluir, id, c === "claude" ? familiaClaude(id) : "");
  });
}

/** ¿Está codex instalado y con la sesión de ChatGPT iniciada? (`codex login status`; nunca falla: ante la duda, no.) */
export async function codexListo(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): Promise<boolean> {
  const c = await sondearCodex({ env, home, correr: correrReal }).catch(() => null);
  return c?.instalado === true && c.logueado === true;
}

/** Topes de lo que se le adjunta a un revisor que no puede leer el proyecto (Gemini): archivos, bytes por archivo y bytes en total. */
export const ADJUNTOS_MAX = 8;
export const ADJUNTO_BYTES = 12_000;
export const ADJUNTOS_TOTAL = 40_000;

/** Las rutas de archivo que nombra un plan, en el orden en que aparecen y sin repetir. */
export function rutasDelPlan(plan: string): string[] {
  const vistas = new Set<string>();
  for (const m of plan.matchAll(/[\w@~./-]*[\w@-]\.[A-Za-z][A-Za-z0-9]{0,7}\b/g)) {
    const r = m[0].replace(/^\.\//, "");
    if (/^\d+\.\d+$/.test(r) || /^https?:/.test(r) || /\.(?:com|org|net|io|dev)$/i.test(r)) continue;
    vistas.add(r);
  }
  return [...vistas];
}

/** Lo que nunca se le pega a un revisor: secretos y carpetas que no son del plan (`.env*`, claves, credenciales, llaves privadas, `.git`, `node_modules`). */
const SENSIBLE = /(?:^|[\\/])(?:\.env[^\\/]*|claves[^\\/]*|credentials?[^\\/]*|secrets?(?:\.[^\\/]*)?|id_(?:rsa|dsa|ecdsa|ed25519)[^\\/]*|[^\\/]*\.(?:pem|key|p12|pfx|keystore)|\.npmrc|\.netrc|\.ssh|\.aws|\.git|node_modules)(?:[\\/]|$)/i;

/**
 * Los archivos que el plan nombra y existen DENTRO de `cwd` (nunca fuera: ni `..` ni rutas absolutas ajenas), para pegarlos en el
 * prompt de un revisor que no puede leer el proyecto. Con topes (`ADJUNTOS_MAX`, `ADJUNTO_BYTES`, `ADJUNTOS_TOTAL`): lo que
 * pasa del tope va cortado y avisa. `leer` y `info` se inyectan para los tests.
 */
export async function archivosDelPlan(
  plan: string,
  cwd: string | undefined,
  d: { leer?: (ruta: string) => Promise<string>; esArchivo?: (ruta: string) => Promise<boolean>; real?: (ruta: string) => Promise<string> } = {},
): Promise<ArchivoAdjunto[]> {
  if (!cwd) return [];
  // Con el disco inyectado no hay enlaces que seguir; con el real, la ruta final (sin enlaces simbólicos) también tiene que quedar dentro.
  const real = d.real ?? (d.leer || d.esArchivo ? async (r: string) => r : (r: string) => realpath(r));
  const leer = d.leer ?? ((r: string) => readFile(r, "utf8"));
  const esArchivo = d.esArchivo ?? ((r: string) => stat(r).then((s) => s.isFile(), () => false));
  const base = path.resolve(cwd);
  const baseReal = await real(base).catch(() => base);
  const fuera: ArchivoAdjunto[] = [];
  let total = 0;
  for (const r of rutasDelPlan(plan)) {
    if (fuera.length >= ADJUNTOS_MAX || total >= ADJUNTOS_TOTAL) break;
    const abs = path.resolve(base, r);
    const rel = path.relative(base, abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || SENSIBLE.test(rel)) continue;
    if (!(await esArchivo(abs))) continue;
    // Un enlace simbólico dentro del proyecto hacia otro lugar no es «dentro»: se mira adónde llega de verdad.
    const dest = await real(abs).catch(() => null);
    const relReal = dest === null ? null : path.relative(baseReal, dest);
    if (relReal === null || !relReal || relReal.startsWith("..") || path.isAbsolute(relReal) || SENSIBLE.test(relReal)) continue;
    let texto: string;
    try {
      texto = await leer(abs);
    } catch {
      continue;
    }
    if (texto.includes("\0")) continue;
    const cupo = Math.min(ADJUNTO_BYTES, ADJUNTOS_TOTAL - total);
    const cortado = texto.length > cupo;
    const parte = cortado ? texto.slice(0, cupo) : texto;
    total += parte.length;
    fuera.push({ ruta: rel.split(path.sep).join("/"), texto: parte, cortado });
  }
  return fuera;
}

/** Cómo corre el revisor: a quién le cuenta lo que va haciendo y cómo se lo corta. */
export type OpcionesCorrida = { avance: (a: Avance) => void; señal: AbortSignal };
const SIN_OPCIONES: OpcionesCorrida = { avance: () => {}, señal: new AbortController().signal };

/** Lo que `revisarPlan` necesita del resto del sistema. */
export type DepsRevision = {
  /** Corre al revisor y devuelve lo que contestó; cuenta por `o.avance` lo que va haciendo y se corta con `o.señal`. */
  correr: (modelo: string, effort: string, prompt: string, o: OpcionesCorrida) => Promise<string>;
  /** El primer mensaje de la persona en esa conversación. */
  pedidoOriginal: () => Promise<string | null>;
  cwd: () => string | undefined;
  /** Los archivos del proyecto que se pegan en el prompt (para un revisor que no puede leerlo); sin esto, ninguno. */
  archivos?: (plan: string) => Promise<ArchivoAdjunto[]>;
  /** El nombre con que se ve el modelo. */
  nombre: (modelo: string) => string;
  /** Niega el plan pendiente con ese mensaje (el líder lo lee como el resultado de ExitPlanMode). */
  negar: (mensaje: string) => void;
  /**
   * Le entrega la revisión al líder POR LA COLA (nunca se rechaza porque esté respondiendo: tras negar el plan el líder sigue
   * en turno, y lo encolado entra en el próximo límite de herramienta o al terminar el turno). Rechaza si no pudo encolarla.
   */
  entregar: (texto: string) => Promise<unknown>;
  /** Guarda la revisión terminada en disco hasta que se entregue (un fallo de entrega no la pierde). */
  guardar?: (mensaje: string, r: RevisionVista) => Promise<void>;
  /** Avisa que la revisión salió y que empieza a entregarse. */
  alEntregar?: (r: RevisionVista) => void;
};

/** Entrega una revisión guardada y, si entró en la cola, ya no hace falta tenerla en disco. */
export async function entregarGuardada(mensaje: string, d: Pick<DepsRevision, "entregar"> & { quitar?: () => Promise<void> }): Promise<void> {
  try {
    await d.entregar(mensaje);
  } catch {
    throw errorT("main.revisionNoEntro");
  }
  await d.quitar?.().catch(() => {});
}

/**
 * La segunda opinión de punta a punta: el revisor lee el plan, la revisión se guarda en disco, el líder recibe el plan negado
 * («esperá la revisión») y la revisión por la cola, para que la integre y presente el plan remasterizado. Si el revisor falla o se
 * cancela, el plan sigue pendiente (no se niega nada) y el error sube. Si la entrega falla, la revisión queda guardada (se reintenta).
 */
export async function revisarPlan(
  x: { modelo: string; effort: string; plan: string },
  d: DepsRevision & { quitar?: () => Promise<void> },
  o: OpcionesCorrida = SIN_OPCIONES,
): Promise<RevisionVista> {
  const plan = x.plan.trim();
  if (!plan) throw errorT("main.revisionSinPlan");
  if (plan.length > PLAN_MAX) throw errorT("main.revisionPlanLargo");
  const prompt = promptRevisor({ plan, pedido: await d.pedidoOriginal(), cwd: d.cwd(), archivos: d.archivos ? await d.archivos(plan).catch(() => []) : [] });
  const salida = (await d.correr(x.modelo, x.effort, prompt, o)).trim();
  if (o.señal.aborted) throw errorT("main.revisionCancelada");
  if (!salida) throw errorT("main.revisionVacia", { v: d.nombre(x.modelo) });
  const nombre = d.nombre(x.modelo);
  const r = parsearRevision(salida);
  const vista = { ...r, modelo: x.modelo, nombre };
  const mensaje = mensajeParaLider(x.modelo, nombre, r);
  await d.guardar?.(mensaje, vista);
  d.alEntregar?.(vista);
  d.negar(`La persona pidió revisar tu plan con ${sinComillas(nombre)}. La revisión llega en el próximo mensaje: no ejecutes nada hasta integrarla y presentar el plan remasterizado con ExitPlanMode.`);
  await entregarGuardada(mensaje, d);
  return vista;
}

/** Lo que no pasa al hijo de codex: las claves de la API de OpenAI (se usa el login de ChatGPT) y el `CLAUDE_CONFIG_DIR`. */
const SIN_CLAVES_CODEX = new Set(["CLAUDE_CONFIG_DIR", "OPENAI_API_KEY", "CODEX_API_KEY"]);

/** Cómo terminó un proceso del revisor. */
type Salida = { rc: number | null; out: string; err: string };

/**
 * Corre un proceso, le pasa `stdin`, junta la salida y le pasa cada línea de stdout a `linea` apenas llega. Sólo rechaza si no
 * se pudo lanzar (ENOENT: texto traducido), si se cortó con `señal` o si pasó el tiempo; un código ≠ 0 se devuelve (lo lee quien llama).
 */
export function ejecutar(file: string, args: string[], opc: { cwd: string; env: NodeJS.ProcessEnv; stdin: string; verbatim: boolean; espera: number; señal: AbortSignal; linea?: (l: string) => void; quien: string; matarArbol?: typeof matarArbol; graciaMs?: number }): Promise<Salida> {
  return new Promise((ok, no) => {
    if (opc.señal.aborted) return no(errorT("main.revisionCancelada"));
    const p = spawn(file, args, { cwd: opc.cwd, env: opc.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: opc.verbatim, detached: hijoEnGrupo() });
    let out = "";
    let err = "";
    let resto = "";
    let cerrado = false;
    const fin = (f: () => void) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(t);
      opc.señal.removeEventListener("abort", cortar);
      f();
    };
    const matarTodo = opc.matarArbol ?? matarArbol;
    let duro: ReturnType<typeof setTimeout> | null = null;
    const matar = () => {
      p.kill();
      matarTodo(p.pid);
      // Si ignora el TERM (o dejó hijos vivos), a los pocos segundos va el KILL a todo el grupo: nada queda corriendo ni gastando cupo.
      if (!duro) {
        duro = setTimeout(() => {
          p.kill("SIGKILL");
          matarTodo(p.pid, "SIGKILL");
        }, opc.graciaMs ?? 5000);
        duro.unref?.();
      }
    };
    const t = setTimeout(() => {
      matar();
      fin(() => no(errorT("main.revisorSinRespuesta", { v: opc.quien })));
    }, opc.espera);
    const cortar = () => {
      matar();
      fin(() => no(errorT("main.revisionCancelada")));
    };
    opc.señal.addEventListener("abort", cortar, { once: true });
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (x: string) => {
      out += x;
      if (!opc.linea) return;
      resto += x;
      const lineas = resto.split("\n");
      resto = lineas.pop() ?? "";
      for (const l of lineas) opc.linea(l);
    });
    p.stderr!.setEncoding("utf8");
    p.stderr!.on("data", (x: string) => (err = (err + x).slice(-2000)));
    p.on("error", (e) => fin(() => no((e as NodeJS.ErrnoException).code === "ENOENT" ? errorT("main.revisorNoEncontrado", { v: opc.quien }) : e)));
    p.on("close", (rc) => {
      if (resto && opc.linea) opc.linea(resto);
      fin(() => ok({ rc, out, err }));
    });
    p.stdin!.on("error", () => {});
    p.stdin!.end(opc.stdin);
  });
}

/** El nombre del servicio detrás de un revisor, para decirlo en palabras simples. */
const servicioDe = (clase: "claude" | "gemini" | "codex") => (clase === "claude" ? "Claude" : clase === "codex" ? "ChatGPT" : "Google AI Pro");
/** El comando que inicia la sesión de cada servicio, para decirlo en el aviso de «sin sesión». */
const comandoDe = (clase: "claude" | "gemini" | "codex") => (clase === "claude" ? "claude" : clase === "codex" ? "codex login" : "agy");

/**
 * Un fallo del revisor en palabras simples (nada de «salió 1»): sin sesión si el servicio dijo que no hay login o que venció; si no,
 * lo último que dijo, si es corto y legible; si no, un texto general. El detalle crudo va al log de quien lo recibe, no a la pantalla.
 */
export function falloDeRevisor(clase: "claude" | "gemini" | "codex", dijo: string): Error {
  const servicio = servicioDe(clase);
  if (/\berror_max_turns\b/.test(dijo)) return errorT("main.revisorMaxTurnos", { v: servicio });
  const linea = dijo.trim().split("\n").filter(Boolean).pop()?.replace(/^error:\s*/i, "").trim() ?? "";
  if (/authentication|not logged|log ?in|sign ?in|unauthori[sz]ed|credential|\b401\b|token (?:has )?expired|session expired/i.test(dijo)) return errorT("main.revisorSinSesion", { v: servicio, c: comandoDe(clase) });
  if (linea && linea.length <= 140 && !/^salió \d+/.test(linea)) return errorT("main.revisorFalloDetalle", { v: servicio, d: linea });
  return errorT("main.revisorFallo", { v: servicio });
}

/** La respuesta de `agy --output-format stream-json`: el `response` del `result`; si salió con error, rechaza con lo que dijo. */
export function respuestaDeAgy(salida: string): string {
  let resp: string | null = null;
  let falla: string | null = null;
  for (const linea of salida.split("\n")) {
    if (!linea.includes('"result"')) continue;
    try {
      const r = (JSON.parse(linea) as { event?: string; result?: { status?: string; response?: string } }).result;
      if (!r) continue;
      if (r.status === "SUCCESS") resp = r.response ?? "";
      else falla = r.response || r.status || "error";
    } catch {}
  }
  if (resp !== null) return resp;
  throw new Error(falla ?? "agy no contestó");
}

/**
 * Corre al revisor de verdad, una sola vez: Claude con `claude -p` (sólo Read, Grep y Glob, para mirar lo que el plan nombra) o
 * ChatGPT con `codex exec --json` en sólo lectura (`--sandbox read-only`, con el login de ChatGPT: sin `OPENAI_API_KEY` ni `CODEX_API_KEY`) o
 * Gemini con `agy` (en una carpeta vacía, porque `--dangerously-skip-permissions` lo deja escribir y ejecutar: el proyecto no lo lee; `archivosDelPlan` le pega en el prompt lo que el plan nombra). Sin `ANTHROPIC_*` en el entorno: siempre la suscripción.
 * Va contando lo que hace (`o.avance`: pasos y texto vivo) y se corta con `o.señal`.
 */
export async function correrRevisor(modelo: string, effort: string, prompt: string, cwd?: string, o: OpcionesCorrida = SIN_OPCIONES): Promise<string> {
  const home = os.homedir();
  const clase = claseDeModelo(modelo);
  if (clase === "claude") {
    const l = paraLanzar(resolverClaude(process.env, home), [
      "-p",
      "--model",
      modelo,
      ...(effort ? ["--effort", effort] : []),
      "--max-turns",
      "12",
      "--tools",
      "Read,Grep,Glob",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ]);
    const lector = new LectorClaude(home);
    const s = await ejecutar(l.file, l.args, {
      cwd: cwd ?? home,
      env: entornoLider(process.env, home) as NodeJS.ProcessEnv,
      stdin: prompt,
      verbatim: l.verbatim,
      espera: ESPERA_REVISOR_MS,
      señal: o.señal,
      quien: servicioDe("claude"),
      linea: (x) => {
        const a = lector.linea(x);
        if (a) o.avance(a);
      },
    });
    // Tope de turnos (leyó varios archivos): si lo último que escribió ya trae las secciones, se aprovecha en vez de tirarlo.
    if (lector.falla && /\berror_max_turns\b/.test(lector.falla) && !parsearRevision(lector.ultimoTexto).libre?.trim() && lector.ultimoTexto.trim()) return lector.ultimoTexto;
    if (lector.falla) throw falloDeRevisor("claude", lector.falla);
    const r = lector.final ?? lector.ultimoTexto;
    if (r.trim()) return r;
    if (s.rc !== 0) throw falloDeRevisor("claude", s.err);
    return "";
  }
  if (clase === "codex") {
    const c = partirCodex(modelo, effort);
    const args = argsCodex({ modelo: c.modelo, effort: c.effort, sandbox: "read-only", cwd: cwd ?? home, imagenes: [], thread: null });
    const env = entornoAgy(Object.fromEntries(Object.entries(process.env).filter(([k]) => !SIN_CLAVES_CODEX.has(k))), home);
    const l = paraLanzar(resolverCodex(process.env, home), args, env);
    const lector = new LectorCodex();
    const s = await ejecutar(l.file, l.args, {
      cwd: cwd ?? home,
      env: env as NodeJS.ProcessEnv,
      stdin: prompt,
      verbatim: l.verbatim,
      espera: ESPERA_REVISOR_MS,
      señal: o.señal,
      quien: servicioDe("codex"),
      linea: (x) => {
        const a = lector.linea(x);
        if (a) o.avance(a);
      },
    });
    if (lector.falla) throw falloDeRevisor("codex", lector.falla);
    if (lector.final?.trim()) return lector.final;
    if (s.rc !== 0) throw falloDeRevisor("codex", s.err);
    return "";
  }
  if (clase === "gemini") {
    const vacia = await mkdtemp(path.join(os.tmpdir(), "trama-revisor-"));
    try {
      const g = partirGemini(modelo, effort);
      const { args, stdin } = llamadaAgy({ prompt, modelo: modeloAgy(idAgy(g.modelo, g.effort)), conversacion: null, timeout: "10m" });
      const env = entornoAgy(Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "CLAUDE_CONFIG_DIR" && !/^ANTHROPIC_/.test(k))), home);
      const l = paraLanzar(resolverAgy(process.env, home), args, env);
      const lector = new LectorAgy(home);
      const s = await ejecutar(l.file, l.args, {
        cwd: vacia,
        env: env as NodeJS.ProcessEnv,
        stdin,
        verbatim: l.verbatim,
        espera: ESPERA_REVISOR_MS,
        señal: o.señal,
        quien: servicioDe("gemini"),
        linea: (x) => {
          const a = lector.linea(x);
          if (a) o.avance(a);
        },
      });
      try {
        return respuestaDeAgy(s.out);
      } catch (e) {
        throw falloDeRevisor("gemini", `${(e as Error).message}\n${s.err}`);
      }
    } finally {
      await rm(vacia, { recursive: true, force: true }).catch(() => {});
    }
  }
  throw errorT("main.revisorNoSirve", { v: modelo });
}
