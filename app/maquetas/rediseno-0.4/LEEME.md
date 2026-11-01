# Rediseño 0.4: cuatro direcciones para la pantalla principal

Maquetas estáticas (HTML autocontenido + PNG a 1600×1000), con datos inventados y el mismo contenido en las cuatro:
tarjeta de cupos, buscador, líderes con workers (corriendo, terminó, falló, pide decisión), hilo, aviso de un worker caído,
un worker en curso, composer con carpeta y modelo, y panel de contexto. En todas el estado va con palabra e ícono, nunca sólo color.

- **Vidrio quieto** (`vidrio-quieto.html`): el estándar de Ferox pulido (vidrio oscuro, celeste, cápsulas, Inter con cifras tabulares). Es lo mejor para seguir con la identidad que ya tiene Trama y el resto de su escritorio; sacrifica densidad y contraste fuerte entre estados.
- **Cabina** (`cabina.html`): tablero de instrumentos, plano y denso, con tabla de workers, tiempos, cupos en tramos y barra de totales arriba (IBM Plex). Es lo mejor para vigilar muchos workers de un vistazo; sacrifica calidez y aire, y el hilo queda más técnico.
- **Claro y amplio** (`claro-amplio.html`): tema claro editorial, tipografía grande (Source Sans 3), cifras de cupo como protagonistas y tarjetas de color suave por estado. Es lo mejor para leer la conversación con calma y para trabajar de día; sacrifica densidad (se ven menos workers a la vez) y se aleja del vidrio del resto del escritorio.
- **Bloques** (`bloques.html`): color pleno por estado, bordes gruesos y sombra dura (Geist). Es lo mejor para que un fallo o una decisión pendiente se vean desde lejos y para una identidad propia; sacrifica sobriedad y tranquilidad: es la más ruidosa y la menos "de sistema".

Las fuentes (todas ya incluidas en `app/src/fuentes`) van embebidas en cada HTML: se abren sin red y sin el resto del repo.
No tocan la app: son sólo para elegir dirección.
