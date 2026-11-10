# Trama

App de escritorio para manejar los workers de `pa` (Electron + motor). El traspaso completo, con lo hecho y lo que
falta, está en `motor/docs/traspaso.md`.

Las reglas de cada área están en `docs/reglas/` (van enteras, sin resumir); la tabla de abajo dice cuál leer.

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
- **Sin consolas ni programas ajenos en Windows:** todo `spawn`/`execFile`/`fork` lleva `windowsHide: true` (en `app/electron`, `windows/src` y
`motor/**/*.mjs`; lo controla `tests/rutas.test.ts`, con la lista `aPropósito` de excepciones). Y Trama nunca ejecuta `ollama`
en Windows (su cliente puede abrir «Welcome to Ollama»): del servidor sólo se sondea el puerto y se mira `where`.
- **Binarios de terceros en Windows (`agy`, `claude`):** buscalos con `resolverAgy`/`resolverClaude` (PATH, `%USERPROFILE%\.local\bin`, prefijo de npm; puede ser `.exe` o `.cmd`) y lanzalos con `paraLanzar`, nunca `execFile`/`spawn` directo. Para detectar: `hallarAgy`/`hallarClaude` (null si no está); nada de `enPath("agy")` a secas (no ve el prefijo de npm ni `%LOCALAPPDATA%\Programs\Antigravity\bin`). En Linux el resolvedor también mira `/usr/bin/agy`: un test que quiera «agy ausente» inyecta el buscador. Ningún texto de la interfaz nombra Ubuntu ni WSL (la carcasa es siempre nativa). Lo controla `tests/cuentas-windows.test.ts`.
- **Cuentas:** no rotar cuentas de Claude ni de OpenCode para esquivar límites.
- **PR:** no se abren salvo que el dueño lo pida. Sin nombres de modelos de IA en commits ni en PR.
- **Novedades y CHANGELOG:** cada versión nueva va en los dos CHANGELOG (`CHANGELOG.md` y `CHANGELOG.en.md`), con las mismas viñetas y el mismo markdown.
- **Antes de cada commit**, desde `app/`: `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p tsconfig.electron.json --noEmit`,
`npx vite build`, `npm test`. Si se toca el motor que se está portando: `npm run test:paridad`.
- **Chequeo rápido para workers:** desde `app/`, `npm run check:changed` (`app/scripts/check-changed.mjs`). Compara contra main
(o contra `HEAD~1` si la rama es main) y corre sólo lo afectado: tsc, los tests que importan lo cambiado y la paridad de las
herramientas tocadas (nunca toda: eso es `--paridad-completa`). Imprime al empezar cuántos archivos corre y una estimación;
un archivo colgado sale con 124. Un solo test: `node scripts/test.mjs tests/x.test.ts`. Detalle: `docs/reglas/tests.md`.

- **Motor congelado:** el `pa` de bash (`motor/bin/pa`) y el `reparto` de python (`motor/bin/reparto`) están congelados
  desde 2026-11-10: sin funciones nuevas; corre el TS (`app/electron/cli`). `test:paridad` vale para lo ya portado.
- **Tests:** no esperan por reloj (`esperarHasta` de `app/tests/esperar.ts` o `mock.timers`); una ruta real de Windows
  (`os.tmpdir()`, `path.join`) nunca se mezcla con `plat: "linux"`. La regla entera: `docs/reglas/tests.md`.

## Si tocás… leé

| Si tocás | Leé |
|---|---|
| `app/src/barra/` | `docs/reglas/barra.md` |
| `app/src/hilo/`, `app/electron/cola.ts`, `app/electron/titulo-estable.ts`, `app/electron/actividad-lider.ts`, `app/electron/carpeta-auto.ts`, `app/electron/reemplazos.ts` | `docs/reglas/lideres.md` |
| `app/tests/`, `app/scripts/test.mjs` | `docs/reglas/tests.md` |
| `app/electron/cli/`, `motor/bin/`, `motor/hooks/` | `docs/reglas/procesos.md`, `docs/reglas/reparto.md`, `docs/reglas/internet-workers.md` |
| `app/src/paneles/LimpiarTablero.tsx`, `app/src/datos/tablero-*.ts`, `app/src/hilo/tablero-dejado.ts` | `docs/reglas/tablero.md` |
| `app/electron/proyectos-borrar.ts`, `app/src/paneles/AjustesLimpieza.tsx` | `docs/reglas/proyectos.md` |
| `app/electron/descubrir.ts`, `app/electron/plugins-claude.ts`, `app/electron/usos-historial.ts` | `docs/reglas/conectores.md` |
| `app/electron/tarea-salida.ts`, `app/src/hilo/Fondo.tsx` | `docs/reglas/fondo.md` |
| capturas, `pantalla`, `app/scripts/captura.sh` | `docs/reglas/pantalla.md` |

## Mapa rápido

- `app/`: Electron + React 19 + Vite + TS. `app/electron/`: el proceso principal. IPC en `nucleo.ts`, `preload.cts` y `src/puente.ts`. `app/src/`: la interfaz. Barra lateral en `src/barra/`, ajustes en `src/paneles/`, hilos en `src/hilo/`. Tests con `node --test` (`app/scripts/test.mjs`, archivos en `app/tests/`). Capturas sin abrir ventanas: `app/scripts/captura.sh <estado>` (estados en `Captura`, `src/modo.ts`; pide el build).
- `motor/`: `bin/pa` (bash, delega tareas a workers en worktrees), `bin/reparto` (python, elige modelo según calidad y
cupo), `bin/tablero`, `bin/cuentas`, `bin/trama-estado`, hooks (`motor/hooks/*.mjs`), runner de OpenCode
(`motor/opencode/`).
- `windows/`: carcasa nativa (instalador, servicio, ventana, canales, rutas, binarios).
- `docs/reglas/`: una regla por área, enteras: `docs/reglas/<área>.md`.
- CI: `.github/workflows/ci.yml`, trabajos `linux` y `windows`.
