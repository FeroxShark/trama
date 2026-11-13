# Maqueta «E · Taller»

La maqueta del rediseño de la interfaz, aprobada por el dueño el 2026-11-13. Es la referencia de los pedazos que lo implementan; se borra cuando el rediseño esté entero en la app.

- `e-taller.html`: la maqueta, se abre en el navegador. Acepta estados por hash: `#tema=<id>`, `#cupos=anillos`, `#acomodo=chats:der,contexto:izq,cupo:abajo`, `#abierto=cupo`.
- `fuente/dir-e.mjs`: el generador (tokens, temas, marcado, CSS y el JS de los paneles acoplables). `fuente/base.mjs`: el sprite de íconos.
- `pruebas/drag.mjs` y `pruebas/temas.mjs`: las pruebas con puntero real que pasó la maqueta (acomodo esperado después de cada gesto).
- `img/`: capturas a 1920×1080 y recortes.

Qué se conserva de la app de hoy: cada señal de `app/src/barra/CONVENCIONES.md`, el panel de contexto completo y los cupos siempre a la vista. La maqueta cambia la piel y agrega los paneles que se arrastran; donde la maqueta no dibuja una señal de la barra, vale la barra.

De los cupos, el dueño eligió la ejecución «Anillos».
