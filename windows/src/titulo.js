"use strict";
// La barra de título de Windows se quita: la página ocupa toda la ventana y los tres botones (minimizar, maximizar,
// cerrar) flotan arriba a la derecha, sobre la franja de arriba de la app (app/src/titulo.ts la marca y le deja lugar).
// El color de los símbolos es el texto del tema que está pintado: lo manda la página con `ventana:titulo`; hasta
// entonces vale el del tema oscuro. Sólo en Windows: en los demás sistemas la ventana queda como estaba.

// --texto-1 del tema oscuro (app/src/temas-colores.css) y 4 rem de la franja (.migas) a letra 13.
const COLOR_SIMBOLO_DEFECTO = "#f4f5f7";
const ALTO_FRANJA_DEFECTO = 64;
const HEX = /^#[0-9a-f]{6}$/i;

/** Lo que `setTitleBarOverlay` recibe: el fondo transparente (la página lo pinta) y los símbolos del tema pedido. */
function overlayDesde(simbolo, alto) {
  return {
    color: "#00000000",
    symbolColor: typeof simbolo === "string" && HEX.test(simbolo) ? simbolo : COLOR_SIMBOLO_DEFECTO,
    height: Number.isFinite(alto) && alto >= 24 && alto <= 160 ? Math.round(alto) : ALTO_FRANJA_DEFECTO,
  };
}

/** Las opciones del BrowserWindow para quitar la barra de título. Vacías fuera de Windows (`process.platform` se mira al llamar). */
function opcionesTitulo() {
  if (process.platform !== "win32") return {};
  return { titleBarStyle: "hidden", titleBarOverlay: overlayDesde(COLOR_SIMBOLO_DEFECTO, ALTO_FRANJA_DEFECTO) };
}

module.exports = { opcionesTitulo, overlayDesde, COLOR_SIMBOLO_DEFECTO, ALTO_FRANJA_DEFECTO };
