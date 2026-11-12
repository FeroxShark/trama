---
name: trama-orquestar
description: Delegar trabajo de un proyecto a un worker con `pa`: modelo, `--tipo` e integración. Para el líder (corre en el home).
---

# Orquestar proyectos con `pa`

Sos el **líder**: tu sesión corre en el home y coordina. Delegás con `pa`: el worker corre **adentro** del
proyecto, en un worktree y una rama propios. Si tu sesión corre en un proyecto, hacé la tarea.

## Qué usar

| Caso | Qué usar |
|---|---|
| Respuesta sabida o ≤ 3 llamadas | El líder solo |
| Leer o buscar en un proyecto | `pa <p> --leer --tipo lectura "<p>"` |
| Lectura que el líder necesita ya | subagente nativo Explore en Haiku |
| Cambio de 1-2 archivos con test | `codigo-acotado` |
| Frontend o varias partes | pedazos de ≤ ~40 turnos, archivos disjuntos |
| Tiene chequeo determinista | `pa <p> --objetivo "<meta>" --verificar "<cmd>"` |
| Falló | `--seguir` (< 55 min) o `--seguir-con <modelo> --id`; Opus nunca de cero |
| Escribir código | siempre `pa`, nunca subagente nativo |

Opus de cero: US$5,7 por corrida (12-26 % ok) contra Haiku xhigh 0,28 (51 %); ≥60 turnos = 67 % del gasto.

## Comandos

```
pa <p> --tipo <tipo> "<tarea>"   pa <p> --async --tipo T "<tarea>"   pa <p> --seguir [--id ID] "<t>"
pa <p> --seguir-con <modelo> --id ID   pa <p> -m <modelo> [--effort E]
pa <p> --integrar <id> [--tests]   pa <p> --actualizar <id>   pa <p> --ramas
pa <p> --descartar <id>   pa <p> --revertir <id> (git revert)   pa <p> --auditar <id> [-m M]
pa <p> --brief [--brief-archivo F]   pa <p> --agents-md   pa <p> --leccion "<texto>"
pa <p> --matar   pa --modelos   pa --rinde [--dias N]   pa --estado
pa --esperar <p> [--id ID] [--timeout N]   pa --esperar-todos [--timeout N]
pa --plan ver   pa --plan ausente <f>   pa --plan presente <f>   pa --plan gastar-hoy   pa --plan ahorrar-hoy   pa --plan borrar
reparto --resumen   reparto --tabla   reparto --cupos   reparto --tipo T
pa --ayuda   proyecto-ruta --listar   opencode models
```

`pa <proyecto>` resuelve el nombre contra `~/.config/proyectos/registry.json`; **proyecto nuevo: registralo vos**:
`jq --arg n N --arg p "~/Proyectos/N" --arg d "d" '.projects += [{name:$n,desc:$d,path:$p,estado:"esqueleto"}]' ~/.config/proyectos/registry.json >/tmp/r.json && mv /tmp/r.json ~/.config/proyectos/registry.json`

## `--tipo` y modelo

`codigo-acotado` código acotado y bien definido · `codigo-multi` varias partes: partila · `frontend`
interfaz · `debug` bug sin pista · `diseno` difícil · `lectura` leer y auditar (con `--leer`) · `mecanico` con
chequeo.

- Delegá **siempre** con `--tipo` y **sin** `-m` ni `--effort`: `reparto` elige modelo y effort por la calidad
  y el cupo.
- **Efforts permitidos** (los de `modelos.json`): Haiku medium/high/xhigh/max · **Sonnet sólo high** ·
  **Opus medium/high** (Opus rinde mejor en `medium`). Más effort = más turnos y más gasto, no más inteligencia.
- Un modelo mayor sólo con motivo: base crítica, bug sin pista o tras un fallo del modelo elegido; segunda
  opinión: `--leer -m gemini-4-argon-high`.

## Volver e integrar

Cada corrida termina con un bloque:

```
RESULTADO: qué hizo o encontró. ARCHIVOS: rutas tocadas, o "ninguno". VERIFICACION: comando(s) y 2-6 líneas
reales de su salida. DECISION: qué decide el usuario, o "nada". SIGUE: el próximo paso, o "nada".
— rama pa/<proyecto>/<id>: N commit(s). NO está en main hasta que la integres.
```

- **El trabajo NO está en main hasta que lo integrás.** Flujo: tarea → leer el RESULTADO → `--integrar <id>`
  (rebasea y fast-forward). Si se niega, no tocó nada: `80` → `--actualizar <id>`; `79` archivo sin commitear.
  Una rama sin commits: `--descartar`.
- Traé la DECISION del worker tal cual, sin decidir por el usuario. **Mirá VERIFICACION**: si dice
  `— SIN VERIFICAR`, pedí la evidencia con `--seguir --id` o corré el chequeo vos.
- **Un worker que frenó con `FALTA:` (aviso «frenó: le falta información») lo resolvés vos, no el usuario.** Si es un
  dato, contestale y sigue el mismo worker: `pa <p> --async --seguir --id <id> "<respuesta>"` (o `lanzar_worker` con `id`).
  Si le faltó una herramienta (Chrome, Gmail, Notion), seguilo con `--mcp` o relanzalo con otro método; si alcanza con lo
  que hay, cerralo. Su DECISION y su SIGUE no entran al tablero: al usuario sólo le pasás lo que es decisión suya de verdad
  (cambia lo que ve, cuesta plata o no se deshace) con `tablero agregar --simple …`.
- Antes de integrar algo importante: `pa <p> --auditar <id> [-m MODELO]` y `motor/bin/gate` (lo corre el líder:
  alcance, test congelado, anti-patrones y rojos); tests con `--integrar <id> --tests`.
- Códigos de salida: `0` ok · `1` el worker falló (leé el motivo) · `2` uso · `75` puesto o tope ocupado ·
  `76` límite de sesión (reintentá luego) · `78` sin RESULTADO (cerralo con `--seguir --id`) ·
  `79`/`80` integrar se negó o chocó.

## El brief

Con este brief (`pa --brief` imprime la plantilla; `--brief-archivo F` lo toma de un archivo; comillas
**simples**: con dobles tu shell ejecuta cada `` `comando` ``):

```
Objetivo:       qué queda distinto
Archivos:       rutas y qué leer primero
Listo cuando:   criterio observable
Cómo verificar: comando y salida
No tocar:       lo que no cambia
```

- Sin "Listo cuando" o "Cómo verificar", `pa` avisa por stderr (no bloquea): completalo y relanzá. **Como si el
  worker no pudiera preguntar:** desambiguá vos o mandale asumir y reportá el supuesto.
- **Brief para Haiku** (el default): rutas exactas, pasos numerados y un chequeo que falle si está mal.
  1. `Archivos:` rutas completas (`app/src/x.ts`), qué leer primero y qué cambiar; nada de "buscá donde esté".
  2. `Objetivo:` un solo cambio (antes y después en una oración); si son dos, son dos `pa`.
  3. Los pasos numerados y en orden; si hay un patrón a copiar, nombrá archivo y línea.
  4. `Listo cuando:` observable (un test que antes fallaba y ahora pasa) y `Cómo verificar:` el comando con su
     salida; `No tocar:` lo que no cambia.
  Si no podés escribir los pasos 1 a 4, el pedido es ambiguo: partilo o usá Sonnet.
- Una tarea, un `pa`; los bugs de un revisor vuelven al autor (`--seguir --id <id>`) con `archivo:línea`.
- **Tamaño (regla dura):** un pedazo es **un objetivo**, **hasta 3 archivos escritos**, y sus archivos son
  **disjuntos** de los de los workers vivos. `codigo-multi` se parte siempre, salvo `--indivisible "<motivo>"`.
  frontend, codigo-multi y diseno cortan a **50 turnos** (con `--indivisible`, 90); `pa` avisa si el pedido pinta grande.
- Tras una lectura, calificala: `pa --bien <id> si|no|parcial` (alimenta el reparto).

## Trabajo largo y reglas

- `pa` en primer plano bloquea: lo que pinte largo va con `--async`. **Lanzá todo lo paralelo en UNA sola
  llamada Bash** (varios `pa <p> --async …` en el mismo comando) y cobralo con `pa --esperar-todos`: un turno para
  N resultados. **No sondees con `pa --estado`**: o esperás, o el worker manda su resultado.
- Hasta 3 writers por proyecto y un tope global de workers vivos; el que no entra queda EN COLA. Lo
  dependiente no va en paralelo: esperar A → integrar A → lanzar B. **Archivos disjuntos entre workers vivos**:
  dos workers sobre el mismo archivo se pisan.
- Lo irreversible (borrar, `push --force`, `--descartar`, publicar) se confirma con el usuario ANTES.
- `git stash` y `git add -A` están bloqueados por un hook. Release e instalaciones (`cargo --release`,
  `tauri build`, `npm i -g`) los hacés vos, después de integrar. Un modelo local nunca va en la GPU sin avisar.

## Memoria y tablero

- **`AGENTS.md`** en la raíz: `pa` la inyecta a los que no son Claude; `--agents-md` imprime la plantilla.
- **Lecciones**: `pa <p> --leccion "<una línea>"`; `--lecciones` lista y `--lecciones-podar` acorta las que
  marca `NECESITA-PODA`.
- **`tablero`**: la lista de pendientes y decisiones del usuario (`~/tablero`). Las DECISION de los workers
  entran solas; vos cerrás lo resuelto. Comandos: `tablero resumen`, `tablero listar`,
  `tablero agregar "<texto>"`, `tablero cerrar <id>`, `tablero ficha <proyecto>`.
