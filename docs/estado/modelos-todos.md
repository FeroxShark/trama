# Todos los modelos en el selector del líder

Pedido de Ferox (2026-11-06): ver en el selector todos los modelos disponibles de cada empresa, no sólo los últimos.
La tabla única es `app/src/hilo/modelos.ts` (`tabla`, filas con `anterior: true`). Los últimos van primero; las
generaciones anteriores, debajo en la misma columna de Anthropic, bajo el divisor «Anteriores» (`modelo.anteriores`).
El buscador del selector las encuentra (busca por nombre, empresa y el divisor).

## De dónde sale cada uno (nada inventado, nada probado con un modelo real)

**Anthropic.** Del catálogo horneado del `claude` instalado (2.1.319): el JSON «Hand-maintained baked-in model catalog»
dentro del binario (`~/.local/share/claude/versions/2.1.319`, extraído con `strings`). De cada entrada se tomó `id`,
`display_name` y las capacidades `effort` / `max_effort` / `xhigh_effort`.

| id | nombre | esfuerzos | por qué |
|---|---|---|---|
| claude-fable-5 | Fable 5 | low…max (5) | `effort`, `max_effort`, `xhigh_effort` |
| claude-opus-5 | Opus 5 | low…max (5) | ídem |
| claude-opus-4-8 | Opus 4.8 | low…max (5) | ídem |
| claude-opus-4-7 | Opus 4.7 | low…max (5), arranca en xhigh | ídem; `default_effort: xhigh` |
| claude-opus-4-6 | Opus 4.6 | low, medium, high, max | `effort` + `max_effort`, sin `xhigh_effort` |
| claude-opus-4-5 | Opus 4.5 | ninguno | sin capacidad `effort` en el catálogo |
| claude-opus-4-1 | Opus 4.1 | ninguno | ídem |
| claude-opus-4-0 | Opus 4 | ninguno | ídem (se sirve como `claude-opus-4-20250514`) |
| claude-sonnet-5 | Sonnet 5 | low…max (5) | `effort`, `max_effort`, `xhigh_effort` |
| claude-sonnet-4-6 | Sonnet 4.6 | low, medium, high, max | `effort` + `max_effort` |
| claude-sonnet-4-5 | Sonnet 4.5 | ninguno | sin `effort` |
| claude-sonnet-4-0 | Sonnet 4 | ninguno | ídem (`claude-sonnet-4-20250514`) |
| claude-haiku-4-5 | Haiku 4.5 | ninguno | ídem (`claude-haiku-4-5-20251001`) |

Los ids son los de alias del catálogo (`claude --model <id>` los acepta). Un modelo sin esfuerzo no muestra selector
(`efforts: []`, igual que dsh/OpenCode). Quedan afuera a propósito: Claude 3 / 3.5 / 3.7 (viejos, el catálogo los trae
sólo para migrar ajustes) y Mythos 5 / 5.1 (el catálogo los marca con `deprecation`, no son para el selector común).
El catálogo no trae fechas de retiro, así que «sigue sirviéndose» es lo que el CLI instalado todavía acepta; un modelo
retirado por Anthropic daría error de la API al usarlo (no se probó ninguno para no gastar cupo).

**Google (`agy`).** `agy models` (sin gastar nada) lista exactamente lo que ya estaba en `GEMINI`: Gemini 4 Argon, Gemini
3.8 Flash, Claude Opus 5.5, Claude Sonnet 5.5 y GPT-OSS 120B. No hay generaciones anteriores que sumar. El selector ya
muestra lo que ofrece cada cuenta (`agyDeCuenta`), así que si `agy` suma modelos aparecen solos.

## Workers y `pa`

Los anteriores son `soloLider: true`: no entran en `MODELOS_WORKER` (ni el inicial ni el de `aplicarModelos`), así que
`pa -m` y `reparto` nunca los reciben. `reparto` no los conoce y su tabla no cambió. El default sigue siendo Opus 5.5.

## Reconocer el id de un hilo

`porClave` (en `modelos.ts`, lo usan `defDe` y `modeloDe`): entre las filas cuya clave está dentro del id, gana la más
larga; una clave de id entero (`claude-opus-5`) no vale si sigue otro número de versión (`claude-opus-5-5`), pero sí si
sigue una fecha (`claude-opus-4-1-20250805`). Test: `app/tests/modelos.test.ts`.
