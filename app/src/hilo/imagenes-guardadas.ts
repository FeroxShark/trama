// Las imágenes pegadas de las cajas, guardadas en disco por el main cada una en su archivo (electron/borradores.ts). La
// ventana sube cada imagen UNA vez (`subir` devuelve su hash) y desde ahí las fotos de lo escrito (src/volver.ts) llevan
// sólo la referencia: teclear no vuelve a mandar ni a escribir megas. Sin Electron ni React: lo prueba tests/archivos.test.ts.
import type { Imagen } from "../../electron/imagenes";

/** Lo que guarda el JSON de borradores por imagen (`ImagenRef` del main). */
export type ImagenRef = { tipo: string; hash: string; largo: number };

export function crearImagenesGuardadas(subir: (tipo: string, datos: string) => Promise<string>, alSubir: () => void) {
  /** datos (base64) → hash de su archivo; sólo de las imágenes que están en alguna caja. */
  const hashes = new Map<string, string>();
  const subiendo = new Set<string>();
  return {
    /** Lo que ya está en disco (lo que devolvió el main al abrir): no se vuelve a subir. */
    conocida: (datos: string, hash: string) => void hashes.set(datos, hash),
    /**
     * Las referencias de lo que hay en cada caja. Una imagen que todavía no se subió se sube ahora (`alSubir` avisa cuando
     * termina, para que la próxima foto ya la lleve) y esta foto no la lleva. Las que ya no están en ninguna caja se olvidan
     * (si la caja las recupera, p. ej. un envío que falló, se vuelven a subir: el main las borró al soltarlas).
     */
    refs(cajas: Record<string, readonly Imagen[]>): Record<string, ImagenRef[]> {
      const r: Record<string, ImagenRef[]> = {};
      const presentes = new Set<string>();
      for (const [clave, l] of Object.entries(cajas))
        for (const i of l) {
          presentes.add(i.datos);
          const hash = hashes.get(i.datos);
          if (hash) (r[clave] ??= []).push({ tipo: i.tipo, hash, largo: i.datos.length });
          else if (!subiendo.has(i.datos)) {
            subiendo.add(i.datos);
            subir(i.tipo, i.datos).then(
              (h) => {
                subiendo.delete(i.datos);
                hashes.set(i.datos, h);
                alSubir();
              },
              () => void subiendo.delete(i.datos), // se reintenta con el próximo cambio
            );
          }
        }
      for (const d of [...hashes.keys()]) if (!presentes.has(d)) hashes.delete(d);
      return r;
    },
  };
}
