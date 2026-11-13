import { lazy, Suspense } from "react";
import { Barra } from "./barra/Barra";
import { Conexion } from "./Conexion";
import { Atajos } from "./paneles/Atajos";
import { PasoLanzar } from "./paneles/PasoLanzar";
import { Salir } from "./paneles/Salir";
import { Bienvenida } from "./paneles/Bienvenida";
import { Guia } from "./guia/Guia";
import { BarraCupoDemo } from "./ui/BarraCupoDemo";
import { MODO } from "./modo";

// La pantalla de B0 queda detrás de `HILOS_GUION=b0` para volver a medir el motor pelado.
// Va en un chunk aparte: el import() sólo corre cuando se renderiza (sólo con MODO.guion === "b0").
const Bench = lazy(() => import("./Bench").then((m) => ({ default: m.Bench })));
const AcopleDemo = lazy(() => import("./barra/AcopleDemo").then((m) => ({ default: m.AcopleDemo })));

export function App() {
  if (MODO.guion === "b0")
    return (
      <Suspense fallback={null}>
        <Bench />
      </Suspense>
    );
  // La captura del cartel de error: el ErrorBoundary de la raíz lo atrapa, como a uno de verdad.
  if (MODO.captura === "error") throw new Error("Capture: this error is on purpose");
  if (MODO.captura === "barra-cupo-demo") return <BarraCupoDemo />;
  if (MODO.captura === "acople-demo" || MODO.captura === "acople-demo-movido")
    return (
      <Suspense fallback={null}>
        <AcopleDemo movido={MODO.captura === "acople-demo-movido"} />
      </Suspense>
    );
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
