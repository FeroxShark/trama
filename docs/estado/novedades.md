# Novedades de cada versión

Pedido: «saber qué trajo cada versión» sin salir de Trama. Antes, el aviso de Trama nueva mostraba las notas del release *antes* de
actualizar; después no había nada ni historial.

## Qué hay

1. **Fuente: `CHANGELOG.md` de la raíz** (`## 0.2.N` + viñetas, con `código` y **negrita**). Lo copia el build a `dist/CHANGELOG.md`
   (plugin `cambios` de `app/vite.config.ts`) y de ahí lo lee el motor (`app/electron/novedades.ts`). Como `dist/` viaja entero, llega a:
   - **AppImage**: `electron-builder.yml` ya lleva `dist/**/*`.
   - **.exe nativo de Windows**: el payload copia `app/dist` completo (`windows/src/payload-nativo.js`).
   - **Instalación de escritorio de Linux** (compila una copia en `~/.local/share/trama/app`): `motor/scripts/instalar-producto.sh` deja
     el `CHANGELOG.md` de la fuente en la carpeta que contiene al build (`$dst/CHANGELOG.md`, que es el `../CHANGELOG.md` de vite).
   - Checkout sin build (dev): el motor cae a `<raíz>/CHANGELOG.md`. Si falta el archivo, el build sigue y la app dice que no hay historial.
2. **Aviso al pie** (`src/barra/AvisoNovedades.tsx`, `novedades.css`): «Novedades de la vX.Y.Z», la misma pastilla que los demás avisos del
   pie. Se abre con un toque (nunca solo, sin toast ni sonido) y lista las viñetas de esa versión y de las intermedias si saltó varias.
   **Listo** lo cierra para siempre; Esc o un clic afuera sólo lo pliegan. Captura: `aviso.png`.
3. **Ajustes > Actualizaciones > Novedades** (`src/paneles/AjustesNovedades.tsx`): todas las versiones, la más nueva arriba y cada
   una plegable (`<details>`); la de ahora viene abierta y dice «instalada». El buscador de Ajustes la encuentra (`ajustes-nav.ts`:
   «novedades», «changelog», «cambios», «what's new»…). Capturas: `ajustes.png` y `ajustes-360.png`.

## Qué se muestra (regla pura, `electron/novedades-cambios.ts`)

- **Última vista** en `preferencias.json` (`novedades`, `X.Y.Z`), la que se cerró con «Listo»; nunca retrocede.
- Se muestran las versiones `> vista` y `<= actual`, la más nueva arriba.
- **Primera instalación** (bienvenida sin ver y nada guardado): no se muestra nada y se anota la versión de ahora.
- **Ya usaba Trama antes de esto** (bienvenida vista, nada guardado): sólo la de ahora (no se sabe de cuál viene).
- Una corrida de prueba (bench, captura, fixtures…) dice «ya vista» y no escribe nada.
- Versión actual más vieja que la vista (se volvió a una anterior): nada.

## Canales

`novedades:leer` (devuelve `{ texto, actual, vista }`) y `novedades:cerrar` (`version`): en `canales/contrato.ts`, `RUTAS` de
`maquinas-contrato.ts` (`local`: cada motor las suyas), `preload.cts`, `src/puente.ts` y `windows/src/canales.json` (generado). Sirven
igual al celular: el `Listo` desde el celular cierra también en la PC, porque la marca vive en las preferencias de ese motor.

## Tests y capturas

`tests/novedades.test.ts` (parser, qué versiones mostrar, la última vista, el empaquetado), `tests/ajustes-nav.test.ts` (el índice de
búsqueda). Capturas: `scripts/captura.sh novedades` y `HILOS_VARIANTE=novedades scripts/captura.sh ajustes`.

## Límites

- El contenido del CHANGELOG queda en español, tal cual, también con la interfaz en inglés.
- Cada versión nueva necesita su `## X.Y.Z` en el CHANGELOG: sin entrada, el aviso no aparece para esa versión.
