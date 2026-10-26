# Correr el motor nativo en Windows (sin WSL)

Hoy el motor de Trama (`pa`, `tablero`, `reparto`, `trama-estado`, los hooks) es bash y python, y en
Windows corre adentro de WSL2. Este documento describe cómo está pensado el port a Node para que
corra nativo, y sobre todo **qué no se puede cambiar**: la app, los tests y el estado en disco son un
contrato, y un port que lo rompe parece andar y falla en producción.

Si vas a portar una pieza, leé primero "Lo que es contrato" y "Las siete trampas de Windows".

## Lo que es contrato (no se toca)

1. **Los códigos de salida.** `0` ok, `1` el worker falló, `2` uso, `75` puesto ocupado o tope global
   lleno, `76` límite de sesión, `77` API sobrecargada, `78` sin RESULTADO, `79`/`80`/`83`/`86`/`93`
   `--integrar` se negó, `81` instalación de claude rota, `82` murió sin resultado, `84` claude no está
   en el PATH, `85` `--matar` no pudo, `87` no pudo preparar el worktree, `88` sesión con modelo local,
   `89`/`90`/`91` `--revertir` se negó, `92` el worker está vivo, `95` local sin servidor, `96` sin cupo
   y sin caída permitida, `130` matado. La app muestra un texto distinto por cada uno: un código nuevo o
   movido se ve como un error sin sentido en la interfaz.

2. **El stdout.** Sólo el bloque `RESULTADO` / `ARCHIVOS` / `DECISION` / `SIGUE` (más `PREGUNTA:` y
   `PROBAR:`), con saltos `\n` **también en Windows**. Los parsers de entrada aceptan `\r?\n`, pero lo
   que se emite nunca lleva `\r`: hay tests que comparan byte a byte.

3. **Los nombres de los archivos de estado.** `<id>.running`, `.ultimo`, `.listo`, `.pid`, `.hilo`,
   `.sid`, `.corrida`, `.cola`, `.jefe`, más `medicion.tsv`, `eventos.jsonl` e `integradas.tsv`. La app
   los lee (algunos directamente) y los vigila con inotify o su equivalente. El `.running` del worker va
   en `<slug>[@k].running`, **no** adentro de la carpeta del proyecto: es lo que cuenta el tope global.

4. **Los contratos JSON**: `pa --hilos`, `pa --hilo`, `workers --json`, `trama-estado --json`,
   `reparto --json`. Todos traen `version`; la app corta con un error si no la reconoce. Agregar un
   campo está bien, renombrar o sacar uno rompe la interfaz.

5. **El texto del contrato del worker** (lo que `pa` le pasa a `claude -p`) y el orden de los chequeos
   previos. Si cambia el texto cambia lo que el worker responde, y los parsers (`campo_de`, `bloque_de`)
   dejan de encontrar los bloques.

La regla de verificación es **paridad byte a byte contra la versión bash**: para cada pieza, correr las
dos con la misma entrada y comparar la salida, el `argv` que se le arma a `claude` y los archivos que
quedan en disco. Los bloques de la suite de bash se extraen por patrón de texto, nunca por número de
línea.

## Las siete trampas de Windows

### 1. No hay SIGTERM

`process.kill(pid, 'SIGTERM')` en Windows es `TerminateProcess`: corta el proceso en seco, sin que corra
ningún handler. En bash, `trap al_salir EXIT` es lo que escribe `.ultimo` y `.listo` al terminar; sin esa
trampa el worker queda para siempre en "trabajando" aunque ya no exista.

El cierre ordenado va por el **canal de control del lock** (el socket con nombre del puesto): `--parar` y
`--matar` le piden al `pa` que corre que cierre solo (deja `.ultimo`, `.listo`, rc 130). Si no contesta en
N segundos, `taskkill /T /F`, y **el que mata escribe `.ultimo` y `.listo` con 130 si faltan**. Esa última
parte no es opcional: es lo único que evita el worker fantasma.

`Ctrl+C` en una consola sí llega como `SIGINT`.

### 2. El lock de bash y el lock de Node no se ven

El lock de hoy es `flock` sobre un archivo (`lock/<slug>[@k]`, `lock/@tope@k`, `<slug>@git`). En Node es
un **socket con nombre**: socket abstracto `\0trama-<hash(ruta)>` en Linux, named pipe
`\\.\pipe\trama-<usuario>-<hash>` en Windows.

Son dos mecanismos distintos: **un `pa` bash y un `pa` Node corriendo a la vez no se ven los puestos** y
los dos creen que el lugar está libre. El corte de una plataforma es de una sola vez, no se puede mezclar.
Por lo mismo, un test que simule "puesto ocupado" con `flock ... sleep` no prueba nada contra el port:
hay que tomar el lock con el módulo de Node.

El nombre del lock se deriva de la ruta del archivo que usaba bash, y los archivos `@tope@k` se siguen
tocando (aunque ya no se bloqueen) porque el barrido de "máximo k existente" los cuenta.

### 3. `MAX_PATH`

Los worktrees van en `%LOCALAPPDATA%\trama\wt\<slug>\<k>\` a propósito: corto. Un `node_modules` hondo
pasa los 260 caracteres y las herramientas que no usan rutas largas fallan con errores que no dicen nada.
Toda llamada a git lleva `-c core.longpaths=true` (y `-c core.autocrlf=false`, por `GIT_CONFIG_COUNT`).

El resto del estado:

```
%LOCALAPPDATA%\trama\node\      el node.exe del instalador
%LOCALAPPDATA%\trama\bin\       pa, pa.cmd, tablero, reparto, trama-estado, workers (en el PATH del usuario)
%LOCALAPPDATA%\trama\app\       el motor compilado y los hooks
%LOCALAPPDATA%\trama\estado\pa\ lo que en Linux es ~/.local/state/pa
%LOCALAPPDATA%\trama\config\    lo que en Linux es ~/.config/trama
%LOCALAPPDATA%\trama\tablero\   items.jsonl
%USERPROFILE%\.claude\          de claude (los hooks se registran en su settings.json)
```

Un solo módulo sabe esto. Las variables de siempre (`PA_STATE`, `PA_PROJ`, `PROYECTOS_REGISTRY`,
`TRAMA_*`) mandan igual en las dos plataformas: son las que usan los tests.

### 4. Los enlaces no son symlinks

Los caches compartidos del worktree (`node_modules`, `.venv`, `target`, `.env`, el transcript de
`--seguir`) hoy son `ln -s`. En Windows un symlink pide privilegios; en su lugar:

- **carpeta** → junction (`symlinkSync(destino, enlace, 'junction')`, no necesita permisos especiales).
- **archivo** → hardlink si está en el mismo volumen, y si no, copia.

El borrado de builds **no debe atravesar el enlace**: en bash eso se logra con un `rm -r` sin barra final.
`fs.rmSync(dir, {recursive:true})` no sigue symlinks, pero **con junctions hay que comprobarlo**: un
borrado que atraviesa el junction se lleva el cache compartido del árbol principal. Es la clase de bug que
sólo se ve cuando ya pasó.

Ojo también con `realpath` sobre un junction: devuelve el destino.

### 5. Los pid se reusan

Windows reparte pid cortos y los recicla rápido, así que `process.kill(pid, 0)` puede dar "vivo" para un
proceso que no es el nuestro. No alcanza con el pid: se cruza con el latido (`hb` fresco) y con la hora de
arranque anotada. En Linux eso se verifica con el campo 22 de `/proc/<pid>/stat`.

Para el árbol de procesos: `taskkill /T` en vez de `pgrep -P`. Buscar un proceso por su `--session-id`
cuesta ~1 segundo con `Get-CimInstance Win32_Process`: se usa sólo como último recurso en `--matar`,
porque `pa` ya anota el pid en `.running`.

### 6. El antivirus mete `EBUSY` y `EPERM`

`renameSync` encima de un archivo que otro proceso tiene abierto da `EPERM`, y el escaneo en tiempo real
hace fallar renames y borrados que en Linux andan siempre. Toda escritura atómica (`.tmp` + rename) y todo
borrado recursivo van con reintento y espera corta (hasta ~2 s). Sin eso, la escritura de `items.jsonl`
del tablero falla de a ratos y sin patrón.

### 7. No hay systemd

El motor arranca por `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (no necesita admin), y
`trama-estado` lo detecta por el proceso y el puerto en vez de preguntarle a systemd. El socket del motor
es `\\.\pipe\trama-motor-<usuario>` en vez de `$XDG_RUNTIME_DIR/trama/motor.sock`.

Lo que depende del escritorio de Linux (`hyprctl`, `/proc/stat`, el dictado por `handy`) se apaga por
plataforma, no se emula.

## Equivalencias, en corto

| Hoy | Node |
|---|---|
| `flock -n` / `-w N` | lock por socket con nombre; `-w N` = reintento cada 50–100 ms |
| `setsid nohup … & disown` (`--async`) | `spawn(…, {detached:true, windowsHide:true}).unref()` |
| `kill -0`, `ps -o stat=` | `process.kill(pid,0)` + latido + hora de arranque |
| `pgrep -P` (árbol) | `taskkill /T` |
| `trap … EXIT` | handlers en Linux; en Windows, canal de control del lock (ver trampa 1) |
| `/proc/meminfo` MemAvailable | `os.freemem()` (libuv ya devuelve MemAvailable) |
| `timeout -k N` | `spawn` + temporizador → matar el árbol |
| `jq`, `awk`, `sed`, `date -d`, `stat -c %Y` | JSON nativo, `Date`, `statSync().mtimeMs` |
| `ln -s` | symlink, junction, hardlink o copia según el caso (trampa 4) |
| `git`, `git worktree` | el mismo git, con `-c` fijos y array de args (nunca shell) |
| `systemd-run`, `systemctl --user` | la unit en Linux; en Windows, la clave `Run` |

## Cómo está partido

Un módulo por responsabilidad, con la base abajo:

```
base/rutas.ts     dónde vive cada cosa por plataforma
base/lock.ts      tomar / esperar / sondear + canal de control
base/proc.ts      lanzar, esperar con tope, árbol, matar, vivo(pid, inicio), desprender
base/archivo.ts   escritura atómica con reintento, append bajo lock
base/git.ts       git con los -c fijos, porcelain, worktree, rebase
base/enlaces.ts   symlink | junction | hardlink | copia, y borrar sin atravesar
pa/cli.ts         flags, ayuda, códigos de salida
pa/contrato.ts    el texto del contrato y sus parsers
pa/politica.ts    modelo × effort, plan, candados
pa/puestos.ts     puestos, tope global, admisión por RAM, worktrees, caches, builds
pa/lanzar.ts      armar la llamada, settings del worker, .running/.ultimo/.listo, medición
pa/esperar.ts     --async, --esperar, cola, 75
pa/matar.ts       --parar, --matar, cierre ordenado
pa/integrar.ts    --ramas, --integrar, --revertir, --descartar, --actualizar
pa/hilos.ts       --hilos, --hilo, eventos, --estado, --rinde
pa/motores.ts     reparto, modelos.json, proveedores alternativos
```

`pa` importa `tablero` y `reparto` como módulos (hoy los llama como subprocesos con `timeout`); los CLI
siguen existiendo porque los usan la app y la persona.

## Lo que conviene portar primero

Las piezas sin estado (parseo de flags, política de modelos, el texto del contrato y sus parsers, los
hooks) se portan casi línea por línea y se verifican solas contra la versión bash.

El riesgo está concentrado en el **lanzador**: armar la llamada, el puesto, el worktree, el ciclo de vida
del proceso y la clasificación de fallos (76, 77, 78, 81, 84). Son ~1300 líneas de bash en bloques que no
son contiguos, y conviene partirlo en pedazos chicos empezando por **cómo se arma el `argv` de
`claude -p`**: eso fija la firma del resto y deja avanzar las demás piezas en paralelo.

Dos cosas que no son opcionales en ninguna pieza: que los códigos de salida y el stdout queden idénticos,
y que lo que mata a un worker deje su `.ultimo` y su `.listo`.
