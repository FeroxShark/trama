# Trama

App de escritorio para manejar los workers de `pa` (Electron + motor). El traspaso completo, con lo hecho y lo que
falta, está en `motor/docs/traspaso.md`.

## Cómo se trabaja

- **Idioma:** todo en español rioplatense (código comentado en español, interfaz es + en).
- **Accesibilidad:** ningún estado puede depender sólo del rojo o el verde: siempre con palabra o ícono.
- **CSS:** sólo con los tokens que ya existen (`app/src/tokens.css`). Textos en `app/src/i18n/es.ts` y `en.ts`, con las
  mismas claves y las mismas `{variables}`.
- **Claves y secretos:** nunca se pegan ni se loguean. Viven sólo en `~/.config/trama/claves.env`.
- **Windows:** nada de bash, WSL ni Git Bash, ni siquiera de respaldo (ver `motor/docs/port-windows-plan.md`).
- **Linux y Windows siempre juntos:** todo cambio vale para las dos (app en `app/`, carcasa nativa en `windows/`). Si tocás
  algo de una (instalador, servicio, ventana, canales, rutas, binarios), hacelo también en la otra o, si no se puede en esta
  tarea, decilo en el RESULTADO con "FALTA EN <Linux|Windows>: …" para que el jefe lo anote. Un canal nuevo de la ventana
  va también en la carcasa (lo controla `tests/nucleo.test.ts`).
- **Cuentas:** no rotar cuentas de Claude ni de OpenCode para esquivar límites.
- **PR:** no se abren salvo que el dueño lo pida. Sin nombres de modelos de IA en commits ni en PR.
- **Antes de cada commit**, desde `app/`: `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p tsconfig.electron.json --noEmit`,
  `npx vite build`, `npm test`. Si se toca el motor que se está portando: `npm run test:paridad`.
- **Chequeo rápido para workers:** desde `app/`, `npm run check:changed` (`app/scripts/check-changed.mjs`). Compara contra main
  (o contra `HEAD~1` si la rama es main) y corre sólo lo afectado: tsc de la interfaz y de electron; los tests que importan
  lo cambiado (directo o por cadena de imports), lo nombran o escriben su ruta; la paridad de las herramientas del motor
  (o de su port en `electron/cli`) que cambiaron (`TRAMA_PARIDAD_HERRAMIENTA`); y `windows/` si tocó algo ahí. Corre todo si
  cambia `scripts/test.mjs`, `package.json`, los tsconfig o `vite.config.ts`, si toca `tests/paridad/`, o si cambia algo de
  `motor/` o `electron/cli/` que no está en su tabla. No reemplaza el chequeo completo de arriba antes de un commit a main:
  no corre `vite build` ni el smoke de `humo-motor.mjs`.
- **Cola de mensajes del líder (`app/electron/cola.ts`):** lo encolado con el líder trabajando sale TODO JUNTO en un solo mensaje
  (`juntar`), nunca uno por turno. Por defecto se entrega a mitad del turno, sin interrumpir, en el próximo límite de
  herramienta (`lider.mandarDirecto`, tras `AGRUPAR_MS` de agrupación); los motores sin ese canal (locales) lo entregan al
  terminar el turno. Ya no hay "Mandar ya" aparte: Ctrl+Enter es un Enter más. Detalle en `motor/docs/traspaso.md`.
- **Repo público:** nada de datos personales, de la red ni de la máquina del dueño en código, tests, fixtures ni docs.
  Los fixtures llevan ids, rutas y tareas inventados.

## Mapa rápido

- `app/`: Electron + React 19 + Vite + TS.
  - `app/electron/`: el proceso principal. IPC en `nucleo.ts`, `preload.cts` y `src/puente.ts`.
  - `app/src/`: la interfaz. Barra lateral en `src/barra/`, ajustes en `src/paneles/`, hilos en `src/hilo/`.
  - Tests con `node --test` (`app/scripts/test.mjs`, archivos en `app/tests/`).
  - Capturas sin abrir ventanas: `app/scripts/captura.sh <estado>` (estados en `Captura`, `src/modo.ts`; pide el build).
- `motor/`: `bin/pa` (bash, delega tareas a workers en worktrees), `bin/reparto` (python, elige modelo según calidad y
  cupo), `bin/tablero`, `bin/cuentas`, `bin/trama-estado`, hooks (`motor/hooks/*.mjs`), runner de OpenCode
  (`motor/opencode/`).
- CI: `.github/workflows/ci.yml`, trabajos `linux` y `windows`.
