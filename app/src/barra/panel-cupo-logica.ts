// Lógica pura del panel acoplable de Cupo: arma las tarjetas de suscripciones y el ritmo semanal de Claude.
// Sin React ni reloj propio; probado en `tests/panel-cupo.test.ts`.
import type { SuscripcionCupo, Uso, VentanaCupo } from "../datos/contrato.ts";
import { filasDeCupos, type ListaCuentas } from "../datos/cuentas.ts";
import { ritmoSemanal } from "../paneles/cupos-ritmo.ts";
import { AMBAR_DESDE, cuentasClaude, estadoAnillo } from "./cupos-riel-logica.ts";
import { nombreGrupo } from "./cuposNombres.ts";
import { renglonesDeGrupos } from "./cuposVista.ts";
import { formatearHasta } from "./usoFila.ts";

export const MARCHAS_PLAN_DIA = ["ahorrar", "normal", "gastar"] as const;

/** Formatea fechas YYYY-MM-DD de ausencia para mostrar en una línea del panel Cupo. */
export function formatearAusente(fechas: readonly string[]): string {
  return fechas
    .map((f) => {
      const h = formatearHasta(f);
      return h ? `${h.d}/${h.m}` : f;
    })
    .join(", ");
}

export type NivelVentana = "bien" | "atencion" | "agotado" | "sin" | "off";

export interface VentanaPanel {
  id: string;
  pct: number | null;
  nivel: NivelVentana;
  /** Cuándo vuelve (epoch s); null si 0 %, deshabilitada o no se sabe. */
  vuelve: number | null;
  marcado?: boolean;
  pedidos?: number;
  tope?: number;
  gratis?: boolean;
}

export interface GrupoPanel {
  clave: string;
  id: string;
  nombre: string;
  hasta?: string;
  sinLimite?: boolean;
  ventanas: VentanaPanel[];
}

export interface SuscripcionPanel {
  clave: string;
  proveedor: string;
  titulo: string;
  enUso?: boolean;
  cuenta?: { proveedor: string; id: string };
  ts: number;
  grupos: GrupoPanel[];
}

export type EstadoRitmoPanel = "llega" | "encima" | "seAcaba" | "agotado" | "sinHora";

export interface RitmoPanel {
  cuenta: string;
  pct: number;
  nivel: "bien" | "atencion" | "agotado";
  esperadoPct: number | null;
  seAcabaEn: number | null;
  estadoRitmo: EstadoRitmoPanel;
  vuelve: number | null;
  ts: number;
}

export type DatosUso = Extract<Uso, { ts: number }>;

/** Redondea el uso entre 0 y 100 sin inflar 99,6 % a 100 % si todavía no está agotado. */
export function redondearPct(pct: number | null): number | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  if (pct <= 0) return 0;
  if (pct >= 100) return 100;
  return Math.min(99, Math.round(pct));
}

const sinTope = (v: VentanaCupo) => v.pedidos !== undefined && !v.tope;

function nivelDeAnillo(n: "ok" | "ambar" | "rojo"): "bien" | "atencion" | "agotado" {
  if (n === "rojo") return "agotado";
  return n === "ambar" ? "atencion" : "bien";
}

/** Traduce una ventana de cupo al estado accesible (nivel con palabra + porcentaje + reinicio). */
export function ventanaDeCupo(v: VentanaCupo, ahoraS: number, opts?: { marcado?: number; semanal?: boolean }): VentanaPanel {
  if (v.deshabilitada) {
    return { id: v.id, pct: null, nivel: "off", vuelve: null };
  }
  const marcadoActivo = opts?.marcado !== undefined && opts.marcado > ahoraS;
  if (marcadoActivo) {
    return {
      id: v.id,
      pct: 100,
      nivel: "agotado",
      vuelve: opts!.marcado ?? null,
      marcado: true,
    };
  }
  const pct = redondearPct(v.pct);
  const vuelve = pct !== null && pct > 0 && v.vuelve !== null && v.vuelve > 0 ? v.vuelve : null;
  const gratis = pct === null && sinTope(v);
  let nivel: NivelVentana = "sin";
  if (pct !== null) {
    if (opts?.semanal) {
      nivel = nivelDeAnillo(estadoAnillo({ pct, hasta: v.vuelve ?? 0 }, ahoraS, true).nivel);
    } else {
      nivel = pct >= 100 ? "agotado" : pct >= AMBAR_DESDE ? "atencion" : "bien";
    }
  }
  return {
    id: v.id,
    pct,
    nivel,
    vuelve,
    ...(v.pedidos !== undefined ? { pedidos: v.pedidos } : null),
    ...(v.tope !== undefined ? { tope: v.tope } : null),
    ...(gratis ? { gratis: true } : null),
  };
}

function ventanasDeSuscripcionSinGrupos(s: SuscripcionCupo, ahoraS: number): { ventanas: VentanaPanel[]; sinLimite: boolean } {
  const marcadoActivo = s.agotado !== undefined && s.agotado > ahoraS;
  const vs = s.ventanas ?? [];
  if (!vs.length && marcadoActivo) {
    return {
      ventanas: [ventanaDeCupo({ id: s.id, pct: 100, vuelve: s.agotado ?? null }, ahoraS, { marcado: s.agotado })],
      sinLimite: false,
    };
  }
  if (!vs.length) return { ventanas: [], sinLimite: true };
  return {
    ventanas: vs.map((v) => ventanaDeCupo(v, ahoraS, { marcado: s.agotado })),
    sinLimite: false,
  };
}

/** Arma la lista ordenada de tarjetas de suscripciones para el panel de Cupo. */
export function armarSuscripcionesPanel(
  datos: DatosUso | null | undefined,
  cuentas: ListaCuentas | null,
  ahoraS: number,
  nombres: { claude: string; principal: string },
): SuscripcionPanel[] {
  const cupos = filasDeCupos(datos?.suscripciones, datos?.claudeNombre, nombres.principal);
  const todasClaude = cuentasClaude(datos, cupos.filas, cupos.claudeCorto ?? datos?.claudeNombre ?? nombres.claude, cuentas);
  const variasClaude = todasClaude.length > 1;

  const resultado: SuscripcionPanel[] = todasClaude.map((c) => ({
    clave: `claude:${c.id}`,
    proveedor: "claude",
    titulo: variasClaude ? `${nombres.claude} · ${c.nombre}` : nombres.claude,
    ...(variasClaude ? { enUso: c.enUso } : null),
    cuenta: { proveedor: "claude", id: c.id },
    ts: c.ts,
    grupos: [
      {
        clave: `claude:${c.id}:g`,
        id: "claude",
        nombre: "",
        ventanas: [
          ventanaDeCupo({ id: "5h", pct: c.h5.pct, vuelve: c.h5.hasta || null }, ahoraS),
          ventanaDeCupo({ id: "7d", pct: c.sem.pct, vuelve: c.sem.hasta || null }, ahoraS, { semanal: true }),
        ],
      },
    ],
  }));

  for (const f of cupos.filas) {
    if (f.proveedor === "claude") continue;
    const s = f.s;
    const cuenta = { proveedor: f.proveedor, id: s.cuenta ?? s.id };
    const gruposRaw = s.grupos ?? [];
    const grupos: GrupoPanel[] = gruposRaw.length
      ? renglonesDeGrupos(gruposRaw, ahoraS).map(({ g, sinLimite }) => {
          const marcadoActivo = g.agotado !== undefined && g.agotado > ahoraS;
          const ventanas =
            !g.ventanas.length && marcadoActivo
              ? [ventanaDeCupo({ id: g.id, pct: 100, vuelve: g.agotado ?? null }, ahoraS, { marcado: g.agotado })]
              : g.ventanas.map((v) => ventanaDeCupo(v, ahoraS, { marcado: g.agotado }));
          return {
            clave: `${s.id}:${g.id}`,
            id: g.id,
            nombre: nombreGrupo(g),
            ...(g.hasta ? { hasta: g.hasta } : null),
            ...(sinLimite ? { sinLimite: true } : null),
            ventanas,
          };
        })
      : (() => {
          const { ventanas, sinLimite } = ventanasDeSuscripcionSinGrupos(s, ahoraS);
          return [
            {
              clave: `${s.id}:unica`,
              id: s.id,
              nombre: "",
              ...(sinLimite ? { sinLimite: true } : null),
              ventanas,
            },
          ];
        })();

    resultado.push({
      clave: s.id,
      proveedor: f.proveedor,
      titulo: f.nombre,
      cuenta,
      ts: s.ts,
      grupos,
    });
  }

  return resultado;
}

/** Calcula el ritmo semanal de la cuenta de Claude en uso. `null` si la ventana semanal no tiene porcentaje. */
export function ritmoPanel(
  datos: DatosUso | null | undefined,
  cuentas: ListaCuentas | null,
  ahoraS: number,
  nombres: { claude: string; principal: string },
): RitmoPanel | null {
  const cupos = filasDeCupos(datos?.suscripciones, datos?.claudeNombre, nombres.principal);
  const enUso = cuentasClaude(datos, cupos.filas, cupos.claudeCorto ?? datos?.claudeNombre ?? nombres.claude, cuentas)[0];
  if (!enUso || enUso.sem.pct === null) return null;
  const pct = redondearPct(enUso.sem.pct)!;
  const hasta = enUso.sem.hasta > 0 ? enUso.sem.hasta : null;
  const estado = estadoAnillo({ pct, hasta: hasta ?? 0 }, ahoraS, true);
  const ritmo = hasta !== null ? ritmoSemanal(pct, hasta, ahoraS) : null;
  let estadoRitmo: EstadoRitmoPanel = "sinHora";
  if (pct >= 100) estadoRitmo = "agotado";
  else if (estado.seAcabaEn !== null) estadoRitmo = "seAcaba";
  else if (ritmo?.nivel === "encima") estadoRitmo = "encima";
  else if (ritmo !== null) estadoRitmo = "llega";

  return {
    cuenta: enUso.nombre,
    pct,
    nivel: nivelDeAnillo(estado.nivel),
    esperadoPct: estado.esperado !== null ? Math.round(estado.esperado * 100) : null,
    seAcabaEn: estado.seAcabaEn,
    estadoRitmo,
    vuelve: pct > 0 ? hasta : null,
    ts: enUso.ts,
  };
}
