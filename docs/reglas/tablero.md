# Reglas: tablero

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## «Limpiar» del Tablero

- **«Limpiar» del Tablero (`app/src/paneles/LimpiarTablero.tsx`, lógica pura en `src/datos/tablero-limpiar.ts`, tanda en `src/datos/tablero-tanda.ts`):** cierra en masa a `tirado`, NUNCA borra.
Se sugiere y viene marcado lo desactualizado: proyecto `retirado` en el registry, clave `pa:<id>` con la corrida `integrado` (`pa --hilos`) y prueba que nombra una versión
anterior de Trama; lo demás entra sólo si el usuario lo marca o elige un plazo. El CLI sólo trae `tirar` en lote (`tablero tirar 1 2 3`) y `mover` de a uno, así que se llama por item, de a
4 (`correrEnLote`, con el candado del CLI más no acelera) y con progreso; usa los canales de siempre (`tablero:tirar` / `tablero:mover`), sin canal nuevo ni cambio en `windows/`.
Deshacer reabre la última tanda con `mover --columna=<la de antes>` (se guarda en `localStorage`, caduca al día). Mientras corre, la lista del diálogo queda fija: cada cierre
relee el tablero. Lo cubre `scripts/prueba-tablero.mjs` (tablero temporal) y `tests/tablero-limpiar.test.ts`.

## «Te dejé esto en el tablero»

- **«Te dejé esto en el tablero» (`app/src/hilo/tablero-dejado.ts`, `DejadoTablero.tsx`):** el chat de un líder muestra una tarjeta discreta (sin toast ni sonido, sin mover el scroll) cuando
él o un worker suyo dejó algo para la persona. Líder: una llamada a Bash con `tablero agregar` (`--tipo pregunta|prueba`, `--prueba` o `--columna espera-dueno`) que DEVOLVIÓ el id
(el CLI imprime sólo el id: sin id, con error o sólo nombrando el comando no cuenta; se arma en `turnos()` → `dejados`). Worker: el aviso de Trama al líder (enrutado por `jefe_id`)
trae el id del worker, y sus items son los de clave `pa:<id>`, `pa:<id>:<n>`, `pa:<id>:p1`. El estado (te espera / ya respondiste / ya se cerró) sale del tablero leído, una lectura
compartida (`tablero-dejado-fuente.ts`). Abrir = `pedirItem` (`paneles/tablero-abrir.ts`): la barra abre el panel y `TableroNuevo` muestra el item. Captura `lider-tablero-dejado`
(`HILOS_VARIANTE=respondida|cerrada|muchas`); lo controla `tests/tablero-dejado.test.ts`. Límite: un `pa --seguir` anota con el id de la corrida original, que puede no ser el del aviso.
