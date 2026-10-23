// Cuenta los requestAnimationFrame que pide la página, sólo en los guiones de
// medición: en reposo tiene que dar cero (nada animando por atrás). Se importa
// primero en main.tsx porque Motion se guarda el rAF al cargarse.
import { MODO } from "./modo";

export const pedidos = { raf: 0 };

if (MODO.guion) {
  const original = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    pedidos.raf++;
    return original(cb);
  };
}
