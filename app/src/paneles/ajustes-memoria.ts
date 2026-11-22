// Ajustes > Modelos > «Memoria compartida»: la parte que no es pantalla. Lo que se edita es `memoria_compartida` de modelos.json sobre el borrador
// de Ajustes > Modelos: sólo los motores apagados se anotan (prendido es lo de fábrica), así el archivo queda corto. Lo prueba tests/ajustes-memoria.test.ts.
import { MOTORES_MEMORIA, type MotorMemoria } from "../../electron/modelos-tipos";
import type { Borrador } from "./modelos-borrador";

export { MOTORES_MEMORIA, type MotorMemoria };

/** ¿Recibe este motor la memoria y la ficha del tablero según el borrador? Sin anotar, sí. */
export const memoriaDe = (b: Borrador, motor: MotorMemoria): boolean => b.memoriaCompartida[motor] !== false;

/** El borrador con ese motor prendido o apagado; prendido sale del archivo. */
export function ponerMemoria(b: Borrador, motor: MotorMemoria, activo: boolean): Borrador {
  const m = { ...b.memoriaCompartida };
  if (activo) delete m[motor];
  else m[motor] = false;
  return { ...b, memoriaCompartida: m };
}
