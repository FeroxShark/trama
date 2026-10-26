// Piezas de la conversación que comparten la vista de hilo y el chat de un
// líder: el turno (trabajo colapsado + respuesta) y el aviso de cambiar de
// modelo con el caché vivo.
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Tokens } from "../datos/contrato";
import { Reloj } from "../barra/piezas";
import type { Pintor } from "../reloj";
import { cuando, cuandoLargo, duracion, pintorDura } from "../tiempo";
import { useIdioma } from "../i18n/react";
import { nombreModelo } from "./opciones";
import { Tierno, useTiernos } from "./Tierno";
import { Texto } from "./Texto";
import { t } from "../i18n";
import { agrupar } from "./herramientas";
import { Llamada } from "./Llamada";
import { MODO } from "../modo";
import { pasoActual, type Item } from "./turnos";
import { alScroll, bajar, seguidor, seguir } from "./seguir";
import { Pensamiento } from "./Actividad";

/** Lo que pesa releer la conversación entera: entrada + caché leído + caché escrito del último turno. */
export const tokens = (u: Tokens | null) =>
  u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : 0;

/**
 * El aviso de cambiar de modelo con el caché vivo: una línea, no una
 * confirmación. Se apaga solo cuando vence el caché (lo escribe el reloj).
 */
export const pintorAviso =
  (vence: number, modelo: string, n: number): Pintor =>
  (a) =>
    a < vence
      ? {
          texto:
            t("aviso.cambiar", { modelo: nombreModelo(modelo) }) +
            (n ? t("aviso.tokens", { k: Math.max(1, Math.round(n / 1000)) }) : ""),
          en: vence - a,
        }
      : { texto: "", en: Infinity };

/**
 * Cuándo se mandó o terminó un mensaje ("22:41", "ayer 22:41"), chico y
 * apagado; la fecha entera y lo que tardó el turno, en el tooltip. `der`: el
 * del usuario, a la derecha como su globo.
 */
export function Hora({ ts, dura = null, der = false }: { ts: number; dura?: number | null; der?: boolean }) {
  useIdioma();
  const tip = cuandoLargo(ts) + (dura !== null && dura > 0 ? ` · ${t("turno.tardo", { d: duracion(dura) })}` : "");
  return (
    <div className="hora" data-der={der ? "" : undefined}>
      <span data-tip={tip}>{cuando(ts)}</span>
    </div>
  );
}

type PropsTurno = {
  t: Extract<Item, { tipo: "turno" }>;
  vivo: boolean;
  /** Todavía no terminó (un líder de la app respondiendo): sin la hora abajo. */
  enCurso?: boolean;
  /** De quién es el turno (el id del worker): su frase tierna es la misma que en su fila. */
  semilla?: string;
  /** Está razonando ahora (un líder de la app): el bloque dice "Pensando…". */
  pensando?: boolean;
  /**
   * Un motor que deja ver su razonamiento (Gemini): cada comando dice cómo va (corriendo / ok / error); mientras el turno corre,
   * sus pensamientos y herramientas, en orden, los muestra la tarjeta de abajo y no un bloque acá (el trabajo sigue ahí, cerrado).
   */
  razon?: boolean;
};

/**
 * `turnos()` arma objetos nuevos en cada pasada (con el stream, una por frame):
 * se compara lo que se pinta para que sólo se repinte el turno que cambió.
 */
const igual = ({ t: a, vivo: va, enCurso: ca, pensando: pa, razon: ra }: PropsTurno, { t: b, vivo: vb, enCurso: cb, pensando: pb, razon: rb }: PropsTurno) =>
  va === vb &&
  ca === cb &&
  !pa === !pb &&
  !ra === !rb &&
  a.key === b.key &&
  a.texto === b.texto &&
  a.pensado === b.pensado &&
  a.pensamientos?.length === b.pensamientos?.length &&
  a.desde === b.desde &&
  a.hasta === b.hasta &&
  a.pasos.length === b.pasos.length &&
  a.pasos.at(-1)?.texto === b.pasos.at(-1)?.texto &&
  a.pasos.at(-1)?.usos.length === b.pasos.at(-1)?.usos.length &&
  a.pasos.at(-1)?.usos.at(-1)?.resumen === b.pasos.at(-1)?.usos.at(-1)?.resumen &&
  resultados(a) === resultados(b);

/** Los pensamientos del turno, uno por mensaje (un turno armado a mano trae sólo el texto junto). */
const pensamientosDe = (x: PropsTurno["t"]) => x.pensamientos ?? (x.pensado ? [x.pensado] : []);

/** Cuántas llamadas ya tienen resultado (llegan después que la llamada). */
const resultados = (x: PropsTurno["t"]) => x.pasos.reduce((n, p) => n + p.usos.filter((u) => u.det?.resultado).length, 0);

/**
 * El razonamiento del modelo (un líder de la app): una línea plegada por pensamiento ("Pensó: …", un clic lo abre), en orden y sin que
 * uno borre al otro. Mientras llega, el último dice "Pensando" y se ve entero, siguiendo lo que escribe.
 */
function Pensado({ items, vivo }: { items: string[]; vivo: boolean }) {
  useIdioma();
  const abierto = MODO.captura === "lider-pensando" && (MODO.variante === "abierto" || MODO.variante === "vivo");
  return (
    <div className="tv-pensados">
      {items.map((x, i) => (
        <Pensamiento key={i} texto={x} vivo={vivo && i === items.length - 1} abierto={abierto} />
      ))}
    </div>
  );
}

/** Un turno del worker: el trabajo colapsado ("Trabajó 12 m") y lo que contestó. */
export const Turno = memo(function Turno({ t: turno, vivo, enCurso = false, semilla, pensando = false, razon = false }: PropsTurno) {
  // Captura `herramientas`: el trabajo, abierto. Un motor que deja ver su razonamiento muestra sus comandos en el progreso de la tarjeta, no acá.
  const [abierto, setAbierto] = useState(MODO.captura === "herramientas" || MODO.captura === "herramientas-resultados");
  const tierno = useTiernos() && !razon;
  const corre = useMemo(
    () => (vivo && turno.desde !== null ? pintorDura(turno.desde, tierno ? "" : () => `${t("estado.trabajando")} `) : null),
    [vivo, turno.desde, tierno],
  );
  const dura = turno.desde !== null && turno.hasta !== null ? turno.hasta - turno.desde : null;
  const hayTrabajo = turno.pasos.length > 0 || corre;
  // Cerrado y trabajando: una sola línea con el paso en curso, que se reemplaza al cambiar.
  const actual = corre && !abierto && !razon ? pasoActual(turno.pasos) : null;
  // Abierto y trabajando: la lista sigue su último paso; si el usuario sube, se suelta (src/hilo/seguir.ts).
  const lista = useRef<HTMLUListElement>(null);
  const seg = useRef(seguidor()).current;
  const sigue = vivo || enCurso;
  const abrio = useRef(false);
  useLayoutEffect(() => {
    const u = lista.current;
    if (!u) return void (abrio.current = false);
    // Recién abierta: uno que trabaja arranca en su último paso; uno terminado, desde el principio.
    if (!abrio.current) {
      abrio.current = true;
      if (sigue) bajar(u, seg);
      else seg.pegado = false;
    } else if (sigue) seguir(u, seg);
  });
  return (
    <>
      {pensamientosDe(turno).length > 0 && !(razon && enCurso) ? <Pensado items={pensamientosDe(turno)} vivo={pensando} /> : null}
      {hayTrabajo ? (
        <details className="trabajo" open={abierto} onToggle={(e) => setAbierto(e.currentTarget.open)}>
          <summary>
            <ChevronRight size={11} strokeWidth={2} />
            {corre && tierno ? <Tierno semilla={semilla ?? turno.key} /> : null}
            {corre ? <Reloj pintor={corre} /> : dura !== null ? t("turno.trabajo", { d: duracion(dura) }) : t("turno.trabajoSolo")}
          </summary>
          {/* La lista se arma recién al abrir: una página puede traer cientos de pasos. */}
          {abierto ? (
            <ul ref={lista} onScroll={(e) => alScroll(e.currentTarget, seg)}>
              {turno.pasos.map((p, i) => (
                <li key={i}>
                  {p.texto ? <span className="paso">{p.texto.split("\n")[0].slice(0, 240)}</span> : null}
                  {agrupar(p.usos).map((g, k) => (
                    <Llamada key={k} g={g} estado={razon ? (enCurso ? "vivo" : "fin") : undefined} />
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}
      {actual ? (
        <div className="trabajo-paso" data-paso-actual>
          {/* La clave cambia con el paso: el renglón nuevo entra (una animación corta, no infinita). */}
          <span className="trabajo-paso-l" key={`${turno.pasos.length}:${actual.nombre}:${actual.texto}`}>
            {actual.nombre ? <span className="ll-n">{actual.nombre}</span> : null}
            {actual.nombre && actual.texto ? <span className="trabajo-paso-s">·</span> : null}
            {actual.texto ? <span className="ll-r">{actual.texto}</span> : null}
            {actual.veces > 1 ? <span className="ll-k">×{actual.veces}</span> : null}
          </span>
        </div>
      ) : null}
      {turno.texto ? (
        <div className="el">
          <Texto texto={turno.texto} vivo={enCurso} />
        </div>
      ) : null}
      {/* Terminado: a qué hora contestó (el último mensaje del turno). */}
      {!vivo && !enCurso && turno.hasta !== null && (turno.texto || hayTrabajo) ? <Hora ts={turno.hasta} dura={dura} /> : null}
    </>
  );
}, igual);
