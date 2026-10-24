// Un panel que todavía no tiene datos (no es un error): qué se va a ver acá y cuándo aparece. Sin botón:
// lo que hace falta para llenarlo lo pone el usuario en otro lado (un worker, el cuadro de arriba del tablero).
export function Vacio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <section className="pn-vacio">
      <h3 className="pn-vacio-t">{titulo}</h3>
      <p className="pn-vacio-p">{texto}</p>
    </section>
  );
}
