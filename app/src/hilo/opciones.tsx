// Lo que ofrecen los selectores de modelo y esfuerzo (Vista y Nueva tarea).
// Se ofrece todo (directiva 3): `pa` rechaza lo que no va y la app muestra su
// mensaje. "default" es la tabla de routing de ~/CLAUDE.md para un worker que
// escribe código. `clave` es lo que se busca en el id de modelo de un hilo.
import { useSyncExternalStore } from "react";
import { t, type ClaveSola } from "../i18n";
import type { Opcion } from "./Selector";
import { GENERAL, type Lider } from "../datos/contrato";
import { defDe, effortDeModelo, effortsDe, EMPRESAS, type Empresa, partirGeminiId, ponerConfig, porClave, TABLA, type ConfigModelos, type ModeloDef } from "./modelos";
import { Logo } from "./Logos";
import { marcaConexion } from "./conectar";

// La descripción se dice al leerla: cambia con el idioma sin rearmar las listas.
// (Un spread `{ ...o }` copia el texto del momento: hacerlo al pintar.)
const desc = <T extends object>(o: T, clave: ClaveSola) =>
  Object.defineProperty(o, "desc", { get: () => t(clave), enumerable: true }) as T & { desc: string };

/** El orden de las columnas del menú en columnas: Anthropic, Google, OpenAI, OpenCode, DeepSeek Harness y, al final, lo que corre en esta máquina. */
const ORDEN_COL: Record<Empresa, number> = { anthropic: 0, google: 1, openai: 2, opencode: 3, dsh: 4, local: 5, ollama: 5 };

/** La columna de un modelo en el menú en columnas: una por empresa, salvo los locales (llama-server y Ollama), que van juntos en "Local". */
const columnaDe = (m: ModeloDef) => {
  const local = m.empresa === "local" || m.empresa === "ollama";
  const e: Empresa = local ? "local" : m.empresa;
  return { col: e, colNombre: EMPRESAS[e], colMarca: <Logo empresa={e} />, colOrden: ORDEN_COL[m.empresa] };
};

/** Cada modelo, bajo el divisor de su empresa y con su logo delante; los locales, además, con el chip de la GPU (`local`). */
const opcionDe = (m: ModeloDef) =>
  desc(
    {
      id: m.id,
      clave: m.clave,
      nombre: m.nombre,
      grupo: m.empresaNombre ?? EMPRESAS[m.empresa],
      marca: <Logo empresa={m.empresa} />,
      ...columnaDe(m),
      ...(m.rec ? { rec: true } : {}),
      ...(m.local ? { local: true } : {}),
      ...(m.gratis ? { gratis: true } : {}),
      ...(m.go ? { go: true } : {}),
      // Las generaciones anteriores arrancan plegadas bajo «Anteriores».
      ...(m.anterior ? { plegado: true } : {}),
      // Su proveedor no está conectado: atenuado, con «Sin conectar», y elegirlo ofrece «Conectar» (abre Ajustes en ese proveedor) en vez de cambiar el modelo.
      ...marcaConexion(m),
      // DeepSeek Harness con la API de DeepSeek: tu clave, se paga por uso (los de Ollama de dsh corren acá y no cuestan).
      ...(m.id.startsWith("dsh:deepseek/") ? { pago: true } : {}),
    },
    m.desc,
  );
/** Las generaciones anteriores llevan el divisor «Anteriores» (se dice al leerlo, por el idioma): sólo en el menú, el modelo sigue siendo de su empresa (`col`). */
const conDivisor = (o: ReturnType<typeof opcionDe>, m: ModeloDef) => (m.anterior ? Object.defineProperty(o, "grupo", { get: () => t("modelo.anteriores"), enumerable: true }) : o);
/** Una fila de relleno (Local sin ningún modelo) dice su nombre en el idioma de ahora. */
const conNombre = (o: ReturnType<typeof opcionDe>, m: ModeloDef) => (m.relleno ? Object.defineProperty(o, "nombre", { get: () => t(m.relleno!), enumerable: true }) : o);
const filaDe = (m: ModeloDef) => conNombre(conDivisor(opcionDe(m), m), m);
export const MODELOS: (Opcion & { clave: string })[] = TABLA.map(filaDe);

/** Los modelos de un worker de `pa` (`-m`): los mismos, sin los que sólo corren en un líder (los locales, Gemini, Ollama). */
export const MODELOS_WORKER: (Opcion & { clave: string })[] = MODELOS.filter((m) => !defDe(m.id)?.local && !defDe(m.id)?.soloLider && !defDe(m.id)?.relleno);

/** Lo que identifica a la tabla de hoy (ids, nombres, niveles, cuál es el default): si no cambia, un refresco no repinta nada. */
const firmaTabla = () => JSON.stringify([MODELO_DEFAULT, TABLA.map((m) => [m.id, m.nombre, m.rec === true, m.anterior === true, m.efforts, m.effortDefecto, m.sinConectar === true])]);
let firma = "";
let version = 0;
const oyentes = new Set<() => void>();

/** Se llama cuando cambia la tabla de modelos (catálogo de Claude, Ajustes, un proveedor que aparece): los selectores abiertos se repintan solos. */
export const alCambiarModelos = (f: () => void) => {
  oyentes.add(f);
  return () => void oyentes.delete(f);
};
const versionModelos = () => version;

/** Un número que sube cada vez que cambia la tabla de modelos: va en las dependencias de lo que se arma con `MODELOS` y repinta al componente que lo usa. */
export const useModelosVivos = (): number => useSyncExternalStore(alCambiarModelos, versionModelos, versionModelos);

/**
 * `modelos.json` (src/datos/modelos-config.ts): las filas de Gemini y de Ollama que pide, y el líder por defecto. Cambia los arreglos
 * en su lugar (quien los importó los sigue viendo) y se llama al arrancar y cada vez que `modelos-vivos.ts` vuelve a leer la config
 * (al enfocar la ventana, al guardar Ajustes, cada tanto). Si lo que ofrece cambió, avisa a los selectores (`useModelosVivos`).
 * Sin el archivo no cambia nada.
 */
export function aplicarModelos(c: ConfigModelos | null) {
  const lider = ponerConfig(c);
  MODELOS.splice(0, MODELOS.length, ...TABLA.map(filaDe));
  MODELOS_WORKER.splice(0, MODELOS_WORKER.length, ...MODELOS.filter((m) => !defDe(m.id)?.local && !defDe(m.id)?.soloLider && !defDe(m.id)?.relleno));
  MODELO_DEFAULT = lider?.modelo ?? "claude-opus-5-5";
  const nueva = firmaTabla();
  if (nueva === firma) return;
  const habia = firma !== "";
  firma = nueva;
  // La primera vez (arranque) todavía no hay nadie mirando.
  if (!habia) return;
  version++;
  for (const f of [...oyentes]) f();
}

/**
 * El modelo vigente para uno que se eligió antes: si ya no está en la tabla, o es de una generación anterior (Fable 5.1 cuando la
 * cuenta ya tiene 5.2), el primero vigente de su familia; si no hay otro, el default de siempre. Un modelo vigente se queda como está.
 */
export function modeloVigente(id: string): string {
  const def = defDe(id);
  if (def && !def.anterior) return def.id;
  if (id.startsWith("claude-")) {
    const familia = (x: string) => /^claude-[a-z]+/.exec(x)?.[0];
    const nuevo = TABLA.find((m) => m.empresa === "anthropic" && !m.anterior && familia(m.id) === familia(id));
    if (nuevo) return nuevo.id;
  }
  return def?.anterior ? def.id : MODELO_DEFAULT;
}

const Nivel = ({ n }: { n: number }) => (
  <span className="nivel" aria-hidden="true">
    {[1, 2, 3, 4].map((k) => (
      <i key={k} data-on={k <= n ? "" : undefined} />
    ))}
  </span>
);

const DESC_EFFORT: Record<string, ClaveSola> = {
  off: "effort.off",
  low: "effort.low",
  medium: "effort.medium",
  high: "effort.high",
  xhigh: "effort.xhigh",
  max: "effort.max",
};

/**
 * Los niveles de esfuerzo de un modelo (src/hilo/modelos.ts): los suyos y en su orden, con las barritas según el
 * lugar que ocupa cada uno en su lista. El de arranque del modelo lleva la marca de default.
 */
export function effortsOpciones(modelo: string | null | undefined): Opcion[] {
  const def = defDe(modelo);
  return effortsDe(modelo).map((id, i) => desc({ id, nombre: id, marca: <Nivel n={i} />, ...((def?.effortDefecto ?? "high") === id ? { rec: true } : {}) }, DESC_EFFORT[id] ?? "effort.otro"));
}

export let MODELO_DEFAULT = "claude-opus-5-5";

/** El id del selector para el modelo de un hilo ("claude-sonnet-5-5[1m]" → Sonnet). */
export const modeloDe = (m: string | null | undefined) => {
  if (!m) return null;
  const base = partirGeminiId(m)[0];
  const prefijo = /^(?:ollama|agy|dsh|codex):/.exec(m)?.[0];
  return (
    (
      MODELOS.find((x) => x.id === m || x.id === base) ??
      porClave(
        MODELOS.filter((x) => (prefijo ? x.id.startsWith(prefijo) : !/^(?:ollama|agy|dsh|codex):/.test(x.id))),
        m,
      )
    )?.id ?? null
  );
};

/** El esfuerzo si es un nivel del modelo (sin modelo, de cualquiera); si no, `null`. */
export const effortDe = (e: string | null | undefined, modelo?: string | null) =>
  modelo ? effortDeModelo(modelo, e) : (Object.keys(DESC_EFFORT).find((x) => x === e) ?? null);

export const nombreModelo = (id: string) => MODELOS.find((m) => m.id === id)?.nombre ?? id;

/** Un líder recién lanzado, hasta que el statusline lo lista. */
export function fantasma(sid: string, e: { modelo: string; effort: string; modo?: string; texto?: string; maquina?: string }, proyecto: string = GENERAL): Lider {
  const ahora = Math.floor(Date.now() / 1000);
  return {
    id: sid,
    // Como lo nombra el main (B20): la primera línea de su primer mensaje.
    nombre: primeraLinea(e.texto ?? ""),
    proyecto,
    titulo: nombreModelo(e.modelo),
    actividad: ahora,
    creado: ahora,
    cache_ttl_s: null,
    cache_vence: 0,
    origen: "app",
    pid: null,
    vivo: true,
    ocupado: true,
    modelo: e.modelo,
    effort: e.effort,
    modo: e.modo,
    ...(e.maquina ? { maquina: e.maquina } : {}),
  };
}

/** Lo primero que dice un texto, en una línea (el título de un líder sin otro). */
export const primeraLinea = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .find((x) => x !== "")
    ?.replace(/\s+/g, " ") ?? "";
