// Los renglones de una prueba («Probar <proyecto> (Linux|Windows)»): el CLI los deja en `prueba` numerados, uno por línea,
// `1. [ ] texto` / `2. [x] texto` (`ponerRenglones`, electron/cli/tablero.ts). Función pura: sin React ni DOM.
// Un item viejo (texto suelto, un comando) no trae renglones: devuelve `null` y se muestra como siempre.

export type Renglon = { n: number; texto: string; hecho: boolean };

const RENGLON = /^(\d{1,3})\.\s\[([ xX])\]\s?(.*)$/;

/** `null` si `prueba` no es una lista de renglones. Las líneas sin número siguen al renglón de arriba (un texto de varias líneas). */
export function renglonesDe(prueba: string): Renglon[] | null {
  const rs: Renglon[] = [];
  for (const linea of prueba.replace(/\r\n?/g, "\n").split("\n")) {
    const m = RENGLON.exec(linea);
    if (m) {
      // Numeración salteada o repetida: no es lo que arma el CLI, se trata como texto suelto.
      if (Number(m[1]) !== rs.length + 1) return null;
      rs.push({ n: rs.length + 1, texto: m[3]!.trim(), hecho: m[2] !== " " });
    } else if (rs.length && linea.trim()) rs[rs.length - 1]!.texto += ` ${linea.trim()}`;
    else if (linea.trim()) return null;
  }
  return rs.length ? rs : null;
}

/** Cuántos renglones están tildados. */
export const hechos = (rs: readonly Renglon[]): number => rs.filter((r) => r.hecho).length;

/** La lista con el renglón `n` tildado o destildado (lo optimista: se pinta antes de que conteste el CLI). */
export const conTilde = (rs: readonly Renglon[], n: number, hecho: boolean): Renglon[] => rs.map((r) => (r.n === n ? { ...r, hecho } : r));

/** Lo único que hace falta de la fuente del tablero para tildar (se inyecta: el test pasa una de mentira). */
export type TildaDe = { tildar(id: number | string, numeros: number[], hecho: boolean): Promise<void> };

/**
 * Tilda o destilda el renglón `n` del item `id` (`tablero tildar`) y devuelve la lista como queda. Si el CLI falla rechaza con lo
 * que dijo y no devuelve nada: quien llama deja la lista como estaba. Con todos tildados el CLI cierra el item (lo ve la próxima lectura).
 */
export async function tildarRenglon(fuente: TildaDe, id: number | string, rs: readonly Renglon[], n: number, hecho: boolean): Promise<Renglon[]> {
  if (!rs.some((r) => r.n === n)) throw new Error(`no hay renglón ${n}`);
  await fuente.tildar(id, [n], hecho);
  return conTilde(rs, n, hecho);
}
