// El panel acoplable «Tablero» (a la derecha del chat, como Cupo y Contexto): los items del tablero del PROYECTO del chat abierto.
// Primero lo que te pregunta alguien (las de botones se contestan con un toque, con la sugerida marcada), después las esperas
// (pruebas con su comando a la vista y copiable) y los pendientes; cada uno se cierra desde acá. La lógica (qué es de la
// carpeta, el orden, el contador) vive en `panel-tablero-logica.ts`; la lectura viva, en `datos/tablero-vivo.ts`.
import { useMemo, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { fuenteTablero } from "../datos/fuenteTablero";
import { useNombreProyecto } from "../datos/proyectos";
import { numero, type Item, type ItemId, type Tablero } from "../datos/tablero";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { avanceRenglones, contestadoComo, gruposDelProyecto, opcionesDe } from "./panel-tablero-logica";
import "./panel-tablero.css";

const COPIADO_MS = 1400;

type Props = {
  /** El slug de la carpeta del chat abierto; `null` o la general: los items sin proyecto. */
  carpeta: string | null;
  /** nombre del registry → slug (lo que el tablero escribe en `proyecto`). */
  slugs: Record<string, string>;
  datos: Tablero | null;
  /** Por qué no se pudo refrescar (se sigue viendo lo último que se leyó). */
  error: string | null;
  /** Después de contestar o cerrar, para ver el tablero ya cambiado. */
  alCambiar: () => void;
};

export function PanelTablero({ carpeta, slugs, datos, error, alCambiar }: Props) {
  useIdioma();
  const nom = useNombreProyecto();
  const [ocupados, setOcupados] = useState<ReadonlySet<ItemId>>(new Set());
  const [falla, setFalla] = useState<string | null>(null);

  const sinProyecto = !carpeta || carpeta === "general";
  const g = useMemo(() => gruposDelProyecto(datos, carpeta, slugs), [datos, carpeta, slugs]);
  const hay = g.preguntas.length + g.esperas.length + g.pendientes.length > 0;

  const hacer = async (id: ItemId, accion: () => Promise<void>) => {
    if (ocupados.has(id)) return;
    setOcupados((s) => new Set(s).add(id));
    setFalla(null);
    try {
      await accion();
      alCambiar();
    } catch (e) {
      setFalla(t("ptab.error.accion", { motivo: (e as Error).message }));
    } finally {
      setOcupados((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };
  const contestar = (i: Item, opcion: string) => hacer(i.id, () => fuenteTablero.responder(i.id, { tipo: "pregunta", opcion }));
  const cerrar = (i: Item) => hacer(i.id, () => fuenteTablero.cerrar(i.id));

  return (
    <div className="panel-tablero">
      <p className="ptab-proy" title={sinProyecto ? undefined : carpeta ?? undefined}>
        {sinProyecto ? t("ptab.sinProyecto") : t("ptab.proyecto", { proyecto: nom(carpeta ?? "") })}
      </p>

      {error ? (
        <p className="ptab-aviso" role="status">
          {t("ptab.errorLeer", { motivo: error })}
        </p>
      ) : null}
      {falla ? (
        <p className="ptab-aviso" role="alert">
          {falla}
        </p>
      ) : null}

      <div className="ptab-scroll">
        {!datos ? (
          <p className="ptab-vacio">{t("ptab.cargando")}</p>
        ) : !hay ? (
          <p className="ptab-vacio">{t(sinProyecto ? "ptab.vacioGeneral" : "ptab.vacioProyecto")}</p>
        ) : (
          <>
            <Grupo titulo={t("ptab.preguntas")} items={g.preguntas}>
              {(i) => <Pregunta i={i} ocupado={ocupados.has(i.id)} alContestar={contestar} alCerrar={cerrar} />}
            </Grupo>
            <Grupo titulo={t("ptab.esperas")} items={g.esperas}>
              {(i) => <Espera i={i} ocupado={ocupados.has(i.id)} alCerrar={cerrar} />}
            </Grupo>
            <Grupo titulo={t("ptab.pendientes")} items={g.pendientes}>
              {(i) => <Pendiente i={i} ocupado={ocupados.has(i.id)} alCerrar={cerrar} />}
            </Grupo>
          </>
        )}
      </div>
    </div>
  );
}

function Grupo({ titulo, items, children }: { titulo: string; items: Item[]; children: (i: Item) => React.ReactNode }) {
  if (!items.length) return null;
  return (
    <section className="ptab-grupo" aria-label={titulo}>
      <h3 className="ptab-grupo-tit">
        {titulo}
        <span className="ptab-grupo-cuenta">{items.length}</span>
      </h3>
      <ul className="ptab-lista">
        {items.map((i) => (
          <li key={String(i.id)} className="ptab-item">
            {children(i)}
          </li>
        ))}
      </ul>
    </section>
  );
}

const titulo = (i: Item): string => i.tituloSimple.trim() || i.titulo;

function BotonCerrar({ i, ocupado, alCerrar }: { i: Item; ocupado: boolean; alCerrar: (i: Item) => void }) {
  const etq = t("ptab.cerrarItem", { n: numero(i.id), titulo: titulo(i) });
  return (
    <button type="button" className="ptab-cerrar" aria-label={etq} data-tip={t("ptab.cerrar")} disabled={ocupado} onClick={() => alCerrar(i)}>
      <X size={13} strokeWidth={2} aria-hidden />
    </button>
  );
}

function Cabeza({ i, ocupado, alCerrar }: { i: Item; ocupado: boolean; alCerrar: (i: Item) => void }) {
  return (
    <div className="ptab-cab">
      <p className="ptab-tit">{titulo(i)}</p>
      <BotonCerrar i={i} ocupado={ocupado} alCerrar={alCerrar} />
    </div>
  );
}

function Pregunta({ i, ocupado, alContestar, alCerrar }: { i: Item; ocupado: boolean; alContestar: (i: Item, opcion: string) => void; alCerrar: (i: Item) => void }) {
  const ops = opcionesDe(i);
  return (
    <article className="ptab-card" data-ocupado={ocupado ? "" : undefined}>
      <Cabeza i={i} ocupado={ocupado} alCerrar={alCerrar} />
      {i.contexto.trim() ? <p className="ptab-ctx">{i.contexto.trim()}</p> : null}
      {ops.length ? (
        <div className="ptab-ops" role="group" aria-label={titulo(i)}>
          {ops.map((o) => (
            <button
              key={o.id}
              type="button"
              className="ptab-op"
              data-sugerida={o.sugerida ? "" : undefined}
              aria-label={t("ptab.contestar", { n: numero(i.id), opcion: o.texto })}
              disabled={ocupado}
              onClick={() => alContestar(i, o.id)}
            >
              <span>{o.texto}</span>
              {o.sugerida ? <span className="ptab-sug">{t("ptab.sugerida")}</span> : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="ptab-ctx">{t("ptab.sinBotones")}</p>
      )}
    </article>
  );
}

function Espera({ i, ocupado, alCerrar }: { i: Item; ocupado: boolean; alCerrar: (i: Item) => void }) {
  const avance = avanceRenglones(i);
  const contestada = contestadoComo(i);
  const estado = i.columna === "espera-externo" ? t("ptab.espera.externo") : i.respuesta ? t("ptab.espera.contestada") : t("ptab.espera.prueba");
  return (
    <article className="ptab-card" data-ocupado={ocupado ? "" : undefined}>
      <Cabeza i={i} ocupado={ocupado} alCerrar={alCerrar} />
      <p className="ptab-estado">{estado}</p>
      {contestada ? <p className="ptab-ctx">{t("ptab.contestaste", { texto: contestada })}</p> : null}
      {i.prueba.trim() && !avance ? <Comando texto={i.prueba.trim()} /> : null}
      {avance ? <p className="ptab-ctx">{t("ptab.avance", { hechos: avance.hechos, total: avance.total })}</p> : null}
    </article>
  );
}

function Pendiente({ i, ocupado, alCerrar }: { i: Item; ocupado: boolean; alCerrar: (i: Item) => void }) {
  return (
    <article className="ptab-card" data-ocupado={ocupado ? "" : undefined}>
      <Cabeza i={i} ocupado={ocupado} alCerrar={alCerrar} />
      <p className="ptab-estado">{t(`tablero.col.${i.columna}` as never)}</p>
      {i.prueba.trim() ? <Comando texto={i.prueba.trim()} /> : null}
    </article>
  );
}

/** Lo que hay que probar, a la vista y con su botón de copiar. */
function Comando({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  const etq = copiado ? t("tablero.copiado") : t("tablero.copiar");
  return (
    <div className="ptab-cmd">
      <span className="ptab-cmd-lbl">{t("ptab.paraProbar")}</span>
      <div className="ptab-cmd-fila">
        <code>{texto}</code>
        <button
          type="button"
          className="ptab-copiar"
          data-copiado={copiado ? "" : undefined}
          aria-label={etq}
          data-tip={etq}
          onClick={() => {
            void navigator.clipboard?.writeText(texto).then(() => {
              setCopiado(true);
              setTimeout(() => setCopiado(false), COPIADO_MS);
            });
          }}
        >
          {copiado ? <Check size={13} strokeWidth={2} aria-hidden /> : <Copy size={13} strokeWidth={2} aria-hidden />}
        </button>
      </div>
    </div>
  );
}
