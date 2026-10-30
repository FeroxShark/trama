// La política de modelos de `pa` (motor/bin/pa, desde «política de modelos» hasta efforts_permitidos): qué modelo y effort corre,
// qué se niega (exit 2), qué apagó el dueño (exit 98), --tipo/--fase/--tarea/--subtarea/--rubrica, reparto, la cuenta y las
// validaciones de cada motor. Todo antes de resolver el proyecto y de lanzar nada. Los chequeos que miran afuera (agy y su
// plugin, codex y su login, dsh, el servidor de Ollama) son de la etapa 10: entran por `Motores`.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ahoraS, leerTexto } from "./corridas.ts";
import { salir, conDueno, type Pa } from "./entorno.ts";
import { limiteDe } from "./lanzar.ts";
import {
  CODEX_MODELOS, DSH_MODELOS, GEMINI_MODELOS, OC_MODELOS, TIPOS_VALIDOS, calza, esCodex, esDsh, esGemini, esLocal, esOpencode,
  type Modelos, type Politica,
} from "./modelos.ts";
import type { Opciones } from "./opciones.ts";
import { topeReparto, type Cuentas, type Reparto } from "./programas.ts";
import { resolverRubrica, type Rubrica } from "./rubrica.ts";

export type Motor = "claude" | "agy" | "codex" | "dsh" | "ollama";

/** Una llamada a `pa <proyecto>` ya parseada, con lo que la política resolvió (las variables globales del bash). */
export interface Llamada extends Opciones {
  /** ¿Este camino lanza un worker? (no: --matar, --ramas, --olvidar, --integrar, --descartar, AGENTS.md y lecciones). */
  lanza: boolean;
  rub: Rubrica | null;
  /** El -m del jefe (vacío = lo eligió la tabla). */
  modeloPedido: string;
  vinoDeReparto: boolean;
  repartoFallo: string;
  /** El tipo con el que reparto eligió (para pedirle otro candidato si el elegido no tiene cupo). */
  repartoTipoRelanzable: string;
  /** El padre de --async marcó sin_cupo=esperar: el hijo hace cola. */
  repartoEsperar: boolean;
  /** El claude-* que pidió el jefe cuando pa lo pasó a agy porque había más cupo (vacío = no se sustituyó nada). */
  sustituidoDe: string;
  /** Lo que contestó reparto (`rep_json`). */
  repJson: string;
  /** Lo que le queda a una corrida --async de su lista -m a,b,c (PA_FALLBACK_RESTO). */
  fbResto: string;
  motor: Motor;
  /** El modelo de agy/codex/dsh que se pidió, si se cayó al equivalente Claude. */
  geminiPedido: string;
  /** La cuenta con la que corre (vacío: un local) y el prefijo `env -u … K=V` de su entorno. */
  cuentaUsada: string;
  cuentaEnv: string[];
  cuentaSeguir: string;
  ocEffort: string;
  localUrl: string;
  localModelo: string;
  /** "-" para medicion.tsv y el .hilo cuando el motor no tiene effort aparte. */
  efVacio: string;
  politica: Politica;
  /** El modelo (en minúsculas) que el pre-chequeo de lo que eligió reparto ya dio por bueno: el bloque de su motor no lo chequea otra vez. */
  chequeado: string;
  /** ¿El effort lo pidió alguien (flag, entorno, modelos.json, reparto, rúbrica) o lo puso el default de pa? */
  esfPedido: boolean;
  /** ¿Modelo de poca inteligencia? (lo calcula cli.ts antes de lanzar). */
  flojo?: boolean;
}

/** ¿La tarea trae su chequeo (un brief con «Cómo verificar» o «Listo cuando»)? Con chequeo, mecanico y lectura ofrecen primero los gratis de OpenCode. */
export const traeChequeo = (tarea: string) => /C[oó]mo verificar|Listo cuando/i.test(tarea);

export function llamadaDe(o: Opciones): Llamada {
  return {
    ...o,
    lanza: true,
    rub: null,
    modeloPedido: "",
    vinoDeReparto: false,
    repartoFallo: "",
    repartoTipoRelanzable: "",
    repartoEsperar: false,
    sustituidoDe: "",
    repJson: "",
    fbResto: "",
    motor: "claude",
    geminiPedido: "",
    cuentaUsada: "",
    cuentaEnv: [],
    cuentaSeguir: "",
    ocEffort: "",
    localUrl: "",
    localModelo: "",
    efVacio: "",
    politica: { sinCupo: "otro", sinCupoDe: "default", permitirMax: false },
    chequeado: "",
    esfPedido: false,
  };
}

/** Los chequeos de motor que miran afuera (etapa 10). Devuelven el motivo por el que NO va ("" = va). */
export interface Motores {
  chequearGemini(modelo: string, l: Llamada): Promise<string>;
  chequearCodex(modelo: string, l: Llamada): Promise<string>;
  chequearDsh(modelo: string, l: Llamada): Promise<string>;
  /** "ok" o el motivo (`local_estado`). */
  estadoLocal(url: string, modelo: string): Promise<string>;
}

export interface DepsPolitica {
  modelos: Modelos;
  reparto: Reparto;
  cuentas: Cuentas;
  motores: Motores;
  /** `proyecto-ruta <p>` callado: la ruta real o null. */
  proyectoRuta: (p: string) => string | null;
  /** `command -v claude`. */
  claudeEnPath: () => boolean;
}

// ------------------------------------------------------------------------------------------- helpers del bash

/** `leer_campo archivo campo`: el valor de la primera línea `campo=…` ("" si no hay). */
export function leerCampo(f: string, campo: string): string {
  try {
    for (const l of readFileSync(f, "utf8").split("\n")) if (l.startsWith(`${campo}=`)) return l.slice(campo.length + 1);
  } catch {
    /* sin archivo */
  }
  return "";
}

/** `slug_de`: ruta real → clave de estado (basename, caracteres raros a `-`, minúscula). */
export const slugDe = (ruta: string) => path.basename(ruta).replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();

const esArchivo = (f: string) => {
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
};
const leerRecortado = (f: string) => {
  try {
    return readFileSync(f, "utf8").replace(/\n+$/, "");
  } catch {
    return "";
  }
};

/** `gemini_equivalente`: el modelo y effort del Claude oficial que reemplaza a uno de agy. */
export function geminiEquivalente(m: string): [string, string] {
  const fijo: Record<string, [string, string]> = {
    "gemini-4-argon-high": ["claude-opus-5-5", "medium"],
    "gemini-4-argon-medium": ["claude-sonnet-5-5", "high"],
    "gemini-4-argon-low": ["claude-sonnet-5-5", "medium"],
    "gemini-3.8-flash-high": ["claude-haiku-5-5", "xhigh"],
    "gemini-3.8-flash-medium": ["claude-haiku-5-5", "high"],
    "gemini-3.8-flash-low": ["claude-haiku-5-5", "medium"],
  };
  if (fijo[m]) return fijo[m];
  const e = m.slice(m.lastIndexOf("-") + 1);
  if (m.startsWith("agy:claude-opus-5-5-")) return ["claude-opus-5-5", e];
  if (m.startsWith("agy:claude-sonnet-5-5-")) return ["claude-sonnet-5-5", e];
  if (m.startsWith("agy:gpt-oss-120b-")) return ["claude-sonnet-5-5", "medium"];
  // modelos que sólo ofrece el agy de esa cuenta (p. ej. Claude 4.6 Thinking): la misma familia del Claude oficial
  if (m.startsWith("agy:claude-opus-")) return ["claude-opus-5-5", "medium"];
  if (m.startsWith("agy:claude-sonnet-")) return ["claude-sonnet-5-5", "medium"];
  if (m.startsWith("agy:gpt-")) return ["claude-sonnet-5-5", "medium"];
  if (m.startsWith("gemini-") && m.includes("flash")) return ["claude-haiku-5-5", "high"];
  if (m.startsWith("gemini-")) return ["claude-sonnet-5-5", "high"];
  return ["", ""];
}

/** `codex_equivalente`. */
export function codexEquivalente(m: string): [string, string] {
  const e = m.slice(m.lastIndexOf("-") + 1);
  if (m.startsWith("codex:gpt-6-astra-")) return ["claude-opus-5-5", e];
  if (m.startsWith("codex:gpt-6-luna-")) return ["claude-haiku-5-5", e === "low" ? "medium" : e === "medium" ? "high" : "xhigh"];
  if (m.startsWith("codex:")) return ["claude-sonnet-5-5", e];
  return ["", ""];
}

/** `local_de`: url y modelo de un `ollama:…` (de `locales` en modelos.json; si no está, el Ollama de siempre). */
export function localDe(id: string, pa: Pa, modelos: Modelos): { url: string; modelo: string } {
  const locales = (() => {
    try {
      return modelos.cargar(true) ? (JSON.parse(modelos.clave("locales") || "[]") as unknown[]) : [];
    } catch {
      return [];
    }
  })();
  const l = locales.find((x): x is Record<string, unknown> => !!x && typeof x === "object" && (x as Record<string, unknown>).id === id);
  if (l) return { url: String(l.url ?? ""), modelo: String(l.modelo ?? "") };
  let u = pa.env.OLLAMA_HOST || "http://localhost:11434";
  if (!u.startsWith("http")) u = `http://${u}`;
  return { url: u, modelo: id.slice(id.indexOf(":") + 1) };
}

/** `proveedor_de_modelo` (y `proveedor_cuenta_de` con `cuenta`: opencode también tiene cuentas). */
export function proveedorDe(m: string, cuenta = false): string {
  if (cuenta && esOpencode(m)) return "opencode";
  if (esLocal(m) || esDsh(m)) return "";
  if (esCodex(m)) return "chatgpt";
  if (esGemini(m)) return "google";
  return "claude";
}

/** El archivo de cuentas (`CUENTAS_JSON`). */
const cuentasJson = (pa: Pa) =>
  pa.env.TRAMA_CUENTAS || path.join(pa.env.TRAMA_CUENTAS_HOME || pa.home, ".config", "trama", "cuentas.json");

type CuentaFila = { id?: unknown; proveedor?: unknown };
function filasCuentas(pa: Pa): CuentaFila[] | null {
  const f = cuentasJson(pa);
  if (!esArchivo(f)) return null;
  try {
    const c = (JSON.parse(readFileSync(f, "utf8")) as { cuentas?: unknown }).cuentas;
    return Array.isArray(c) ? (c as CuentaFila[]) : [];
  } catch {
    return [];
  }
}

/** `cuenta_proveedor`: el proveedor de una cuenta ("" si no existe). */
export function cuentaProveedor(id: string, pa: Pa): string {
  if (["claude", "google", "chatgpt", "opencode"].includes(id)) return id;
  const p = filasCuentas(pa)?.find((c) => c && c.id === id)?.proveedor;
  return p === undefined || p === null || p === false ? "" : String(p);
}

// ------------------------------------------------------------------------------------------- la política

/** Un mensaje por stderr y `exit codigo`. */
function corta(pa: Pa, codigo: number, msg: string): never {
  pa.io.err(`${msg}\n`);
  return salir(codigo);
}

/** `cuenta_preparar`: deja la cuenta y su entorno en la llamada; false (con aviso, salvo `callado`) si no va. */
async function cuentaPreparar(id: string, prov: string, l: Llamada, pa: Pa, deps: DepsPolitica, callado = false): Promise<boolean> {
  const aviso = (s: string) => {
    if (!callado) pa.io.err(`${s}\n`);
    return false;
  };
  l.cuentaEnv = [];
  if (["claude", "google", "chatgpt", "opencode"].includes(id)) {
    if (id !== prov) return aviso(`pa: la cuenta '${id}' es de ${id} y el modelo '${l.modelo}' es de ${prov}.`);
    l.cuentaUsada = id;
    return true;
  }
  const r = await deps.cuentas.env(id);
  if (r.rc !== 0) return aviso(`pa: ${r.salida || `no pude leer la cuenta ${id}`}`);
  let j: { proveedor?: unknown; sacar?: unknown; poner?: unknown } = {};
  try {
    j = JSON.parse(r.salida);
  } catch {
    j = {};
  }
  const p = typeof j.proveedor === "string" ? j.proveedor : "";
  if (p !== prov) return aviso(`pa: la cuenta '${id}' es de ${p || "?"} y el modelo '${l.modelo}' es de ${prov}.`);
  l.cuentaUsada = id;
  const e: string[] = [];
  for (const s of Array.isArray(j.sacar) ? j.sacar : []) e.push("-u", String(s));
  if (j.poner && typeof j.poner === "object") for (const [k, v] of Object.entries(j.poner)) e.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  l.cuentaEnv = e.length ? ["env", ...e] : [];
  return true;
}

/** `cuenta_elegir`: la cuenta que eligió la persona (`cuentas preferir`; sin elegir, la de siempre). Nunca por el cupo. */
async function cuentaElegir(prov: string, _l: Llamada, pa: Pa, _deps: DepsPolitica): Promise<string> {
  if (prov === "opencode") return "opencode";
  const filas = filasCuentas(pa);
  if (!filas || !filas.some((c) => c && c.proveedor === prov && c.id !== prov)) return prov;
  let c = "";
  try {
    const x = (JSON.parse(readFileSync(cuentasJson(pa), "utf8")) as { preferidas?: Record<string, unknown> | null }).preferidas?.[prov];
    c = typeof x === "string" ? x : "";
  } catch {
    c = "";
  }
  if (!(c && cuentaProveedor(c, pa) === prov)) c = "";
  return c || prov;
}

/** `cuenta_resolver`: la cuenta del proveedor del modelo. Una --cuenta que no va sale 2. */
export async function cuentaResolver(prov: string, l: Llamada, pa: Pa, deps: DepsPolitica): Promise<void> {
  if (!prov) {
    if (l.cuenta) corta(pa, 2, `pa: --cuenta no va con '${l.modelo}': un modelo local no usa ninguna suscripción.`);
    l.cuentaUsada = "";
    l.cuentaEnv = [];
    return;
  }
  if (l.cuenta) {
    if (!(await cuentaPreparar(l.cuenta, prov, l, pa, deps))) salir(2);
    return;
  }
  // --seguir: la misma cuenta que la retomada, si es del mismo proveedor y sigue existiendo.
  if (l.cuentaSeguir && cuentaProveedor(l.cuentaSeguir, pa) === prov && (await cuentaPreparar(l.cuentaSeguir, prov, l, pa, deps, true))) return;
  const c = await cuentaElegir(prov, l, pa, deps);
  if (!(await cuentaPreparar(c, prov, l, pa, deps))) await cuentaPreparar(prov, prov, l, pa, deps);
}

/** El id de la corrida que retoma un --seguir (el --id, o el último del puesto si no es --leer), con su slug. */
function corridaSeguida(l: Llamada, pa: Pa, deps: DepsPolitica): { slug: string; ts: string } | null {
  const ruta = deps.proyectoRuta(l.proyecto);
  if (!ruta) return null;
  const slug = slugDe(ruta);
  let ts = l.runId;
  if (!ts && !l.leer) ts = leerRecortado(path.join(pa.state, `${slug}.session.ts`));
  return { slug, ts };
}

/** El JSON de reparto, o null si no se puede leer. */
function json(s: string): Record<string, unknown> | null {
  try {
    const x = JSON.parse(s) as unknown;
    return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const texto = (x: unknown) => (x === null || x === undefined || x === false ? "" : typeof x === "string" ? x : JSON.stringify(x));

/** El effort de settings.json de Claude (`effortLevel`), para el default de opus con plan max. */
function effortDeSettings(pa: Pa): string {
  const f = pa.env.PA_CLAUDE_SETTINGS || path.join(pa.env.CLAUDE_CONFIG_DIR || path.join(pa.home, ".claude"), "settings.json");
  try {
    return texto((JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>).effortLevel);
  } catch {
    return "";
  }
}

/** Una tarea de --seguir, --aca, --mcp (o --leer) que el motor no tiene: sale 2. */
function noVan(l: Llamada, pa: Pa, nombre: string, motor: string, conLeer = false) {
  const casos: [boolean, string][] = [
    [l.seguir, `--seguir (${motor} no retoma una sesión de pa)`],
    [l.aca, `--aca/--sucio-mio (un worker de ${motor} trabaja siempre en su worktree)`],
    [l.conMcp, `--mcp (los MCP de claude.ai no existen en ${motor})`],
  ];
  if (conLeer) casos.push([l.leer, `--leer (${motor} no tiene un modo de sólo lectura que alcance al bash)`]);
  for (const [si, t] of casos) if (si) corta(pa, 2, `pa: ${t} no va con '${nombre}'. Sacalo, o usá un modelo Claude.`);
}

/**
 * La política entera, en el orden del bash. Deja todo en la llamada (modelo, effort, motor, cuenta…) o corta con `Salida` (2, 3,
 * 75, 95, 96 o 98) después de explicar por stderr.
 */
export async function aplicarPolitica(l: Llamada, pa: Pa, deps: DepsPolitica): Promise<Llamada> {
  const { env, io } = pa;
  const { modelos, reparto } = deps;
  const conEffort = () => (l.esfuerzo ? ` effort ${l.esfuerzo}` : "");
  const ponerEffort = (e: string) => {
    l.esfuerzo = e;
    env.PA_EFFORT = e;
  };
  const sacarEffort = () => {
    l.esfuerzo = "";
    delete env.PA_EFFORT;
  };
  const politica = () => (l.politica = modelos.politica());

  l.lanza =
    !(l.matar || l.ramas || l.olvidar || l.agentsMd || l.unificarMd || l.lecciones || l.leccionesPodar) && !l.leccion && !(l.integrar || l.descartar);
  // El tipo se valida igual que el effort: sólo donde se lanza (un PA_TIPO heredado no traba la gestión).
  l.tipo = l.tipo.toLowerCase();
  if (l.tipo === "diseño") l.tipo = "diseno";
  if (l.lanza && l.tipo && !calza(TIPOS_VALIDOS, l.tipo))
    corta(pa, 2, `pa: --tipo '${l.tipo}' no existe. Válidos: ${TIPOS_VALIDOS.replace(/\|/g, ", ")}${env.PA_TIPO ? " (ojo: puede venir de PA_TIPO)" : ""}.`);
  // --fase y --tarea: una palabra (letras, números, . _ -), para que sirvan de clave en `pa --rinde --por`.
  if (l.lanza) {
    for (const [nombre, v] of [["fase", l.fase], ["tarea", l.tareaId], ["subtarea", l.subtarea]] as const) {
      if (v && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(v))
        corta(pa, 2, `pa: --${nombre} '${v}' no va: una sola palabra de hasta 40 caracteres (letras, números, . _ -), ej. F4 o mi-tarea.`);
    }
    if (l.fase) l.fase = l.fase.toUpperCase();
  }
  // --rubrica: sin -m, la tabla da el modelo y el effort (y -m/--effort le ganan). Fila "no se lanza": sale 3.
  if (l.lanza && l.rubrica) {
    const r = (l.rub = resolverRubrica(l.rubrica, modelos, io));
    if (r.rc === 3) io.err(`pa: rúbrica (${r.norm}): fila ${r.fila} no se lanza. ${r.nota}\n`);
    if (r.rc) salir(r.rc);
    if (!l.modeloDeM) {
      l.modelo = r.modelo;
      l.modeloDeM = true;
      if (r.effort && !l.esfuerzo) {
        ponerEffort(r.effort);
        l.esfuerzoFlag = true;
      }
      if (r.tipo && !l.tipo) l.tipo = r.tipo;
      io.err(`pa: rúbrica (${r.norm}) → fila ${r.fila}: ${l.modelo}${conEffort()}.\n`);
    } else io.err(`pa: rúbrica (${r.norm}) → fila ${r.fila} daba ${r.modelo}${r.effort ? ` ${r.effort}` : ""}; vale tu -m ${l.modelo}.\n`);
  }

  // Sin -m, si reparto está en auto, reparto elige modelo y effort según calidad y cupo libre. Con --seguir se conserva el modelo
  // de la corrida que se retoma. Si reparto falla o vence el tope, cae a modelos.json o al default.
  l.modeloPedido = l.modelo;
  const esf0 = { esfuerzo: l.esfuerzo, flag: l.esfuerzoFlag, env: env.PA_EFFORT };
  l.repartoTipoRelanzable = env.PA_REPARTO_TIPO ?? "";
  delete env.PA_REPARTO_TIPO;
  l.repartoEsperar = !!env.PA_REPARTO_ESPERAR;
  delete env.PA_REPARTO_ESPERAR;
  /** Pide a reparto el modelo y el effort y aplica lo que contesta; true si dio un modelo. `noDisp`: lo que pa sabe que ahora no sirve (REPARTO_NO_DISPONIBLE). */
  const elegirConReparto = async (tipoRep: string, noDisp: string[]): Promise<boolean> => {
    const r = reparto.ejecutable() ? await reparto.elegir(tipoRep, { reservar: true, sinDsh: l.leer, cuenta: l.cuenta, noDisponible: noDisp, ...(traeChequeo(l.tarea) ? { conChequeo: true } : {}) }) : { rc: 127, salida: "" };
    l.repJson = r.salida;
    const j = r.rc === 0 && r.salida ? json(r.salida) : null;
    const mRep = j ? texto(j.modelo) : "";
    const eRep = j ? texto(j.effort) : "";
    const motRep = j ? texto(j.motivo).replace(/[\r\n\t|]+/g, " ") : "";
    if (mRep) {
      l.modelo = mRep;
      l.vinoDeReparto = true;
      l.repartoTipoRelanzable = tipoRep;
      const m = l.modelo;
      if (eRep && !esGemini(m) && !esCodex(m) && !esLocal(m) && !esDsh(m) && !l.esfuerzo) ponerEffort(eRep);
      const suf = /^(.*)-(low|medium|high)$/.exec(l.modelo);
      if (l.esfuerzoFlag && (esGemini(m) || esCodex(m)) && suf && /^(low|medium|high)$/.test(l.esfuerzo.toLowerCase())) {
        const base = suf[1]!;
        l.modelo = base === "agy:gpt-oss-120b" ? `${base}-medium` : `${base}-${l.esfuerzo.toLowerCase()}`;
        l.esfuerzoFlag = false;
        sacarEffort();
      }
      io.err(`pa: reparto (${tipoRep}) → ${l.modelo}${conEffort()}: ${motRep}\n`);
      // Todo lleno: reparto dio el más barato que alcanza. sin_cupo dice qué hacer.
      if (j!.todo_lleno === true) {
        politica();
        if (l.politica.sinCupo === "fallar")
          corta(pa, 96, `pa: no hay cupo para ${tipoRep} (todo lleno o en reserva) y modelos.json dice sin_cupo=fallar (${l.politica.sinCupoDe}): no lanzo.`);
        if (l.politica.sinCupo === "esperar") {
          if (l.async) {
            env.PA_REPARTO_ESPERAR = "1";
            io.err(`pa: no hay cupo para ${tipoRep} y modelos.json dice sin_cupo=esperar: queda en cola hasta que haya.\n`);
          } else
            corta(
              pa,
              75,
              `pa: no hay cupo para ${tipoRep} (todo lleno o en reserva) y modelos.json dice sin_cupo=esperar: lanzalo con --async (hace cola hasta que haya cupo).`,
            );
        }
      }
    } else if (noDisp.length) return false;
    else if (r.rc === 124 || r.rc === 137) l.repartoFallo = `timeout tras ${topeReparto(env)}s`;
    else if (r.rc === 127) l.repartoFallo = `no existe ${reparto.ruta}`;
    else l.repartoFallo = `rc ${r.rc}`;
    return Boolean(mRep);
  };
  if (!l.modelo && l.lanza && modelos.reparto() === "auto") {
    if (l.seguir) {
      const s = l.runId || !l.tipo ? corridaSeguida(l, pa, deps) : null;
      const hilo = s && s.ts ? path.join(pa.state, s.slug, `${s.ts}.hilo`) : "";
      if (hilo && esArchivo(hilo)) {
        const m = leerCampo(hilo, "modelo");
        const e = leerCampo(hilo, "effort");
        if (m.startsWith("claude-") && (!m.includes("fable") || l.okDueno)) {
          l.modelo = m;
          if (!l.esfuerzo && e && e !== "-" && e !== "settings") ponerEffort(e);
        }
      }
    } else if (
      (l.tarea || l.actualizar) &&
      !env.PA_ASYNC &&
      !l.aca &&
      !l.conMcp &&
      !l.maxBudget &&
      !/^(xhigh|max)$/.test(l.esfuerzo.toLowerCase()) &&
      deps.proyectoRuta(l.proyecto) !== null
    ) {
      const tipoRep = l.tipo || (l.leer ? "lectura" : "codigo-acotado");
      await elegirConReparto(tipoRep, []);
    }
  }
  // modelos.json: con reparto=fijo o si reparto falló, el tipo (o `default`) elige modelo y effort.
  if (!l.modelo && l.lanza && modelos.cargar()) {
    const w = modelos.worker(l.tipo);
    if (w?.modelo) {
      l.modelo = w.modelo;
      if (w.effort && !l.esfuerzo) ponerEffort(w.effort);
    }
  }
  if (!l.modelo) {
    // Default Sonnet; --tipo mecanico (sin --leer ni --seguir) → Haiku.
    l.modelo = l.tipo === "mecanico" && !l.leer && !l.seguir ? "claude-haiku-5-5" : "claude-sonnet-5-5";
  }
  if (l.repartoFallo) io.err(`pa: reparto falló (${l.repartoFallo}); sigo con ${l.modelo}.\n`);
  // Sin -m, pa sigue con lo que sugiere la tabla, pero lo avisa. Con -m, reparto sólo interviene si ese modelo no tiene cupo.
  if (l.lanza && !l.seguir && !env.PA_ASYNC) {
    if (!l.modeloPedido) {
      io.err(
        `pa: aviso: sin -m. Sigo con ${l.modelo}${conEffort()} (lo sugirió la tabla), pero elegí vos modelo y effort según el tamaño real de la tarea: -m <id> --effort <e>. 'reparto --resumen' lista las opciones con inteligencia, costo y cupo.\n`,
      );
    } else if (reparto.ejecutable() && modelos.reparto() === "auto") {
      const vuelve = sinCupoHasta(await tablaReparto(deps), l.modelo);
      if (vuelve !== null) {
        const scTipo = l.tipo || (l.leer ? "lectura" : "codigo-acotado");
        const alt = await reparto.elegir(scTipo);
        const ja = alt.rc === 0 ? json(alt.salida) : null;
        const scAlt = ja && ja.modelo !== null && ja.modelo !== undefined ? `-m ${texto(ja.modelo)}${texto(ja.effort) ? ` --effort ${texto(ja.effort)}` : ""}` : "";
        politica();
        io.err(
          `pa: aviso: ${l.modelo} no tiene cupo ahora${vuelve ? ` (vuelve ${vuelve})` : ""}.${scAlt ? ` Alternativa que sugiere reparto para ${scTipo}: ${scAlt}.` : ""} 'reparto --resumen' lista las opciones.\n`,
        );
        if (l.politica.sinCupo === "fallar") corta(pa, 96, `pa: modelos.json dice sin_cupo=fallar (${l.politica.sinCupoDe}): no lanzo con ${l.modelo}.`);
      }
    }
  }

  // --- Un -m claude-* (opus o sonnet) con el mismo modelo por agy y más cupo libre allá: corre por agy (el cupo de Claude es de la semana de la
  // persona). --exacto lo evita; frontend y diseno (necesitan Skill), xhigh/max, --seguir, --aca, --mcp y --max-budget-usd quedan en Claude.
  // El candado de siempre sigue: si agy no puede correr (plugin, privacidad), cae al equivalente Claude. Cada sustitución se anota (reparto --registrar).
  l.sustituidoDe = "";
  if (
    l.lanza && !l.seguir && !env.PA_ASYNC && l.modeloPedido && !l.exacto && !l.aca && !l.conMcp && !l.maxBudget && (l.tarea || l.actualizar) &&
    /^claude-(opus|sonnet)-/i.test(l.modelo) && reparto.sustituir && reparto.ejecutable() && modelos.reparto() === "auto" && !l.vinoDeReparto
  ) {
    const r = await reparto.sustituir(l.modelo, { tipo: l.tipo || (l.leer ? "lectura" : ""), effort: l.esfuerzo.toLowerCase() });
    const j = r.rc === 0 && r.salida ? json(r.salida) : null;
    if (j && j.sustituir === true && texto(j.a)) {
      io.err(`pa: ${l.modelo} → ${texto(j.a)}: ${texto(j.motivo)}. Con --exacto corre tal cual.\n`);
      l.sustituidoDe = l.modelo;
      l.modelo = texto(j.a);
      l.esfuerzoFlag = false;
      sacarEffort();
    }
  }

  // --- Lo que reparto eligió y ahora no sirve (plugin de agy sin cargar, codex sin sesión, dsh sin instalar, un Claude con el límite de
  // la cuenta a la vista) no se lanza ni cae a un Claude que tampoco va: se le pide a reparto el siguiente candidato sin ese (a lo sumo 4
  // veces). Si reparto no da otro, sigue el camino de siempre (el equivalente Claude, o 95/96).
  l.chequeado = "";
  if (l.lanza && l.vinoDeReparto && !env.PA_ASYNC && l.repartoTipoRelanzable) {
    const noDisp: string[] = [];
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      const m = l.modelo.toLowerCase();
      let motivo = "";
      let patrones: string[] = [];
      if (esGemini(m)) {
        await cuentaResolver("google", l, pa, deps);
        motivo = await deps.motores.chequearGemini(m, l);
        patrones = ["agy:*", "gemini-*"];
      } else if (esCodex(m)) {
        motivo = await deps.motores.chequearCodex(m, l);
        patrones = ["codex:*"];
      } else if (esDsh(m)) {
        motivo = await deps.motores.chequearDsh(l.modelo, l);
        patrones = [m];
      } else if (!esLocal(m)) {
        await cuentaResolver(proveedorDe(l.modelo, true), l, pa, deps);
        const hasta = leerTexto(limiteDe(pa, l.cuentaUsada));
        if (/^[0-9]+$/.test(hasta) && Number(hasta) > ahoraS()) {
          motivo = `la cuenta ${l.cuentaUsada || "claude"} tiene el límite de sesión de la suscripción`;
          patrones = ["claude-*"];
        }
      }
      if (!motivo) {
        l.chequeado = m;
        break;
      }
      const antes = { modelo: l.modelo, esfuerzo: l.esfuerzo, flag: l.esfuerzoFlag, env: env.PA_EFFORT };
      for (const p of patrones) if (!noDisp.includes(p)) noDisp.push(p);
      io.err(`pa: ${l.modelo} no sirve ahora (${motivo}): le pido a reparto el siguiente candidato.\n`);
      l.esfuerzo = esf0.esfuerzo;
      l.esfuerzoFlag = esf0.flag;
      if (esf0.env === undefined) delete env.PA_EFFORT;
      else env.PA_EFFORT = esf0.env;
      l.vinoDeReparto = false;
      const dio = await elegirConReparto(l.repartoTipoRelanzable, noDisp);
      if (dio && l.modelo !== antes.modelo) continue;
      l.modelo = antes.modelo;
      l.esfuerzo = antes.esfuerzo;
      l.esfuerzoFlag = antes.flag;
      if (antes.env === undefined) delete env.PA_EFFORT;
      else env.PA_EFFORT = antes.env;
      l.vinoDeReparto = true;
      break;
    }
  }

  // --- Gemini y Claude/GPT por agy, ChatGPT por codex, dsh/opencode y locales: validar, o caer al equivalente Claude ---
  l.motor = "claude";
  l.geminiPedido = "";
  if (l.lanza && l.seguir && !l.cuenta) {
    const s = corridaSeguida(l, pa, deps);
    if (s && s.ts) l.cuentaSeguir = leerCampo(path.join(pa.state, s.slug, `${s.ts}.hilo`), "cuenta");
  }
  if (l.lanza && esGemini(l.modelo)) await cuentaResolver("google", l, pa, deps);
  if (l.lanza && esGemini(l.modelo)) {
    if (!calza(GEMINI_MODELOS, l.modelo.toLowerCase())) {
      // el catálogo de agy cambia con la cuenta, la región y la versión: vale lo que el agy de esta cuenta ofrece (reparto --agy-modelos)
      const cuentaAgy = l.cuentaUsada && !["claude", "google", "chatgpt"].includes(l.cuentaUsada) ? l.cuentaUsada : undefined;
      let ofrecidos = (await deps.reparto.agyModelos?.({ cuenta: cuentaAgy })) ?? [];
      if (!ofrecidos.includes(l.modelo.toLowerCase())) {
        // sin ninguno fuera de los conocidos (sin agy o sin sesión, reparto devuelve los de siempre) la lista no dice nada nuevo
        if (ofrecidos.every((m) => calza(GEMINI_MODELOS, m))) ofrecidos = [];
        corta(
          pa,
          2,
          `pa: modelo '${l.modelo}' no va. Modelos de agy en pa: gemini-{4-argon,3.8-flash}-{low,medium,high}, agy:claude-{opus,sonnet}-5-5-{low,medium,high} o agy:gpt-oss-120b-medium${ofrecidos.length ? `, y los que ofrece el agy de esta cuenta: ${ofrecidos.join(" ")}` : ""}.`,
        );
      }
    }
    l.modelo = l.modelo.toLowerCase();
    if (l.esfuerzoFlag) corta(pa, 2, `pa: --effort no va con '${l.modelo}': en agy el effort es parte del nombre (…-low, …-medium, …-high).`);
    sacarEffort();
    noVan(l, pa, l.modelo, "agy");
    if (l.maxBudget) corta(pa, 2, `pa: --max-budget-usd no va con '${l.modelo}' (agy se paga con el cupo, no en US$).`);
    politica();
    if (!env.PA_ASYNC) {
      const motivo = l.chequeado === l.modelo ? "" : await deps.motores.chequearGemini(l.modelo, l);
      if (!motivo) l.motor = "agy";
      else if (l.vinoDeReparto || l.sustituidoDe || l.politica.sinCupo === "otro") {
        const [m, e] = geminiEquivalente(l.modelo);
        io.err(`pa: ${l.modelo} → ${m} effort ${e}: ${motivo}.\n`);
        l.geminiPedido = l.modelo;
        l.modelo = m;
        ponerEffort(e);
      } else
        corta(pa, 96, `pa: ${l.modelo} no está disponible (${motivo}) y modelos.json dice sin_cupo=${l.politica.sinCupo}: no caigo a Claude. Esperar no lo arregla.`);
    } else l.motor = "agy";
  }
  if (l.lanza && esCodex(l.modelo)) {
    if (!calza(CODEX_MODELOS, l.modelo.toLowerCase()))
      corta(pa, 2, `pa: modelo '${l.modelo}' no va. Modelos de codex en pa: codex:{gpt-6.1-sol,gpt-6-sol,gpt-6-luna,gpt-6-astra}-{low,medium,high}.`);
    l.modelo = l.modelo.toLowerCase();
    if (l.esfuerzoFlag) corta(pa, 2, `pa: --effort no va con '${l.modelo}': en codex el effort es parte del nombre (…-low, …-medium, …-high).`);
    sacarEffort();
    noVan(l, pa, l.modelo, "codex");
    if (l.maxBudget) corta(pa, 2, `pa: --max-budget-usd no va con '${l.modelo}' (codex se paga con la suscripción de ChatGPT, no en US$).`);
    politica();
    if (!env.PA_ASYNC) {
      const motivo = l.chequeado === l.modelo ? "" : await deps.motores.chequearCodex(l.modelo, l);
      if (!motivo) l.motor = "codex";
      else if (l.vinoDeReparto || l.politica.sinCupo === "otro") {
        const [m, e] = codexEquivalente(l.modelo);
        io.err(`pa: ${l.modelo} → ${m} effort ${e}: ${motivo}.\n`);
        l.geminiPedido = l.modelo;
        l.modelo = m;
        ponerEffort(e);
      } else
        corta(pa, 96, `pa: ${l.modelo} no está disponible (${motivo}) y modelos.json dice sin_cupo=${l.politica.sinCupo}: no caigo a Claude. Esperar no lo arregla.`);
    } else l.motor = "codex";
  }
  if (l.lanza && esDsh(l.modelo)) {
    let eng = "dsh";
    const resto = l.modelo.slice(l.modelo.indexOf(":") + 1);
    if (esOpencode(l.modelo)) {
      eng = "opencode";
      l.modelo = `opencode:${resto}`;
      if (!calza(OC_MODELOS, l.modelo))
        corta(
          pa,
          2,
          `pa: modelo '${l.modelo}' no va. Los de opencode son opencode:<proveedor>/<modelo> (ej. opencode:opencode/deepseek-v4.1-flash-free; la lista sale de \`opencode models\`).`,
        );
    } else {
      const prov = resto.includes("/") ? resto.slice(0, resto.indexOf("/")) : resto;
      const mod = resto.includes("/") ? resto.slice(resto.indexOf("/") + 1) : resto;
      l.modelo = `dsh:${prov.replace(/[A-Z]/g, (c) => c.toLowerCase())}/${mod}`;
      if (!calza(DSH_MODELOS, l.modelo))
        corta(
          pa,
          2,
          `pa: modelo '${l.modelo}' no va. Los de dsh son dsh:<ollama|opencode|deepseek>/<modelo> (ej. dsh:ollama/qwen3-coder:30b); los gratis de OpenCode van con opencode:opencode/<modelo>.`,
        );
    }
    if (esOpencode(l.modelo)) l.ocEffort = l.esfuerzo;
    else {
      if (l.esfuerzoFlag) corta(pa, 2, `pa: --effort no va con '${l.modelo}': ${eng} no tiene effort.`);
      sacarEffort();
    }
    noVan(l, pa, l.modelo, eng, true);
    if (l.maxBudget) corta(pa, 2, `pa: --max-budget-usd no va con '${l.modelo}' (${eng} no mide el gasto en US$).`);
    if (l.cuenta && !esOpencode(l.modelo)) corta(pa, 2, `pa: --cuenta no va con '${l.modelo}': ${eng} no usa ninguna suscripción de pa.`);
    if (!env.PA_ASYNC) {
      const motivo = l.chequeado === l.modelo.toLowerCase() ? "" : await deps.motores.chequearDsh(l.modelo, l);
      if (!motivo) l.motor = "dsh";
      else if (l.vinoDeReparto && deps.claudeEnPath()) {
        io.err(`pa: ${l.modelo} → claude-sonnet-5-5 effort high: ${motivo}.\n`);
        l.geminiPedido = l.modelo;
        l.modelo = "claude-sonnet-5-5";
        ponerEffort("high");
      } else corta(pa, 95, `pa: no lanzo '${l.modelo}': ${motivo}.`);
    } else l.motor = "dsh";
  }
  // La cuenta de Claude (o ninguna, para un local). Si agy cayó al equivalente Claude, la --cuenta pedida era de Google.
  if (l.lanza && l.motor !== "agy") {
    if (l.geminiPedido && l.cuenta) {
      io.err(`pa: la cuenta ${l.cuenta} es de agy y caí a ${l.modelo}: uso una cuenta de Claude.\n`);
      l.cuenta = "";
    }
    await cuentaResolver(proveedorDe(l.modelo, true), l, pa, deps);
  }
  if (l.cuentaUsada && !["claude", "google", "chatgpt", "opencode"].includes(l.cuentaUsada)) io.err(`pa: cuenta ${l.cuentaUsada}.\n`);
  if (l.lanza && esLocal(l.modelo)) {
    if (!/^[Oo][Ll][Ll][Aa][Mm][Aa]:\S+$/.test(l.modelo)) corta(pa, 2, `pa: modelo '${l.modelo}' no va: un local es ollama:<modelo> (ej. ollama:qwen3-coder:30b).`);
    l.modelo = `ollama:${l.modelo.slice(l.modelo.indexOf(":") + 1)}`;
    if (l.esfuerzoFlag) corta(pa, 2, `pa: --effort no va con '${l.modelo}': un modelo local no tiene effort.`);
    if (l.maxBudget) corta(pa, 2, `pa: --max-budget-usd no va con '${l.modelo}' (un local no se paga en US$).`);
    sacarEffort();
    const loc = localDe(l.modelo, pa, modelos);
    l.localUrl = loc.url;
    l.localModelo = loc.modelo;
    if (!env.PA_ASYNC) {
      const est = await deps.motores.estadoLocal(l.localUrl, l.localModelo);
      if (est !== "ok") corta(pa, 95, `pa: no lanzo '${l.modelo}': ${est}. Levantá el servidor (ollama serve) o elegí otro modelo con -m.`);
    }
    l.motor = "ollama";
  }
  if (l.motor !== "claude") l.efVacio = "-";

  // --- lo que el dueño no deja sin --ok-dueno: excluidos (98), fable y max (2) ---
  const ojoEnv = env.PA_EFFORT ? " (ojo: puede venir de PA_EFFORT)" : "";
  const ef = l.esfuerzo.toLowerCase();
  if (l.lanza) politica();
  if (l.lanza && !l.okDueno) {
    const m = l.modelo.toLowerCase();
    const conOk = conDueno("Si @DUENO@ aprobó esta corrida, repetila con --ok-dueno", env, pa.home);
    const excl = l.modeloDeM && !env.PA_ASYNC ? modelos.excluidoPor(l.modelo) : null;
    if (excl !== null)
      corta(pa, 98, `pa: modelo '${l.modelo}' está excluido en modelos.json (excluir: ${excl}). ${conOk}; si no, elegí otro con -m o sacalo de excluir.`);
    if (m.includes("fable"))
      corta(
        pa,
        2,
        `pa: modelo '${l.modelo}' no va sin --ok-dueno: Fable en \`-p\` cobra créditos sin preguntar y usa hasta la mitad del límite semanal. ${conOk}; si no, para frontend/diseño o algo difícil: -m claude-opus-5-5 --effort xhigh.`,
      );
    else if (ef === "max" && !m.includes("haiku") && !l.politica.permitirMax) {
      if (m.includes("opus"))
        corta(pa, 2, `pa: effort 'max' con opus no va sin --ok-dueno: rinde 1,5 puntos más por 65 % más de costo. ${conOk}; si no, usá low, medium, high o xhigh${ojoEnv}.`);
      corta(pa, 2, `pa: effort 'max' con '${l.modelo}' no va sin --ok-dueno (sin flag, max sólo con claude-haiku-5-5). ${conOk}; si no, usá low, medium, high o xhigh${ojoEnv}.`);
    }
  }
  // Defaults sin --effort: haiku xhigh, sonnet high; opus: plan pro medium, --leer high, plan max el de settings si es medium|high|xhigh.
  l.esfPedido = !!l.esfuerzo;
  if (!l.esfuerzo && l.motor === "claude") {
    const m = l.modelo.toLowerCase();
    if (m.includes("haiku")) l.esfuerzo = "xhigh";
    else if (m.includes("sonnet")) l.esfuerzo = "high";
    else if (pa.plan === "pro") l.esfuerzo = "medium";
    else if (l.leer) l.esfuerzo = "high";
    else if (m.includes("opus") && !["", "medium", "high", "xhigh"].includes(effortDeSettings(pa).toLowerCase())) l.esfuerzo = "high";
  }
  // efforts_permitidos: un effort pedido que el dueño apagó no corre sin --ok-dueno (98); el default se corre al primero permitido.
  if (l.lanza && l.motor === "claude" && !esLocal(l.modelo)) {
    const ok = modelos.effortsPermitidosDe(l.modelo);
    if (ok !== null && !l.okDueno) {
      const siOk = conDueno("si @DUENO@ aprobó esta corrida, repetila con --ok-dueno", env, pa.home);
      if (l.esfPedido) {
        if (!ok.includes(l.esfuerzo.toLowerCase()))
          corta(
            pa,
            98,
            `pa: effort '${l.esfuerzo}' con '${l.modelo}' está apagado en modelos.json (efforts_permitidos: ${ok.length ? ok.join(", ") : "ninguno"}). Usá uno de esos con --effort, o ${siOk}.${ojoEnv}`,
          );
      } else if (!ok.length)
        corta(pa, 98, `pa: modelos.json (efforts_permitidos) no deja ningún effort a '${l.modelo}': no lo lanzo. Prendé alguno en Ajustes > Modelos, o ${siOk}.`);
      else if (!ok.includes(l.esfuerzo.toLowerCase())) {
        io.err(
          `pa: sin --effort, uso ${ok[0]} con '${l.modelo}' (el primero que deja efforts_permitidos de modelos.json; el de siempre, ${l.esfuerzo || "ninguno"}, está apagado).\n`,
        );
        l.esfuerzo = ok[0]!;
      }
    }
  }
  return l;
}

// ------------------------------------------------------------------------------------------- la tabla de reparto

const tablas = new WeakMap<DepsPolitica, Promise<string>>();
/** `reparto --tabla --json`, una sola consulta por llamada (TABLA_JSON). */
export function tablaReparto(deps: DepsPolitica): Promise<string> {
  let t = tablas.get(deps);
  if (!t) {
    t = deps.reparto.ejecutable() ? deps.reparto.tabla() : Promise.resolve("");
    tablas.set(deps, t);
  }
  return t;
}

type FilaTabla = { id?: unknown; agotado?: unknown; cupo_libre?: unknown; vuelve?: unknown; calidad?: unknown };
const filasDe = (tabla: string, id: string): FilaTabla[] => {
  const m = json(tabla)?.modelos;
  return Array.isArray(m) ? (m as FilaTabla[]).filter((f) => f && f.id === id) : [];
};

/** null si el modelo tiene cupo o no está en la tabla; si ninguna de sus cuentas tiene cupo, cuándo vuelve ("" si no se sabe). */
export function sinCupoHasta(tabla: string, id: string): string | null {
  const fs = filasDe(tabla, id);
  if (!fs.length) return null;
  const libre = (f: FilaTabla) =>
    (f.agotado === null || f.agotado === undefined || f.agotado === false) &&
    (f.cupo_libre === null || f.cupo_libre === undefined || (typeof f.cupo_libre === "number" && f.cupo_libre >= 0.03));
  if (fs.some(libre)) return null;
  const v = fs.map((f) => f.vuelve).filter((x) => x !== null && x !== undefined && x !== false);
  // jq ordena los números antes que los textos, y `"sin " + número` falla: sin aviso.
  if (v.some((x) => typeof x !== "string")) return null;
  return (v as string[]).sort()[0] ?? "";
}

/** `calidad_de_modelo`: la inteligencia del modelo según la tabla ("" si no se sabe). */
export async function calidadDeModelo(deps: DepsPolitica, id: string): Promise<string> {
  if (!id) return "";
  const t = await tablaReparto(deps);
  if (!t) return "";
  const c = filasDe(t, id)[0]?.calidad;
  return c === null || c === undefined || c === false ? "" : typeof c === "string" ? c : JSON.stringify(c);
}

/** `modelo_flojo`: la calidad si es menor que PA_CALIDAD_BAJA (46), o null. */
export async function modeloFlojo(pa: Pa, deps: DepsPolitica, id: string): Promise<string | null> {
  const c = await calidadDeModelo(deps, id);
  if (!/^[0-9]+([.][0-9]+)?$/.test(c)) return null;
  const u = Number(pa.env.PA_CALIDAD_BAJA || "46") || 0;
  return Number(c) < u ? c : null;
}
