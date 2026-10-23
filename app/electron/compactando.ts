// Quién está compactando su contexto ahora mismo. Claude Code no lo deja
// escrito en ningún lado (la sesión dice `busy` y en el transcript sólo queda,
// después, la raya de "se compactó"), así que lo dicen sus hooks:
// `scripts/hook-compactando.sh` deja una marca vacía en `<estado>/compactando/<id>`
// al empezar (PreCompact) y la saca al terminar (PostCompact). `<id>`: el del
// run de `pa` en un worker, el session_id en un líder. Acá se mira esa carpeta
// con inotify: sin polling.
// Una marca que nadie sacó (al que compactaba lo mataron) vence sola: un único
// timer, puesto para cuando le toca a la más vieja, y sólo mientras haya alguna.
// Sin imports locales: lo prueba `tests/compactando.test.ts`.
import { mkdirSync } from "node:fs";
import { mirarCarpeta, type Mirada } from "./mirar.ts";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { silencio } from "./log.ts";

/** Compactar tarda de medio minuto a unos pocos: pasado esto, la marca quedó huérfana. */
export const VENCE_MS = 10 * 60_000;
const DEBOUNCE_MS = 100;
/** Un id de run de `pa` o un session_id: nada que pueda salirse de la carpeta. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** id → epoch (s) de cuándo empezó a compactar. */
export type Compactando = Record<string, number>;

export function crearCompactando(dir: string, alCambiar: (c: Compactando) => void, venceMs = VENCE_MS) {
  let w: Mirada | null = null;
  let espera: NodeJS.Timeout | null = null;
  let vence: NodeJS.Timeout | null = null;
  let ultimo = "{}";

  async function leer(): Promise<Compactando> {
    const c: Compactando = {};
    let proxima = Infinity;
    const nombres = await readdir(dir).catch(() => [] as string[]);
    const ahora = Date.now();
    for (const n of nombres.sort()) {
      if (!ID.test(n)) continue;
      const s = await stat(path.join(dir, n)).catch(() => null);
      if (!s?.isFile()) continue;
      const edad = Math.max(0, ahora - s.mtimeMs);
      if (edad >= venceMs) {
        void unlink(path.join(dir, n)).catch(silencio("compactando"));
        continue;
      }
      c[n] = Math.floor(s.mtimeMs / 1000);
      proxima = Math.min(proxima, venceMs - edad);
    }
    if (vence) clearTimeout(vence);
    vence = w && proxima < Infinity ? setTimeout(() => void avisar(), proxima + 50) : null;
    vence?.unref();
    ultimo = JSON.stringify(c);
    return c;
  }

  async function avisar() {
    const antes = ultimo;
    const c = await leer();
    if (ultimo !== antes) alCambiar(c);
  }

  /** Empieza a mirar la carpeta (la crea: es del estado propio). Si ya miraba, nada. */
  function mirar() {
    if (w) return;
    try {
      mkdirSync(dir, { recursive: true });
      const programar = () => {
        if (espera) clearTimeout(espera);
        espera = setTimeout(() => void avisar(), DEBOUNCE_MS);
      };
      w = mirarCarpeta(dir, programar, { donde: "compactando", alRearmar: programar });
    } catch {
      // Sin carpeta no hay nada que mirar (y no se reintenta: sería polling).
    }
  }

  function cerrar() {
    w?.cerrar();
    w = null;
    if (espera) clearTimeout(espera);
    if (vence) clearTimeout(vence);
    espera = vence = null;
  }

  return { leer, mirar, cerrar };
}
