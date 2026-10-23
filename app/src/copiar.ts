// Copiar un texto al portapapeles. `navigator.clipboard` sólo existe en un contexto seguro: en la
// ventana anda, pero por la tailnet la página llega por http pelado (docs/remoto.md) y no está.
// Ahí queda el camino viejo: un campo fuera de la vista, seleccionado, y `execCommand("copy")`.
import { t } from "./i18n";

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
export function avisarCopia(ok: boolean): void {
  if (typeof document === "undefined") return;
  if (!aviso || !aviso.isConnected) {
    aviso = document.createElement("div");
    aviso.className = "copia-aviso";
    aviso.setAttribute("role", "status");
    document.body.appendChild(aviso);
  }
  aviso.textContent = t(ok ? "codigo.copiado" : "codigo.noCopio");
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
