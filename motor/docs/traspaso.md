# Traspaso: estado de Trama al 27/10/2026

Para retomar el trabajo en otra sesión, con otra persona o con otra herramienta. Repo: `FeroxShark/trama`; se trabaja en una
rama y el dueño (Ferox) abre y mergea los PR desde la web de GitHub. `main` tiene una regla que impide borrarlo y reescribir su
historia (force push); se puede subir directo y mergear sin esperar el CI.

## Cómo se trabaja (reglas del dueño)

- **Idioma:** todo en español rioplatense (código comentado en español, interfaz es + en).
- **Accesibilidad:** el dueño tiene deuteranomalía. Ningún estado puede depender sólo del rojo o el verde: siempre con palabra
  o ícono.
- **CSS:** sólo con los tokens que ya existen. i18n en `app/src/i18n/es.ts` y `en.ts`.
- **Claves y secretos:** nunca se pegan ni se loguean. Viven sólo en `~/.config/trama/claves.env`.
- **Windows:** nada de bash, WSL ni Git Bash, ni siquiera de respaldo (regla fija, ver `motor/docs/port-windows-plan.md`).
- **Cuentas:** no rotar cuentas de Claude ni de OpenCode para esquivar límites.
- **PR:** no se abren salvo que el dueño lo pida. Sin nombres de modelos de IA en commits ni en PR.
- **Antes de cada commit**, desde `app/`: `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p tsconfig.electron.json --noEmit`,
  `npx vite build`, `npm test`. Si se toca el motor que se está portando: `npm run test:paridad`.
- **Instalar en la PC del dueño** (Linux), desde la carpeta del repo:
  `git checkout main; git pull; bash motor/scripts/instalar-producto.sh`. Desde la app: el aviso "Hay una Trama nueva" hace lo mismo (ver Hecho).

## Qué es Trama (mapa rápido)

- `app/`: Electron + React 19 + Vite + TS. `app/electron/` es el proceso principal (IPC en `nucleo.ts`, `preload.cts`,
  `src/puente.ts`); `app/src/` es la interfaz (barra lateral en `src/barra/`, ajustes en `src/paneles/`, hilos en `src/hilo/`).
  Tests con `node --test` (`app/scripts/test.mjs`).
- `motor/`: `bin/pa` (delega tareas a workers en worktrees; el default es el pa de TS, ver Hecho abajo), `bin/reparto` (elige
  modelo según calidad y cupo), `bin/tablero`, `bin/cuentas` (estos tres también defaultean a TS), `bin/trama-estado`, hooks
  (`motor/hooks/*.mjs`), runner de OpenCode (`motor/opencode/`).
- CI: `.github/workflows/ci.yml`, trabajos `linux` y `windows`.

## Pendiente (en orden sugerido)

1. ~~Mergear `claude/elegant-sagan-gvgbq5`~~: ya está absorbida en `main` (rama borrada el 2026-11-10).
2. **Probar varias cuentas de OpenCode con un login real** (punto 2 de arriba) y confirmar la detección del plan con Go.
3. **Revisión completa de experiencia de usuario** antes de seguir sumando cosas: ver `motor/docs/ux-pendientes.md`.
4. **Port a Windows**, etapas 5 a 17 + W (prueba en un Windows real). Estimado: 3 a 5 días de agentes. Ideas a tomar del PR de
   Gonza ([FeroxShark/trama#1](https://github.com/FeroxShark/trama/pull/1), NO se mergea; tiene problemas de seguridad):
   terminal interactiva con `powershell -NoProfile -Command` y marca de rc (etapa 14), salud y hooks de inicio sin Git Bash
   (etapa 14), `windows/src/nativo.js` como esqueleto de la carcasa (etapa 15), listar skills de `~/.claude/skills`. Cuando
   esté la versión de Windows, avisarle a Gonza que la descargue.
5. **Confirmar los ids `opencode-go/*`** con `opencode models` cuando el dueño tenga Go contratado.
6. **AA:** ver si la API de AA trae costo, tokens y tiempo por esfuerzo para dejar de cargar la tabla a mano. Faltan en la tabla
   Gemini 3.8 Flash medium/low y GPT-6 Luna medium (sin costo), DeepSeek V4.1 Pro (no existe en AA) y GPT-6 Sol Daybreak (sin
   datos).

## Datos útiles

- **Ajustes > Locales (modelos locales detectados):** `app/electron/locales-deteccion.ts` mira (sin prender nada) llama.cpp, LM Studio,
  vLLM y Ollama: instalado / apagado / andando, sus modelos y la VRAM. La ventana lo pinta en `LocalesDetectados.tsx` (canal
  `locales:detectar`), con las guías de instalación de Linux y Windows (`locales-detectados.ts`). Prender y apagar el servicio de un modelo
  son los canales `locales:prender` / `locales:apagar` (sólo units de systemd que la detección encuentra; sólo con el clic, tras un aviso
  de que ocupa la GPU; no existen por la tailnet). **Falta en Windows:** no hay units, así que ahí Trama muestra y guía pero no prende ni
  apaga. «Usar como motor» agrega el modelo a los `locales` del borrador de Modelos con el arnés elegido (`ollama:<m>` = Claude Code,
  `dsh:ollama/<m>` = dsh) y se aplica con el Guardar de Modelos; OpenCode no va por acá (usa sus propios proveedores).
- Uso medido de OpenCode del dueño: ~200–250 pedidos por día. Go cuesta 10 USD/mes con topes equivalentes a ~80 USD de
  DeepSeek V4.1 Flash; conviene si lo usa todos los días.
- PR abierto de Gonza: #1 (rama `windows-nativo` del fork `MaxCuratAnima/trama`). El dueño se lo comunica él.
