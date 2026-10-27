// Una fila del aviso de arriba de Ajustes > Proyectos ("Unificar todos") para un proyecto que hay que fusionar: nombre con su ícono en la
// misma línea y "Fusionar con IA" (el mismo lanzamiento que el botón de su tarjeta). Con un agente ya trabajando, la fila dice que lo está
// fusionando y lleva a Ramas. Sin estado propio: lo pone quien la usa (AjustesProyectos.tsx). Es .ts (sin JSX) para poder probarla con
// react-dom/server en node --test.
import { createElement as h } from "react";
import { AlertTriangle, Bot, GitBranch, Merge } from "lucide-react";
import { t } from "../i18n";

export function FilaFusion({ nombre, slug, tarea, lanzando, error, alFusionar, alIrRamas }: { nombre: string; slug: string; tarea: "acortar" | "fusionar" | null; lanzando: boolean; error: string | null; alFusionar: () => void; alIrRamas: () => void }) {
  const fusionando = tarea === "fusionar";
  const icono = { size: 13, strokeWidth: 1.8, "aria-hidden": true as const };
  return h(
    "li",
    { className: "pry-todos-fila", "data-clase": "fusion", "data-fusion-fila": slug },
    h("span", { className: "pry-todos-nom" }, h(fusionando ? Bot : AlertTriangle, icono), h("b", null, nombre)),
    fusionando
      ? [
          h("span", { key: "est", className: "pry-todos-est", "data-agente-fusionando": true }, t("pry.md.agenteFusionando")),
          h("button", { key: "ramas", type: "button", className: "mini", "data-ir-ramas": true, onClick: alIrRamas }, h(GitBranch, { ...icono, size: 12 }), t("pry.md.irRamas")),
        ]
      : h(
          "button",
          { type: "button", className: "mini pn-primario", "data-fusionar-fila": true, disabled: lanzando || tarea !== null, onClick: alFusionar },
          h(Merge, icono),
          lanzando ? t("pry.md.lanzando") : t("pry.md.fusionarBtn"),
        ),
    error ? h("span", { className: "pn-error", role: "alert" }, error) : null,
  );
}
