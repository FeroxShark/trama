// Qué muestra la fila de una suscripción en la cabecera, sin React: en qué columna cae cada ventana
// y cuál grupo manda cuando una suscripción trae varios (la fila plegada muestra el más usado).
// Genérico: no conoce a ningún proveedor; lo prueba `tests/cupos-vista.test.ts`.
import type { GrupoCupo, VentanaCupo } from "../datos/contrato";

/** La fila tiene dos columnas: 5 h y semana (`7d`). Una ventana con otro id ocupa el lugar que quede. */
export function columnas(ventanas: VentanaCupo[]): [VentanaCupo | null, VentanaCupo | null] {
  const cinco = ventanas.find((v) => v.id === "5h") ?? null;
  const siete = ventanas.find((v) => v.id === "7d") ?? null;
  const otras = ventanas.filter((v) => v !== cinco && v !== siete);
  return [cinco ?? otras.shift() ?? null, siete ?? otras.shift() ?? null];
}

/** Lo más lleno de un grupo (`-1`: ninguna ventana con dato). */
export const usoMaximo = (g: GrupoCupo): number => g.ventanas.reduce((m, v) => (v.pct !== null && v.pct > m ? v.pct : m), -1);

/** El grupo más usado; con empate (o sin ningún dato) el primero, el orden del reparto. */
export function masUsado(grupos: GrupoCupo[]): GrupoCupo {
  return grupos.reduce((a, g) => (usoMaximo(g) > usoMaximo(a) ? g : a));
}

// --- Qué le pasa a cada ventana, grupo y suscripción (lo comparten la barra y Ajustes > Plan y cupos) ---

/** Desde este % usado se dice «poco cupo» (la barra pasa a ámbar; el texto lo dice también, sin depender del color). */
export const USO_BAJO = 90;

export type EstadoVentana = "off" | "sin" | "lleno" | "bajo" | "ok";

/** `off`: no rige ahora; `sin`: sin dato; `lleno`: 100 %; `bajo`: desde `USO_BAJO`; `ok` el resto. */
export function estadoVentana(v: VentanaCupo): EstadoVentana {
  if (v.deshabilitada) return "off";
  if (v.pct === null) return "sin";
  return v.pct >= 100 ? "lleno" : v.pct >= USO_BAJO ? "bajo" : "ok";
}

/** `marcado`: `reparto` lo marcó sin cupo tras un 429 (no es una medida). */
export type EstadoGrupo = "ok" | "bajo" | "lleno" | "marcado" | "sin";

export interface ResumenCupo {
  estado: EstadoGrupo;
  /** Lo más lleno entre las ventanas que rigen (`null`: sin dato o marcado). */
  pct: number | null;
  /** Cuándo vuelve (epoch s) si está lleno o marcado; `null`: no se sabe, o no aplica. */
  vuelve: number | null;
  /** Sin porcentaje pero con pedidos contados (los gratis de OpenCode: sin tope publicado): cuántos van. */
  pedidos?: number;
}

/** Resumen de un conjunto de ventanas (una suscripción con ventanas propias, o un grupo). `agotado`: la marca de `reparto`. */
export function resumenVentanas(ventanas: readonly VentanaCupo[], agotado: number | undefined, ahoraS: number): ResumenCupo {
  if (agotado !== undefined && agotado > ahoraS) return { estado: "marcado", pct: null, vuelve: agotado };
  const rigen = ventanas.filter((v) => estadoVentana(v) !== "off");
  const llenas = rigen.filter((v) => estadoVentana(v) === "lleno");
  if (llenas.length) {
    // Vuelve cuando vuelve la última de las llenas (con la semana llena, la 5 h no cuenta).
    const horas = llenas.map((v) => v.vuelve);
    return { estado: "lleno", pct: 100, vuelve: horas.some((h) => h === null) ? null : Math.max(...(horas as number[])) };
  }
  const pcts = rigen.map((v) => v.pct).filter((p): p is number => p !== null);
  if (pcts.length === 0) {
    const contadas = rigen.filter((v) => v.pedidos !== undefined);
    return { estado: "sin", pct: null, vuelve: null, ...(contadas.length ? { pedidos: contadas.reduce((n, v) => n + (v.pedidos ?? 0), 0) } : {}) };
  }
  const pct = Math.max(...pcts);
  return { estado: pct >= USO_BAJO ? "bajo" : "ok", pct, vuelve: null };
}

export const resumenGrupo = (g: GrupoCupo, ahoraS: number): ResumenCupo => resumenVentanas(g.ventanas, g.agotado, ahoraS);

const PESO: Record<EstadoGrupo, number> = { sin: 0, ok: 1, bajo: 2, marcado: 3, lleno: 3 };

export interface ResumenSusc {
  /** `ok`, `bajo`, `sin` (nada con dato), `lleno` (todo agotado) o `parcial` (algún grupo agotado y otros no). */
  nivel: "ok" | "bajo" | "sin" | "lleno" | "parcial";
  /** Los grupos agotados (o marcados), con cuándo vuelven. */
  agotados: { id: string; vuelve: number | null; marcado: boolean }[];
  /** Cuándo vuelve lo primero que vuelve (epoch s), `null`: no se sabe. */
  vuelve: number | null;
}

/** El estado de toda una suscripción en una línea: sirve igual para ventanas propias (un grupo implícito) que para varios grupos. */
export function resumenSusc(s: { ventanas?: VentanaCupo[]; grupos?: GrupoCupo[]; agotado?: number }, ahoraS: number): ResumenSusc {
  const partes: { id: string; r: ResumenCupo }[] = s.grupos?.length
    ? s.grupos.map((g) => ({ id: g.id, r: resumenGrupo(g, ahoraS) }))
    : [{ id: "", r: resumenVentanas(s.ventanas ?? [], s.agotado, ahoraS) }];
  const agotados = partes.filter((p) => p.r.estado === "lleno" || p.r.estado === "marcado").map((p) => ({ id: p.id, vuelve: p.r.vuelve, marcado: p.r.estado === "marcado" }));
  const horas = agotados.map((a) => a.vuelve).filter((h): h is number => h !== null);
  const vuelve = horas.length ? Math.min(...horas) : null;
  if (agotados.length) return { nivel: agotados.length === partes.length ? "lleno" : "parcial", agotados, vuelve };
  const peor = partes.reduce((m, p) => (PESO[p.r.estado] > PESO[m] ? p.r.estado : m), "sin" as EstadoGrupo);
  return { nivel: peor === "bajo" ? "bajo" : peor === "ok" ? "ok" : "sin", agotados, vuelve: null };
}

/** Un chip por grupo (lo usa el panel del worker): lo más lleno que rige y cuándo vuelve si está agotado. */
export const chipsDe = (grupos: readonly GrupoCupo[], ahoraS: number) => grupos.map((g) => ({ g, r: resumenGrupo(g, ahoraS) }));

/**
 * Qué dibuja la barra de una suscripción con varios grupos (Google: Gemini, Claude/GPT, Argon…): un renglón por grupo, TAL COMO VENGA de `reparto`.
 * Nada de acá supone qué grupos hay ni qué ventanas tiene cada uno: `cols` son las dos columnas de siempre (5 h y semana; una ventana de otro id
 * ocupa la que quede libre), y un grupo sin ninguna ventana (Google le saca el tope) es `sinLimite`: se dibuja como tal, no como una fila vacía.
 */
export interface RenglonGrupo {
  g: GrupoCupo;
  r: ResumenCupo;
  cols: [VentanaCupo | null, VentanaCupo | null];
  /** El grupo no trae ventanas ni está marcado sin cupo: sin límite medido. */
  sinLimite: boolean;
}

export const renglonesDeGrupos = (grupos: readonly GrupoCupo[], ahoraS: number): RenglonGrupo[] =>
  grupos.map((g) => {
    const r = resumenGrupo(g, ahoraS);
    return { g, r, cols: columnas(g.ventanas), sinLimite: g.ventanas.length === 0 && r.estado !== "marcado" };
  });
