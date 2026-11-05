/**
 * ¿Se ve el panel de consumo (el de contexto, a la derecha, clases `cs-`)? Sólo con la conversación a la vista: con un panel del
 * pie abierto (Ajustes con sus conectores, Tablero, Ramas o Estadísticas) no ocupa lugar, a ningún ancho. Lo recordado
 * (`consumo`, preferencias.json) no se toca: al volver al chat queda abierto u oculto como estaba.
 */
export function consumoALaVista(consumo: boolean, panel: string | null): boolean {
  return consumo && !panel;
}
