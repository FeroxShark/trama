// El último esfuerzo elegido por modelo (`preferencias.json`): lo usa la caja
// de los líderes (src/hilo/Lider.tsx). Se lee una vez por arranque y se
// mantiene al día acá.
import { fuente } from "../datos/fuente";

let efforts: Record<string, string> | null = null;
let leyendo: Promise<Record<string, string>> | null = null;

export const effortsLeidos = () => efforts;
export const leerEfforts = () =>
  (leyendo ??= fuente.effortsPorModelo().then(
    (e) => (efforts = { ...e, ...efforts }),
    () => (efforts = { ...efforts }),
  ));

export function recordarEffort(modelo: string, e: string) {
  efforts = { ...efforts, [modelo]: e };
  fuente.guardarEffort(modelo, e);
}
