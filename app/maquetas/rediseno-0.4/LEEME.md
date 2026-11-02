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

## Riel pulido (ya implementado)

Capturas de la barra de verdad, con datos inventados (`pantalla abrir riel-pulido`): siete líderes y 37 ramas terminadas sueltas. Vuelven las coronas y los workers colgando de su líder, y se va el filtro de «sólo líderes». La idea: cada proyecto es un hilo de su color, que sale de la pestaña del riel, tiñe el encabezado y baja por sus workers.

- `riel-pulido-oscuro.png`: sin nada corriendo; lo que falla o pregunta es lo único que resalta.
- `riel-pulido-claro.png` y `riel-pulido-trabajando.png`: con trabajo en curso. Lo que corre enciende su tramo del hilo y una lanzadera lo recorre, y el encabezado dice «N en marcha».

## Riel con sus convenciones

Capturas de la barra de verdad (`pantalla abrir riel-pulido`), después de recuperar lo que el Riel había perdido. La lista completa, en `app/src/barra/CONVENCIONES.md`.

- `riel-convenciones-oscuro.png` y `riel-convenciones-claro.png`: con trabajo en curso. El rayito con su tiempo a la vista, «hace N» en la columna del tiempo, el punto que late en lo que corre, las coronas, y sin palomita en «N terminados».
- `riel-convenciones-calma-oscuro.png` y `riel-convenciones-calma-claro.png`: sin nada corriendo, con los terminados de un líder desplegados: ahí sí va la palomita, en cada worker que terminó.

## Tarjeta de un líder trabajando: dos propuestas

Pintadas adentro de la app de verdad (`pantalla`, con sus tokens, Inter y JetBrains Mono, su conversación y su caja); las tarjetas se inyectan desde `status-trabajando-fuente.js`, con datos inventados. La tarjeta de hoy mide 233 px de alto. Las dos cumplen los 8 puntos aprobados con el mismo texto y cambian en cómo se ven. PNG por propuesta (`a` o `b`): `trabajando`, `varias`, `sin-novedades`, `termino`, `fallo` (oscuro), `claro`, `en`, `detalle` («Corriendo Bash» sin descripción, comando crudo abierto y tooltip de tokens y pasos) y `resumen` (los cinco estados, oscuro y claro, lado a lado): `status-trabajando-<a|b>-<estado>.png`.

- **A, Tejido** (78 px; plegada, 28 px): una hoja plana sin borde y un tejido de dos hileras de puntadas en el borde de abajo. Cada paso del turno es un tramo con el color de paso de la app y largo según lo que duró, y al pasar el mouse dice qué fue («Leyó Actividad.tsx · 1 s»); las herramientas seguidas no suman altura. Una lanzadera celeste corre por el tramo actual. Sin novedades, se frena y las puntadas se aflojan en ámbar. Al fallar, el hilo queda cortado en coral. Plegada queda la muestra del tejido al lado de la frase. Es la más callada y la que más cuenta del turno; el tejido se lee mejor de cerca que de lejos.
- **B, Frase** (72 px; plegada, 32 px): una cápsula de vidrio hermana de la caja, con un círculo por tipo de herramienta y la frase a 16 px. Lo recién hecho queda en gris a la izquierda de la frase y se va fundiendo («Leyó Actividad.tsx › Editó riel-estilos.css › **Probando la barra**»). Sin novedades y falló tiñen toda la cápsula, con borde de luz y el ícono cambiado (pausa, ×), como lo que pide atención en la barra. Plegada queda un chip con tilde. Es la que más se ve y la que más se lee en palabras; ocupa más ancho con lo de antes y pesa más en la conversación.

Movimiento, que el PNG no muestra: el punto late mientras corre y se queda quieto en «Sin novedades»; en A corre la lanzadera y en B el círculo usa la escena de cada tipo. La salida se corta con un fundido, no con «…». Con «Corriendo Bash» de título no se repite «Corriendo» en la actividad.

## Vista de un worker: dos propuestas

Pintadas con el CSS compilado de la app (sus tokens, Inter y JetBrains Mono) y con la barra y el encabezado copiados de la app corriendo con `pantalla`; el centro sale de `worker-vista-fuente/`, con datos inventados. Una sola corrida en segundos reales (`datos.js`), así la tira, la lista y los totales cuadran entre sí. Las dos cumplen los 7 puntos aprobados con el mismo texto y cambian en cómo se ven. PNG por propuesta (`a` o `b`): `trabajando`, `trabado` (un comando de 12 m 40 s callado hace 11 m 52 s), `termino`, `fallo` (oscuro), `solo-cambios` (filtro prendido, con el diff en el panel), `claro` (trabado) y `en` (terminó, con el grupo abierto y el grep): `worker-vista-<a|b>-<estado>.png`.

- **A, Cinta**: la tira es la protagonista. Va adentro de la caja de estado, gruesa (36 px), con íconos y rótulos en los tramos largos y los totales por tipo en la leyenda; la franja trabada dice ahí mismo «Se trabó acá: sin salida hace 11 m 52 s». Abajo, una sola tarjeta con la lista y el detalle lado a lado. Ediciones, commits y errores son filas teñidas; «Sólo cambios» es un control de dos segmentos; lo que pensó es una marca chica con el cerebro y sus segundos en el paso siguiente; el grep va plano, con cada `ruta:línea` como enlace. Es la que mejor deja ver el tiempo de un vistazo; pesa más arriba.
- **B, Hilo**: lo que manda es la lista. Plano abierto a la izquierda, sin tarjeta, con un reloj grande del paso, una tira finita (10 px) y la lista como un hilo vertical del color de cada tipo: puntos chicos para leer y correr, nodos llenos para ediciones, commits y errores, y lo pensado como un nudo sobre el hilo. Cada fila lleva abajo una hebra a la misma altura y del mismo largo que su tramo en la tira, así la lista se lee también como cascada. A la derecha, el panel de salida ocupa toda la altura, como una terminal, con el grep agrupado por archivo. «Sólo cambios» es un interruptor. Es la que deja leer la historia de corrido; la tira dice menos por sí sola.

Regenerar, desde `app/` y con el build de la interfaz hecho (`npx vite build`): `node_modules/electron/dist/electron --user-data-dir=/tmp/wv maquetas/rediseno-0.4/worker-vista-fuente/generar.cjs [filtro]`. Sale a 2160×1350 (1440×900 con zoom 1,5). Los tooltips son el estado de pasar el mouse sobre un tramo; el movimiento (el tramo vivo que late, el spinner) no se ve en el PNG.
## Mensajes en cola

Dos propuestas para la cola de un líder, con los seis puntos aprobados: bandeja pegada sobre la caja (el mensaje recién pasa al chat cuando entra); Editar, Borrar y «Enviar ahora» con confirmación; orden `1`, `2`, `3`, arrastrable, y plegada a «3 en cola»; el estado en palabras, con «Esperando un comando largo · 3 m» y Parar pasados 2 min; nada se pierde (rojo con «Reintentar» y «Sigue guardado»); miniatura chica con clic para ampliar y el texto primero. La barra de la izquierda es una captura de la app, y el encabezado, la tarjeta de trabajo y la caja son su HTML real: lo nuevo es sólo la bandeja. La tarjeta es la de hoy: las dos propuestas sirven con la que salga de `status-trabajando-*`, y comparten con ella las puntadas, el ámbar que se afloja y el hilo cortado en coral.

Lo encolado sale todo junto (`juntar`, ver `AGENTS.md`): por eso con varios el estado dice «entran juntos» y «Enviar ahora» corta el paso y manda todos, en orden, no sólo ese. Un fallo frena la cola entera (`libre` no sigue con un error): los demás dicen «Espera al 1». Los motores sin entrega a mitad de turno dirían «entra al terminar el turno» en vez de «tras este paso».

Estados de cada una, en oscuro: `uno`, `tres`, `colapsada`, `comando-largo`, `fallo`, `confirmar`, más dos que muestran los puntos 4 y 7: `arrastrando` y `miniatura`. `claro` es `tres` en el tema claro e `ingles` es `confirmar` en inglés. Se rehacen con `cola-mensajes-recursos/render.cjs` (instrucciones en su encabezado).

- **A, Solapa** (`cola-mensajes-a-*.png`): una carpeta de la que asoma la caja. La pestaña dice el estado y su color tiñe toda la hoja (celeste, ámbar, coral). Filas de una o dos líneas con las acciones al costado y la confirmación abierta ahí mismo, debajo del mensaje. Es la más compacta y la que menos cambia la caja; entran más mensajes antes de plegar, y se parece más a una lista que a una conversación.
- **B, Hilván** (`cola-mensajes-b-*.png`): cada mensaje es una burbuja como la que va a quedar en el chat, hilvanada con un nudo numerado a un hilo punteado que sale del botón de enviar y sube hasta la tarjeta del paso en curso. Sin novedades las puntadas se aflojan en ámbar; un fallo corta el hilo y lo de abajo queda gris; confirmar marca con una tijera dónde se corta y el comando dice «Se corta». Plegada es un mazo de burbujas. Es la que más cuenta qué va a pasar y la que tiene más identidad; ocupa más alto por mensaje y se pliega antes.
