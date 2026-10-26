// El nombre para mostrar de cada proyecto (`titulo` del registry, slug → título): así se ve la
// carpeta en la barra y en las migas. Lo comparten todos; `pa` lo entiende como alias del proyecto.
import { useTitulosProyectos } from "../datos/proyectos";

/** slug → nombre para mostrar. Sale del almacén de proyectos (src/datos/proyectos.ts): al renombrar uno en Ajustes la barra se entera sola. */
export const useTitulos = (): Readonly<Record<string, string>> => useTitulosProyectos();
