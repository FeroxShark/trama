// La barra de título de Windows (la carcasa, windows/: la ventana de Trama en el .exe) se quita y los tres botones
// nativos flotan arriba a la derecha sobre la página. Acá: le pasamos a la carcasa el color de los símbolos (el texto
// del tema pintado, --texto-1) y el alto de la franja (4 rem, como `.migas`), y marcamos <html data-titulo-nativo>
// para que la franja arrastre la ventana y deje lugar a los botones (index.css). Fuera de la carcasa (Linux, el
// celular, el navegador) no hay carcasa.tituloTema y no pasa nada.

type TituloNativo = { tituloTema(t: { simbolo: string; alto: number }): Promise<unknown> };

function nativo(): TituloNativo | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { carcasa?: Partial<TituloNativo> }).carcasa;
  return c && typeof c.tituloTema === "function" ? (c as TituloNativo) : null;
}

/** Los símbolos y el alto de la franja con el tema que está pintado ahora. Lo llaman al cambiar tema o letra (src/tipografia.ts). */
export function sincronizarTitulo(): void {
  const c = nativo();
  if (!c || typeof document === "undefined") return;
  const raiz = document.documentElement;
  raiz.setAttribute("data-titulo-nativo", "");
  const estilo = getComputedStyle(raiz);
  // 4 rem: lo mismo que la altura de `.migas` (index.css), en px a la letra actual.
  const alto = Math.round(parseFloat(estilo.fontSize) * 4);
  c.tituloTema({ simbolo: estilo.getPropertyValue("--texto-1").trim(), alto }).catch(() => {});
}
