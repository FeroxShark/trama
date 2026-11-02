// Los cupos del riel (rediseño 0.4), sin React: la cuenta de Claude en uso (sus dos anillos) y las líneas del detalle que se abre
// al tocarlos: las otras cuentas de Claude y los otros motores. Nada de acá supone qué grupos hay: salen como vienen de `reparto`.
// Puro: lo prueba `tests/riel.test.ts`.
import type { Uso, VentanaCupo } from "../datos/contrato";
import { MARCA, type FilaSusc, type ListaCuentas } from "../datos/cuentas.ts";
import { columnas, estadoVentana, renglonesDeGrupos, resumenVentanas, type EstadoGrupo } from "./cuposVista.ts";
import { nombreGrupo, nombreGrupoCorto, nombreGrupoDetalle } from "./cuposNombres.ts";
import { filaDe } from "./usoFila.ts";

/** Una ventana de los anillos: `pct` null = sin dato; `hasta` en epoch s (0: no se sabe cuándo vuelve). */
export type VentanaRiel = { pct: number | null; hasta: number };

export type CuentaRiel = {
  /** El id de la cuenta (`claude`, la de siempre). */
  id: string;
  nombre: string;
  enUso: boolean;
  h5: VentanaRiel;
  sem: VentanaRiel;
  ts: number;
};

/** Desde este % usado el anillo y la barrita pasan a ámbar; el rojo es sólo cuando se acabó (100 %). */
export const AMBAR_DESDE = 80;

/** El color de un cupo: nada hasta el ámbar, `ambar` desde `AMBAR_DESDE` y `rojo` sólo sin cupo. Nunca solo: el texto lo dice igual. */
export const nivelCupo = (pct: number | null): "ambar" | "rojo" | undefined => (pct === null ? undefined : pct >= 100 ? "rojo" : pct >= AMBAR_DESDE ? "ambar" : undefined);

/** Cuándo vuelve lo más usado de las ventanas que rigen (epoch s); `null` si no se sabe o no se usó nada (con 0 % no hay nada que esperar). */
export function vueltaDe(ventanas: readonly VentanaCupo[]): number | null {
  const usadas = ventanas.filter((v) => estadoVentana(v) !== "off" && (v.pct ?? 0) > 0);
  if (!usadas.length) return null;
  const peor = usadas.reduce((m, v) => ((v.pct ?? 0) > (m.pct ?? 0) ? v : m));
  return peor.vuelve ?? null;
}

const SIN: VentanaRiel = { pct: null, hasta: 0 };

const ventanaCupo = (v: VentanaCupo | null): VentanaRiel => (v ? { pct: v.pct, hasta: v.vuelve ?? 0 } : SIN);

/**
 * Las cuentas de Claude, la que está en uso primero: la de siempre (lo que dice la statusline) y las agregadas (`reparto`). Sin ninguna
 * preferida en la lista de cuentas, la de siempre. Los anillos muestran la primera: lo que se está gastando, no siempre la de fábrica.
 */
export function cuentasClaude(uso: Pick<Extract<Uso, { ts: number }>, "five_hour" | "seven_day" | "ts"> | null | undefined, filas: readonly FilaSusc[], nombreSiempre: string, cuentas: ListaCuentas | null): CuentaRiel[] {
  const preferida = cuentas?.cuentas.find((c) => c.proveedor === "claude" && c.preferida)?.id ?? "claude";
  const a = filaDe(uso?.five_hour);
  const b = filaDe(uso?.seven_day);
  const siempre: CuentaRiel = {
    id: "claude",
    nombre: nombreSiempre,
    enUso: preferida === "claude",
    h5: { pct: a.pct, hasta: a.hasta ?? 0 },
    sem: { pct: b.pct, hasta: b.hasta ?? 0 },
    ts: uso?.ts ?? 0,
  };
  const otras = filas
    .filter((f) => f.proveedor === "claude")
    .map((f): CuentaRiel => {
      const [x, y] = columnas(f.s.ventanas ?? []);
      const id = f.s.cuenta ?? f.s.id;
      return { id, nombre: f.corto, enUso: id === preferida, h5: ventanaCupo(x), sem: ventanaCupo(y), ts: f.s.ts ?? 0 };
    });
  const todas = [siempre, ...otras];
  return [...todas.filter((c) => c.enUso), ...todas.filter((c) => !c.enUso)];
}

/** Un renglón del detalle: una cuenta o un grupo de cupo, con un número o la palabra que lo reemplaza. */
export type LineaRiel = {
  clave: string;
  nombre: string;
  /** El nombre entero, para el tooltip. */
  quien: string;
  pct: number | null;
  estado: EstadoGrupo;
  /** Cuándo vuelve lo agotado (epoch s); `null`: no se sabe. */
  vuelve: number | null;
  /** Cuándo vuelve la ventana más usada aunque no esté agotada (epoch s); `null`: no se sabe o no se usó nada. */
  cuando: number | null;
  /** Pedidos contados por Trama (OpenCode), sin porcentaje. */
  pedidos?: number;
  /** El grupo no trae ventanas: sin límite medido. */
  sinLimite?: boolean;
  /** Sin porcentaje, con pedidos contados y sin tope: los gratis de OpenCode («Gratis · sin límite conocido»). */
  gratis?: boolean;
  /** La cuenta del control «En uso» / «Usar primero», sólo en el primer renglón de cada una. */
  cuenta?: { proveedor: string; id: string };
};

/** Las otras cuentas de Claude como renglones: el número es lo más lleno de sus dos ventanas. */
export function lineasCuentas(cuentas: readonly CuentaRiel[]): LineaRiel[] {
  return cuentas
    .filter((c) => !c.enUso)
    .map((c) => {
      const pcts = [c.h5, c.sem].flatMap((v) => (v.pct === null ? [] : [v]));
      const peor = pcts.reduce<VentanaRiel | null>((m, v) => (!m || (v.pct ?? 0) > (m.pct ?? 0) ? v : m), null);
      const lleno = (peor?.pct ?? 0) >= 100;
      return {
        clave: c.id,
        nombre: c.nombre,
        quien: c.nombre,
        pct: peor?.pct ?? null,
        estado: lleno ? "lleno" : peor ? "ok" : "sin",
        vuelve: lleno && peor?.hasta ? peor.hasta : null,
        cuando: (peor?.pct ?? 0) > 0 && peor?.hasta ? peor.hasta : null,
        cuenta: { proveedor: "claude", id: c.id },
      };
    });
}

/** Una suscripción de otro motor con sus renglones: Google (Gemini, Argon, «Claude y GPT por Google»), ChatGPT, OpenCode… */
export type BloqueRiel = { clave: string; proveedor: string; titulo: string; lineas: LineaRiel[] };

const sinTope = (v: VentanaCupo) => v.pedidos !== undefined && !v.tope;

/** Los otros motores agrupados por suscripción, un renglón por grupo (o por cuenta si no trae grupos), en el orden de `reparto`. */
export function bloquesMotores(filas: readonly FilaSusc[], ahoraS: number): BloqueRiel[] {
  const otras = filas.filter((f) => f.proveedor !== "claude");
  const cuantas = (p: string) => otras.filter((f) => f.proveedor === p).length;
  const bloques: BloqueRiel[] = [];
  for (const f of otras) {
    let b = bloques.find((x) => x.proveedor === f.proveedor);
    if (!b) {
      // Con varias cuentas del mismo proveedor el bloque lleva la marca («OpenCode») y cada renglón su cuenta; con una, el nombre de la suscripción.
      b = { clave: f.proveedor, proveedor: f.proveedor, titulo: cuantas(f.proveedor) > 1 ? ((MARCA as Record<string, string>)[f.proveedor] ?? f.nombre) : f.nombre, lineas: [] };
      bloques.push(b);
    }
    const cuenta = { proveedor: f.proveedor, id: f.s.cuenta ?? f.s.id };
    const grupos = f.s.grupos ?? [];
    if (!grupos.length) {
      const ventanas = f.s.ventanas ?? [];
      const r = resumenVentanas(ventanas, f.s.agotado, ahoraS);
      const gratis = r.pct === null && r.pedidos !== undefined && ventanas.some(sinTope);
      b.lineas.push({
        clave: f.s.id,
        nombre: f.corto,
        quien: f.nombre,
        pct: r.pct,
        estado: r.estado,
        vuelve: r.vuelve,
        cuando: vueltaDe(ventanas),
        ...(r.pedidos !== undefined ? { pedidos: r.pedidos } : null),
        ...(gratis ? { gratis } : null),
        cuenta,
      });
      continue;
    }
    renglonesDeGrupos(grupos, ahoraS).forEach(({ g, r, sinLimite }, i) => {
      const gratis = r.pct === null && r.pedidos !== undefined && g.ventanas.some(sinTope);
      b!.lineas.push({
        clave: `${f.s.id}:${g.id}`,
        nombre: cuantas(f.proveedor) > 1 ? `${f.corto} · ${nombreGrupoCorto(g)}` : nombreGrupoDetalle(g),
        quien: `${f.nombre} · ${nombreGrupo(g)}`,
        pct: r.pct,
        estado: r.estado,
        vuelve: r.vuelve,
        cuando: vueltaDe(g.ventanas),
        ...(r.pedidos !== undefined ? { pedidos: r.pedidos } : null),
        ...(sinLimite ? { sinLimite } : null),
        ...(gratis ? { gratis } : null),
        ...(i === 0 ? { cuenta } : null),
      });
    });
  }
  return bloques;
}
