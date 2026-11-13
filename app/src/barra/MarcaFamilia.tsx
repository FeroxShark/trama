// Marca geométrica de 8 px por familia de modelo para el chip de la barra lateral.
// Cada familia tiene forma propia (rombo, círculo, triángulo, estrella de cuatro puntas o cuadrado)
// además de su token de color: nunca depende sólo del color.
import type { Familia } from "./marca-familia";

const TRAZOS: Partial<Record<Familia, string>> = {
  opus: "M4 0.3L7.7 4L4 7.7L0.3 4Z",
  haiku: "M4 0.6L7.7 7.3H0.3Z",
  fable: "M4 0L5.05 2.95L8 4L5.05 5.05L4 8L2.95 5.05L0 4L2.95 2.95Z",
};

export function MarcaFamilia({ familia }: { familia: Familia }) {
  const d = TRAZOS[familia];
  return (
    <svg className="mf" data-familia={familia} width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
      {d ? <path d={d} /> : familia === "sonnet" ? <circle cx="4" cy="4" r="3.4" /> : <rect x="1" y="1" width="6" height="6" />}
    </svg>
  );
}
