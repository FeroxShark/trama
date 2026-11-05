// «Te dejé esto en el tablero: <título>»: la tarjeta discreta que aparece en el chat de un líder cuando él (o un worker suyo) dejó algo en
// el tablero para la persona. Un renglón por item, que es un botón entero (44 px con dedo) y abre ese item en el tablero. Dice con palabras
// e ícono si sigue esperando, si ya respondió o si se cerró (nunca sólo con color). No suena, no avisa ni mueve el scroll: es una fila más
// de la conversación, debajo de lo que la dejó. Qué items hay y su estado: src/hilo/tablero-dejado.ts; la lectura del tablero se comparte
// (tablero-dejado-fuente.ts).
import { Check, ChevronRight, ClipboardList, Clock, Send, type LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { pedirItem } from "../paneles/tablero-abrir";
import { cartas, type Carta, type EstadoDejado, type RefDejado } from "./tablero-dejado.ts";
import { useTableroDejado } from "./tablero-dejado-fuente";
import "./dejado-tablero.css";

/** Más que esto en un solo lugar y el resto se cuenta («y 2 más»): la tarjeta es un aviso, la lista entera vive en el tablero. */
const MAX = 3;

const ESTADO: Record<Exclude<EstadoDejado, "sin-leer">, { clave: "dejado.abierto" | "dejado.respondido" | "dejado.cerrado"; Icono: LucideIcon }> = {
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
    <ul className="dejado" aria-label={t("dejado.frase")}>
      {vistas.map((c) => (
        <Fila key={c.key} c={c} />
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

function Fila({ c }: { c: Carta }) {
  const e = c.estado === "sin-leer" ? null : ESTADO[c.estado];
  return (
    <li>
      <button type="button" className="dejado-c" data-estado={c.estado} aria-label={t("dejado.abrir", { titulo: c.titulo })} onClick={() => pedirItem({ id: c.id })}>
        <ClipboardList className="dejado-i" size={14} strokeWidth={1.8} aria-hidden="true" />
        <span className="dejado-t">
          <span className="dejado-q">{t("dejado.frase")}</span> <b>{c.titulo}</b>
        </span>
        {e ? (
          <span className="dejado-e">
            <e.Icono size={12} strokeWidth={2} aria-hidden="true" />
            {t(e.clave)}
          </span>
        ) : null}
        <ChevronRight className="dejado-f" size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </li>
  );
}
