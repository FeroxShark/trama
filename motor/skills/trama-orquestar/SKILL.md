---
name: trama-orquestar
description: Delegar trabajo sobre un proyecto a un worker que corre adentro de ese proyecto, con `pa`. Usar cuando la sesión es la del líder (corre en el home) y la tarea o la consulta es sobre un proyecto concreto, para elegir modelo y tipo de tarea, o para integrar el trabajo que volvió.
---

# Orquestar proyectos con `pa`

Sos el **líder**: tu sesión corre en el home del usuario y coordina. Cada proyecto tiene sus propios
workers (un modelo que corre **adentro** del proyecto, con su `CLAUDE.md`/`GEMINI.md` y su memoria). Delegás con
`pa`; el worker trabaja en un worktree y una rama propios y vuelve con un resumen corto. Sirve igual si
el líder es Claude o Gemini, y si los workers son Claude, Gemini o un modelo local: qué modelos
están habilitados y cuáles se excluyen lo decide `~/.config/trama/modelos.json` (o Trama > Ajustes); cuál usar en cada tarea lo elegís vos.

Elegís vos, sin preguntar:

- Una pregunta que sabés sin mirar el código, o que sale del registro de proyectos → contestás solo.
- Una consulta o tarea acotada sobre un proyecto → `pa`.
- Trabajo largo → varios `pa --async` acotados, que coordinás vos.

Si la sesión corre **adentro** de un proyecto, esto no aplica: hacé la tarea, no delegues.

## Proyectos

`pa <proyecto>` resuelve el nombre contra `~/.config/proyectos/registry.json`
(`{"projects":[{"name":"mi-app","path":"/ruta/absoluta"}]}`; el nombre puede ser un fragmento único).
`proyecto-ruta --listar` muestra los nombres. Un proyecto nuevo se agrega a ese archivo.

## Comandos

```
pa <proyecto> --tipo <tipo> -m <modelo> --effort <e> "<tarea>"   delegar: el worker puede escribir. --tipo, -m y --effort SIEMPRE
pa <proyecto> --leer --tipo lectura "<p>"  sólo lectura (leer, explorar, auditar); corre en paralelo con un writer
pa <proyecto> --async --tipo T "<tarea>"   lanzar desacoplado: imprime el id de la corrida (o EN COLA)
pa --esperar <proyecto> [--timeout N] [--id ID]   cobrar el resultado más viejo, o esperar a que termine
pa --esperar-todos [--timeout N]           cobrar todas las corridas async de una
pa <proyecto> --seguir [--id ID] "<t>"     retomar esa corrida (misma rama, mismo contexto)
pa <proyecto> -m <modelo> [--effort E]     fijar el modelo; gana siempre sobre modelos.json (sólo avisa si no tiene cupo)
reparto --resumen                          los modelos habilitados con inteligencia por effort, costo, cupo y para qué sirven
pa <proyecto> --integrar <id>              mergear la rama del worker en main
pa <proyecto> --actualizar <id>            si --integrar chocó (80): un worker rebasea esa rama sobre main
pa <proyecto> --ramas                      ramas de workers todavía sin integrar
pa <proyecto> --descartar <id>             tirar esa rama (borra commits: confirmalo con el usuario)
pa <proyecto> --revertir <id>              deshacer una integrada con `git revert`
pa --modelos                               qué modelo usa cada tipo de tarea, de dónde sale y si hay cupo
pa --plan ver | ausente <fecha>[,..]       el ritmo semanal de cada suscripción y las pistas del usuario (ver "Ritmo del cupo")
pa --plan gastar-hoy | ahorrar-hoy | borrar
pa --estado                                qué corre ahora, sesiones guardadas, límite vigente
```

`pa --ayuda` lista el resto. Un comando que no recordás: probalo con `--ayuda`, no lo adivines.

## `--tipo` y modelos

`--tipo` clasifica la tarea y, con `modelos.json`, decide qué modelo la corre:

| `--tipo` | Cuándo |
|---|---|
| `codigo-acotado` | código acotado y bien definido, con criterio de "listo" (Haiku por defecto; una base crítica va a Opus con `-m`) |
| `codigo-multi` | varias partes: partila en pedazos chicos |
| `frontend` | interfaz, estilos, diseño visual |
| `debug` | bug sin pista |
| `diseno` | diseño difícil, plan grande, arquitectura |
| `lectura` | leer, explorar, auditar (con `--leer`) |
| `mecanico` | mecánico con un chequeo determinista (renombrar, migrar, formatear) |

- Sin `-m`, `pa` sigue con lo que sugiere `reparto` (o `modelos.json`: `workers.<tipo>`, si falta `workers.default`, los
  defaults de `pa`) pero **te avisa**: esa tabla no mira el tamaño real de la tarea. Vos elegís modelo y effort.
  `pa --modelos` muestra la tabla.
- **Un modelo mayor sólo si el chequeo falla** (o la base es crítica): arrancá por el tipo que corresponde
  y subí con `-m`. Más effort no es más inteligencia, es más exploración y más gasto.
- Un modelo `ollama:<modelo>` es local: más lento y menos capaz; reservalo para `mecanico` y `lectura`
  salvo que el usuario diga otra cosa.
- `opencode:<proveedor>/<modelo>` (gratis: `opencode:opencode/deepseek-v4.1-flash-free`, `glm-5.3-flash-free`,
  `nemotron-3-ultra-free`, `big-pickle`…; la lista sale de `opencode models`), `dsh:ollama/<modelo>` (local) y
  `dsh:deepseek/<modelo>` (se paga) corren el worker con el programa `opencode` o con DeepSeek Harness. Son los
  modelos para quien no tiene Claude, Gemini ni ChatGPT: menos capaces, así que `mecanico`, `lectura` o
  `codigo-acotado` con chequeo, no diseño ni `debug`. Sin effort ni `--seguir`, `--leer`, `--mcp`, `--aca`,
  `--max-budget-usd`. Salen 95 si falta `opencode` / `dsh`, la key de DeepSeek (`DEEPSEEK_API_KEY` en el entorno o en
  `~/.config/trama/claves.env`; nunca la pidas ni la imprimas) o Ollama no responde. Los gratis de OpenCode usan el
  login de la persona en `opencode` (`opencode` → /connect → OpenCode Console): no hay key que pasarles, y por dsh no
  andan (429). `opencode` y `deepseek` son remotos: `pa` no les manda la ficha del proyecto ni el CLAUDE.md del
  dueño. `pa --modelos` los lista.
  NVIDIA NIM (gratis, ~40 pedidos/min por modelo, sin tope diario): `opencode:nvidia/deepseek-ai/deepseek-v4.1-flash` (más en `nvidia_modelos` de
  `modelos.json`); necesita `NVIDIA_API_KEY` en `~/.config/trama/claves.env` (si falta, `pa` sale 95; nunca la pidas ni la imprimas). `reparto` los
  ofrece sólo con esa key, en el grupo `nvidia-nim`; un 429 enfría sólo ese modelo ~5 min.
- Cuando el modelo elegido no tiene cupo, `sin_cupo` de `modelos.json` dice qué hace `pa`: `otro` (el
  default: relanza con el siguiente candidato de `reparto`), `esperar` (queda en cola con `--async`) o `fallar`.

## Elegir modelo en corto

**Elegís vos `-m` y `--effort` en cada `pa`**, con lo que leíste del pedido. Al arrancar la sesión recibís el resumen de
modelos habilitados (inteligencia por effort, costo, cupo libre, para qué sirve); los cupos cambian, así que `reparto --resumen`
lo refresca. `--tipo` sigue yendo (clasifica la corrida y alimenta `pa --rinde`), pero **ya no decide el modelo**.

Criterio, de lo más importante a lo menos:

1. **Tamaño real de la tarea** (no su etiqueta): un cambio chico en un archivo es chico aunque sea `frontend`; tocar varias
   partes o decidir una arquitectura es grande.
2. **Costo de un error**: ¿se ve enseguida y se arregla en un commit, o se cuela y cuesta caro (datos, base de la que cuelga todo)?
3. **Hay chequeo o no**: con un test o comando que falla si está mal, un modelo chico alcanza y se reintenta barato.

Qué elegir:

- **Haiku (`claude-haiku-5-5`, `--effort xhigh`) es el default** para todo lo que puedas describir con precisión: archivos, qué cambiar,
  criterio de "listo" y chequeo. Incluye código acotado, mecánico, lectura y una interfaz chica. Haiku no es un modelo malo: rinde cuando la
  tarea viene bien guiada (ver "Brief para Haiku" en "Cómo se escribe la tarea"). No le tengas miedo: si falla, el chequeo lo muestra y se reintenta barato.
- **Sonnet (`claude-sonnet-5-5`, `--effort high`)** sólo si el pedido es ambiguo (no podés decir qué archivos ni qué cambia), si toca muchas
  partes, o si Haiku ya falló una vez en esa tarea.
- **Opus (`claude-opus-5-5`, `--effort medium`; `high` sólo en `debug`)** sólo para: una **base crítica** de la que cuelga lo demás, un
  **bug sin pista**, o **tras un fallo** de Sonnet (una vez, no más).
- **Preferí los cupos gratis cuando hay chequeo** (Gemini Flash, OpenCode `*-free`, Go): gastan una suscripción que, si no se usa, se pierde,
  y dejan el cupo de Claude para vos. Sin chequeo o con un error caro, no.
- **Segunda opinión** independiente: `--leer -m gemini-4-argon-high` (si el usuario tiene Google AI Pro).
- **Medir un modelo nuevo** para `pa --rinde`: sólo con `--tipo lectura`.

Si el modelo que pediste **no tiene cupo**, `pa` avisa y sugiere otro (`sin_cupo=fallar` no lanza: sale 96); no te cambia el modelo solo.
Elegí el que sugiere o uno del resumen con cupo.

Qué esperar (datos propios de una instalación, 60 días): Sonnet high iguala o supera a Opus en `codigo-multi`, `frontend` y `debug` por un
cuarto del costo; Opus rinde mejor en `medium` que en `high`; Haiku xhigh alcanza para `lectura`/`mecanico`, para `codigo-acotado` bien guiado y para una interfaz chica. Argon, Flash, GPT-OSS y Claude por `agy` tienen pocas corridas: no los fuerces para código sin chequeo.

- **Para el detalle, `reparto --tabla`** (`--json` para leerla; el resumen sale de ella): todos los modelos con su inteligencia (`~` = estimada
  por el nombre), si son gratis, el cupo libre, cuándo se reinicia y si `modelos.json` los permite. Lo que sugiere
  `reparto --tipo T` prefiere los planes que se reinician pronto y todavía tienen cupo (ese cupo se pierde si no se usa) y los
  modelos gratis cuando el cupo escasea: usalo como pista, no como decisión. `pa --modelos` muestra la misma inteligencia.
- **Nunca effort `max`** salvo que el usuario prenda `permitir_max` en los ajustes de Trama.
- **Fable no vale su precio** frente a Opus 5.5 (2,5× por token y peor resultado medido): no lo uses.
- Effort no es inteligencia: más effort = más turnos y más gasto. Si falla, mejorá la tarea antes de subirlo.
- Flash sólo `lectura`/`mecanico`; GPT-OSS no sigue bien el contrato; los locales `ollama:*` y
  `dsh:ollama/*` sólo `mecanico`/`lectura` y no en la GPU del usuario sin que lo sepa.
- Cada familia gasta un cupo distinto: Claude oficial (Opus/Sonnet/Haiku), Google AI Pro (Argon, Flash,
  `agy:*`), ChatGPT (Codex: `pa` no lo lanza todavía), OpenCode (por `opencode`, gratis los `*-free`), DeepSeek (por `dsh`) o la máquina (Ollama). `pa --modelos` y
  `reparto --cupos` muestran cuál sobra.

## Ritmo del cupo (que alcance la semana)

Vos sos un modelo de Anthropic y los workers de Claude gastan el mismo cupo semanal que tu conversación. `reparto` lleva un **ritmo**
por ventana semanal: lo usado dividido por lo que ya pasó de la semana (1,0× = termina la semana en ~100 %). Si el usuario va por encima,
las sugerencias de `reparto` pasan a modelos gratis o de Google (y vos también: es la pista del resumen); si va por debajo y falta poco para el reinicio, usan más la suscripción (ese cupo se
pierde si no se gasta). El perfil (`perfil` en `modelos.json`, o Ajustes > Plan y cupos) lo gradúa: `ahorro` casi siempre gratis/Google y
guarda el 35 % de la semana de Claude para vos (`reserva_lider`), `equilibrado` es el de siempre, `rendimiento` prioriza la calidad.

El usuario te avisa lo que `reparto` no puede saber; **vos lo anotás**, no esperes a que te lo pida como comando:

| El usuario dice | Corré |
|---|---|
| "mañana no estoy", "el viernes y el sábado no trabajo" | `pa --plan ausente 2026-10-27` / `pa --plan ausente 2026-10-30,2026-10-31` (también `hoy`, `manana`, `A..B`) |
| "ya voy a trabajar mañana", "cancelo la ausencia" | `pa --plan presente <fecha>` (o `pa --plan borrar`) |
| "hoy gastá más", "se reinicia pasado mañana, aprovechá la suscripción" | `pa --plan gastar-hoy` |
| "hoy ahorrá", "me quedé corto de cupo" | `pa --plan ahorrar-hoy` |
| "¿cómo vamos de cupo?" | `pa --plan ver` (y `pa --cupo-gemini`) |

Con una ausencia el presupuesto semanal se reparte entre los días que quedan: antes de una ausencia + reinicio hoy se gasta más. Todo
vence solo (las fechas pasadas y el gastar/ahorrar de ayer no cuentan). **Después de anotarlo, decile al usuario en una o dos frases qué
cambió**: el ritmo antes y después que imprime el comando ("pasa de 1,4× a 0,9×") y qué van a hacer los workers ("hoy uso más Claude"
/ "los workers van a modelos gratis"). Las fechas son del día local; si el usuario dice "mañana", pasá la fecha real, no adivines el día.

## Volver y integrar

Cada corrida termina con un resumen de estos campos:

```
RESULTADO: qué hizo o encontró.
ARCHIVOS: rutas tocadas, o "ninguno".
VERIFICACION: comando(s) que corrió y un extracto real de la salida.
DECISION: qué tiene que decidir el usuario, o "nada".
SIGUE: el próximo paso, o "nada".
— rama pa/<proyecto>/<id>: N commit(s). NO está en main hasta que la integres.
```

- **El trabajo NO está en main hasta que lo integrás.** Flujo fijo: tarea → leer el RESULTADO → `--integrar <id>`.
- `--integrar` rebasea y hace fast-forward. Si se niega, no tocó nada: leé el motivo y contáselo al usuario
  (`80` choque → `--actualizar <id>`; `79` archivo sin commitear del usuario que la rama toca). Una rama sin commits: `--descartar`.
- El resumen tiene DECISION cuando algo es del usuario (publicar, borrar, plata, alcance): traela tal cual,
  sin decidir por él. Lo técnico lo resolvió el worker y lo contó como supuesto en RESULTADO.
- **Mirá la línea `VERIFICACION` del RESULTADO** (comando + salida real). Si dice `— SIN VERIFICAR`, no la des
  por buena: pedí la evidencia con `--seguir --id` o corré el chequeo vos. `pa --estado` lista las sin verificar.
- Antes de integrar algo importante: `pa <proyecto> --auditar <id> [-m MODELO]` (revisor de sólo lectura que
  reporta por severidad; no corre tests, esos con `--integrar <id> --tests`).
- No pegues diffs ni logs al usuario: la conclusión, qué archivos tocó y el comando para verlos.
- Códigos de salida: `0` ok · `1` el worker falló (leé el motivo, **no relances a ciegas**) · `2` uso ·
  `75` puesto o tope de workers ocupado · `76` límite de sesión (vuelve a reintentar luego) · `78` sin
  RESULTADO (cerralo con `--seguir --id`).

## Trabajo largo

- `pa` en primer plano bloquea. Todo lo que pinte largo va con `--async`; después `--esperar`/`--esperar-todos`
  (que bloquean hasta el resultado: en una herramienta con tope de tiempo, con `--timeout`).
- Hasta 3 workers que escriben por proyecto a la vez y un tope global de workers vivos; el que no entra queda
  EN COLA y arranca solo. Lo dependiente no va en paralelo: esperar A → integrar A → lanzar B.
- `pa --estado` muestra qué corre. A un worker vivo no se le escribe: se espera o se lo mata (`--matar`).

## Cómo se escribe la tarea

Siempre con este brief (`pa --brief` imprime la plantilla; desde un archivo: `--brief-archivo F`):

```
Objetivo:       qué tiene que quedar distinto (1-2 oraciones)
Archivos:       rutas donde trabajar y qué leer primero
Listo cuando:   criterio observable de terminado
Cómo verificar: comando exacto y qué salida esperás
No tocar:       lo que no se cambia
```

- Sin "Listo cuando" o "Cómo verificar", `pa` te avisa por stderr (no bloquea): completalo y relanzá.
- **Como si el worker no pudiera preguntar.** Desambiguá vos o mandale asumir y reportar el supuesto.
- **Ajustá el detalle a la inteligencia del modelo** (`reparto --tabla`; `pa` te avisa si es < 70). Debajo de ~70:
  pasos numerados, comandos explícitos, un solo archivo o área por tarea, y partí lo grande en varias.
  Arriba, alcanzan el problema y el criterio de listo.
- **Brief para Haiku** (el default): rutas exactas, pasos numerados y un chequeo que falla si está mal.
  1. `Archivos:` rutas completas (`app/src/x.ts`), qué leer primero y qué función o bloque cambiar; nada de "buscá donde esté".
  2. `Objetivo:` un solo cambio, con el antes y el después en una oración cada uno; si son dos cambios, son dos `pa`.
  3. Los pasos, numerados y en orden (leer A, cambiar B así, agregar el test C). Si hay un patrón a copiar, nombrá el archivo y la línea.
  4. `Listo cuando:` algo observable (un test que antes fallaba y ahora pasa, un texto en la salida).
  5. `Cómo verificar:` el comando exacto, la salida esperada y `No tocar:` lo que no se cambia.
  Si no podés escribir los pasos 1 a 5, el pedido es ambiguo: partilo, o usá Sonnet.
- Entre comillas **simples**, o desde un archivo (`--brief-archivo`): con comillas dobles tu shell ejecuta
  cada `` `comando` `` antes de que `pa` lo vea.
- Una tarea, un `pa`. Cada `pa` arranca una sesión limpia; un seguimiento corto va con `--seguir --id`.
- Los bugs que un revisor encuentra vuelven al autor (`--seguir --id <id-del-autor>`), con la lista corta
  de `archivo:línea`.

## Memoria del proyecto

- **`AGENTS.md`** en la raíz del proyecto: los modelos que no son Claude (Gemini, Codex, opencode, dsh) no leen
  `CLAUDE.md`; `pa` les inyecta `AGENTS.md` (o `CLAUDE.md` si no hay), hasta 8000 caracteres. Si falta:
  `pa <proy> --agents-md` imprime la plantilla; llenala con lo que verificaste (build, tests, convenciones,
  qué no tocar). Cuando aprendas algo **durable** del proyecto, actualizalo.
- **Lecciones** (errores concretos de este proyecto): `pa <proy> --leccion "<una línea>"`. Se inyectan solas a los
  workers; `--lecciones` las lista. Si `pa --estado` marca `NECESITA-PODA`: `pa <proy> --lecciones-podar` te dice
  cómo reescribirlas más cortas.

## Pendientes: `tablero`

`tablero` es la lista de pendientes, esperas e ideas del usuario (un archivo en `~/tablero`, sin servidor).
Las DECISION de los workers entran solas; vos cerrás lo resuelto. Comandos útiles: `tablero resumen`,
`tablero listar`, `tablero agregar "<texto>"`, `tablero cerrar <id>`, `tablero ficha <proyecto>`. No anotes
pendientes en un documento: `tablero agregar`.

## Reglas

- Lo irreversible (borrar, `push --force`, `--descartar`, publicar) se confirma con el usuario ANTES.
- `git stash` y `git add -A` están bloqueados en los workers por un hook: no hace falta prohibirlos.
- Release e instalaciones (`cargo --release`, `tauri build`, `npm i -g`) los hacés vos, en el árbol
  principal, después de integrar: no se delegan.
- Un modelo local nunca va en la GPU del usuario sin que lo sepa: ocupa toda la VRAM.
