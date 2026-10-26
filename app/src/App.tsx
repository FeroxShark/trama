import { Barra } from "./barra/Barra";
import { Bench } from "./Bench";
import { Conexion } from "./Conexion";
import { Atajos } from "./paneles/Atajos";
import { PasoLanzar } from "./paneles/PasoLanzar";
import { Salir } from "./paneles/Salir";
import { Bienvenida } from "./paneles/Bienvenida";
import { Guia } from "./guia/Guia";
import { MODO } from "./modo";

// La pantalla de B0 queda detrás de `HILOS_GUION=b0` para volver a medir el motor pelado.
export function App() {
  if (MODO.guion === "b0") return <Bench />;
  // La captura del cartel de error: el ErrorBoundary de la raíz lo atrapa, como a uno de verdad.
  if (MODO.captura === "error") throw new Error("Capture: this error is on purpose");
  return (
    <>
      <Barra />
      <Conexion />
      <Atajos />
      <Salir />
      <Bienvenida />
      <Guia />
      <PasoLanzar />
    </>
  );
}
