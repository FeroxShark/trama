// El estado propio de la app (`~/.local/state/hilos/`, o `HILOS_STATE` en las pruebas): no el de `pa`.
// Aparte de pa.ts para que lo use el log (electron/log.ts) sin un ciclo de imports.
import { estadoHilos } from "./rutas.ts";

export const ESTADO = estadoHilos();
