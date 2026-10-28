# Trama: protocolo de orquestación por fases, versión 2

Fecha: 2026-10-27. Documento autocontenido para revisión crítica por un modelo externo sin acceso a la PC. No hace falta la v1.

Leyenda: **[HOY]** existe y anda · **[AGREGAR]** hay que construirlo (tamaño y prioridad en la sección 9) · **[EN CONSTRUCCIÓN]** se está haciendo ahora · **[SIN DECIDIR]** idea abierta, no adoptada.

---

## 0. Tesis

Un modelo chico rinde como uno grande cuando se cumplen tres cosas: la tarea entra en su contexto, el objetivo no es ambiguo y alguien que no es el worker puede desmentirlo con un comando. Los logs muestran las tres fallas: **compactación** (la tarea no entraba), **trabajo que resuelve otra cosa** (brief ambiguo) y **verificación que el mismo worker se autoaprueba**.

El protocolo ataca las tres: partir hasta que entre (hoy ≤40 KB de lectura), exigir un chequeo que da rojo en `main` antes de implementar, y que lo corra el líder (un script, `gate`) y no el worker.

Lo que los datos NO prueban: que Haiku rinda igual que Opus. A Haiku le tocaron las tareas ya juzgadas fáciles. La apuesta es otra: **el líder estima la complejidad antes de lanzar y elige de una el modelo justo** (rúbrica, sección 6). Con tareas bien partidas y un chequeo que las desmienta, ese modelo justo suele ser uno chico. Cuando no lo es, la rúbrica lo dice antes de gastar.

Novedad de la v2 respecto de la v1: (a) una **vía rápida** para tareas chicas y medianas, porque las 8 fases completas pueden costar más en coordinación del líder que la tarea misma; (b) **gate endurecido sin LLM** contra trampas típicas de un modelo chico; (c) **no se escala probando**: un solo reintento con el error real, después se clasifica la falla y, si la estimación estuvo mal, se va directo al modelo correcto; (d) rúbrica con tamaño medido también en KB y filas nuevas; (e) todo ajustado a los modelos realmente habilitados hoy.

---

## 1. Contexto mínimo del sistema

**Trama** es una app de escritorio (Electron) más un **motor** de scripts (bash y python) que reparte trabajo de programación entre modelos y suscripciones.

| Pieza | Qué es |
|---|---|
| **Líder** | Una sesión de Claude (Opus; effort `medium` según `modelos.json`) que corre fuera de los proyectos. Entiende el pedido, escribe briefs, lanza workers, verifica, integra. No lee el código del proyecto para contestar: delega. **Gasta el mismo cupo de Claude (ventanas de 5 h y 7 d) que los workers Claude.** |
| **Worker** | Un modelo lanzado por `pa`, dentro del proyecto, en un worktree git y una rama propios (`pa/<proyecto>/<id>`). Hace UNA tarea, commitea, responde con un bloque corto. No puede preguntar (headless). No ve lo que el líder dejó sin commitear. Tiene bloqueados `git stash` y `git add -A`. |
| `pa` | Lanza, vigila, mide e integra workers (bash, ~6600 líneas). |
| `reparto` | Elige modelo+effort según tipo de tarea y cupo; sabe los cupos y los modelos enfriados. `reparto --resumen` lista las opciones habilitadas y se imprime al arrancar el líder. |
| `tablero` | Lista de pendientes y decisiones del dueño. Las líneas `DECISION` de los workers entran solas. |
| `gate` | Compuerta de verificación de cada corrida (F6), la corre el líder. |

**Contrato de salida de todo worker:** bloque `RESULTADO` (1–3 oraciones) · `ARCHIVOS` · `VERIFICACION` (comandos y 2–6 líneas reales de su salida, o "ninguna") · `DECISION` (qué decide el dueño, o "nada") · `SIGUE` · opcional `PROBAR` (qué mirar a ojo, sólo si exige algo que el worker no tiene). Pie: turnos, segundos, US$ a precio de lista, nº de compactaciones, rama y commits sobre qué sha. Sin bloque `RESULTADO` sale 78.

**Comandos de `pa` que usa el protocolo [HOY]:**

| Comando | Para qué |
|---|---|
| `pa <p> --async --tipo T -m M --effort E --brief-archivo F` | Lanzar un worker desacoplado; imprime el id (o EN COLA si el tope global está lleno). |
| `pa <p> --leer ...` | Sólo lectura; no toma puesto ni lock; sí cuenta para el tope global. |
| `pa --esperar <p> --id ID` · `pa --esperar-todos` | Cobrar resultados (esperar-todos: N resultados en un turno del líder). |
| `pa <p> --seguir --id ID "<t>"` | Retomar esa corrida (misma rama y puesto). Se niega si la sesión compactó (`--force` lo saltea); si pasaron >55 min arranca sesión nueva en la misma rama. |
| `-m a,b,c` | Lista de fallback: pasa al siguiente con exit 76/77/95/96/97 y saltea modelos enfriados. Con `--async` sólo cubre fallas al lanzar. |
| `--fase F1..F7 --tarea <slug>` | Etiquetan la corrida en `medicion.tsv`; `pa --rinde --por fase\|tarea` agrupa. |
| `pa --rubrica 'A=.. B=.. C=.. D=.. E=..'` | Muestra qué fila de la tabla (v2, sección 6) corresponde y no lanza. Con `pa <p> --rubrica '...' "<t>"` lanza con ese modelo/effort y anota fila y modelo estimado. Sale 3 si la fila dice "no se lanza"; sale 98 si la fila da un modelo o effort que `modelos.json` apaga. |
| `pa --rinde [--por tipo\|fase\|tarea \| --rubrica] [--json]` | Rendimiento: n, % integrada sin retrabajo, turnos, costo medio, % que compactó. `--rubrica`: acierto por fila. |
| `--auditar <id> -m M` | Revisor de sólo lectura del diff contra main (CRITICO/ALTO/MEDIO/BAJO). |
| `--integrar <id> [--tests]` · `--actualizar <id>` · `--descartar <id>` | Integrar (rebase + fast-forward), resolver choque de rebase, borrar rama (**destructivo: exige OK del dueño**). |
| `--bien <id> si\|no\|parcial` · `--leccion` | Anotar resultado; lección durable del proyecto (tope 30 líneas). |
| `--max-turns N` · `--max-budget-usd N` | Topes por corrida. |

`PA_PUESTOS=8` permite 8 workers escribiendo en paralelo por proyecto (el dueño prefiere eso a encolar).

**Exit codes de `pa`:** 0 ok · 1 el worker falló · 2 uso (también `max`/fable sin OK) · 3 la rúbrica dice "no se lanza" · 75 puesto/tope ocupado · 76 límite de sesión de la suscripción · 77 API sobrecargada · 78 sin `RESULTADO` · 79 `--integrar` se niega (archivo sin commitear del dueño que la rama toca) · 80 choque al rebasear · 82 la corrida murió sin resultado · 86 trabajo sin commitear en el worktree · 87 no hay worktree · 93 `--integrar --tests` en rojo · 95 modelo local/dsh/opencode no disponible · 96 sin cupo / modelo no disponible · 97 OpenCode cortó por límite de uso (ese modelo queda enfriado `PA_ENFRIAR_HORAS`, default 5) · 130 matado.

### 1.1 Modelos habilitados hoy en Ajustes de Trama

Lo que está apagado **no se usa nunca**, ni como plan B.

| Modelo | Efforts habilitados | Índice AA | Costo | Notas medidas |
|---|---|---|---|---|
| `claude-opus-5-5` | medium, high | 53.6 | alto, ~1.7 a 5 US$/corrida a precio de lista | Rinde mejor en `medium` que en `high` en esta instalación. |
| `claude-sonnet-5-5` | sólo high | 46.8 | ~1 a 1.5 US$ | Compacta en ~50 % de corridas grandes. |
| `claude-haiku-5-5` | medium, high, xhigh, max | 37.8 | ~0.15 a 0.5 US$ | **Default para lo que se describe con precisión.** Compactaba en 36 % de `codigo-acotado` y 68 % de `frontend`. |
| `gemini-4-argon-{medium,high}` | medium, high | 52.6 | 0 US$ (cupo Google) | Casi Opus, 1M de contexto. En código: pocas corridas y 0 % ok. **Sin cupo hasta ~1 de noviembre.** |
| `gemini-3.8-flash-high` | high | 40.9 | 0 US$ (cupo Google) | Deja trabajo a medias, 150+ turnos en código, 0 % ok en 3–4 corridas. Sólo lectura/mecánico con chequeo. |
| `opencode:opencode/glm-5.3-flash-free` | (variant) | 41.8 | gratis | El mejor de los gratis. Se corta por límite sin aviso (exit 97). |
| `opencode:opencode/mimo-v2.6-flash-free`, `deepseek-v4.1-flash-free` | (variant) | 37.9 / 40.1 | gratis | Mismos cortes. Remotos. |

Excluidos siempre: `agy:gpt-oss-120b-medium` (no sigue el contrato), el resto de gratis de OpenCode (`beam`, `flint`, `nemotron`, `big-pickle`), `ollama:` (ocupa toda la VRAM; pide permiso), `max` fuera de Haiku, `fable`, y cualquier uso de `ANTHROPIC_API_KEY` en el `claude` oficial (dispara créditos extra).

**Ventana de contexto de los workers [EN CONSTRUCCIÓN]:** configurable en Ajustes de Trama, Haiku 300k por defecto, el resto la nativa. Hasta hoy Haiku compactaba a ~100k de contexto: **el tope de 40 KB de lectura y las tasas de compactación medidas son de esa época**. Ver riesgos (sección 10).

### 1.2 Datos medidos (30 días, `ok%` = integrada sin retrabajo del dueño)

| Tipo | Modelo y effort | n | ok% | Costo medio | Compactó |
|---|---|---|---|---|---|
| codigo-acotado | Haiku xhigh | 67 | 51 % | 0.24 US$ | 36 % |
| codigo-acotado | Opus medium | 71 | 52 % | 1.73 US$ | — |
| codigo-acotado | Sonnet high | 108 | 38 % | 0.99 US$ | — |
| frontend | Haiku xhigh | 19 | 56 % | 0.49 US$ | 68 % |
| frontend | Sonnet high | 268 | 30 % | 1.55 US$ | — |
| frontend | Opus high | 38 | 24 % | 5.03 US$ | — |
| debug | Haiku xhigh | 5 | 60 % | — | — |
| debug | Sonnet high | — | 37 % | — | — |
| codigo-multi | Sonnet high | — | 32 % | — | 46 % |
| codigo-multi | Opus high | — | 18 % | — | 82 % |

Lectura honesta: ningún (tipo, modelo) pasa de ~55 %. La muestra de Haiku es chica y su tasa depende de cuán partida venía la tarea.

### 1.3 Restricciones duras

- Ahorro de suscripción: modelo y effort mínimos que alcancen. Opus sólo para bases de las que cuelga lo demás, bug sin pista, tarea enorme o crítica, o tras un fallo de chequeo por estimación. Nada de `max` ni `fable` sin OK explícito del dueño.
- Corridas en sombra sólo con modelos gratis; nunca gastando cupo de Claude.
- Destructivo o irreversible (incluye `pa --descartar`): confirmar con el dueño antes.
- Los gratis de OpenCode son remotos: no mandarles trozos con claves, `.env` ni datos del usuario (esos trozos van a Haiku). En agy, compartir datos para mejorar el producto está apagado.
- Release e instalaciones las hace el líder en el árbol principal, después de integrar. Sin líneas de atribución en commits.
- Lo dependiente no va en paralelo: A → integrar A → lanzar B.

---

## 2. Cuándo aplica cada camino

| Pedido | Camino |
|---|---|
| **Trivial**: tamaño chico (1 archivo, ≤15 KB de lectura) y **ya existe** un chequeo que da rojo en main (test, grep, typecheck) | Directo: brief mínimo, el modelo que dé la rúbrica (casi siempre Haiku xhigh), gate (F6) sin test congelado. Sin F1–F4. |
| **Vía rápida**: chico o mediano, `E = sí` (lugar conocido), `D = bajo`, localizable con un comando local (`grep -rn`, `git ls-files`) o un `--leer` puntual, y hay que escribir un test | Sección 3.2: un solo worker, dos commits (test y código), gate retroactivo. Sin F1–F4. |
| **Protocolo completo**: `codigo-multi`, varias partes, `E = no`, `D = alto`, más de 3 archivos o más de 40 KB de lectura | Fases F0–F8 (sección 4), con T0 si toca i18n/tipos compartidos. |
| **Bug sin pista** | F2 variante debug (abanico de hipótesis con prueba de sólo lectura). Con una hipótesis confirmada, `E = sí` y sigue por vía rápida o completa según el alcance. |
| **Diseño, decisiones de rumbo** | No se parte en Haikus. Líder u Opus medium. |

El líder arma `00-pedido.md` con tipo, tamaño, riesgo y camino elegido (F0), y no cambia de camino a mitad sin anotarlo.

---

## 3. Estado en disco y vía rápida

### 3.1 Estado en disco [HOY, a mano]

El líder también compacta (200k). Todo el estado de una tarea vive en archivos, no en el chat, así un líder compactado retoma leyendo `estado.tsv`.

```
~/.local/state/pa/<proyecto>/tareas/<slug>/
  00-pedido.md      pedido + triage (tipo, tamaño, riesgo, camino)
  10-mapa.tsv       trozos de lectura: área, bytes
  11-hechos.md      sólo hechos que pasaron hechos-check, con ±8 líneas de contexto
  20-plan.md        subtareas atómicas
  Tn.brief.md       brief de cada subtarea
  Tn.test.*         test aprobado (congelado) de la subtarea
  Tn.gate.test.*    test espejo oculto: `pa --espejo` lo mueve a espejos/ (abajo) y el worker no lo ve
  Tn.permitidos     lista de archivos que Tn puede modificar
  intento-<id>-<n>.patch   diff de intentos descartados
  estado.tsv        subtarea · intento · id · modelo · effort · exit · gate · US$
                    + A,B,C,D,E (+M,I) · fila · modelo estimado · modelo integrado · pregunta corregida
~/.local/state/pa/<proyecto>/base-<sha>.txt     tests rojos de main en ese sha
~/.local/state/pa/<proyecto>/espejos/<id>/      Tn.gate.test.* movido por `pa --espejo` (fuera de tareas/; el worker tiene deny de Read/Bash ahí)
```

### 3.2 La vía rápida (una sola corrida, dos commits) [AGREGAR: el gate; HOY: el resto]

Reemplaza F1–F4 cuando el lugar del cambio ya es conocido. Un solo worker (rúbrica: casi siempre Haiku xhigh) recibe un brief con este contrato:

1. Escribí el test en `<ruta-test>` y commitealo solo (`test: ...`). Tiene que fallar por la aserción, no por un import roto.
2. Implementá sin tocar las aserciones del test y commiteá (`fix:`/`feat:`).
3. `Cómo verificar: <comando>`; esperado: verde. El líder lo va a correr igual.

El **gate de vía rápida** (sección 8) comprueba por script: (a) el test del primer commit, aplicado sobre un worktree limpio de `main`, **da rojo** y por aserción; (b) el archivo de test **no cambió después** del primer commit (salvo agregar aserciones); (c) en el HEAD de la rama **da verde**. Eso conserva la garantía "el test daba rojo en main" sin lanzar un worker aparte para el test ni dejar ramas de F4 sin integrar.

Costo evitado: la mitad de las corridas de Haiku y los turnos del líder en F1–F4. Costo asumido: el mismo modelo escribe test e implementación, así que el test puede ser más débil (ver tests tautológicos en la sección 7: el espejo oculto y los anti-patrones están para eso). Por eso la vía rápida es sólo para `D = bajo`.

---

## 4. Fases del protocolo completo

Ocho fases. Sólo F2 (lectura) y F5 (implementación de subtareas independientes) van en paralelo. Todo lo que decide (F0, F3, F6, F8) lo hace el líder, y lo que acepta o rechaza es siempre un comando, no la opinión de un modelo.

```
F0 triage → F1 mapa → F2 lectura (abanico) → F3 plan [T0 primero] → F4 test → F5 implementación (abanico)
                                                    ↑                                  ↓
                                                    └── compactación / partición mala ─ F6 gate ── verde → [F7 audit] → F8 integrar
                                                                 rojo → un --seguir con el error real → si falla otra vez: clasificar (sección 7)
```

| Fase | Quién | Entra | Sale | Estado |
|---|---|---|---|---|
| **F0 Triage** | Líder, sin worker | El pedido | `00-pedido.md`: tipo, tamaño (archivos y KB), riesgo, camino (sección 2). Riesgo alto = toca una base de la que cuelga otra cosa, datos del usuario, seguridad, migraciones, `nucleo.ts`/`puente.ts`. | [HOY] a mano |
| **F1 Mapa** | Líder, script | Rutas del área | `10-mapa.tsv`: trozos de ≤40 KB, con `git ls-files <área> \| xargs wc -c` agrupando por directorio. Un archivo solo >40 KB es un trozo grande: nunca a un Haiku/gratis. | [HOY] a mano; `trozos` [AGREGAR, baja] |
| **F2 Reconocimiento** | Abanico `--leer`, hasta ~10 en paralelo | Un trozo + las preguntas de F0 | Líneas `HECHO: <ruta>:<línea> \| <texto literal de la línea> \| <qué significa>` y `NO ENCONTRADO: <qué busqué y dónde>`. Pasan por `hechos-check` y sólo los OK van a `11-hechos.md`, **con ±8 líneas de contexto** que el propio script extrae del disco. | `--leer` [HOY]; `hechos-check` [AGREGAR] |
| **F2 debug** | Abanico `--leer` | Síntoma | `HIPOTESIS: causa \| PRUEBA: comando de sólo lectura \| ESPERADO: salida si es cierta`. El líder corre las pruebas; la confirmada entra al plan como hecho (`E = sí`). | [HOY] |
| **F2b Externo** | `--leer` | Docs/APIs fuera del repo, archivos >40 KB | Hechos con fuente. | [HOY] |
| **F3 Plan** | Líder (segunda opinión si riesgo alto) | `11-hechos.md` (hechos con contexto, no el código completo) | `20-plan.md`, una entrada por subtarea (abajo). Primero se define **T0** si hay claves i18n o tipos compartidos nuevos. | [HOY] a mano |
| **F4 Test primero** | Haiku, sólo si el comportamiento no tiene ya un test o grep que lo cubra | Brief de F4 | `Tn.test.*` aprobado y congelado (≤50 líneas) y, si aplica, `Tn.gate.test.*` (espejo). El líder lo lee y confirma rojo **por la aserción**. La rama de F4 no se integra: el test viaja dentro del brief de F5. | [HOY]; espejo [HOY: `pa --espejo`] |
| **F5 Implementación** | Modelo según la rúbrica, paralelo si no hay dependencias ni archivos calientes comunes | `Tn.brief.md` | Rama con commits chicos, uno por paso. | [HOY] |
| **F6 Gate** | Líder, script | Rama + `Tn.permitidos` + test | Verde o rojo con evidencia; el exit dice qué paso falló (sección 7). | v1 [HOY]; v2 [AGREGAR] |
| **F7 Auditoría** | Modelo de OTRA familia que el autor | `pa --auditar <id> -m M` | Hallazgos CRITICO/ALTO/MEDIO/BAJO; el líder verifica cada uno con un comando antes de actuar. Sólo riesgo alto, o subtarea que terminó en Opus. | [HOY] |
| **F8 Integración** | Líder, de a una, en orden de dependencias | Rama con gate verde | `--integrar --tests`; si 80 → `--actualizar` → gate de nuevo (el rebase cambió el código) → integrar. Recién con la dependencia en main se lanza la siguiente. Cierre: `pa --bien`, `--leccion` si hay patrón nuevo, release a cargo del líder. | [HOY] |

### 4.1 Entrada de `20-plan.md`

```
## T2 Botón de reintento en la barra
Depende de: T0, T1
Leer: app/src/barra/Barra.tsx (9.8 KB), app/src/barra/estado.ts (4.1 KB)     # total ≤ 40 000 bytes
Modificar: app/src/barra/Barra.tsx, app/src/barra/Barra.test.tsx              # ≤ 3 archivos, sin i18n (lo hizo T0)
Calientes: —                                                                  # i18n, index.css, puente.ts, nucleo.ts...
Chequeo: npx vitest run app/src/barra/Barra.test.tsx                          # tiene que dar ROJO en main
Rúbrica: A=chico B=ejecutar C=completo D=bajo E=si  → fila 10 → claude-haiku-5-5 xhigh
```

**Formato que lee `gate --plan`** (definido acá porque antes sólo había el ejemplo): cada subtarea abre con `## T<n> <título>` (`T0`, `T1`, `T0b`...); debajo, una línea por campo con la forma `Campo: valor`, en cualquier orden y con los que falten tratados como vacíos: `Depende de`, `Leer`, `Modificar`, `Calientes`, `Chequeo`, `Rúbrica`. `Leer` y `Modificar` son listas de rutas del repo separadas por coma (un `(9.8 KB)` al final de cada ruta es sólo comentario: los bytes se miden en `main`). `—` o `-` es "ninguno". Un comentario al final de la línea se separa con dos o más espacios y `#`. `Chequeo` es un comando de shell que se corre desde la raíz del repo (puede ir entre comillas invertidas). `Calientes` y `Rúbrica` los escribe el líder para sí; el gate calcula los calientes y no lee la rúbrica. Todo lo que no sea `## T…` ni un campo se ignora.

Reglas de partición: una subtarea = un área, ≤40 KB de lectura, ≤3 archivos a modificar, un chequeo propio. Si no se puede escribir el chequeo, está mal partida o es diseño.

### 4.2 T0: subtarea de claves i18n y tipos compartidos [AGREGAR: regla en el skill]

En Trama casi todo cambio de UI toca `app/src/i18n/{en,es}.ts`, y `t()` valida las claves contra el diccionario en el typecheck: una clave faltante rompe el build, así que "tolerar claves faltantes" está descartado. Eso consumía 2 de los 3 archivos permitidos por subtarea y serializaba el abanico de F5.

Regla: en F3, **el líder extrae todas las claves nuevas (con el texto final en es y en) y los tipos compartidos nuevos** de las subtareas T1…Tn a una subtarea previa **T0**, de tipo `mecanico` con modelo barato (`opencode:opencode/glm-5.3-flash-free`, plan B `claude-haiku-5-5 medium`; si el diccionario tiene datos que no deben salir, Haiku directo). Chequeo de T0: typecheck + `grep -c` de las claves (da 0 en main, o sea rojo). T0 se integra primero (minutos). Después T1…Tn corren en paralelo sin tocar i18n y el 3.er archivo vuelve a ser código real. Claves sin uso todavía no rompen el typecheck.

Costo para el líder: tiene que decidir los textos exactos en F3. Se paga una vez y evita el choque 80 en idiomas.

### 4.3 Modelo por fase

El líder pasa siempre `-m` y `--effort`: así `-m` gana sobre `reparto` y `minimo_por_tipo` (que clasifica por tipo, no por tamaño; es el origen de un frontend chico que terminó en Opus a 5 US$). `--tipo` se pasa con el tipo real, sólo para que `pa --rinde` mida. Y `--fase`/`--tarea` en toda corrida.

| Fase | `-m` (lista = plan B por infra) | `--effort` | `--tipo` | Por qué |
|---|---|---|---|---|
| F2 trozo ≤40 KB | `opencode:opencode/glm-5.3-flash-free,gemini-3.8-flash-high,claude-haiku-5-5` | Haiku: high | lectura | La salida se chequea línea a línea: una alucinación cuesta un relanzamiento, no un error en main. Trozos con claves/`.env`/datos del usuario: sólo Haiku. |
| F2 trozo >40 KB o F2b | `gemini-4-argon-medium,claude-sonnet-5-5` (Argon sin cupo hasta ~1/11: hoy Sonnet directo, o partir el archivo por rangos de línea para un lector chico) | Sonnet: high | lectura | 1M de contexto a 0 US$ cuando haya cupo. |
| F2 debug | `claude-haiku-5-5,claude-sonnet-5-5` | high | debug | El líder corre la prueba; un Haiku que se equivoca gasta ~0.2 US$. |
| F3 plan | El líder | — | — | Conoce tamaño y riesgo. Lee pocos KB. |
| F3 segunda opinión (riesgo alto) | `gemini-3.8-flash-high,claude-sonnet-5-5` con `--leer` | — / high | lectura | Otra familia que el autor del plan. Con preguntas concretas (dependencias faltantes, chequeos que no prueban lo que dicen); el líder verifica cada objeción con un comando. Argon no disponible hasta ~1/11. |
| F4 test | `claude-haiku-5-5` | xhigh | codigo-acotado | Un archivo, criterio claro: ejecutar, no diseñar. |
| F5 | Lo que dé la rúbrica | el de la fila | el real | — |
| mecánico (renombres, claves listadas) | `opencode:opencode/glm-5.3-flash-free,claude-haiku-5-5` | Haiku: medium | mecanico | Sólo con chequeo determinista (grep/conteo). |
| F7 auditoría | `gemini-3.8-flash-high` o un OpenCode (`glm-5.3-flash-free`) hasta que vuelva Argon; con Argon: `gemini-4-argon-high` | — | — | Familia distinta de Claude (el autor casi siempre es Claude). **Código con seguridad/datos del usuario: no a OpenCode (remoto); sí a Flash.** |
| F8 `--actualizar` | `claude-haiku-5-5` (Sonnet high si el choque es de lógica y no de agregados) | xhigh / high | mecanico | Un conflicto de agregados en i18n es mecánico. |

Topes por corrida: `--max-budget-usd` Haiku 1, Sonnet 3, Opus medium 4. `--max-turns 60` para Haiku como punto de partida. Opus high sólo con OK del dueño.

Avisos: `pa` avisa en cada lanzamiento de Haiku (debajo de 46 en AA). El brief de la sección 5 ya trae pasos numerados y comandos explícitos, que es lo que ese aviso pide.

---

## 5. Briefs entre fases

El brief base de `pa` tiene Objetivo / Archivos / Listo cuando / Cómo verificar / No tocar (sin los dos del medio `pa` avisa por stderr, no bloquea). Se amplía con **Contexto verificado**, **Pasos** e **Intento previo**. Tope: ≤4 KB de brief y ≤40 KB de lectura. Se pasa siempre con `--brief-archivo`.

**Lectura (F2):**

```
Objetivo:        responder <preguntas numeradas>
Archivos:        <trozo: rutas exactas, total N KB>. No leas fuera de esto.
Listo cuando:    cada pregunta tiene HECHOs o un NO ENCONTRADO.
Formato:         una línea por hecho, sin prosa:
                 HECHO: <ruta>:<línea> | <texto de esa línea, copiado tal cual> | <qué significa>
                 NO ENCONTRADO: <qué buscaste y dónde>
Cómo verificar:  el líder corre un script que compara cada texto con la línea citada.
                 Un hecho inventado invalida todo tu reporte.
No tocar:        todo (sólo lectura).
```

**Implementación (F5) en protocolo completo:**

```
Objetivo:           <qué queda distinto, 1-2 oraciones>
Contexto verificado:
  - <ruta:línea> <hecho de 11-hechos.md que aplica, con su bloque de contexto>   (máx. 15 líneas)
Archivos:           Leer primero: <rutas> (total N KB)
                    Podés modificar: <rutas exactas>
Pasos:
  1. Copiá <ruta de Tn.test.*> a <ruta del test> y commitealo sin cambios. (Con `--test-inline`: copiá el test de «Test que tiene que pasar, no lo modifiques:» en vez de la ruta.)
  2. <paso> → commit
  3. <paso> → commit
Listo cuando:       <comando> da verde.
Cómo verificar:     <comando exacto>; esperado: <salida>. El líder lo va a correr igual.
No tocar:           aserciones del test, archivos calientes, todo lo que no esté en "Podés modificar".
Si te trabás:       supuesto técnico → RESULTADO. Si falta algo del plan, DECISION
                    y terminá con lo commiteado, sin dejar nada a medias sin commitear.
```

**Implementación en vía rápida:** igual, pero los Pasos son "1. escribí el test y commitealo solo; 2. implementá sin tocar las aserciones; commit" (sección 3.2) y no hay "Copiá".

**Bloque de reintento** (sólo en `--seguir` o cuando se relanza con otro modelo):

```
Intento previo (id <ID>, <modelo>):
  Chequeo: <comando>
  Salida (≤20 líneas, recortada a la primera falla):
    ...
  git diff --stat main...<rama>:
    ...
  Qué falló según el líder: <una oración>
```

**Por qué cada cosa:** commit por paso baja el exit 86 y deja recuperable lo hecho si el worker compacta o choca con `--max-turns`. El test congelado viaja en el brief para que cualquier modelo, también uno re-puntuado, arranque de main con el mismo test. "El líder lo va a correr igual" saca el incentivo de inventar la `VERIFICACION`.

**Reglas de traspaso:** el líder nunca pasa logs, JSON ni la respuesta completa de un worker: pasa hechos verificados, líneas de `RESULTADO` y salida de comandos recortada. Los hechos van inline en el brief (el brief es autocontenido; el worker no gasta un turno en leerlos). `--leccion` no sirve para pasar estado entre fases: es para patrones durables del proyecto (ej.: "en `app/src/i18n` las claves nuevas van al final del objeto, en orden alfabético").

---

## 6. Rúbrica v2

### 6.1 Las cinco preguntas (más tres marcas opcionales)

El líder contesta por subtarea, leyendo el pedido y los hechos de F2; la tabla da modelo y effort. No se prueba de abajo hacia arriba.

| | Pregunta | Respuestas |
|---|---|---|
| **A** | ¿Qué tamaño tiene? Se cuentan los archivos a modificar **y** los KB de lectura (`wc -c` de los "Leer"); manda el mayor de los dos. **No cuentan** los tests (`*.test.*`, `*.extra.test.*`) ni las claves i18n de T0 (en/es): un cambio con su test sigue siendo 1 archivo. Los valores viejos 1, 2-3 y >3 valen como chico, mediano y grande | **chico**: 1 archivo y ≤15 KB · **mediano**: 2–3 archivos, o 15–40 KB · **grande**: >3 archivos, o >40 KB |
| **B** | ¿Ejecutar o decidir? | **ejecutar**: el brief dice qué y cómo · **decidir**: hay que elegir estructura, API o flujo |
| **C** | ¿Hay un chequeo que lo desmienta? | **completo**: test o script determinista que da rojo en main · **parcial**: typecheck + build, el resto a ojo · **ninguno** |
| **D** | ¿Cuánto cuesta un error? | **bajo**: local, se revierte sin daño · **alto**: base de la que cuelga otra cosa, datos del usuario, seguridad, migración, `nucleo.ts`/`puente.ts` |
| **E** | ¿La causa o el lugar del cambio son conocidos? | **sí**: hay un hecho verificado con archivo:línea · **no** |
| M | (opcional) ¿Sin lógica nueva? (renombre, claves listadas) | sí / no |
| I | (opcional) ¿Indivisible? Ya se intentó partir y no se puede (un solo archivo grande, o tipos acoplados que rompen el typecheck si se parten) | sí / no |
| K | (opcional, con I = sí) ¿Una corrida 1b anterior ya compactó? | sí / no |

La lógica: C dice si un error se ve antes de main; B y E dicen cuánto hay que pensar; D dice cuánto control extra pagar; A dice si entra en el contexto del modelo chico.

### 6.2 Tabla de decisión (gana la primera fila que aplique)

Si `~/.config/trama/modelos.json` apaga (`excluir`, `efforts_permitidos`) un modelo o effort que una fila devuelve, `pa --rubrica` no lo devuelve: sale 98 y dice qué está apagado.

| # | Condición | `-m` | `--effort` | Además |
|---|---|---|---|---|
| 2 | C = ninguno (va primero: gana aunque A sea grande o E = sí) | no se lanza | — | Escribir el chequeo (F4). Si es imposible (puro visual), tratar como C = parcial. |
| 1 | A = grande, **divisible** (I ≠ sí) | no se lanza | — | Volver a F3 y partir (o extraer T0). |
| 1c | A = grande, **indivisible** (I = sí) y **K = sí** | no se lanza | — | Pasar al dueño (tablero): la 1b ya compactó y partir otra vez no alcanza. |
| 1b | A = grande, **indivisible** (I = sí) y C ≠ ninguno | `claude-sonnet-5-5` (`claude-opus-5-5` si D = alto) | high (medium en Opus) | Tope de lectura 80 KB. Con D = alto, F7 obligatoria. Evita el bucle "no se lanza porque es grande / no se puede partir". Si la corrida compacta, la próxima vez es 1c, no otra partición. |
| 3a | E = no, D = alto | `claude-opus-5-5` | medium | Antes, F2 variante hipótesis (abanico). Si una se confirma, E = sí y se re-puntúa. F7 obligatoria. |
| 3b | E = no, D = bajo | `claude-sonnet-5-5` | high | Antes, F2 variante hipótesis. Si una se confirma, E = sí y se re-puntúa. Antes iba a Opus: Opus es para bases y fallos, no para un bug menor. |
| 4 | B = decidir, D = alto | `claude-opus-5-5` | medium | F7 obligatoria. Opus high sólo con OK del dueño. |
| 5 | B = decidir, D = bajo | `claude-sonnet-5-5` | high | — |
| 6 | C = parcial, D = alto | `claude-sonnet-5-5` | high | PROBAR para el dueño. |
| 7 | C = parcial, D = bajo, A = chico | `claude-haiku-5-5` | xhigh | PROBAR para el dueño. |
| 7b | C = parcial, D = bajo, A = mediano | **primero partir más chico** y volver a la fila 7 con cada pedazo. Sólo si I = sí: `claude-sonnet-5-5` | high | PROBAR para el dueño. Regla del dueño: no se sube frontend mediano a Sonnet por defecto; el 68 % de compactación de Haiku se ataca partiendo, no pagando más. |
| 8 | C = completo, D = alto, A = chico | `claude-haiku-5-5` | xhigh | F7 obligatoria, con otra familia. |
| 8b | C = completo, D = alto, A = mediano | **primero partir** y volver a la fila 8. Sólo si I = sí: `claude-sonnet-5-5` | high | F7 obligatoria, con otra familia. |
| 9 | C = completo, D = bajo, A = chico, M = sí | `opencode:opencode/glm-5.3-flash-free,claude-haiku-5-5` | — / medium | `--tipo mecanico`. Si el archivo pesa 25–40 KB (A = mediano) NO va a esta fila: los gratis se cortan a mitad. |
| 10 | C = completo, D = bajo (el resto) | `claude-haiku-5-5` | xhigh | Caso base. |

`claude-opus-5-5` va en `medium` porque en esta instalación rinde mejor que en `high`. Si no hay modelo gratis disponible, el plan B es el más barato habilitado (Haiku): gratis es preferencia, no requisito.

**Estado de `pa --rubrica` [HOY]:** implementa la tabla v2: A = chico/mediano/grande (los viejos 1, 2-3 y >3 se mapean), marcas I y K, filas 2, 1, 1c, 1b, 3a/3b, 7b/8b, fila 9 con M, y sale 98 si modelos.json apaga el modelo o el effort. Quien calcula A (wc -c, sin tests ni i18n T0) sigue siendo el líder. `gate --plan` ya calcula A y el piso de D (sección 8.2); **[AGREGAR]**: que `pa` calcule también las marcas I y M.

### 6.3 Medir la rúbrica

Cada subtarea anota en `estado.tsv` y en `medicion.tsv` (vía `pa --rubrica`): A–E (+M, I, K), fila, modelo estimado, modelo que terminó integrado y qué respuesta se corrigió, si hubo.

- **Acierto**: el modelo estimado es el que se integró sin re-puntuar.
- **Subestimación**: hubo que re-puntuar hacia arriba. Se anota qué pregunta falló; la que junte la mayoría de los errores se afina.
- **Sobreestimación**: no se ve sola. La v1 proponía lanzar 1 de cada 5 en sombra con el modelo de la fila de abajo; eso gastaba cupo de Claude en ramas que no se integran y obligaba a pedir `pa --descartar`. **v2: las corridas en sombra se hacen SÓLO con modelos gratis** (GLM/mimo/DeepSeek de OpenCode, Flash por cupo Google) y sólo cuando existe un equivalente gratis de la fila de abajo (típicamente filas 10 y 9). Para filas que mandan a Sonnet/Opus **no hay sombra**: se mide por proxy (subtareas que terminaron en Sonnet/Opus con gate verde al primer intento, pocos turnos y diff chico se marcan "sospechosas de sobreestimación" y se revisan). Limitación asumida: la sobreestimación en las filas caras queda poco medida.
- Revisión cada ~20 subtareas: acierto por fila, y se mueven filas o definiciones. El objetivo de acierto se fija después de las primeras 20.

---

## 7. Cuando una corrida falla

**Regla del dueño: nada de escalar probando.** Gastar más para que un modelo que falla siga fallando no ayuda. Hay **un solo reintento** con el error real; después se **clasifica** la falla. Sólo una clase cambia de modelo.

Paso 1: **un `--seguir --id` con la salida real del chequeo** (bloque "Intento previo", ≤20 líneas), mismo modelo, misma rama. Excepciones donde no corresponde reintentar: compactación o `--max-turns` (la tarea no entra: partir), el worker hizo otra cosa (brief malo), infra (exits 76/77/95/96/97).

Paso 2: si vuelve a fallar, o si no aplicaba el reintento, **clasificar**:

| Qué pasó | Qué fue | Qué se hace |
|---|---|---|
| Chequeo rojo, el diff toca lo correcto y falla un detalle | Error puntual; la estimación vale | El único `--seguir` del paso 1. Si ya se usó: clasificar de nuevo como brief o partición. |
| Hizo otra cosa o tocó fuera de alcance (gate 21) | Brief malo | Reescribir el brief. Mismo modelo, corrida nueva desde main. |
| Compactó o chocó con `--max-turns` | Partición mala | Volver a F3 y partir. Nada de `--seguir --force`. Gate sobre lo commiteado: verde → se acepta; rojo → partir. |
| Exit 76, 77 | Infra (cupo/API) | Mismo modelo por otra vía o esperar. No cambia de modelo. |
| Exit 95, 96, 97 | Modelo no disponible/cortado | Siguiente de la lista `-m a,b,c`; el cortado queda enfriado. |
| Exit 75 | Tope ocupado | `--async`: queda EN COLA. |
| Entendió y no pudo: había que decidir algo, la causa era otra o el riesgo era mayor | **La estimación falló** | Corregir la respuesta que estuvo mal (B, D o E; o A si compactó por tamaño) y **lanzar directo el modelo que da la tabla corregida**, desde main, con el bloque "Intento previo". Si la tabla da el mismo modelo, el problema no es el modelo: es brief o partición. |
| Tests/gate rojo por anti-patrón (25), espejo (26), no era rojo en main (27) | Trampa o test débil | Un reintento con el error real; si se repite, brief malo (el brief no dejó claro qué hace falta) o tarea con `C` sobreestimado. |

**Reciclar en la misma rama [AGREGAR, ~60 líneas en `pa`]:** cuando hay que relanzar desde main (brief malo, estimación corregida, partición nueva), `pa <p> --seguir --id ID --desde-main -m M` guarda `git diff main...rama` en `tareas/<slug>/intento-<ID>-<n>.patch`, resetea la rama y el worktree a main y corre el nuevo intento ahí. Así **no quedan ramas muertas ni hace falta pedir `pa --descartar`** (destructivo) por cada reintento, y `pa` no da falsas alarmas de choque entre ramas sin integrar. Hay que verificar que `destructive-guard` (hook que bloquea comandos catastróficos) acepte el reset dentro del worktree del worker.

**Exits que requieren al dueño** (`tablero agregar` con el exit y la línea del log): 79, 83, 87, 89, 90, 91.

**Se pide OK al dueño** (`tablero agregar`, la subtarea queda en pausa): antes de Opus high · si una subtarea acumula más de 3 US$ entre todos sus intentos · si dos o más subtareas de la misma tarea fallaron también con el modelo re-puntuado (el plan está mal, no los modelos: vuelve a F3 con el dueño al tanto) · cualquier `DECISION` de un worker.

### 7.1 Tabla de exits (qué hace el líder)

| Exit | Acción |
|---|---|
| 0 | Gate. |
| 1 | Leer el log y clasificar: ¿brief, infra o capacidad? Nunca relanzar igual a ciegas. |
| 75 | Relanzar con `--async`. |
| 76 / 77 | Infra: misma familia por otra vía, o esperar. No cambia de modelo. |
| 78 | Si chocó con `--max-turns` o compactó: partir. Si no: un `pa <p> --seguir --id <ID> 'Terminá: commiteá lo hecho y respondé con el bloque.'`. |
| 80 | `pa <p> --actualizar <ID>` → gate de nuevo → `--integrar`. |
| 82 | Relanzar una vez igual; si se repite, clasificar. |
| 86 | `--seguir "commiteá y reportá"`. Si compactó, gate directo sobre lo commiteado. |
| 93 | Comparar contra `base-<sha>.txt`. Sólo rojos previos y gate verde → integrar sin `--tests`. |
| 95 / 96 / 97 | Siguiente de la lista de fallback. |

`SIN VERIFICAR` en la `VERIFICACION` del worker es un indicio, nunca prueba: el gate corre el chequeo igual. Verde → se acepta y se anota en `estado.tsv`. Rojo → ver arriba.

---

## 8. Verificación determinista y gate v2

Tres compuertas, todas comandos que corre el líder: **hechos (F2)**, **plan (F3)** y **gate de cada corrida (F6)**.

### 8.1 Compuerta de hechos (F2): `hechos-check` [AGREGAR, ~50 líneas python + ~25 de contexto]

La versión v1 de este script tenía un bug: el formato del hecho tiene **tres campos** (`ref | texto | significado`) pero el script leía sólo dos (`IFS='|' read -r ref texto`), con lo cual el segundo `|` y el significado quedaban pegados al texto y **todos los hechos daban FALSO**. Además el texto de una línea de código puede traer `|` (uniones de tipos `string | number`, pipes de shell). La versión corregida toma la referencia hasta el primer ` | `, el significado desde el último y lo del medio es el texto. Probado a mano:

```python
#!/usr/bin/env python3
"""hechos-check <repo> < salida-del-worker: OK/FALSO por hecho; los OK salen con ±8 líneas de contexto."""
import pathlib, sys

repo = pathlib.Path(sys.argv[1]).resolve()
ok = total = 0
for linea in sys.stdin:
    if not linea.startswith("HECHO:"):
        continue
    total += 1
    partes = linea[6:].rstrip("\n").split(" | ")
    if len(partes) < 3:
        print("FALSO (formato) " + linea.strip()); continue
    ref, texto = partes[0].strip(), " | ".join(partes[1:-1]).strip()   # el texto puede traer " | "
    ruta, _, n = ref.rpartition(":")
    f = (repo / ruta).resolve()
    if not n.isdigit() or repo not in f.parents or not f.is_file():
        print("FALSO " + ref); continue
    lineas, n = f.read_text(errors="replace").splitlines(), int(n)
    if texto and texto in "\n".join(l.strip() for l in lineas[max(0, n - 4):n + 3]):   # tolerancia ±3 líneas
        ok += 1
        print(f"OK {ref}")
        for i in range(max(0, n - 9), min(len(lineas), n + 8)):                      # contexto ±8
            print(f"  {i + 1:>5}{'>' if i + 1 == n else ' '}{lineas[i]}")
    else:
        print("FALSO " + ref)
sys.exit(0 if total and ok * 10 >= total * 7 else 1)   # < 70 % OK: se tira el reporte
```

Sólo los OK pasan a `11-hechos.md`. Si menos del 70 % de los hechos de un trozo dan OK, el reporte se tira entero (un lector que inventa una línea probablemente inventó también la interpretación) y el trozo se relanza **una vez** con el siguiente lector de la lista; si falla otra vez, el problema es el trozo o las preguntas (partir, reformular), no el lector. Las ±8 líneas arreglan un segundo defecto: en F3 el líder planifica sin abrir el código, y un hecho con una sola línea no le da firmas multilínea, tipos de retorno ni imports.

### 8.2 Compuerta del plan (F3, antes de lanzar nada) [`gate --plan` HOY; a mano lo de abajo]

`gate <proyecto> --plan <slug> [--json] [--main REF] [--no-correr]` lee `tareas/<slug>/20-plan.md` (formato en 4.1) e imprime, por subtarea, **A** (chico/mediano/grande por `wc -c` de los "Leer" en main y cantidad de archivos de "Modificar", **sin tests ni archivos de T0**), el **piso de D** (alto si toca `nucleo.ts`, `puente.ts`, `preload`, `migrations/`, `.env` o `permisos`; "bajo" sólo dice que ninguna ruta lo sube, el líder puede subirlo), los **archivos calientes** (en el "Modificar" de más de una subtarea, con quién), los **KB de lectura** y si el **chequeo da rojo en main** (lo corre en el worktree limpio `/tmp/base-<sha>`; `--no-correr` lo saltea). El líder sólo contesta B, C y E. Exit 28 si una subtarea tiene un chequeo verde en main, lee más de 40 000 bytes o modifica más de 3 archivos (sin tests ni T0); 0 si no; 2 uso; 3 no encuentra proyecto, main o plan. Lo de abajo es lo mismo a mano:

```sh
wc -c <rutas "Leer" de Tn> | tail -1                          # total ≤ 40000
comm -12 <(sort T1.mod) <(sort T2.mod)                        # vacío entre subtareas paralelas
sha=$(git -C $repo rev-parse --short main)
git -C $repo worktree add --detach /tmp/base-$sha main        # tree limpio de main
(cd /tmp/base-$sha && <Chequeo de Tn>); echo $?               # tiene que dar ≠0 (ROJO)
git -C $repo status --porcelain                               # vacío antes de F4/F5: el worker no ve lo sin commitear
```

Un chequeo que da verde en main no prueba nada: se reescribe antes de gastar un worker. Para un test nuevo de F4 el rojo se comprueba en la rama de F4, mirando que falle la aserción y no un import.

**Chequeo parcial en frontend [SIN DECIDIR]:** para un componente que ya existe, `typecheck` y `build` dan verde en main y sólo un `grep` podría dar rojo; si el cambio es de layout/estilo de algo existente, el grep da verde y la compuerta rechaza el plan. Y en un componente nuevo un Haiku puede pasar el gate con sólo nombrar el componente. Propuesta de Argon: un test de render (Vitest, props/clases/callbacks) que da rojo real en main, sin navegador ni GPU. Costo chico (plantilla en el skill + regla en F3). Falta decidir si el proyecto tiene la infraestructura de test de componentes.

**Bugs intermitentes:** una corrida única del chequeo puede dar verde en main por azar (se descarta un test válido) o verde en F6 por casualidad (se integra el bug). Ver `--repetir K` abajo.

### 8.3 Gate de cada corrida (F6): `motor/bin/gate`

**Firma real [HOY, v1]:** `gate <proyecto> <id> --chequeo CMD --permitidos F [--test COPIA[:RUTA]] [--extras CMD] [--rojos CMD] [--main REF] [--log F]`. Corre los pasos aunque alguno falle (así el reintento lleva toda la evidencia) y sale con el exit del primer paso que falló. Si la rama ya no tiene worktree saca uno desechable en `/tmp/gate-<id>`.

| Paso | Qué comprueba | Exit | Estado |
|---|---|---|---|
| 1 alcance | Los archivos que la rama cambió contra main están todos en `--permitidos` (ruta exacta, `dir/` o glob) | 21 | [HOY] |
| 2 test congelado | (Sólo con `--test`) Pisa en el worktree con la copia del plan (no compara byte a byte) y corre chequeo/rojos con esa; si no hay ruta única falla. Sin `--test` se saltea | 22 | [HOY] |
| 3 chequeo | `--chequeo CMD` (o extras con `--extras CMD`) corre en el worktree de la rama y da exit 0 | 23 | [HOY] |
| 4 rojos nuevos | `--rojos CMD` en la rama y en main (base por sha en `base-<sha>.txt`): lo que falla en la rama y no en main es nuevo | 24 | [HOY] |
| 1c anti-patrón | Anti-patrones en las líneas agregadas del diff (`@ts-ignore`, `as any`, `.skip(`, `.only(`, etc.) | 25 | [HOY] |
| 1b snapshot | Un `__snapshots__/` cambiado tiene su ruta nombrada explícita en `--permitidos` | 26 | [HOY] |
| 5 compactación | Con `--log F`, avisa si el worker compactó. Es aviso: el gate juzga el código, no la memoria del worker | — | [HOY] |

Otros exits: 0 verde · 2 uso · 3 no resuelve proyecto/rama/main/archivos del gate · 21 fuera de lo permitido · 22 test congelado sin ruta única · 23 el chequeo (o un extra) dio rojo · 24 rojos nuevos contra main · 25 anti-patrón en lo agregado · 26 snapshot sin ruta explícita en --permitidos. Sin `--test` es el camino trivial: no hay test congelado y se saltea.

**Cuatro maneras en que el gate v1 da verde con trabajo malo**, y cómo se cierran **sin LLM (0 US$)**:

| Trampa | Cierre v2 [AGREGAR, todo en `gate`] | Exit (propuesto) | Tamaño |
|---|---|---|---|
| El worker silencia errores en vez de arreglarlos (`@ts-ignore`, `as any`, `eslint-disable`, `.skip`/`.only`), sobre todo con chequeo parcial (typecheck + build) | **Anti-patrones**: se rechazan las líneas agregadas (`^+`) del diff completo de la rama contra main que contengan `@ts-ignore`, `@ts-expect-error`, `as any`, `eslint-disable`, `.skip(` o `.only(` | 25 | ~15 líneas |
| Test débil o tautológico (`expect(typeof f).toBe('function')`) que el worker satisface con un stub | **Test espejo oculto**: junto al test visible, `Tn.gate.test.*` con otros valores de entrada/salida. Vive fuera de `tareas/`: `pa --espejo <Tn.gate.test.*>` lo mueve a `espejos/<id>/` e imprime esa ruta; los settings del worker le niegan Read y los Bash que nombren ese directorio (best-effort: un patrón de Bash no cierra un `find` sobre `~/.local`). El gate lo copia al worktree y lo corre (flag `--espejo` del gate: pendiente, paso 26). Detecta código hardcodeado a medida (`if (x === 'caso') return ...`). Lo escribe el mismo F4 (un Haiku) y el líder lo aprueba; en vía rápida lo escribe un Haiku aparte que sólo ve el brief | 26 | ~15 líneas (+ una corrida chica de Haiku) |
| Hardcoding contra el test congelado (idem) | (cubierto por el espejo) | 26 | — |
| `cmp` byte a byte rechaza al worker que legítimamente agrega un caso de borde o actualiza un mock compartido en un archivo de test existente | **Proteger aserciones, no el archivo**: el paso 2 pasa a comprobar que **toda línea de aserción** (`expect(`, `assert`) de la copia congelada sigue presente e intacta en el archivo de la rama; se permite agregar | 22 | ~10 líneas |
| Bug intermitente (race, timeout, IPC): una corrida da verde por azar | **`--repetir K`** (para tipo debug): en F3 el chequeo debe fallar **al menos 1 de K** veces en main; en F6 debe pasar **K de K** | 23 | ~20 líneas |

**Vía rápida en el gate** (`--via-rapida`, ~35 líneas): toma el test del primer commit de la rama que lo agrega, lo aplica sobre un worktree limpio de main y exige **rojo** (exit 27 si da verde o si el rojo es por import roto); comprueba que el test no cambió después (mismo criterio de aserciones que el paso 2) y exige **verde** en HEAD. Sin esto, la vía rápida no es verificable.

**Espejo y test inline en la corrida de F5 [HOY]:** `pa <p> --tarea <slug> --subtarea Tn --brief-archivo tareas/<slug>/Tn.brief.md --test-inline tareas/<slug>/Tn.test.* --espejo tareas/<slug>/Tn.gate.test.* …`. `--test-inline` pega el test congelado al final del brief, bajo «Test que tiene que pasar, no lo modifiques:», así el brief no lleva su ruta. `--espejo` mueve el espejo a `espejos/<id>/` (una sola vez, también con `-m a,b,c`) y pone en stderr la ruta final, que va al gate. Lo que todavía no hay: el flag `--espejo` en `gate`, y que el deny sea a prueba de un `find` (ver arriba). Un reintento (`--seguir`) pasa la misma ruta impresa y no vuelve a mover el archivo.

**Otras mejoras del gate [AGREGAR]:** `--test` opcional (tareas triviales, ~5 líneas); paso 0 `git status --porcelain` del árbol principal vacío (evita el exit 79 al integrar y el worker que no ve cambios del líder, ~5 líneas); los exits 25–27 propuestos no chocan con los de `pa`.

**Candidatos adicionales sobre anti-patrones [SIN DECIDIR]:** `: any` (sin `as`), funciones vacías `{}`, comentar bloques enteros. Más estrictos = más falsos positivos; no están adoptados.

**Base de rojos y tests de main:** hoy `main` tiene **8 tests rojos que son del entorno** (OpenCode sin login en esta máquina). Mientras estén, `--integrar --tests` da 93 siempre. Decisión: arreglarlos primero, como subtarea normal (pasan a ser el paso previo P0 de la sección 9). Con main en verde, `--integrar --tests` alcanza y la base de rojos por sha queda como respaldo. `<extraer rojos>` depende del runner: `vitest --reporter=json` + `jq -r '.testResults[].assertionResults[] | select(.status=="failed") | .fullName'`; TAP: `grep '^not ok'`.

**Compactó pero el gate da verde:** se acepta. Con riesgo alto, además F7. **F7 sin Argon:** la auditoría la hace un modelo débil (Flash high o un gratis); su valor es una segunda lectura independiente, no el veredicto. El líder verifica cada hallazgo con un comando.

---

## 9. Qué falta construir, con prioridad y tamaño

**Ya construido (en `main`):**

| Pieza | Detalle |
|---|---|
| `motor/bin/gate` | 5 pasos, exits 21–24 (sección 8.3). |
| `pa -m a,b,c` | Fallback por infra (76/77/95/96/97), saltea modelos enfriados. |
| Exit 97 y enfriamiento | OpenCode cortó por límite: `reparto --enfriar` N horas (default 5). |
| `--fase` / `--tarea` | Columnas en `medicion.tsv`; `pa --rinde --por fase\|tarea`. |
| `pa --rubrica` | Tabla v2 (sección 6); `pa --rinde --rubrica` mide acierto por fila. |
| `reparto --resumen` | Se imprime al arrancar el líder (modelos habilitados). |

**Falta:**

| # | Cambio | Dónde | Tamaño | Prioridad |
|---|---|---|---|---|
| P0 | Arreglar los 8 tests rojos de entorno de `main` (OpenCode sin login): saltearlos si no hay login, o mockearlos | tests | chico | **Alta, bloqueante**: sin esto `--integrar --tests` da 93 siempre |
| 1 | `gate` v2: anti-patrones (25), aserciones protegidas (22), espejo (26), `--repetir K`, `--via-rapida` (27), `--test` opcional, `git status` limpio | `motor/bin/gate` | ~110 líneas bash | **Alta**: habilita vía rápida y cierra las trampas |
| 2 | Actualizar `rubrica_resolver` a v2: A en KB, marca I, filas 1b/3a/3b/7b/8b | `pa` | ~30 líneas | **Alta** (chica): sin esto la rúbrica de `pa` y la de este documento divergen |
| 3 | Sección "protocolo por fases" en el skill del líder: tabla v2, plantillas, vía rápida, T0, una sola fuente de verdad de modelos (hoy chocan `CLAUDE.md` "ante la duda Haiku", perfil `ahorro` y `minimo_por_tipo`) | `motor/skills/trama-orquestar` | ~200 líneas de texto | **Alta** |
| 4 | `--desde-main` en `--seguir`: guarda `.patch`, resetea la rama a main | `pa` | ~60 líneas | Media-alta: evita ramas muertas y pedidos de `--descartar` |
| 5 | `hechos-check` (script de 8.1) | `motor/bin` | ~75 líneas python | Media: no hace falta para el experimento (F3–F6 + vía rápida); sí para F2 en `codigo-multi` |
| 6 | ~~`gate --plan` (compuerta del plan)~~ **hecho**: calcula A, piso de D, calientes, KB y rojo en main (8.2) | `motor/bin/gate` | ~40 líneas | Media |
| 7 | Regla de test de render para frontend (si el proyecto lo soporta) | skill + F3 | chico | Media, **sin decidir** |
| 8 | `trozos <repo> <rutas> --max 40000` | `motor/bin` | ~40 líneas | Baja: `git ls-files \| xargs wc -c` alcanza |
| 9 | `--integrar --tests --base` (falla sólo con rojos nuevos contra main) | `pa` | ~80–150 líneas | Baja: con P0 hecho, es respaldo |
| 10 | `pa --receta tareas/<slug>/plan.tsv`: lanza en orden de dependencias, gate automático, modelo por rúbrica, para en los OK | `pa` o script | ~500–800 líneas | Baja: sólo después del experimento (código rígido si el protocolo todavía cambia) |
| 11 | Ventana de contexto de workers en Ajustes (Haiku 300k, resto nativa) | app | — | **[EN CONSTRUCCIÓN]** |
| 12 | Que `pa -m` rechace (o saltee en la lista) los modelos/efforts apagados en Ajustes | `pa`/`reparto` | por ver | A verificar: hoy no se sabe si lo hace |

Argon sugirió posponer el flag `--rubrica` (ítem ya construido) a favor de un `awk` sobre `estado.tsv`; ya está hecho y se usa, así que no se revierte.

---

## 10. Medición y experimento de validación

### 10.1 Unidad y métricas

La unidad es la **tarea madre** (el pedido del dueño), no la corrida: el protocolo lanza más corridas a propósito, y medido por corrida parecería peor aunque gane. Un `--seguir` automático del líder suma costo pero no cuenta como retrabajo; retrabajo es que el dueño tenga que intervenir.

| Métrica | De dónde sale |
|---|---|
| Integrada sin retrabajo del dueño | `pa --bien si\|no\|parcial` por tarea madre |
| Costo de workers (US$ de lista, todas las fases) | `pa --rinde --por tarea --json`, o sumando los ids de `estado.tsv` |
| **Costo del líder** (% del cupo 7 d de Claude y US$ equivalentes) | `reparto --cupos` antes y después de la tarea, **incluyendo los turnos de coordinación del líder** |
| Re-puntuaciones y corridas por tarea | `estado.tsv` |
| Tiempo de pared (primer lanzamiento → integración) | `estado.tsv` |
| % de hechos OK por modelo lector | salida de `hechos-check` |
| Acierto de la rúbrica por fila | `pa --rinde --rubrica` |
| Camino usado (trivial / vía rápida / completo) y por qué | `00-pedido.md` |
| Ventana de contexto configurada del worker | anotarla en cada corrida (cambia las tasas de compactación) |

### 10.2 Experimento mínimo (antes de adoptar)

Se valida el núcleo (F3–F6 con la rúbrica, y la vía rápida), que es la hipótesis más fuerte: **"rúbrica + chequeo rojo primero + gate" iguala o supera a "el flujo de hoy" a menos costo.**

1. Elegir **8 tareas reales** chicas o medianas (`codigo-acotado` o `frontend` chico) del tablero. Idealmente 4 que califiquen para vía rápida y 4 para el camino completo.
2. Cada tarea corre **dos veces en paralelo**, en worktrees separados: **brazo A** = como hoy (`reparto` elige el modelo, un brief); **brazo B** = protocolo v2 (camino según sección 2). Comparar sobre la misma tarea quita la varianza de dificultad, que con n = 8 lo taparía todo.
3. El dueño elige qué integrar viendo "X" e "Y" **sin saber cuál es cuál**. La otra rama se descarta con su OK.
4. **Gana B** si su tasa de "integrada sin retrabajo" es ≥ la de A y su **costo total ≤60 % del de A, contando workers y el cupo del líder**. Secundario (no bloquea): tiempo de pared de B ≤ 1.5× el de A.

Con n = 8 esto es un filtro de "vale la pena seguir", no una prueba estadística. Si pasa, se extiende a 20 tareas sumando F2 (abanico) en `codigo-multi`. Si el costo del líder se come la ventaja, se reduce a vía rápida + trivial y se repite.

Experimento paralelo y barato: los mismos 3 trozos de lectura a `glm-5.3-flash-free`, `mimo-v2.6-flash-free`, `gemini-3.8-flash-high` y `claude-haiku-5-5 high`, midiendo % de hechos OK con `hechos-check`. Eso decide el lector por defecto de F2 con datos en vez de por índice AA.

### 10.3 Ejemplo de vía rápida (ilustrativo)

Tarea: "El botón de reintento de la barra no reintenta si el estado es `error`." Lugar conocido (`app/src/barra/Barra.tsx`), un test existente cercano, `D = bajo`.

```sh
# F0: 00-pedido.md  →  A=chico B=ejecutar C=completo D=bajo E=si
pa --rubrica 'A=chico B=ejecutar C=completo D=bajo E=si'       # fila 10 → claude-haiku-5-5 xhigh
# El líder localiza con un comando, escribe el brief (2 commits: test, fix) en tareas/<slug>/T1.brief.md
pa trama --async --tipo frontend --fase F5 --tarea reintento-barra -m claude-haiku-5-5 --effort xhigh \
   --max-turns 60 --max-budget-usd 1 --brief-archivo ~/.local/state/pa/trama/tareas/reintento-barra/T1.brief.md
pa --esperar trama --id <ID> --timeout 1800
# Gate (flags v1 reales + --via-rapida [AGREGAR])
gate trama <ID> --chequeo 'npx vitest run app/src/barra/Barra.test.tsx' \
     --permitidos tareas/reintento-barra/T1.permitidos --test tareas/reintento-barra/T1.test.tsx:app/src/barra/Barra.test.tsx \
     --rojos '<comando que lista rojos>' --log <log del worker> --via-rapida
pa trama --integrar <ID> --tests        # 80 → pa trama --actualizar <ID> → gate de nuevo → --integrar
pa --bien <ID> si
```

El ejemplo completo del protocolo de 8 fases (con T0, abanico de F2 y sus briefs) está pendiente: falta un problema real del dueño escrito.

---

## 11. Fallos conocidos: prevención y respuesta

| Fallo | Prevención | Si pasa igual |
|---|---|---|
| **Compactación** | F3: ≤40 KB de lectura medidos con `wc -c`, ≤3 archivos, `--max-turns` | Nada de `--seguir --force`. Gate sobre lo commiteado: verde → se acepta; rojo → partir. No cambia de modelo. |
| **Trabajo a medias / sin commitear (86)** | Commit por paso; "no dejes nada sin commitear" en "Si te trabás" | `--seguir "commiteá y reportá"`. El gate de alcance detecta lo que tocó de más. |
| **Sin RESULTADO (78)** | `--max-turns` acorde al tamaño; tareas chicas | Tabla de exits. |
| **Cortes de OpenCode** | Los gratis sólo en F2 y mecánico, nunca en el camino crítico | `-m a,b,c` + exit 97 + enfriamiento [HOY]. |
| **Cupo de Google agotado** (429 RESOURCE_EXHAUSTED, Argon sin cupo hasta ~1/11) | `reparto --cupos` / `pa --cupo-gemini` antes de lanzar un abanico o F7 sobre agy | Pasa al siguiente de la lista (Claude). |
| **Conflictos en archivos calientes** (`i18n/{en,es}.ts`, `index.css`, `puente.ts`, `nucleo.ts`, `docs/traspaso.md`) | T0 saca i18n/tipos del abanico; F3 marca `Calientes:`; dos subtareas con el mismo caliente no van en paralelo (A → integrar → B) | 80 → `--actualizar` (Haiku si son sólo agregados) → gate de nuevo. |
| **Tests rojos preexistentes** | P0: arreglar los 8 de main | Base por sha (`base-<sha>.txt`); `--integrar --tests --base` [AGREGAR, baja]. |
| **El worker no ve cambios sin commitear del líder** | `git status --porcelain` vacío antes de F4/F5; el líder commitea lo suyo (los workers no pueden `stash`) | 79 al integrar → `tablero agregar`. |
| **Hechos inventados en F2** | Texto literal obligatorio en cada `HECHO` | `hechos-check`; <70 % OK → se tira el reporte y se relanza una vez con otro lector. |
| **El líder compacta a mitad de tarea** | Todo el estado en `tareas/<slug>/` | Retoma leyendo `estado.tsv` y `20-plan.md`. |
| **Tests tautológicos / hardcodeados / silenciamiento de errores** | Espejo oculto, anti-patrones, aserciones protegidas (sección 8.3) | Un reintento con el error real; después clasificar. |
| **Ramas muertas por reintentos y pedidos de `--descartar`** | `--desde-main` + `.patch` | — |

---

## 12. Riesgos abiertos

1. **Costo de coordinación del líder.** El líder es Opus y comparte el cupo con los workers. Una estimación de Argon (sin medir): coordinar las 8 fases de una tarea de 2 subtareas son 15–25 turnos del líder, ~0.60–1.20 US$ de lista sólo de contexto acumulado, más ~1 US$ de workers: ~1.5–2.4 US$ y 15–25 minutos, contra 0.24 US$ de un Haiku directo o 0.99 US$ de un Sonnet directo en `codigo-acotado`. Por eso existen trivial y vía rápida; el experimento mide el cupo del líder.
2. **Argon ausente.** Hasta ~1/11 no hay F7 ni segunda opinión de F3 con un modelo fuerte de otra familia: el sustituto (Flash high, OpenCode) es débil.
3. **Ventana de Haiku 300k [EN CONSTRUCCIÓN].** Todas las tasas de compactación (36 % y 68 %) y el tope de 40 KB son de la ventana de ~100k. Con 300k puede que el tope suba y que la rúbrica mande menos tareas a Sonnet. Hasta medirlo el tope queda en 40 KB, y conviene que sea una constante única.
4. **Vía rápida: el test lo escribe quien lo implementa.** Se mitiga con rojo-en-main retroactivo, aserciones protegidas, anti-patrones y espejo, pero el espejo sin un autor independiente es opcional en `D = bajo`.
5. **Sobreestimación poco medible** en filas que van a Sonnet/Opus (sin sombra de Claude).
6. **Muestras chicas.** n = 8 y 20 sólo filtran; los números de `--rinde` por celda tienen n de 5 a 19 en varias.
7. **La rúbrica la contesta el líder.** Un error en E o D se paga en la primera corrida.
8. **Gate sin LLM** no detecta lógica incorrecta que cumple tests, ni tests mal pensados que el líder aprobó apurado.
9. **Frontend visual** sigue con chequeo parcial (typecheck + build + grep/test de render) y `PROBAR` para el dueño.
10. **Ideas de Argon sin decidir [SIN DECIDIR]:** votación en F2 debug con tres motores de bolsas distintas (GLM gratis, Argon, Haiku high) y el líder corre las pruebas de las hipótesis (0 líneas de código; sólo plantilla en el skill); `slicing` automático del contexto en el brief (ya cubierto por el ±8 de `hechos-check`).

---

## 13. Qué te pedimos

Revisá este protocolo como un ingeniero escéptico que no tiene que defenderlo. Concretamente:

1. **Huecos.** ¿Dónde se traba o falla en un caso real? Buscá bucles (una regla que manda a otra que manda de vuelta), fases sin salida, condiciones que nadie puede evaluar con un comando, estados que no se pueden retomar si el líder compacta, interacciones entre reglas nuevas (T0 + paralelismo + archivos calientes; vía rápida + espejo; 1b + F7 + tope de 80 KB; `--desde-main` + sesiones que compactaron).
2. **Costo de coordinación del líder.** El líder es Opus y gasta el mismo cupo que los workers. ¿La vía rápida y el camino trivial alcanzan, o el protocolo completo sigue costando más de lo que ahorra? ¿Dónde está el punto de equilibrio en tamaño de tarea? ¿Qué parte del trabajo del líder (F0, F3, aprobar tests, armar briefs, escribir `estado.tsv`) se puede automatizar con scripts, o delegar a un modelo más barato con el líder sólo aprobando, sin perder la verificación determinista?
3. **Rúbrica.** ¿Las 5 preguntas (más M e I) separan bien los casos? ¿Qué combinación da un modelo de más o de menos? ¿La definición de A por archivos y KB es medible sin ambigüedad? ¿Las filas 7b y 8b (partir primero, Sonnet solo si es indivisible) respetan la regla del dueño de "más Haiku, partido chico", o crean otro bucle? ¿Falta una pregunta, o sobra una?
4. **Gate.** ¿Qué trampa de un modelo chico pasa los pasos 1–5, anti-patrones, aserciones protegidas, espejo y vía rápida? ¿Cuáles de esos chequeos darían falsos positivos que irriten? ¿El espejo oculto es barato de producir sin un autor independiente? ¿El criterio "rojo en main por aserción y no por import roto" se puede automatizar?
5. **Reglas de falla.** Un solo reintento y después clasificar: ¿la clasificación es suficientemente determinista para que el líder la haga sin juicio caro? ¿Hay fallas que no entran en ninguna fila de la tabla?
6. **Validación.** ¿El experimento de 8 tareas A/B ciego con criterio "≥ ok y ≤60 % del costo" es una prueba razonable? ¿Qué sesgo tiene (el dueño elige a ciegas, pero sabe qué tarea es; el brazo A también usa un modelo elegido por `reparto`)? ¿Qué agregarías?
7. **Top 5 mejoras.** Ordenadas por impacto. Para cada una:
   - **qué** cambiarías (concreto: regla, comando, campo);
   - **por qué** (qué falla o desperdicio ves hoy);
   - **costo de construir** (chico ≤50 líneas / mediano ≤200 / grande), contra lo que ya existe (secciones 1 y 9);
   - **qué gana** (en cupo, tiempo, tasa de integrada sin retrabajo o riesgo evitado).

Restricciones que tus propuestas deben respetar: sólo modelos y efforts habilitados (sección 1.1); nada de `max`/fable/`ANTHROPIC_API_KEY`; sombras sólo con gratis; nada destructivo sin OK del dueño; cupo de Claude compartido entre líder y workers; el dueño quiere Haiku por defecto para lo que se describe con precisión y no quiere "escalar probando".
