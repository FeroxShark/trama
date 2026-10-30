// Las filas de la barra: el worker (dos líneas, colgado en árbol de su
// líder), el líder y lo ya cerrado.
import { ChipEspera } from "./Espera";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Bot, Cloud, Crown, Laptop } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { comoSettle, type Estado, type Hilo, type Lider } from "../datos/contrato";
import { MODO } from "../modo";
import { pintorCache, pintorDura, pintorHace } from "../tiempo";
import { cacheAplica } from "../../electron/cache";
import { errorCorto, fin, type Como, type Salida } from "./arbol";
import { Esfuerzo } from "../ui/componentes";
import { esfuerzoDe } from "./esfuerzo";
import { familiaDe, ficha, lugarDe, modeloCorto } from "./ficha";
import { latir } from "./latido";
import { cierre as cierreDe, Punto, Reloj, tareaDe, textoEstado, tipoDe } from "./piezas";
import { t as tr } from "../i18n";
import { useIdioma } from "../i18n/react";
import { useCompactando } from "../hilo/compactando";
import { CompactaFila, HaceFila } from "../hilo/Hace";
import { Hojas } from "../hilo/Posta";
import { Tierno, useTiernos } from "../hilo/Tierno";
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

export const Fila = memo(function Fila({ ref, h, estado, apagada, cursor, activa, nuevo, error, settle, alAbrir, alCerrar, alRetomar, quieta }: Props) {
  renders.filas++;
  useIdioma();
  const t = tipoDe(h, estado);
  const corre = estado === "trabajando" && !h.en_cola;
  // Compactando su contexto (la marca del hook): las hojas en vez de la onda, y desde cuándo.
  const compacta = useCompactando(corre ? h.id : null);
  const duraCompacta = useMemo(() => (compacta !== null ? pintorDura(compacta) : null), [compacta]);

  // Los prefijos se dicen al pintar: al cambiar de idioma el reloj repinta.
  const hace = useMemo(
    () =>
      pintorHace(fin(h), () => {
        const c = cierreDe(estado);
        return c ? `${c} · ${h.proyecto} · ` : estado === "colgado" ? tr("fila.trabadoSinAvance") : "";
      }),
    [h, estado],
  );
  // Con los mensajes tiernos (B17) la palabra la pone la frase que rota: el reloj dice sólo el tiempo.
  const tierno = useTiernos();
  const dura = useMemo(() => pintorDura(h.inicio, tierno ? "" : () => `${tr("estado.trabajando")} `), [h.inicio, tierno]);
  const cache = useMemo(
    () =>
      h.cache_vence === null || !cacheAplica(h.modelo)
        ? null
        : pintorCache(`${h.id}:${h.cache_vence}`, h.cache_vence, h.cache_ttl_s, h.cache_frio !== null),
    [h],
  );
  const fam = familiaDe(h.modelo);
  const corto = modeloCorto(h.modelo);
  // El esfuerzo sale del id (Gemini/agy) o del campo `effort`, en la escala de su motor; si no se sabe, no se dibuja nada.
  const esf = esfuerzoDe(h.modelo, h.effort);
  const Lugar = lugarDe(h) === "nube" ? Cloud : Laptop;

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
      <button
        type="button"
        className="fila wbtn"
        data-cursor={cursor ? "" : undefined}
        data-activa={activa ? "" : undefined}
        aria-current={activa ? "true" : undefined}
        onClick={() => alAbrir(h.id)}
      >
        {duraCompacta ? <Hojas chica className="pt-hojas" /> : t ? <Punto tipo={t.tipo} clave={h.id} /> : null}
        <span className="l1">
          <span className="t" data-nuevo={nuevo ? "" : undefined}>
            {h.titulo || tareaDe(h)}
          </span>
          {cache && t && !corre ? <Reloj pintor={cache} className="cache" /> : null}
          {/* Con qué modelo (su nombre corto) y dónde corre; la ficha entera, en el tooltip. */}
          <span className="donde" data-tip={ficha(h, MODO.maquina)}>
            {corto ? (
              <span className="glifo" data-fam={fam}>
                {corto}
                {esf ? <Esfuerzo nivel={esf.nivel} niveles={esf.niveles} lleno={esf.lleno} palabra /> : null}
              </span>
            ) : null}
            <Lugar size={12} strokeWidth={1.8} />
          </span>
        </span>
        <span className="l2">
          {error ? (
            <span className="error" data-tip={error}>
              {textoError(error)}
            </span>
          ) : duraCompacta ? (
            <>
              <span className="c-trab brillo" data-compactando>
                {tr("hace.compactando")}
              </span>
              <Reloj pintor={duraCompacta} className="c-trab" />
            </>
          ) : corre && tierno ? (
            <>
              <Tierno semilla={h.id} className="c-trab brillo" />
              <Reloj pintor={dura} className="c-trab" />
            </>
          ) : corre ? (
            <Reloj pintor={dura} className="c-trab brillo" />
          ) : !t || estado === "colgado" ? (
            <Reloj pintor={hace} className={t ? "c-trabado" : undefined} />
          ) : (
            <>
              <span className={`c-${t.tipo}`} data-tip={t.tipo === "cola" ? h.cola_motivo ?? undefined : undefined}>
                {textoEstado(h, estado)}
              </span>
              {estado === "decision" || t.tipo === "cola" ? null : <Reloj pintor={hace} />}
            </>
          )}
          {!error && t && h.commits > 0 ? (
            <span className="m">
              · {tr(h.commits === 1 ? "comun.commit" : "comun.commits", { n: h.commits })}
            </span>
          ) : null}
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
 * El líder: una sesión de Claude Code viva con la que habla el usuario, arriba de
 * sus workers. Lo marca la corona: dorada y con un fulgor que respira
 * (latido.ts) mientras responde, gris cuando está quieto y más apagada si el
 * caché venció (eso lo decide el CSS con el atributo que pone el reloj). Uno
 * sin proceso (`caido`) sigue acá con sus workers: corona roja y "Murió" si lo
 * mataron, apagada y "Cerrado" si cerró; se retoma desde su vista.
 */
type PropsLider = {
  l: Lider;
  /** En "Activas" (filas de varios proyectos juntas): el nombre del suyo, como prefijo. */
  proyecto?: string;
  activa: boolean;
  /** Quieto (`settleLider`): cuántas ramas con commits quedan sin integrar; `null`, sin Settle. */
  settle: number | null;
  alAbrir: (id: string) => void;
  alCerrar: (id: string) => void;
  alSettle: (id: string) => void;
  /** Cuántas filas de workers tiene escondidas (B15): el "+N" que las despliega. 0, sin botón. */
  ocultos: number;
  /** Su pliegue está abierto: el "+N" pasa a "−N". */
  abierto: boolean;
  /** Lo vivo que no tiene fila propia (barra en "sólo líderes"): va resumido al lado del nombre. */
  trabajando: number;
  trabados: number;
  fallaron: number;
  /** Los que frenó `pa --parar`: no cuentan como caídos. */
  frenados: number;
  alPlegar: (clave: string) => void;
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

/** Más de esto no entra en el botón; el número justo lo dice el tooltip. */
const TOPE_OCULTOS = 99;

/** "N subagentes": corren y la sesión está activa. */
export function ChipSubagentes({ n, clave }: { n: number; clave: string }) {
  useIdioma();
  return (
    <span className="subs-chip" data-subs-chip data-tip={tr("sub.chipTip")}>
      <span className="res-pt">
        <Punto tipo="trab" clave={`sub:${clave}`} />
      </span>
      {tr(n === 1 ? "sub.chip1" : "sub.chip", { n })}
    </span>
  );
}

export const FilaLider = memo(function FilaLider({
  l,
  proyecto,
  activa,
  settle,
  alAbrir,
  alCerrar,
  alSettle,
  ocultos,
  abierto,
  trabajando,
  trabados,
  fallaron,
  frenados,
  alPlegar,
}: PropsLider) {
  useIdioma();
  // Sin proceso (`caido`): en vez del modelo, que murió o que está cerrado.
  const marca = l.caido ? tr(l.caido === "murio" ? "estado.fallo" : "lider.cerrado") : l.titulo;
  const hace = useMemo(() => pintorHace(l.actividad, marca ? `${marca} · ` : ""), [l.actividad, marca]);
  // Con subagentes corriendo la sesión trabaja: el numerito de caché no cuenta (se muestra el chip de abajo).
  const cache = useMemo(
    () => (l.cache_vence === null || l.subagentes || !cacheAplica(l.modelo) ? null : pintorCache(`lider:${l.id}:${l.cache_vence}`, l.cache_vence, l.cache_ttl_s, false)),
    [l],
  );
  useEffect(() => {
    if (l.ocupado) latir();
  }, [l.ocupado]);
  // Uno de terminal no cuenta qué hace: que compacta lo dice la marca del hook (uno de la app, su stream).
  const compacta = useCompactando(l.origen === "app" || l.caido ? null : l.id);
  const queHace = abierto ? tr("barra.ocultarWorkers") : tr(ocultos === 1 ? "barra.oculto1" : "barra.ocultoN", { n: ocultos });
  // Lo que dice el tooltip del resumen: son los workers del líder, no su estado.
  const partes = [
    trabajando > 0 && tr("resumen.trabajando", { n: trabajando }),
    trabados > 0 && tr(trabados === 1 ? "resumen.trabado1" : "resumen.trabadoN", { n: trabados }),
    fallaron > 0 && tr(fallaron === 1 ? "resumen.fallo1" : "resumen.falloN", { n: fallaron }),
    frenados > 0 && tr(frenados === 1 ? "resumen.frenado1" : "resumen.frenadoN", { n: frenados }),
  ]
    .filter(Boolean)
    .join(" · ");

  const hace2 =
    l.origen === "app" ? (
      <HaceFila sid={l.id} quieto={<Reloj pintor={hace} className="s" />} />
    ) : compacta !== null ? (
      <CompactaFila desde={compacta} />
    ) : (
      <Reloj pintor={hace} className="s" />
    );

  return (
    <div className="lw" data-mas={ocultos > 0 ? "" : undefined}>
      <button
        type="button"
        className="lider"
        data-activa={activa ? "" : undefined}
        data-cursor={MODO.captura === "lider-hover" ? "" : undefined}
        aria-current={activa ? "true" : undefined}
        data-lider={l.id}
        data-caido={l.caido}
        onClick={() => alAbrir(l.id)}
      >
        <span className="corona" data-ocupado={l.ocupado ? "" : undefined} data-espera={l.espera && !l.ocupado ? l.espera.motivo : undefined}>
          {l.ocupado && compacta === null ? <span className="fulgor" /> : null}
          <Crown size={13} strokeWidth={2} />
        </span>
        <span className="txt">
          <span className="t">
            <span className="nom">{l.nombre || tr("lider.sesionJefe")}</span>
            <IconoMaquina maquina={l.maquina} />
            {l.espera && !l.ocupado && !l.caido ? <ChipEspera espera={l.espera} /> : null}
            {l.subagentes ? <ChipSubagentes n={l.subagentes} clave={l.id} /> : null}
            {/* Sólo líderes: lo que trabaja (o se trabó, o falló) sin fila propia. */}
            <AnimatePresence initial={false}>
              {trabajando + trabados + fallaron + frenados > 0 ? (
                <motion.span
                  key="res"
                  className="res"
                  data-resumen
                  data-tip={tr("resumen.tip", { que: partes })}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                >
                  <Bot size={11} strokeWidth={2} className="res-w" />
                  {trabajando > 0 ? (
                    <span className="c-trab">
                      <span className="res-pt">
                        <Punto tipo="trab" clave={`res:${l.id}`} />
                      </span>
                      {tr("resumen.trabajando", { n: trabajando })}
                    </span>
                  ) : null}
                  {trabados > 0 ? (
                    <span className="c-trabado">
                      <span className="res-pt">
                        <Punto tipo="trabado" clave={`res:${l.id}`} />
                      </span>
                      {tr(trabados === 1 ? "resumen.trabado1" : "resumen.trabadoN", { n: trabados })}
                    </span>
                  ) : null}
                  {fallaron > 0 ? (
                    <span className="c-fallo">{tr(fallaron === 1 ? "resumen.fallo1" : "resumen.falloN", { n: fallaron })}</span>
                  ) : null}
                  {frenados > 0 ? (
                    <span className="c-frenado">{tr(frenados === 1 ? "resumen.frenado1" : "resumen.frenadoN", { n: frenados })}</span>
                  ) : null}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </span>
          {/* En "Activas" el proyecto va delante de la segunda línea: la primera (nombre y estado) queda como en cualquier fila. */}
          {proyecto ? (
            <span className="con-proy">
              <span className="etq-proy" data-tip={proyecto}>
                {proyecto}
              </span>
              {hace2}
            </span>
          ) : (
            hace2
          )}
        </span>
        {cache ? <Reloj pintor={cache} className="cache" /> : null}
      </button>
      {/* Lo que terminó se esconde solo: el "+N" lo despliega acá, bajo este líder. */}
      {ocultos > 0 ? (
        <button
          type="button"
          className="mas"
          data-mas-lider={l.id}
          aria-expanded={abierto}
          aria-label={queHace}
          data-tip={queHace}
          onClick={() => alPlegar(`lider:${l.id}`)}
        >
          {abierto ? "−" : "+"}
          {Math.min(ocultos, TOPE_OCULTOS)}
        </button>
      ) : null}
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
