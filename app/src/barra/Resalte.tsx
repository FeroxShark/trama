// Lo que se está buscando, marcado en las filas y los encabezados de la barra. El texto buscado va por contexto para no pasarlo fila por
// fila: sólo se repintan las filas cuando cambia lo que se busca.
import { createContext, useContext, useMemo } from "react";
import { partirResalte } from "./riel";

export const LoBuscado = createContext("");

export function Resalte({ texto }: { texto: string }) {
  const q = useContext(LoBuscado);
  const tramos = useMemo(() => partirResalte(texto, q), [texto, q]);
  if (tramos.length === 1 && !tramos[0].m) return <>{texto}</>;
  return (
    <>
      {tramos.map((x, i) => (x.m ? <mark key={i}>{x.t}</mark> : <span key={i}>{x.t}</span>))}
    </>
  );
}
