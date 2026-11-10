// La cola guardada (`cola.json`) se lee una sola vez por proceso (electron/nucleo.ts). Si la carga falla, la promesa no puede quedar rechazada
// para siempre: el que llame después recibiría siempre el mismo error y la cola quedaría rota. Se suelta (el que llame después reintenta) y se
// anota en el log.
// Node puro (sin `electron`): lo prueba tests/cola-archivo.test.ts.
export type DepsLecturaCola = {
  /** El archivo, tal cual está (si no se puede leer, rechaza). */
  leer: () => Promise<string>;
  /** Carga lo leído en la cola: lo que no se entiende, la cola lo ignora (y avisa con `Deps.respaldo`). */
  cargar: (json: string | null) => void | Promise<void>;
  /** Qué se hace con el error (el log). */
  alFallar: (e: unknown) => void;
};

/** La lectura de la cola: una sola vez mientras va bien; si falla, se suelta y se vuelve a intentar. */
export function crearLecturaCola(d: DepsLecturaCola): () => Promise<void> {
  let promesa: Promise<void> | null = null;
  return () =>
    (promesa ??= d.leer().then(d.cargar, () => d.cargar(null)).catch((e) => {
      // La lectura que falló no deja la cola rota para siempre: se suelta la promesa y se anota.
      promesa = null;
      d.alFallar(e);
    }));
}
