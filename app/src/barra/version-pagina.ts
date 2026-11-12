// La versión de Trama que corre esta página, para el aviso de Trama nueva (AvisoClaude.tsx). Lo prueba tests/version-pagina.test.ts.
declare const __TRAMA_VERSION__: string | undefined;
/** La versión que corre esta página (la pone vite al compilar; en los tests no hay). */
const VERSION_PAGINA = typeof __TRAMA_VERSION__ === "string" ? __TRAMA_VERSION__ : null;
/**
 * ¿La ventana ya estrenó la que se instaló? Al volver el motor, la ventana se pone al día sola (ventana-cliente.ts: recarga la
 * página o relanza el proceso): si esta página ya es esa versión, pedir «Reiniciar la ventana» sería un segundo reinicio de más.
 */
export const yaEstrenada = (instalada: string, pagina: string | null = VERSION_PAGINA) => pagina !== null && pagina === instalada;
