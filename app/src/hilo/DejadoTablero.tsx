// «Te dejé esto en el tablero: <título>»: la tarjeta discreta que aparece en el chat de un líder cuando él (o un worker suyo) dejó algo en
// el tablero para la persona. Un renglón por item, que es un botón entero (44 px con dedo) y abre ese item en el tablero. Dice con palabras
// e ícono si sigue esperando, si ya respondió o si se cerró (nunca sólo con color). No suena, no avisa ni mueve el scroll: es una fila más
// de la conversación, debajo de lo que la dejó. Qué items hay y su estado: src/hilo/tablero-dejado.ts; la lectura del tablero se comparte
// (tablero-dejado-fuente.ts).
import { Check, ChevronRight, Clock, Send, type LucideIcon } from "lucide-react";
import { IcDecidir, IcProbar } from "../ui/iconos";
import { useEffect, useMemo, useState } from "react";
import { fuenteTablero } from "../datos/fuenteTablero";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { pedirItem } from "../paneles/tablero-abrir";
import { cartas, type Carta, type EstadoDejado, type RefDejado } from "./tablero-dejado.ts";
import { useTableroDejado } from "./tablero-dejado-fuente";
import "./dejado-tablero.css";

/** Más que esto en un solo lugar y el resto se cuenta («y 2 más»): la tarjeta es un aviso, la lista entera vive en el tablero. */
const MAX = 3;

const ESTADO: Record<Exclude<EstadoDejado, "sin-leer">, { clave: "dejado.abierto" | "dejado.respondido" | "dejado.cerrado" | "dejado.probado"; Icono: LucideIcon }> = {
  probado: { clave: "dejado.probado", Icono: Check },
  abierto: { clave: "dejado.abierto", Icono: Clock },
  respondido: { clave: "dejado.respondido", Icono: Send },
  cerrado: { clave: "dejado.cerrado", Icono: Check },
};

export function DejadoTablero({ refs }: { refs: readonly RefDejado[] }) {
  useIdioma();
  const tablero = useTableroDejado();
  const lista = useMemo(() => cartas(refs, tablero), [refs, tablero]);
  if (!lista.length) return null;
  const vistas = lista.slice(0, MAX);
  return (
    <ul className="dejado" data-guia="dejado-tablero" aria-label={t("dejado.frase")}>
      {vistas.map((c) => (
        c.renglon ? <FilaRenglon key={c.key} c={c} n={c.renglon.n} hecho={c.renglon.hecho} /> : <Fila key={c.key} c={c} />
      ))}
      {lista.length > MAX ? (
        <li className="dejado-mas">
          <button type="button" className="dejado-c" onClick={() => pedirItem({ id: lista[MAX].id })}>
            <span className="dejado-t">{t("dejado.mas", { n: lista.length - MAX })}</span>
            <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * El PROBAR de un worker que vive como renglón del item «Probar <proyecto> (…)»: una casilla de verdad (tildar = `tablero:tildar`, el
 * mismo canal del tablero) y al lado la fila de siempre, que abre el item. Tildado dice «Ya lo probaste» (palabra e ícono, no sólo color).
 */
function FilaRenglon({ c, n, hecho }: { c: Carta; n: number; hecho: boolean }) {
  const [tildado, setTildado] = useState(hecho);
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  // Una lectura nueva del tablero (tildado desde el panel o desde otro lado) pisa lo local.
  useEffect(() => setTildado(hecho), [hecho]);
  const tildar = (nuevo: boolean) => {
    setTildado(nuevo);
    setOcupado(true);
    setFalla(null);
    fuenteTablero.tildar(c.id, [n], nuevo).then(
      () => setOcupado(false),
      (e: Error) => {
        setTildado(!nuevo);
        setOcupado(false);
        setFalla(t("pd.pasoFalla", { error: e.message }));
      },
    );
  };
  return (
    <li className="dejado-r">
      <label className="dejado-ck" data-hecho={tildado ? "" : undefined}>
        <input type="checkbox" checked={tildado} disabled={ocupado} aria-label={t("dejado.tildar", { texto: c.titulo })} onChange={(e) => tildar(e.target.checked)} />
        <span className="dejado-caja" aria-hidden="true">
          <Check size={12} strokeWidth={3} />
        </span>
      </label>
      <Fila c={{ ...c, estado: tildado ? "probado" : c.estado === "probado" ? "abierto" : c.estado }} />
      {falla ? (
        <p className="dejado-error" role="alert">
          {falla}
        </p>
      ) : null}
    </li>
  );
}

function Fila({ c }: { c: Carta }) {
  const e = c.estado === "sin-leer" ? null : ESTADO[c.estado];
  const TipoIcono = c.tipo === "prueba" ? IcProbar : IcDecidir;
  const Envoltura = c.renglon ? "div" : "li";
  return (
    <Envoltura className={c.renglon ? "dejado-fila" : undefined}>
      <button type="button" className="dejado-c" data-tipo={c.tipo} data-estado={c.estado} aria-label={t("dejado.abrir", { titulo: c.titulo })} onClick={() => pedirItem({ id: c.id })}>
        <span className="dejado-tipo">
          <TipoIcono className="dejado-i" size={14} strokeWidth={2} aria-hidden="true" />
          <span>{t(c.tipo === "prueba" ? "dejado.tipo.prueba" : "dejado.tipo.pregunta")}</span>
        </span>
        <span className="dejado-t">
          <b>{c.titulo}</b>
        </span>
        {e ? (
          <span className="dejado-e">
            <e.Icono size={12} strokeWidth={2} aria-hidden="true" />
            {t(e.clave)}
          </span>
        ) : null}
        <ChevronRight className="dejado-f" size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </Envoltura>
  );
}
