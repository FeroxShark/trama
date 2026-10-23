// La marca de trama: dos hilos de trama (los horizontales, enteros) tejidos por
// arriba y por abajo de dos de urdimbre (más apagados). Un solo color
// (`currentColor`): sirve sobre fondo oscuro o claro, de 16 px para arriba.
// El ícono de la app (con placa) es el mismo dibujo: public/favicon.svg.
export function Marca({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M8.5 2.5v9.5M8.5 19v2.5M15.5 2.5v2.5M15.5 12v9.5" opacity=".5" />
      <path d="M2.5 8.5h2.5M12 8.5h9.5M2.5 15.5h9.5M19 15.5h2.5" />
    </svg>
  );
}
