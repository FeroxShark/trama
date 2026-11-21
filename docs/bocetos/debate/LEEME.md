# Bocetos del modo debate

Maquetas estáticas (HTML autocontenido con tokens copiados de `app/src/tokens.css` y fuentes de Trama + PNG a `1280×800` y `390×844`) sobre fondo oscuro liso, sin gradientes, sin vidrio ni brillos. Cada postura y estado usa palabra e ícono; el selector del chat sigue marcando qué modelo ejecuta al final.

## A · Entrada en la caja (base anterior)

- **A1, Fila encima de la caja** (`a1-fila.html`): propone prender «Debate» al lado del modo y desplegar las sillas, rondas y costo en una bandeja fija arriba de la caja; resigna espacio vertical del chat mientras armás el debate y hace más parecido el botón de enviar al de un mensaje común.
- **A2, Menú flotante** (`a2-flotante.html`): propone abrir un popover vidriado sobre el chip «Debate» con selector por silla, carril grueso de rondas y costo; resigna ver de un vistazo qué modelos van a debatir y cuánto va a costar una vez que cerrás el menú.
- **A3, Mesa integrada en la caja** (`a3-integrada.html`): propone transformar la parte superior de la propia caja en una mesa unificada (interruptor, sillas editables, rondas y costo siempre visibles) y cambiar el botón de enviar a «Debatir»; resigna un renglón de alto fijo mientras está prendido, pero evita tarjetas apiladas, no tapa el chat e impide mandar un mensaje común por error.

## B · Debate en vivo sin scrollear (base anterior)

- **B1, Columnas adaptativas** (`b1-columnas.html`): propone mantener 3 columnas lado a lado donde quien espera ocupa un renglón chico y quien escribe se expande; resigna ancho de lectura (columnas angostas) y vuelve a crecer hacia abajo cuando dos modelos hablan largo en la misma ronda.
- **B2, Línea de tiempo + fichas** (`b2-timeline.html`): propone resumir el estado de las 3 sillas arriba como fichas compactas y mostrar los turnos a lo ancho en una sola lista cronológica; resigna ver en paralelo lo dicho en turnos previos sin hacer crecer la lista al avanzar la ronda.
- **B3, Acordeón de sillas con escenario único** (`b3-acordeon.html`): propone un solo escenario ancho para quien está escribiendo ahora, los turnos ya dichos plegados en 1 renglón con postura y síntesis (desplegables al tocar) y quien espera en 1 línea; resigna leer dos respuestas largas abiertas a la vez a cambio de mantener un alto acotado que nunca tapa los botones de «Cancelar» ni «Cortar y concluir».

## C · Plan acordado (base anterior)

- **C, Tarjeta «Plan acordado»** (`c-plan-acordado.html`): propone el plan en el bloque principal, «Acuerdos» y «Desacuerdos» plegables en 1 renglón con su resumen, campo opcional para pedir «Otra ronda», «Descartar» y «Ejecutar con \<modelo>» (tomado del selector del chat) como acción principal; resigna ver los acuerdos desplegados de entrada para que todo entre sin scroll en escritorio y celular.

## D · Entrada híbrida (fila sutil + menú centrado apaisado)

Cada variante incluye tres estados (`-cerrado`, `-abierto` y `-un-proveedor`), con fórmula legible (`2 rondas × 3 modelos + el plan final = 7 respuestas`) y pista de cupo en palabras (`cupo poco / medio / mucho`).

- **D1, Rondas con control segmentado `1 · 2 · 3` — recomendada** (`d1-segmentado-cerrado.html`, `d1-segmentado-abierto.html`, `d1-segmentado-un-proveedor.html`): propone una fila sutil compacta arriba de la caja con sillas, rondas en 1 toque (`1 | 2 | 3`) y costo en palabras, y al editar abre el menú centrado apaisado sin tapar el último mensaje; resigna palabras descriptivas en el selector de rondas a cambio de lectura y cambio directo con menos ancho.
- **D2, Rondas con stepper `− 2 +` y total al lado** (`d2-stepper-cerrado.html`, `d2-stepper-abierto.html`, `d2-stepper-un-proveedor.html`): propone ajustar rondas con botones `−` y `+` pegados a la píldora del total (`7 respuestas`) para reforzar el impacto de cada vuelta; resigna elegir de 1 a 3 en un solo toque (pasa por 2 para ir de 1 a 3).
- **D3, Rondas como píldoras con ritmo y puntos** (`d3-ritmo-cerrado.html`, `d3-ritmo-abierto.html`, `d3-ritmo-un-proveedor.html`): propone elegir entre «Rápido», «Normal» y «A fondo» con 1, 2 o 3 puntos para traducir las rondas a intención; resigna ver el número exacto de rondas dentro del botón (queda en la fórmula al lado) y ocupa más ancho en la fila cerrada.

## E · Tarjeta «Plan acordado» con «Dar tu opinión»

- **E1, «Dar tu opinión» reemplaza a «Otra ronda» — recomendada** (`e1-plan-reemplaza.html`): propone una barra limpia con «Descartar», «Dar tu opinión» (abre el campo para sumar tu comentario en una ronda más) y «Ejecutar con \<modelo>» como acción principal; resigna un botón separado para repetir una ronda sin escribir nada a cambio de evitar dos acciones casi iguales.
- **E2, «Otra ronda» y «Dar tu opinión» juntas** (`e2-plan-juntas.html`): propone mantener «Otra ronda» en 1 toque junto a «Dar tu opinión» (abre el campo opcional); resigna simplicidad y espacio en la fila de acciones (sobre todo en angosto) para separar «repetir tal cual» de «opinar antes».

## F · Acordeón B3 en vivo con pregunta y comentario libre

- **F1, Pregunta en vivo arriba con debate en pausa** (`f1-pregunta-en-vivo.html`): propone pausar el debate con ícono y palabra («En pausa · espera tu respuesta») y ubicar la pregunta del modelo arriba de las sillas con botones de opción, «Elegí vos» y campo de texto libre; resigna mantener el escenario en vivo arriba mientras está pausado para asegurar que respondas sin scrollear.
- **F2, Campo siempre a mano «Decí algo al debate»** (`f2-opinar-en-vivo.html`): propone sumar una barra fija de entrada dentro de la tarjeta B3 («Decí algo al debate… · Entra en el próximo turno») arriba de «Cancelar» y «Cortar y concluir»; resigna ~40 px verticales de la tarjeta a cambio de poder intervenir en cualquier momento sin esperar al plan final.

## G · Ajustes del debate

- **G, Sección «Debate entre modelos» en Ajustes > Modelos** (`g-ajustes-debate.html`): propone configurar prendido/apagado, 2 o 3 sillas por defecto (modelo y esfuerzo), rondas por defecto y tope de respuestas, mostrando el estado de un solo proveedor conectado (`Claude conectado`, `Gemini sin conectar`, `ChatGPT sin conectar`) en chips calmos; resigna opciones avanzadas por proveedor individual para mantener la pantalla liviana en escritorio y celular.
