// La lista de casillas de una prueba con renglones (`tablero probar`), compartida por el tablero nuevo (`PruebaRenglones`, TableroNuevo.tsx)
// y el panel viejo (el detalle de un item, Tablero.tsx). Tildar llama a `tablero:tildar` (`tildarRenglon`); con todos tildados el CLI cierra
// el item. Estilos `pd-*` de pendientes.css. La lectura de los renglones: src/datos/tablero-renglones.ts.
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { fuenteTablero } from "../datos/fuenteTablero";
import type { ItemId } from "../datos/tablero";
import { hechos, tildarRenglon, type Renglon } from "../datos/tablero-renglones";
import { t } from "../i18n";
import "./pendientes.css";

/**
 * El estado de la lista de un item: lo optimista (se tilda ya y, si el CLI falla, vuelve con su error) y el progreso.
 * `firma` cambia cuando el tablero se relee (otro renglón sumado, o tildado desde otro lado): pisa lo local.
 */
export function useRenglones(id: ItemId, base: Renglon[], firma: string) {
  const [rs, setRs] = useState(base);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  useEffect(() => setRs(base), [firma]);
  const tildar = (n: number, hecho: boolean) => {
    setOcupado(n);
    setFalla(null);
    tildarRenglon(fuenteTablero, id, rs, n, hecho).then(
      (nuevo) => {
        setRs(nuevo);
        setOcupado(null);
      },
      (e: Error) => {
        setFalla(t("pd.pasoFalla", { error: e.message }));
        setOcupado(null);
      },
    );
  };
  const listos = hechos(rs);
  return { rs, ocupado, falla, tildar, listos, todo: listos === rs.length };
}

/** Una casilla de verdad por renglón (clic y teclado) y, si el CLI falló, su error debajo. */
export function ListaRenglones({ estado }: { estado: Pick<ReturnType<typeof useRenglones>, "rs" | "ocupado" | "falla" | "tildar"> }) {
  const { rs, ocupado, falla, tildar } = estado;
  return (
    <>
      <ul className="pd-pasos" aria-label={t("pd.pasos")}>
        {rs.map((r) => (
          <li key={r.n}>
            <label className="pd-paso" data-hecho={r.hecho ? "" : undefined}>
              <input type="checkbox" checked={r.hecho} disabled={ocupado === r.n} onChange={(e) => tildar(r.n, e.target.checked)} />
              <span className="pd-caja" aria-hidden="true">
                <Check size={12} strokeWidth={3} />
              </span>
              <span className="pd-paso-t">{r.texto}</span>
            </label>
          </li>
        ))}
      </ul>
      {falla ? (
        <p className="pd-paso-error" role="alert">
          {falla}
        </p>
      ) : null}
    </>
  );
}
