# Reglas: pantalla

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Probar la interfaz solo (`pantalla`)

- **Probar la interfaz solo (workers de frontend/diseño): `pantalla`** (`motor/bin/pantalla`, port directo en `app/electron/cli/pantalla.ts`;
Linux y Windows, el .cmd lo arma `windows/src/payload-nativo.js`). Abre una Trama PROPIA offscreen con datos de ejemplo, en un HOME y un
perfil temporales: no toca el escritorio, el puntero ni los datos del dueño. Todo va por Electron (`capturePage` y DevTools), sin dependencias.
Necesita el build (`npm run build` en `app/`, o al menos `npx vite build` y `npx tsc -p tsconfig.electron.json`). Uso:
`pantalla abrir [estado] [VAR=valor …] [--tam "1280 800"]` (estados de `Captura` en `src/modo.ts`, default `normal`; ej.
`pantalla abrir lider-nuevo HILOS_TEMA=claro`) · `pantalla captura -o /tmp/x.png` y mirar el PNG con Read · `pantalla clic <x> <y>` (píxeles de la
captura) o `clic --sel "<css>"` (el centro del elemento; `--derecho`, `--doble`) · `pantalla escribir "texto"` (en lo que tenga el foco: clic
antes) · `pantalla tecla Enter|Tab|Escape|ctrl+a|F5…` · `pantalla rueda <dy> [x y]` · `pantalla donde "<css>"` · `pantalla leer ["<css>"]` (texto
o `value` de un campo) · `pantalla js "<expresión>"` · `pantalla cerrar`. Hay que cerrarla al terminar (sola se cierra a los 10 min sin
pedidos). Cada carpeta de trabajo tiene su ventana (`--sesion <nombre>` para tener dos). Sirve para ver y operar la interfaz con
datos falsos; no prueba nada contra `pa` ni contra el motor. Una captura común (`scripts/captura.sh`) sigue siendo sólo una foto: sin clics.
