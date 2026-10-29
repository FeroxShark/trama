// Lo de sistema en la conversación (B18, src/hilo/sistema-logica.ts), en la vista de
// un worker y en el chat de un líder: lo que dice Claude Code, una línea chica
// con su ícono (rojo el límite y los errores, gris lo demás); lo que inyecta
// como si fuera del usuario, una tarjeta centrada y plegada que al abrirse
// muestra el texto crudo. Compactar y venir de un relevo (B19), un divisor gris
// que se abre al resumen o al pedido del relevo. Y un aviso de Trama (un worker
// que terminó o falló): una fila con la campana, su estado con ícono y palabra, y
// el id de cada worker, que abre su hilo.
import { memo, useState } from "react";
import {
  BellRing,
  ChevronRight,
  CircleCheck,
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
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { hora } from "./Hace";
import { nombreModelo } from "./opciones";
import type { AvisoTexto } from "../../electron/avisos-worker.ts";
import type { ClaseTarjeta, Linea, Sistema as S, Tarjeta } from "./sistema-logica";

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

/** Un aviso de Trama: la campana y "Trama · Aviso"; por cada worker, si terminó o falló (ícono y palabra), su tarea y su id, que abre su hilo. */
function Aviso({ a, alAbrirHilo }: { a: AvisoTexto; alAbrirHilo?: (id: string) => void }) {
  const fallas = a.trabajos.filter((x) => x.falla).length;
  return (
    <div className="sis-aviso" data-tono={a.falla ? "grave" : undefined}>
      <div className="sis-aviso-h">
        <BellRing size={12} strokeWidth={2} aria-hidden="true" />
        <span>{t("sistema.avisoRotulo")}</span>
      </div>
      {a.tanda ? <span>{`${t("sistema.avisoTanda", { n: a.trabajos.length })}${fallas ? ` · ${t("sistema.avisoFallas", { k: fallas })}` : ""}`}</span> : null}
      {a.trabajos.length ? (
        <ul className="sis-aviso-l">
          {a.trabajos.map((x) => (
            <li key={x.id}>
              <span className="sis-aviso-e">
                {x.falla ? <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" /> : <CircleCheck size={12} strokeWidth={2} aria-hidden="true" />}
                <span>{t(x.falla ? "sistema.avisoFallo" : "sistema.avisoTermino")}</span>
              </span>
              <span className="sis-aviso-tarea">{`«${x.tarea}»`}</span>
              {alAbrirHilo ? (
                <button type="button" className="sis-aviso-id" onClick={() => alAbrirHilo(x.id)} aria-label={t("sistema.avisoAbrir", { id: x.id })}>
                  {`#${x.id}`}
                </button>
              ) : (
                <span className="sis-aviso-id">{`#${x.id}`}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <span className="sis-aviso-tarea">{t("sistema.avisoSin")}</span>
      )}
    </div>
  );
}

/** `nombre`: el del líder, para "Viene de …" (los workers no tienen relevo). `alAbrirHilo`: abre el hilo de un worker (los ids de un aviso). */
type Props = { s: S; nombre?: string | null; alAbrirHilo?: (id: string) => void };

/** Cada pasada de `turnos()` arma objetos nuevos: lo de un mismo mensaje no cambia (el crudo, sin serializar: pesa). */
const igual = ({ s: a, nombre: na, alAbrirHilo: ha }: Props, { s: b, nombre: nb, alAbrirHilo: hb }: Props) =>
  na === nb &&
  ha === hb &&
  (a === b ||
  (a.tipo === "tarjeta" && b.tipo === "tarjeta"
    ? a.clase === b.clase && a.dato === b.dato && a.estado === b.estado && a.crudo === b.crudo
    : a.tipo === "linea" && b.tipo === "linea" && JSON.stringify(a) === JSON.stringify(b)));

/** Una línea o una tarjeta de sistema. */
export const Sistema = memo(function Sistema({ s, nombre, alAbrirHilo }: Props) {
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
    </div>
  );
}, igual);
