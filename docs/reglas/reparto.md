# Reglas: reparto

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Del líder a los workers

- **Líder → workers:** se delega con `--tipo` y SIN `-m` ni `--effort` (los elige `reparto`); `-m` sólo con motivo (skill `trama-orquestar`). Si `reparto` falla,
el resultado del worker lo dice («— reparto NO eligió el modelo», archivo `<id>.reparto-fallo`).

## Perfil de reparto `agresivo`

- **Perfil de reparto `agresivo` (`PERFILES` en `motor/bin/reparto` y su par `app/electron/cli/reparto.ts`; el TS es el que corre por defecto, `TRAMA_REPARTO=py` fuerza el python):** gana el más barato (`costo` relativo: gratis 0, el resto el de su familia) entre lo que supera `minimo_por_tipo`,
que sigue siendo piso duro (no se relaja como en `ahorro`); el puntaje sólo desempata. Reserva del líder 0,35 como `ahorro`. Un modelo que no gasta cupo (local, dsh/OpenCode) sin historial propio sólo entra en `lectura`/`mecanico` hasta tener
5 corridas con dato y ≥ 50 % sin retrabajo en ESE tipo (medicion.tsv de los últimos 60 días, el mismo criterio de `pa --rinde`; `REPARTO_MEDICION` lo redirige en los tests); si no queda nada más, vuelve a entrar y el motivo lo dice. Flash
sólo lee. `rendimiento` y `equilibrado` dan lo mismo con ritmo normal: la banda de calidad (`PESO_SOBRA`, `PREFERIDO_POR_TIPO`) ya decide. `reparto --tipo --json` suma `perfil_info` y, por candidato, `costo` e `historial` (`{n, ok_pct}`) para la interfaz.
Con `ahorro` o `agresivo`, `pa` avisa por stderr al lanzar (`avisoPerfilAhorro` en `cli/pa/cli.ts`, `aviso_perfil_ahorro` en el bash) que el brief lleve pasos, archivos, «Listo cuando» y chequeo. Lo cubre `tests/reparto-agresivo.test.ts`.

## Política de modelos (2026-11-10, sólo en el TS)

- **`ahorro` exige historial como `agresivo`:** la misma función (`exigirHistorialSinCupo` en `app/electron/cli/reparto.ts`): un modelo que no gasta cupo (local, dsh/OpenCode) sin 5 corridas con dato y ≥ 50 % sin retrabajo en ESE tipo sólo entra en `lectura`/`mecanico` (si no queda nada más, vuelve a entrar). Pasaba que un gratis sin historial (minimax-m3.1-flash-free) tomaba `frontend`/`codigo-multi` sólo por pasar el piso de calidad. Cada candidato suma `historial`.
- **Mínimo de `diseno`:** `sonnet` (antes `argon`; medido: sonnet high 79 % ok a US$ 1,36).
- **Opus no arranca de cero en `frontend` ni `codigo-multi`** (`TIPOS_SIN_OPUS`; medido: US$ 5,7 por corrida y 12-26 % ok): se descarta como candidato en cualquier perfil. Sólo entra por `-m` o `--seguir`, que no pasan por `reparto --tipo`.
- El python de `reparto` está congelado y NO sigue esta política: los casos de paridad afectados llevan `divergenciaSalida` (`tests/paridad/casos-reparto.ts`) y `tests/reparto-agresivo.test.ts` corre sólo el TS en diseno/frontend/codigo-multi y en ahorro.

## Gemini 4 Neon (2026-11-18, sólo en el TS)

- **Neon va primero donde pesa la calidad:** `PREFERIDO_POR_TIPO` lo pone en `frontend`, `codigo-multi`, `diseno` y `debug` (`gemini-4-neon-high`, cupo del grupo `gemini`, el mismo de Hydrogen). Si no está en `agy models`, está excluido o no tiene cupo, la banda se suelta y decide el puntaje de siempre. Tampoco manda cuando Claude va por debajo del ritmo (`ritmo_pts > 0`): ese cupo se perdería. Argon sigue lanzable con `-m`, con `solo_final`. Puntajes de Artificial Analysis en `motor/datos/aa-suplemento.json`. Lo cubre `tests/reparto-neon.test.ts`.

## Perfil de reparto en el riel

- **Perfil de reparto en el riel (`app/src/barra/PerfilRiel.tsx`, datos en `src/datos/perfil-reparto.ts`):** el ícono bajo los anillos de cupos (`data-guia="perfil-riel"`, un ícono por perfil, nunca sólo color) abre un menú con los cuatro perfiles; elegir uno
guarda al toque en `modelos.json` por `guardarModelos` (relee lo guardado y cambia SÓLO `perfil`, así no pisa lo que Ajustes tenga a medio editar), sin barra de Guardar; si falla vuelve al anterior y dice el motivo. Vale para los workers nuevos (`reparto` lee el archivo
en cada lanzamiento). Riel y Ajustes se avisan con el evento `trama:perfil-reparto` (`EVENTO_PERFIL`): Ajustes lo escucha en `AjustesModelos.tsx` y avisa al guardar. Los textos de cada perfil son los de `cu.perfil*` (los mismos en Ajustes); el de `agresivo` tiene que decir lo que hace
`aplicarAgresivo` y el de `ahorro` lo que hace `aplicarAhorro` (`app/electron/cli/reparto.ts`). Captura `perfil-riel` (menú abierto). Lo cubre `tests/perfil-riel.test.ts`. Ojo: en un worktree dentro de `~/.local/state/pa/worktrees/` `npm run visual` falla en todos los casos (`aislar.ts` ve `motor/opencode/go-topes.mjs` como «de la persona»), también en `normal`.

## Un solo nombre por modelo al leer las mediciones

- **`canonico(modelo, effort)` (`app/electron/cli/pa/modelo-canonico.ts`)** se aplica AL LEER `medicion.tsv` en `pa --rinde` (`cli/pa/rinde.ts`), `rindeDeModelos` (`cli/reparto.ts`) y `leerMedicion`/`muestra*` (`cli/reparto-costo.ts`): alias corto (`sonnet`, `haiku`, `opus`, `fable`) → id completo; el effort pegado al nombre de agy (`agy:…`, `gemini-…`), codex y dsh pasa a la columna effort (el prefijo del motor queda); `settings`, `-` y "" son un solo effort; la cuenta de siempre (`claude`, `google`, `chatgpt`, `opencode`) no se muestra (de ahí salía el `@opencode`). `medicion.tsv` no se reescribe. El bash congelado agrupa crudo: los casos de `--rinde` de `tests/paridad/casos-medicion.ts` llevan `divergenciaSalida`. Lo cubre `tests/modelo-canonico.test.ts`.

## Las lecturas (`--leer`) cuentan por `bien`

- **`datoDeFila` (`app/electron/cli/pa/dato-medicion.ts`)** dice `dato` y `ok` de una fila de medicion.tsv; la usan `pa --rinde`, `rindeDeModelos` (`cli/reparto.ts`) y `cli/reparto-costo.ts`. Una fila con `leer=1` no se integra: su dato es la columna `bien` (`pa --bien <id> si|no|parcial`): `si` → dato y ok; `no`/`parcial` → dato y no ok; sin `bien` → sin dato. El aviso al líder de un worker de lectura que terminó (`textoParaLider`) trae la línea «¿Sirvió? `pa --bien <id> si|no|parcial`». El bash y el python congelados ignoran `bien` en las lecturas: divergencia a propósito. Lo cubre `tests/medicion-lectura.test.ts`.

## Datos de Artificial Analysis sin API key (2026-11-11, sólo en el TS)

- **Foto (`motor/datos/aa-foto.json`, `{fecha, modelos}`):** la saca `node app/scripts/aa-foto.mjs` de la caché del dueño (`<estado>/reparto/aa-modelos.json`), sólo con campos de datos (sin claves). Cuando no hay caché propia, `aaCargar` (`cli/reparto.ts`) usa la foto, mezclada con `aa-suplemento.json` como la caché; así `calidad_ef` tiene curva por effort sin clave. Con caché manda la caché. Con `REPARTO_AA` puesto la foto no se mira (salvo que `REPARTO_AA_FOTO=<archivo>` la nombre; `REPARTO_AA_FOTO=0` la apaga): los tests que fijan la caché no se mezclan con la del repo. Hay que volver a sacarla cuando se quiera refrescar (la caché se baja sola, la foto no). Viaja con el motor (`app/datos/` en Windows, la misma resolución por `path.join`). `--tabla` suma `aa_foto: true` a las filas que salen de ella y Ajustes > Modelos dice «Artificial Analysis · datos del 10/11 (sin clave)». Lo cubre `tests/reparto-aa-foto.test.ts`. El python congelado no la lee: sin caché, lo de siempre.

## Lecturas lentas en paralelo (2026-11-15, sólo en el TS)

- **`--tabla`, `--resumen` y `--cupos`** (los piden `ia-elegir-y-correr` y el panel del celu, que cortan a los 30 s) llaman antes a `leerEnParalelo` (`cli/reparto.ts`): lanza juntas `agy -p /quota`, `agy models`, `opencode models` y el `/api/tags` de ollama, sólo las que no tienen caché fresca, con topes cortos (8, 8 y 5 s; `REPARTO_AGY_S`, `REPARTO_AGY_MODELOS_ESPERA` y `REPARTO_OPENCODE_CHEQUEO_S` mandan si están puestos). Las funciones de siempre (`quotaAgy`, `modelosAgy`, `opencodeListado`, `dshOllamaModelos`) toman esa salida de `SALIDAS`/`SALIDAS_GET` en vez de lanzarla otra vez. El resto de los comandos (lo que usa `pa`) sigue en serie y con los topes de antes (40, 20 y 8 s). Si agy no contesta, `quotaAgy` usa la lectura de cupo de hasta 15 min (`REPARTO_CACHE_RESPALDO_S`) antes que dejarla sin dato. Medido en la PC del dueño: en frío ~5 s (lo pone el `/quota` de agy), en caliente 0,2 s, con agy colgado 8 s (antes 60 s). Lo cubre `tests/reparto-lecturas-paralelo.test.ts`. El python congelado sigue en serie.

## Costo por suscripción en «No conviene» (2026-11-19, sólo en Ajustes; el reparto no cambia)

- **Fuente:** `GET https://mypriors.com/api/plan-prices` (pública, sin clave). La baja el main (`electron/costo-planes.ts`) con `User-Agent: Trama` y ningún dato de la persona, la valida (`validarPriors`, en `costo-planes-texto.ts`, sin imports de Node) y la guarda en `<estado>/costo-planes.json` (6 h). Si falla, la caché vieja; sin nada, todo sigue con el precio de API. Es de terceros: nunca bloquea nada. El motor la refresca de fondo al arrancar y cada hora (como `alDiaAA`) y avisa con `reparto:tablaNueva` sólo si bajó algo nuevo. En pruebas y capturas no sale a la red salvo con `PRIORS_URL`.
- **Plan de cada persona:** el de Claude sale SÓLO de `claudeAiOauth.subscriptionType` y `rateLimitTier` de `~/.claude/.credentials.json` (`%USERPROFILE%\.claude\.credentials.json` en Windows): `pro` → Claude Pro, `max` + `*_max_5x` → Claude Max 5x, `max` + `*_max_20x` → Claude Ultra; lo demás, sin plan. Ningún otro campo de ese archivo se lee, loguea ni viaja. Google y ChatGPT se eligen en Ajustes > Plan y cupos (`planes` de `modelos.json`, p. ej. `{ "google": "Google AI Pro" }`); con `agy` y sin elección, Google AI Pro. Lo elegido gana sobre lo detectado.
- **Costo:** costo de AA del esfuerzo × `ratio` del plan (`costoDe`, `src/paneles/efforts-dominados.ts`). Sin ratio (sin datos, sin plan, modelo que no matchea o de otro lab) o sin costo de AA (la estimación por familia no se multiplica), queda lo de antes. Ids: sin prefijo de motor ni esfuerzo, y la versión con punto (`claude-opus-5-5` → `claude-opus-5.5`) o el slug de AA. La fila dice «Con tu plan (Max 5x): 1,3 % del precio de API» con la confianza de Priors en el tooltip, y el pie el crédito «Datos de planes: Priors». Lo cubre `tests/costo-planes.test.ts`.
