// La tarjeta de actividad del chat (dirección C, referencias/maquetas/actividad): mientras un líder de la app responde, una
// escena de 2.75rem que actúa lo que hace, el estado (punto de color + verbo), qué modelo y esfuerzo corre, lo concreto, el tiempo,
// los tokens y los pasos de atrás con su icono (los últimos tres; el resto, tras "+N pasos"), y Parar.
// Qué evento da cada tipo y cómo se limpia el detalle: src/hilo/actividad.ts. El movimiento: src/barra/latido-escenas.ts.
import { useEffect, useMemo, useState } from "react";
import { Bot, Brain, Check, ChevronDown, FilePlus, FileText, Globe, Hand, MessageSquare, Pencil, Search, Terminal, Wrench, X, type LucideIcon } from "lucide-react";
import { latir } from "../barra/latido";
import { Reloj } from "../barra/piezas";
import { t, type Clave } from "../i18n";
import { pintorDura } from "../tiempo";
import { estadoDe, iconoDe, PASOS, textoPaso, type Actividad as Act, type Icono, type Paso } from "./actividad";
import { Escena } from "./Escenas";
import { Tierno } from "./Tierno";

/** Una clave de `actividad.ts` (viaja como texto) ya traducida. */
const tx = (clave: string, vars?: Record<string, string | number>) => (t as (k: Clave, v?: Record<string, string | number>) => string)(clave as Clave, vars);

const ICONO: Record<Icono, LucideIcon> = {
  pensar: Brain,
  leer: FileText,
  buscar: Search,
  editar: Pencil,
  escribir: FilePlus,
  correr: Terminal,
  web: Globe,
  delegar: Bot,
  texto: MessageSquare,
  permiso: Hand,
  otro: Wrench,
};

/** Lo concreto: una frase fija (con su variable, si la lleva, y con mayúscula) o el comando / archivo / patrón tal cual. */
export const textoDetalle = (a: Act) => {
  if (!a.detalleClave) return a.detalle;
  const x = tx(a.detalleClave, { d: a.detalle });
  return x.charAt(0).toUpperCase() + x.slice(1);
};

/** Un paso ya pasado en palabras, o `null` si no vale la pena mostrarlo. */
export function lineaPaso(p: Paso): string | null {
  const x = textoPaso(p);
  return x ? tx(x.clave, { d: x.d, s: x.s ?? 0 }) : null;
}

type Props = {
  act: Act;
  pasos: Paso[];
  /** Cuántos pasos lleva el turno (`pasos` guarda los últimos). */
  pasosN?: number;
  /** Desde cuándo responde el líder (s), o `null`. */
  desde: number | null;
  /** Los tokens de salida del turno, ya escritos ("1,2k"), o `null`. */
  tokens: string | null;
  /** Con los mensajes tiernos prendidos, la frase de siempre en vez del verbo genérico (pensando / escribiendo). */
  tierno?: string;
  /** Qué modelo y esfuerzo corre ("Sonnet 5.5", "high"), cuando se saben. */
  modelo?: string | null;
  effort?: string | null;
  /** Parar el turno (la misma acción que el botón de la caja). */
  alParar?: () => void;
  parando?: boolean;
  /** El turno ya terminó (`listo`) o falló (`error`): sin escena que se mueva ni Parar. */
  fin?: "listo" | "error";
};

export function Actividad({ act, pasos, pasosN, desde, tokens, tierno, modelo, effort, alParar, parando, fin }: Props) {
  // La tarjeta existe sólo mientras hay actividad: el latido de las escenas corre mientras está montada.
  useEffect(() => (fin ? undefined : latir()), [fin]);
  const [todos, setTodos] = useState(false);
  const dura = useMemo(() => (desde !== null ? pintorDura(desde) : null), [desde]);
  const detalle = textoDetalle(act);
  const lineas = pasos.map((p) => ({ l: lineaPaso(p), i: iconoDe(p.hace) })).filter((x): x is { l: string; i: Icono } => x.l !== null);
  const vis = todos ? lineas : lineas.slice(0, PASOS);
  const ocultos = lineas.length - PASOS;
  const estado = fin ?? estadoDe(act);
  const verbo = fin ? t(fin === "listo" ? "hz.t.listo" : "hz.t.error") : tx(act.verbo);
  const Det = ICONO[act.icono];
  return (
    // El `key` hace que el cambio de tipo entre con su fundido (`tv-entra`); dentro de un tipo sólo cambia el texto.
    <div className="tv" key={fin ?? act.tipo} data-t={fin ? "fin" : act.tipo} data-e={estado} role="status">
      <div className="tv-tar">
        {fin ? (
          <span className="esc tv-fin" aria-hidden="true">
            {fin === "listo" ? <Check size={22} strokeWidth={2} /> : <X size={22} strokeWidth={2} />}
          </span>
        ) : (
          <Escena tipo={act.tipo} />
        )}
        <div className="tv-cu">
          <div className="tv-t1">
            <span className="tv-punto" aria-hidden="true" />
            {tierno && !fin ? <Tierno semilla={tierno} className="tv-v" limpia /> : <span className="tv-v">{verbo}</span>}
            {modelo ? (
              <span className="tv-modelo" aria-label={t("hz.modelo")}>
                {modelo}
                {effort ? <span className="tv-ef">{effort}</span> : null}
              </span>
            ) : null}
            <span className="tv-meta">
              {dura ? <Reloj pintor={dura} className="tv-x" /> : null}
              {tokens ? <span className="tv-x">{tokens}</span> : null}
              {pasosN ? <span className="tv-x">{t("hz.pasos", { n: pasosN })}</span> : null}
            </span>
          </div>
          {detalle && !fin ? (
            <div className="tv-det" data-fija={act.detalleClave ? "" : undefined}>
              {act.detalleClave ? null : <Det className="tv-ic" size={13} strokeWidth={1.9} aria-hidden="true" />}
              <span className="tv-dt">{detalle}</span>
            </div>
          ) : null}
          {vis.length ? (
            <ul className="tv-pasos">
              {vis.map((p, i) => {
                const I = ICONO[p.i];
                return (
                  <li key={i}>
                    <I className="tv-ic" size={12} strokeWidth={1.9} aria-hidden="true" />
                    <span>{p.l}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {ocultos > 0 || alParar ? (
            <div className="tv-pie">
              {ocultos > 0 ? (
                <button type="button" className="tv-mas" aria-expanded={todos} onClick={() => setTodos((x) => !x)}>
                  {todos ? t("hz.menos") : t("hz.mas", { n: ocultos })}
                  <ChevronDown className="tv-fl" size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
              {alParar && !fin ? (
                <button type="button" className="btn2 tv-parar" disabled={parando} onClick={alParar}>
                  {parando ? t("accion.parando") : t("accion.parar")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
