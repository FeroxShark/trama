import { memo } from "react";

/**
 * Antes de cada mensaje de una conversación: una caja sin caja (`display: none`) que dice cuál es el que sigue, para que el lugar
 * donde el usuario la dejó se pueda volver a encontrar aunque lo que mide cada mensaje cambie (src/hilo/scrollGuardado.ts, `Ancla`).
 */
export const Marca = memo(function Marca({ k }: { k: string }) {
  return <i className="k" data-k={k} aria-hidden="true" />;
});
