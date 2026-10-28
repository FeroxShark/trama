"use strict";
// La barra de título de Windows se quita: queda una franja de 32 px arriba, transparente, y los tres botones (minimizar,
// maximizar, cerrar) flotan sobre su extremo derecho. La franja muestra el fondo de la app: la página empieza debajo de
// ella (app/src/index.css la deja libre con `data-titulo-nativo`). El color de los símbolos es el texto del tema que está
// pintado: lo manda la página con `ventana:titulo`; hasta entonces vale el del tema oscuro. Sólo en Windows: en los
// demás sistemas la ventana queda como estaba.

// --texto-1 del tema oscuro (app/src/temas-colores.css). La franja mide lo mismo que la que deja la página arriba.
const COLOR_SIMBOLO_DEFECTO = "#f4f5f7";
const ALTO_FRANJA = 32;
const HEX = /^#[0-9a-f]{6}$/i;

/** Lo que `setTitleBarOverlay` recibe: el fondo transparente (la página lo pinta) y los símbolos del tema pedido. */
function overlayDesde(simbolo) {
  return {
    color: "#00000000",
    symbolColor: typeof simbolo === "string" && HEX.test(simbolo) ? simbolo : COLOR_SIMBOLO_DEFECTO,
    height: ALTO_FRANJA,
  };
}

/** Las opciones del BrowserWindow para quitar la barra de título. Vacías fuera de Windows (`process.platform` se mira al llamar). */
function opcionesTitulo() {
  if (process.platform !== "win32") return {};
  return { titleBarStyle: "hidden", titleBarOverlay: overlayDesde(COLOR_SIMBOLO_DEFECTO) };
}

module.exports = { opcionesTitulo, overlayDesde, COLOR_SIMBOLO_DEFECTO, ALTO_FRANJA };
