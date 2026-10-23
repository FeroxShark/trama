// El estado propio de la app (`~/.local/state/hilos/`, o `HILOS_STATE` en las pruebas): no el de `pa`.
// Aparte de pa.ts para que lo use el log (electron/log.ts) sin un ciclo de imports.
import os from "node:os";
import path from "node:path";

export const ESTADO = process.env.HILOS_STATE ?? path.join(os.homedir(), ".local", "state", "hilos");
