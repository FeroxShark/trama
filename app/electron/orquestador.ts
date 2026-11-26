// Motor ejecutable del Orquestador de fondo con revisión previa y presets de contexto (Fase 3 de docs/plan-orquestador-presets.md).
// Node puro (sin Electron): todo lo externo entra por `DepsOrquestador` con implementaciones reales por defecto (suscripción
// vía claude / codex / agy sin API keys ni consolas en Windows, y `pa --async` vía `resolverComando`). Persiste los últimos
// 40 encargos de forma atómica en `<estadoDir>/orquestadores.json`. Lo prueba `tests/orquestador.test.ts`.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { llamadaAgy } from "./agy-llamada.ts";
import {
  entornoAgy,
  entornoCmd,
  entornoPa,
  paraLanzar,
  resolverAgy,
  resolverClaude,
  resolverCodex,
  resolverComando,
} from "./binario.ts";
import { argsCodex, partirCodex } from "./codex-stream.ts";
import { ESTADO } from "./estado.ts";
import { entornoLider } from "./lider-arma.ts";
import { claseDeModelo, idAgy, modeloAgy, partirGemini } from "./modelos-config.ts";
import {
  esPresetContextoOrq,
  parsearRespuestaOrquestador,
  promptConDecision,
  promptRevisionPrevia,
  topeOrquestadorDePreset,
  topeWorkerDePreset,
  type EncargoOrquestador,
  type EstadoOrquestador,
  type PlanWorkerOrq,
  type PresetContextoOrq,
  type PropuestaOrquestador,
} from "./orquestador-texto.ts";
import { escribirAtomico } from "./pa.ts";
import { registro } from "./registro.ts";
import { LectorAgy, LectorClaude, LectorCodex } from "./revision-flujo.ts";
import { ejecutar, ESPERA_REVISOR_MS, falloDeRevisor, respuestaDeAgy } from "./revision-plan.ts";

export * from "./orquestador-texto.ts";

/** Máximo de encargos recientes guardados en `orquestadores.json`. */
export const MAX_ENCARGOS = 40;
/** Ventana de caché caliente al retomar una `consulta` (50 minutos). */
export const CACHE_ORQ_MS = 50 * 60_000;
/** Modelo y esfuerzo por defecto cuando el pedido no los especifica. */
export const MODELO_ORQ_DEFECTO = "claude-opus-5-5";
export const EFFORT_ORQ_DEFECTO = "high";
export const PRESET_ORQ_DEFECTO: PresetContextoOrq = "equilibrado";

/** Lo único que se pasa a `--advisor`: alias de familia de Claude. */
const ES_ASESOR = /^(haiku|sonnet|opus|fable)$/i;
/** Lo que nunca pasa a codex: claves de API de OpenAI (siempre login de ChatGPT) y `CLAUDE_CONFIG_DIR`. */
const SIN_CLAVES_CODEX = new Set(["CLAUDE_CONFIG_DIR", "OPENAI_API_KEY", "CODEX_API_KEY"]);
const ESPERA_PA_MS = 120_000;

export type PedidoOrquestador = {
  proyecto: string;
  objetivo: string;
  restricciones?: string[];
  verificacion?: string;
  id?: string;
  decision?: string;
  lider_sid?: string | null;
  modelo?: string;
  effort?: string;
  revision_previa?: boolean;
  preset_contexto?: PresetContextoOrq;
  advisor?: string | null;
};

export type ResultadoEncargo = {
  id: string;
  estado: EstadoOrquestador;
  encargo: EncargoOrquestador;
  propuesta?: PropuestaOrquestador;
  workers: string[];
  resumen?: string;
  error?: string;
  /** En un encargo retomado tras `consulta`: si la caché seguía caliente (< 50 min) o arrancó limpio. */
  retomo?: "caliente" | "limpio";
};

export type PedidoModeloOrq = {
  proyecto: string;
  cwd?: string;
  modelo: string;
  effort: string;
  prompt: string;
  autocompact?: number | null;
  advisor?: string | null;
  señal?: AbortSignal;
};

export type PedidoWorkerOrq = {
  proyecto: string;
  tarea: string;
  tipo: string;
  preset?: string;
  autocompact?: number | null;
  advisor?: string | null;
  titulo?: string;
  leer?: boolean;
  liderSid?: string | null;
};

export type DepsOrquestador = {
  estadoDir: string;
  ahora: () => number;
  nuevoId: () => string;
  carpetaProyecto: (proyecto: string) => Promise<string | undefined>;
  correrModelo: (p: PedidoModeloOrq) => Promise<string>;
  lanzarWorker: (p: PedidoWorkerOrq) => Promise<string>;
  escribir: (archivo: string, texto: string) => Promise<void>;
};

export type Orquestador = {
  listar(liderSid?: string): EncargoOrquestador[];
  obtener(id: string): EncargoOrquestador | null;
  alCambiar(fn: (lista: EncargoOrquestador[]) => void): () => void;
  encargar(pedido: PedidoOrquestador): Promise<ResultadoEncargo>;
};

// --- Implementaciones reales por defecto -------------------------------------

async function carpetaProyectoReal(proyecto: string): Promise<string | undefined> {
  try {
    const ps = await registro();
    const q = proyecto.trim().toLowerCase();
    const m = ps.find(
      (p) =>
        p.slug.toLowerCase() === q ||
        p.nombre.toLowerCase() === q ||
        p.alias.some((a) => a.toLowerCase() === q),
    );
    return m?.ruta;
  } catch {
    return undefined;
  }
}

/**
 * Corre el modelo del orquestador una sola vez en sólo lectura y por suscripción (nunca API keys ni consolas en Windows):
 * - Claude: `claude -p --tools Read,Grep,Glob` (+ `--autocompact`, `--advisor` si corresponde).
 * - ChatGPT (Codex): `codex exec --sandbox read-only`.
 * - Gemini (`agy`): en una carpeta temporal vacía.
 */
export async function correrModeloOrquestador(p: PedidoModeloOrq): Promise<string> {
  const home = os.homedir();
  const señal = p.señal ?? new AbortController().signal;
  const clase = claseDeModelo(p.modelo);

  if (clase === "claude") {
    const autocompact =
      typeof p.autocompact === "number" && Number.isFinite(p.autocompact) && p.autocompact > 0
        ? Math.round(p.autocompact)
        : null;
    const advisor = typeof p.advisor === "string" && ES_ASESOR.test(p.advisor.trim()) ? p.advisor.trim().toLowerCase() : null;
    const l = paraLanzar(resolverClaude(process.env, home), [
      "-p",
      "--model",
      p.modelo,
      ...(p.effort ? ["--effort", p.effort] : []),
      "--max-turns",
      "16",
      "--tools",
      "Read,Grep,Glob",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      ...(autocompact ? ["--autocompact", String(autocompact)] : []),
      ...(advisor ? ["--advisor", advisor] : []),
    ]);
    const lector = new LectorClaude(home);
    const s = await ejecutar(l.file, l.args, {
      cwd: p.cwd ?? home,
      env: entornoLider(process.env, home) as NodeJS.ProcessEnv,
      stdin: p.prompt,
      verbatim: l.verbatim,
      espera: ESPERA_REVISOR_MS,
      señal,
      quien: "Claude",
      linea: (x) => {
        lector.linea(x);
      },
    });
    if (lector.falla && /\berror_max_turns\b/.test(lector.falla) && lector.ultimoTexto.trim()) return lector.ultimoTexto;
    if (lector.falla) throw falloDeRevisor("claude", lector.falla);
    const r = lector.final ?? lector.ultimoTexto;
    if (r.trim()) return r;
    if (s.rc !== 0) throw falloDeRevisor("claude", s.err);
    return "";
  }

  if (clase === "codex") {
    const c = partirCodex(p.modelo, p.effort);
    const args = argsCodex({
      modelo: c.modelo,
      effort: c.effort,
      sandbox: "read-only",
      cwd: p.cwd ?? home,
      imagenes: [],
      thread: null,
    });
    const env = entornoAgy(
      Object.fromEntries(Object.entries(process.env).filter(([k]) => !SIN_CLAVES_CODEX.has(k))),
      home,
    );
    const l = paraLanzar(resolverCodex(process.env, home), args, env);
    const lector = new LectorCodex();
    const s = await ejecutar(l.file, l.args, {
      cwd: p.cwd ?? home,
      env: env as NodeJS.ProcessEnv,
      stdin: p.prompt,
      verbatim: l.verbatim,
      espera: ESPERA_REVISOR_MS,
      señal,
      quien: "ChatGPT",
      linea: (x) => {
        lector.linea(x);
      },
    });
    if (lector.falla) throw falloDeRevisor("codex", lector.falla);
    if (lector.final?.trim()) return lector.final;
    if (s.rc !== 0) throw falloDeRevisor("codex", s.err);
    return "";
  }

  if (clase === "gemini") {
    const vacia = await mkdtemp(path.join(os.tmpdir(), "trama-orq-"));
    try {
      const g = partirGemini(p.modelo, p.effort);
      const { args, stdin } = llamadaAgy({
        prompt: p.prompt,
        modelo: modeloAgy(idAgy(g.modelo, g.effort)),
        conversacion: null,
        timeout: "10m",
      });
      const env = entornoAgy(
        Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "CLAUDE_CONFIG_DIR" && !/^ANTHROPIC_/.test(k))),
        home,
      );
      const l = paraLanzar(resolverAgy(process.env, home), args, env);
      const lector = new LectorAgy(home);
      const s = await ejecutar(l.file, l.args, {
        cwd: vacia,
        env: env as NodeJS.ProcessEnv,
        stdin,
        verbatim: l.verbatim,
        espera: ESPERA_REVISOR_MS,
        señal,
        quien: "Google AI Pro",
        linea: (x) => {
          lector.linea(x);
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

  throw new Error(`Modelo no soportado para el orquestador: ${p.modelo}`);
}

const valorSuelto = (v: string | undefined): string | null => {
  if (!v) return null;
  const t = v.trim();
  if (!t || t.startsWith("-") || /[\r\n\0]/.test(t)) return null;
  return t;
};

/** Arma los argumentos de `pa` para lanzar un worker del orquestador (puro, testeable). */
export function construirArgsWorkerPa(p: PedidoWorkerOrq): string[] {
  const proyecto = valorSuelto(p.proyecto);
  if (!proyecto) throw new Error(`Proyecto inválido para pa: ${p.proyecto}`);
  const tarea = p.tarea.trim();
  if (!tarea) throw new Error("Falta la tarea del worker");

  const args = [proyecto, "--async"];
  const tipo = valorSuelto(p.tipo);
  if (tipo) args.push("--tipo", tipo);
  const preset = valorSuelto(p.preset);
  if (preset) args.push("--preset", preset);
  if (typeof p.autocompact === "number" && Number.isFinite(p.autocompact) && p.autocompact > 0) {
    args.push("--autocompact", String(Math.round(p.autocompact)));
  }
  const advisor = valorSuelto(p.advisor ?? undefined);
  if (advisor && ES_ASESOR.test(advisor)) args.push("--advisor", advisor.toLowerCase());
  const titulo = p.titulo?.replace(/[\r\n\0]+/g, " ").trim();
  if (titulo) args.push("--titulo", titulo);
  if (p.leer === true) args.push("--leer");
  args.push("--", tarea);
  return args;
}

/** Extrae el `id:` de corrida de la salida de `pa --async`; `null` si no aparece. */
export function extraerIdPa(salida: string): string | null {
  const exacto = /\bid:\s*(\d{8}-\d{6}-\d+)\b/.exec(salida);
  if (exacto) return exacto[1]!;
  const flag = /--id\s+(\d{8}-\d{6}-\d+)\b/.exec(salida);
  if (flag) return flag[1]!;
  const generico = /\bid:\s*([A-Za-z0-9._-]+)\b/.exec(salida);
  return generico ? generico[1]! : null;
}

/** Lanza un worker de `pa` en background (`--async`) con `resolverComando` y `windowsHide: true`, y devuelve su `id`. */
export function lanzarWorkerPa(p: PedidoWorkerOrq): Promise<string> {
  const home = os.homedir();
  const baseEnv = entornoPa(process.env, home);
  const envConJefe = p.liderSid ? { ...baseEnv, PA_JEFE_ID: p.liderSid } : baseEnv;
  const prefijo = resolverComando("pa", "HILOS_PA", envConJefe, home);
  const args = construirArgsWorkerPa(p);
  const envFinal = entornoCmd(prefijo, envConJefe) as NodeJS.ProcessEnv;

  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    let cerrado = false;
    const child = spawn(prefijo[0]!, [...prefijo.slice(1), ...args], {
      env: envFinal,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (cerrado) return;
      cerrado = true;
      child.kill();
      reject(new Error(`pa --async no contestó en ${Math.round(ESPERA_PA_MS / 1000)} s`));
    }, ESPERA_PA_MS);
    child.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));
    child.on("error", (e) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(timer);
      reject(new Error(`No pude lanzar pa: ${e.message}`));
    });
    child.on("close", (rc) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(timer);
      const combinado = [out.trim(), err.trim()].filter(Boolean).join("\n");
      if (rc !== 0) {
        reject(new Error(`pa salió con ${rc ?? 1}${combinado ? `: ${combinado.slice(-400)}` : ""}`));
        return;
      }
      const id = extraerIdPa(combinado);
      if (!id) {
        reject(new Error(`pa no devolvió un id de worker${combinado ? `: ${combinado.slice(-200)}` : ""}`));
        return;
      }
      resolve(id);
    });
  });
}

// --- Persistencia y motor ----------------------------------------------------

function clonarEncargo(e: EncargoOrquestador): EncargoOrquestador {
  return {
    ...e,
    restricciones: [...e.restricciones],
    workers: [...e.workers],
    ...(e.propuesta ? { propuesta: { ...e.propuesta, opciones: [...e.propuesta.opciones] } } : {}),
  };
}

function esEncargoValido(x: unknown): x is EncargoOrquestador {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    !!o.id &&
    typeof o.proyecto === "string" &&
    typeof o.objetivo === "string" &&
    typeof o.estado === "string" &&
    Array.isArray(o.workers) &&
    Array.isArray(o.restricciones) &&
    typeof o.creado === "number" &&
    typeof o.actualizado === "number"
  );
}

function cargarEncargos(archivo: string): EncargoOrquestador[] {
  try {
    const crudo = JSON.parse(readFileSync(archivo, "utf8")) as unknown;
    const lista = Array.isArray(crudo)
      ? crudo
      : crudo && typeof crudo === "object" && Array.isArray((crudo as { encargos?: unknown }).encargos)
        ? ((crudo as { encargos: unknown[] }).encargos)
        : [];
    return lista
      .filter(esEncargoValido)
      .sort((a, b) => b.actualizado - a.actualizado || b.creado - a.creado)
      .slice(0, MAX_ENCARGOS)
      .map(clonarEncargo);
  } catch {
    return [];
  }
}

function mensajeError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return String(e || "error desconocido");
}

function resultadoDe(encargo: EncargoOrquestador, retomo?: "caliente" | "limpio"): ResultadoEncargo {
  const copia = clonarEncargo(encargo);
  return {
    id: copia.id,
    estado: copia.estado,
    encargo: copia,
    ...(copia.propuesta ? { propuesta: copia.propuesta } : {}),
    workers: copia.workers,
    ...(copia.resumen !== undefined ? { resumen: copia.resumen } : {}),
    ...(copia.error !== undefined ? { error: copia.error } : {}),
    ...(retomo ? { retomo } : {}),
  };
}

export function crearOrquestador(deps?: Partial<DepsOrquestador>): Orquestador {
  const d: DepsOrquestador = {
    estadoDir: deps?.estadoDir ?? ESTADO,
    ahora: deps?.ahora ?? (() => Date.now()),
    nuevoId: deps?.nuevoId ?? (() => `orq-${Date.now()}-${randomBytes(4).toString("hex")}`),
    carpetaProyecto: deps?.carpetaProyecto ?? carpetaProyectoReal,
    correrModelo: deps?.correrModelo ?? correrModeloOrquestador,
    lanzarWorker: deps?.lanzarWorker ?? lanzarWorkerPa,
    escribir: deps?.escribir ?? escribirAtomico,
  };

  const archivo = path.join(d.estadoDir, "orquestadores.json");
  let encargos: EncargoOrquestador[] = cargarEncargos(archivo);
  const oyentes = new Set<(lista: EncargoOrquestador[]) => void>();

  const listar = (liderSid?: string): EncargoOrquestador[] =>
    (liderSid === undefined ? encargos : encargos.filter((e) => e.lider_sid === liderSid)).map(clonarEncargo);

  const obtener = (id: string): EncargoOrquestador | null => {
    const encontrado = encargos.find((e) => e.id === id);
    return encontrado ? clonarEncargo(encontrado) : null;
  };

  const alCambiar = (fn: (lista: EncargoOrquestador[]) => void): (() => void) => {
    oyentes.add(fn);
    return () => {
      oyentes.delete(fn);
    };
  };

  const persistirYEmitir = async (): Promise<void> => {
    encargos.sort((a, b) => b.actualizado - a.actualizado || b.creado - a.creado);
    if (encargos.length > MAX_ENCARGOS) encargos = encargos.slice(0, MAX_ENCARGOS);
    const payload = JSON.stringify({ version: 1, encargos }, null, 2) + "\n";
    await d.escribir(archivo, payload);
    const snapshot = listar();
    for (const fn of oyentes) {
      try {
        fn(snapshot.map(clonarEncargo));
      } catch {
        /* un oyente que falla no frena al orquestador */
      }
    }
  };

  const lanzarPlanes = async (encargo: EncargoOrquestador, planes: PlanWorkerOrq[]): Promise<void> => {
    for (const w of planes) {
      const workerId = await d.lanzarWorker({
        proyecto: encargo.proyecto,
        tarea: w.tarea,
        tipo: w.tipo,
        ...(w.preset ? { preset: w.preset } : {}),
        autocompact: topeWorkerDePreset(encargo.preset_contexto, w.tipo),
        // Sin herencia automática: sólo si el plan del orquestador pidió `advisor` explícitamente para este worker.
        ...(w.advisor ? { advisor: w.advisor } : {}),
        ...(w.titulo ? { titulo: w.titulo } : {}),
        ...(w.leer ? { leer: true } : {}),
        liderSid: encargo.lider_sid,
      });
      encargo.workers.push(workerId);
    }
  };

  const marcarError = async (encargo: EncargoOrquestador, err: unknown, retomo?: "caliente" | "limpio"): Promise<ResultadoEncargo> => {
    encargo.estado = "error";
    encargo.error = mensajeError(err);
    encargo.actualizado = d.ahora();
    await persistirYEmitir();
    return resultadoDe(encargo, retomo);
  };

  const encargar = async (pedido: PedidoOrquestador): Promise<ResultadoEncargo> => {
    const idPedido = pedido.id?.trim();

    // --- Caso 1: retomar una consulta previa con la decisión de la persona ---
    if (idPedido) {
      const existente = encargos.find((e) => e.id === idPedido);
      if (!existente) throw new Error(`Encargo de orquestador no encontrado: ${idPedido}`);
      if (existente.estado !== "consulta") {
        throw new Error(`El encargo ${idPedido} no está en consulta (estado: ${existente.estado})`);
      }
      const decision = pedido.decision?.trim();
      if (!decision) throw new Error("Falta la decisión para retomar el encargo");

      const ahora = d.ahora();
      const caliente = typeof existente.cache_vence === "number" && ahora < existente.cache_vence;
      const retomo: "caliente" | "limpio" = caliente ? "caliente" : "limpio";

      existente.estado = "ejecutando";
      existente.error = undefined;
      existente.cache_vence = undefined;
      existente.actualizado = ahora;
      await persistirYEmitir();

      try {
        const cwd = await d.carpetaProyecto(existente.proyecto);
        const prompt = promptConDecision({
          proyecto: existente.proyecto,
          objetivo: existente.objetivo,
          restricciones: existente.restricciones,
          verificacion: existente.verificacion,
          propuesta: existente.propuesta,
          decision,
          cacheVencida: !caliente,
        });
        const salida = (
          await d.correrModelo({
            proyecto: existente.proyecto,
            cwd,
            modelo: pedido.modelo?.trim() || existente.modelo,
            effort: pedido.effort?.trim() || existente.effort,
            prompt,
            autocompact: topeOrquestadorDePreset(existente.preset_contexto),
            advisor: pedido.advisor ?? null,
          })
        ).trim();
        if (!salida) throw new Error("El orquestador devolvió una respuesta vacía");

        const parsed = parsearRespuestaOrquestador(salida);
        await lanzarPlanes(existente, parsed.workers);
        existente.resumen = parsed.resumen || existente.resumen;
        existente.estado = "listo";
        existente.actualizado = d.ahora();
        await persistirYEmitir();
        return resultadoDe(existente, retomo);
      } catch (err) {
        return marcarError(existente, err, retomo);
      }
    }

    // --- Caso 2: encargo nuevo ---
    const proyecto = pedido.proyecto?.trim();
    const objetivo = pedido.objetivo?.trim();
    if (!proyecto) throw new Error("Falta el proyecto del encargo");
    if (!objetivo) throw new Error("Falta el objetivo del encargo");

    const preset: PresetContextoOrq = esPresetContextoOrq(pedido.preset_contexto)
      ? pedido.preset_contexto
      : PRESET_ORQ_DEFECTO;
    const revisionPrevia = pedido.revision_previa !== false;
    const ahora = d.ahora();

    const encargo: EncargoOrquestador = {
      id: d.nuevoId(),
      lider_sid: pedido.lider_sid ?? null,
      proyecto,
      modelo: pedido.modelo?.trim() || MODELO_ORQ_DEFECTO,
      effort: pedido.effort?.trim() || EFFORT_ORQ_DEFECTO,
      preset_contexto: preset,
      objetivo,
      restricciones: (pedido.restricciones ?? []).map((r) => r.trim()).filter(Boolean),
      verificacion: (pedido.verificacion ?? "").trim(),
      estado: revisionPrevia ? "revisando" : "ejecutando",
      workers: [],
      creado: ahora,
      actualizado: ahora,
    };
    encargos.unshift(encargo);
    await persistirYEmitir();

    try {
      const cwd = await d.carpetaProyecto(encargo.proyecto);
      const prompt = revisionPrevia
        ? promptRevisionPrevia({
            proyecto: encargo.proyecto,
            objetivo: encargo.objetivo,
            restricciones: encargo.restricciones,
            verificacion: encargo.verificacion,
          })
        : promptConDecision({
            proyecto: encargo.proyecto,
            objetivo: encargo.objetivo,
            restricciones: encargo.restricciones,
            verificacion: encargo.verificacion,
            decision: "Sin revisión previa: planificá los workers para ejecutar directamente.",
          });

      const salida = (
        await d.correrModelo({
          proyecto: encargo.proyecto,
          cwd,
          modelo: encargo.modelo,
          effort: encargo.effort,
          prompt,
          autocompact: topeOrquestadorDePreset(encargo.preset_contexto),
          advisor: pedido.advisor ?? null,
        })
      ).trim();
      if (!salida) throw new Error("El orquestador devolvió una respuesta vacía");

      const parsed = parsearRespuestaOrquestador(salida);

      if (revisionPrevia && parsed.veredicto === "consulta") {
        const finConsulta = d.ahora();
        encargo.estado = "consulta";
        encargo.propuesta = parsed.propuesta ?? {
          resumen: parsed.resumen,
          opciones: [],
          recomendacion: "",
        };
        encargo.resumen = encargo.propuesta.resumen;
        encargo.cache_vence = finConsulta + CACHE_ORQ_MS;
        encargo.actualizado = finConsulta;
        await persistirYEmitir();
        return resultadoDe(encargo);
      }

      if (encargo.estado !== "ejecutando") {
        encargo.estado = "ejecutando";
        encargo.actualizado = d.ahora();
        await persistirYEmitir();
      }

      await lanzarPlanes(encargo, parsed.workers);
      encargo.resumen = parsed.resumen;
      encargo.estado = "listo";
      encargo.actualizado = d.ahora();
      await persistirYEmitir();
      return resultadoDe(encargo);
    } catch (err) {
      return marcarError(encargo, err);
    }
  };

  return { listar, obtener, alCambiar, encargar };
}
