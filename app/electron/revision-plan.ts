// «Revisar con otro modelo» (segunda opinión sobre el plan de un líder): el prompt del revisor, cómo se lee lo que contesta, el
// mensaje que recibe el líder (con una marca para que la ventana lo dibuje como tarjeta del revisor y no como un mensaje de la
// persona) y la orquestación (negar el plan, mandar la revisión). Lo que toca el sistema (correr el modelo, el transcript, el
// permiso) entra por `DepsRevision`: lo prueba tests/revision-plan.test.ts con un revisor simulado. El corredor real
// (`correrRevisor`) usa la suscripción de siempre (claude / agy), nunca una clave de API. Diseño de lo que sigue (el modo debate):
// docs/modo-debate-diseno.md.
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { entornoAgy, paraLanzar, resolverAgy, resolverClaude } from "./binario.ts";
import { llamadaAgy } from "./agy-llamada.ts";
import { errorT } from "./errores.ts";
import { entornoLider } from "./lider-arma.ts";
import { claseDeModelo, idAgy, modeloAgy, partirGemini } from "./modelos-config.ts";
import { reglaDeExcluir, familiaClaude } from "./reparto-claude.ts";
import { mensajeParaLider, parsearRevision, promptRevisor, sinComillas, type ArchivoAdjunto, type RevisionVista } from "./revision-plan-texto.ts";

export * from "./revision-plan-texto.ts";

/** Lo más largo que se acepta de plan: más que esto no es un plan, es otra cosa. */
export const PLAN_MAX = 60_000;
/** Cuánto como mucho espera a que el revisor conteste. */
export const ESPERA_REVISOR_MS = 10 * 60_000;

/**
 * Los modelos que se pueden usar de revisor, de entre `ids`: de Claude o de Gemini (los dos corren de una sola vez y por la
 * suscripción) y que Ajustes > Modelos no tenga desactivados (`excluir`: familia, id o prefijo con `*`, la regla de `reparto`).
 */
export function revisoresPermitidos(ids: readonly string[], excluir: readonly string[]): string[] {
  return ids.filter((id) => {
    const c = claseDeModelo(id);
    if (c !== "claude" && c !== "gemini") return false;
    return !reglaDeExcluir(excluir, id, c === "claude" ? familiaClaude(id) : "");
  });
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

/**
 * Los archivos que el plan nombra y existen DENTRO de `cwd` (nunca fuera: ni `..` ni rutas absolutas ajenas), para pegarlos en el
 * prompt de un revisor que no puede leer el proyecto. Con topes (`ADJUNTOS_MAX`, `ADJUNTO_BYTES`, `ADJUNTOS_TOTAL`): lo que
 * pasa del tope va cortado y avisa. `leer` y `info` se inyectan para los tests.
 */
export async function archivosDelPlan(
  plan: string,
  cwd: string | undefined,
  d: { leer?: (ruta: string) => Promise<string>; esArchivo?: (ruta: string) => Promise<boolean> } = {},
): Promise<ArchivoAdjunto[]> {
  if (!cwd) return [];
  const leer = d.leer ?? ((r: string) => readFile(r, "utf8"));
  const esArchivo = d.esArchivo ?? ((r: string) => stat(r).then((s) => s.isFile(), () => false));
  const base = path.resolve(cwd);
  const fuera: ArchivoAdjunto[] = [];
  let total = 0;
  for (const r of rutasDelPlan(plan)) {
    if (fuera.length >= ADJUNTOS_MAX || total >= ADJUNTOS_TOTAL) break;
    const abs = path.resolve(base, r);
    const rel = path.relative(base, abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || /(?:^|[\\/])(?:\.env[^\\/]*|claves[^\\/]*|\.git|node_modules)(?:[\\/]|$)/.test(rel)) continue;
    if (!(await esArchivo(abs))) continue;
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

/** Lo que `revisarPlan` necesita del resto del sistema. */
export type DepsRevision = {
  /** Corre al revisor y devuelve lo que contestó. */
  correr: (modelo: string, effort: string, prompt: string) => Promise<string>;
  /** El primer mensaje de la persona en esa conversación. */
  pedidoOriginal: () => Promise<string | null>;
  cwd: () => string | undefined;
  /** Los archivos del proyecto que se pegan en el prompt (para un revisor que no puede leerlo); sin esto, ninguno. */
  archivos?: (plan: string) => Promise<ArchivoAdjunto[]>;
  /** El nombre con que se ve el modelo. */
  nombre: (modelo: string) => string;
  /** Niega el plan pendiente con ese mensaje (el líder lo lee como el resultado de ExitPlanMode). */
  negar: (mensaje: string) => void;
  /** Manda un mensaje al líder (se encola si está respondiendo). */
  mandar: (texto: string) => Promise<unknown>;
};

/**
 * La segunda opinión de punta a punta: el revisor lee el plan, la ventana recibe la revisión, el líder recibe el plan negado
 * («esperá la revisión») y enseguida la revisión como mensaje, para que la integre y presente el plan remasterizado. Si el
 * revisor falla, el plan sigue pendiente (no se niega nada) y el error sube.
 */
export async function revisarPlan(x: { modelo: string; effort: string; plan: string }, d: DepsRevision): Promise<RevisionVista> {
  const plan = x.plan.trim();
  if (!plan) throw errorT("main.revisionSinPlan");
  if (plan.length > PLAN_MAX) throw errorT("main.revisionPlanLargo");
  const prompt = promptRevisor({ plan, pedido: await d.pedidoOriginal(), cwd: d.cwd(), archivos: d.archivos ? await d.archivos(plan).catch(() => []) : [] });
  const salida = (await d.correr(x.modelo, x.effort, prompt)).trim();
  if (!salida) throw errorT("main.revisionVacia", { v: d.nombre(x.modelo) });
  const nombre = d.nombre(x.modelo);
  const r = parsearRevision(salida);
  d.negar(`Ferox pidió revisar tu plan con ${sinComillas(nombre)}. La revisión llega en el próximo mensaje: no ejecutes nada hasta integrarla y presentar el plan remasterizado con ExitPlanMode.`);
  await d.mandar(mensajeParaLider(x.modelo, nombre, r));
  return { ...r, modelo: x.modelo, nombre };
}

/** Corre un proceso, le pasa `stdin` y junta la salida. Rechaza con `salió N: <stderr>` o por tiempo. */
function ejecutar(file: string, args: string[], opc: { cwd: string; env: NodeJS.ProcessEnv; stdin: string; verbatim: boolean; espera: number }): Promise<string> {
  return new Promise((ok, no) => {
    const p = spawn(file, args, { cwd: opc.cwd, env: opc.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: opc.verbatim });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      p.kill();
      no(new Error("sin respuesta"));
    }, opc.espera);
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (x: string) => (out += x));
    p.stderr!.setEncoding("utf8");
    p.stderr!.on("data", (x: string) => (err = (err + x).slice(-2000)));
    p.on("error", (e) => {
      clearTimeout(t);
      no(e);
    });
    p.on("close", (rc) => {
      clearTimeout(t);
      rc === 0 ? ok(out) : no(new Error(`salió ${rc}: ${err.trim().split("\n").pop() ?? ""}`));
    });
    p.stdin!.on("error", () => {});
    p.stdin!.end(opc.stdin);
  });
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
 * Gemini con `agy` (en una carpeta vacía, porque `--dangerously-skip-permissions` lo deja escribir y ejecutar: el proyecto no lo lee; `archivosDelPlan` le pega en el prompt lo que el plan nombra). Sin `ANTHROPIC_*` en el entorno: siempre la suscripción.
 */
export async function correrRevisor(modelo: string, effort: string, prompt: string, cwd?: string): Promise<string> {
  const home = os.homedir();
  const clase = claseDeModelo(modelo);
  if (clase === "claude") {
    const l = paraLanzar(resolverClaude(process.env, home), [
      "-p",
      "--model",
      modelo,
      "--effort",
      effort,
      "--max-turns",
      "12",
      "--tools",
      "Read,Grep,Glob",
      "--no-session-persistence",
      "--disable-slash-commands",
    ]);
    return ejecutar(l.file, l.args, { cwd: cwd ?? home, env: entornoLider(process.env, home) as NodeJS.ProcessEnv, stdin: prompt, verbatim: l.verbatim, espera: ESPERA_REVISOR_MS });
  }
  if (clase === "gemini") {
    const vacia = await mkdtemp(path.join(os.tmpdir(), "trama-revisor-"));
    try {
      const g = partirGemini(modelo, effort);
      const { args, stdin } = llamadaAgy({ prompt, modelo: modeloAgy(idAgy(g.modelo, g.effort)), conversacion: null, timeout: "10m" });
      const env = entornoAgy(Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "CLAUDE_CONFIG_DIR" && !/^ANTHROPIC_/.test(k))), home);
      const l = paraLanzar(resolverAgy(process.env, home), args, env);
      return respuestaDeAgy(await ejecutar(l.file, l.args, { cwd: vacia, env: env as NodeJS.ProcessEnv, stdin, verbatim: l.verbatim, espera: ESPERA_REVISOR_MS }));
    } finally {
      await rm(vacia, { recursive: true, force: true }).catch(() => {});
    }
  }
  throw errorT("main.revisorNoSirve", { v: modelo });
}
