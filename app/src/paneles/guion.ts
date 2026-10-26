// Guion de medición de los paneles del pie (scripts/dev/bench.sh con
// HILOS_GUION=paneles): abre Ajustes, Estadísticas (7 ↔ 30 días) y Ramas, y en
// Ramas aprieta los botones de verdad: Integrar, Descartar (dos clics) y
// Deshacer. Va siempre con el `pa` falso (HILOS_PA=scripts/pa-falso.sh), que
// loguea lo que se le pidió. Dura ~12 s y la app se cierra sola.
import { pedidos } from "../cuenta";
import { Medidor, resumir } from "../medidor";
import { bench } from "../puente";
import { t } from "../i18n";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dosFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

const boton = (dentro: string, texto: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(`${dentro} button`)].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === texto,
  );

// Una sola vez: en dev StrictMode monta los efectos dos veces.
let corriendo = false;

export async function correrGuionPaneles() {
  if (corriendo || !(await bench.modo().catch(() => false))) return;
  corriendo = true;

  const medidor = new Medidor();
  medidor.arrancar();
  while (!document.querySelector(".fila")) await espera(16);
  await dosFrames();
  const arranque_ms = await bench.listo();
  const webview_ms = performance.now();
  await espera(300);

  const fase = async (pasos: () => Promise<void>) => {
    const desde = medidor.grabadas.length;
    await pasos();
    const r = resumir(medidor.grabadas.slice(desde));
    return r && { ...r, dts: undefined };
  };
  /** Lo que el guion fue viendo: va al JSON para revisarlo contra el log del `pa` falso. */
  const visto: Record<string, unknown> = {};
  const clic = async (dentro: string, texto: string, ms: number) => {
    const b = boton(dentro, texto);
    b?.click();
    await espera(ms);
    return !!b;
  };

  const cpuAnim0 = await bench.cpu();
  medidor.grabando = true;

  const ajustes = await fase(async () => {
    await clic(".pie", t("panel.ajustes"), 600);
    visto.ajustes = [...document.querySelectorAll(".pn-val")].map((n) => n.textContent);
  });

  const estadisticas = await fase(async () => {
    await clic(".pie", t("panel.estadisticas"), 500);
    for (const n of [30, 7, 30]) await clic(".pn-seg", t("est.dias", { n }), 400);
    visto.estadisticas = [...document.querySelectorAll(".pn-cifra")].map((n) => n.textContent);
  });

  const ramas = await fase(async () => {
    await clic(".pie", t("panel.ramas"), 500);
    const filas = () => document.querySelectorAll(".pn-rama").length;
    visto.ramas_antes = filas();
    visto.integrar = await clic(".pn", t("ramas.integrar"), 800);
    visto.error_integrar = document.querySelector(".pn-error")?.textContent ?? null;
    // Descartar: el primer clic sólo lo arma.
    visto.descartar_armado = (await clic(".pn", t("ramas.descartar"), 200)) && !!boton(".pn", t("ramas.descartarSeguro"));
    visto.descartar = await clic(".pn", t("ramas.descartarSeguro"), 800);
    visto.deshacer = await clic(".pn", t("ramas.deshacer"), 800);
    visto.ramas_despues = filas();
    visto.errores = [...document.querySelectorAll(".pn-error")].map((n) => n.textContent);
  });

  const volver = await fase(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await espera(300);
    visto.esc_cierra = !document.querySelector(".pn");
  });

  medidor.grabando = false;
  const cpuAnim1 = await bench.cpu();
  const animacion = resumir(medidor.grabadas);

  medidor.parar();
  await espera(600);
  const raf0 = pedidos.raf;
  const cpu0 = await bench.cpu();
  await espera(1500);
  const cpuMitad = await bench.cpu();
  await espera(1500);
  const cpu1 = await bench.cpu();
  const vivo = {
    rafs: pedidos.raf - raf0,
    animaciones: document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => {
        const nombre = "animationName" in a ? a.animationName : "transitionProperty" in a ? a.transitionProperty : "waapi";
        const en = a.effect instanceof KeyframeEffect ? a.effect.target : null;
        return `${nombre}@${en?.className || en?.tagName || "?"}`;
      }),
  };

  await bench.fin({
    guion: "paneles",
    arranque_ms,
    webview_hasta_primer_frame_ms: webview_ms,
    animacion,
    fases: { ajustes, estadisticas, ramas, volver },
    visto,
    reloj: { tics: 0, anotados: 0, textos_escritos: 0, renders_de_fila: 0 },
    cpu_animacion: { cpu0: cpuAnim0, cpu1: cpuAnim1 },
    reposo: { cpu0, cpu_mitad: cpuMitad, cpu1 },
    reposo_vivo: vivo,
    ua: navigator.userAgent,
    reduced_motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
}
