# Auditoría de contexto y tokens (2026-11-21)

Base: `main` en `d77f89d9`. Las citas `archivo:línea` son de ese commit, no de los informes de origen (que apuntaban a `ec613482` y a `e8ebab74`, con las líneas corridas).
Insumos: los informes `ctx-*.md` de `~/.cache/trama-noche/crudo/` y la medición real de `/tmp/trama-auditoria/ctx/` (53 sesiones, 7 días).
Convención: «medido» sale de los transcripts; «estimado, caracteres/4» es una cuenta sobre el texto (Trama usa además 3 en `contexto-local.ts` y 3,5 en `contexto-sesion.ts`, así que no es una vara única).
Peso «input equivalente»: leído de caché x0,1, creado x1,25, salida x5.

Alcance: se deduplicaron los hallazgos de los informes en **36 hallazgos unificados** (`CTX-1` a `CTX-36`). Se verificaron 28 contra el código de hoy; 8 quedan «sin verificar».
Resultado: **21 confirmados, 2 refutados, 5 dudosos, 8 sin verificar.**

## Resumen

- Los tokens van casi todos a caché leído: workers 174,2 M leídos contra 5,3 M creados y 1,45 M de salida (97 % leído, 1 808 llamadas); líderes 453,3 M contra 8,9 M y 1,83 M (98 %, 2 711 llamadas). Medido.
- En peso equivalente el caché leído es el 74 % del costo de un líder Opus y el 56 % del de un worker Sonnet. Lo que más baja el costo es achicar lo que se relee en cada llamada, no lo que se crea una vez. Medido.
- Carga fija del primer turno: líder Opus 48 345 tokens (mediana), Fable 41 545, Sonnet 27 934, Haiku 18 434; worker Sonnet 27 696, Opus 19 313, Haiku 18 755. Líder y worker Opus difieren en unos 29 mil tokens que se releen en cada llamada (CTX-1). Medido.
- El contexto por llamada es grande: líder mediana 161 521 (p90 265 722, máximo 384 715); worker mediana 94 112 (p90 165 503, máximo 230 472). Medido.
- El caché se perdió 35 veces y se re-crearon 3,6 M tokens (mediana 76 899, máximo 286 080): 5 por cambio de modelo, 11 sin cambio y con pausa menor a 5 min (sin explicación en Trama), 19 con pausa mayor a 60 min y sólo 4 entre 5 y 60 min. Medido. Por eso el corte plano de 55 min (CTX-17) pesa poco.
- Herramientas: Bash 4 124 usos y 2,24 M tokens (mediana 212, p95 2 243); Read 278 usos y 483 k; `estado_workers` 5 usos y 23 k, con p95 de 11 023 tokens en una sola respuesta (CTX-7). Medido.
- Inyecciones de la plataforma que se repiten: `queued_command` 97 veces de 22 603 tokens (base64 de 38 imágenes; el texto son 24 420 tokens en total), `prompt_snapshot` 144 x 6 530 (no identificado), `skill_listing` 49 x 6 958, `invoked_skills` 16 x 9 643, `instructions` 80 x 2 874, hooks `SessionStart` de 2 229 a 3 414 tokens por evento. Medido.
- Compactaciones: 19 (10 automáticas y 9 manuales) con mediana de 268 613 tokens antes de compactar (mínimo 164 998, máximo 391 629). Medido.
- Salida: 3 281 701 tokens facturados; de la parte visible, 952 752 son argumentos de herramientas y 93 937 texto (estimado, caracteres/4). Se relee en caché después.
- Siempre cargado en el líder del home: instrucciones 4 187 tokens (global 346, `~/CLAUDE.md` 1 595, stub 36, `AGENTS.md` de Trama 2 029, `MEMORY.md` 181; estimado, caracteres/4).
- Lo que hoy se puede achicar sin cambiar lo que ve la persona: podas del líder (CTX-1, CTX-6), AGENTS.md duplicado en agy y codex (CTX-5), MCP y skills en workers de otros motores (CTX-4), tope total del MCP `trama` (CTX-7).
- Del carril de `nota-compactar` ya se arregló en `main` (662a943c) que el líder use el `autoCompactWindow` del settings; sigue sin hacerlo el worker (CTX-2) y Gemini subestima su contexto porque descarta el caché leído (CTX-3).

## A dónde van los tokens hoy

**Carga fija por modelo.** Ver las cifras del resumen. El líder carga ~29 mil tokens más que un worker del mismo modelo: no pasa `--disallowedTools` (`app/electron/lider-arma.ts`, `argvLider`), ni `--exclude-dynamic-system-prompt-sections`, ni `ENABLE_TOOL_SEARCH`, mientras que el worker sí (`app/electron/cli/pa/lanzar.ts:497-520` y `:544`, `:576`). El comentario de `lanzar.ts` mide 20 531 tokens de `cache_creation` contra 9 740 al apagar las 13 herramientas. El líder no puede copiar esa lista porque usa `Agent`, `Workflow` y `Cron`.

**Caché leído contra creado.** 97-98 % leído. El costo real es el contexto que crece sin parar: cada llamada relee todo.

**Contexto por llamada.** Ver el resumen. A 161 k de mediana en el líder, 1 000 tokens de más en la carga fija cuestan lo que 1 000 x 2 711 llamadas x 0,1 = 271 k tokens equivalentes por semana medida (estimado).

**Caché perdido.** Ver el resumen. Lo ya explicado (modelo, pausa mayor al TTL) no se arregla; los 11 casos sin cambio y con pausa corta quedan sin causa identificada (ver «Qué falta auditar»).

**Herramientas.** Bash domina en cantidad; los mayores individuales son lecturas de skills (`taste-skill` `app-screens.md`, 14 972 tokens, dos veces). Archivos releídos más de dos veces: 4 casos, 16 435 tokens (poco).

**Inyecciones.** Las de arriba. Las de la plataforma (`skill_listing`, `instructions`, `deferred_tools_delta`, `mcp_instructions_delta`, `agent_listing_delta`, `output_style`) no las controla Trama salvo por lo que le pasa a `claude` (CTX-1, CTX-21). Los hooks propios de `SessionStart` (`resumen-modelos` 800-950 tokens estimado) sí (CTX-29, sin verificar).

**Compactaciones.** 19 en 7 días, la mediana ocurre a 268 k. La nota antes de compactar suma ≈119-133 tokens de pedido más la devolución de hasta 3 000.

**Salida.** Ver el resumen; son 5 veces más caras que la entrada y quedan después en el contexto releído.

## Qué recibe cada motor

Pesos en tokens, estimado caracteres/4 salvo donde dice medido.

### Claude líder (y líder Claude con cuenta agregada)

| Pieza | Tokens |
|---|---|
| Carga fija del primer turno (mediana medida, Opus) | 48 345 |
| `LINEA_CHAT` | ≈141 |
| MCP `trama` (4 herramientas) | 28 a 668 |
| Hook `resumen-modelos` por `SessionStart` | 800-950 |
| Relevo (`relevos/<sid>.md`, `TOPE_RELEVO` 40 000 caracteres) | ≤10 000 |
| Resumen de traspaso | ≤1 500 |
| Aviso de worker (`avisos-worker.ts`) | ≈400-530 |
| Plan para revisión o debate | ≤15 000 |
| Pedido de nota-compactar y devolución | ≈119-133 y ≤3 000 |
| Hook `cierre-cupo` | ≈203 |

### Claude worker

| Pieza | Tokens |
|---|---|
| Carga fija del primer turno (mediana medida; Sonnet / Opus / Haiku) | 27 696 / 19 313 / 18 755 |
| Contrato (`--append-system-prompt`) | ≈1 400 (Pro ≈1 558) |
| `AGENTS.md` + stub de `CLAUDE.md` | 2 029 + 36 |
| Lecciones (`bloqueVariable`, ≤1 500 caracteres) | ≤395 |
| Ficha del proyecto | ≤8 líneas |
| `TXT_PRO` / `TXT_FLOJO` / lector / aviso de diseño | 157 / 98 / 159 / 59 |
| Tareas y paralelos | sin tope |

### Gemini por `agy` (líder y worker)

| Pieza | Líder | Worker |
|---|---|---|
| Prompt del motor (`PROMPT_GEMINI` / contrato) | ≈655 | ≈1 625-1 725 |
| `LINEA_CHAT` | ≈145 | no |
| `~/.claude/CLAUDE.md` | ≤1 125 | no |
| `~/CLAUDE.md` | ≤3 000 | no |
| `AGENTS.md` (pegado por `pa`; además lo lee `agy` solo) | por el binario | ≤5 000 |
| Relevo | ≤10 000 | no |
| `hablado()` | ≤3 000 | no |
| MCP `trama` + skills | n/c | ≈550 + skills |

### Codex

| Pieza | Líder | Worker | Revisor |
|---|---|---|---|
| Prompt del motor | `PROMPT_CODEX` ≈662 + `LINEA_CHAT` 142 | contrato 1 391 | prompt de revisión |
| `AGENTS.md` | nativo | pegado + nativo | no |
| Plan | n/c | n/c | ≤15 000 |
| Ventana | 400 000 fija | 400 000 fija | 400 000 fija |

### DeepSeek y OpenCode

| Pieza | Tokens |
|---|---|
| `PROMPT_DSH` / `PROMPT_OPENCODE` | ≈709-716 |
| `armarContexto` | hasta 7 500 |
| MCP `trama` por ACP | ≈593 |
| Relevo | ≤10 000 |
| Ventana de respaldo | `this.ventana \|\| 262144` (`app/electron/dsh-puente.ts:396`) |

### Local (Ollama y llama-server)

| Pieza | Tokens |
|---|---|
| Líder Ollama: `claude -p` sin `--bare` | más de 15 000 de base |
| Worker Ollama (piso) | ≈11 065 |
| llama-server: `PROMPT_LOCAL` | ≈189 |
| llama-server: tres herramientas | ≈1 000 |
| llama-server: `armarContexto` | 6 144-11 250 |

### Debate y revisión (llamadas propias de Trama)

Revisión simple medida: 16 250 tokens sin adjuntos y 26 287 con. Debate (estimado, calculado sobre una medición sintética): unos 26 000 tokens de base por llamada (plan 15 000 + pedido 1 000 + archivos 10 000); con 3 modelos x 3 rondas y conclusión son 10 llamadas y 300-314 mil tokens de entrada. Con el valor por defecto (2 rondas x 3 modelos + conclusión, 7 llamadas) ronda 180-200 mil (estimado). No hay topes entre rondas (CTX-30, sin verificar).

### Qué sabe cada motor

| Motor y rol | Instrucciones | Memoria | Tablero | Skills | MCP | Hooks | Compactación | Medidor de contexto |
|---|---|---|---|---|---|---|---|---|
| Claude líder | nativo (CLAUDE.md, `@AGENTS.md`) | `MEMORY.md` nativo | hook de arranque | nativas | `trama` + los del dueño | sí | nativa + nota + `/compact` encolado | anillo desde el último mensaje (`usoDeLineaStream`) |
| Claude worker | nativo + contrato | sí, pero sin verificar si la de la carpeta de trabajo | ficha pegada | nativas | `trama` | `nota-compactar`, `cierre-cupo` | nativa + nota (si no es Ollama) | sí |
| Gemini (agy) líder | pegado (`CLAUDE.md` global, `~/CLAUDE.md`) | no | no | sincronizadas | `trama` | no | nota con umbral sobre uso subestimado | subestimado: descarta `cache_read` (CTX-3) |
| Gemini (agy) worker | `AGENTS.md` pegado y nativo | no | no | sincronizadas | `trama` | no | sin verificar | idem |
| Codex líder / worker / revisor | `AGENTS.md` nativo (+ pegado en worker) | no | no | sincronizadas (worker) | `trama` (worker) | no | sin verificar | ventana fija 400 000 |
| DeepSeek / OpenCode | `armarContexto` | no | no | sincronizadas (OpenCode worker) | `trama` por ACP | no | `compaction-basic` sólo en locales | ventana 262144 de respaldo |
| Local (Ollama / llama-server) | `PROMPT_LOCAL` / `armarContexto` | no | no | no | no | no | `/compact` propio | `contexto-local.ts` con 3 caracteres por token |

## Hallazgos

Orden por impacto. Veredicto con evidencia de hoy. «Peso» es medido o estimado según se indique.

| ID | Orígenes | Motor y rol | Plataforma | Suscripción | Qué pasa | Peso | Veredicto | Arreglo | Archivos |
|---|---|---|---|---|---|---|---|---|---|
| CTX-1 | CLAUDE-LIDER-1 | Claude líder | ambas | Claude | `argvLider` no pasa `--disallowedTools`, `--exclude-dynamic-system-prompt-sections` ni `ENABLE_TOOL_SEARCH`; el worker sí (`lanzar.ts:497-520,544,576`) | 48 k contra 19 k de carga fija (medido); techo ≈29 k, no todo recortable (el líder usa `Agent`, `Workflow`, `Cron`) | CONFIRMADO: `lider-arma.ts` `argvLider` sin esos flags | lista propia de herramientas apagadas para el líder y `--exclude-dynamic` | `app/electron/lider-arma.ts` |
| CTX-2 | CLAUDE-LIDER-4 | Claude líder y worker, nota-compactar | ambas | Claude | La nota se pedía sobre un umbral que ignoraba el `autoCompactWindow` del settings (nativo: 750 000 en ventana 1 M, no 850 000). Líder arreglado en `662a943c` (`lider.ts:684,727-728`). El worker sigue igual: `lanzar.ts:288-296` toma `ventanaDe` y el 75 % sin mirar el settings | Claude compacta antes de que se pida la nota si el settings baja la ventana | CONFIRMADO sólo en workers; líder ARREGLADO | que `pa` lea `autoCompactWindow` (misma función `leerUmbralYa`) | `app/electron/cli/pa/lanzar.ts` |
| CTX-3 | GEMINI-AGY-2 | Gemini (agy) líder y worker | ambas | Google | `usoClaude` descarta `cache_read_tokens` (`agy-stream.ts:82`); `input_tokens` de agy excluye el caché (`tests/agy-tokens.test.ts`) | Anillo, `decidirCache` (umbral 40 000) y umbrales de nota subestiman el contexto real | CONFIRMADO | sumar `cache_read` al uso de contexto (no a la facturación) | `app/electron/agy-stream.ts`, `app/electron/cache-pregunta.ts` |
| CTX-4 | GEMINI-AGY-1, CODEX-15, DEEPSEEK-2 | workers agy, codex y opencode | ambas | Google, OpenAI, OpenCode | `ejecutarOtro` sincroniza skills y registra el MCP `trama` para cada worker (`otros-motores.ts:121-150`) | MCP ≈550 + listado de skills por llamada (estimado) | CONFIRMADO | no registrar el MCP ni las skills en workers que no los usan | `app/electron/cli/pa/otros-motores.ts` |
| CTX-5 | GEMINI-AGY-3, CODEX-1, RELEVO-9 | workers agy y codex | ambas | Google, OpenAI | `agentsMdBloque` pega `AGENTS.md` siempre (`motores/prompt.ts:97-150`, tope 20 000 caracteres) y `claudeMdDueno` en crudo sin tope, además de que agy y codex lo leen nativo (comentarios de `llamada.ts`) | `AGENTS.md` de Trama 2 029; hasta 5 000 por worker (estimado) | CONFIRMADO la inyección; la lectura nativa es del binario, no verificada | no pegarlo en motores que lo leen solos; tope a `claudeMdDueno` | `app/electron/cli/pa/motores/prompt.ts`, `app/electron/cli/pa/motores/llamada.ts` |
| CTX-6 | DEEPSEEK-1, DEEPSEEK-4 | Líder Ollama | ambas | ninguna de Claude | `argvLider` no pasa `--bare`, `--strict-mcp-config`, `--settings` ni variables de ventana cuando `ollama` (`lider-arma.ts:157-170`) | más de 15 000 de base (estimado) | CONFIRMADO (el worker Ollama no se abrió en detalle) | pasar `--bare` y limpiar MCP en el líder Ollama | `app/electron/lider-arma.ts` |
| CTX-7 | CLAUDE-LIDER-9 | Claude líder | ambas | Claude | `estado_workers` devuelve hasta 60 filas y `buscar_hilos` hasta 100, con `JSON.stringify(..., null, 1)` y sin tope total (`cli/mcp-trama.ts:158-229`) | 11 023 y 11 010 tokens en dos llamadas medidas | CONFIRMADO sin tope total; la parte «resultado sin recorte» ver CTX-27 | tope de caracteres total, sin sangría | `app/electron/cli/mcp-trama.ts` |
| CTX-8 | GEMINI-AGY-8, CODEX-5 | workers agy y codex | Windows | Google, OpenAI | El prompt entero va en `argv` (`motores/llamada.ts:100-215`: `-p p` en agy, `args.push(p)` en codex) | `ENAMETOOLONG` sobre 32 767 caracteres (8 191 si pasa por cmd) | CONFIRMADO en el código; sin reproducir en Windows | pasar el prompt por archivo o stdin, como `dsh` y `opencode` (`--tarea-archivo`) | `app/electron/cli/pa/motores/llamada.ts` |
| CTX-9 | SUSC-1 | reparto | ambas | una o ninguna de Claude | Sin suscripción Claude, `claudes = [{id:"claude"}]` queda como oferta fantasma (`reparto.ts:2745-2753`); sólo se vacía si hay DeepSeek y `claude` no está instalado | elige un modelo que no existe | CONFIRMADO | sacar la oferta si no hay Claude instalado o logueado | `app/electron/cli/reparto.ts` |
| CTX-10 | SUSC-3 | reparto | ambas | sólo Ollama | Los locales sin calidad medida reciben `viejaAAa(35)` (`reparto.ts:3016-3026`), bajo el mínimo del tipo, y `duro` no se relaja (`:3143`): `modelo: null` con `--tipo` | el worker no se lanza | CONFIRMADO con `--tipo`; el `-m` explícito no se verificó | relajar `duro` para locales sin historial | `app/electron/cli/reparto.ts` |
| CTX-11 | SUSC-5 | `pa` | ambas | Claude sin `$STATE/plan` | `planDe`/`planDeCuentaEnUso` nunca leen `~/.claude/.credentials.json` (`cli/pa/entorno.ts:183-213`); cae a «pro» | cupos mal calculados (límites de Pro en cuentas Max) | CONFIRMADO | leer `.credentials.json` como `costo-planes.ts:100-110` | `app/electron/cli/pa/entorno.ts` |
| CTX-12 | CLAUDE-WORKER-10 | Claude worker | ambas | Claude | `promptDe` suma `bloqueVariable` también en `--resume` (`lanzar.ts` ≈440-470); la ficha sí lleva `!c.resume` | lecciones ≤395 + mapa + paralelos, otra vez por reanudación | CONFIRMADO | saltar el bloque en `--resume` | `app/electron/cli/pa/lanzar.ts` |
| CTX-13 | CLAUDE-WORKER-9, LLAMADAS-15 | Claude worker (cierre) | ambas | Claude | `argsCierre` no lleva `--exclude-dynamic-system-prompt-sections` (`lanzar.ts` ≈553-562), `argsClaude` sí (`:544`) | crea otro caché en la reanudación del cierre; efecto no medido | CONFIRMADO el flag ausente; efecto sin medir | agregar el flag | `app/electron/cli/pa/lanzar.ts` |
| CTX-14 | CLAUDE-WORKER-4 | Claude líder y worker | ambas | cualquiera | `pa --hilo` devuelve 50 mensajes por defecto, JSON con sangría 2, strings de primer nivel a 2 000 caracteres y sin tope total (`cli/pa/hilo.ts:31-35,122-215`) | sin caso medido | CONFIRMADO | tope total y sin sangría | `app/electron/cli/pa/hilo.ts` |
| CTX-15 | SUSC-6, DEEPSEEK-10 | líderes Gemini, DeepSeek, OpenCode, Codex | ambas | sin Claude | `PROMPT_GEMINI` dice que «el líder es un modelo de Anthropic y los workers gastan lo mismo» (`contexto-local.ts` ≈205), heredado por `PROMPT_DSH`, `PROMPT_OPENCODE` y `PROMPT_CODEX`; además manda `reparto --tabla` en vez de `--resumen` | texto falso para quien no usa Claude; la tabla es más larga | CONFIRMADO | texto según la suscripción real; `--resumen` | `app/electron/contexto-local.ts` |
| CTX-16 | CLAUDE-LIDER-2 | Claude líder | ambas | Claude | El hook `cierre-cupo` se agrega dos veces: `registrarCierreEnAjustes` en `~/.claude/settings.json` (`cli/hooks.ts:169-181`) y otra vez por `--settings` (`lider.ts` ≈700-735, `cierre-cupo-texto.ts:63-90`); `cierre-cupo.mjs:64-65` lo reconoce con la marca `wx` | 0 tokens; dos procesos `node` por evento | CONFIRMADO sólo el hook duplicado | una sola vía | `app/electron/lider.ts`, `app/electron/cli/hooks.ts`, `app/electron/cierre-cupo-texto.ts` |
| CTX-17 | RELEVO-6 | Claude líder y worker | ambas | Claude | `PA_CACHE_FRIO_MIN = 55` plano, sobre el mtime del transcript (`orquesta.ts:205-227`), mientras `hilos.ts` usa el TTL real | sólo 4 de 35 pérdidas medidas caen entre 5 y 60 min | CONFIRMADO, impacto bajo | usar el TTL real | `app/electron/cli/pa/orquesta.ts` |
| CTX-18 | CLAUDE-WORKER-12 | Claude worker | ambas | Claude | `nota-compactar-textos.mjs` pide «seguí con lo que estabas haciendo» (`TOPE_NOTA` 12 000) y `contrato.ts:7` `FRASE_COMPACTA` pide «cerrá el pedazo… terminá con SIGUE» | contradicción; los workers medidos no pasan de 230 k | CONFIRMADO, impacto bajo | unificar el texto | `motor/hooks/nota-compactar-textos.mjs`, `app/electron/cli/pa/contrato.ts` |
| CTX-19 | CLAUDE-LIDER-10 | Claude líder | ambas | Claude | `comoResolverFalta` (≈520 caracteres) se repite por worker con FALTA (`avisos-worker.ts:415-520`) | ≈130 tokens por aviso | CONFIRMADO, impacto bajo | decirlo una vez por turno | `app/electron/avisos-worker.ts` |
| CTX-20 | DEEPSEEK-6 | DeepSeek (Ollama) | ambas | local | La regex `/^\w[\w.-]*$/` rechaza claves con `:` (`dsh.ts:73-91`); el respaldo de ventana es 262144 (`dsh-puente.ts:396`); el entorno `TRAMA_DSH_CONTEXTO` se lee en `:546`, y no confirmé que `lider.ts` lo setee | ventana equivocada en modelos con `:` | CONFIRMADO regex y respaldo; el origen de la variable no | aceptar `:` en la regex | `app/electron/dsh.ts`, `app/electron/dsh-puente.ts` |
| CTX-21 | CLAUDE-LIDER-3 | Claude líder | ambas | Claude | Dos `--settings` separados (apagados y cierre de cupo) en `lider-arma.ts:160-170`; si Claude Code no los fusiona, el último pisa al primero | podría perder un hook o la apagada de herramientas | DUDOSO: no se puede probar sin correr `claude` | probar en vivo; si no fusiona, un solo JSON | `app/electron/lider-arma.ts` |
| CTX-22 | CLAUDE-LIDER-5, RELEVO-1, GEMINI-AGY-9.1 | líder (todos) | ambas | cualquiera | El relevo no se borra tras consumirlo (`lider.ts:1628,1833`) | hasta 10 000 tokens otra vez | DUDOSO: está pensado así (no entra al transcript de Claude y borrarlo perdería el historial); comparte ruta con `cierre-cupo` | marcar como consumido en vez de borrar | `app/electron/lider.ts` |
| CTX-23 | SUSC-2 | reparto | ambas | Claude y Google | `reparto.ts:2961` salta la ventana de 5 h de Claude si `agyClaudeOk`; `:2973` usa `Math.min(...us)` | cupo mal medido | DUDOSO: el mínimo puede ser intencional (la ventana limitante) | confirmar con el dueño | `app/electron/cli/reparto.ts` |
| CTX-24 | CLAUDE-LIDER-6, RELEVO-3 | Claude líder | ambas | Claude | `cambiarYa` pasa `enTurno = true` siempre (`lider.ts` ≈1299-1310) | el aviso de cambio no desaparece | DUDOSO: el comentario lo justifica (tarea de fondo que retoma sola); la parte de la interfaz no se verificó | n/c | `app/electron/lider.ts` |
| CTX-25 | RELEVO-4 | Gemini | ambas | Google | `TTL_DEFECTO_S = {claude: 300, gemini: 300}` (`cache-pregunta.ts`): el 300 de Gemini es una suposición declarada | decide cuándo ofrecer reanudar | DUDOSO | medir el TTL de agy | `app/electron/cache-pregunta.ts` |
| CTX-26 | RELEVO-12 | Claude worker | ambas | Claude | `debeAutoCompactar` (`nota-compactar-main.ts`) encola `/compact` con `suave ?? fuerte`: la tarea al 60 % compacta antes del tope si ya hay una nota posterior a la última compactación | mecanismo confirmado; el efecto sobre costo no se midió | CONFIRMADO el mecanismo | n/c | `app/electron/nota-compactar-main.ts` |
| CTX-27 | CLAUDE-LIDER-9 (parte) | Claude líder | ambas | Claude | «El campo `resultado` se devuelve entero» | n/c | REFUTADO: `hilos.ts:485` lo corta a 200 antes de `fila()` | n/c | `app/electron/cli/pa/hilos.ts` |
| CTX-28 | CLAUDE-LIDER-2 (parte) | Claude líder | Windows | Claude | «`node` sin resolver en Windows» | n/c | REFUTADO como falla: `windows/src/nativo.js:76-88` pone el `node.exe` propio al final del PATH; queda la incoherencia con `pa`, que sí pasa `node` | n/c | `windows/src/nativo.js` |
| CTX-29 | CLAUDE-LIDER-8 | Claude líder | ambas | Claude | `resumen-modelos` corre en cada `SessionStart` (startup, resume y compact) | 800-950 estimado; el hook completo mide 2 229-3 414 | SIN VERIFICAR | sólo en startup | `motor/hooks/` |
| CTX-30 | LLAMADAS-1 | debate | ambas | cualquiera | Cada ronda reenvía plan, pedido y archivos (`debate.ts` `correrTodo`, `debate-texto.ts` `bloqueContexto`) | 300-314 k estimado | SIN VERIFICAR | topes por ronda | `app/electron/debate.ts`, `app/electron/debate-texto.ts` |
| CTX-31 | LLAMADAS-3 | revisión de plan | Windows | cualquiera | La regex de `rutasDelPlan` (`revision-plan.ts:60`) admite `/` y no `\` | no se adjuntan los archivos del plan | SIN VERIFICAR | aceptar ambas barras | `app/electron/revision-plan.ts` |
| CTX-32 | CODEX-6, CODEX-10, CODEX-2 | Codex | ambas | OpenAI | Lectura del flujo de `codex` (`codex-stream.ts`) | n/c | SIN VERIFICAR | n/c | `app/electron/codex-stream.ts` |
| CTX-33 | CLAUDE-WORKER-1 | Claude worker | Windows | Claude | `PowerShell` fuera de `HERRAMIENTAS_LEER` y de las guardias | un lector puede escribir | SIN VERIFICAR | n/c | `app/electron/cli/pa/lanzar.ts` |
| CTX-34 | DEEPSEEK-3, DEEPSEEK-9 | DeepSeek | ambas | local | Compactación y `PA_RECORTE` | n/c | SIN VERIFICAR | n/c | `app/electron/dsh.ts` |
| CTX-35 | SUSC-11 | cupos | ambas | cualquiera | Doble sondeo (`nucleo.ts:814`) | llamadas extra | SIN VERIFICAR | n/c | `app/electron/nucleo.ts` |
| CTX-36 | RELEVO-5 | cierre por cupo | ambas | Claude | Al retomar el cierre por cupo no pasa por `decidirCache` | puede recrear caché sin preguntar | SIN VERIFICAR | n/c | `app/electron/cache-pregunta.ts`, `motor/hooks/cierre-cupo.mjs` |

## Incoherencias

**Entre motores.**
- El umbral de nota y el anillo usan el contexto real en Claude y uno subestimado en Gemini (CTX-3).
- Tres motores leen `AGENTS.md` solos y además `pa` se lo pega (CTX-5); Claude lo lee una sola vez.
- Contar tokens: 4 caracteres en la nota, 3 en `contexto-local.ts`, 3,5 en `contexto-sesion.ts`.
- Ventana de DeepSeek: 262144 de respaldo; la de Codex, 400 000 fija; la de Claude, `ventanaDe` (1 000 000 en `claude-*-5`).
- Contradicción de textos entre la nota y el contrato (CTX-18).

**Entre suscripciones.**
- Con una sola suscripción de Claude o ninguna, `reparto` ofrece un Claude fantasma (CTX-9), no lanza si sólo hay Ollama (CTX-10) y asume plan Pro (CTX-11).
- Los líderes de Gemini, DeepSeek, OpenCode y Codex le dicen al modelo que es un modelo de Anthropic y que los workers gastan lo mismo (CTX-15).
- El anillo, el medidor y la nota sólo son completos para Claude.

**Entre Windows y Linux.**
- Prompt en `argv` en agy y codex puede romper en Windows (CTX-8, sin reproducir).
- `comandoHook` usa `o.node ?? "node"` y `lider.ts` no pasa `node` mientras `pa` sí; funcionalmente cubierto por `nativo.js` (CTX-28).
- Regex de rutas sólo con `/` (CTX-31, sin verificar).
- `PowerShell` fuera de las guardias de lectura (CTX-33, sin verificar).

## Plan de arreglos

Orden por ahorro. Los paquetes no comparten archivos.

| Paquete | Cubre | Archivos | Test | ¿Cambia lo que ve la persona? |
|---|---|---|---|---|
| P1 Podas del líder | CTX-1, CTX-6, CTX-16, CTX-21 | `app/electron/lider-arma.ts`, `app/electron/lider.ts`, `app/electron/cierre-cupo-texto.ts`, `app/electron/cli/hooks.ts` | tests de `argvLider` y `tests/nota-compactar-hook.test.ts` | Sí: el líder deja de tener herramientas apagadas; necesita decisión del dueño sobre cuáles |
| P2 Nota-compactar y medidor | CTX-2 (worker), CTX-3, CTX-18, CTX-25 | `app/electron/cli/pa/lanzar.ts` (sólo el tramo de umbrales), `app/electron/agy-stream.ts`, `app/electron/cache-pregunta.ts`, `motor/hooks/nota-compactar-textos.mjs`, `app/electron/cli/pa/contrato.ts` | `tests/nota-compactar-hook.test.ts`, `tests/agy-tokens.test.ts` | Sí leve: el anillo de Gemini sube; necesita decisión del dueño |
| P3 Workers de otros motores | CTX-4, CTX-5, CTX-8 | `app/electron/cli/pa/otros-motores.ts`, `app/electron/cli/pa/motores/llamada.ts`, `app/electron/cli/pa/motores/prompt.ts` | tests de prompt y llamada, más uno nuevo de largo de `argv` | Sí: los workers pierden MCP y skills; necesita decisión del dueño |
| P4 MCP `trama` y avisos | CTX-7, CTX-14, CTX-19 | `app/electron/cli/mcp-trama.ts`, `app/electron/cli/pa/hilo.ts`, `app/electron/avisos-worker.ts` | tests del MCP y de `pa --hilo` | Sí leve: el líder ve menos filas; necesita decisión del dueño sobre el tope |
| P5 Workers Claude | CTX-12, CTX-13 | `app/electron/cli/pa/lanzar.ts` (tramos `bloqueVariable` y `argsCierre`; no tocar el de P2 en paralelo) | tests de `argsClaude` y `argsCierre` | No |
| P6 Suscripciones | CTX-9, CTX-10, CTX-11, CTX-15 | `app/electron/cli/reparto.ts`, `app/electron/cli/pa/entorno.ts`, `app/electron/contexto-local.ts` | tests de `reparto` | Sí: cambia qué modelo se elige con una sola suscripción; necesita decisión del dueño |
| P7 Menores | CTX-17, CTX-20 | `app/electron/cli/pa/orquesta.ts`, `app/electron/dsh.ts`, `app/electron/dsh-puente.ts` | tests de `orquesta` y `dsh` | No |

Nota: P2 y P5 tocan `lanzar.ts`: ir en serie, no en paralelo. Los CTX-29 a CTX-36 esperan a ser verificados antes de entrar a un paquete.

## Qué falta auditar

- Las áreas de **cuentas** y de **ventanas** todavía no tienen informe.
- **Windows contra Linux** tampoco tiene informe propio; lo de arriba sale de la lectura del código, no de una medición en Windows.
- Los 8 hallazgos sin verificar (CTX-29 a CTX-36).
- Los 11 casos de caché perdido con pausa menor a 5 min y sin cambio de modelo.
- El `prompt_snapshot` (144 x 6 530 tokens): sin identificar.
- Si Claude Code fusiona varios `--settings` (CTX-21).
- El efecto real en caché de `argsCierre` sin `--exclude-dynamic` (CTX-13).

## Lo refutado

- «`resultado` se devuelve entero en `estado_workers`» (CTX-27): `app/electron/cli/pa/hilos.ts:485` ya lo corta a 200 antes de `fila()`.
- «`node` sin resolver en Windows rompe el hook» (CTX-28): `windows/src/nativo.js:76-88` agrega el `node.exe` propio al PATH.
- Número «850 000» del umbral nativo de la nota (corregido dentro de CTX-2): hoy `umbralesNota` da 750 000 y 600 000 (`app/electron/modelos-tipos.ts:66-95`; lo confirma `tests/nota-compactar-hook.test.ts`).
- «`ENABLE_TOOL_SEARCH` ahorra mucho» en el líder (matiz de CTX-1): hay indicios de que la herramienta diferida ya está activa (11 `ToolSearch` y `deferred_tools_delta` en las 53 sesiones), pero no se pudo separar del efecto de los workers; no se promete ahorro.
- «El auto-compact del líder ignora el `autoCompactWindow`»: era cierto en `e8ebab74`, ya no en `main` (`662a943c`, `app/electron/lider.ts:684`).
