// Las filas de la barra (rediseño 0.4, maquetas/rediseno-0.4/barra-densa-b.html): una línea por hilo. El worker colgado de su líder, el
// líder con su corona y lo ya cerrado. A la izquierda el glifo del estado (la corona, en el líder), el título, y a la derecha la palabra si
// pide algo y el tiempo. Lo que corre se mueve con `latido.ts`, no con una animación CSS infinita.
import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { CircleQuestionMark, Crown, X } from "lucide-react";
import { comoSettle, type Estado, type Hilo, type Lider } from "../datos/contrato";
import { MODO } from "../modo";
import { pintorCache, pintorCorto, pintorDura } from "../tiempo";
import { cacheAplica } from "../../electron/cache";
import { atencionItem, errorCorto, fin, liderEspera, type Atencion, type Como, type Salida } from "./arbol";
import { ficha } from "./ficha";
import { Glifo, glifoDe } from "./Glifo";
import { latir } from "./latido";
import { cierre as cierreDe, Punto, Reloj, tareaDe, textoEstado, tipoDe } from "./piezas";
import { Resalte } from "./Resalte";
import { t as tr } from "../i18n";
import { useIdioma } from "../i18n/react";
import { useCompactando } from "../hilo/compactando";
import { Hojas } from "../hilo/Posta";
import { motion } from "motion/react";
import { IconoMaquina } from "./Maquina";

export const RESORTE = { type: "spring", stiffness: 520, damping: 42, mass: 1 } as const;

/** Cuántas veces renderizó una fila: el guion verifica que un tic del reloj no lo mueve. */
export const renders = { filas: 0 };

type Props = {
  /** Lo pone AnimatePresence (popLayout) para sacar la fila del flujo al irse. */
  ref?: Ref<HTMLLIElement>;
  h: Hilo;
  /** El estado que se muestra: el de `pa`, o el optimista mientras corre un Cerrar. */
  estado: Estado;
  cursor: boolean;
  activa: boolean;
  /** De un líder y ya terminada: se ve apagada, no compite con lo que trabaja. */
  apagada?: boolean;
  /** Trae algo que el usuario todavía no abrió: el título va en negrita. */
  nuevo: boolean;
  /** Falló o pidió una decisión, pero ya no la pide (relanzado, visto, contestado: `atencion-vigente.ts`): no se resalta. */
  resuelto?: boolean;
  error: string | null;
  /** Su Settle propio (`salidaWorker`): terminó y no cuelga de un líder a la vista. `null`, sin botones. */
  settle: Salida | null;
  alAbrir: (id: string) => void;
  alCerrar: (id: string, como?: Como) => void;
  /** Retomar (B22): lo que murió con commits; un líder nuevo se hace cargo. */
  alRetomar?: (id: string) => void;
  /** Lista virtualizada: entra sin animar (aparece por el scroll, no porque sea nueva). */
  quieta?: boolean;
};

export const Fila = memo(function Fila({ ref, h, estado, apagada, cursor, activa, nuevo, resuelto, error, settle, alAbrir, alCerrar, alRetomar, quieta }: Props) {
  renders.filas++;
  useIdioma();
  const t = tipoDe(h, estado);
  const corre = estado === "trabajando" && !h.en_cola;
  // Compactando su contexto (la marca del hook): las hojas en vez del glifo, y desde cuándo.
  const compacta = useCompactando(corre ? h.id : null);
  const duraCompacta = useMemo(() => (compacta !== null ? pintorDura(compacta) : null), [compacta]);
  // Lo que corre (o espera puesto) cuenta desde que arrancó; lo demás, desde que terminó.
  const cuando = useMemo(() => pintorCorto(corre || h.en_cola ? h.inicio : fin(h)), [h, corre]);
  const cache = useMemo(
    () =>
      h.cache_vence === null || !cacheAplica(h.modelo)
        ? null
        : pintorCache(`${h.id}:${h.cache_vence}`, h.cache_vence, h.cache_ttl_s, h.cache_frio !== null),
    [h],
  );
  // Falló o pide una decisión: la fila resalta (tinte, borde, glifo en círculo y la palabra en una píldora).
  const at = resuelto ? null : atencionItem({ h, estado });
  // La palabra que acompaña al tiempo, sólo si dice algo que el glifo solo no alcanza: en cola, trabado, frenado, cerrado.
  const palabra = at || !t ? (t ? null : cierreDe(estado)) : t.tipo === "cola" || t.tipo === "trabado" || t.tipo === "frenado" || t.tipo === "fallo" ? (t.tipo === "cola" ? t.texto : textoEstado(h, estado)) : null;

  return (
    <motion.li
      ref={ref}
      layout="position"
      initial={quieta ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={RESORTE}
      data-fila={h.id}
      data-apagada={apagada ? "" : undefined}
      className="w"
    >
      {corre && !at ? <HiloVivo /> : null}
      <button
        type="button"
        className="fila wbtn"
        data-cursor={cursor ? "" : undefined}
        data-activa={activa ? "" : undefined}
        data-atencion={at ?? undefined}
        aria-current={activa ? "true" : undefined}
        onClick={() => alAbrir(h.id)}
      >
        {duraCompacta && !at ? <Hojas chica className="pt-hojas" /> : at ? <Llamado at={at} /> : <Glifo g={glifoDe(t?.tipo)} />}
        <span className="l1">
          <span className="t" data-nuevo={nuevo ? "" : undefined}>
            <Resalte texto={h.titulo || tareaDe(h)} />
          </span>
        </span>
        {/* Con qué modelo, dónde corre y lo demás: en el tooltip (`ficha`). */}
        <span className="l2" data-tip={ficha(h, MODO.maquina)}>
          {cache && t && !corre && !at ? <Reloj pintor={cache} className="cache" /> : null}
          {at ? <span className="chip-at" data-at={at}>{tr(at === "fallo" ? "fila.chipFallo" : "barra.chipDecidir")}</span> : null}
          {error ? (
            <span className="pal error" data-tip={error}>
              {textoError(error)}
            </span>
          ) : duraCompacta ? (
            <span className="pal" data-compactando>
              {tr("barra.compactando")}
            </span>
          ) : palabra ? (
            <span className="pal" data-tip={t?.tipo === "cola" ? h.cola_motivo ?? undefined : undefined}>
              {palabra}
            </span>
          ) : null}
          <Reloj pintor={duraCompacta ?? cuando} className="cuando" />
        </span>
      </button>
      {settle ? (
        <Acciones>
          <AccionesWorker id={h.id} salida={settle} como={comoSettle(h)} alCerrar={alCerrar} alRetomar={alRetomar} className="mini" />
        </Acciones>
      ) : null}
    </motion.li>
  );
});

/**
 * El tramo del hilo del proyecto al lado de un worker que corre: se enciende en el color del proyecto y una lanzadera lo recorre (el
 * telar del nombre). Decora: lo que dice que corre es el glifo y, sin movimiento (`prefers-reduced-motion`), el tramo encendido quieto.
 */
function HiloVivo() {
  useEffect(latir, []);
  return (
    <span className="hilo-vivo" aria-hidden="true">
      <i className="lanzadera" />
    </span>
  );
}

/** El glifo de lo que pide atención, con un halo que respira: lo que está esperando es lo único que llama desde lejos. */
function Llamado({ at }: { at: Atencion }) {
  useEffect(latir, []);
  return (
    <span className="llamado" data-at={at}>
      <span className="halo" />
      <Glifo g={at === "fallo" ? "falla" : "pide"} />
    </span>
  );
}

/** El ícono de estado en un recuadro de color: coral con una X (falló) o ámbar con un ? (pide una decisión). Va con su palabra al lado. */
export function IconoAtencion({ at, className }: { at: Atencion; className?: string }) {
  const I = at === "fallo" ? X : CircleQuestionMark;
  return (
    <span className={className ? `ico-at ${className}` : "ico-at"} data-at={at} aria-hidden="true">
      <I size={11} strokeWidth={3} />
    </span>
  );
}

/** El error en la fila: corto y entero (sin cortar a mitad de palabra); lo que dijo `pa`, en el tooltip. */
const textoError = errorCorto;

/**
 * Los botones que salen con el hover de una fila. Le avisan a la fila cuánto miden (`--acc-w`, en el padre) para que su texto
 * se corte antes de llegar a ellos en vez de quedar tapado a medias (index.css, `.acc`).
 */
function Acciones({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    const fila = el?.parentElement;
    if (!el || !fila || typeof ResizeObserver === "undefined") return;
    const medir = () => fila.style.setProperty("--acc-w", `${el.offsetWidth}px`);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <span ref={ref} className="acc">
      {children}
    </span>
  );
}

type PropsAcciones = {
  id: string;
  salida: Salida;
  /** Qué hace el botón de cerrar (`comoSettle`), que es lo que dice: Integrar (sube su rama a main) o Archivar (lo saca de la lista). */
  como: "integrar" | "archivar";
  alCerrar: (id: string, como?: Como) => void;
  /** Con commits y sin nadie: Retomar va primero (B22); Integrar y Quitar quedan detrás. */
  alRetomar?: (id: string) => void;
  className: string;
};

/**
 * Los botones del cierre propio de un worker (fila y vista): Integrar o Archivar, según
 * lo que le toca (`comoSettle`); o, si murió,
 * Quitar (sin commits no hay nada que perder) o Integrar + Quitar, que confirma con
 * un segundo clic porque borra la rama con sus commits. Con commits, adelante va
 * Retomar (B22): un líder nuevo mira la rama y decide si seguirla.
 */
export function AccionesWorker({ id, salida, como, alCerrar, alRetomar, className }: PropsAcciones) {
  const [seguro, setSeguro] = useState(false);
  if (salida === "settle")
    return (
      <button
        type="button"
        className={className}
        data-cerrar={como}
        data-tip={tr(como === "integrar" ? "accion.integrarTip" : "accion.archivarTip")}
        onClick={() => alCerrar(id)}
      >
        {tr(como === "integrar" ? "accion.integrar" : "accion.archivar")}
      </button>
    );
  const confirma = salida === "elegir";
  return (
    <>
      {confirma && alRetomar ? (
        <button type="button" className={className} data-retomar data-primario onClick={() => alRetomar(id)}>
          {tr("accion.retomar")}
        </button>
      ) : null}
      {confirma ? (
        <button type="button" className={className} data-integrar onClick={() => alCerrar(id, "integrar")}>
          {tr("accion.integrar")}
        </button>
      ) : null}
      <button
        type="button"
        className={className}
        data-quitar
        aria-pressed={seguro || undefined}
        onBlur={() => setSeguro(false)}
        onKeyDown={(e) => e.key === "Escape" && seguro && (e.stopPropagation(), setSeguro(false))}
        onClick={() => (confirma && !seguro ? setSeguro(true) : alCerrar(id, "quitar"))}
      >
        {tr(seguro ? "accion.quitarSeguro" : "accion.quitar")}
      </button>
    </>
  );
}

/**
 * El líder: una sesión de Claude Code con la que habla el usuario, arriba de sus workers, en una línea. Lo marca la corona: dorada y con un
 * fulgor que respira si responde, dorada sin fulgor si sólo corren sus workers, gris si está quieto. Si te espera, en un círculo ámbar con su
 * palabra al lado. Uno sin proceso (`caido`) sigue acá con sus workers: corona roja y "Murió" si lo mataron, apagada y "Cerrado" si cerró; se
 * retoma desde su vista.
 */
type PropsLider = {
  l: Lider;
  activa: boolean;
  /** Quieto (`settleLider`): cuántas ramas con commits quedan sin integrar; `null`, sin Settle. */
  settle: number | null;
  /** El glifo en círculo y su palabra: el líder mismo espera tu respuesta o, plegados, un worker suyo falló o pide una decisión. */
  atencion?: Atencion | null;
  /** Cuántos workers suyos están vivos: el glifo dice que corre aunque él esté quieto. */
  vivos: number;
  alAbrir: (id: string) => void;
  alCerrar: (id: string) => void;
  alSettle: (id: string) => void;
};

/**
 * "Cerrar líder" (sólo los de la app: a uno de terminal no se lo toca), o "Quitar" a uno sin proceso. Siempre
 * pide confirmación en el mismo botón, como Borrar del menú: el primer clic pregunta, otro clic confirma
 * (Esc o irse del botón, no). Si está respondiendo, la pregunta dice que lo corta.
 */
export function CerrarLider({
  l,
  alCerrar,
  className,
  quitar = false,
}: {
  l: Lider;
  alCerrar: (id: string, motivo: string) => void;
  className: string;
  quitar?: boolean;
}) {
  const [seguro, setSeguro] = useState(false);
  return (
    <button
      type="button"
      className={className}
      data-cerrar-lider
      data-quitar-lider={quitar ? "" : undefined}
      aria-pressed={seguro || undefined}
      onBlur={() => setSeguro(false)}
      onKeyDown={(e) => e.key === "Escape" && seguro && (e.stopPropagation(), setSeguro(false))}
      onClick={() => (seguro ? alCerrar(l.id, quitar ? "quitar" : "cerrar") : setSeguro(true))}
    >
      {seguro ? tr(l.ocupado ? "lider.cortarCerrar" : "lider.cerrarSeguro") : tr(quitar ? "accion.quitar" : "lider.cerrar")}
    </button>
  );
}

/**
 * Archivar un líder quieto (el "Settle" de antes): oculta su conversación y archiva sus workers
 * terminados. A uno de la app además lo cierra, y si quedan ramas sin integrar, el primer clic pregunta en línea
 * (otro clic confirma; Esc o irse del botón, no); un líder de terminal sin ramas se archiva con un clic.
 */
type PropsSettle = {
  l: Lider;
  ramas: number;
  alSettle: (id: string) => void;
  className: string;
  /** Para la captura: nace con la confirmación armada. */
  armado?: boolean;
};

export function SettleLider({ l, ramas, alSettle, className, armado = false }: PropsSettle) {
  const pregunta = ramas > 0 || l.origen === "app";
  const [seguro, setSeguro] = useState(armado && pregunta);
  return (
    <>
      <button
        type="button"
        className={className}
        data-settle-lider
        data-tip={tr("lider.settleTip")}
        aria-pressed={seguro || undefined}
        onBlur={() => setSeguro(false)}
        onKeyDown={(e) => e.key === "Escape" && seguro && (e.stopPropagation(), setSeguro(false))}
        onClick={() => (pregunta && !seguro ? setSeguro(true) : alSettle(l.id))}
      >
        {tr("accion.archivar")}
      </button>
      {seguro ? (
        <span className="settle-conf" role="alert">
          {ramas === 0 ? tr("lider.archivarSeguro") : tr(ramas === 1 ? "lider.settleRamas1" : "lider.settleRamasN", { n: ramas })}
        </span>
      ) : null}
    </>
  );
}

/** "N subagentes": corren y la sesión está activa. */
export function ChipSubagentes({ n, clave, corto }: { n: number; clave: string; /** En la fila de la barra: sólo el número (la frase, en el tooltip). */ corto?: boolean }) {
  useIdioma();
  const texto = tr(n === 1 ? "sub.chip1" : "sub.chip", { n });
  return (
    <span className="subs-chip" data-subs-chip data-tip={corto ? `${texto}: ${tr("sub.chipTip")}` : tr("sub.chipTip")} aria-label={corto ? texto : undefined}>
      <span className="res-pt">
        <Punto tipo="trab" clave={`sub:${clave}`} />
      </span>
      {corto ? n : texto}
    </span>
  );
}

/** La corona del líder. `estado` lo dice el CSS con su color; la palabra (si pide algo, murió o cerró) va en la fila: nunca sólo el color. */
function Corona({ estado, at }: { estado: "responde" | "dirige" | "quieto" | "murio" | "cerrado"; at: Atencion | null }) {
  const fulgor = estado === "responde" && !at;
  useEffect(() => {
    if (fulgor || at) latir();
  }, [fulgor, at]);
  return (
    <span className="corona" data-estado={estado} data-at={at ?? undefined} aria-hidden="true">
      {fulgor ? <span className="fulgor" /> : null}
      {at ? <span className="halo" /> : null}
      <Crown size={13} strokeWidth={2} />
    </span>
  );
}

export const FilaLider = memo(function FilaLider({
  l,
  activa,
  settle,
  atencion = null,
  vivos,
  alAbrir,
  alCerrar,
  alSettle,
}: PropsLider) {
  useIdioma();
  const cuando = useMemo(() => pintorCorto(l.actividad), [l.actividad]);
  // Sin proceso (`caido`): en vez del modelo, que murió o que está cerrado.
  const marca = l.caido ? tr(l.caido === "murio" ? "estado.fallo" : "lider.cerrado") : null;
  // Con subagentes corriendo la sesión trabaja: el numerito de caché no cuenta (se muestra el chip).
  const cache = useMemo(
    () => (l.cache_vence === null || l.subagentes || !cacheAplica(l.modelo) ? null : pintorCache(`lider:${l.id}:${l.cache_vence}`, l.cache_vence, l.cache_ttl_s, false)),
    [l],
  );
  // Uno de terminal no cuenta qué hace: que compacta lo dice la marca del hook (uno de la app, su stream).
  const compacta = useCompactando(l.caido ? null : l.id);
  const corre = !l.caido && (l.ocupado || vivos > 0 || (l.subagentes ?? 0) > 0);
  const estado = l.caido === "murio" ? "murio" : l.caido ? "cerrado" : l.ocupado || (l.subagentes ?? 0) > 0 ? "responde" : vivos > 0 ? "dirige" : "quieto";
  const espera = liderEspera(l) ? l.espera : null;

  return (
    <div className="lw">
      <button
        type="button"
        className="fila lider"
        data-activa={activa ? "" : undefined}
        data-cursor={MODO.captura === "lider-hover" ? "" : undefined}
        aria-current={activa ? "true" : undefined}
        data-lider={l.id}
        data-caido={l.caido}
        data-calmo={!corre && !atencion ? "" : undefined}
        data-espera-tu={espera ? "" : undefined}
        data-atencion={atencion ?? undefined}
        onClick={() => alAbrir(l.id)}
      >
        {compacta !== null && !atencion ? <Hojas chica className="pt-hojas" /> : <Corona estado={estado} at={atencion} />}
        <span className="txt">
          <span className="t">
            <span className="nom">
              <Resalte texto={l.nombre || tr("lider.sesionJefe")} />
            </span>
            <IconoMaquina maquina={l.maquina} />
          </span>
        </span>
        {cache ? <Reloj pintor={cache} className="cache" /> : null}
        {l.subagentes ? <ChipSubagentes n={l.subagentes} clave={l.id} corto /> : null}
        {espera ? (
          <span className="chip-at" data-at="decision" data-tip={tr(espera.motivo === "pide" ? "espera.pide" : "espera.listo")}>
            {tr(espera.motivo === "pide" ? "barra.chipDecidir" : "barra.chipEspera")}
          </span>
        ) : atencion === "fallo" ? (
          <span className="chip-at" data-at="fallo">
            {tr("fila.chipFallo")}
          </span>
        ) : atencion ? (
          <span className="chip-at" data-at="decision">
            {tr("barra.chipDecidir")}
          </span>
        ) : compacta !== null ? (
          <span className="pal">{tr("barra.compactando")}</span>
        ) : marca ? (
          <span className="pal" data-caido={l.caido}>
            {marca}
          </span>
        ) : null}
        {/* El modelo, en el tooltip del tiempo: ya no hay segunda línea. */}
        <Reloj pintor={cuando} className="cuando" data-tip={l.titulo || undefined} />
      </button>
      {/* Quieto, Settle (a uno de la app también lo cierra); respondiendo, Cerrar líder (sólo los de la app). */}
      {settle !== null ? (
        <Acciones>
          <SettleLider l={l} ramas={settle} alSettle={alSettle} className="mini" />
        </Acciones>
      ) : l.origen === "app" ? (
        <Acciones>
          <CerrarLider l={l} alCerrar={alCerrar} className="mini" />
        </Acciones>
      ) : null}
    </div>
  );
});
