# Conectores como tienda (Ajustes > Conectores)

Estructura de la página «Customize» de claude.ai, con el look de Trama (tokens, cápsulas, acento celeste).

## Hecho
- Pestañas Skills | Conectores | Plugins | Hooks (con su número), «Tuyos | Descubrir», buscador, categoría, orden y «Agregar».
- Tarjetas en grilla de 2 columnas (1 en angosto): ícono, nombre, de quién es, qué hace (2 líneas), un dato (uso en 30 días o instalaciones) y «+» / ✓ / interruptor. Todo estado lleva ícono y palabra.
- Detalle al tocar la tarjeta: descripción, origen, qué trae, dónde vive, quitar/apagar. Instalar una skill o un conector MCP siempre pasa por la confirmación con la previa; un paquete MCP nunca se ejecuta.
- Descubrir de plugins: «Para vos» (sólo con base: algo instalado con categoría), «Nuevos», «Más instalados» y «Categorías» con conteo (cada una filtra), «Ver todo» en cada sección. Skills y MCP, planos (su fuente no trae categorías ni instalaciones); MCP suma «Nuevos».
- Lógica pura en `src/paneles/tienda-logica.ts` (14 tests), datos en `tienda-datos.ts`, vistas en `Tienda*.tsx` y `tienda.css`. Reemplaza `AjustesConectoresInventario`, `AjustesPlugins` y `AjustesDescubrir` (sin dos caminos).
- Prueba de pantalla: `node scripts/prueba-conectores.mjs` (fixtures, HOME temporal, nada se instala de verdad).
- Capturas a 1280 y 360 en `docs/estado/conectores-tienda/`.

## Falta
- Skills y MCP no traen categorías, instalaciones ni fechas: ahí no hay «Más instalados» ni «Categorías» (dice «sin dato»).
- No hay forma de borrar una skill desde la interfaz; los hooks no se instalan (sin «Agregar»).
- Textos de la guía (`src/guia/textos.ts`) no se revisaron para la estructura nueva (las anclas siguen).
- `conectores-vista.ts` y `descubrir-vista.ts` conservan exportaciones que ya no usa la interfaz (las usan sus tests).
- `prueba-ajustes.mjs` usa `.pie button[0]` para abrir Ajustes y hoy ese es «Ramas» (no se tocó).
