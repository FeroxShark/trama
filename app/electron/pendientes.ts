// Lo que el usuario tocó en el tablero nuevo y todavía no mandó: `$HILOS_STATE/pendientes.json`. Por id de item,
// la opción que marcó o lo que escribió (preguntas) y Anda / No anda con su nota (pruebas). Sobrevive a un
// reinicio; al mandar, el renderer lo vacía de esos ids. Sin imports locales (la escritura atómica viene de
// nucleo.ts): lo prueba tests/pendientes-almacen.test.ts.
import { readFile } from "node:fs/promises";

const VERSION = 1;
/** Un campo libre más largo que esto se corta (lo que mande de más un cliente roto no llena el archivo). */
export const TEXTO_MAX = 2000;
/** Cuántos items se guardan como mucho. */
export const ITEMS_MAX = 500;

export type Tocado = {
  q: Record<string, { op: string; otra: string }>;
  p: Record<string, { res: "anda" | "no-anda"; nota: string }>;
};

const vacio = (): Tocado => ({ q: {}, p: {} });
const objeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
// Un item de este tablero (`12`) o de otro (`servidor:12`).
const id = (k: string) => /^(?:[a-z][a-z0-9-]{0,15}:)?\d{1,9}$/.test(k);
const texto = (x: unknown) => (typeof x === "string" ? x.slice(0, TEXTO_MAX) : "");

/** Lo guardado, mirado: lo que no se entiende no entra. Sólo cuenta lo contestado (una opción, o un texto en "otra"). */
export function limpiarTocado(x: unknown): Tocado {
  const r = vacio();
  if (!objeto(x)) return r;
  if (objeto(x.q))
    for (const [k, v] of Object.entries(x.q).slice(0, ITEMS_MAX)) {
      if (!id(k) || !objeto(v) || typeof v.op !== "string" || !v.op || v.op.length > 40) continue;
      const otra = texto(v.otra);
      if (v.op === "otra" && !otra.trim()) continue;
      r.q[k] = { op: v.op, otra };
    }
  if (objeto(x.p))
    for (const [k, v] of Object.entries(x.p).slice(0, ITEMS_MAX)) {
      if (!id(k) || !objeto(v) || (v.res !== "anda" && v.res !== "no-anda")) continue;
      r.p[k] = { res: v.res, nota: texto(v.nota) };
    }
  return r;
}

export function almacenPendientes(archivo: string, escribir: (archivo: string, texto: string) => Promise<void>) {
  let tocado: Tocado | null = null;

  async function leer(): Promise<Tocado> {
    if (tocado) return tocado;
    try {
      const j = JSON.parse(await readFile(archivo, "utf8"));
      tocado = j?.version === VERSION ? limpiarTocado(j) : vacio();
    } catch {
      tocado = vacio();
    }
    return tocado;
  }

  return {
    leer,
    /** Reemplaza todo lo tocado por lo que manda la ventana (o el celular: el último que escribe gana). */
    async guardar(x: unknown) {
      tocado = limpiarTocado(x);
      await escribir(archivo, JSON.stringify({ version: VERSION, ...tocado }));
    },
  };
}
