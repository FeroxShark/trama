// Tooltips de la barra: una sola capa en el body, delegada sobre `data-tip`.
// Sin estado de React: pasar el mouse por la lista no re-renderiza nada.

const DEMORA_MS = 350;
/** Cuánto hay que mantener apretado con el dedo, y cuánto queda a la vista después de soltar. */
const LARGO_MS = 500;
const QUEDA_MS = 2000;
/** Cuánto se puede correr el dedo sin que deje de ser "mantener apretado". */
const CORRE_PX = 10;

let tip: HTMLDivElement | null = null;
let timer = 0;
let actual: Element | null = null;

function nodo() {
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "tip";
    tip.setAttribute("role", "tooltip");
    document.body.append(tip);
  }
  return tip;
}

export function mostrarTip(el: Element) {
  const texto = el.getAttribute("data-tip");
  if (!texto) return;
  const t = nodo();
  t.textContent = texto;
  const r = el.getBoundingClientRect();
  const x = Math.max(4, Math.min(r.left + r.width / 2 - t.offsetWidth / 2, innerWidth - t.offsetWidth - 4));
  const arriba = r.top - t.offsetHeight - 6;
  t.style.setProperty("--x", `${Math.round(x)}px`);
  t.style.setProperty("--y", `${Math.round(arriba < 4 ? r.bottom + 6 : arriba)}px`);
  t.dataset.visible = "";
}

export function ocultarTip() {
  clearTimeout(timer);
  actual = null;
  if (tip) delete tip.dataset.visible;
}

let armado = false;

export function armarTips() {
  if (armado) return;
  armado = true;
  document.addEventListener("pointerover", (e) => {
    const el = (e.target as Element).closest?.("[data-tip]") ?? null;
    if (el === actual) return;
    ocultarTip();
    if (!el) return;
    actual = el;
    timer = window.setTimeout(() => mostrarTip(el), DEMORA_MS);
  });
  // Con teclado: el tooltip sale al llegar con Tab, sin demora.
  document.addEventListener("focusin", (e) => {
    const el = e.target as Element;
    if (el.matches?.("[data-tip]:focus-visible")) mostrarTip((actual = el));
  });
  document.addEventListener("focusout", ocultarTip);
  document.addEventListener("pointerdown", ocultarTip);
  document.addEventListener("scroll", ocultarTip, true);
  // Levantar el dedo también es "irse" de todo: ése no lo esconde (lo esconde su reloj).
  document.documentElement.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch") ocultarTip();
  });
  armarDedo();
}

// Con el dedo no hay hover ni clic derecho: las dos cosas salen al mantener apretado, y ese toque
// no cuenta como clic. Sobre algo con tooltip sale el tooltip; en cualquier otro lado, el menú de
// lo que haya debajo (el de la fila). Android avisa del toque largo con su propio `contextmenu`,
// otros navegadores no: si a los LARGO_MS no llegó, lo manda la app, y el que llegue después se descarta.
function armarDedo() {
  let dedo: Element | null = null;
  let blanco: Element | null = null;
  let x = 0;
  let y = 0;
  let largo = 0;
  let quita = 0;
  let hecho = false;
  let propio = false;
  let tragar = false;
  const alLargo = () => {
    clearTimeout(largo);
    if (hecho) return;
    hecho = true;
    if (dedo) {
      tragar = true;
      mostrarTip((actual = dedo));
    } else if (blanco?.isConnected && !blanco.closest("input, textarea, [contenteditable]")) {
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
      propio = true;
      blanco.dispatchEvent(ev);
      propio = false;
      tragar = ev.defaultPrevented;
    }
  };
  document.addEventListener("pointerdown", (e) => {
    clearTimeout(largo);
    clearTimeout(quita);
    tragar = hecho = false;
    dedo = blanco = null;
    if (e.pointerType !== "touch" || !e.isPrimary) return;
    blanco = e.target as Element;
    dedo = blanco.closest?.("[data-tip]") ?? null;
    x = e.clientX;
    y = e.clientY;
    largo = window.setTimeout(alLargo, LARGO_MS);
  });
  // El dedo que se corre está recorriendo la lista, no apretando.
  document.addEventListener("pointermove", (e) => {
    if (blanco && !hecho && Math.hypot(e.clientX - x, e.clientY - y) > CORRE_PX) clearTimeout(largo);
  });
  const soltar = () => {
    clearTimeout(largo);
    if (dedo && tragar) quita = window.setTimeout(ocultarTip, QUEDA_MS);
    dedo = blanco = null;
    // Si el navegador no manda clic después de un toque largo, que no se trague uno de más tarde.
    if (tragar) window.setTimeout(() => (tragar = false), 400);
  };
  document.addEventListener("pointerup", soltar);
  document.addEventListener("pointercancel", soltar);
  document.addEventListener(
    "contextmenu",
    (e) => {
      if (propio || !blanco) return;
      clearTimeout(largo);
      // El del navegador: con tooltip debajo se lo queda el tooltip; si la app ya abrió el menú, sobra.
      if (dedo || hecho) {
        e.preventDefault();
        e.stopPropagation();
        if (!hecho) alLargo();
        return;
      }
      hecho = true;
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      if (!tragar) return;
      tragar = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}
