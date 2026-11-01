# Rediseño 0.4: cuatro direcciones para la pantalla principal

Maquetas estáticas (HTML autocontenido + PNG a 1600×1000), con datos inventados y el mismo contenido en las cuatro:
tarjeta de cupos, buscador, líderes con workers (corriendo, terminó, falló, pide decisión), hilo, aviso de un worker caído,
un worker en curso, composer con carpeta y modelo, y panel de contexto. En todas el estado va con palabra e ícono, nunca sólo color.

- **Vidrio quieto** (`vidrio-quieto.html`): el estándar de Ferox pulido (vidrio oscuro, celeste, cápsulas, Inter con cifras tabulares). Es lo mejor para seguir con la identidad que ya tiene Trama y el resto de su escritorio; sacrifica densidad y contraste fuerte entre estados.
- **Vidrio quieto v2** (`vidrio-quieto-v2.html`): la dirección elegida, con dos cambios. Los cupos pasan a tarjetas con la cifra grande (Claude 5 h y semana arriba, Gemini, Claude/GPT y Argon en chicas, OpenCode en una cápsula; lo que no tiene cupo, tintado de rojo suave con "sin cupo · vuelve 18:40"). Y lo que pide atención se entiende de un vistazo: "falló" en coral y "pide decisión" en ámbar, con tinte fuerte, borde luminoso, ícono en recuadro, botón principal relleno y sombra que despega la tarjeta; en la barra, esas filas llevan halo y píldora con la palabra y las demás (corriendo, terminó) quedan calmas y apagadas.
- **Cabina** (`cabina.html`): tablero de instrumentos, plano y denso, con tabla de workers, tiempos, cupos en tramos y barra de totales arriba (IBM Plex). Es lo mejor para vigilar muchos workers de un vistazo; sacrifica calidez y aire, y el hilo queda más técnico.
- **Claro y amplio** (`claro-amplio.html`): tema claro editorial, tipografía grande (Source Sans 3), cifras de cupo como protagonistas y tarjetas de color suave por estado. Es lo mejor para leer la conversación con calma y para trabajar de día; sacrifica densidad (se ven menos workers a la vez) y se aleja del vidrio del resto del escritorio.
- **Bloques** (`bloques.html`): color pleno por estado, bordes gruesos y sombra dura (Geist). Es lo mejor para que un fallo o una decisión pendiente se vean desde lejos y para una identidad propia; sacrifica sobriedad y tranquilidad: es la más ruidosa y la menos "de sistema".

Las fuentes (todas ya incluidas en `app/src/fuentes`) van embebidas en cada HTML: se abren sin red y sin el resto del repo.
No tocan la app: son sólo para elegir dirección.

## Cupos con varias cuentas de Claude

`cupos-varias-cuentas.html` + `.png` (1800×1000: tres bandas de 600×1000, sólo la barra izquierda y una nota al costado). Mismo dato en las tres: Personal en uso (5 h 23 %, semana 92 %) y Trabajo (5 % y 40 %). La cuenta en uso lleva «En uso» con tilde, no sólo color. Con la activa por agotarse y otra con cupo, un aviso calmo sugiere cambiar con «Usar Trabajo»: la cuenta la elige la persona, Trama no rota sola.

- **A, la activa en grande** (`cupos-varias-cuentas.html`, banda izquierda): la tarjeta de hoy con el nombre de la cuenta y «En uso»; las otras cuentas en una fila compacta (nombre, dos mini barras 5 h y semana, «Usar»). Lo más parecido a hoy; crece una fila por cuenta.
- **B, selector en cápsulas** (banda del medio): dos cápsulas arriba de las tarjetas grandes (la que se mira, la que está «en uso» y un resumen de la otra). Altura casi fija; mirar una cuenta y usarla son dos cosas que hay que distinguir.
- **C, tarjetas medianas apiladas** (banda derecha): una tarjeta por cuenta con sus dos cifras, «En uso» o «Usar», y el aviso entre ellas. Es lo que mejor compara, y lo más alto.

## Cupos con varias cuentas, estilo vidrio quieto v2 (números grandes)

Tres ideas más para Ajustes > Plan y cupos, con la ventana de Ajustes a su ancho real (62 rem = 992 px, 1040×N con margen; barra de categorías de 13 rem y contenido de 704 px). Mismo dato en las tres, inventado: tres cuentas Claude Max, Personal (en uso, semana 92 %), Trabajo (5 % y 40 %) y Estudio (5 h al 100 %). Regla del dueño: dentro de una cuenta el límite de 5 h y el semanal van juntos en el mismo bloque; sólo se separa entre cuentas. Todas las cuentas miden lo mismo; la activa lleva borde celeste y «En uso» con tilde, las otras el botón «Usar». Lo que pide atención se tiñe como en v2 (ámbar con «queda poco», coral con «sin cupo»), siempre con palabra e ícono. Trama no cambia de cuenta sola: lo dice una nota al pie.

- **1. Tarjetas** (`cupos-cuentas-tarjetas.html`): una tarjeta por cuenta apiladas; adentro, 5 h y semana lado a lado con número de 44 px, barra y «vuelve a las …». La que más se lee y compara; la más alta (~560 px de cuentas con tres).
- **2. Filas** (`cupos-cuentas-filas.html`): una fila por cuenta con columnas «5 horas» y «Semana» (número, barra, «vuelve»); la más compacta (~100 px por cuenta, sirve para 3 o más cuentas). Los números son medianos (28 px) y la alerta es un recuadro en la celda.
- **3. Lo que frena** (`cupos-cuentas-lo-que-frena.html`): por cuenta, el límite que se acaba primero en número de 64 px con su nombre («El límite de la semana»), y el otro chico debajo en una línea. Responde «¿puedo seguir con esta cuenta?» sin leer dos cifras; esconde un poco el límite que no frena.

## Barra lateral densa (historial de hilos)

Dos direcciones para las quejas del dueño: demasiado aire, poca información, scroll todo el tiempo y cupos que ocupan media barra. Hoy, en una ventana de 1600×1000 a escala 1, entran 6 hilos a la vista y los cupos con el buscador se llevan unos 300 px antes de la lista. Las dos siguen vidrio quieto v2 (Inter con cifras tabulares, celeste, coral «falló» y ámbar «decidir» con palabra e ícono) y miden 320 px, el ancho de hoy.

Cada PNG (1800×1000) muestra la ventana a la izquierda y, a la derecha, la misma barra buscando «pago» y con los cupos abiertos. El HTML anda: se puede escribir en el buscador, filtrar, abrir los cupos, y plegar workers o proyectos. Son 38 hilos inventados, y los conteos salen de los mismos datos que las filas.

- **A, Bandeja** (`barra-densa-a.html`): una sola lista por tiempo, con dos líneas por hilo (38 px): título y hace cuánto; proyecto con su color, cuántos workers y una marca por cada worker vivo. «Te esperan» queda fija arriba y trae el worker que falló o pide algo aunque su líder esté más abajo. Buscador y Nuevo líder comparten la primera fila; abajo van los filtros Todo, En curso, Listos y Proyecto. Los cupos son dos cifras con barrita en la fila de los íconos del pie (no suman altura) y al tocarlas sube una hoja con el detalle. Entran 19 hilos. Es lo mejor para contestar «¿qué pasó último y qué me espera?»; sacrifica cantidad de filas, y el proyecto se lee hilo por hilo.
- **B, Riel** (`barra-densa-b.html`): agrupada por proyecto, con una línea por hilo (28 px) y encabezados fijos al scrollear. Un riel de 44 px a la izquierda lleva un monograma por proyecto, con ×, ? o punto según lo que pasa adentro: salta o filtra sin scrollear y, al buscar, se apagan los proyectos sin resultados. Los cupos son dos anillos con la cifra en el riel, y la navegación también va ahí: la lista gana todo el alto. Entran 26 hilos. Es lo mejor para quien piensa por proyecto y lo más denso; sacrifica ancho de título (se cortan los largos con píldora) y hay que aprender los monogramas, aunque tienen nombre al pasar el mouse.
  Elegida e implementada en `app/src/barra/` (riel en `Riel.tsx` y `riel-estilos.css`, cupos en `CuposRiel.tsx`). Capturas de la app con datos de ejemplo: `implementado-normal.png`, `implementado-buscando.png`, `implementado-cupos.png` e `implementado-claro.png`.

En las dos, el orden Recientes/A-Z y el cambio entre líderes y árbol de hoy pasarían a un solo control (el menú Proyecto en A, Recientes en B); en la maqueta ese menú todavía no ordena. Las alturas están en píxeles a la letra de 13: en la app irían en `rem`, para que crezcan con la letra elegida. Filas de 28 px quedan debajo de los 32 px de zona de click del estándar, igual que sus filas de menú; a cambio, son las que permiten ver más hilos.


## Cupos en filas: dos direcciones nuevas

Parten de la idea «filas» y se muestran en contexto: la app entera a 1440×900 con los anchos reales (barra de 320 px, contenido de Ajustes de 688 px), y abajo la línea de la barra en sus cuatro estados, a tamaño real. La barra es la de hoy; sólo cambia la línea de cupos. Mismo dato inventado en las dos: Personal en uso (5 h 23 %, semana 92 %), Trabajo (5 % y 40 %) y Estudio (5 h 100 %, semana 58 %). En las dos, 5 h y semana son una sola pieza y sólo se separan las cuentas; todas las filas miden lo mismo; la activa lleva «En uso» con tilde y las otras «Usar»; poco cupo empieza en 70 %, como en la app, y nada avisa sólo con color.

- **A, dos vasos** (`cupos-filas-a.html`): cada límite es un vaso que se llena de luz y los dos van pegados en una sola cápsula. Filas de 80 px con cifras de 26 px. Lo casi agotado se ve solo: el vaso casi lleno se vuelve ámbar y el lleno, coral, con el aviso en palabras adentro. En la barra, la misma cápsula en chico. La que mejor avisa de lejos y la más parecida a las cifras grandes de v2; ocupa más alto.
- **B, tejido** (`cupos-filas-b.html`): una sola tarjeta con las cuentas en renglones de 68 px, dos carriles de hilos alineados por cuenta (cada hilo prendido es uso, y sale de la «trama» del nombre y del logo) y un estado en palabras bajo el nombre («Queda poco: semana»). Cifras de 16 px. La más compacta, la que mejor compara entre cuentas y la que más aguanta si hay cinco o seis; las cifras son chicas y hay que acercarse más para leerlas.

La línea de la barra reemplaza a las tarjetas de cupos: muestra la cuenta en uso del motor del líder abierto y un toque abre Plan y cupos. Si esa cuenta se queda sin cupo y otra tiene lugar, ofrece «Usar Trabajo»: Trama sigue sin cambiar de cuenta sola.
