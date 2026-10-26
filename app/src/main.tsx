import "./reloj-fijo";
import "./cuenta";
import "./apariencia";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { armarActualizando } from "./actualizando";
import { App } from "./App";
import { pedirDueno } from "./datos/dueno-pedir";
import { pedirModelos } from "./datos/modelos-config";
import { aplicarModelos } from "./hilo/opciones";
import { Cartel, ErrorBoundary } from "./ErrorBoundary";
import { armarErrores } from "./errores";
import { t } from "./i18n";
import "./index.css";
import "./ui/ui.css";
import { MODO } from "./modo";
import { traerVuelta } from "./volver";

// Soltar un archivo donde nadie lo espera no hace nada (sin esto, Chromium lo abre y la app se va; B26).
for (const ev of ["dragover", "drop"] as const) document.addEventListener(ev, (e) => e.preventDefault());

armarErrores();
armarActualizando();

// El renderer murió varias veces seguidas y el main no lo recarga más: sólo el cartel, sin la app (que es lo que se cae).
const pintar = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {MODO.cartel !== null ? (
        <Cartel linea={t("error.cartelMuertes")} detalle={MODO.cartel} />
      ) : (
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      )}
    </StrictMode>,
  );

// Tras el reinicio que pidió el usuario (o una recarga en el celular) arranca como estaba: se espera, apenas, a saber cómo.
// Antes, los modelos de modelos.json (Gemini, Ollama, el líder por defecto): los selectores se arman con ellos.
const vuelta = MODO.cartel === null ? traerVuelta() : null;
void (MODO.cartel === null ? Promise.all([pedirModelos().then(aplicarModelos), pedirDueno()]) : Promise.resolve()).then(() => (vuelta ? vuelta.then(pintar) : pintar()));
