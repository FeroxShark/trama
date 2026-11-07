// Las viñetas de una versión del CHANGELOG (electron/novedades-cambios.ts): cada una con su `código` y **negrita** dibujados como
// elementos (nunca como HTML), para el aviso del pie y para Ajustes > Actualizaciones.
import { trozos } from "../../electron/novedades-cambios";
import "./lista-novedades.css";

export function Vinetas({ items }: { items: readonly string[] }) {
  return (
    <ul className="vin">
      {items.map((it, i) => (
        <li key={i}>
          {trozos(it).map((z, j) => (z.tipo === "codigo" ? <code key={j}>{z.texto}</code> : z.tipo === "negrita" ? <strong key={j}>{z.texto}</strong> : z.texto))}
        </li>
      ))}
    </ul>
  );
}
