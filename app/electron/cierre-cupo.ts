// Cierre ordenado cuando se acaba el cupo: el vigilante. Puro (sin disco, sin reloj, sin Electron): recibe el uso de cada
// suscripción y ventana, decide cuáles cruzaron el umbral y arma la señal que va a disco. Lo de afuera (leer el uso,
// escribir `$PA_STATE/cierre-cupo.json`, avisar) está en electron/cierre-cupo-disco.ts. Lo prueba tests/cierre-cupo.test.ts.
//
// La señal (`$PA_STATE/cierre-cupo.json`) es la ÚNICA fuente que leen el hook, `pa`/`reparto` y la interfaz:
//
//   {
//     "version": 1,
//     "ts": 1763240000,               // epoch s de la última escritura
//     "retomar_solo": false,          // Ajustes > cierre.retomar_solo: al volver el cupo, retomar solo lo que se cerró
//     "entradas": [
//       { "proveedor": "claude", "cuenta": "claude", "ventana": "5h", "restante": 4, "umbral": 5, "vuelve": 1763250000, "desde": 1763240000 },
//       { "proveedor": "google", "cuenta": "google", "ventana": "7d", "grupo": "gemini-pro", "restante": 3, "umbral": 5, "vuelve": 1763800000, "desde": 1763241000 }
//     ]
//   }
//
// - `proveedor`: la suscripción (`claude`, `google`, `chatgpt`; ver `suscripcionDeModelo`). `cuenta`: la cuenta (la de siempre se
//   llama como el proveedor; una agregada de Claude, su id). `ventana`: `5h` o `7d` (u otro id que diga `reparto`).
// - `grupo`: sólo Google, el grupo de modelos de `agy` cuya ventana se acaba. Quien no sepa a qué grupo va un modelo trata la
//   entrada como de toda la suscripción.
// - `restante`: % que queda (0..100, entero); `umbral`: el de Ajustes cuando se disparó; `vuelve`: epoch s del reinicio de la
//   ventana (`null`: no se sabe); `desde`: epoch s en que se cruzó el umbral.
// - Una entrada vive desde que se cruza el umbral hasta que pasa `vuelve` (se borra al reset). Sin entradas el archivo no
//   existe: archivo ausente = nada se cierra. Una entrada se dispara UNA vez por ventana (proveedor+cuenta+ventana+vuelve).
// - Se escribe atómico (temporal + rename): quien lo lee nunca ve un archivo a medias.

import { proveedorDe } from "./avisos-worker.ts";

export const VERSION_CIERRE = 1;
export const ARCHIVO_CIERRE = "cierre-cupo.json";

/** Las suscripciones con cupo que se acaba. OpenCode, Ollama y los demás no tienen: nunca se cierran. */
export type Suscripcion = "claude" | "google" | "chatgpt";
export const SUSCRIPCIONES: readonly Suscripcion[] = ["claude", "google", "chatgpt"];

import { CIERRE_DEFECTO, umbralCierreValido, type AjustesCierre } from "./valida-ajustes.ts";
export { CIERRE_DEFECTO, UMBRAL_CIERRE_MAX, UMBRAL_CIERRE_MIN, type AjustesCierre } from "./valida-ajustes.ts";

/**
 * De qué suscripción sale el cupo de un modelo (como lo escriben `pa -m` y los líderes): `claude-*` oficial → `claude`;
 * `agy:*` y `gemini-*` → `google`; `codex:*` y `gpt*` → `chatgpt`; OpenCode, `dsh:`, Ollama y lo demás → `null` (sin cupo).
 */
export function suscripcionDeModelo(modelo: string | null | undefined): Suscripcion | null {
  const id = proveedorDe(modelo).id;
  return id === "claude" || id === "google" || id === "chatgpt" ? id : null;
}

/** Lo que se sabe del uso de una ventana: `usado` 0..100 (`null`: sin dato), `vuelve` epoch s. */
export type LecturaCupo = { proveedor: Suscripcion; cuenta: string; ventana: string; grupo?: string; usado: number | null; vuelve: number | null };

/** Una entrada de la señal (ver arriba). */
export type EntradaCierre = { proveedor: Suscripcion; cuenta: string; ventana: string; grupo?: string; restante: number; umbral: number; vuelve: number | null; desde: number };
export type SenalCierre = { version: 1; ts: number; retomar_solo: boolean; entradas: EntradaCierre[] };

type VentanaMin = { id: string; pct: number | null; vuelve: number | null; deshabilitada?: boolean };
/** Lo que se usa del uso que arma statusline.ts (`Uso`): las dos ventanas de la cuenta de siempre de Claude y las demás suscripciones. */
export type UsoMin = {
  five_hour?: { pct: number; resets_at: number | null } | null;
  seven_day?: { pct: number; resets_at: number | null } | null;
  suscripciones?: { id: string; proveedor?: string; cuenta?: string; ventanas?: VentanaMin[]; grupos?: { id: string; ventanas: VentanaMin[] }[] }[];
};

const esSuscripcion = (x: unknown): x is Suscripcion => (SUSCRIPCIONES as readonly unknown[]).includes(x);

/** Las lecturas de cada ventana con cupo del uso de la cabecera. Las ventanas deshabilitadas (no rigen) no cuentan. */
export function lecturasDeUso(uso: UsoMin | null | undefined): LecturaCupo[] {
  if (!uso) return [];
  const out: LecturaCupo[] = [];
  if (uso.five_hour) out.push({ proveedor: "claude", cuenta: "claude", ventana: "5h", usado: uso.five_hour.pct, vuelve: uso.five_hour.resets_at });
  if (uso.seven_day) out.push({ proveedor: "claude", cuenta: "claude", ventana: "7d", usado: uso.seven_day.pct, vuelve: uso.seven_day.resets_at });
  for (const s of uso.suscripciones ?? []) {
    const p = s.proveedor ?? s.id;
    if (!esSuscripcion(p)) continue;
    const cuenta = s.cuenta || p;
    for (const v of s.ventanas ?? []) if (!v.deshabilitada) out.push({ proveedor: p, cuenta, ventana: v.id, usado: v.pct, vuelve: v.vuelve });
    for (const g of s.grupos ?? []) for (const v of g.ventanas) if (!v.deshabilitada) out.push({ proveedor: p, cuenta, ventana: v.id, grupo: g.id, usado: v.pct, vuelve: v.vuelve });
  }
  return out;
}

/** Dos horas de reinicio a menos de esto son la misma ventana (cada lectura redondea distinto). */
export const MISMA_VENTANA_S = 900;

const base = (x: { proveedor: string; cuenta: string; ventana: string; grupo?: string }) => `${x.proveedor}|${x.cuenta}|${x.ventana}|${x.grupo ?? ""}`;
const mismaVentana = (a: number | null, b: number | null) => a === null || b === null || Math.abs(a - b) <= MISMA_VENTANA_S;

export type Paso = {
  /** Las entradas vigentes (lo que va a disco). */
  entradas: EntradaCierre[];
  /** Las que se dispararon en este paso (una por ventana): el evento `alCierreCupo`. */
  nuevas: EntradaCierre[];
  /** Si la señal cambió (hay que escribir o borrar el archivo). */
  cambio: boolean;
};

/**
 * El vigilante: guarda las entradas disparadas y, con cada lectura, decide. `previas`: lo que había en disco (para no volver a
 * disparar lo mismo al reabrir Trama). Desactivado no dispara nada y suelta todo.
 */
export function crearVigilante(previas: EntradaCierre[] = []) {
  let vigentes = new Map(previas.map((e) => [base(e), e]));
  const huella = () => JSON.stringify([...vigentes.values()]);

  function paso(lecturas: LecturaCupo[], ajustes: AjustesCierre, ahora: number): Paso {
    const antes = huella();
    if (!ajustes.activo) {
      vigentes = new Map();
      return { entradas: [], nuevas: [], cambio: antes !== huella() };
    }
    // Se rearma al pasar el reinicio: la entrada de esa ventana se borra.
    for (const [k, e] of vigentes) if (e.vuelve !== null && e.vuelve <= ahora) vigentes.delete(k);
    const nuevas: EntradaCierre[] = [];
    for (const l of lecturas) {
      if (l.usado === null || !Number.isFinite(l.usado)) continue;
      if (l.vuelve !== null && l.vuelve <= ahora) continue; // de una ventana que ya pasó
      const restante = Math.max(0, Math.min(100, Math.round(100 - l.usado)));
      const k = base(l);
      const ya = vigentes.get(k);
      if (ya && mismaVentana(ya.vuelve, l.vuelve)) {
        // Misma ventana: no se vuelve a disparar; se actualiza lo que queda y, si ahora se sabe, cuándo vuelve.
        if (ya.vuelve === null && restante > ajustes.umbral) vigentes.delete(k); // sin reinicio conocido, se rearma cuando vuelve a haber cupo
        else vigentes.set(k, { ...ya, restante, vuelve: l.vuelve ?? ya.vuelve });
        continue;
      }
      if (restante > ajustes.umbral) continue;
      const e: EntradaCierre = { proveedor: l.proveedor, cuenta: l.cuenta, ventana: l.ventana, ...(l.grupo ? { grupo: l.grupo } : {}), restante, umbral: ajustes.umbral, vuelve: l.vuelve, desde: ahora };
      vigentes.set(k, e);
      nuevas.push(e);
    }
    return { entradas: [...vigentes.values()], nuevas, cambio: antes !== huella() };
  }

  return { paso, entradas: () => [...vigentes.values()] };
}

/** El texto del archivo de señal. */
export function senalDe(entradas: EntradaCierre[], ajustes: AjustesCierre, ahora: number): SenalCierre {
  return { version: VERSION_CIERRE, ts: ahora, retomar_solo: ajustes.retomar_solo, entradas };
}

/** Las entradas de un archivo de señal (lo que no se entiende se descarta). */
export function leerSenal(texto: string | null): EntradaCierre[] {
  if (!texto) return [];
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    return [];
  }
  const o = j as Partial<SenalCierre> | null;
  if (!o || o.version !== VERSION_CIERRE || !Array.isArray(o.entradas)) return [];
  const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  return o.entradas.filter(
    (e): e is EntradaCierre =>
      !!e && esSuscripcion(e.proveedor) && typeof e.cuenta === "string" && typeof e.ventana === "string" && num(e.restante) && num(e.umbral) && (e.vuelve === null || num(e.vuelve)) && num(e.desde) && (e.grupo === undefined || typeof e.grupo === "string"),
  );
}

/** `cierre` de modelos.json, con lo que falte o no valga de fábrica. */
export function ajustesCierreDe(x: unknown): AjustesCierre {
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  return {
    activo: typeof o.activo === "boolean" ? o.activo : CIERRE_DEFECTO.activo,
    umbral: umbralCierreValido(o.umbral) ? o.umbral : CIERRE_DEFECTO.umbral,
    retomar_solo: typeof o.retomar_solo === "boolean" ? o.retomar_solo : CIERRE_DEFECTO.retomar_solo,
  };
}
