# Plan: líder + orquestador, presets de skills y avances en vivo

Diseño pedido por Ferox (2026-11-26) para bajar consumo de cuota, evitar que los workers carguen skills que no usan y tener avisos cortos mientras el líder trabaja.

## 1. Presets de skills por tipo de worker (Fase 1 — mayor ahorro directo)

### Problema hoy
- `apagados.json` (`app/electron/apagados.ts`) es **global**: una skill está prendida o apagada para todos los líderes y todos los workers.
- Cada worker que hace backend, tests o arreglos mecánicos igual carga el catálogo completo de skills (~8,5k tokens por llamada en las mediciones de esta semana: diseño, marketing, presentaciones, etc.).

### Diseño
- Archivo nuevo `<configTrama>/presets.json` (editable en Ajustes > Contexto / Presets, con defaults de fábrica):
  - `minimo` (default para `mecanico`, `lectura`): sin skills de diseño ni orquestación; sólo las indispensables de edición/verificación si hubiera.
  - `codigo` (default para `codigo-acotado`, `codigo-multi`, `debug`): apaga `ui-ux-pro-max`, `taste-skill`, `stageshow`, `diseno` y las de orquestación (`trama-orquestar`, `ferox-orquestar`).
  - `diseno` (default para `diseno`, `frontend`): habilita `ui-ux-pro-max`, `taste-skill` (y `stageshow` si aplica); apaga el resto que no corresponda.
  - `orquestador`: habilita `trama-orquestar` / `ferox-orquestar` y apaga skills de implementación de UI.
  - `todo`: respeta sólo `apagados.json` global (comportamiento actual).
- **Flag y MCP**:
  - `pa <proyecto> --tipo <tipo> [--preset <nombre>] "<tarea>"`: si no se pasa `--preset`, se infiere de `--tipo`.
  - `lanzar_worker` en `app/electron/cli/mcp-trama.ts` acepta `preset?: string`.
- **Aplicación por motor (Linux y Windows, sin pisar workers en paralelo)**:
  - **Claude Code (`app/electron/cli/pa/lanzar.ts`)**: cruza `skillsClaude()` con el preset y agrega el `skillOverrides` calculado al `--settings` temporal de esa corrida (sumado sobre `apagados-claude.json`, nunca mutando el global).
  - **Codex (`app/electron/cli/pa/otros-motores.ts`)**: `CODEX_HOME` por corrida en un directorio temporal con enlaces (junctions en Windows) a `auth.json` y `config.toml` y una subcarpeta `skills/` con sólo las skills del preset.
  - **OpenCode**: mismo esquema con `XDG_CONFIG_HOME` por corrida (ya aísla `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`).
  - **agy (Gemini)**: hoy lee `~/.gemini/config/skills` fijo. Mientras `agy` no admita carpeta de skills por proceso, queda con `apagados.json` global y `pa` deja constancia en el log del worker (sin mutar la carpeta global para no romper corridas paralelas).

## 2. Avances en vivo y advisors sin herencia (Fase 2 — cambio acotado)

### Avances en vivo (como hace Codex)
- Trama ya muestra en vivo los mensajes intermedios de Claude, Gemini y Codex (el stream emite bloques antes del `result`). La diferencia es sólo que Claude suele encadenar herramientas en silencio y recién hablar al final.
- Agregar una regla breve en `lineaSistemaLider` (`app/electron/terminal-agentes.ts`) y en el prefacio de Gemini/Codex:
  - En tareas de varios pasos o al lanzar workers, emitir 1 línea corta con cada hallazgo concreto o worker lanzado ni bien ocurre, sin repetirlo al cierre.
  - Configurable en Ajustes (prendido por defecto; si la persona quiere silencio total, lo apaga).

### Advisors por rol sin herencia automática
- En `modelos.json`, mantener tres niveles independientes:
  - **Líder**: usa `advisor` de líder (opcional; hoy `{ "sonnet": "opus" }`).
  - **Orquestador**: su propio `advisor` (opcional, ej. Opus → Fable).
  - **Workers**: **sin advisor por defecto** (`--advisor` en `pa` y `advisor?: string` en `lanzar_worker` sólo cuando el orquestador lo pida explícitamente para un worker difícil, y sólo en Claude oficial).
- Evita que subagentes o workers baratos disparen relecturas de contexto completo en el advisor sin motivo.

## 3. Líder conversacional + Orquestador potente (Fase 3 — detrás de opción en Ajustes)

### Roles
1. **Líder conversacional («traductor»)**: modelo liviano (Sonnet / Hydrogen / Sol) con el que hablás en el chat. Entiende el pedido, guarda tus decisiones y restricciones explícitas, y prepara el encargo.
2. **Orquestador**: modelo potente elegido en Ajustes (Fable / Opus / Neon / Astra). Recibe un **encargo acotado** (objetivo, restricciones textuales del usuario, archivos clave y criterio de verificación — nunca el chat entero), puede cuestionar el camino y lanza workers con `--tipo`, `--preset` y (si hace falta) `--advisor`.
3. **Workers**: ejecutan tareas chicas y verificables con el preset mínimo que necesitan.

### Comunicación, revisión previa y contexto
- Herramienta nueva en el MCP de Trama (`app/electron/cli/mcp-trama.ts`): `encargar_orquestador({ proyecto, objetivo, restricciones, verificacion, id? })`.
- **Revisión previa antes de lanzar workers**:
  - Antes de abrir worktrees o delegar código, el orquestador evalúa el encargo frente al estado real del proyecto.
  - Si detecta un problema con lo pedido, ambigüedad o una alternativa claramente mejor, frena antes de ejecutar y devuelve al líder conversacional un estado `consulta` / `propuesta` (qué vio, opciones concretas y qué recomienda).
  - El líder se lo traslada a la persona; cuando decide, el líder retoma ese mismo `id` del orquestador con la respuesta y recién ahí el orquestador lanza los workers.
- **Contexto por tarea**:
  - Sin `id`: abre un orquestador limpio (sólo índice del proyecto + el encargo).
  - Con `id` (corrección o seguimiento sobre la misma tarea): retoma ese orquestador mientras esté activo/caliente; si la caché venció, arranca uno nuevo con resumen corto.
- Si al orquestador le falta información del usuario, responde con preguntas concretas al líder conversacional (no adivina requisitos).
- Todo configurable en Ajustes > Modelos / Orquestación (apagado por defecto hasta validarlo en uso real comparando consumo y calidad frente a líder directo sobre las mismas tareas).
- **Límite de contexto por rol (para todos los modelos, no sólo Claude):**
  - Separar «Contexto antes de compactar» en tres roles: **Líder**, **Orquestador** y **Workers** (aplicable a Claude, Gemini y demás motores compatibles).
  - Para **Orquestador** y **Workers**, ofrecer **presets rápidos** (ej. Ahorro / Equilibrado / Profundo) para que el orquestador gestione automáticamente el límite de contexto de cada worker según el encargo, sin obligar a la persona a ajustar cada modelo de worker a mano.

## Orden sugerido y validación
1. **Fase 1 (Presets de skills)**: `presets.ts` + `pa --preset` + `mcp-trama` + UI en Ajustes + tests en Linux y Windows. Medir tokens fijos de workers antes/después.
2. **Fase 2 (Avances en vivo + `--advisor` explícito en `pa`)**: cambio chico con tests de `terminal-agentes`, `pa` y `mcp-trama`.
3. **Fase 3 (Orquestador)**: implementar `encargar_orquestador` + configuración por rol en Ajustes + prueba controlada comparando 3–5 tareas reales con y sin orquestador.
