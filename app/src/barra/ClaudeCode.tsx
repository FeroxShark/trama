// "De Claude Code (N)": las conversaciones de Claude Code que no se abrieron desde Trama, plegadas al final de cada carpeta de la barra
// (y en "Otras carpetas"). Tocar una la retoma como líder de Trama. Sólo se lee: nunca se modifica un transcript.
import { useMemo, useState, type Ref } from "react";
import { ChevronDown, Search } from "lucide-react";
import { motion } from "motion/react";
import type { ConvClaudeCode } from "../datos/contrato";
import { modeloDe, nombreModelo } from "../hilo/opciones";
import { t as tr } from "../i18n";
import { cuando, cuandoLargo } from "../tiempo";
import { carpetaCorta, filtrarClaude, LOTE, PARA_BUSCAR } from "./claude-code";
import { RESORTE } from "./Fila";

type Props = {
  ref?: Ref<HTMLDivElement>;
  convs: ConvClaudeCode[];
  abierta: boolean;
  alPlegar: () => void;
  /** Retoma la conversación; devuelve por qué no se pudo (ya en criollo) o `null` si salió bien. */
  alAbrir: (c: ConvClaudeCode) => Promise<string | null>;
  /** En "Otras carpetas" cada una dice de qué carpeta es. */
  conCarpeta: boolean;
};

const modeloLindo = (m: string | null) => (m ? nombreModelo(modeloDe(m) ?? m) : null);

/** Lo que no deja retomarla sin tocar nada: la carpeta ya no existe, o es de otra cuenta de Claude. */
const motivo = (c: ConvClaudeCode) => (!c.existe ? tr("barra.claudeNoCarpeta", { c: carpetaCorta(c.cwd) }) : c.ajena ? tr("barra.claudeAjena") : null);

export function ClaudeCode({ ref, convs, abierta, alPlegar, alAbrir, conCarpeta }: Props) {
  const [q, setQ] = useState("");
  const [lote, setLote] = useState(LOTE);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const vistas = useMemo(() => filtrarClaude(convs, q), [convs, q]);
  const n = convs.length;
  const abrir = (c: ConvClaudeCode) => {
    if (abriendo) return;
    const no = motivo(c);
    if (no) return setAviso(no);
    setAviso(null);
    setAbriendo(c.sid);
    void alAbrir(c)
      .then((e) => setAviso(e))
      .finally(() => setAbriendo(null));
  };
  return (
    <motion.div ref={ref} layout="position" transition={RESORTE} className="espera cc" data-claude-code="">
      <button type="button" className="mini-pliegue" aria-expanded={abierta} data-tip={tr("barra.claudeCodeTip")} onClick={alPlegar}>
        {tr("barra.claudeCode", { n })}
        <ChevronDown className="chevron" size={11} strokeWidth={2} />
      </button>
      {abierta ? (
        <div className="cc-cuerpo">
          {n > PARA_BUSCAR ? (
            <label className="buscar cc-buscar">
              <Search size={12} strokeWidth={2} aria-hidden />
              <input
                type="search"
                value={q}
                placeholder={tr("barra.claudeBuscar")}
                aria-label={tr("barra.claudeBuscarAria")}
                onChange={(e) => {
                  setQ(e.target.value);
                  setLote(LOTE);
                }}
              />
            </label>
          ) : null}
          <ul className="cc-lista">
            {vistas.slice(0, lote).map((c) => {
              const no = motivo(c);
              return (
                <li key={c.sid}>
                  <button type="button" className="cc-fila" data-sin={no ? "" : undefined} aria-busy={abriendo === c.sid} onClick={() => abrir(c)} data-tip={c.cwd}>
                    <span className="t">{c.titulo}</span>
                    <span className="m">
                      <span title={cuandoLargo(c.ms / 1000)}>{cuando(c.ms / 1000)}</span>
                      {!c.existe ? <span className="cc-etiqueta">{tr("barra.claudeSinCarpeta")}</span> : c.ajena ? <span className="cc-etiqueta">{tr("barra.claudeOtraCuenta")}</span> : null}
                      {modeloLindo(c.modelo) ? <span>{modeloLindo(c.modelo)}</span> : null}
                      {conCarpeta ? <span className="cc-carpeta">{carpetaCorta(c.cwd)}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {vistas.length === 0 ? <div className="cc-vacio">{tr("barra.claudeNada")}</div> : null}
          {vistas.length > lote ? (
            <button type="button" className="mini-pliegue cc-mas" onClick={() => setLote((l) => l + LOTE)}>
              {tr("barra.claudeMas", { n: vistas.length - lote })}
            </button>
          ) : null}
          {aviso ? (
            <div className="cc-aviso" role="alert">
              {aviso}
            </div>
          ) : null}
        </div>
      ) : null}
    </motion.div>
  );
}
