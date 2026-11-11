// La vista de prueba de las barras de cupo (`captura=barra-cupo-demo`): 20 %, 85 %, 100 % y sin dato, en las dos variantes. El tema lo
// elige la captura (`HILOS_TEMA=claro`). Datos inventados y un reloj fijo: la foto no cambia de una corrida a otra.
import { t } from "../i18n";
import { BarraCupo } from "./BarraCupo";

// Un miércoles a las 15:00 (hora local): «vuelve a las 17:40» es de hoy y el de la semana cae otro día.
const AHORA = new Date(2026, 10, 11, 15, 0).getTime() / 1000;
const H = 3600;

const CASOS = [
  { clave: "20", pct: 20, vuelve: AHORA + 3 * H + 12 * 60, sem: false },
  { clave: "85", pct: 85, vuelve: AHORA + 2 * H + 40 * 60, sem: true },
  { clave: "100", pct: 100, vuelve: AHORA + 42 * H, sem: false },
  { clave: "sin", pct: null, vuelve: null, sem: true },
];

export function BarraCupoDemo() {
  return (
    <main className="bcupo-demo">
      <section className="bcupo-demo-panel" aria-label={t("bcupo.demoNormal")}>
        <h1 className="bcupo-demo-titulo">{t("bcupo.demoNormal")}</h1>
        {CASOS.map((c) => (
          <BarraCupo key={c.clave} nombre={c.sem ? t("bcupo.semana") : t("bcupo.cinco")} pct={c.pct} vuelve={c.vuelve} ahora={AHORA} />
        ))}
      </section>
      <section className="bcupo-demo-panel" aria-label={t("bcupo.demoCompacta")}>
        <h1 className="bcupo-demo-titulo">{t("bcupo.demoCompacta")}</h1>
        <div className="bcupo-demo-riel">
          {CASOS.map((c) => (
            <BarraCupo key={c.clave} nombre={c.sem ? t("riel.sem") : t("bcupo.cinco")} pct={c.pct} vuelve={c.vuelve} ahora={AHORA} variante="compacta" />
          ))}
        </div>
      </section>
    </main>
  );
}
