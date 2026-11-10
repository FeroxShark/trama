# Reglas: internet-workers

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Internet en los workers

- **Internet en los workers:** `--leer` pasa `--tools` con lista cerrada (`HERRAMIENTAS_LEER` en `lanzar.ts`, espejo en `motor/bin/pa`); si se agrega una herramienta de Claude, va ahí o el `--leer` no la ve (WebSearch/WebFetch faltaban y no podía buscar). Un escritor no pasa `--tools`. Los hooks no filtran las web. codex corre con sandbox sin red y agy bloquea curl/wget por privacidad. agy en `--leer` sí busca y lee en internet con `search_web` (WebSearch) y `read_url_content` (WebFetch), permitidas en `motor/hooks/agy-pa.mjs` y `agy-pa.sh` sólo con `PA_AGY_MODO=leer` (espejo de `hooks-mjs.test.ts` y `paridad/casos-hooks.ts`); un escritor de agy no las tiene. El contrato de `--leer` (`txtLeer` en `lanzar.ts`) le pide decir si un hook le bloqueó una herramienta y no afirmar lo que no abrió.
