# Convenciones de la barra lateral

Cada señal de la barra con qué dice y por qué existe. Se fueron aprendiendo con el dueño, una por una, y no se las quiere repetir.
Regla: **antes de rediseñar la barra, leer esto y conservar cada señal, o justificar el cambio en el RESULTADO** (y corregir acá).
`tests/barra-convenciones.test.ts` controla las claves sobre el render.

Tres principios mandan sobre todos los demás:

1. **Cada ícono dice algo o no está.** Si hay que explicarlo, sobra. Lo que parece otra cosa (un triángulo que parece una flecha de desplegar) también sobra.
2. **Nada depende sólo del color.** Todo estado lleva ícono o palabra; lo que pide atención lleva las dos. El verde de la casa es turquesa (`--ok`), porque contra el rojo se confunde con deuteranomalía.
3. **Sólo llama lo que necesita algo de vos.** Lo que corre o terminó queda calmo; lo que falló o pregunta es lo único que resalta.

Estado de cada señal en la barra actual («Riel», desde `0c98b24`): **igual**, **recuperada** (el Riel la había perdido y volvió) o **cambió** (con el porqué).

## El líder

| Señal | Qué dice | Por qué existe | Estado |
| --- | --- | --- | --- |
| **Corona** | Esta fila es un líder: una conversación con la que hablás, arriba de sus workers. | Es lo primero que se busca con la vista. Se probó sacarla (`0c98b24`) y volvió (`a48526d`). | igual |
| Corona dorada con fulgor que respira | Está respondiendo o tiene subagentes corriendo. | Ver de lejos qué está vivo. | igual |
| Corona dorada sin fulgor | Él está quieto, pero corren workers suyos. | Distinguir «me está contestando» de «está dirigiendo». Sólo Riel. | igual |
| Corona gris | Quieto. | Calma. | igual |
| Corona más apagada y nombre apagado | Quieto y con el caché vencido: retomarlo sale caro. | Se ve qué conversaciones ya se enfriaron. Va con el anillo vacío del caché (`Uncached` en su tooltip). | recuperada (la regla del nombre no ganaba en la lista) |
| Corona roja + `Murió` | El proceso se cayó o lo mataron **con Trama andando** (OOM, `kill -9`, error del motor). Se retoma desde su vista. | No confundirlo con uno que cerró bien. | igual, con una regla: **cerrar, reiniciar o cortar la app (en Windows el cierre mata el árbol del motor) nunca lo deja `Murió`**: queda dormido (sin señal), vuelve solo con `--resume` y, si no puede, escribirle lo retoma. La vejez tampoco: ningún corte por antigüedad marca muerto antes de `MUERTO_S` (7 días, `arbol.ts`). |
| Corona apagada + `Cerrado` | Sin proceso, cerrado bien. | Sigue a la vista con sus workers. | igual |
| Corona en círculo ámbar, halo + `te espera` | Terminó su turno o pide un permiso, y espera tu respuesta. | Lo que espera es lo único que llama desde lejos. | cambió: antes era un `?` en recuadro en lugar de la corona; la corona se queda porque sigue siendo un líder. `te espera` **recuperada** para los dos motivos (el Riel decía `decidir` si pedía permiso); el motivo, en el tooltip. |
| Rojo en el líder por un worker suyo | (Ya no.) Antes el `✕` reemplazaba la corona. | | cambió en `a48526d`: el worker que falló está a la vista justo debajo y resalta él; el líder no lo repite. |
| **Nunca ✓ en un líder** | | Un líder no «termina» nada: la conversación sigue. Una palomita al lado de la corona no le dice nada al dueño. | recuperada: el Riel puso un ✓ en «N terminados», pegado a la corona |
| `2 sub.` con punto que late | Corren N subagentes: la sesión trabaja, no se enfría. Con eso no se muestra el caché. | `sub.chipTip`. | recuperada la palabra (el Riel dejaba un número suelto) |
| Ícono de máquina | El líder corre en otra máquina (la cuenta del escritorio remoto). | Saber dónde está. | igual |
| **Chip gris `Opus high`** (angosta: `O high`), junto al ⚡ | Con qué modelo y esfuerzo habla. La versión (`Opus 5.5`), en su tooltip. Un líder sin proceso no lo lleva: ya dice `Murió`/`Cerrado`. | Saber con qué gasta cupo sin abrirlo (#1919). | cambió: antes sólo en el tooltip del tiempo; el chip vuelve, sin segunda línea. |
| Lo que hace ahora (`Corriendo Bash`) + cuánto lleva | Sólo líderes de la app, que cuentan lo que hacen. | B12. | recuperada: el tiempo del turno (`12 s`) en la columna del tiempo, lo que hace en su tooltip; la frase entera no entra en una línea. |
| `Archivar` / `Cerrar líder` al pasar el mouse | Quieto se archiva; respondiendo se cierra. Con ramas sin integrar o siendo de la app, pregunta en el mismo botón (otro clic confirma, Esc o irse cancela). | No perder nada de un clic. | igual |

## El rayito (el caché)

| Señal | Qué dice | Por qué existe | Estado |
| --- | --- | --- | --- |
| **`⚡ 21m`** | La conversación está caliente: el caché dura 21 min más; retomarla ahora sale barato. El tooltip lo dice en palabras. | Decide si conviene seguir ahora o dejarla. Es el dato que el dueño mira para no gastar. | **recuperada**: el Riel lo escondió hasta pasar el mouse, y sin mouse no había ninguna señal. Va siempre a la vista, en su píldora y antes del tiempo. |
| Texto blanco con un pulso | Quedan menos de 10 min (o 1/6 de un TTL corto): el pulso una sola vez. | Avisar sin molestar. | igual |
| Anillo vacío (el rayo sin carga), sin píldora | `Uncached`: venció o no va a pegar; el próximo mensaje relee todo y gasta más cupo. La palabra vive en el tooltip y el lector de pantalla la sigue leyendo. | Va apagado: no pide nada, y la fila gana ancho para el título (#1919, pedido del dueño). | cambió: antes la palabra `Uncached` a la vista. Sigue sin depender del color: tiene forma (anillo vacío ≠ rayo), el nombre se apaga y el tooltip lo dice con palabras. |
| Nada | Otro motor (el caché medido es sólo de Claude, con el TTL real: 1 h o 5 min) o sin dato. | `41ec09f`. | igual |
| Nada en un líder sin proceso y frío | `Murió`/`Cerrado` ya lo dice: el anillo al lado no suma. | Falta de lugar en una línea. | cambió |
| Con `te espera` | Se ve igual: es cuando más importa el caché. | | igual |
| En un worker | Sólo si terminó (no corriendo ni pidiendo atención). | Retomarlo también sale barato o caro. | recuperada |

La sección `⚡ Activas` de arriba ya no existe (cambió en `0c98b24`: un solo agrupado, por proyecto): lo caliente flota con su proyecto (`prioridad`, `sinActivas`), no se pliega entre los quietos, y el rayito de la fila dice lo mismo que el de la sección.

## El tiempo y la antigüedad

| Señal | Qué dice | Por qué existe | Estado |
| --- | --- | --- | --- |
| `hace <1 m`, `hace 6 m`, `hace 6 h`, `ayer`, `hace 3 d` | Hace cuánto pasó lo último. `ayer` sólo de 24 a 48 h: menos de 24 h siempre dice `hace N h`, aunque haya cruzado la medianoche (el día calendario no cuenta). | Con la palabra `hace` no se confunde con una duración ni con los `21m` del rayito, que van justo al lado. | **recuperada**: el Riel la achicó a `6 m`, `3 d`, `ahora`. |
| `27 oct` (y el año si es de otro) | De más de una semana: la fecha. | `279e281`: «hace 23 d» ya no dice nada. | igual |
| `corre hace 38 s`, `corre hace 4 m`, `corre hace 1 h 05 m` | Lo que corre: el tiempo total que lleva corriendo. Segundos sólo el primer minuto. El tooltip dice desde cuándo (`Empezó 04:31`). | Una corrida larga no puede decir `ayer`; sin la palabra, `4 m` se leía como lo que terminó (#1919). | **recuperada**: el Riel usaba el mismo formato que lo terminado; la palabra `corre` es nueva. |
| Sin tiempo | Lo que pide una decisión y lo que está en cola. | Importa que espera; ahorra ancho al título. | recuperada |
| `te espera` sin tiempo al lado | La palabra y el rayito mandan; no entran los tres con un título que se lea. | | cambió |
| `12 hilos, hace 3 h` | Encabezado de un proyecto plegado. | Lo mismo: la misma unidad en toda la barra. | recuperada |
| `2 d 17 h` | Cuándo vuelve un cupo, desde un día, con horas. | `53c637e`: `2 d` solo no alcanzaba para planificar. | igual (detalle de cupos) |
| Lo escribe el reloj compartido (`Reloj`) | Un tic no re-renderiza filas. | Rendimiento (`renders.filas` lo controla el guion). | igual |

## El worker

Cuelga de su líder por el hilo del proyecto. Se abre tocando cualquier parte de la fila (`5af5b48`).

| Señal | Qué dice | Por qué existe | Estado |
| --- | --- | --- | --- |
| **Punto que late con doble onda**, en el color del proyecto | Está corriendo. Con movimiento reducido, quieto. | El movimiento es «vivo». Lo mueve `latido.ts`, nunca una animación CSS infinita (Chromium compondría en cada vblank). | **recuperada**: el Riel usó un `▸` que parecía una flecha de desplegar. |
| Tramo del hilo encendido y lanzadera | Corre (decora; dice lo mismo que el punto). | Idea del Riel: el telar. | igual (es del Riel) |
| Frase tierna (`se esponja`) antes del tiempo | Corre. Se apaga en Ajustes y rota sola. | B17, pedido del dueño; reemplaza a «Trabajando». | recuperada: va pegada al título y cede antes que él: entra entera o no se ve (con un título largo no se ve); sin asteriscos y sin el brillo (el movimiento ya lo hace el punto). |
| Anillo punteado que gira + `Trabado` | Sin avance hace rato: puede que haya que mirarlo. | No confundirlo con lo frenado a propósito. | recuperada (el Riel usaba las mismas dos barras que para frenado) |
| Dos barras + `Frenado` | Lo paró `pa --parar` a propósito. Nunca en rojo: no es un fallo. | | igual |
| Reloj + `En cola` | Espera puesto o lugar: no trabaja todavía. El motivo, en el tooltip. | | igual |
| ✕ en círculo coral, halo + `falló` y fila tintada | Murió sin que nadie lo frenara. El tooltip dice `Murió` o `No arrancó`. | Se ve desde lejos. | recuperado el tooltip |
| ? en círculo ámbar, halo + `decidir` y fila tintada | Pide que elijas algo. | `decidir` en vez de `pide decisión`: lo pide la línea única. | cambió la palabra (la frase, en el tooltip) |
| Se calma al resolverse | Lo relanzado, integrado o visto deja de resaltar y de contar (`atencion-vigente.ts`). | `539ce20`: un fallo viejo ya atendido no puede seguir gritando. | igual |
| ✓ turquesa | Sólo en la fila de un worker que **terminó**. El tooltip y el lector de pantalla dicen `Terminó`. | Ahí sí es verdad. | igual, y sin palabra visible porque el pliegue ya dice «terminados» |
| Título en negrita (`data-nuevo`) | Trajo algo que todavía no abriste. | | igual |
| Apagado (`data-apagada`) | Es de un líder y ya terminó: no compite con lo que trabaja. | | igual |
| Hojas + `compactando` + duración | Está compactando su contexto. | B19. | igual |
| **Chip gris `Sonnet high`** (angosta, hasta 340 px: `S high`; sin esfuerzo, el nombre entero) | Con qué modelo y esfuerzo corre. Va a la derecha, antes del rayito y del tiempo, y **no cede: se corta el título primero**. | Pedido del dueño (#1919). | **recuperada**: el Riel lo mandó al tooltip. |
| Título real: `pa --titulo`; sin él, el objetivo del brief | Cómo se llama el worker. Sin `--titulo` ni «Objetivo:», la primera línea con la tarea: se saltean las de reglas (`Seguí AGENTS.md…`, `Usá <skill>…`, `Reglas:`). | Casi todos los briefs empiezan con las reglas: los títulos eran iguales (#1919). | cambió |
| Rama, máquina y commits | En el tooltip de la derecha, con el título entero y el estado. | | cambió: de segunda línea al tooltip, por la línea única. El laptop se fue: siempre decía lo mismo. |
| `Integrar`, `Archivar`, `Retomar`, `Quitar` al pasar el mouse | Lo que le toca (`comoSettle`). `Quitar` con commits pide un segundo clic. | Lo que borra una rama confirma. | igual |

## Agrupado, orden y plegado

| Señal | Qué dice | Por qué existe | Estado |
| --- | --- | --- | --- |
| **Encabezado por proyecto, fijo al scrollear** | Todo va agrupado por proyecto. | Se piensa por proyecto. | igual (del Riel) |
| **Un color por proyecto** | El mismo en su monograma, su encabezado y el hilo. En tema claro, más oscuro para que se lea. | Reconocer sin leer. | igual (del Riel) |
| **Riel de monogramas** (o el logo) | Filtra o salta a un proyecto. `✕` si algo falló, `?` si algo te espera, punto que late si algo corre. Tooltip y `aria-label` con la frase. | Lista de todo el alto, sin scrollear. | igual (del Riel) |
| Pestaña en el borde del riel | Qué proyecto se está filtrando o mirando. | | igual |
| Encabezado resaltado (`data-viendo`) | Lo que tenés abierto a la derecha es de acá. | | igual |
| `4 en marcha` | Cuántos trabajan ahora en el proyecto. | Se ve aunque esté plegado. | igual (del Riel) |
| Glifo `✕`/`?` en el encabezado plegado | Adentro hay algo que mirar. | Plegar no esconde lo urgente. | igual |
| `N terminados` / `N terminadas` | Lo terminado se pliega solo, bajo su líder o sin líder. Sólo la palabra y la flecha. | La montaña de terminados no ocupa la barra; el botón va antes de la lista y, abierto, queda pegado bajo el encabezado del proyecto para no bajar hasta el fondo. | recuperada sin el ✓ |
| Lo que falló no se pliega | Queda a la vista aunque terminó (`aRiel`). | | igual |
| `Ver N más` | Los líderes quietos: en espera (30 min sin nada) y dormidos (sin proceso, más de una semana). Se ven de a dos. El tooltip dice cuántos de cada uno y que un dormido no se borra. | | cambió: reemplaza los pliegues «N en espera» y «N dormidos»; recuperadas las palabras en el tooltip. |
| `Recientes` / `A-Z` / `Manual` | Cómo se acomoda; se recuerda. Lo movido a mano no cambia solo. | `279e281`. | igual |
| La lista no se mueve mientras la mirás | Mouse, foco, arrastre o menú abierto congelan la foto. | Que no salte lo que estás por tocar. | igual |
| Lo caliente flota | Sube su proyecto y no se pliega entre los quietos. | Reemplaza a `Activas`. | cambió |

## Arriba y abajo de la lista

| Señal | Qué dice | Por qué existe | Estado |
| --- | --- | --- | --- |
| `N falló` / `N fallaron` en coral, con `✕` | Cuántos fallos sin resolver. Filtra y abre el primero; otro clic quita. | Lo primero que se ve. `79a1baa`: sólo lo vigente. | igual |
| `N espera` / `N esperan` en ámbar, con `?` | Líderes y workers que te esperan. Ídem. | | igual |
| Buscador `Ctrl K`, con `N de M` y lo buscado resaltado | Busca también en lo cerrado; el riel apaga los proyectos sin resultados. | | igual |
| Nuevo líder (`+`, `Ctrl N`) | Uno solo, arriba; la carpeta la elige el pedido. | | cambió: antes por carpeta |
| Anillos `5 h` y `sem` | El uso de la cuenta de Claude en uso. Ámbar desde 70 %, rojo desde 90 %, y lo agotado con palabras y cuándo vuelve. Al tocar, el detalle. | Los cupos ocupaban media barra. 5 h y semana van siempre juntos. | cambió con el Riel: dejó de verse «vuelve en» sin tocar; lo agotado y lo que queda poco sí lo dicen. |
| `En uso` con tilde / `Usar primero` | Qué cuenta usa cada motor. Es la única palomita de cupos: va con su palabra. Trama no rota de cuenta sola. | `959f3b4`. | igual |
| Número en el Tablero | Cuántos ítems te esperan ahí. | | igual |
| Avisos de workers al pie | Uno por worker: turquesa terminó, ámbar decisión, coral falló; botón de relanzar. | | igual |

## Secciones especiales

| Señal | Qué dice | Por qué existe | Estado |
| --- | --- | --- | --- |
| `De Claude Code (N)` | Conversaciones de Claude Code que no se abrieron desde Trama, plegadas al final de cada proyecto. Tocar una la retoma; sus archivos no se tocan. `Sin carpeta` y `Otra cuenta` lo dicen. Buscador si son muchas. | `4ed1e11`. | igual |
| `Otras carpetas` | Lo de Claude Code de carpetas que no son proyectos. | | igual |
| Inicio | La carpeta personal; una línea de ayuda explica por qué hay conversaciones ahí. | | igual |
| `sin líder` / `líder muerto` | Workers cuyo líder cerró o murió, con el nombre en el tooltip. | «Nadie está esperando esto». | igual |
| Lanzado sin líder | Cuelga directo del proyecto y mide como un líder. Lo que pide, lo decidís vos. | | igual |
| `Cerrados · N` | Lo que `pa` ya cerró, al fondo, plegado. Dice cómo: `Integrado`, `Cerrado`, `Descartado`, `Revertido`. | | igual |
| Raya en el color del proyecto, en Cerrados | De qué proyecto es: están todos mezclados. El nombre, en el tooltip. | | cambió: antes era texto (`Integrado · atlas · hace 3 d`), que no entra en una línea. |
| Subagentes bajo el líder | Descripción, modelo y esfuerzo («del líder» si los heredó), estado, tiempo, tokens y lo último que hizo; se pliegan y archivan. Punto que late si corre. | `a0da0f3`, `d32e88e`. Uno callado 15 min figura parado, no corriendo (`f559d18`). | igual |

## Forma

- Una línea por hilo (28 px), elegida por el dueño contra dos líneas (`maquetas/rediseno-0.4/barra-densa-b.html`): entran 26 hilos en vez de 6. A cambio, lo que no entra va al tooltip.
- A la derecha, siempre en este orden: frase tierna, chip de modelo y esfuerzo, rayito, palabra o píldora, tiempo. Si falta lugar cede primero la frase, después el título; el chip no cede.
- CSS sólo con tokens; textos en `es.ts` y `en.ts`; movimiento por `latido.ts` y con `prefers-reduced-motion` respetado.
