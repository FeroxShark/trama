// Copiar un texto al portapapeles. `navigator.clipboard` sólo existe en un contexto seguro: en la
// ventana anda, pero por la tailnet la página llega por http pelado (docs/remoto.md) y no está.
// Ahí queda el camino viejo: un campo fuera de la vista, seleccionado, y `execCommand("copy")`.
import { t, type ClaveSola } from "./i18n";

/** `true` si se copió. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Sin permiso o sin foco: se prueba el otro camino.
  }
  const campo = document.createElement("textarea");
  campo.value = texto;
  // Sólo lectura: en un teléfono no abre el teclado. Fuera de la vista y sin mover el scroll.
  campo.readOnly = true;
  campo.setAttribute("aria-hidden", "true");
  campo.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const antes = document.activeElement as HTMLElement | null;
  document.body.appendChild(campo);
  try {
    campo.focus({ preventScroll: true });
    campo.setSelectionRange(0, texto.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    campo.remove();
    antes?.focus?.({ preventScroll: true });
  }
}

// La confirmación: un cartelito abajo, "Copiado" o "No se pudo copiar", que se va solo. Un solo
// elemento y un solo timeout (nada queda corriendo); sólo `opacity`. Es de acá y no de cada botón
// porque algunos copian desde un menú que se cierra al elegir y no queda dónde mostrar nada.
const AVISO_MS = 1400;
let aviso: HTMLElement | null = null;
let reloj = 0;

/** Dice, un momento, que se copió o que no se pudo. */
export function avisarCopia(ok: boolean, claveOk: ClaveSola = "codigo.copiado"): void {
  if (typeof document === "undefined") return;
  if (!aviso || !aviso.isConnected) {
    aviso = document.createElement("div");
    aviso.className = "copia-aviso";
    aviso.setAttribute("role", "status");
    document.body.appendChild(aviso);
  }
  aviso.textContent = t(ok ? claveOk : "codigo.noCopio");
  aviso.dataset.ok = ok ? "" : "no";
  // Reflow para que un aviso nuevo, pegado a otro, vuelva a entrar.
  aviso.removeAttribute("data-visto");
  void aviso.offsetWidth;
  aviso.setAttribute("data-visto", "");
  clearTimeout(reloj);
  reloj = window.setTimeout(() => aviso?.removeAttribute("data-visto"), AVISO_MS);
}

/** Copia y lo dice. Lo que se copia sale siempre por acá. `true` si se copió. */
export async function copiarConAviso(texto: string): Promise<boolean> {
  const ok = await copiar(texto);
  avisarCopia(ok);
  return ok;
}

/** Decodifica una imagen en base64 a un Blob PNG (si ya es PNG, usa sus bytes; si no, la dibuja en un canvas). */
export async function imagenAPngBlob(v: { mime: string; datos: string }, el?: HTMLImageElement | null): Promise<Blob> {
  const mime = v.mime.split(";")[0].trim().toLowerCase();
  if (mime === "image/png") {
    const bin = atob(v.datos);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "image/png" });
  }
  const img =
    el && el.complete && el.naturalWidth > 0
      ? el
      : await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error("no se pudo cargar la imagen"));
          i.src = `data:${v.mime};base64,${v.datos}`;
        });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin contexto 2d");
  ctx.drawImage(img, 0, 0);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("sin png"))), "image/png");
  });
}

/** Copia una imagen al portapapeles como `image/png` y muestra el aviso «Copiada». */
export async function copiarImagen(v: { mime: string; datos: string }, el?: HTMLImageElement | null): Promise<boolean> {
  let ok = false;
  try {
    const seguro = typeof window === "undefined" || window.isSecureContext !== false;
    if (typeof navigator !== "undefined" && navigator.clipboard?.write && typeof ClipboardItem !== "undefined" && seguro) {
      const blob = await imagenAPngBlob(v, el);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      ok = true;
    }
  } catch {
    ok = false;
  }
  avisarCopia(ok, "visor.copiada");
  return ok;
}
