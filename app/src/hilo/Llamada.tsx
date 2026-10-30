// Una llamada a una herramienta en el trabajo de un turno (B19): una línea
// ("Bash  Corre los tests", "Edit  src/x.ts  +3 −1") que al abrirse muestra el
// comando entero y el final de lo que devolvió, o el diff en rojo y verde como
// la terminal de Claude Code. Lo de adentro se arma recién al abrir.
import { memo, useContext, useState } from "react";
import { ChevronRight, PanelRight } from "lucide-react";
import { locale, t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { pedirSubagenteEnPanel } from "../paneles/contexto-pedido";
import { tokens as tokensCorto } from "../paneles/resumen";
import { GastoSubagentesCtx } from "./gasto-sub";
import { archivoDe, cambios, cuerpo, type Grupo, type LineaDiff, type Uso } from "./herramientas";
import { HERRAMIENTA_PREGUNTAS, respondidas } from "./preguntas-logica";
import { Miniaturas } from "./Imagenes";
import { LlamadaPreguntas } from "./Preguntas";
import { EnlaceArchivo } from "./VerArchivo";

/** Las líneas de un Write largo que se muestran antes de "… N líneas más". */
const MAX_DIFF = 80;

/**
 * Abierta de entrada: el Bash siempre (B26: al abrir el trabajo se ve el comando y lo que
 * devolvió; se puede cerrar a mano); las demás, cerradas. Captura `herramientas`: también el Edit; `herramientas-resultados`: todas.
 */
const abiertaAlMontar = (u: Uso) => u.nombre === "Bash" || (MODO.captura === "herramientas" && u.nombre === "Edit") || MODO.captura === "herramientas-resultados";

function Diff({ tramos, cortado }: { tramos: LineaDiff[][]; cortado: boolean }) {
  return (
    <div className="ll-diff">
      {tramos.map((ls, k) => {
        const vis = ls.length > MAX_DIFF + 10 ? ls.slice(0, MAX_DIFF) : ls;
        return (
          <div key={k} className="ll-tramo">
            {vis.map((l, i) => (
              <div key={i} className="ll-l" data-t={l.tipo === "+" ? "mas" : l.tipo === "-" ? "menos" : undefined}>
                <span className="ll-s">{l.tipo}</span>
                <span className="ll-x">{l.texto || " "}</span>
              </div>
            ))}
            {vis.length < ls.length ? <div className="ll-mas">{t("llamada.masLineas", { n: ls.length - vis.length })}</div> : null}
          </div>
        );
      })}
      {cortado ? <div className="ll-mas">{t("llamada.cortado")}</div> : null}
    </div>
  );
}

function Cuerpo({ u }: { u: Uso }) {
  const c = cuerpo(u.det);
  const r = u.det?.resultado;
  return (
    <div className="ll-c">
      {c.tipo === "comando" ? (
        <pre className="ll-cmd">
          {c.comando}
          {c.cortado ? <span className="ll-mas">{"\n" + t("llamada.cortado")}</span> : null}
        </pre>
      ) : null}
      {c.tipo === "diff" ? <Diff tramos={c.tramos} cortado={c.cortado} /> : null}
      {r && r.texto.trim() && (c.tipo !== "diff" || r.error) ? (
        <pre className="ll-res" data-error={r.error ? "" : undefined}>
          {r.texto.trimEnd()}
        </pre>
      ) : null}
      {r?.imagenes?.length ? <Miniaturas imagenes={r.imagenes} /> : null}
    </div>
  );
}

/** Tiene algo para mostrar al abrirse. */
const abre = (u: Uso) => cuerpo(u.det).tipo !== "nada" || !!u.det?.resultado?.texto.trim() || !!u.det?.resultado?.imagenes?.length;

/**
 * Cómo va una llamada (un motor que deja ver su trabajo): sin resultado todavía y el turno corriendo es `corriendo`; con el resultado,
 * `ok` o `error`. Un turno que terminó sin resultado no dice nada (no se sabe).
 */
export const estadoLlamada = (todos: Uso[], vivo: boolean): "corriendo" | "ok" | "error" | null =>
  todos.some((x) => x.det?.resultado?.error) ? "error" : todos.every((x) => x.det?.resultado) ? "ok" : vivo ? "corriendo" : null;

/** Una línea por grupo de llamadas iguales y seguidas. `estado`: el turno es de un motor que deja ver su trabajo (`vivo`: sigue corriendo). */
export const Llamada = memo(function Llamada({ g, estado }: { g: Grupo; estado?: "vivo" | "fin" }) {
  useIdioma();
  const { uso: u, todos } = g;
  const [abierta, setAbierta] = useState(() => abiertaAlMontar(u));
  // Una llamada Agent de un líder: lo que gastó el subagente que lanzó (si ya se leyó su transcript), por el `tool_use_id`.
  const gastos = useContext(GastoSubagentesCtx);
  const gasto = (u.nombre === "Agent" || u.nombre === "Task") && todos.length === 1 && u.det?.id ? (gastos?.porLlamada.get(u.det.id) ?? null) : null;
  const se = todos.some(abre);
  const c = todos.map((x) => cambios(x.det)).reduce<{ mas: number; menos: number } | null>(
    (a, b) => (b ? { mas: (a?.mas ?? 0) + b.mas, menos: (a?.menos ?? 0) + b.menos } : a),
    null,
  );
  const error = todos.some((x) => x.det?.resultado?.error);
  // AskUserQuestion contestada: lo elegido en el renglón (./Preguntas.tsx).
  const rs = u.nombre === HERRAMIENTA_PREGUNTAS && todos.length === 1 && !error ? respondidas(u.det?.entrada, u.det?.resultado?.texto) : null;
  if (rs) return <LlamadaPreguntas nombre={u.nombre} rs={rs} />;
  // Un fallo se dice con texto aunque el motor no muestre estados: el rojo solo no alcanza (daltonismo).
  const est = estado ? estadoLlamada(todos, estado === "vivo") : error ? "error" : null;
  const linea = (
    <>
      {se ? <ChevronRight className="ll-f" size={10} strokeWidth={2} /> : <span className="ll-f" />}
      <span className="ll-n" data-error={error ? "" : undefined}>
        {u.nombre}
      </span>
      {u.resumen ? <span className="ll-r">{u.resumen}</span> : null}
      {todos.length > 1 ? <span className="ll-k">×{todos.length}</span> : null}
      {gasto ? (
        <span className="ll-k ll-gasto" data-tip={t("ctxp.subGasto", { tokens: gasto.tokens.total.toLocaleString(locale()) })}>
          {gasto.modelo ? t("ll.subGasto", { tokens: tokensCorto(gasto.tokens.total), modelo: gasto.modelo }) : t("ll.subGastoSin", { tokens: tokensCorto(gasto.tokens.total) })}
        </span>
      ) : null}
      {c ? (
        <span className="ll-k">
          <span className="ll-mas-n">+{c.mas}</span> <span className="ll-menos-n">−{c.menos}</span>
        </span>
      ) : null}
      {est ? (
        <span className="ll-e" data-e={est}>
          {t(`llamada.${est}`)}
        </span>
      ) : null}
    </>
  );
  // El archivo que toca (un Read, Write o Edit): su botón va aparte del que abre la línea (un botón no lleva otro adentro).
  const arch = archivoDe(u);
  // Y la llamada Agent, el de su desglose en el panel de contexto.
  const enlace = arch ? (
    <EnlaceArchivo a={arch} />
  ) : gasto ? (
    <button type="button" className="ll-desglose" data-tip={t("ll.subDesgloseTip")} onClick={() => pedirSubagenteEnPanel(gasto.sid, gasto.id)}>
      <PanelRight size={11} strokeWidth={1.9} aria-hidden />
      {t("ll.subDesglose")}
    </button>
  ) : null;
  if (!se)
    return (
      <div className="ll">
        {linea}
        {enlace}
      </div>
    );
  const boton = (
    <button type="button" className="ll-b" aria-expanded={abierta} onClick={() => setAbierta((a) => !a)}>
      {linea}
    </button>
  );
  return (
    <div className="ll" data-abierta={abierta ? "" : undefined}>
      {enlace ? (
        <div className="ll-fila">
          {boton}
          {enlace}
        </div>
      ) : (
        boton
      )}
      {abierta ? todos.filter(abre).map((x, i) => <Cuerpo key={i} u={x} />) : null}
    </div>
  );
});
