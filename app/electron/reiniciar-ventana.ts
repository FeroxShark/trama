// "Reiniciar la ventana" tras instalar una Trama nueva: va por el mismo camino que un build nuevo (electron/reinicio.ts
// `armarRelanzo`): abre una corrida de reinicio (`empezar`), así el proceso que vuelve ve `enMarcha()` y su primera carga lleva
// `?actualizando=1` (la tarjeta de 4 pasos «Actualizando Trama…»), en vez de cerrar y abrir a secas.

export type DepsReiniciarVentana = {
  /** Es la app de todos los días (residente): sólo ella tiene un proceso que relanzar; el resto sólo recarga la página. */
  residente: boolean;
  /** Abre la corrida de reinicio (reinicio-marcas.ts `empezar`): sin ella el proceso nuevo no sabe que viene de un reinicio. */
  empezar(): void;
  marcar(paso: string): void;
  /** Anota cómo estaba la ventana (`anotarVolver` de main.ts). */
  anotar(): Promise<void>;
  /** Sale este proceso y vuelve otro con el build nuevo. */
  relanzar(): void;
  /** Sin proceso que relanzar (bench, captura, dev): vuelve a cargar la página. */
  recargar(): void;
};

export function reiniciarVentana(d: DepsReiniciarVentana): Promise<void> {
  if (!d.residente) {
    d.recargar();
    return Promise.resolve();
  }
  d.empezar();
  d.marcar("ventana-aviso");
  return d.anotar().then(() => {
    d.marcar("ventana-guardo");
    d.relanzar();
  });
}
