// Ajustes > Conectores como tienda: la tarjeta (ícono, nombre, de quién es, qué hace en dos líneas, un dato y el «+» o el ✓) y la grilla de dos
// columnas (una en angosto). Tocar la tarjeta abre el detalle; el «+», el interruptor y el ✓ son controles aparte (nunca un botón dentro de otro).
// Cada estado se dice con ícono y palabra, no sólo con color. Los datos que la fuente no trae dicen «sin dato».
import type { ReactNode } from "react";
import { Loader, Plug, Plus, Puzzle, Sparkles, Terminal, Webhook, type LucideIcon } from "lucide-react";
import { DIAS_USOS } from "../../electron/usos-historial";
import { locale, t } from "../i18n";
import { Boton, Interruptor } from "../ui/componentes";
import { Estado } from "./AjustesDsh";
import { haceDias } from "./conectores-vista";
import { fechaCorta } from "./descubrir-vista";
import type { Origen, Pestana, Tarjeta } from "./tienda-logica";

export const ICONO: Record<Pestana, LucideIcon> = { skills: Sparkles, mcp: Plug, plugins: Puzzle, hooks: Webhook };

/** «de Anthropic», «de ana», «Tuyo», «plugin estilo»… */
export function textoOrigen(o: Origen): string {
  switch (o.clase) {
    case "anthropic":
      return t("tienda.de.anthropic");
    case "autor":
      return t("tienda.de.autor", { n: o.n });
    case "tuyo":
      return t("tienda.de.tuyo");
    case "trama":
      return t("tienda.de.trama");
    case "plugin":
      return t("tienda.de.plugin", { n: o.n });
    case "proyecto":
      return t("tienda.de.proyecto", { n: o.n });
    default:
      return t("tienda.de.claudeai");
  }
}

/** Cuándo fue, dicho con palabras: hoy, ayer o hace N días (contra el último día del registro). */
const cuando = (dia: string, hoy: string) => {
  const n = haceDias(dia, hoy);
  return n === 0 ? t("conectores.hoy") : n === 1 ? t("conectores.ayer") : t("conectores.haceDias", { n });
};

/** El uso de 30 días: tres estados que nunca se confunden (usado, sin uso en 30 días, sin dato). */
export function textoUso(x: Pick<Tarjeta, "veces" | "ultimoUso">, hoy: string | null): string {
  if (x.veces === null) return t("conectores.usoSinDato");
  if (x.veces === 0) return t("conectores.usoCero", { dias: DIAS_USOS });
  const base = t("conectores.usoVeces", { n: x.veces, dias: DIAS_USOS });
  return x.ultimoUso && hoy ? `${base} · ${t("conectores.usoUltimo", { cuando: cuando(x.ultimoUso, hoy) })}` : base;
}

export const textoInstalaciones = (n: number | null): string => (n === null ? t("plugins.instalacionesSin") : t("plugins.instalaciones", { n: n.toLocaleString(locale()) }));

export function textoFecha(ms: number | null): string {
  const f = ms === null ? null : fechaCorta(new Date(ms).toISOString(), locale());
  return f ? t("plugins.actualizado", { f }) : t("plugins.actualizadoSin");
}

/** El dato de la tarjeta: lo que se usó (Tuyos) o lo que dice de cuánta gente lo tiene (Descubrir; si la fuente no cuenta instalaciones, su fecha o sus archivos). */
export function datoDe(x: Tarjeta, hoy: string | null): { texto: string; tono: "dato" | "falta" } {
  if (x.vista === "tuyos") {
    const texto = textoUso(x, hoy);
    return { texto, tono: x.veces === null ? "falta" : "dato" };
  }
  if (x.pestana === "plugins") return { texto: textoInstalaciones(x.instalaciones), tono: x.instalaciones === null ? "falta" : "dato" };
  if (x.pestana === "skills" && x.archivos !== null) return { texto: t("descubrir.archivos", { n: x.archivos }), tono: "dato" };
  return { texto: textoFecha(x.fecha), tono: x.fecha === null ? "falta" : "dato" };
}

export const textoPuesto = (x: Tarjeta): string => t(x.pestana === "skills" ? "descubrir.instalada" : x.pestana === "mcp" ? "descubrir.agregado" : "plugins.instalado");

type Props = {
  x: Tarjeta;
  hoy: string | null;
  /** Lo que está en curso (instalando, prendiendo…) para esta tarjeta; el resto de los controles queda quieto. */
  enCurso: boolean;
  bloqueado: boolean;
  alAbrir: (x: Tarjeta) => void;
  alAnadir: (x: Tarjeta) => void;
  alConmutar: (x: Tarjeta, v: boolean) => void;
};

export function TarjetaTienda({ x, hoy, enCurso, bloqueado, alAbrir, alAnadir, alConmutar }: Props) {
  const Icono = ICONO[x.pestana];
  const dato = datoDe(x, hoy);
  const accion: ReactNode = (() => {
    if (x.vista === "tuyos") {
      if (x.conmutable && x.activo !== null)
        return (
          <span className="ti-ctrl">
            <Estado ok={x.activo} texto={t(x.activo ? "conectores.on" : "conectores.off")} />
            <Interruptor activo={x.activo} disabled={bloqueado} aria-label={t(x.activo ? "conectores.apagar" : "conectores.prender", { n: x.nombre })} alCambiar={(v) => alConmutar(x, v)} />
          </span>
        );
      return <Estado ok={x.activo !== false} texto={t(x.activo === false ? "conectores.off" : "conectores.on")} />;
    }
    if (x.puesto) return <Estado ok texto={textoPuesto(x)} />;
    if (x.accion === "ninguna") return <Estado ok={false} texto={t("descubrir.noAgregable")} />;
    const comando = x.accion === "comando";
    const rotulo = t(comando ? "descubrir.verComandoDe" : x.pestana === "skills" ? "descubrir.instalarDe" : x.pestana === "plugins" ? "plugins.instalarDe" : "descubrir.agregarDe", { n: x.nombre });
    return (
      <Boton className="ti-mas" onClick={() => alAnadir(x)} disabled={bloqueado} aria-label={rotulo} title={rotulo}>
        {enCurso ? <Loader size={16} strokeWidth={2.2} aria-hidden className="pl-gira" /> : comando ? <Terminal size={16} strokeWidth={2.2} aria-hidden /> : <Plus size={16} strokeWidth={2.4} aria-hidden />}
      </Boton>
    );
  })();
  return (
    <li className="ti-tarj" data-tarjeta={x.clave} data-pestana={x.pestana} data-puesto={x.puesto ? "" : undefined} data-apagado={x.vista === "tuyos" && x.activo === false ? "" : undefined}>
      <span className="ti-ico" aria-hidden>
        <Icono size={18} strokeWidth={2} />
      </span>
      <div className="ti-cab">
        <button type="button" className="ti-nombre" onClick={() => alAbrir(x)} aria-haspopup="dialog">
          <span className="ti-nombre-t">{x.nombre}</span>
        </button>
        <span className="ti-origen">{textoOrigen(x.origen)}</span>
      </div>
      <div className="ti-accion">{accion}</div>
      <p className="ti-desc" data-sin={x.descripcion ? undefined : ""}>
        {x.descripcion ?? x.destino ?? t("tienda.sinDesc")}
      </p>
      <p className="ti-dato" data-tono={dato.tono}>
        {dato.texto}
      </p>
    </li>
  );
}

export function Rejilla({ etiqueta, children }: { etiqueta?: string; children: ReactNode }) {
  return (
    <ul className="ti-rejilla" aria-label={etiqueta}>
      {children}
    </ul>
  );
}
