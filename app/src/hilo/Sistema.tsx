// Lo de sistema en la conversación (B18, src/hilo/sistema-logica.ts), en la vista de
// un worker y en el chat de un líder: lo que dice Claude Code, una línea chica
// con su ícono (rojo el límite y los errores, gris lo demás); lo que inyecta
// como si fuera del usuario, una tarjeta centrada y plegada que al abrirse
// muestra el texto crudo. Compactar y venir de un relevo (B19), un divisor gris
// que se abre al resumen o al pedido del relevo. Y un aviso de Trama (un worker
// que terminó o falló): una tarjeta con la campana y una fila por worker (estado con
// ícono y palabra, la tarea y Abrir, que abre su hilo; el id va en el tooltip).
import { memo, useState } from "react";
import {
  BellRing,
  ChevronRight,
  CircleSlash,
  FileText,
  FoldVertical,
  Hourglass,
  Image,
  ArrowRightLeft,
  Info,
  LifeBuoy,
  MessagesSquare,
  Puzzle,
  Repeat,
  RotateCw,
  ScrollText,
  Settings2,
  SquareSlash,
  SquareTerminal,
  TriangleAlert,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { locale, t, type ClaveSola } from "../i18n";
import { IcActividad, IcDecidir, IcFallo, IcOk, IcProbar } from "../ui/iconos";
import { fuente } from "../datos/fuente";
import { mensaje } from "../puente";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { hora } from "./Hace";
import { Boton } from "../ui/componentes";
import { nombreModelo } from "./opciones";
import type { AvisoTexto } from "../../electron/avisos-worker.ts";
import type { ClaseTarjeta, EstadoFilaAviso, Linea, Sistema as S, Tarjeta } from "./sistema-logica";
import { filasDeAviso, tonoDeEstado } from "./sistema-logica";
import "./atencion.css";

const ICONO: Record<ClaseTarjeta, LucideIcon> = {
  skill: Puzzle,
  tarea: BellRing,
  mensaje: MessagesSquare,
  comando: SquareSlash,
  salida: SquareTerminal,
  caveat: Info,
  recordatorio: ScrollText,
  resumen: FileText,
  hook: Webhook,
  continua: RotateCw,
  imagen: Image,
  meta: Settings2,
};

const ESTADO: Record<string, ClaveSola> = {
  completed: "sistema.tareaOk",
  failed: "sistema.tareaFallo",
  error: "sistema.tareaFallo",
  killed: "sistema.tareaParada",
  stopped: "sistema.tareaParada",
  cancelled: "sistema.tareaParada",
};

type LineaChica = Exclude<Linea, { clase: "compacto" | "viene" | "destrabo" | "cambio" | "aviso" }>;

function textoLinea(s: LineaChica): { texto: string; grave: boolean; Icono: LucideIcon } {
  switch (s.clase) {
    case "limite":
      return {
        texto: s.hasta !== null ? t(s.semana ? "sistema.limiteSemana" : "sistema.limite", { h: hora(s.hasta) }) : s.texto,
        grave: true,
        Icono: Hourglass,
      };
    case "error":
      return { texto: s.texto, grave: true, Icono: TriangleAlert };
    case "nota":
      return { texto: s.texto, grave: false, Icono: Info };
    case "interrumpido":
      return { texto: t(/tool use/.test(s.texto) ? "sistema.interrumpidoHerr" : "sistema.interrumpido"), grave: false, Icono: CircleSlash };
  }
}

/** Un divisor gris a lo ancho; con `crudo`, se abre a él (lo de adentro se arma al abrir). */
/** Cuándo siguió con otro modelo: la hora si fue hoy, si no el día y la hora. */
function horaDelCambio(ts: string | null): string {
  const ms = ts ? Date.parse(ts) : NaN;
  if (!Number.isFinite(ms)) return "";
  const h = hora(ms / 1000);
  const f = new Date(ms);
  return f.toDateString() === new Date().toDateString() ? h : `${f.toLocaleDateString(locale(), { day: "numeric", month: "short" })} ${h}`;
}

function Divisor({ Icono, texto, crudo }: { Icono: LucideIcon; texto: string; crudo: string | null }) {
  const [abierta, setAbierta] = useState(false);
  if (!crudo?.trim())
    return (
      <div className="sis-div">
        <span className="sis-div-t">
          <Icono size={12} strokeWidth={2} />
          <span>{texto}</span>
        </span>
      </div>
    );
  return (
    <details className="sis-div" open={abierta} onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary className="sis-div-t">
        <Icono size={12} strokeWidth={2} />
        <span>{texto}</span>
        <ChevronRight className="sis-f" size={11} strokeWidth={2} />
      </summary>
      {abierta ? <pre>{crudo.trim()}</pre> : null}
    </details>
  );
}

function etiqueta(s: Tarjeta): string {
  const d = s.dato;
  switch (s.clase) {
    case "skill":
      return d ? t("sistema.skill", { n: d }) : t("sistema.skillSin");
    case "tarea": {
      const base = d ? t("sistema.tarea", { d }) : t("sistema.tareaSin");
      const e = s.estado ? (ESTADO[s.estado] ? t(ESTADO[s.estado]) : s.estado) : null;
      return e ? `${base} (${e})` : base;
    }
    case "mensaje":
      return d ? t("sistema.mensaje", { n: d }) : t("sistema.mensajeSin");
    case "comando":
      return d ? t("sistema.comando", { c: d }) : t("sistema.comandoSin");
    case "salida":
      return d ? t("sistema.salida", { d }) : t("sistema.salidaSin");
    default:
      return t(SOLA[s.clase]);
  }
}

const SOLA: Record<Exclude<ClaseTarjeta, "skill" | "tarea" | "mensaje" | "comando" | "salida">, ClaveSola> = {
  caveat: "sistema.caveat",
  recordatorio: "sistema.recordatorio",
  resumen: "sistema.resumen",
  hook: "sistema.hook",
  continua: "sistema.continua",
  imagen: "sistema.imagen",
  meta: "sistema.meta",
};

function Tarjeta_({ s }: { s: Tarjeta }) {
  // Captura con `HILOS_VARIANTE=abierta`: la de la skill, abierta.
  const [abierta, setAbierta] = useState(() => MODO.captura !== null && MODO.variante === "abierta" && s.clase === "skill");
  const Icono = ICONO[s.clase];
  return (
    <details className="sis-t" open={abierta} onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary>
        <Icono size={12} strokeWidth={2} />
        <span>{etiqueta(s)}</span>
        <ChevronRight className="sis-f" size={11} strokeWidth={2} />
      </summary>
      {/* El texto crudo se arma recién al abrir: el resumen de compactar pesa. */}
      {abierta ? <pre>{s.crudo.trim()}</pre> : null}
    </details>
  );
}

/** Ícono y palabra de cada estado de un worker en un aviso: la palabra va siempre, el color (`tonoDeEstado`) sólo la acompaña. */
const ESTADO_AVISO: Record<EstadoFilaAviso, { Icono: LucideIcon; rotulo: ClaveSola }> = {
  termino: { Icono: IcOk, rotulo: "sistema.avisoTermino" },
  sinResumen: { Icono: FileText, rotulo: "sistema.avisoSinResumen" },
  decision: { Icono: IcDecidir, rotulo: "sistema.avisoChipDecision" },
  faltaInfo: { Icono: Info, rotulo: "sistema.avisoFaltaInfo" },
  falla: { Icono: IcFallo, rotulo: "sistema.avisoFallo" },
  probar: { Icono: IcProbar, rotulo: "sistema.avisoProbar" },
  corre: { Icono: IcActividad, rotulo: "sistema.avisoCorre" },
};

/**
 * Una fila por worker, de la misma altura para todos: ícono y palabra de su estado, la tarea (entera al pasar el mouse) y, en la
 * misma línea, Relanzar si falló y «Abrir», que abre su hilo (el id va en su tooltip). No tiene fondo ni borde propios.
 */
function FilaAviso({ x, alAbrirHilo }: { x: { id: string; tarea: string; falla: boolean; estado: EstadoFilaAviso }; alAbrirHilo?: (id: string) => void }) {
  const { Icono, rotulo } = ESTADO_AVISO[x.estado];
  const falla = x.estado === "falla";
  const [relanzo, setRelanzo] = useState<"relanzando" | "hecho" | { error: string } | null>(null);
  const relanzar = () => {
    setRelanzo("relanzando");
    fuente.relanzarWorker(x.id).then(
      () => setRelanzo("hecho"),
      (e) => setRelanzo({ error: mensaje(e) }),
    );
  };
  const tarea = `«${x.tarea}»`;
  return (
    <li className="sis-aviso-fila" data-estado={x.estado}>
      <div className="sis-aviso-linea">
        <span className="sis-aviso-e" data-tono={tonoDeEstado(x.estado)}>
          <Icono size={13} strokeWidth={2.2} aria-hidden="true" />
          <span>{t(rotulo)}</span>
        </span>
        <span className="sis-aviso-tarea" title={tarea}>
          {tarea}
        </span>
        {falla ? (
          <button type="button" className="sis-aviso-r" disabled={relanzo === "relanzando" || relanzo === "hecho"} data-tip={t("avisoW.relanzarTip")} onClick={relanzar}>
            <RotateCw size={12} strokeWidth={2.2} aria-hidden="true" />
            {t(relanzo === "relanzando" ? "avisoW.relanzando" : relanzo === "hecho" ? "avisoW.relanzado" : "sistema.avisoRelanzar")}
          </button>
        ) : null}
        {alAbrirHilo ? (
          <button type="button" className="sis-aviso-ver" data-tip={t("sistema.avisoVer", { id: x.id })} aria-label={t("sistema.avisoAbrir", { id: x.id })} onClick={() => alAbrirHilo(x.id)}>
            {t("sistema.avisoAbrirCorto")}
          </button>
        ) : null}
      </div>
      {relanzo && typeof relanzo === "object" ? (
        <div className="caja-error" role="alert">
          {t("avisoW.relanzarFallo", { e: relanzo.error })}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Un aviso de Trama: la campana y "Trama · Aviso"; después, una fila por worker. Primero las que piden decisión, después las que
 * fallaron y las terminadas. Con más de cinco filas, las terminadas se pliegan en «N terminados» (desplegable, cerrado).
 */
function Aviso({ a, alAbrirHilo }: { a: AvisoTexto; alAbrirHilo?: (id: string) => void }) {
  const fallas = a.trabajos.filter((x) => x.falla).length;
  const { visibles, plegadas } = filasDeAviso(a.trabajos);
  return (
    <div className="sis-aviso">
      <div className="sis-aviso-h">
        <BellRing size={12} strokeWidth={2} aria-hidden="true" />
        <span>{t("sistema.avisoRotulo")}</span>
      </div>
      {a.tanda ? <span>{`${t("sistema.avisoTanda", { n: a.trabajos.length })}${fallas ? ` · ${t("sistema.avisoFallas", { k: fallas })}` : ""}`}</span> : null}
      {a.trabajos.length ? (
        <>
          {visibles.length ? (
            <ul className="sis-aviso-l">
              {visibles.map((x) => (
                <FilaAviso key={x.id} x={x} alAbrirHilo={alAbrirHilo} />
              ))}
            </ul>
          ) : null}
          {plegadas.length ? (
            <details className="sis-aviso-pliegue">
              <summary>
                <ChevronRight className="sis-aviso-flecha" size={11} strokeWidth={2} aria-hidden="true" />
                <span>{plegadas.length === 1 ? t("sistema.avisoPliegueUno") : t("sistema.avisoPliegue", { n: plegadas.length })}</span>
              </summary>
              <ul className="sis-aviso-l">
                {plegadas.map((x) => (
                  <FilaAviso key={x.id} x={x} alAbrirHilo={alAbrirHilo} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <span className="sis-aviso-tarea">{t("sistema.avisoSin")}</span>
      )}
    </div>
  );
}

/** `nombre`: el del líder, para "Viene de …" (los workers no tienen relevo). `alAbrirHilo`: abre el hilo de un worker (los ids de un aviso). */
type Props = {
  s: S;
  nombre?: string | null;
  alAbrirHilo?: (id: string) => void;
  /** «Seguir con otro modelo» (#1791): lo ofrece la línea del último límite de uso, mientras el líder no trabaja. */
  alSeguir?: () => void;
};

/** Cada pasada de `turnos()` arma objetos nuevos: lo de un mismo mensaje no cambia (el crudo, sin serializar: pesa). */
const igual = ({ s: a, nombre: na, alAbrirHilo: ha, alSeguir: sa }: Props, { s: b, nombre: nb, alAbrirHilo: hb, alSeguir: sb }: Props) =>
  na === nb &&
  ha === hb &&
  !sa === !sb &&
  (a === b ||
  (a.tipo === "tarjeta" && b.tipo === "tarjeta"
    ? a.clase === b.clase && a.dato === b.dato && a.estado === b.estado && a.crudo === b.crudo
    : a.tipo === "linea" && b.tipo === "linea" && JSON.stringify(a) === JSON.stringify(b)));

/** Una línea o una tarjeta de sistema. */
export const Sistema = memo(function Sistema({ s, nombre, alAbrirHilo, alSeguir }: Props) {
  useIdioma();
  if (s.tipo === "tarjeta") return <Tarjeta_ s={s} />;
  if (s.clase === "compacto") {
    const k = s.antes ? t("aviso.antes", { k: Math.max(1, Math.round(s.antes / 1000)) }) : "";
    return <Divisor Icono={FoldVertical} texto={t(s.auto ? "sistema.compactadaAuto" : "sistema.compactada") + k} crudo={s.resumen ?? null} />;
  }
  if (s.clase === "cambio") {
    const h = horaDelCambio(s.ts);
    return <Divisor Icono={ArrowRightLeft} texto={s.modelo ? t("sistema.cambio", { m: nombreModelo(s.modelo), h }) : t("sistema.cambioSin", { h })} crudo={null} />;
  }
  if (s.clase === "destrabo")
    return <Divisor Icono={LifeBuoy} texto={t(s.agotado ? "hz.destraboTope" : "hz.destrabo", { que: s.que })} crudo={null} />;
  if (s.clase === "viene")
    return <Divisor Icono={Repeat} texto={nombre ? t("relevo.viene", { n: nombre }) : t("relevo.vieneSin")} crudo={s.texto} />;
  if (s.clase === "aviso") return <Aviso a={s.aviso} alAbrirHilo={alAbrirHilo} />;
  const { texto, grave, Icono } = textoLinea(s);
  // El límite dice la hora en palabras de la app; el texto de `claude`, al pasar el mouse.
  const crudo = s.clase === "limite" && s.hasta !== null ? s.texto : undefined;
  return (
    <div className="sis" data-tono={grave ? "grave" : undefined} data-tip={crudo}>
      <Icono size={12} strokeWidth={2} />
      <span>{texto}</span>
      {alSeguir && s.clase === "limite" ? (
        <Boton type="button" className="aviso-accion aviso-seguir" data-seguir-con onClick={alSeguir}>
          <ArrowRightLeft size={12} strokeWidth={2} aria-hidden="true" />
          {t("aviso.seguir")}
        </Boton>
      ) : null}
    </div>
  );
}, igual);
