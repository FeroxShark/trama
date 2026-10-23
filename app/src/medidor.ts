// Medidor de frames por requestAnimationFrame. No toca React: escribe el texto
// directo en un nodo para no re-renderizar nada mientras mide.

import { t as tr } from "./i18n";

export type Muestra = { t: number; dt: number };

export class Medidor {
  private muestras: Muestra[] = [];
  private ultimo = 0;
  private raf = 0;
  private ultimoPintado = 0;
  grabando = false;
  grabadas: Muestra[] = [];

  salida: HTMLElement | null = null;

  arrancar() {
    if (this.raf) return;
    this.ultimo = 0;
    const paso = (t: number) => {
      if (this.ultimo) {
        const m = { t, dt: t - this.ultimo };
        this.muestras.push(m);
        if (this.grabando) this.grabadas.push(m);
        while (this.muestras.length && this.muestras[0].t < t - 2000) this.muestras.shift();
        if (this.salida && t - this.ultimoPintado > 250) {
          this.ultimoPintado = t;
          this.salida.textContent = this.texto(t);
        }
      }
      this.ultimo = t;
      this.raf = requestAnimationFrame(paso);
    };
    this.raf = requestAnimationFrame(paso);
  }

  parar() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private texto(ahora: number) {
    const ultSeg = this.muestras.filter((m) => m.t >= ahora - 1000).length;
    const peor = Math.max(0, ...this.muestras.map((m) => m.dt));
    return tr("b0.fps", { fps: ultSeg, ms: peor.toFixed(1) });
  }
}

export function resumir(ms: Muestra[]) {
  if (ms.length < 2) return null;
  const dts = ms.map((m) => m.dt);
  const orden = [...dts].sort((a, b) => a - b);
  const mediana = orden[Math.floor(orden.length / 2)];
  const dur = ms[ms.length - 1].t - ms[0].t + ms[0].dt;
  const fin = ms[ms.length - 1].t;
  const ult2 = ms.filter((m) => m.t >= fin - 2000).map((m) => m.dt);
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    frames: ms.length,
    duracion_ms: r(dur),
    fps_medio: r((ms.length * 1000) / dur),
    dt_mediana_ms: r(mediana),
    dt_p99_ms: r(orden[Math.floor(orden.length * 0.99)]),
    peor_ms: r(orden[orden.length - 1]),
    peor_ms_ult_2s: r(Math.max(...ult2)),
    // Frames que tardaron más de 1.5× el típico: los tirones que se ven.
    tirones: dts.filter((d) => d > mediana * 1.5).length,
    dts: dts.map(r),
  };
}
