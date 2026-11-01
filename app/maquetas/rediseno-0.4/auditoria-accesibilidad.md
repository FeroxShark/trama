# Auditoría de accesibilidad — rediseño 0.4

Alcance: `app/src` entero, contra la regla de AGENTS.md («ningún estado puede depender sólo del rojo o el verde: siempre con
palabra o ícono») y seis chequeos: botones sólo-ícono sin nombre, foco visible, contraste de texto chico sobre vidrio (AA),
imágenes sin `alt`, orden de tabulación en el composer y los popovers, y estados sólo por color. Cambios chicos, sin rediseñar.
Las comprobaciones mecánicas (árbol de TypeScript sobre los 107 `.tsx`, y el cálculo de contraste de todos los temas contra
`--sup-0…2` y el vidrio sobre el degradé de la ventana) están descritas abajo; no quedaron como scripts del repo.

## Arreglado

| Dónde | Qué pasaba | Qué se hizo |
| --- | --- | --- |
| `src/tokens.css:19` (`--inactivo`) | Texto terciario con 0,36 de blanco: contraste 3,3 sobre el vidrio (AA pide 4,5). Lo usan ~12 textos chicos (`.cuenta`, `.wk-dur`, `.wk-nota`, `.bv-nota`, `.mcx-*`, `.aj-grupo-sub`…). | Sube a 0,56 (≥ 5,9 en todas las superficies). En `claro` (`temas-colores.css`) de 0,45 a 0,62. |
| `src/tokens.css` (`--texto-5/6/7`, `--txt-4`) | `--texto-7` (#5f626a) daba 3,0 y se usa como color de texto real en ~70 reglas (`.meta`, `.vacio`, `.ficha dt`, placeholders, ayudas de Ajustes…); `--texto-6`/`--txt-4` daban 4,1 sobre `--sup-2`. | `--texto-5` #a0a3a9, `--texto-6` y `--txt-4` #96999f, `--texto-7` #8f9299: todos ≥ 4,5 sobre `--sup-0…3` y sobre el vidrio (peor caso 4,7). La jerarquía se conserva en tres escalones más juntos. |
| `src/temas-colores.css` (`claro`) | `--texto-7` (#8a91a0) daba 2,9 sobre `--sup-0`: en el tema claro lo tenue es más claro y se pierde. | `--texto-5/6/7` y `--txt-4` más oscuros (#454c5f, #50586b, #596073): ≥ 5,0 en `--sup-0…2`; `--texto-8` pasa a #8a91a0 (queda sólo para lo deshabilitado). |
| `src/paneles/tablero-logica.css:783`, `src/paneles/proyectos.css:412`, `src/paneles/paneles.css:859`, `src/index.css:1760` | Texto real con `--texto-8` (2,1): el cero de `.tb-num[data-cero]`, `.lmp-lista`, `.pn-h-sub` y `.cache[data-frio]`. `--texto-8` es para lo deshabilitado. | Pasan a `--texto-7`. |
| `tests/temas.test.ts` | El test exigía sólo ≥ 3 al texto apagado. | Ahora `--texto-5/6/7`, `--txt-4` e `--inactivo` deben dar ≥ 4,5 en los seis temas. |
| `src/hilo/Worker.tsx:~330` + `worker-logica.css:259` (`.wk-seg[data-fallo]`) | En el mapa de pasos del worker, un paso fallido sólo cambiaba de tono en una barra de 6 px, sin palabra ni forma. | El nombre accesible y el tooltip suman «· falló» (`wk.chipFalla`, ya existía) y el segmento lleva rayas en diagonal. |
| `src/hilo/worker-logica.css` (`.wk-seg:hover::after`) | El nombre del segmento aparecía sólo con el mouse; con Tab no se veía. | También con `:focus-visible`. |
| `src/index.css` (`.cmenu-buscar`) | El buscador de los menús tenía `outline: none` y ningún reemplazo: sin foco visible. | `:focus-visible` con anillo interno de 1,5 px con `--acento`. |
| `src/hilo/acciones.css:77` (`.am-editor textarea`) | Editar un mensaje: el campo tenía `outline: none` sin reemplazo. | Se quitó `outline: none`: vale el anillo global de `:focus-visible`. |
| `src/index.css` (`.mc-busca:focus-within`) | El buscador del selector de modelo sólo subía un poco el color del borde (`--texto-6`, ~1,9 de contraste de borde). | Borde y anillo interno de 1 px con `--acento`. |
| `src/index.css` (`.caja-carpeta input:focus-visible`) | El campo de carpeta del composer cambiaba el borde a `--borde-5` (~1,9) con `outline: none`. | Borde y anillo interno de 1 px con `--acento`. |
| `src/barra/tooltip.ts` | El tooltip enfocado con Tab no se podía descartar sin mover el foco (WCAG 1.4.13). | Esc lo esconde, sin tocar el foco ni cerrar lo que haya abierto. |
| `src/paneles/Tablero.tsx:471`, `Tablero.tsx:572`, `TableroNuevo.tsx:173` | Dos `role="tablist"` y un `role="table"` sin nombre accesible. | `aria-label` con claves nuevas `tablero.vistas` y `pd.pestanas` (es/en) y la existente `tablero.vistaProyectos`. |
| `src/index.css:581,593` (`.susc > .g-acc`) | El botón de cuenta de la tarjeta de suscripción (Cambiar/Elegir) y su texto iban a 9 px. | Pasan a `--letra-3` (11 px). |

## Revisado y sin cambios

- **Botones sólo-ícono:** recorrido con el árbol de TS sobre `button`, `a`, `Boton` e `Interruptor`; todos tienen texto, `aria-label` o `title`
  (los `Interruptor` de `PanelContexto.tsx` lo ponen dentro del componente local). Las miniaturas (`Imagenes.tsx`) llevan `aria-label` en
  el botón y `alt=""` en la imagen, correcto porque la imagen es decorativa dentro del botón nombrado.
- **Imágenes:** ningún `<img>` sin `alt`; el logo de proyecto lleva `alt={titulo || proyecto}`; los SVG de logos son `aria-hidden`;
  el QR (`CelularGuia.tsx`) es `role="img"` con `aria-label`.
- **Campos de formulario:** todos tienen `<label>` o `aria-label` (los dos `input type=file` están `hidden`).
- **Estados sólo por color:** las filas de la barra (`Punto`) llevan texto en la segunda línea; fallo y decisión llevan ícono y píldora
  con palabra; los cupos llevan `Ban`/`TriangleAlert` y texto («agotada», «usado N %»); el chip de tests lleva `Check` o «tests fallan»;
  el interruptor `pn-llave` distingue anillo vacío de punto lleno además del color; el diff lleva signos `+`/`−`.
- **Foco global:** `:focus-visible` dibuja `outline: 2px solid var(--azul)` en toda la app; los `outline: none` restantes son raíces con
  `tabindex="-1"` (diálogos), campos cuyo contenedor dibuja el anillo (`.caja`, `.buscar`) o ya traen anillo propio con `--acento`
  (`ajustes-vidrio.css`).
- **Orden de tabulación:** no hay `tabindex` positivo ni `order`/`row-reverse` que desordene el foco salvo `.tb-btns{order:1}` (sólo
  botones después de texto). El composer es: caja de texto → adjuntar → modo → selectores → contexto → parar → dictar → mandar, igual al
  orden visual. Los popovers (`Selector`, `Contexto`, `ContextoLocal`, `Menu`) devuelven el foco al disparador con Esc, usan flechas
  dentro y se abren después de su botón en el DOM.
- **Movimiento:** `prefers-reduced-motion` apaga animaciones y transiciones de todo `.app`.

## Pendiente (no se tocó, para decidir)

- Texto a 10 px (`--letra-2`) en insignias y cifras de 1-3 caracteres (`index.css:491,1566,1945,3091,3361,6399,6897`,
  `contexto-panel.css:361`, `ui.css:184`, `paneles.css:906,1038`). Cumple contraste, pero es chico: subir el token a 11 px
  comprime la escala (`--letra-2` = `--letra-3`).
- Los `role="tab"` de `Tablero`/`TableroNuevo` no tienen navegación con flechas ni `aria-controls`: todos los tabs son tabulables y
  se activan con Enter, lo que cumple, pero no es el patrón ARIA completo.
- Las zonas con `overflow: hidden` pueden recortar el anillo de foco global (offset 2 px) en bordes de paneles; no se vio un caso
  concreto sin abrir la app a mano.
- `Selector.tsx` y los menús los está tocando otro worker (popovers): no se editaron aquí.

Linux y Windows iguales: todo es CSS/TSX de `app/src`; no hace falta nada en `windows/`.
