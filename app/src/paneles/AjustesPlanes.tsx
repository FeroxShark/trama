// Ajustes > Plan y cupos > «Tu plan en cada suscripción»: el plan de Claude, Google y ChatGPT con el que Modelos calcula el costo de cada
// esfuerzo (× la parte del precio de API que paga ese plan, datos de Priors). Automático: Claude detectado del credentials, Google AI Pro con
// `agy`. Se guarda en `planes` de modelos.json con el resto del borrador (botón Guardar de Modelos).
import { t } from "../i18n";
import { Selector } from "../hilo/Selector";
import { GrupoAjustes, FilaAjuste } from "./AjustesPiezas";
import { elegirPlan, type Borrador } from "./modelos-borrador";
import { AtribucionPriors } from "./AjustesWorkers";
import { PLAN_GOOGLE_DEFECTO, planesDe, PROVEEDORES_PLAN, type VistaPlanes } from "../../electron/costo-planes-texto";

const NOMBRE: Record<string, () => string> = { claude: () => t("cu.claude"), google: () => "Google", openai: () => t("cu.chatgpt") };

function autoDe(proveedor: string, planes: VistaPlanes | null): string {
  if (proveedor === "claude" && planes?.claude) return t("cu.planAutoDetectado", { plan: planes.claude });
  if (proveedor === "google" && planes?.agy) return t("cu.planAutoGoogle", { plan: PLAN_GOOGLE_DEFECTO });
  return t("cu.planAutoSin");
}

export function PlanesSuscripcion({ b, cambiar, planes }: { b: Borrador; cambiar: (b: Borrador) => void; planes: VistaPlanes | null }) {
  const datos = planes?.datos ?? null;
  return (
    <section className="pn-sec pn-edita" data-planes>
      <GrupoAjustes titulo={t("cu.planes")} subtitulo={t("cu.planesSub")}>
        {PROVEEDORES_PLAN.map((p) => {
          const lista = planesDe(datos, p);
          const elegido = b.planes[p] ?? "";
          const opciones = [
            { id: "", nombre: t("cu.planAuto"), desc: autoDe(p, planes), rec: true },
            ...[...new Set([...lista, ...(elegido && !lista.includes(elegido) ? [elegido] : [])])].map((x) => ({ id: x, nombre: x, desc: x === elegido ? t("cu.planElegido") : "" })),
          ];
          const nombre = NOMBRE[p]?.() ?? p;
          return (
            <FilaAjuste
              key={p}
              opc={`cu.plan.${p}`}
              titulo={nombre}
              ayuda={elegido ? t("cu.planElegido") : autoDe(p, planes)}
              control={
                <div className="pn-sel">
                  <Selector etiqueta={t("cu.planOpcion", { proveedor: nombre })} opciones={opciones} valor={elegido} alElegir={(id) => cambiar(elegirPlan(b, p, id))} />
                </div>
              }
            />
          );
        })}
      </GrupoAjustes>
      <p className="pn-nota">{datos ? <AtribucionPriors /> : t("cu.planesSinDatos")}</p>
    </section>
  );
}
