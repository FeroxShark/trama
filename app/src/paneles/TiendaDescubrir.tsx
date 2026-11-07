// Ajustes > Conectores como tienda: «Descubrir» por secciones («Para vos» si hay base, «Nuevos», «Más instalados») y las categorías con su conteo
// (cada una filtra). Una sección sólo existe si la fuente trae el dato con que se arma: nada se inventa. Sin ninguna, la pestaña se dibuja plana.
import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { t } from "../i18n";
import { Boton } from "../ui/componentes";
import { Rejilla } from "./TiendaTarjetas";
import { seccionesDescubrir, type SeccionId, type Tarjeta } from "./tienda-logica";

type Props = {
  tarjetas: Tarjeta[];
  /** Cómo se dibuja cada tarjeta (el shell sabe lo que está en curso y qué hacer al tocarla). */
  dibujar: (x: Tarjeta) => ReactNode;
  alVerTodo: (id: SeccionId) => void;
  alCategoria: (nombre: string) => void;
};

function Seccion({ id, titulo, que, total, alVerTodo, children }: { id: SeccionId; titulo: string; que: string; total: number; alVerTodo: (id: SeccionId) => void; children: ReactNode }) {
  const uid = useId();
  return (
    <section className="ti-sec" aria-labelledby={`${uid}-t`} data-seccion={id}>
      <header className="ti-sec-cab">
        <div className="ti-sec-txt">
          <h3 id={`${uid}-t`} className="ti-sec-t">{titulo}</h3>
          <p className="ti-sec-d">{que}</p>
        </div>
        <Boton className="ti-ver" onClick={() => alVerTodo(id)} aria-label={`${t("tienda.verTodo")}: ${titulo} (${total})`}>
          <span>{t("tienda.verTodo")}</span> <span className="ti-ver-n">{total}</span> <ChevronRight size={14} strokeWidth={2.2} aria-hidden />
        </Boton>
      </header>
      {children}
    </section>
  );
}

export function SeccionesDescubrir({ tarjetas, dibujar, alVerTodo, alCategoria }: Props) {
  const uid = useId();
  const { secciones, categorias } = seccionesDescubrir(tarjetas);
  return (
    <div className="ti-secciones" data-secciones>
      {secciones.map((s) => (
        <Seccion key={s.id} id={s.id} titulo={t(`tienda.sec.${s.id}`)} que={t(`tienda.sec.${s.id}Que`)} total={s.total} alVerTodo={alVerTodo}>
          <Rejilla>{s.items.map(dibujar)}</Rejilla>
        </Seccion>
      ))}
      {categorias.length ? (
        <section className="ti-sec" aria-labelledby={`${uid}-c`} data-seccion="categorias">
          <header className="ti-sec-cab">
            <div className="ti-sec-txt">
              <h3 id={`${uid}-c`} className="ti-sec-t">{t("tienda.sec.categorias")}</h3>
              <p className="ti-sec-d">{t("tienda.sec.categoriasQue")}</p>
            </div>
          </header>
          <ul className="ti-cats">
            {categorias.map((c) => (
              <li key={c.nombre}>
                <button type="button" className="ti-cat" onClick={() => alCategoria(c.nombre)} aria-label={t("tienda.verCategoria", { c: c.nombre, n: c.n })}>
                  <span className="ti-cat-n">{c.nombre}</span>
                  <span className="ti-cat-c">{c.n}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
