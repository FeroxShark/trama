// Si algo se rompe al pintar, en vez de una ventana en blanco: un cartel con qué pasó en una línea,
// Recargar y Copiar detalle. Está en la raíz (src/main.tsx). El mismo cartel lo carga el main cuando el
// renderer murió varias veces seguidas (`?cartel=`, electron/main.ts). Sin JSX: lo prueba tests/error-boundary.test.ts.
import { Component, createElement as h, useState, type ReactNode } from "react";
import { copiar } from "./copiar";
import { detalleDe, lineaDe, reportar } from "./errores";
import { t } from "./i18n";
import { main } from "./puente";

/** Vuelve a cargar la ventana por el main (que además suelta el tope de recargas); en el navegador del celular, la página. */
async function recargar() {
  try {
    if (main?.recargar) return await main.recargar();
  } catch {
    // Por la tailnet ese canal no existe.
  }
  location.reload();
}

export function Cartel({ linea, detalle }: { linea: string; detalle: string }) {
  const [copiado, setCopiado] = useState(false);
  return h(
    "div",
    { className: "er", role: "alert" },
    h("div", { className: "er-caja" },
      h("div", { className: "er-t" }, t("error.cartelTitulo")),
      h("div", { className: "er-l" }, linea),
      h(
        "div",
        { className: "er-bs" },
        h("button", { type: "button", className: "btn2", "data-prim": "", onClick: () => void recargar() }, t("error.cartelRecargar")),
        h(
          "button",
          {
            type: "button",
            className: "btn2",
            onClick: () =>
              void copiar(detalle).then((ok) => {
                setCopiado(ok);
                if (ok) setTimeout(() => setCopiado(false), 1500);
              }),
          },
          copiado ? t("error.cartelCopiado") : t("error.cartelCopiar"),
        ),
      ),
    ),
  );
}

type Estado = { error: { linea: string; detalle: string } | null };

export class ErrorBoundary extends Component<{ children?: ReactNode }, Estado> {
  state: Estado = { error: null };

  static getDerivedStateFromError(e: unknown): Estado {
    return { error: { linea: lineaDe(e), detalle: detalleDe(e) } };
  }

  componentDidCatch(e: unknown, info: { componentStack?: string | null }) {
    const detalle = `${detalleDe(e)}\nen:${info.componentStack ?? ""}`;
    reportar("ErrorBoundary", detalle);
    this.setState({ error: { linea: lineaDe(e), detalle } });
  }

  render() {
    const e = this.state.error;
    return e ? h(Cartel, e) : this.props.children;
  }
}
