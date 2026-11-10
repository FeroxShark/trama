// La bandeja de la cola: lo que el usuario mandó con el líder trabajando, en una solapa pegada arriba de la caja de escribir.
// El mensaje no está en la conversación hasta que entra (electron/cola.ts): recién ahí salta al chat. La solapa dice en palabras
// qué pasa (cuándo entra, un paso largo, lo que no salió); el color sólo acompaña. Se puede editar, borrar, ordenar (arrastrando o con
// las flechas sobre el agarre) y plegar; «Enviar ahora» corta el paso, siempre preguntando antes. Lo que ya se le pasó al motor (`camino`) sigue
// acá hasta que entra, sin Editar ni Borrar: ya no se puede retirar. Mientras se edita, se arrastra o se confirma, la cola no sale (`cola.retener`).
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as PE } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, CircleX, Clock, FileText, GripVertical, Hourglass, Layers, Pencil, RotateCw, Scissors, Send, Square, Trash2, X, Zap } from "lucide-react";
import { separarAdjuntos } from "../../electron/adjunto";
import type { Imagen } from "../../electron/imagenes";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { urlDe } from "./adjuntos";
import { aplicarOrden, cabecera, canalDe, confirmacion, corrimiento, destinoArrastre, mover, pasoDe, type IconoTab } from "./bandeja-logica";
import type { Encolado } from "./cola";
import { useCorrector } from "../paneles/ajustes-corrector";
import { Visor } from "./Imagenes";
import { Sistema } from "./Sistema";
import { lineaAviso } from "./sistema-logica";
import { cola, parando as marcarParando, type EnCurso } from "./vivo";
import "./solapa-cola.css";

/** Plegada se queda plegada al volver a ese líder (en esta sesión). */
const PLEGADAS = new Set<string>();
/** Cada cuánto se renueva lo retenido: el main lo suelta solo si la ventana se fue sin avisar. */
const RENOVAR_MS = 60_000;
/** Cada cuánto se mira el paso en curso: alcanza para el cruce de los 2 minutos y para los minutos que muestra. */
const MIRAR_MS = 5_000;
/** Más filas que esto: la lista se scrollea adentro de la solapa (y no le come el lugar a la conversación). */
const FILAS_SIN_SCROLL = 4;
const MINIS_MAX = 3;

const ICONO: Record<IconoTab, typeof Clock> = { reloj: Clock, capas: Layers, arena: Hourglass, error: CircleX, camino: Send };

type Abierta = { tipo: "editar" | "confirmar"; id: number } | null;
type Arrastre = { id: number; desde: number; hasta: number; dy: number; alturas: number[]; gap: number; y0: number; scroll0: number };

const callado = (p: unknown) => void Promise.resolve(p).catch(() => {});

function useAhora(activo: boolean) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!activo) return;
    setAhora(Date.now());
    const iv = setInterval(() => setAhora(Date.now()), MIRAR_MS);
    return () => clearInterval(iv);
  }, [activo]);
  return ahora;
}

type Props = {
  sid: string;
  /** Abierto en una terminal: entra cuando termine ahí. */
  ajeno: boolean;
  /** Tiene canal a mitad de turno: entra tras este paso; si no, al terminar el turno. */
  directo: boolean;
  ocupado: boolean;
  ind: EnCurso["ind"];
  parando: boolean;
  alParar: (() => void) | null;
  alAbrirHilo?: (id: string) => void;
  alError: (mensaje: string) => void;
};

/** La bandeja de un líder: no ocupa nada si no hay cola. */
export function Bandeja(p: Props) {
  useIdioma();
  const est = useSyncExternalStore(
    useCallback((fn: () => void) => cola.suscribir(p.sid, fn), [p.sid]),
    () => cola.estado(p.sid),
  );
  const hay = est.lista.length > 0 || est.camino.length > 0;
  const quieto = !!useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {hay ? (
        <motion.section
          key="bandeja"
          className="band-marco"
          aria-label={t("cola.region")}
          data-bandeja
          initial={quieto ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
          exit={quieto ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0, overflow: "hidden" }}
          style={quieto ? undefined : { overflow: "hidden" }}
          transition={{ duration: quieto ? 0 : 0.18, ease: [0.2, 0, 0, 1] }}
        >
          <Contenido {...p} lista={est.lista} camino={est.camino} error={est.error} errorId={est.errorId} quieto={quieto} />
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

function Contenido({ sid, ajeno, directo, ocupado, ind, parando, alParar, alAbrirHilo, alError, lista, camino, error, errorId, quieto }: Props & { lista: readonly Encolado[]; camino: readonly Encolado[]; error: string | null; errorId: number | null; quieto: boolean }) {
  const ahora = useAhora(ocupado);
  const canal = canalDe({ ocupado, ajeno, directo });
  const paso = canal === "turno" || canal === "fin" ? pasoDe(ind, ahora) : null;
  const [plegadaSid, setPlegadaSid] = useState(() => PLEGADAS.has(sid));
  const [abierta, setAbierta] = useState<Abierta>(null);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  // El orden que se acaba de pedir, hasta que el main conteste: la fila no vuelve a su lugar por un instante.
  const [pedido, setPedido] = useState<readonly number[] | null>(null);
  const [voz, setVoz] = useState("");
  const raiz = useRef<HTMLDivElement>(null);
  const lis = useRef<HTMLOListElement>(null);
  const focoAgarre = useRef<number | null>(null);

  useEffect(() => setPedido(null), [lista]);

  // Lo que se está tocando no sale de abajo de la mano.
  const retiene = !!abierta || !!arrastre;
  useEffect(() => {
    if (!retiene) return;
    callado(cola.retener(sid, true));
    const iv = setInterval(() => callado(cola.retener(sid, true)), RENOVAR_MS);
    return () => {
      clearInterval(iv);
      callado(cola.retener(sid, false));
    };
  }, [retiene, sid]);

  // Terminó el paso con la pregunta abierta: ya no hay nada que cortar, sale solo.
  useEffect(() => {
    if (abierta?.tipo === "confirmar" && canal === "ahora") setAbierta(null);
  }, [abierta, canal]);

  // La fila que se cierra le devuelve el foco a su botón.
  const volverFoco = (id: number, sel: string) => requestAnimationFrame(() => raiz.current?.querySelector<HTMLElement>(`[data-fila-cola="${id}"] ${sel}`)?.focus());

  const ordenada = aplicarOrden(lista, pedido);
  const visual = arrastre ? mover(ordenada, arrastre.desde, arrastre.hasta) : ordenada;
  const n = lista.length + camino.length;
  const idFalla = error ? (errorId ?? lista[0]?.id ?? null) : null;
  const posFalla = idFalla === null ? -1 : visual.findIndex((x) => x.id === idFalla);
  const cab = cabecera({ enEspera: lista.length, enCamino: camino.length, fallo: !!error, canal, paso, cortable: !!alParar && !parando });
  const Icono = ICONO[cab.icono];
  const plegada = plegadaSid && n > 1 && !error && !abierta;
  const primero = camino[0] ?? visual[0];

  const plegar = () => {
    const si = !plegada;
    if (si) PLEGADAS.add(sid);
    else PLEGADAS.delete(sid);
    setPlegadaSid(si);
  };

  const quitar = (x: Encolado) => {
    if (abierta?.id === x.id) setAbierta(null);
    callado(cola.quitar(sid, x.id));
  };
  const enviarYa = (x: Encolado) => {
    // Sin nada que cortar no hay nada que preguntar: sale ya.
    if (canal === "ahora") return void Promise.resolve(cola.ya(sid, false)).catch((e) => alError(String((e as Error)?.message ?? e)));
    const cierra = abierta?.tipo === "confirmar" && abierta.id === x.id;
    setAbierta(cierra ? null : { tipo: "confirmar", id: x.id });
    if (cierra) volverFoco(x.id, "[data-enviar-cola]");
  };
  const cortarYEnviar = () => {
    setAbierta(null);
    if (!ajeno) marcarParando(sid);
    void Promise.resolve(cola.ya(sid, true)).catch((e) => alError(String((e as Error)?.message ?? e)));
  };

  // --- Ordenar ---
  const pedirOrden = (ids: number[]) => {
    setPedido(ids);
    callado(cola.ordenar(sid, ids));
  };
  const empezarArrastre = (e: PE<HTMLButtonElement>, x: Encolado, k: number) => {
    if (e.button !== 0 || visual.length < 2 || abierta) return;
    const ol = lis.current;
    if (!ol) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura, el arrastre sigue por los eventos del propio agarre.
    }
    const filas = [...ol.querySelectorAll<HTMLElement>(":scope > [data-en-lista]")];
    setArrastre({ id: x.id, desde: k, hasta: k, dy: 0, alturas: filas.map((f) => f.getBoundingClientRect().height), gap: parseFloat(getComputedStyle(ol).rowGap) || 0, y0: e.clientY, scroll0: ol.scrollTop });
  };
  const moverArrastre = (e: PE<HTMLButtonElement>) => {
    setArrastre((a) => {
      if (!a) return a;
      const dy = e.clientY - a.y0 + (lis.current?.scrollTop ?? a.scroll0) - a.scroll0;
      return { ...a, dy, hasta: destinoArrastre(a.alturas, a.desde, dy, a.gap) };
    });
  };
  const soltar = (x: Encolado) => {
    const a = arrastre;
    setArrastre(null);
    if (!a || a.desde === a.hasta || a.id !== x.id) return;
    pedirOrden(mover(ordenada, a.desde, a.hasta).map((y) => y.id));
    setVoz(t("cola.movido", { n: a.hasta + camino.length + 1, total: n }));
  };
  // Esc suelta la fila donde estaba.
  const arrastrando = !!arrastre;
  useEffect(() => {
    if (!arrastrando) return;
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setArrastre(null);
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [arrastrando]);
  // También con el teclado: flechas sobre el agarre (arrastrar no es la única forma).
  const teclaAgarre = (e: KeyboardEvent<HTMLButtonElement>, x: Encolado, k: number) => {
    const destino = e.key === "ArrowUp" ? k - 1 : e.key === "ArrowDown" ? k + 1 : -1;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    if (destino < 0 || destino >= visual.length) return;
    focoAgarre.current = x.id;
    pedirOrden(mover(visual, k, destino).map((y) => y.id));
    setVoz(t("cola.movido", { n: destino + camino.length + 1, total: n }));
  };
  useLayoutEffect(() => {
    const id = focoAgarre.current;
    if (id === null) return;
    focoAgarre.current = null;
    raiz.current?.querySelector<HTMLElement>(`[data-fila-cola="${id}"] [data-agarre]`)?.focus();
  });

  const conf = abierta?.tipo === "confirmar" ? confirmacion({ canal, paso, n }) : null;
  const larga = n > FILAS_SIN_SCROLL;

  const fila = (x: Encolado, k: number, enCamino: boolean) => {
    const a = arrastre?.id === x.id ? arrastre : null;
    return (
      <Fila
        key={(enCamino ? "c" : "") + x.id}
        x={x}
        numero={(enCamino ? k : camino.length + k) + 1}
        solo={n === 1}
        enCamino={enCamino}
        fallo={!enCamino && x.id === idFalla ? textoMain(error) : null}
        espera={!enCamino && idFalla !== null && x.id !== idFalla ? posFalla + camino.length + 1 : null}
        puedeOrdenar={!enCamino && lista.length > 1 && !abierta}
        puedeEnviar={canal !== "ahora" || !enCamino}
        editando={abierta?.tipo === "editar" && abierta.id === x.id}
        confirmando={abierta?.tipo === "confirmar" && abierta.id === x.id ? conf : null}
        alza={a ? a.dy - corrimiento(a.alturas, a.desde, a.hasta, a.gap) : null}
        quieto={quieto}
        ligada={!arrastre}
        alEditar={() => setAbierta({ tipo: "editar", id: x.id })}
        alCerrarEditor={() => {
          setAbierta(null);
          volverFoco(x.id, "[data-editar-cola]");
        }}
        sid={sid}
        alQuitar={() => quitar(x)}
        alEnviarYa={() => enviarYa(x)}
        alReintentar={() => callado(cola.ya(sid, false))}
        alSeguir={() => {
          setAbierta(null);
          volverFoco(x.id, "[data-enviar-cola]");
        }}
        alCortar={cortarYEnviar}
        agarre={{
          onPointerDown: (e) => empezarArrastre(e, x, k),
          onPointerMove: moverArrastre,
          onPointerUp: () => soltar(x),
          onPointerCancel: () => setArrastre(null),
          onKeyDown: (e) => teclaAgarre(e, x, k),
        }}
        alAbrirHilo={alAbrirHilo}
      />
    );
  };

  return (
    <div ref={raiz} className="band" data-tono={cab.tono} data-plegada={plegada ? "" : undefined}>
      <div className="band-tope">
        <div className="band-tab" role="status">
          <Icono size={14} strokeWidth={2.2} aria-hidden="true" />
          <b>{cab.titulo}</b>
          {cab.nota ? <span className="band-nota">{cab.nota}</span> : null}
          {cab.tiempo ? <span className="band-nota band-tiempo">{cab.tiempo}</span> : null}
        </div>
        <div className="band-der">
          {plegada && primero ? <span className="band-primero">{resumen(primero)}</span> : null}
          {cab.parar && alParar ? (
            <button type="button" className="band-parar" data-parar-cola onClick={alParar}>
              <Square size={11} strokeWidth={2.4} aria-hidden="true" />
              {t("cola.parar")}
            </button>
          ) : null}
          {n > 1 ? (
            <button type="button" className="band-ic band-chev" data-plegar-cola aria-expanded={!plegada} aria-label={t(plegada ? "cola.abrir" : "cola.plegar")} data-tip={t(plegada ? "cola.abrir" : "cola.plegar")} onClick={plegar}>
              <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="band-hoja">
        <AnimatePresence initial={false}>
          {!plegada ? (
            <motion.div
              key="filas"
              initial={quieto ? false : { height: 0, opacity: 0, overflow: "hidden" }}
              animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
              exit={quieto ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0, overflow: "hidden" }}
              transition={{ duration: quieto ? 0 : 0.16, ease: [0.2, 0, 0, 1] }}
            >
              <motion.ol ref={lis} className="band-lista" data-larga={larga ? "" : undefined} layoutScroll>
                <AnimatePresence initial={false}>
                  {camino.map((x, k) => fila(x, k, true))}
                  {visual.map((x, k) => fila(x, k, false))}
                </AnimatePresence>
              </motion.ol>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <span className="oculto" role="status">
        {voz}
      </span>
    </div>
  );
}

/** Una línea por mensaje, para la solapa plegada. */
function resumen(x: Encolado): string {
  if (x.aviso) return t("cola.aviso");
  const texto = separarAdjuntos(x.texto).texto.trim();
  if (texto) return texto.replace(/\s+/g, " ");
  return sinTexto(x);
}

const sinTexto = (x: Encolado) => {
  const m = x.imagenes?.length ?? 0;
  if (m === 1) return t("cola.imagenUna");
  if (m > 1) return t("cola.imagenN", { n: m });
  return t("cola.soloArchivos");
};

type FilaProps = {
  x: Encolado;
  numero: number;
  solo: boolean;
  enCamino: boolean;
  /** Por qué no salió (el texto ya armado). */
  fallo: string | null;
  /** Espera al que falló: su número. */
  espera: number | null;
  puedeOrdenar: boolean;
  puedeEnviar: boolean;
  editando: boolean;
  confirmando: { titulo: string; cuerpo: string } | null;
  /** Levantada: cuánto se corre de su lugar, siguiendo al puntero. */
  alza: number | null;
  quieto: boolean;
  /** Las demás se acomodan solas; mientras se arrastra, la levantada no. */
  ligada: boolean;
  sid: string;
  alEditar: () => void;
  alCerrarEditor: () => void;
  alQuitar: () => void;
  alEnviarYa: () => void;
  alReintentar: () => void;
  alSeguir: () => void;
  alCortar: () => void;
  agarre: {
    onPointerDown: (e: PE<HTMLButtonElement>) => void;
    onPointerMove: (e: PE<HTMLButtonElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  };
  alAbrirHilo?: (id: string) => void;
};

function Fila(p: FilaProps) {
  const { x, numero, solo, enCamino, fallo, espera, quieto, alza } = p;
  const separado = separarAdjuntos(x.texto);
  const imagenes = x.imagenes ?? [];
  const seguirBtn = useRef<HTMLButtonElement>(null);
  const abierto = !!p.confirmando;
  useEffect(() => {
    if (abierto) seguirBtn.current?.focus();
  }, [abierto]);
  return (
    <motion.li
      className="band-li"
      data-fila-cola={x.id}
      data-en-lista={enCamino ? undefined : ""}
      layout={quieto || alza !== null ? false : "position"}
      initial={quieto ? false : { opacity: 0, height: 0, overflow: "hidden" }}
      animate={{ opacity: 1, height: "auto", transitionEnd: { overflow: "visible" } }}
      exit={quieto ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, overflow: "hidden", transition: { duration: 0.14 } }}
      transition={{ duration: quieto ? 0 : 0.18, ease: [0.2, 0, 0, 1] }}
    >
      {p.editando ? (
        <Editor sid={p.sid} x={x} archivos={separado.archivos} inicial={separado.texto} alCerrar={p.alCerrarEditor} />
      ) : (
        <div
          className="band-fila"
          data-solo={solo ? "" : undefined}
          data-fallo={fallo !== null ? "" : undefined}
          data-espera={espera !== null ? "" : undefined}
          data-camino={enCamino ? "" : undefined}
          data-alza={alza !== null ? "" : undefined}
          style={alza !== null ? { transform: `translateY(${alza}px) rotate(-0.4deg)` } : undefined}
        >
          {solo ? null : enCamino ? (
            <span className="band-agarre" aria-hidden="true" />
          ) : (
            <button type="button" className="band-agarre" data-agarre disabled={!p.puedeOrdenar} aria-label={t("cola.moverN", { n: numero })} data-tip={t("cola.mover")} {...p.agarre}>
              <GripVertical size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          {solo && fallo === null ? null : (
            <span className="band-num" aria-hidden={fallo !== null ? undefined : true}>
              {fallo !== null ? <X size={12} strokeWidth={2.6} aria-label={t("cola.falloNum", { n: numero })} /> : enCamino ? <Send size={11} strokeWidth={2.2} aria-hidden="true" /> : numero}
            </span>
          )}
          <div className="band-cuerpo">
            {x.aviso ? <Sistema s={lineaAviso(x.texto)} alAbrirHilo={p.alAbrirHilo} /> : <Texto texto={separado.texto} vacio={imagenes.length || separado.archivos.length ? sinTexto(x) : ""} />}
            {separado.archivos.length ? (
              <div className="band-archivos">
                {separado.archivos.map((a) => (
                  <span key={a.ruta} className="band-archivo" data-tip={a.ruta}>
                    <FileText size={12} strokeWidth={2} aria-hidden="true" />
                    <span>{a.nombre}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {fallo !== null ? (
              <p className="band-err" role="alert">
                {fallo} {t("cola.guardado")}
              </p>
            ) : null}
          </div>
          {imagenes.length ? <Minis imagenes={imagenes} /> : null}
          <div className="band-acc">
            {enCamino ? (
              <span className="band-esp" data-camino-cola data-tip={t("cola.caminoTip")}>
                {t("cola.caminoUno")}
              </span>
            ) : (
              <>
                {x.aviso ? null : (
                  <button type="button" className="band-ic" data-editar-cola aria-label={t("cola.editar")} data-tip={t("cola.editar")} onClick={p.alEditar}>
                    <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
                <button type="button" className="band-ic" data-borrar-cola aria-label={t("cola.borrar")} data-tip={t("cola.borrar")} onClick={p.alQuitar}>
                  <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </>
            )}
            {fallo !== null ? (
              <button type="button" className="band-prim" data-reintentar-cola onClick={p.alReintentar}>
                <RotateCw size={13} strokeWidth={2.2} aria-hidden="true" />
                {t("lider.colaReintentar")}
              </button>
            ) : espera !== null ? (
              <span className="band-esp">{t("cola.espera", { n: espera })}</span>
            ) : p.puedeEnviar ? (
              <button type="button" className="band-ya" data-enviar-cola data-activo={abierto ? "" : undefined} aria-expanded={abierto} aria-label={t("cola.enviarYa")} data-tip={t("cola.enviarYaTip")} onClick={p.alEnviarYa}>
                <Zap size={13} strokeWidth={2.2} aria-hidden="true" />
                <span>{t("cola.enviarYa")}</span>
              </button>
            ) : null}
          </div>
        </div>
      )}
      <AnimatePresence initial={false}>
        {p.confirmando ? (
          <motion.div
            key="conf"
            className="band-conf-marco"
            initial={quieto ? false : { height: 0, opacity: 0, overflow: "hidden" }}
            animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
            exit={quieto ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0, overflow: "hidden", transition: { duration: 0.12 } }}
            transition={{ duration: quieto ? 0 : 0.16, ease: [0.2, 0, 0, 1] }}
          >
            <div
              className="band-conf"
              role="alertdialog"
              aria-label={p.confirmando.titulo}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                e.stopPropagation();
                p.alSeguir();
              }}
            >
              <div className="band-conf-txt">
                <p className="band-conf-t">
                  <Scissors size={15} strokeWidth={2} aria-hidden="true" />
                  {p.confirmando.titulo}
                </p>
                <p className="band-conf-b">{p.confirmando.cuerpo}</p>
              </div>
              <div className="band-conf-acc">
                <button ref={seguirBtn} type="button" className="band-sec" data-seguir-esperando onClick={p.alSeguir}>
                  {t("cola.seguir")}
                </button>
                <button type="button" className="band-prim" data-cortar-y-enviar onClick={p.alCortar}>
                  {t("cola.cortar")}
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

/** El texto primero: dos líneas, y si hay más, «Ver todo». */
const Texto = memo(function Texto({ texto, vacio }: { texto: string; vacio: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [desborda, setDesborda] = useState(false);
  useLayoutEffect(() => {
    const p = ref.current;
    if (!p || abierto) return;
    const medir = () => setDesborda(p.scrollHeight > p.clientHeight + 1);
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(p);
    return () => ro.disconnect();
  }, [texto, abierto]);
  const limpio = texto.trim();
  if (!limpio) return vacio ? <p className="band-t" data-vacio>{vacio}</p> : null;
  return (
    <>
      <p ref={ref} className="band-t" data-abierto={abierto ? "" : undefined}>
        {limpio}
      </p>
      {desborda || abierto ? (
        <button type="button" className="band-ver" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
          {t(abierto ? "cola.verMenos" : "cola.verTodo")}
        </button>
      ) : null}
    </>
  );
});

/** Después del texto y chicas; un clic, grande. Las que no entran se ven al editar. */
const Minis = memo(function Minis({ imagenes }: { imagenes: readonly Imagen[] }) {
  const [abierta, setAbierta] = useState<Imagen | null>(MODO.captura === "lider-cola" && MODO.variante === "visor" ? (imagenes[0] ?? null) : null);
  const ven = imagenes.slice(0, MINIS_MAX);
  const mas = imagenes.length - ven.length;
  return (
    <div className="band-minis">
      {ven.map((img, k) => (
        <button key={k} type="button" className="band-mini" data-mini-cola aria-label={t("adjunto.ver")} data-tip={t("adjunto.ver")} onClick={() => setAbierta(img)}>
          <img src={urlDe(img)} alt="" decoding="async" />
          {mas > 0 && k === ven.length - 1 ? <span className="band-mas">+{mas}</span> : null}
        </button>
      ))}
      {abierta ? <Visor img={abierta} alCerrar={() => setAbierta(null)} /> : null}
    </div>
  );
});

/** Editar en su lugar: Enter guarda, Shift+Enter baja de línea, Esc cancela. Las imágenes se pueden sacar. */
function Editor({ sid, x, inicial, archivos, alCerrar }: { sid: string; x: Encolado; inicial: string; archivos: readonly { nombre: string; ruta: string }[]; alCerrar: () => void }) {
  const corrige = useCorrector();
  const [texto, setTexto] = useState(inicial.trim());
  const [sin, setSin] = useState<readonly number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const imagenes = x.imagenes ?? [];
  const quedan = imagenes.length - sin.length;
  const vacio = !texto.trim() && !quedan && !archivos.length;
  useEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.focus({ preventScroll: true });
    c.setSelectionRange(c.value.length, c.value.length);
  }, []);
  const guardar = () => {
    if (vacio || guardando) return;
    setGuardando(true);
    setError(null);
    const lineas = archivos.map((a) => t("adjunto.linea", { ruta: a.ruta })).join("\n");
    const final = [texto.trim(), lineas].filter(Boolean).join("\n\n");
    Promise.resolve(cola.editar(sid, x.id, final, [...sin]))
      .then(() => alCerrar())
      .catch((e) => {
        setGuardando(false);
        setError(textoMain(String((e as Error)?.message ?? e)));
      });
  };
  return (
    <div
      className="band-editor"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        alCerrar();
      }}
    >
      {imagenes.length ? (
        <div className="band-editor-minis">
          {imagenes.map((img, k) =>
            sin.includes(k) ? null : (
              <div key={k} className="band-mini" data-en-editor>
                <img src={urlDe(img)} alt="" decoding="async" />
                <button type="button" className="band-mini-x" aria-label={t("adjunto.quitar")} data-tip={t("adjunto.quitar")} onClick={() => setSin((s) => [...s, k])}>
                  <X size={10} strokeWidth={2.6} aria-hidden="true" />
                </button>
              </div>
            ),
          )}
        </div>
      ) : null}
      <textarea
        ref={campo}
        className="band-campo"
        rows={1}
        spellCheck={corrige}
        value={texto}
        aria-label={t("cola.editarCampo")}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            guardar();
          }
        }}
      />
      {error ? (
        <p className="band-err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="band-editor-acc">
        <button type="button" className="band-sec" data-cancelar-editor onClick={alCerrar}>
          {t("cola.cancelar")}
        </button>
        <button type="button" className="band-guardar" data-guardar-editor disabled={vacio || guardando} onClick={guardar}>
          {t("cola.guardar")}
        </button>
      </div>
    </div>
  );
}
