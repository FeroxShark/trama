// La lógica de `Avance` (src/ui/Avance.tsx), sin React: dado el paso de la instalación de Trama, desde cuándo va y cuándo se vio la última
// línea nueva del log, devuelve qué decir (paso «n de 4»), cuánto lleva («1:12») y si tarda de más. Todo con el `ahora` que se le pasa:
// nada lee el reloj acá, así el test fija el momento y la interfaz sólo vuelve a llamar cada segundo.
import type { PasoInstalacion } from "../datos/fuente";

/** Los pasos, en orden (electron/actualizacion-trama.ts `PASOS_ACT`). */
export const PASOS: readonly PasoInstalacion[] = ["bajando", "compilando", "motor", "ventana"];

/** Un paso que pasa de esto sin una línea nueva en el log se avisa como «tarda de más». */
export const LENTO_MS = 3 * 60_000;

export type EntradaAvance = {
  /** Sin paso (un estado viejo que no lo trae): se muestra el primero. */
  paso?: PasoInstalacion;
  /** ms desde epoch en que empezó el paso; sin él no hay tiempo que mostrar ni cuenta para lo lento. */
  desde?: number;
  ahora: number;
  /** 0 a 1, si algún paso lo sabe. Hoy ninguno lo trae: la barra se mueve sola. */
  porcentaje?: number;
  /** ms desde epoch de la última línea nueva del log; cuenta lo que haya pasado desde ahí (o desde el inicio del paso, lo que sea más reciente). */
  ultimaLinea?: number;
};

export type Avance = {
  paso: PasoInstalacion;
  /** 1 a 4. */
  n: number;
  total: number;
  /** 0 a 1, o `null`: sin porcentaje la barra se mueve sola. */
  porcentaje: number | null;
  /** Lo que lleva el paso en ms, o `null` si no se sabe desde cuándo. */
  transcurrido: number | null;
  /** «1:12», «12:05», «1:02:03»; `null` si no se sabe. */
  tiempo: string | null;
  lento: boolean;
};

/** Milisegundos como «m:ss» (con horas, «h:mm:ss»). Lo negativo (reloj atrasado) cuenta como cero. */
export function formatoTiempo(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const dos = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dos(m)}:${dos(r)}` : `${m}:${dos(r)}`;
}

const finito = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function avance(e: EntradaAvance): Avance {
  const paso = e.paso && PASOS.includes(e.paso) ? e.paso : PASOS[0];
  const transcurrido = finito(e.desde) ? Math.max(0, e.ahora - e.desde) : null;
  // La línea nueva más reciente: la del log, o el arranque del paso (el log no trae hora de lo que no escribió todavía).
  const ref = Math.max(finito(e.desde) ? e.desde : -Infinity, finito(e.ultimaLinea) ? e.ultimaLinea : -Infinity);
  return {
    paso,
    n: PASOS.indexOf(paso) + 1,
    total: PASOS.length,
    porcentaje: finito(e.porcentaje) ? Math.min(1, Math.max(0, e.porcentaje)) : null,
    transcurrido,
    tiempo: transcurrido === null ? null : formatoTiempo(transcurrido),
    // Estrictamente más de 3 minutos: justo 3:00 todavía no.
    lento: Number.isFinite(ref) && e.ahora - ref > LENTO_MS,
  };
}

/** El paso en palabras («Compilando · paso 2 de 4»), con el traductor de la interfaz. */
export function textoPaso(a: Pick<Avance, "paso" | "n" | "total">, t: (clave: string, vars?: Record<string, string | number>) => string): string {
  return t("avance.paso", { paso: t(`avance.${a.paso}`), n: a.n, total: a.total });
}
