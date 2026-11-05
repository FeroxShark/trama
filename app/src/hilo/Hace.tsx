// Lo que un líder de la app está haciendo mientras responde (B12): la tarjeta
// del chat (src/hilo/Actividad.tsx) y el de su fila en la barra, y los avisos en línea del turno (reintentos, límite,
// errores, compactar, el proceso que se muere). Cada pieza se suscribe sólo a
// lo suyo de src/hilo/vivo.ts: el texto que llega no las repinta.
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { ArrowRightLeft } from "lucide-react";
import type { HaceLider } from "../datos/contrato";
import { Reloj } from "../barra/piezas";
import { pintorDura } from "../tiempo";
import { Boton } from "../ui/componentes";
import { EVENTO_CAMBIAR_MODELO, esAvisoSinCupoOpencode } from "./agotados";
import { coma, diaSemana, locale, t, textoError } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mostrarTip } from "../barra/tooltip";
import type { AvisoVisto } from "./avisos";
import { MODO } from "../modo";
import { nombreModelo } from "./opciones";
import { ofreceSeguir } from "./seguir-con";
import { Tierno, useTiernos } from "./Tierno";
import { Compactando } from "./Posta";
import { Actividad } from "./Actividad";
import { clasificar, clasificarPedido, cuentaTokens, SIN_NOVEDADES_MS } from "./actividad-logica";
import { comandoCrudo, enCurso, indicador, lineasDelTurno, pensandoAhora, quietoDesde, razona, suscribir, type Indicador } from "./vivo";

const LEER = new Set(["Read", "WebFetch", "NotebookRead"]);
const EDITAR = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const BUSCAR = new Set(["Grep", "Glob", "WebSearch", "ToolSearch"]);
const DELEGAR = new Set(["Task", "Agent"]);
/** Lo que no dice nada concreto: con los mensajes tiernos prendidos lo reemplaza la frase. */
const GENERICO = new Set<HaceLider["que"]>(["pidiendo", "pensando", "escribiendo"]);

/** "Thinking", "Running Bash: git status", "Reading /x/y.ts"… */
export function textoHace(h: HaceLider): string {
  if (h.que !== "herramienta") return t(`hace.${h.que}`);
  const { nombre: n, detalle: d } = h;
  if (n === "Bash") return t("hace.correr", { h: d ? `Bash: ${d}` : "Bash" });
  if (!d) return t("hace.usar", { h: n });
  if (LEER.has(n)) return t("hace.leer", { d });
  if (EDITAR.has(n)) return t("hace.editar", { d });
  if (BUSCAR.has(n)) return t("hace.buscar", { d });
  if (DELEGAR.has(n)) return t("hace.delegar", { d });
  return t("hace.usar", { h: `${n}: ${d}` });
}

const miles = (n: number) => (n < 1000 ? String(n) : coma(`${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`));

/** La hora en que se reinicia un límite: "19:00", o con el día si falta más de un día. */
export function hora(hasta: number) {
  const f = new Date(hasta * 1000);
  // es-AR da "04:50 p. m.": en español, 24 h ("16:50").
  const l = locale();
  const h = f.toLocaleTimeString(l, { hour: "2-digit", minute: "2-digit", ...(l === "en-US" ? {} : { hourCycle: "h23" as const }) });
  return hasta - Date.now() / 1000 > 86_400 ? `${diaSemana(f)} ${h}` : h;
}

const ventana = (v: string | null) =>
  v === "five_hour" ? t("aviso.v5h") : v?.startsWith("seven_day") ? t("aviso.vSemana") : t("aviso.vOtro");

/** El aviso en palabras. `grave`: en rojo; `ojo`: en ámbar; si no, gris. */
export function textoAviso(a: AvisoVisto): { texto: string; tono: "grave" | "ojo" | null } {
  switch (a.clase) {
    case "reintento": {
      const s = Math.max(1, Math.round(a.espera_ms / 1000));
      const vars = { i: a.intento, max: a.max, s };
      if (a.estado === 529 || a.error === "overloaded") return { texto: t("aviso.sobrecarga", vars), tono: "ojo" };
      return { texto: t("aviso.reintento", { ...vars, e: a.estado ? ` ${a.estado}` : "" }), tono: "ojo" };
    }
    case "limite": {
      const v = ventana(a.ventana);
      const h = a.hasta ? hora(a.hasta) : null;
      if (a.rechazado)
        return { texto: h ? t("aviso.limite", { v, h }) : t("aviso.limiteSinHora", { v }), tono: "grave" };
      if (a.uso === null) return { texto: v, tono: "ojo" };
      const p = Math.round(a.uso <= 1 ? a.uso * 100 : a.uso);
      return { texto: h ? t("aviso.limiteCerca", { v, p, h }) : t("aviso.limiteCercaSinHora", { v, p }), tono: "ojo" };
    }
    case "error":
      return { texto: textoError(a.texto), tono: "grave" };
    case "compacto":
      return {
        texto: t(a.auto ? "aviso.compactoAuto" : "aviso.compacto") + (a.antes ? t("aviso.antes", { k: Math.max(1, Math.round(a.antes / 1000)) }) : ""),
        tono: null,
      };
    case "nota":
      return { texto: a.texto, tono: a.grave ? "grave" : "ojo" };
    case "cuenta":
      return { texto: t("aviso.cuenta"), tono: "ojo" };
    case "modelo":
      return { texto: t("aviso.modelo", { de: nombreModelo(a.de), a: nombreModelo(a.a) }), tono: "ojo" };
    case "salio": {
      const base = a.codigo ? t("aviso.salio", { c: a.codigo }) : t("aviso.murio");
      return { texto: a.texto ? `${base}: ${textoError(a.texto)}` : base, tono: "grave" };
    }
  }
}

/**
 * Los avisos del turno, uno por línea. `volverA`: el nombre de una cuenta de Claude si sigue conectada (null si no); `alVolver` la elige (el aviso de otra
 * cuenta ofrece «Volver a …»). `alSeguir`: abre «Seguir con otro modelo» (#1791); lo ofrecen los avisos que cortan por límite o por falta de cupo.
 */
export function Avisos({
  avisos,
  volverA,
  alVolver,
  alSeguir,
  deshabilitado,
}: {
  avisos: AvisoVisto[];
  volverA?: (id: string) => string | null;
  alVolver?: (id: string) => void;
  alSeguir?: () => void;
  deshabilitado?: boolean;
}) {
  useIdioma();
  const vis = avisos.filter((a) => !a.oculto);
  if (!vis.length) return null;
  return (
    <div className="avisos" role="status">
      {vis.map((a, i) => {
        const { texto, tono } = textoAviso(a);
        // La cuenta de antes (si Trama la cambió y sigue conectada): «Volver a …», apagado mientras el líder trabaja.
        const anterior = a.clase === "cuenta" ? a.anterior : null;
        const nombre = anterior && volverA ? volverA(anterior) : null;
        return (
          <div key={`${a.clase}:${i}`} className="aviso" data-tono={tono ?? undefined}>
            {texto}
            {a.clase === "error" && esAvisoSinCupoOpencode(a.texto) ? (
              <Boton type="button" className="aviso-accion" onClick={() => window.dispatchEvent(new Event(EVENTO_CAMBIAR_MODELO))}>
                {t("aviso.cambiarModelo")}
              </Boton>
            ) : null}
            {alSeguir && ofreceSeguir(a) ? (
              <Boton type="button" className="aviso-accion aviso-seguir" data-seguir-con onClick={alSeguir}>
                <ArrowRightLeft size={13} strokeWidth={2.2} aria-hidden="true" />
                {t("aviso.seguir")}
              </Boton>
            ) : null}
            {anterior && nombre && alVolver ? (
              <Boton type="button" className="aviso-accion" disabled={deshabilitado} onClick={() => alVolver(anterior)}>
                {t("aviso.cuentaVolver", { cuenta: nombre })}
              </Boton>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const useIndicador = (sid: string) =>
  useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => indicador(sid),
  );

/** Los pedidos de permiso sin contestar de un líder: mientras hay uno, la tarjeta dice "Te necesita". */
const usePide = (sid: string) =>
  useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => enCurso(sid).pide,
  );

/** ¿Este líder deja ver su razonamiento (ya llegó alguno)? Si sí, la tarjeta lo muestra en vez de la frase tierna. */
export const useRazona = (sid: string) =>
  useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => razona(sid),
  );

/** Los pensamientos terminados y las herramientas del turno en curso, en orden (el arreglo es estable mientras no llega otro mensaje). */
const useLineas = (sid: string) =>
  useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => lineasDelTurno(sid),
  );

/** El pensamiento que todavía llega (un texto: el snapshot es estable mientras no llega más). */
const usePensando = (sid: string) =>
  useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => pensandoAhora(sid),
  );

/** La captura `lider-trabajando` con `HILOS_VARIANTE=quieto`: un comando callado hace 2 min. */
const QUIETO_FIJO = Date.now() - SIN_NOVEDADES_MS - 5000;

/**
 * Hace 2 min que no llega salida ni tokens: desde cuándo (ms); si no, `null`. No repinta con cada delta (el valor no cambia mientras hay
 * novedades); un timer lo vuelve a mirar cuando vence el plazo, porque justamente no va a llegar ningún evento que avise.
 */
function useSilencioDesde(sid: string): number | null {
  const [, mirar] = useReducer((n: number) => n + 1, 0);
  const desde = useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => quietoDesde(sid),
  );
  useEffect(() => {
    const e = enCurso(sid);
    if (desde !== null || !e.ind.hace) return;
    const id = setTimeout(mirar, Math.max(250, e.novedad + SIN_NOVEDADES_MS - Date.now()));
    return () => clearTimeout(id);
  });
  if (MODO.captura === "lider-trabajando" && MODO.variante === "quieto") return QUIETO_FIJO;
  return desde;
}

/**
 * Un comando o herramienta andando puede tardar muchos minutos sin soltar nada (un build, una descarga): eso no es un cuelgue, así que no
 * va como «Sin novedades» (pausa, Parar resaltado). Queda `quieto` sólo para lo demás (el modelo callado) y `callado` para la herramienta:
 * la tarjeta sigue como trabajando y agrega, en neutro, hace cuánto no sale nada.
 */
export function useSilencio(sid: string): { quieto: number | null; callado: number | null } {
  const d = useSilencioDesde(sid);
  const herramienta = enCurso(sid).ind.hace?.que === "herramienta";
  return { quieto: herramienta ? null : d, callado: herramienta ? d : null };
}

export const useQuietoDesde = (sid: string): number | null => useSilencio(sid).quieto;

const MS_PLIEGUE = 200;
const reducido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Debajo de la conversación, mientras responde: la tarjeta viva (src/hilo/Actividad.tsx). Al terminar se pliega; si el turno falló, queda abierta con el error (`error`: los avisos que lo cuentan). */
export function HaceChat({ sid, modelo, effort, piensa = false, error }: { sid: string; modelo?: string | null; effort?: string | null; piensa?: boolean; error?: ReactNode }) {
  useIdioma();
  const ind = useIndicador(sid);
  const pide = usePide(sid);
  const tierno = useTiernos();
  const sub = useCallback((fn: () => void) => suscribir(sid, fn), [sid]);
  const salida = useSyncExternalStore(sub, () => enCurso(sid).salida);
  const crudo = useSyncExternalStore(sub, () => comandoCrudo(sid));
  const fin = useSyncExternalStore(sub, () => enCurso(sid).fin);
  const { quieto, callado } = useSilencio(sid);
  // Un motor que deja ver su razonamiento (Gemini, o Claude con el suyo; se sabe por el modelo o porque ya llegó uno): el progreso
  // del turno en "Ver todo" (pensamientos plegados y herramientas, en orden), en vez de la frase tierna. Los que no lo traen siguen como siempre.
  const razonaYa = useRazona(sid);
  const veRazon = piensa || razonaYa;
  const lineas = useLineas(sid);
  const pensando = usePensando(sid);
  // Vive acá, no en la tarjeta: quien lo abrió lo sigue viendo abierto en el próximo turno.
  const [abierto, setAbierto] = useState(MODO.captura === "lider-trabajando" && MODO.variante === "detalle");
  // Lo último que se pintó, para que la tarjeta se pliegue al terminar el turno en vez de desaparecer de golpe.
  const ultima = useRef<ComponentProps<typeof Actividad> | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const trabaja = !!ind.hace && ind.hace.que !== "compactando";
  const falla = fin?.estado === "error";
  // Captura `detalle`: abierta y con el tooltip del pie (en captura el mouse no cuenta y los tooltips no se arman).
  useEffect(() => {
    if (MODO.captura !== "lider-trabajando" || MODO.variante !== "detalle") return;
    const id = setTimeout(() => {
      const pie = document.querySelector(".tv-modelo");
      if (pie) mostrarTip(pie);
    }, 400);
    return () => clearTimeout(id);
  }, []);
  useLayoutEffect(() => {
    if (trabaja) return void setSaliendo(false);
    if (!ultima.current || falla || reducido()) return void (ultima.current = null);
    setSaliendo(true);
    const id = setTimeout(() => {
      ultima.current = null;
      setSaliendo(false);
    }, MS_PLIEGUE);
    return () => clearTimeout(id);
  }, [trabaja, falla]);
  if (falla && !ind.hace) {
    const hizo = fin.hace ?? { que: "pidiendo" as const, nombre: null, detalle: null };
    return (
      <Actividad
        act={clasificar(hizo)}
        hace={fin.hace}
        pasos={fin.pasos}
        pasosN={fin.pasosN}
        desde={null}
        tokens={fin.tokens > 0 ? cuentaTokens(fin.tokens, miles(fin.tokens)) : null}
        modelo={modelo}
        effort={effort}
        salida={fin.salida}
        crudo={crudo}
        abierto={abierto}
        alAbrir={setAbierto}
        fallo={{ dura: fin.dura, error }}
      />
    );
  }
  if (!ind.hace) return saliendo && ultima.current ? <Actividad {...ultima.current} saliendo /> : null;
  // Compactar (B19): su figurita, no la tarjeta.
  if (ind.hace.que === "compactando") return <Compactando />;
  // Un permiso sin contestar manda: el líder está parado esperando al usuario.
  const act = pide.length ? clasificarPedido(pide[0]) : clasificar(ind.hace);
  const generico = !pide.length && GENERICO.has(ind.hace.que);
  const props = {
    act,
    hace: ind.hace,
    pasos: ind.pasos,
    pasosN: ind.pasosN,
    desde: ind.desde,
    tokens: ind.salida > 0 ? cuentaTokens(ind.salida, miles(ind.salida)) : null,
    tierno: tierno && generico && !veRazon ? sid : undefined,
    razon: veRazon ? { lineas, pensando } : undefined,
    modelo,
    effort,
    salida,
    crudo,
    quieto: pide.length ? null : quieto,
    callado: pide.length ? null : callado,
    abierto,
    alAbrir: setAbierto,
  };
  ultima.current = props;
  return <Actividad {...props} />;
}

/** La frase tierna de un líder de la app en la barra, mientras responde y si no hay nada concreto que decir. Va con el nombre: cede antes que él. */
export function FraseFila({ sid }: { sid: string }) {
  const ind: Indicador = useIndicador(sid);
  const tierno = useTiernos();
  if (!tierno || !ind.hace || !GENERICO.has(ind.hace.que)) return null;
  return <Tierno semilla={sid} limpia className="tierno-fila" />;
}

/** La columna del tiempo de un líder de la app en la barra (una línea): mientras responde, cuánto lleva el turno, con lo que hace en el tooltip; si no, `quieto` (el "hace X" de siempre). */
export function TiempoFila({ sid, quieto }: { sid: string; quieto: ReactNode }) {
  useIdioma();
  const ind: Indicador = useIndicador(sid);
  const dura = useMemo(() => (ind.desde !== null ? pintorDura(ind.desde) : null), [ind.desde]);
  if (!ind.hace || ind.hace.que === "compactando" || !dura) return <>{quieto}</>;
  return <Reloj pintor={dura} className="cuando" data-tip={textoHace(ind.hace)} />;
}
