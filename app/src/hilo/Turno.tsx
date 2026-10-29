// Piezas de la conversación que comparten la vista de hilo y el chat de un
// líder: el turno (trabajo colapsado + respuesta) y el aviso de cambiar de
// modelo con el caché vivo.
import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { agrupar, type Uso } from "./herramientas";
import { Llamada } from "./Llamada";
import { MODO } from "../modo";
import { pasoActual, type Item, type Paso } from "./turnos";
import { alScroll, bajar, seguidor, seguir } from "./seguir";
import { Pensados, PensamientosGrupo } from "./Actividad";
import { resumenPasos } from "./resumen-pasos";

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
  a.orden?.length === b.orden?.length &&
  a.orden?.at(-1)?.texto === b.orden?.at(-1)?.texto &&
  a.orden?.at(-1)?.usos.length === b.orden?.at(-1)?.usos.length &&
  resultados(a) === resultados(b);

/** Los pensamientos del turno, uno por mensaje (un turno armado a mano trae sólo el texto junto). */
const pensamientosDe = (x: PropsTurno["t"]) => x.pensamientos ?? (x.pensado ? [x.pensado] : []);

/** Cuántas llamadas ya tienen resultado (llegan después que la llamada). */
const resultados = (x: PropsTurno["t"]) => x.pasos.reduce((n, p) => n + p.usos.filter((u) => u.det?.resultado).length, 0);

/**
 * El razonamiento del modelo (un líder de la app): uno solo es una línea plegada ("Pensó: …", un clic lo abre); varios, una sola fila
 * plegada ("Pensó · 10") que al abrirse los lista en orden. Mientras llega, el último dice "Pensando…" y, plegado, muestra en la misma línea su última frase; un clic lo abre.
 */
function Pensado({ items, vivo }: { items: string[]; vivo: boolean }) {
  useIdioma();
  const abierto = MODO.captura === "lider-pensando" && MODO.variante === "abierto";
  return (
    <div className="tv-pensados">
      <Pensados items={items} vivo={vivo} abierto={abierto} />
    </div>
  );
}

/** Cuántos textos dijo el modelo en el turno (con el que contesta): más de uno y se ven todos, intercalados con el trabajo. */
const textosDe = (x: PropsTurno["t"]) => x.orden?.reduce((n, p) => n + (p.texto ? 1 : 0), 0) ?? 0;

/**
 * Un turno del worker o del líder. Con un solo texto (el que contesta): el trabajo colapsado ("Trabajó 12 m") y lo que contestó. Con
 * textos entre las herramientas ("Respondió tal cosa, ahora miro X"): cada uno queda en la conversación, en orden, y el trabajo se
 * pliega en un grupo entre texto y texto. Un motor que muestra su razonamiento (`razon`) lleva el trabajo en su tarjeta.
 */
export const Turno = memo(function Turno(p: PropsTurno) {
  return !p.razon && textosDe(p.t) > 1 ? <Intercalado {...p} /> : <Lineal {...p} />;
}, igual);

/** Un turno con un solo texto: el trabajo colapsado ("Trabajó 12 m") y lo que contestó. */
function Lineal({ t: turno, vivo, enCurso = false, semilla, pensando = false, razon = false }: PropsTurno) {
  // Captura `herramientas`: el trabajo, abierto. Un motor que deja ver su razonamiento muestra sus comandos en el progreso de la tarjeta, no acá.
  const [abierto, setAbierto] = useState(MODO.captura === "herramientas" || MODO.captura === "herramientas-resultados");
  useIdioma();
  const tierno = useTiernos() && !razon;
  const corre = useMemo(
    () => (vivo && turno.desde !== null ? pintorDura(turno.desde, tierno ? "" : () => `${t("estado.trabajando")} `) : null),
    [vivo, turno.desde, tierno],
  );
  const dura = turno.desde !== null && turno.hasta !== null ? turno.hasta - turno.desde : null;
  const hayTrabajo = turno.pasos.length > 0 || corre;
  // "Corrió 5 comandos, leyó 3 archivos…": lo que dice la línea del trabajo ya cerrado; sin herramientas, el "Trabajó 12 m" de siempre.
  const resumen = useMemo(() => (corre ? "" : resumenPasos(turno.pasos.flatMap((p) => p.usos))), [corre, turno.pasos]);
  const pens = pensamientosDe(turno);
  const hayPens = pens.length > 0 && !(razon && enCurso);
  // Varios pensamientos de un turno que ya terminó y tuvo trabajo: su fila va adentro del trabajo, para que el turno sea una sola línea.
  const pensDentro = hayPens && pens.length > 1 && turno.pasos.length > 0 && !pensando && !vivo;
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
      {hayPens && !pensDentro ? <Pensado items={pens} vivo={pensando} /> : null}
      {hayTrabajo ? (
        <details className="trabajo" open={abierto} onToggle={(e) => setAbierto(e.currentTarget.open)}>
          <summary>
            <ChevronRight size={11} strokeWidth={2} />
            {corre && tierno ? <Tierno semilla={semilla ?? turno.key} /> : null}
            {corre ? (
              <Reloj pintor={corre} />
            ) : resumen ? (
              dura !== null ? t("turno.resumenDura", { r: resumen, d: duracion(dura) }) : resumen
            ) : dura !== null ? (
              t("turno.trabajo", { d: duracion(dura) })
            ) : (
              t("turno.trabajoSolo")
            )}
          </summary>
          {/* La lista se arma recién al abrir: una página puede traer cientos de pasos. */}
          {abierto ? (
            <ul ref={lista} onScroll={(e) => alScroll(e.currentTarget, seg)}>
              {pensDentro ? (
                <li>
                  <PensamientosGrupo items={pens} />
                </li>
              ) : null}
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
}

/** Dos grupos de herramientas son el mismo si tienen las mismas llamadas con los mismos resultados (llegan después que la llamada). */
const igualGrupo = (a: PropsGrupo, b: PropsGrupo) =>
  a.reloj === b.reloj &&
  a.semilla === b.semilla &&
  a.tierno === b.tierno &&
  a.usos.length === b.usos.length &&
  a.usos.at(-1)?.resumen === b.usos.at(-1)?.resumen &&
  a.usos.filter((u) => u.det?.resultado).length === b.usos.filter((u) => u.det?.resultado).length;

type PropsGrupo = {
  usos: Uso[];
  /** El turno corre y éste es su último trabajo: el título es el reloj y, cerrado, dice el paso en curso. */
  reloj: Pintor | null;
  semilla: string;
  /** Con la frase tierna delante del reloj (`useTiernos`). */
  tierno: boolean;
};

/** Las herramientas que usó el modelo entre dos textos: una línea plegada ("Corrió 2 comandos, leyó un archivo") que se abre a la lista. */
const Grupo = memo(function Grupo({ usos, reloj, semilla, tierno }: PropsGrupo) {
  const [abierto, setAbierto] = useState(MODO.captura === "herramientas" || MODO.captura === "herramientas-resultados");
  useIdioma();
  const resumen = useMemo(() => (reloj ? "" : resumenPasos(usos)), [reloj, usos]);
  const actual = reloj && !abierto && usos.length ? pasoActual([{ texto: "", usos }]) : null;
  // Abierto y trabajando: la lista sigue su último paso; si el usuario sube, se suelta (src/hilo/seguir.ts).
  const lista = useRef<HTMLUListElement>(null);
  const seg = useRef(seguidor()).current;
  const abrio = useRef(false);
  useLayoutEffect(() => {
    const u = lista.current;
    if (!u) return void (abrio.current = false);
    if (!abrio.current) {
      abrio.current = true;
      if (reloj) bajar(u, seg);
      else seg.pegado = false;
    } else if (reloj) seguir(u, seg);
  });
  return (
    <>
      <details className="trabajo" data-grupo="" open={abierto} onToggle={(e) => setAbierto(e.currentTarget.open)}>
        <summary>
          <ChevronRight size={11} strokeWidth={2} />
          {reloj && tierno ? <Tierno semilla={semilla} /> : null}
          {reloj ? <Reloj pintor={reloj} /> : resumen || t("turno.trabajoSolo")}
        </summary>
        {/* La lista se arma recién al abrir: un grupo puede traer cientos de llamadas. */}
        {abierto ? (
          <ul ref={lista} onScroll={(e) => alScroll(e.currentTarget, seg)}>
            {agrupar(usos).map((g, k) => (
              <li key={k}>
                <Llamada g={g} />
              </li>
            ))}
          </ul>
        ) : null}
      </details>
      {actual ? (
        <div className="trabajo-paso" data-paso-actual>
          <span className="trabajo-paso-l" key={`${usos.length}:${actual.nombre}:${actual.texto}`}>
            {actual.nombre ? <span className="ll-n">{actual.nombre}</span> : null}
            {actual.nombre && actual.texto ? <span className="trabajo-paso-s">·</span> : null}
            {actual.texto ? <span className="ll-r">{actual.texto}</span> : null}
            {actual.veces > 1 ? <span className="ll-k">×{actual.veces}</span> : null}
          </span>
        </div>
      ) : null}
    </>
  );
}, igualGrupo);

/**
 * Un turno con textos entre las herramientas, como en Claude Code: cada texto del modelo queda en la conversación (durante el turno y
 * después), en orden, y las herramientas de entre uno y otro, plegadas en su grupo. Cada texto y cada grupo es hijo directo de la
 * conversación: la lista larga no pinta ni mide lo que no se ve (`content-visibility`, src/index.css).
 */
function Intercalado({ t: turno, vivo, enCurso = false, semilla, pensando = false }: PropsTurno) {
  useIdioma();
  const orden = turno.orden as Paso[];
  const tierno = useTiernos();
  const corre = useMemo(
    () => (vivo && turno.desde !== null ? pintorDura(turno.desde, tierno ? "" : () => `${t("estado.trabajando")} `) : null),
    [vivo, turno.desde, tierno],
  );
  const dura = turno.desde !== null && turno.hasta !== null ? turno.hasta - turno.desde : null;
  const pens = pensamientosDe(turno);
  const sem = semilla ?? turno.key;
  const ultimo = orden.length - 1;
  return (
    <>
      {pens.length ? <Pensado items={pens} vivo={pensando} /> : null}
      {orden.map((p, i) => (
        <Fragment key={i}>
          {p.texto ? (
            <div className="el" data-intermedio={i < ultimo || p.usos.length ? "" : undefined}>
              {/* Sigue llegando sólo el último texto, y si todavía no usó herramientas. */}
              <Texto texto={p.texto} vivo={enCurso && i === ultimo && !p.usos.length} />
            </div>
          ) : null}
          {p.usos.length ? <Grupo usos={p.usos} reloj={i === ultimo ? corre : null} semilla={sem} tierno={tierno} /> : null}
        </Fragment>
      ))}
      {/* Terminó de escribir y todavía no usó nada: igual se ve que sigue trabajando. */}
      {corre && !orden[ultimo]?.usos.length ? <Grupo usos={[]} reloj={corre} semilla={sem} tierno={tierno} /> : null}
      {!vivo && !enCurso && turno.hasta !== null ? <Hora ts={turno.hasta} dura={dura} /> : null}
    </>
  );
}
