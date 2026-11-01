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

