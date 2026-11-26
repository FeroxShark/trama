# Reglas: procesos

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Build nuevo con motor

- **Build nuevo con motor:** la ventana cliente compara la huella del build (`selloDe`) al arrancar; un `resinc` sin `saliendo` con build cambiado relanza la ventana (`vueltaDelMotor`, `electron/relanzar.ts`), y si no se puede saber, sólo recarga la página. Un canal nuevo del main que la ventana vieja no tiene hace rechazar el pedido: `resultadoCarpeta` lo distingue de «no es una carpeta» y dice que hay que reiniciar Trama.

## El `.pid` de una corrida

- **`<id>.pid` de una corrida:** nunca preguntes `kill0`/`vivo` sobre ese número a secas: pasa por `pidDeCorrida` (`app/electron/cli/base/proc.ts`;
atajos `pidCorridaVivo` y `corridaEnCola` en `cli/pa/corridas.ts`; respaldo bash: `pid_de_corrida` en `motor/bin/pa`). Un pid viejo puede ser el TID de un hilo
ajeno o un pid reciclado, y `--parar` mataría a otro programa. Es de la corrida si es proceso (Linux: Tgid == Pid), no zombie y arrancó a más tardar 2 s
después del mtime del `.pid` (el padre lo escribe después de lanzar al hijo). Fin de una corrida: `.listo` / `.entregado` (el `.json` NO: existe desde que arranca).

## El `.running` de un worker

- **`<proyecto>.running` de un worker:** mismo criterio que el `.pid`, y sólo por `pidDeRunning` / `pidDeCampoRunning` (`cli/base/proc.ts`; atajo `runningVivo` en
`cli/pa/corridas.ts`; respaldo bash: `vivo` en `motor/bin/pa`). Nunca `kill0`/`vivo` sobre el `pid=` o `pa_pid=` a secas: un `.running` huérfano (pa o Trama
muertos a lo bruto, en Windows `taskkill /F` no corre el trap) lleva un número que otro programa recicló. Sin proceso real la fila dice `murio`, `pa --parar` cierra el
rastro (anota `fin=`, borra el `.running`) y `--matar` nunca señala un pid no validado. El límite de sesión (76) NO deja zombis: `pa` sale limpio (el trap borra el
`.running`, deja `.listo` y `fin`), escribe `limite-<cuenta>` y nada reanuda solo cuando vuelve la cuota; sólo `-m a,b,c` pasa al siguiente modelo en esa misma corrida.

## Dónde está el motor para `pa`

- **Dónde está el motor para `pa`:** `resolverMotor` (`app/electron/cli/pa/entorno.ts`) lo busca en este orden: `TRAMA_MOTOR_DIR`, `<raíz>/motor` (checkout, worktree),
el payload de Windows (`<raíz>\bin` + `app\hooks`, sin carpeta `motor`), `<raíz>/fuente/motor` (instalación de escritorio de Linux: la app compilada vive en
`~/.local/share/trama/app`), el checkout anotado en `~/.config/trama/checkout` y el enlace de `~/.local/bin/pa`. Todo lo que `pa` lanza del motor (`reparto`,
`tablero`, `cuentas`, `repos-empujar`, hooks de latido y guardia) cuelga de `pa.bin`/`pa.hooks`; si falta, `avisarFalta` lo dice por stderr (nunca callado).
Nada de `path.join(…, "..", "motor")` suelto. Si un worker sale siempre con el modelo por defecto, mirá primero el aviso «pa: no encuentro …».

## Huérfanos de los líderes (`pactl subscribe` y compañía)

- **Trampa:** el Bash tool de Claude corre cada comando en su propia sesión (setsid). Un watcher lanzado desde un líder (un `pactl subscribe`) sale del grupo del líder, así que `barrerGrupo` no lo ve; y si el motor muere a lo bruto o lo relanza systemd con `KillMode=process`, nadie lo barre y queda en el cgroup `trama-motor.service` (2026-11-11: 20 vivos llenaron el cupo de pipewire-pulse). Node no tiene PR_SET_PDEATHSIG: la salida es la etiqueta.
- **Cómo se barre:** cada líder sale con `TRAMA_LIDER_ETIQUETA=<pid motor>:<arranque motor>:<azar>` en el entorno (`electron/huerfanos.ts`, `lider.ts`). Al salir el líder se manda TERM (KILL a los 3 s) a todo proceso con esa etiqueta; al arrancar el motor se barre lo de los motores que ya no están. `pa --async` sale con la etiqueta vacía: sus workers sobreviven a los relanzos del motor a propósito.
- **No hay `pactl` en el repo:** el watcher lo lanza una herramienta del líder o un script del usuario. «Un solo suscriptor» no se puede imponer desde el motor; lo que sí garantiza el motor es que no queden huérfanos.
- Sólo Linux (lee `/proc`); en Windows es no-op. Test: `app/tests/huerfanos.test.ts`.

## Consolas en Windows (medido en el CI de Windows, 2026-11-22)

- Un proceso de consola lanzado con `windowsHide` (SW_HIDE) queda oculto, también con Windows Terminal como terminal por defecto.
- La ventana visible sale cuando un proceso **sin consola** (lanzado `detached`, o una app GUI como Electron) lanza un programa de consola
  **sin** `windowsHide`: Windows le crea una consola nueva y la muestra. Así abrían un CMD los intentos de `-m a,b,c` y de `--objetivo`
  (`relanzar` en `cli/pa.ts`, dentro del runner suelto). Por eso todo `spawn`/`execFile` lleva `windowsHide` (`tests/rutas.test.ts`).
- `lanzarSuelto` y el lanzador de WMI siguen con `detached` en Windows: libuv mete a cada hijo no-detached en un job que lo mata al salir
  el padre, y ningún hijo no-detached sobrevivió a un padre que sale enseguida.
- WMI (`Win32_Process.Create`) rechaza `CREATE_NO_WINDOW` en `CreateFlags` (devuelve 21); con `ShowWindow=0` su `cmd.exe` queda oculto.
- Los servidores MCP que arranca Claude Code salen sin ventana en todos los casos medidos.

## `pa --limpiar` cierra los restos de corridas muertas (2026-11-25, sólo en el TS)

- **Además de worktrees, ramas y builds**, `pa --limpiar` (`cli/pa/limpiar.ts`; sin `--si` sólo muestra, `--json` suma `huerfanos` y `muertas`) cierra lo que `pa --estado` lista como HUÉRFANO y MURIÓ EN COLA, de más de 1 día (fijo, no depende de `--dias`): un `.running` sin proceso vivo (como `pa --parar` sobre un rastro muerto: `cerrarRunningMuerto` en `cli/pa/matar.ts`, `fin=` y fuera el `.running` y sus `.heartbeat*`; el pid sólo por `runningVivo`, a nadie se le manda señal) y una corrida `--async` muerta sin puesto (`corridasSinPuesto` en `cli/pa/async.ts`, la misma definición que usa `--estado`; se archiva con `fin=` y `archivado=` en su `.hilo`, que `--estado` ya no lista; los `.log` no se borran). Lo cubre `tests/limpiar-restos.test.ts`. Un hijo de `--async` que sale con error de uso (2) antes de tomar puesto borra su `.pid`/`.jefe`/`.leer` (`cerrarRastroRechazado` en `cli/pa/cli.ts`): no queda «MURIÓ EN COLA». El bash congelado no hace nada de esto.

## Lo que un worker deja corriendo se avisa, no se baja (2026-11-25, sólo en el TS)

- **Todo worker sale con `PA_CORRIDA=<id>` en el entorno** (`entornoClaude` en `cli/pa/lanzar.ts`; `baseDe` en `cli/pa/motores/llamada.ts` para agy, codex y opencode). El Bash de Claude corre cada comando con setsid, así que lo que el worker lanza en segundo plano (un servidor de prueba, un script de espera) no cuelga de su árbol; el entorno sí se hereda. Medido: dos `vigilar.py` de un worker seguían vivos dos días después.
- **`pa` avisa y no mata** (`cli/pa/procesos-corrida.ts`): al terminar la corrida, por stderr, «la corrida X terminó y dejó N procesos corriendo: pid cmd…; si sobran: kill …» (lo que está saliendo tiene 2 s de gracia; sin nada vivo no espera); y `pa --estado` lista «QUEDÓ VIVO» por cada corrida de ESE estado que ya no corre y tiene procesos con su etiqueta. No se baja nada solo: puede ser a propósito (el worker que reinicia un servicio del dueño). Una corrida que no es del estado no se nombra: así los tests que corre un worker no ven al worker.
- Sólo Linux (lee `/proc/<pid>/environ`, con `entornos` de `electron/huerfanos.ts`). FALTA EN Windows: no hay cómo leer el entorno de otro proceso sin un binario propio; ahí devuelve vacío. Lo cubre `tests/procesos-corrida.test.ts`.

## El worker que despierta después de su respuesta final (2026-11-25, sólo en el TS)

- **Una tarea de fondo que termina después del RESULTADO despierta al claude**, que contesta otra vez: `claude -p --output-format json` deja entonces un segundo `result` (`result_index` > 0, `origin.kind: "task-notification"`) con 1 turno, 2 s y un RESULTADO sin verificación, y ése era el que quedaba en el `.json`. Medido en `20261122-073132-695872`: 61 turnos y 38 min de trabajo figuraban como 1 turno y 2 s, y la corrida como no verificada.
- **`corregirDespertar`** (`cli/pa/despertar.ts`, lo llama `correr()` de `lanzar.ts` apenas sale el claude): con el transcript pone los turnos y la duración de la corrida entera (los originales quedan en `despertar`), y si el último RESULTADO no trae verificación y uno anterior sí, vuelve el anterior con una línea al final que cuenta lo que dijo al despertar. Sin transcript no toca nada. Lo cubre `tests/despertar.test.ts`.
- **DECISION «nada»:** una sola función (`cli/pa/decision-nada.ts`) para lanzar, hilos y tablero. Vale «nada», «nada que decidir» y eso seguido sólo de oraciones que niegan («No hay cambios…», «Ningún trabajo quedó…»). Con un supuesto, algo a confirmar o algo sin terminar sigue siendo pendiente.
- **Guardia de borrado en el contrato:** `FRASE_GUARDIA` (`cli/pa/contrato.ts`) le dice al worker qué borrado pasa y que no reintente (85 corridas frenadas en 30 días). La guardia no cambió. El bash congelado no la lleva: `tests/cli-pa.test.ts` y `tests/paridad/normalizar.ts` la sacan al comparar.
