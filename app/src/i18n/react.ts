// El idioma como estado de React: el componente que lo usa se vuelve a pintar
// cuando cambia (los `memo` también, que el re-render del padre no los alcanza).
import { useSyncExternalStore } from "react";
import { alCambiarIdioma, idioma } from "./index";

export const useIdioma = () => useSyncExternalStore(alCambiarIdioma, idioma);
