// Guion de medición de la barra (scripts/dev/bench.sh): hover, Cerrar y colapsar
// grupo, cada fase con sus frames; después verifica que un tic del reloj no
// re-renderiza filas y mide el reposo. Dura ~13 s y la app se cierra sola.
import { pedidos } from "../cuenta";
import { Medidor, resumir } from "../medidor";
import { bench } from "../puente";
import { relojPrueba } from "../reloj";
import { control } from "./control";
import { renders } from "./Fila";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dosFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// Una sola vez: en dev StrictMode monta los efectos dos veces.
let corriendo = false;

export async function correrGuion() {
  if (corriendo || !(await bench.modo().catch(() => false))) return;
  corriendo = true;

  const medidor = new Medidor();
  medidor.arrancar();
  while (!control.actual || !document.querySelector(".fila")) await espera(16);
  const c = control.actual;

  // Primer frame con la lista pintada, desde que arrancó el proceso.
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

  const cpuAnim0 = await bench.cpu();
  medidor.grabando = true;

  // Hover: el mismo CSS que dispara el mouse (`data-cursor` ≡ :hover), barriendo
  // las filas a la vista como un mouse rápido.
  const hover = await fase(async () => {
    let actual: Element | null = null;
    for (let k = 0; k < 36; k++) {
      const filas = document.querySelectorAll(".fila");
      actual?.removeAttribute("data-cursor");
      actual = filas[k % Math.min(filas.length, 8)];
      actual.setAttribute("data-cursor", "");
      await espera(70);
    }
    actual?.removeAttribute("data-cursor");
  });

  // Cerrar optimista: la fila se va a "Cerrados" y el resto sube (FLIP). Desde B12
  // sólo son cerrables los workers sin líder vivo (`settleWorker`), y desde B15 sólo
  // los que están a la vista: con las fixtures son 4, justo el tope.
  const cerrar = await fase(async () => {
    for (const id of c.cerrables().slice(0, 4)) {
      c.cerrar(id);
      await espera(600);
    }
  });

  // Colapsar y abrir grupos.
  const colapso = await fase(async () => {
    const [a, b] = c.grupos();
    for (const g of [a, b, a, b, a, a]) {
      c.alternar(g);
      await espera(400);
    }
  });

  medidor.grabando = false;
  const cpuAnim1 = await bench.cpu();
  const animacion = resumir(medidor.grabadas);

  // El reloj compartido: tres minutos de golpe. Cambian textos, no renderiza ninguna fila.
  const renders0 = renders.filas;
  const escrituras0 = relojPrueba.escrituras();
  for (let k = 0; k < 3; k++) {
    relojPrueba.adelantar(60);
    await dosFrames();
  }
  const reloj = {
    tics: 3,
    anotados: relojPrueba.anotados(),
    textos_escritos: relojPrueba.escrituras() - escrituras0,
    renders_de_fila: renders.filas - renders0,
  };

  // Reposo: sin rAF propio. Lo único vivo son las animaciones de estado (latido.ts).
  medidor.parar();
  await espera(600);
  const raf0 = pedidos.raf;
  const cpu0 = await bench.cpu();
  await espera(2000);
  // Segunda mitad aparte: la primera arrastra el GC de después de animar.
  const cpuMitad = await bench.cpu();
  await espera(2000);
  const cpu1 = await bench.cpu();
  // Lo que siga vivo acá es un bug: un rAF o una animación que no terminó.
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
    guion: "barra",
    arranque_ms,
    webview_hasta_primer_frame_ms: webview_ms,
    animacion,
    fases: { hover, cerrar, colapso },
    reloj,
    cpu_animacion: { cpu0: cpuAnim0, cpu1: cpuAnim1 },
    reposo: { cpu0, cpu_mitad: cpuMitad, cpu1 },
    reposo_vivo: vivo,
    ua: navigator.userAgent,
    reduced_motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
}
