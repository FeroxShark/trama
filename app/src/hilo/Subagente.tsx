// La vista grande de un subagente (al tocar su tarjeta bajo el líder, src/barra/Subagentes.tsx): sus pasos como los
// de un worker (src/hilo/Worker.tsx), en vivo mientras corre y con su informe al terminar. Los arma el main de su
// transcript con el id `sub:<sesión>:<agentId>` (electron/pasos-worker.ts). Sólo se mira: a un subagente no se le escribe.
import { useMemo } from "react";
import { Bot } from "lucide-react";
import type { Subagente } from "../../electron/subagentes";
import type { Lider } from "../datos/contrato";
import type { VistaPasos } from "../datos/pasos";
import { pintaSub } from "../barra/subagentes-logica";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Entero } from "./Entero";
import { defDe } from "./modelos";
import { frasePaso, pensarConFila, resumenDe, textoFinal } from "./worker-datos";
import { Chips, Consigna, Extras, Portada, Recorrido, subVivo, tokensInfo, ultimoPaso, useRecorrido } from "./Worker";

/** El modelo que se muestra: el del subagente, o el que dice su transcript. */
const modeloDe = (u: Subagente | null, vista: VistaPasos | null) => {
  const m = u?.modelo ?? vista?.encabezado.modelo ?? null;
  return m ? (defDe(m)?.nombre ?? m) : null;
};

/** Lo de la cabecera después de las migas: que es un subagente y con qué modelo, su estado en palabras, el tiempo y el ⓘ. */
export function SubagenteMigas({ u, lider, vista, vive }: { u: Subagente | null; lider: Lider | null; vista: VistaPasos | null; vive: boolean }) {
  useIdioma();
  const modeloSolo = modeloDe(u, vista);
  const modelo = modeloSolo && u?.modelo_heredado ? t("sub.heredado", { v: modeloSolo }) : modeloSolo;
  const pinta = u ? pintaSub(u, vive) : null;
  const e = vista?.encabezado;
  const filas: [string, string, boolean?][] = [
    ...(lider ? [[t("subv.infoLider"), lider.nombre] as [string, string]] : []),
    ...(modelo ? [[t("wk.infoModelo"), modelo] as [string, string]] : []),
    ...(u?.esfuerzo ? [[t("subv.infoEsfuerzo"), u.esfuerzo_heredado ? t("sub.heredado", { v: u.esfuerzo }) : u.esfuerzo] as [string, string]] : []),
    ...(u?.tipo ? [[t("subv.infoTipo"), u.tipo, true] as [string, string, boolean]] : []),
    ...(e ? [[t("wk.infoTurnos"), String(e.turnos)] as [string, string], [t("wk.infoTokens"), tokensInfo(e)] as [string, string]] : []),
  ];
  const dur = e?.dur ?? (u ? (u.ultimo_en - u.inicio) * 1000 : null);
  return (
    <>
      <span className="subv-marca" data-tip={lider ? t("subv.deTip", { lider: lider.nombre }) : undefined}>
        <Bot size={14} strokeWidth={1.8} aria-hidden />
        {modelo ? t("subv.marcaModelo", { modelo }) : t("subv.marca")}
      </span>
      {pinta ? (
        <span className={`estado c-${pinta.tipo}`}>
          <i />
          {t(pinta.clave)}
        </span>
      ) : null}
      {u ? <Extras inicio={u.inicio} dur={dur} vive={vive} filas={filas} /> : null}
    </>
  );
}

export function VistaSubagente({ u, vista, vive }: { u: Subagente | null; vista: VistaPasos; vive: boolean }) {
  useIdioma();
  const r = useRecorrido(vista, vive);
  const final = textoFinal(vista.pasos) ?? (u?.estado === "terminado" ? u.resultado : null);
  const { resultado } = useMemo(() => resumenDe(final), [final]);
  const espera = vive ? t("wk.espera") : u?.estado === "error" ? t("subv.fallo") : t("wk.sinResultado");
  const conFila = r.pasos.filter((p) => p.detalle.clase !== "pensar" || pensarConFila(p));
  const q = conFila[conFila.length - 1] ?? null;
  const e = vista.encabezado;
  return (
    <div className="wk" ref={r.raiz} data-subagente="">
      <div className="wk-in">
        <Recorrido
          r={r}
          vista={vista}
          vive={vive}
          compacta={null}
          arriba={
            <section className="wk-fin" aria-label={t("wk.resultado")} data-tono={vive ? "vivo" : u?.estado === "error" ? "frenado" : "listo"}>
              <Portada
                tono={vive ? "vivo" : "listo"}
                r={r}
                inicio={u?.inicio ?? (e.inicio ?? Date.now()) / 1000}
                dur={e.dur}
                corte={null}
                titulo={vive && q ? <h2 className="wk-tit">{frasePaso(q)}</h2> : resultado ? <h2 className="wk-tit"><Entero texto={resultado} className="wk-txt" /></h2> : <p className="wk-txt espera">{espera}</p>}
                sub={vive ? subVivo(r.pasos) : ultimoPaso(r.pasos, false)}
              />
              {e.tarea ? <Consigna texto={e.tarea} deEntrada={false} /> : null}
              <div className="wk-pie-caja">
                <Chips resultado={null} vista={vista} pasos={r.pasos} vive={vive} alElegir={r.alElegir} />
              </div>
            </section>
          }
        />
      </div>
    </div>
  );
}
