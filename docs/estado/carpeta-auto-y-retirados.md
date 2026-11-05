# Carpeta "Auto" del líder nuevo y proyectos retirados

Estado: hecho (rama `pa/trama/20261105-001900-455198`).

## Por qué

- En "Nuevo líder" el selector de carpeta arrancaba en el proyecto que miraba la barra (o el último usado) y había que cambiarlo a mano.
- El proyecto `hilos`, retirado (`estado: retirado`, `reemplazado_por: trama`), seguía teniendo carpeta e ícono en el riel y se podía tocar
  creyendo que era `trama`: el chat quedaba con cwd en el repo viejo.

## Parte 1: Auto

- La primera opción del selector es **Auto** y es el valor de siempre: también con un proyecto filtrado en la barra y sin acordarse del último usado.
- Al mandar el primer mensaje la caja manda `auto: true` (sin `carpeta`). El main de la máquina que corre el líder (`lider.nuevo`) infiere el
  proyecto con `electron/carpeta-auto.ts`: `proyectoEnTexto` sobre el registry **de esa máquina**; si no nombra ninguno, carpeta personal (`~`).
  En otra máquina (selector de máquina) vale su registry; un build viejo ignora `auto` y va a `~`.
- Sin modelo ni red: el envío no espera. La inferencia mira nombre, slug, carpeta, alias y ahora también el `titulo` del registry.
- Elegir una carpeta a mano (un proyecto, "Carpeta personal" u "Otra carpeta…") manda y nada la pisa; el campo sigue con buscador. Tras enviar,
  la caja vuelve a Auto.
- "Nueva tarea aquí" (menú de un proyecto) y las tareas del tablero siguen arrancando en esa carpeta: es un pedido explícito de una sola vez
  (`pedirCarpeta` en `src/hilo/carpeta-nueva-estado.ts`), equivale a elegirla a mano.
- Ya no hay chip "automático" ni detección mientras se escribe (se borró `detectar-proyecto.ts`); en el selector no se muestra a qué carpeta se
  fue: se ve en la barra.

## Parte 2: retirados

- Un proyecto con `estado: retirado` **no se infiere, no se ofrece en "Nuevo líder" y no sale en "Mover a proyecto…"** (`vivosDe`, `ofrecidos`, `destinos`).
- `registro()` lee `reemplazado_por` (nombre, slug o alias) y lo resuelve al slug (`Proyecto.reemplazadoPor`). `electron/reemplazos.ts`
  (`mapaReemplazos`, puro) da retirado → reemplazo, siguiendo cadenas y cortando ciclos.
- Lo que corrió en un retirado con reemplazo se ve en la carpeta del reemplazo, sin tocar el `proyecto` del hilo (para `pa` sigue siendo el
  suyo: integrar, actualizar…):
  - `statusline.ts` y `claudeCode:listar` usan `rutasDeBarra` (cwd → slug donde se ve);
  - `armarArbol` (`reemplazos`) agrupa hilos, `inferido` y lo movido a una carpeta retirada; `filtrarArbol` también para "Cerrados";
  - lo **movido a mano a otra carpeta** manda sobre el reemplazo.
- Un retirado **sin** `reemplazado_por` (o cuyo reemplazo no está en el registry) conserva su carpeta de siempre: nada se pierde de vista. Lo único
  que se le saca es la inferencia y el ofrecerlo para un líder nuevo.
- El riel no usa el cwd para ubicar un líder (`l.proyecto` se ignora en `armarArbol`, ver el test "lo-que-diga-el-cwd"); por eso un líder
  con cwd en un retirado se ve donde diga su primer mensaje o su worker, y en la carpeta del reemplazo cuando lo nombra.

## Parte 3: ícono

Dos proyectos con el mismo logo se confunden; retirado el duplicado el caso desaparece (ya no tiene entrada en el riel). No se agregó nada.

## Pruebas

`tests/carpeta-auto.test.ts` (inferencia y retirados), `tests/carpeta-nueva.test.ts` (Auto por defecto, a mano manda),
`tests/reemplazos.test.ts`, `tests/registro.test.ts` (`reemplazado_por`), `tests/arbol.test.ts` y `tests/riel.test.ts` (reparto en carpetas),
`tests/lider-carpeta.test.ts` (`nuevo({ auto })` con claude falso) y `scripts/prueba-acciones.mjs` (por CDP: Auto de entrada, el retirado
no se ofrece, elegir a mano manda).
