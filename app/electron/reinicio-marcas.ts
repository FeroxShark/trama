// Cuánto tarda el reinicio por un build nuevo, paso por paso. Cada proceso que participa (el motor, la
// ventana que se va, la que llega, y la página) anota una marca en `$HILOS_STATE/reinicio-marcas` con la hora,
// quién, qué paso y el id de su corrida (la hora de su `inicio`), y la deja también en su log
// (`[reinicio] +1234 ms motor lideres-cerrados`). Cada etapa se mide desde el `inicio` de SU corrida, no desde la
// marca anterior. El archivo guarda las últimas `CORRIDAS` corridas, con sus marcas intercaladas por hora; el reinicio
// en marcha es la corrida más reciente, si es de hace menos de `VALE_MS` y todavía no llegó a `lista`.
// La misma marca le dice a la ventana que llega que viene de una actualización (muestra el cartel desde el primer
// cuadro: `src/actualizando.ts`) y, con `via`, si tiene que esperar al motor antes de decidir cómo arrancar.
// Puro (sólo `node:fs`, el log y el estado): lo prueba tests/reinicio-marcas.test.ts; lo lee scripts/medir-reinicio.mjs.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ESTADO } from "./estado.js";
import { log } from "./log.js";
import { anotar as anotarSalud } from "./salud-eventos.js";

export const MARCAS = path.join(ESTADO, "reinicio-marcas");
/** Un reinicio más viejo que esto no cuenta: es de otro día, no de la ventana que está arrancando. */
const VALE_MS = 2 * 60_000;
/** Cuántas corridas guarda el archivo: al empezar una nueva se tiran las más viejas. */
export const CORRIDAS = 30;

export type Quien = "motor" | "ventana" | "pagina";
/** `motor`: lo reinicia el motor (la ventana es su cliente y vuelve sola); `ventana`: todo en uno. */
export type Via = "motor" | "ventana";
export type Marca = { t: number; quien: string; pid: number; paso: string };
/** `t0` es el `inicio` de la corrida: también es su id, y cada marca de la corrida lo lleva. */
export type Corrida = { t0: number; via: Via; marcas: Marca[]; lista: boolean };

/** Una línea del archivo: `t id quien pid paso [extra]`. */
type Linea = Marca & { id: number; extra: string };

/** Las líneas con su id. Las de antes (`t quien pid paso [extra]`, sin id) son de la corrida que va abierta. */
function parsear(texto: string): Linea[] {
  const out: Linea[] = [];
  let abierta = 0;
  for (const linea of texto.split("\n")) {
    const f = linea.trim().split(/\s+/);
    const nueva = Number.isFinite(Number(f[1]));
    const t = Number(f[0]);
    const [quien, pid, paso, extra = ""] = nueva ? f.slice(2) : f.slice(1);
    if (!paso || !Number.isFinite(t)) continue;
    if (!nueva && paso === "inicio") abierta = t;
    out.push({ t, id: nueva ? Number(f[1]) : abierta, quien, pid: Number(pid) || 0, paso, extra });
  }
  return out;
}

/** Una corrida del archivo, con sus marcas (sólo las de su id). Sin `id`, la más reciente. */
export function analizar(texto: string, id?: number): Corrida | null {
  const lineas = parsear(texto);
  const inicios = lineas.filter((l) => l.paso === "inicio");
  const ini = id === undefined ? inicios.at(-1) : inicios.find((l) => l.t === id);
  if (!ini) return null;
  const propias = lineas.filter((l) => l.id === ini.t);
  return {
    t0: ini.t,
    via: ini.extra === "ventana" ? "ventana" : "motor",
    marcas: propias.map(({ t, quien, pid, paso }) => ({ t, quien, pid, paso })),
    lista: propias.some((l) => l.paso === "lista"),
  };
}

function leer(archivo: string): Corrida | null {
  try {
    return analizar(readFileSync(archivo, "utf8"));
  } catch {
    return null;
  }
}

/** El reinicio en marcha, si lo hay: empezó hace poco y todavía no llegó a `lista`. */
export function enMarcha(archivo = MARCAS, ahora = Date.now()): Corrida | null {
  const c = leer(archivo);
  return c && !c.lista && ahora - c.t0 < VALE_MS ? c : null;
}

function anotar(archivo: string, id: number, quien: string, paso: string, t: number, extra = "") {
  try {
    mkdirSync(path.dirname(archivo), { recursive: true });
    appendFileSync(archivo, `${t} ${id} ${quien} ${process.pid} ${paso}${extra ? ` ${extra}` : ""}\n`);
  } catch {
    // Medir no puede romper un reinicio.
  }
}

/** Deja sólo las últimas `CORRIDAS` (por su `inicio`); si hay menos, no reescribe nada. */
function recortar(archivo: string) {
  let lineas: Linea[];
  try {
    lineas = parsear(readFileSync(archivo, "utf8"));
  } catch {
    return;
  }
  const ids = [...new Set(lineas.filter((l) => l.paso === "inicio").map((l) => l.t))];
  if (ids.length <= CORRIDAS) return;
  const vivas = new Set(ids.slice(-CORRIDAS));
  const texto = lineas
    .filter((l) => vivas.has(l.id))
    .map((l) => `${l.t} ${l.id} ${l.quien} ${l.pid} ${l.paso}${l.extra ? ` ${l.extra}` : ""}\n`)
    .join("");
  try {
    writeFileSync(archivo, texto);
  } catch {
    // Medir no puede romper un reinicio.
  }
}

/** El reinicio deja de esperar y sale: empieza una corrida nueva (su `inicio` es su id) y se recortan las viejas. */
export function empezar(quien: Quien, via: Via, archivo = MARCAS, t = Date.now()) {
  anotar(archivo, t, quien, "inicio", t, via);
  recortar(archivo);
  log.escribir("info", "reinicio", `+0 ms ${quien} inicio (${via})`);
}

/**
 * Una marca de un reinicio en marcha; sin ninguno no hace nada. Va a la corrida en marcha (la más reciente).
 * Devuelve los ms desde su `inicio` (o `null`). `t` es la hora de verdad del paso si se sabe de antes (cuándo arrancó el proceso).
 */
export function marcar(quien: Quien, paso: string, archivo = MARCAS, t = Date.now()): number | null {
  const c = enMarcha(archivo, t);
  if (!c) return null;
  anotar(archivo, c.t0, quien, paso, t);
  const ms = t - c.t0;
  log.escribir("info", "reinicio", `+${ms} ms ${quien} ${paso}`);
  if (paso === "lista") anotarSalud({ tipo: "reinicio", ms });
  if (paso === "lista") log.escribir("info", "reinicio", resumen({ ...c, lista: true, marcas: [...c.marcas, { t, quien, pid: process.pid, paso }] }));
  return ms;
}

/** Una línea: cuánto tardó cada paso desde el `inicio` de SU corrida (no desde la marca anterior). */
export function resumen(c: Corrida): string {
  const total = c.marcas.at(-1)?.t ?? c.t0;
  return `reinicio completo en ${total - c.t0} ms: ${c.marcas.map((m) => `${m.paso} +${m.t - c.t0}`).join(", ")}`;
}
