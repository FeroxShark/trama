// Los hilos de un carril (37 rayitas, cada una prendida es uso): sólo los usa el riel de la barra (`barra/CuposRiel.tsx`) hasta que pase a `BarraCupo`.
// Ajustes > Plan y cupos ya no los usa: sus límites son barras lisas (`ui/BarraCupo.tsx`). Los estilos de `.cu-hilos` están en `hilos.css`.
import { HILOS, hilosPrendidos } from "./cupos-tejido";
import "./hilos.css";

/** Los hilos de un carril (el número lo dice el renglón: esto es sólo para el ojo). */
export function Hilos({ pct, nivel, total = HILOS }: { pct: number | null; nivel: string; /** Cuántos hilos: la barra, que es angosta, usa menos. */ total?: number }) {
  const on = hilosPrendidos(pct, total);
  return (
    <span className="cu-hilos" data-nivel={nivel} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} data-on={i < on ? "" : undefined} data-tope={i === on - 1 ? "" : undefined} />
      ))}
    </span>
  );
}
