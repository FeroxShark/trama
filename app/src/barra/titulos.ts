// El `titulo` del registry de cada proyecto (slug → título): así se ve la
// carpeta en la barra y en las migas. Se pide una vez y lo comparten todos; a
// `pa` va siempre el nombre del registry, nunca esto.
import { useSyncExternalStore } from "react";
import { fuente } from "../datos/fuente";

const VACIO: Readonly<Record<string, string>> = {};
let titulos: Readonly<Record<string, string>> = VACIO;
let pedido = false;
const oyentes = new Set<() => void>();

function suscribir(fn: () => void) {
  oyentes.add(fn);
  if (!pedido) {
    pedido = true;
    void fuente.titulos().then(
      (t) => {
        titulos = t;
        oyentes.forEach((f) => f());
      },
      () => {},
    );
  }
  return () => void oyentes.delete(fn);
}

export const useTitulos = () => useSyncExternalStore(suscribir, () => titulos);
