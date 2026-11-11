# Traspaso: estado de Trama al 27/10/2026

Para retomar el trabajo en otra sesión, con otra persona o con otra herramienta. Repo: `FeroxShark/trama`; se trabaja en una
rama y el dueño (Ferox) abre y mergea los PR desde la web de GitHub. `main` tiene una regla que impide borrarlo y reescribir su
historia (force push); se puede subir directo y mergear sin esperar el CI.

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
