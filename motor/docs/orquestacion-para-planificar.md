# Orquestación en Trama: cómo funciona hoy (para diseñar un protocolo por fases)

Este documento es para un Claude sin acceso a la PC. Describe EXACTAMENTE lo que existe hoy (comandos, flags, códigos de salida, límites, datos medidos). El dueño te va a pedir un **protocolo de orquestación**: partir el trabajo en fases (análisis, investigación, plan, implementación, verificación) para que modelos chicos y baratos (Haiku, Gemini Flash, modelos gratis de OpenCode) den mejor resultado que un modelo grande solo. El plan tiene que ser realizable sobre lo que existe; lo que falte, marcalo como "hay que agregar". Todo lo que sigue sale del código y de los logs reales de una instalación (~, 2026-10-27); los datos numéricos son de esa instalación.

---

## 1. Qué es Trama y los roles

Trama es una app de escritorio (Electron) más un **motor** de shell/python (`motor/bin/`) que reparte trabajo de programación entre varios modelos y suscripciones.

| Rol | Qué es | Dónde corre | Qué hace |
|---|---|---|---|
| **Líder (jefe)** | Una sesión de Claude (hoy Opus 5.5, effort low según `modelos.json` `lider`) | En `~`, sin código de proyecto | Entiende el pedido, escribe el brief, lanza workers, lee resultados, verifica, integra. No lee el código del proyecto para contestar: delega. Skill: `motor/skills/trama-orquestar`. |
| **Worker** | Un modelo (Claude, Gemini, opencode, dsh, ollama) lanzado por `pa` | Dentro del proyecto, en un **worktree git y rama propios** (`pa/<proyecto>/<id>`) | Hace UNA tarea, commitea en su rama, responde con un bloque corto. No puede preguntar (headless). Carga el `CLAUDE.md`/`AGENTS.md` del proyecto. |
| **Subagente** | Herramienta `Agent` de Claude Code dentro de la sesión del líder (o de un worker Claude) | Dentro de la misma sesión | Fan-out de lectura/búsqueda sin ensuciar el contexto del líder. Hoy no tiene rama, ni medición en `pa --rinde`, ni elección de modelo por `reparto`. |

Piezas del motor:

- `pa` (`motor/bin/pa`, bash, ~6000 líneas): lanza, vigila, mide e integra workers.
- `reparto` (`motor/bin/reparto`, python): decide modelo+effort según tipo de tarea y cupo.
- `tablero` (`motor/bin/tablero`): lista de pendientes/decisiones del dueño (las DECISION de los workers entran solas).
- `~/.config/trama/modelos.json`: configuración (perfil, exclusiones, mínimos por tipo, efforts permitidos).
- Hooks (`motor/hooks/`): `destructive-guard` (bloquea comandos catastróficos aun con permisos saltados), `docker-guard`, `latido`, `agy-pa`, `statusline-espejo`. Los workers tienen bloqueados `git stash` y `git add -A`.
- `~/.local/state/pa/<proyecto>/`: un `.log` por corrida, JSON completo, `medicion.tsv` (alimenta `pa --rinde`), `lecciones.md`, `integradas.tsv`.

Regla del líder: sesión **en `~`** delega con `pa`; sesión **dentro de un proyecto** hace la tarea sin delegar.

---

## 2. Ciclo de vida de un worker, de punta a punta

### 2.1 Brief
`pa --brief` imprime la plantilla; se pasa con `--brief-archivo F` (o entre comillas simples, porque con dobles el shell ejecuta los backticks):

```
Objetivo:       qué tiene que quedar distinto (1-2 oraciones)
Archivos:       rutas donde trabajar y qué leer primero
Listo cuando:   criterio observable de terminado
Cómo verificar: comando exacto y qué salida esperás
No tocar:       lo que no se cambia
```
Sin "Listo cuando" o "Cómo verificar", `pa` avisa por stderr (no bloquea).

### 2.2 Lanzar
```
pa <proyecto> --tipo <tipo> "<tarea>"              # primer plano; escribe
pa <proyecto> --async --tipo T --brief-archivo F    # desacoplado; imprime el id (o EN COLA)
pa <proyecto> --leer --tipo lectura "<pregunta>"    # sólo lectura; NO toma puesto ni lock
pa <proyecto> -m <modelo> --effort <e> ...          # fija modelo (gana siempre sobre reparto)
pa <proyecto> --aca "<t>"                           # en el tree principal, no en worktree
```
- `--tipo` ∈ `mecanico | lectura | codigo-acotado | codigo-multi | frontend | diseno | debug | final`. Obligatorio por convención: alimenta `pa --rinde`.
- Tipos y su uso (skill): `codigo-acotado` código bien definido con criterio de listo; `codigo-multi` varias partes (partirlas); `frontend`; `debug` bug sin pista; `diseno`; `lectura`; `mecanico` con chequeo determinista.
- Topes por corrida: `--max-turns N` (default 150; plan pro 100; al llegar se auto-cierra con resumen o sale 78), `--max-budget-usd N` (sólo Claude).

### 2.3 Puestos, cola y aislamiento
- `PA_PUESTOS` (default 3): workers que **escriben** en paralelo por proyecto, cada uno en su worktree/rama. Lanzar con `PA_PUESTOS=8` si se quieren más (el dueño lo prefiere a encolar).
- `PA_TOPE` (o `~/.local/state/pa/tope`; default 10): tope global de workers vivos entre todos los proyectos. Lleno: primer plano sale 75; `--async` queda EN COLA y arranca solo.
- Los `--leer` no toman puesto pero sí cuentan para `PA_TOPE`.
- El worker **no ve** lo sin commitear del tree principal (pa avisa: "El worker no los ve: trabaja aislado en su worktree").
- Si el worktree no se puede preparar: sale 87 (nunca cae al tree principal).

### 2.4 Esperar
```
pa --esperar <proyecto> [--timeout N] [--id ID]   # entrega el resultado más viejo no entregado, o bloquea
pa --esperar-todos [--timeout N]                  # cobra todas las async pendientes, de todos los proyectos
pa --estado                                       # qué corre, sesiones guardadas, sin verificar, NECESITA-PODA
pa <proyecto> --matar [--id ID | --leer]          # bajar workers
```
Lo que vuelve por stdout es sólo el resultado corto; el JSON completo queda en `~/.local/state/pa/<proyecto>/`.

### 2.5 Formato de salida (el "contrato")
`pa` inyecta un contrato a todo worker. La respuesta final es:

```
RESULTADO: 1-3 oraciones de qué hizo o encontró (los supuestos van acá).
ARCHIVOS: rutas tocadas, o "ninguno".
VERIFICACION: comando(s) corridos y 2-6 líneas REALES de su salida (o "ninguna").
DECISION: qué tiene que decidir el dueño, o "nada".
SIGUE: próximo paso, o "nada".
(opcional, al final) bloque de pregunta con opciones; PROBAR: <qué mirar, en palabras simples>
— N turnos · Ns · US$X · K compactación(es)
— rama pa/<proyecto>/<id>: N commit(s) sobre <sha>. NO está en main hasta que la integres.
```
- DECISION sólo para rumbo (publicar, borrar, plata, alcance); lo técnico es supuesto en RESULTADO. Las DECISION entran solas a `tablero`.
- PROBAR sólo si exige algo que el worker no tiene (hardware, ojo humano). Nunca comandos.
- Si el bloque falta: sale 78 ("terminó sin RESULTADO"); se cierra con `--seguir --id`.
- A agy/codex/dsh/opencode el contrato les suma el contenido de `AGENTS.md` (o `CLAUDE.md`), tope 20000 caracteres (`PA_AGENTS_MAX`). `opencode` y `deepseek` son remotos: `pa` no les manda la ficha del proyecto ni el CLAUDE.md del dueño.

### 2.6 Verificar e integrar
```
pa <proyecto> --auditar <id|rama> [-m M]    # revisor sólo lectura del diff vs main; CRITICO/ALTO/MEDIO/BAJO
pa <proyecto> --integrar <id> [--tests]     # rebasea sobre main y hace fast-forward; --tests corre el `tests` del registry antes (rojo: 93)
pa <proyecto> --actualizar <id>             # si --integrar chocó (80): un worker rebasea la rama y resuelve conflictos
pa <proyecto> --seguir --id ID "<t>"        # retomar esa corrida (misma rama/puesto)
pa <proyecto> --ramas                       # ramas sin integrar
pa <proyecto> --revertir <id>               # git revert de una integración (nunca reescribe historia)
pa <proyecto> --descartar <id>              # BORRA la rama: confirmar con el dueño antes
pa --bien <id> si|no|parcial ; pa --bien-auto ; pa --rinde [--dias N] [--json]
pa <proyecto> --leccion "<texto>"           # lección corta (tope 30 líneas/3000 chars) inyectada a futuros workers
```
Flujo fijo: tarea -> leer RESULTADO + VERIFICACION -> (auditar si es importante) -> `--integrar`. Una VERIFICACION "SIN VERIFICAR" no se da por buena: pedir evidencia con `--seguir --id` o correr el chequeo uno mismo. Un worker que **compactó** ya no sabe bien qué tocó; `--seguir` se niega sobre una sesión compactada (`--force` lo saltea). Si pasaron más de `PA_CACHE_FRIO_MIN` (55) minutos, `--seguir` arranca sesión nueva en el mismo puesto y rama.

### 2.7 Códigos de salida
`0` ok · `1` el worker falló (no relanzar a ciegas) · `2` uso (también `max` sin `--ok-dueno`, fable) · `75` puesto/tope ocupado (o `--esperar` agotó timeout) · `76` límite de sesión de la suscripción · `77` API sobrecargada · `78` sin RESULTADO · `79` `--integrar` se niega por archivo sin commitear del dueño que la rama toca · `80` choque al rebasear (-> `--actualizar`) · `82` la corrida murió sin resultado · `83` symlink peligroso · `86` el worker dejó trabajo sin commitear · `87` no hay worktree · `88` sesión contra modelo local · `89/90/91` problemas de `--revertir` · `92` corrida viva · `93` `--tests` en rojo · `95` modelo local/dsh/opencode no disponible (sin binario, sin key, Ollama caído) · `96` sin cupo y `sin_cupo=fallar` · `130` matado.

### 2.8 Ejemplo mínimo con dos fases
```sh
# Fase "investigar": Haiku, sólo lectura, barato
pa trama --leer --tipo lectura -m claude-haiku-5-5 --effort xhigh \
  'Objetivo: listar dónde se calcula X. Archivos: app/src/barra/. Listo cuando: lista archivo:línea. Cómo verificar: grep -rn X app/src/barra. No tocar: todo.'

# Fase "implementar": brief armado por el líder con lo hallado
pa trama --async --tipo codigo-acotado --brief-archivo /tmp/brief-x.md   # imprime ID
pa --esperar trama --id <ID> --timeout 1800
pa trama --integrar <ID> --tests        # 80 -> pa trama --actualizar <ID> ; luego --integrar de nuevo
```

---

## 3. Modelos disponibles

`reparto --tabla` (`--json`) es la fuente. "Índice AA" = Índice de Inteligencia general de Artificial Analysis, sin calibrar (el que `reparto` usa como `calidad`). Valores de esta instalación; `~` = estimado por nombre. Pasar a `-m` el id tal cual.

| Id para `-m` | Motor / cupo | Índice AA | Costo | Notas medidas / conocidas |
|---|---|---|---|---|
| `claude-opus-5-5` (`--effort low..xhigh`; permitidos: medium, high) | claude, suscripción; cupo 5 h y 7 d | 53.6 | alto (~1.7 a 5 US$/corrida a precio de lista) | Mejor en `medium` que en `high`. Para bases críticas, bug sin pista o tras un fallo. |
| `claude-sonnet-5-5` (sólo `high` permitido) | claude | 46.8 | ~1 a 1.5 US$/corrida | El caballo de batalla: iguala o supera a Opus en codigo-multi/frontend/debug por ~1/4 del costo. Compacta en ~50 % de corridas grandes. |
| `claude-haiku-5-5` (medium..max; default `xhigh`) | claude | 37.8 | ~0.15 a 0.5 US$/corrida | Alcanza para lectura/mecanico y, con test automático, codigo-acotado (51 % integrada sin retrabajo en 67 corridas, contra 52 % de Opus medium y 38 % de Sonnet high en la misma categoría). Compacta en 36 % de codigo-acotado: tarea chica. Límite práctico ~40 KB de lectura. |
| `gemini-4-argon-{low,medium,high}` | agy, Google AI Pro (cupo 5 h + 7 d propios) | 52.6 | cupo, 0 US$ | Casi Opus. Pocas corridas medidas en código, resultados flojos (0 % ok en las pocas). Bueno para segunda opinión `--leer` y contexto largo (1M tokens). |
| `gemini-3.8-flash-{low,medium,high}` | agy, Google AI Pro | 40.9 | cupo, 0 US$ | Barato y rápido, pero deja trabajo a medias y sube de turnos (150+ en tareas de código, 0 % ok en 3-4 corridas). Sólo `lectura`/`mecanico` con chequeo. |
| `agy:claude-{opus,sonnet}-5-5-{low,medium,high}` | Claude por Google (cupo 7 d aparte) | 53.6 / 46.8 | cupo Google | Mismo modelo, otro cupo. Pocas corridas; ok% bajo en la muestra. |
| `agy:gpt-oss-120b-medium` | Google | 38.7 | cupo Google | **Excluido** en `modelos.json`: no sigue el contrato. |
| `opencode:opencode/deepseek-v4.1-flash-free` | programa `opencode`, gratis, login OpenCode Console | 40.1 | gratis | Corta por límite de uso (log real: "OpenCode cortó por límite de uso"). Effort = `--variant`. |
| `opencode:opencode/glm-5.3-flash-free` | idem | 41.8 | gratis | Hoy es lo que `reparto` elige para mecanico/codigo-acotado por perfil ahorro. Mismos cortes de límite. |
| `opencode:opencode/mimo-v2.6-flash-free` | idem | 37.9 | gratis | Elegido hoy para `lectura`. |
| Excluidos en `modelos.json`: `beam-free`, `flint-40b-free`, `nemotron-3.5-lightning-free` (12.9), `nemotron-3-ultra-free`, `nemotron-3.5-super-vl-free`, `big-pickle` | opencode | 37 a 43 | gratis | No usarlos. |
| `dsh:{ollama,opencode,deepseek}/<modelo>` | DeepSeek Harness; deepseek paga con key en `~/.config/trama/claves.env` (nunca imprimirla); gratis de opencode por dsh dan 429 | estimado | gratis/pago | Sin effort, sin `--seguir`, `--leer`, `--mcp`, `--aca`, `--max-budget-usd`. Sale 95 si falta binario/key/servidor. |
| `ollama:<modelo>` | local (llama.cpp/Ollama) | estimado | gratis | **Ocupa toda la VRAM de la GPU: pedir permiso al dueño.** Sólo mecanico/lectura. Sin effort. Servidor caído: 95. |
| `codex:{gpt-6.1-sol,...}` | ChatGPT | - | cupo | `pa` documenta `-m codex:...` pero el skill dice que todavía no lo lanza. |
| `fable` | Claude | - | 2,5x Opus | Excluido: no vale su precio; sólo con `--ok-dueno`. |

Cupos (leídos con `reparto --cupos` / `pa --cupo-gemini`): Claude oficial (ventana 5 h y 7 d, compartida con la conversación del líder); Google AI Pro con tres bolsas separadas (Gemini, "Claude y GPT por Google", Gemini 4 Argon, cada una con su 5 h/7 d); OpenCode sin lectura de cupo (no se reparte por cupo, se cae por error); Ollama sin cupo, con costo de GPU. Ejemplo real de agotamiento (log de agy): `RESOURCE_EXHAUSTED (code 429) ... Resets in 126h12m16s`.

Uso de efforts: effort no es inteligencia, es cuánto explora y verifica (más turnos, más gasto). `efforts_permitidos` en `modelos.json` limita qué efforts se usan; `max` sólo con `--ok-dueno`.

Datos medidos de `pa --rinde` (30 días; ok% = integrada sin retrabajo): codigo-acotado Haiku xhigh 51 % (n=67, 0.24 US$, 36 % compactó) · Opus medium 52 % (n=71, 1.73 US$) · Sonnet high 38 % (n=108, 0.99 US$). frontend: Sonnet high 30 % (n=268, 1.55 US$), Opus high 24 % (n=38, 5.03 US$), Haiku xhigh 56 % (n=19, 0.49 US$, 68 % compactó). debug: Sonnet high 37 %, Haiku xhigh 60 % (n=5). codigo-multi: Sonnet high 32 %, Opus high 18 % (82 % compactó). **Lectura honesta: ningún modelo pasa de ~50-55 % de integrada sin retrabajo; la muestra de Haiku por tipo es chica y la tasa depende de cuánto estaba partida la tarea.**

---

## 4. Cómo se elige modelo hoy y sus problemas

1. `-m` explícito siempre gana.
2. Sin `-m`, `pa` le pregunta a `reparto --tipo T`, que arma candidatos de todos los motores disponibles y puntúa:
   - **Calidad mínima por tipo**: cada tipo exige un índice AA mínimo ("haiku"/"sonnet"... valen el índice de esa familia al esfuerzo del tipo). `modelos.json` `minimo_por_tipo` hoy: `codigo-acotado: haiku`, `frontend: sonnet`, `codigo-multi: sonnet`. `tipos_poco_importantes`: lectura, mecanico, codigo-acotado.
   - **Cupo**: prefiere planes que se reinician pronto con cupo sin usar (se pierde si no se gasta), penaliza los casi agotados.
   - **Ritmo semanal** (usado/esperado por ventana de 7 d, ponderado por días de trabajo; `pa --plan ausente|gastar-hoy|ahorrar-hoy|ver`): pasarse del ritmo resta puntos.
   - **Perfil** (`modelos.json` `perfil`): `ahorro` (hoy: workers a gratis/Google casi siempre, Claude sólo si nada llega o va atrasado, `reserva_lider` guarda parte de la semana de Claude para el líder) | `equilibrado` | `rendimiento`.
   - **Carga**: reparte entre grupos con menos workers vivos.
3. Si el modelo elegido no tiene cupo: `sin_cupo` = `otro` (relanza con el siguiente candidato, preferiblemente otra cuenta del mismo proveedor), `esperar` o `fallar` (sale 96).
4. Si `reparto` no responde: `modelos.json` `workers.<tipo>`, luego defaults de `pa` (`claude-sonnet-5-5 high`; `claude-haiku-5-5 xhigh` para `mecanico`).
5. `pa --modelos` muestra el resultado efectivo por tipo; hoy: mecanico/codigo-acotado -> `opencode:...glm-5.3-flash-free`, lectura -> `mimo-v2.6-flash-free`, codigo-multi/frontend -> Sonnet high, diseno/debug/final -> Opus high.

### Problemas conocidos
- **Incidente real**: un frontend chico fue a Opus (caro, 5 US$ de media) porque el tipo `frontend` tiene un mínimo de calidad "sonnet" y, con el perfil y cupo de ese momento, el puntaje terminó en Opus. La tabla tipo -> calidad mínima no distingue una tarea chica y bien guiada de una enorme: clasifica por TIPO, no por tamaño ni riesgo.
- **El dueño quiere** que **el líder elija el modelo** (conoce el tamaño y el riesgo de la tarea) y que se use **más Haiku bien guiado**: tarea partida chica, brief explícito y un chequeo determinista que pueda desmentirlo, escalando sólo si el chequeo falla. Hoy eso exige que el líder pase `-m` a mano, saltándose todo `reparto`.
- Los gratis de OpenCode se cortan por límite de uso en cualquier momento (logs reales), y `reparto` no tiene lectura de cupo de OpenCode: sólo se entera cuando falla.
- La señal de calidad es un índice general (AA), no mide "sigue un contrato de salida" ni "termina lo que empezó"; por eso Flash y GPT-OSS puntúan parecido a Haiku y rinden peor en práctica.
- Rutas de modelos en `reparto`/`modelos.json` pueden contradecir las del `CLAUDE.md` del dueño (el CLAUDE.md dice "ante la duda Haiku"; el perfil `ahorro` manda a gratis; los mínimos mandan a Sonnet). Hay tres fuentes de verdad.

---

## 5. Restricciones duras

**Suscripción y facturación**
- Ahorro de suscripción: modelo y effort mínimos que alcancen; Opus sólo para bases de las que cuelga lo demás, bug sin pista, tarea enorme/crítica o tras un fallo de chequeo; sin xhigh/max sin motivo. `max` fuera de Haiku y cualquier fable sale 2 salvo `--ok-dueno`. Fable sólo con OK explícito.
- **El `claude` oficial nunca lleva `ANTHROPIC_API_KEY`** (dispara créditos extra). Otros caminos (agy con Claude/Gemini por el cupo de Google, Ollama local, opencode gratis, dsh) están permitidos. En agy, compartir datos para mejorar el producto: apagado.
- Los workers Claude gastan el mismo cupo semanal que el líder; el perfil `ahorro` lo protege con `reserva_lider`.
- Haiku: tablas de efforts permitidos medium..max; Haiku compacta a ~100k de contexto (el resto a 180k: `PA_AUTOCOMPACT`).

**Seguridad**
- Destructivo o irreversible (borrar, formatear, `push --force`, desinstalar, `pa --descartar`): confirmar con el dueño ANTES. El hook `destructive-guard` bloquea lo catastrófico y no se rodea.
- Nunca suspender la PC; nunca matar procesos por patrón amplio; nada en la GPU sin avisar; modelo local pide permiso.
- MCP (Gmail, navegador): leer libre; mandar/borrar/publicar, confirmar. Los workers corren con MCP apagados salvo `--mcp`.
- Snapshot de snapper antes de un cambio de sistema; `sudo` lo corre el dueño.
- Las claves (p. ej. DeepSeek) viven en `~/.config/trama/claves.env`: nunca pedirlas ni imprimirlas.
- Release e instalaciones (`cargo --release`, `tauri build`, `npm i -g`) las hace el líder en el árbol principal después de integrar; no se delegan. Nada de líneas de atribución en commits/PRs.

**Chequeos antes de integrar**
- Leer RESULTADO y VERIFICACION (comando + salida real). Sin verificar: no se integra, se pide evidencia.
- `--integrar <id> --tests` corre el `tests` del registry sobre la rama rebaseada (rojo: 93). Para cambios importantes: `--auditar` antes.
- `--integrar` se niega con 86 si el worker dejó trabajo sin commitear, con 79 si pisa un archivo sin commitear del dueño, con 80 si el rebase choca.
- Lo dependiente no va en paralelo: esperar A -> integrar A -> lanzar B.

**Contexto**
- Máximo ~40 KB de lectura por Haiku (con más se queda sin contexto); lo que devuelven se verifica con un script. Abanico de hasta ~10 Haikus en paralelo, un pedazo cada uno, cuando muchos intentos verificables valen más que uno pensado; no para diseño ni decisiones.
- Lectura grande (más de ~40 KB): Sonnet high.
- Debajo de ~70 en la escala vieja (46 en AA) `pa` avisa y el brief debe tener pasos numerados, comandos explícitos, un archivo o área por tarea.
- Una tarea, un `pa`; cada `pa` arranca sesión limpia. Seguimientos cortos con `--seguir --id`.

**Aislamiento y conflictos**
- Cada worker escribe en su worktree/rama; ninguno toca main hasta `--integrar`.
- Si dos corridas sin integrar tocan el mismo archivo, `pa` lo avisa en el pie ("la corrida X (sin integrar) también toca ...: la que se integre segunda puede chocar"). Archivos calientes en los logs reales: `app/src/i18n/{en,es}.ts`, `index.css`, `puente.ts`, `nucleo.ts`, `docs/traspaso.md`.
- Hay que **integrar de a una y mirar el 80**; resolver con `--actualizar <id>` (un worker rebasea y resuelve conflictos en sesión limpia).

**Compactación**
- El worker compacta cuando su contexto pasa `PA_AUTOCOMPACT` (default 180000 tokens; Haiku antes). `pa` cuenta las compactaciones: el pie dice "(compactó: la tarea no entró en un contexto. Partila en varias la próxima; un worker que compactó ya no sabe bien qué tocó él.)". `--seguir` se niega en sesiones compactadas.
- El contexto del líder también se compacta solo (200k; Haiku 100k); no hay traspaso a sesión nueva. Las notas durables van a `tablero`, `--leccion` o al CLAUDE.md/AGENTS.md del proyecto, no al chat.

---

## 6. Qué falla hoy (ejemplos de logs reales)

| Síntoma | Evidencia | Causa / lectura |
|---|---|---|
| Workers que compactan | `66 turnos · 1275s · US$3.582 · 1 compactación(es)`; `pa --rinde`: codigo-multi Opus high 82 % compactó, Sonnet high 46 %, Haiku frontend 68 % | La tarea no entraba en un contexto. Brief demasiado grande o exploración abierta. |
| Trabajo a medias / sin commitear | `Archivos sin commitear: 8 ... Cerralo con: pa 'trama' --seguir --id ... 'commiteá lo que hiciste y reportá'` (exit 86 al integrar); Flash en codigo-multi: 167 turnos, 0 % ok | El worker no cierra; Flash especialmente. |
| Sin RESULTADO | exit 78 | El worker terminó sin el bloque o chocó con `--max-turns`. |
| Cortes de cupo gratis | `OpenCode cortó por límite de uso (opencode:opencode/deepseek-v4.1-flash-free)` y `glm-5.3-flash-free` | El plan Go/gratis se acaba; `reparto` no lo lee de antemano. |
| Cupo de Google agotado | `RESOURCE_EXHAUSTED (code 429) ... Resets in 126h12m16s` (agy) | Las bolsas Gemini 4 Argon y "Claude y GPT por Google" quedaron en 0 % 7 d; `reparto` ya lo sabe por `--cupos` pero un lanzamiento en carrera puede fallar. |
| Conflictos al integrar | pie: `ojo: la corrida ...-3720405 (sin integrar) también toca app/src/i18n/en.ts app/src/i18n/es.ts app/src/index.css ...: la que se integre segunda puede chocar` | Varios workers en paralelo sobre los mismos archivos de i18n/estilos. |
| Workers muertos al lanzar muchos | `pa: matado; el worker de 'trama' también.` y `el tree principal tiene N archivo(s) sin commitear ... El worker no los ve` | Cambios del líder sin commitear que el worker no ve; hay que commitear antes de delegar si el worker los necesita. |
| Tests rojos preexistentes | `12 tests que fallan (locales-deteccion busca binario.js; los de opencode y reparto ...)` reportado por varios workers | Ruido de base que confunde el chequeo: un protocolo debe separar "rojo previo" de "rojo nuevo" (comparar contra main). |
| Tasa de acierto baja | ningún (tipo, modelo) pasa de ~55 % integrada sin retrabajo | El diseño de fases/verificación es justo lo que tiene margen de mejora. |

---

## 7. Lo que te pedimos

**El problema a resolver:**

<<el dueño escribe acá el problema>>

**Diseñá un protocolo de orquestación por fases que use modelos chicos y baratos (Haiku, Gemini Flash, gratis de OpenCode) para lograr mejor resultado que un modelo grande solo, realizable sobre `pa` / `reparto` / `tablero` tal como están descritos arriba. Entregá:**

1. **Fases**: cuáles (análisis del problema, investigación, plan, implementación, verificación, y las que propongas), qué entra y qué sale de cada una, cuáles se pueden paralelizar (abanico de Haikus en `--leer`) y cuáles son secuenciales.
2. **Modelo por fase**: id exacto para `-m`, `--effort` y `--tipo` por fase, con justificación usando los datos de la sección 3. Respetá: Haiku <= ~40 KB de lectura, Flash sólo `lectura`/`mecanico`, gratis de OpenCode con plan B porque se cortan, nada de `ANTHROPIC_API_KEY`, nada local en GPU sin permiso, `max` y fable prohibidos.
3. **Formato de los briefs entre fases**: plantilla exacta (el brief de la sección 2.1, ampliado si hace falta) y cómo se pasa la salida de una fase a la siguiente (archivo `--brief-archivo`, `--lecciones`, resumen del líder) sin superar el contexto de un modelo chico.
4. **Verificación determinista de cada paso**: qué comando corre el líder (no el worker) para aceptar o rechazar una fase (grep/conteos, `git diff --stat`, tests, `--integrar --tests`, comparación contra main para separar rojos previos), qué hace con "SIN VERIFICAR" y con exit 78/86/80/93.
5. **Cuándo escalar a un modelo más caro**: criterios medibles (chequeo falla N veces, compactación, turnos > X, exit 78/86), la escalera concreta (Haiku xhigh -> Sonnet high -> Opus medium -> Opus high) y cuándo se pide OK al dueño. Cuándo NO escalar y mejorar el brief.
6. **Cómo encaja en lo existente**: qué se hace hoy con flags y archivos que ya existen (`--tipo`, `-m`, `--leer`, `--async`, `--esperar-todos`, `--seguir --id`, `--auditar`, `--leccion`, `tablero agregar`) y **qué habría que agregar** a `pa`, `reparto` o `tablero` (por ejemplo: un tipo/campo "fase", un modo "el líder elige" que ignore `minimo_por_tipo`, orquestación declarativa en un archivo, gate de verificación en `pa`), con una estimación de tamaño de cada cambio.
7. **Tratamiento de fallos conocidos**: compactación, trabajo a medias, límites de OpenCode/agy, conflictos de integración en archivos calientes, tests rojos preexistentes.
8. **Medición**: cómo comprobar que el protocolo gana (`pa --rinde` por tipo x modelo x effort, `pa --bien`, costo por tarea, tasa de integrada sin retrabajo) y qué experimento mínimo correr primero para validar antes de adoptarlo.
9. **Un ejemplo completo** con el problema que el dueño escriba arriba: secuencia de comandos `pa` reales, con modelos y briefs de cada fase.

Restricciones del entregable: concreto, con comandos reales, sin relleno; marcar explícitamente qué es "existe hoy" y qué es "hay que construir".
