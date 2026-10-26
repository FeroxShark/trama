// La cuenta de cuántas veces Trama destrabó a un modelo que se repetía y si el turno terminó bien después (para ver si
// sirve). Un renglón JSON por hecho en `$HILOS_STATE/destrabos.jsonl`: al detectar `{id, t, modelo, que}`, al cerrar el
// turno `{id, resultado}`. Sólo se agrega al final (varios puentes escriben a la vez sin pisarse). Node puro.
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { ESTADO } from "./estado.ts";

export type Resultado = "bien" | "mal" | "cortado";

/** Lo que muestra Ajustes: cuántas veces, cuántas terminaron bien, mal (volvió a trabarse o falló) o las cortó la persona. */
export type CuentaDestrabos = { veces: number; bien: number; mal: number; cortado: number; pendiente: number };

export const rutaDestrabos = () => path.join(process.env.HILOS_STATE ?? ESTADO, "destrabos.jsonl");

const TOPE_LEER = 4 * 1024 * 1024;

function anotar(o: Record<string, unknown>, ruta = rutaDestrabos()): void {
  try {
    appendFileSync(ruta, JSON.stringify({ v: 1, ...o }) + "\n");
  } catch {
    /* sin registro la cuenta queda corta; destrabar sigue */
  }
}

/** Anota que se destrabó; devuelve el id para cerrarlo cuando termine el turno. */
export function registrarDestrabo(modelo: string, que: string, id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ruta = rutaDestrabos()): string {
  anotar({ id, t: Date.now(), modelo, que: que.slice(0, 80) }, ruta);
  return id;
}

export function cerrarDestrabo(id: string, resultado: Resultado, ruta = rutaDestrabos()): void {
  anotar({ id, resultado }, ruta);
}

/** La cuenta de un archivo de registro; sin archivo o roto, todo en cero. */
export function leerDestrabos(ruta = rutaDestrabos()): CuentaDestrabos {
  let texto = "";
  try {
    texto = readFileSync(ruta, "utf8");
    if (texto.length > TOPE_LEER) texto = texto.slice(-TOPE_LEER);
  } catch {
    return { veces: 0, bien: 0, mal: 0, cortado: 0, pendiente: 0 };
  }
  const por = new Map<string, Resultado | null>();
  for (const l of texto.split("\n")) {
    if (!l) continue;
    try {
      const o = JSON.parse(l);
      if (typeof o?.id !== "string") continue;
      if (typeof o.modelo === "string" && !por.has(o.id)) por.set(o.id, null);
      if (o.resultado === "bien" || o.resultado === "mal" || o.resultado === "cortado") por.set(o.id, o.resultado);
    } catch {
      /* línea cortada */
    }
  }
  const c: CuentaDestrabos = { veces: por.size, bien: 0, mal: 0, cortado: 0, pendiente: 0 };
  for (const r of por.values()) {
    if (r === null) c.pendiente++;
    else c[r]++;
  }
  return c;
}
