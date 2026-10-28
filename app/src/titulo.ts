// La barra de título de Windows (la carcasa, windows/: la ventana de Trama en el .exe) se quita: los tres botones
// nativos flotan arriba a la derecha, transparentes, sobre una franja de 32 px que muestra el fondo de la app. Acá: le
// pasamos a la carcasa el color de los símbolos (el texto del tema pintado, --texto-1) y marcamos <html
// data-titulo-nativo> para que index.css baje la app 32 px y arme la franja que arrastra la ventana. Sólo en Windows:
// la carcasa dice su plataforma. Fuera de ahí (Linux, el celular, el navegador) no hay nada y no pasa nada.

type TituloNativo = { plataforma?: string; tituloTema(t: { simbolo: string }): Promise<unknown> };

function nativo(): TituloNativo | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { carcasa?: Partial<TituloNativo> }).carcasa;
  return c && c.plataforma === "win32" && typeof c.tituloTema === "function" ? (c as TituloNativo) : null;
}

/** Los símbolos con el tema que está pintado ahora. Lo llaman al cambiar tema (src/tipografia.ts). */
export function sincronizarTitulo(): void {
  const c = nativo();
  if (!c || typeof document === "undefined") return;
  const raiz = document.documentElement;
  raiz.setAttribute("data-titulo-nativo", "");
  c.tituloTema({ simbolo: getComputedStyle(raiz).getPropertyValue("--texto-1").trim() }).catch(() => {});
}
