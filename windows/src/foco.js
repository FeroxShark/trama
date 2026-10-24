"use strict";
// Mientras haya una consola de login abierta (la de Claude o Gemini), Trama no se trae al frente:
// Windows le daría el foco a la ventana de Trama en medio de lo que la persona escribe en la consola.
// El aviso se apaga solo cuando la persona vuelve a Trama por su cuenta (la ventana recibe el foco)
// o pasado un tope, por si la consola se cerró sin que nadie lo notara.
function crearGuardiaFoco({ ahora = Date.now, topeMs = 10 * 60 * 1000 } = {}) {
  let hasta = 0;
  return {
    consolaAbierta() {
      hasta = ahora() + topeMs;
    },
    volvio() {
      hasta = 0;
    },
    puedeTraer() {
      return ahora() >= hasta;
    },
  };
}
module.exports = { crearGuardiaFoco };
