# Traspaso: estado de Trama al 27/10/2026

Para retomar el trabajo en otra sesión, con otra persona o con otra herramienta. Repo: `FeroxShark/trama`; se trabaja en una
rama y el dueño (Ferox) abre y mergea los PR desde la web de GitHub. `main` tiene una regla que impide borrarlo y reescribir su
historia (force push); se puede subir directo y mergear sin esperar el CI.

## Cómo se trabaja (reglas del dueño)

- **Idioma:** todo en español rioplatense (código comentado en español, interfaz es + en).
- **Accesibilidad:** el dueño tiene deuteranomalía. Ningún estado puede depender sólo del rojo o el verde: siempre con palabra
  o ícono.
- **CSS:** sólo con los tokens que ya existen. i18n en `app/src/i18n/es.ts` y `en.ts`.
- **Claves y secretos:** nunca se pegan ni se loguean. Viven sólo en `~/.config/trama/claves.env`.
- **Windows:** nada de bash, WSL ni Git Bash, ni siquiera de respaldo (regla fija, ver `motor/docs/port-windows-plan.md`).
- **Cuentas:** no rotar cuentas de Claude ni de OpenCode para esquivar límites.
- **PR:** no se abren salvo que el dueño lo pida. Sin nombres de modelos de IA en commits ni en PR.
- **Antes de cada commit**, desde `app/`: `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p tsconfig.electron.json --noEmit`,
  `npx vite build`, `npm test`. Si se toca el motor que se está portando: `npm run test:paridad`.
- **Instalar en la PC del dueño** (Linux), desde la carpeta del repo:
  `git checkout main; git pull; bash motor/scripts/instalar-producto.sh`. Desde la app: el aviso "Hay una Trama nueva" hace lo mismo (ver Hecho).

## Qué es Trama (mapa rápido)

- `app/`: Electron + React 19 + Vite + TS. `app/electron/` es el proceso principal (IPC en `nucleo.ts`, `preload.cts`,
  `src/puente.ts`); `app/src/` es la interfaz (barra lateral en `src/barra/`, ajustes en `src/paneles/`, hilos en `src/hilo/`).
  Tests con `node --test` (`app/scripts/test.mjs`).
- `motor/`: `bin/pa` (delega tareas a workers en worktrees; el default es el pa de TS, ver Hecho abajo), `bin/reparto` (elige
  modelo según calidad y cupo), `bin/tablero`, `bin/cuentas` (estos tres también defaultean a TS), `bin/trama-estado`, hooks
  (`motor/hooks/*.mjs`), runner de OpenCode (`motor/opencode/`).
- CI: `.github/workflows/ci.yml`, trabajos `linux` y `windows`.

## Hecho (ya en `main`)

- **Calidad por esfuerzo con Artificial Analysis (AA).** La base es el índice de inteligencia general de AA para todos los
  modelos. Los esfuerzos (low…max) salen de la API y de la tabla `motor/datos/aa-suplemento.json` (49 entradas cargadas el
  27/10 desde las páginas de AA: Claude 5.5, Gemini 4 Argon/3.8 Flash, Kimi, GLM, Qwen, DeepSeek V4.1 Flash, MiMo, MiniMax,
  GPT-6). Si la API trae un dato, manda la API. Lo que falta se estima con la pendiente de modelos de la misma empresa y se
  rotula "estimado". Nunca se rankea por max. **Costo = "Cost to Run" de AA (USD de correr el índice completo)**, no por
  tarea; el costo estimado se escala a esa unidad (`ESCALA_INDICE` en `app/src/paneles/efforts-dominados.ts`).
- **OpenCode Go** (plan gratis / go / go-plus, topes en `motor/opencode/go-topes.json`, agotado por modelo). Sin Go se fuerza
  un `small_model` gratis para evitar los 402 de GPT-6 Luna.
- **NVIDIA NIM** (gratis, clave propia `NVIDIA_API_KEY` en `claves.env`, ~40 pedidos/min por modelo, sin tope diario; para desarrollo y
  prototipos): corre por opencode (`pa -m opencode:nvidia/<modelo>`), grupo `nvidia-nim` en `reparto`, modelos en `nvidia_modelos` de
  `modelos.json`. Un 429 enfría sólo ese modelo unos minutos (nunca agota `opencode-free`). En la app: Ajustes > OpenCode (clave, Probar,
  ayuda, modelos; `app/electron/nvidia-nim.ts`) y su fila `nvidia-nim` (ventana `1m`) en Plan y cupos y en la barra: los pedidos se cuentan por
  paso en `opencode-pedidos.jsonl` (`nvidia/<modelo>`).
- **Conectores MCP:** `/mcp` en la app, Ajustes > Conectores (`mcp.json` + secretos en `claves.env`), se pasan a Claude, DeepSeek
  Harness y OpenCode; en Gemini figura "no disponible".
- **Menú de comandos por motor**, guías rápidas que no mueven la pantalla.
- **Aviso de "hay una Trama nueva" (Linux).** `app/electron/actualizacion-trama.ts` consulta `releases/latest` de GitHub
  (sin token) al abrir la app, al enfocarla, al volver la red y cada 2 min (con ETag: un 304 no gasta el límite; un 403/429
  espera sin mostrar nada), sin bloquear y en silencio si no hay red; compara por semver contra la `version`
  de `app/package.json` (0.2.0 contra v0.1.4: no avisa). Pie de la barra, mismo globito que Claude Code y agy
  (`AvisoClaude cual="trama"`): versión nueva, "Notas de la versión", "Actualizar" y "Ahora no" (recordado por versión).
  Actualizar corre en el main, por argv y sin shell, en el checkout de donde se instaló: `git fetch --tags`, `git checkout
  --detach refs/tags/<tag>` y `bash motor/scripts/instalar-producto.sh`; el tag pasa por `^v\d+\.\d+\.\d+$`. El instalador
  anota ese checkout en `~/.config/trama/checkout` (sólo si la fuente es un checkout git; si no, lo borra y la app no avisa).
  Una instalación hecha antes de este cambio no tiene el archivo: hay que reinstalar una vez (`git checkout main; git pull;
  bash motor/scripts/instalar-producto.sh`). Con cambios sin commitear en el checkout no toca nada y lo dice en el aviso.
  `trama:actualizar` es sólo de la PC (`SOLO_PC_TAILNET`) y el celular ni recibe el aviso. En la carcasa de Windows no se
  muestra (el `.exe` tiene lo suyo, Ajustes > Trama para Windows). El instalador respeta `TRAMA_SIN_REINICIO_VENTANA=1` (no
  reinicia la ventana que lo corre: el resultado dice "Listo, reiniciá Trama"). Tests: `app/tests/actualizacion-trama.test.ts`;
  capturas: `scripts/captura.sh trama|trama-abierto|trama-sucio`.
- **Port a Windows, etapas 0 a 4:** CI linux + windows, base TS (`app/electron/cli/base/`), arnés de paridad bash vs TS
  (`app/tests/paridad/`), `proyecto-ruta` / `trama-estado` / `workers` en TS, hooks en `.mjs`.
- **Default en TS (etapa 11 del port, Linux).** `motor/bin/pa`, `reparto`, `tablero` y `cuentas` corren el port de TS
  (`app/dist-electron/cli/<x>.js`, compilado con `npx tsc -p tsconfig.electron.json` en `app/`; `dist-electron/` no va al
  repo). Escape hatch: `TRAMA_PA=bash` vuelve al `pa` de bash; `TRAMA_REPARTO=py`, `TRAMA_TABLERO=py` y `TRAMA_CUENTAS_CLI=py`
  vuelven a los de python. Si falta node o el `.js`, cada uno avisa por stderr y sigue con el original. El `pa` de TS sale 70
  para lo que no porta y entonces sigue el bash (con `TRAMA_PA=bash` exportado para los hijos). El arnés de paridad fija esas
  variables en el lado A (el original), así que compara bash/python contra TS de verdad.

## Hecho: limpieza de worktrees y ramas viejos de pa

- **`pa --limpiar [--ver|--si] [--dias N] [--json]`** (bash en `motor/bin/pa`, TS en `app/electron/cli/pa/limpiar.ts`, con paridad en `casos-globales.ts`).
  Sin `--si` sólo muestra (`--ver` es lo mismo, explícito). N: `--dias`, o `PA_LIMPIAR_DIAS`, o 7. Quita, siempre con el puesto tomado (flock) y el
  candado de git del proyecto: (1) un puesto entero (k ≥ 2, nunca el 1) libre, en HEAD suelto cuyo commit está en alguna rama o tag, sin nada
  sin commitear salvo los enlaces y dirs de build que puso pa, con el HEAD sin moverse hace N días (`git worktree remove`; pa lo rearma al
  necesitarlo); (2) los dirs de build de los demás puestos libres sin archivos tocados en N días; (3) las ramas `pa/<slug>/<id>` de una `.corrida`
  con id de hace N días o más que ya son ancestro de HEAD del tree principal y no están checkouteadas en ningún worktree (`git branch -d`,
  nunca `-D`; con commits propios se borra también su `.corrida`). Una rama con commits sin integrar o un puesto en una rama no se tocan jamás;
  si algo no se puede comprobar, no se quita. `--json` deja `{dias, aplicado, enUso, builds, worktrees, ramas, bytes}` en una línea.
- **En la app:** Ajustes > Proyectos > «Limpieza de worktrees y ramas viejos» (`AjustesLimpieza.tsx`, canales `limpieza:leer|guardar|ver|aplicar`,
  `electron/limpieza-pa.ts`): chips de días (3, 7, 14, 30), «Ver qué se borraría» muestra la lista exacta y «Borrar lo de la lista» la aplica.
  La pasada automática (`limpieza.auto` en `preferencias.json`) viene APAGADA; prendida corre `pa --limpiar --si` a los 3 min de abrir la app y
  cada 6 h. Los dos canales que escriben son sólo de la PC (`SOLO_PC_TAILNET`).
- Windows: la misma lógica de TS (disposición `%LOCALAPPDATA%\trama\wt\<slug>\<k>`); falta probarla en un Windows real.

## Hecho: los avisos de workers al líder no se pierden (cola persistente por `jefe_id`)

- **Causa:** `avisarAlLider` (nucleo.ts) encolaba el aviso sólo si el líder tenía proceso en ese instante (`lider.seleccionDe`) y, si no
  (líder o Trama reiniciados), lo tiraba en silencio; un "terminó" a un líder ocioso también se tiraba, y lo que esperaba el cierre de una
  tanda vivía sólo en memoria. Lo que terminaba con Trama apagada nunca se detectaba.
- **Ahora** (`app/electron/avisos-pendientes.ts`, `avisos-lider.json` en el estado de Trama): cada aviso se anota al detectarlo
  (`registrar`), se libera cuando se le puede decir (`liberar`: al cerrar la tanda, o ya en modo por worker/cupo/colgado) y `entregar` lo
  encola SÓLO con el líder con proceso: a mitad de turno, todo junto; ocioso, las fallas ya y un simple "terminó" a los ~20 s (`GRUPO_MS`: los que terminen en ese rato salen juntos, y despiertan al líder con un turno nuevo sin esperar al usuario; si el líder empieza un turno antes, sale a mitad de ese). Sin
  proceso espera y, al volver el líder, sale UN resumen ("Mientras no estabas terminaron N workers…").
- **Entregado = la cola confirmó el envío** (`Encolado.avisos` + `Deps.salida` de `cola.ts`). Si falla, sigue en la cola y anotado; al
  arrancar, lo `encolado` que no está en `cola.json` vuelve a pendiente. Quitarlo de la cola lo descarta; cerrar el líder adrede lo devuelve.
- **Rescate:** `descubrir` registra a los workers de un líder que terminaron (fin = `inicio + duracion_s`) después de la última lista
  vista mientras Trama estaba apagada. No se avisa lo que alguien ya cerró (integrado, archivado, descartado) ni lo que volvió a andar.
- Sin canales nuevos: vale igual en Linux y Windows. Lo prueba `tests/avisos-pendientes.test.ts`.

## Hecho: la cola entrega entre herramientas, todo junto

- **Entrega por defecto a mitad de turno:** lo que el usuario encola con el líder trabajando ya no espera al fin del turno ni obliga
  a interrumpir. Pasado un ratito (`AGRUPAR_MS`, 1,5 s, para juntar lo que se escribe enseguida), `cola.ts` manda TODO lo encolado
  por `lider.mandarDirecto`: el CLI lo guarda y lo entrega en el próximo `tool_result` (`queued_command`), sin cortar la herramienta.
  Sin canal (modelos locales, o `trama` cerrándose) se entrega al terminar el turno. Gemini, DeepSeek Harness y OpenCode usan su
  puente (corta en el próximo límite de paso).
- **Siempre junto:** `juntar` arma UN mensaje en orden (`Mensaje 1 de N:` ... separado por `---`, con las imágenes de cada uno
  indicadas); uno solo sale tal cual. `loteDe` parte el lote si pasa de 20 imágenes. Nunca uno por turno.
- **Modelo y esfuerzo:** el lote sale con la selección vigente (`lider:colaSeleccion`); a mitad de turno no se cambia el modelo,
  el cambio queda para el próximo turno (como antes). Si el envío falla, vuelve todo a la cola con el error y no se reintenta solo.
- **Caja:** la cola se ve como "N en cola · salen en la próxima pausa" (`lider.cola1` / `lider.colaN`). "Mandar ya" desapareció.

## Hecho: los modelos de agy salen de la cuenta

- `reparto --agy-modelos [--refrescar] [--cuenta C] [--json]` lee `agy models` (caché 6 h, `REPARTO_AGY_MODELOS_S`; si agy falla usa la última lista). `reparto` elige sólo entre esos modelos; los que `FAMILIAS` no conoce entran como candidatos `agy:<id>` con la calidad de su familia en `low` (o 0 si no tiene familia) y origen `estimada`.
- Un modelo que agy rechaza ("invalid model selection") se enfría 24 h (`reparto --enfriar`, `PA_ENFRIAR_AGY_H`) y `pa` relanza con el siguiente candidato (`agy_modelo_invalido` en `motor/bin/pa`, `relanzarPorModeloAgy` en `cli/pa/cupo.ts`). En TS sólo se pasa a otro modelo de agy, igual que el relanzado por 429.
- La app: `modelos:config` suma `agyModelos` (`electron/agy-ofrecidos.ts`); `src/hilo/modelos.ts` (`agyDeCuenta`) arma la fila de Google con esos. Los ids sin nivel en el nombre (`…-thinking`) se lanzan tal cual (`recordarAgySinNivel`). Ajustes > Modelos ya sale de `reparto --tabla`.
- Tests: fixtures `tests/fixtures/agy-models-cuenta-b*.txt`, casos "agy de otra cuenta" en `tests/paridad/casos-reparto.ts` y los de rechazo en `casos-cupo.ts`.

## Hecho: cambiar modelo o esfuerzo con el líder trabajando

- **Los selectores de modelo y esfuerzo de la caja del líder ya no se bloquean durante un turno.** El cambio no toca el turno en
  curso: se aplica al próximo mensaje que salga. Si lo elegido difiere de lo que usa el turno, el selector lleva un reloj y
  "próx." (tooltip y nombre accesible lo dicen; no depende del color). `app/src/hilo/pendiente.ts`, `Selector.tsx` (`pendiente`).
- **Cola:** un mensaje encolado sale con lo elegido en el momento en que se desencola, no con lo de cuando se encoló. La caja avisa
  cada cambio mientras hay cola (`lider:colaSeleccion`, `cola.elegir` en `app/electron/cola.ts`); la selección se olvida al
  vaciarse la cola.
- **Mandar ya:** `mandarDirecto` ya no rechaza si difiere el modelo o el esfuerzo: el mensaje entra con el del turno, y la caja
  dice "se aplica en el próximo turno" (`directo.pendiente`). Desde la entrega por defecto (abajo) el botón y Ctrl+Enter ya no
  existen como aparte: Ctrl+Enter es un Enter más; `mandarDirecto` es lo que usa la cola.
- **Cómo se aplica entre turnos (camino que ya existía, se reusa):** `mandar` en `app/electron/lider.ts`. Claude CLI: `set_model` /
  `apply_flag_settings` en vivo, sin relanzar. Gemini (agy), DeepSeek Harness y OpenCode: se cierra el proceso y se relanza con
  `--resume` en el límite de turno (la sesión no se pierde). Locales/Ollama: relanza con su endpoint.
- **Supuesto:** cambiar de motor (Claude, Gemini, DeepSeek Harness, OpenCode) a mitad de un turno queda como estaba: en el selector
  esas opciones se ven apagadas ("Otro motor: se cambia cuando el líder termine su turno") y `/model` lo rechaza; con el líder en
  reposo sigue con su confirmación. Ningún motor quedó sin cubrir dentro del mismo motor.
- **Supuesto:** el aviso de pendiente sólo existe con un turno en curso; en reposo, lo elegido simplemente sale con el próximo mensaje.
- Capturas: `HILOS_VARIANTE=pendiente|pendiente-modelo scripts/captura.sh lider-trabajando`.

## Hecho: actualizar seguro (volver a la versión anterior)

Antes de instalar una versión nueva se guarda la que corre; si la nueva no arranca bien, Trama vuelve sola a la anterior y avisa al abrir
(pastilla "Volvió a la vX" al pie de la barra). Reglas en `app/electron/arranque-seguro.ts` (y `windows/src/arranque-seguro.js`, mismo
archivo `arranque.json`): una versión recién instalada se cuenta como a prueba hasta que carga la primera página ("ventana lista");
si no llega en 60 s (`TRAMA_ARRANQUE_MAX_MS`) o se cierra sola 2 veces seguidas, vuelve. Una versión que ya llegó a ventana lista no se deshace.
- Linux (`app/electron/version-anterior.ts`): AppImage (`$APPIMAGE`) o la app estable `~/.local/share/trama/app`. Las copias van a
  `~/.local/share/trama/anterior/` (AppImage entero, o `dist/`, `dist-electron/` y `package.json`; `node_modules` no). La carpeta se copia
  antes de correr el instalador de Actualizar y también al llegar a ventana lista (así una actualización a mano deja a dónde volver); el
  AppImage se copia a sí mismo al llegar a ventana lista. Al volver se reinicia `trama-motor.service` y la ventana.
- Windows (`windows/src/version-anterior.js`): se copia la carpeta de la instalación a `%LOCALAPPDATA%\trama\anterior\Trama-<versión>`
  cuando el actualizador termina de bajar la nueva (y antes de «Reiniciar para actualizar»). Volver lo hace un guion de cmd suelto
  (espera al pid, `robocopy /MIR`, abre Trama). El actualizador no baja de nuevo la versión desechada (`rechazada`).
  La copia usa `original-fs` y archivo por archivo: el `fs` común de Electron trata `resources\app.asar` como carpeta virtual («Invalid package»).
- Windows, instalar con archivos en uso (`windows/src/disco-instalacion.js`): la carpeta de Trama NO es sólo de Trama. Un servidor MCP de
  terceros (`vrchat-mcp-osc`, `node` a secas) con cwd en `trama\app` creó `app\logs\*.log` y los tenía abiertos, y el instalador de
  la 0.2.32 (que reemplazaba cada carpeta entera) fallaba con EPERM al renombrarlos. Ahora «Instalar Trama» sólo toca los archivos
  que trae su payload: los copia encima uno por uno; nada ajeno se copia, renombra ni borra. Un archivo propio bloqueado se reintenta,
  si es idéntico se deja, y si no se aparta (`<archivo>.viejo-<marca>`, renombrar un .exe en uso sí se puede) y se copia el nuevo; lo
  apartado se borra en la próxima instalación. Lo que una versión instaló y la siguiente ya no trae se borra gracias a
  `.trama-instalado.json` (lista de lo instalado, en cada carpeta); la primera vez no hay lista y no se borra nada (los restos de
  la 0.2.31 quedan). Si un archivo propio no se pudo reemplazar, el paso falla con una línea clara (archivo y «otro programa lo tiene en
  uso»), sin marcar la instalación como hecha. Nunca se mata un proceso ajeno.
- Windows, cwd de lo que lanza Trama: nada se lanza con cwd en `trama\app`, `node` ni `bin` (esa carpeta se reemplaza al actualizar). El
  motor, el CLI y la consola de login salen con el home (`windows/src/nativo.js`), el motor se mueve solo al home si arrancó dentro
  (`salirDeLaInstalacion`, `app/electron/rutas.ts`) y `opcionesLider` pasa por `cwdSeguro` (líderes, agy, dsh, opencode, `get_usage`).
  El `node` propio tampoco va adelante en el PATH de los hijos: va al final y sólo si el sistema no tiene uno (`entornoMotor`).
  Linux no tiene `node` embebido ni asar.
- Windows, «no pude guardar la versión que corre: Invalid package …\Trama-0.2.31.tmp\resources\app.asar»: lo produce la 0.2.31 que está
  corriendo (su `guardarAntes` usa `fsp.cp`, que trata el .asar como carpeta); desde la 0.2.32 la copia usa `original-fs`, así que
  desaparece en cuanto la que corre sea 0.2.32+ (cubierto en `arranque-seguro.test.js`).
- Botón "Volver a la versión anterior": Ajustes > General (`AjustesVolver.tsx`), canales de la ventana `trama:anterior`,
  `trama:volverAnterior` y `trama:avisoVuelta`.
- Sin probar en una máquina Windows de verdad: el guion de cmd, `robocopy` y el cierre del `.exe` sólo están probados con fakes.

## Hecho en esta última pasada (commit final de la rama `claude/elegant-sagan-gvgbq5`, falta mergear)

> Ver el resultado de cada parte más abajo en "Estado de la última pasada".

1. **OpenCode como un proveedor más.** Tarjeta única en Ajustes > Plan y cupos (logo, conectado/no, plan Gratis/Go/Go Plus
   adentro); Ajustes > OpenCode ya no tiene el selector del plan. Fila de OpenCode siempre visible en la barra lateral, con el
   mismo componente que los demás. Como OpenCode no expone el uso, **trama cuenta sus propios pedidos**
   (`app/electron/opencode-pedidos.ts`, archivo `opencode-pedidos.jsonl` en el estado de reparto; workers exacto por
   `step_finish` en `motor/opencode/correr.mjs`; líderes aproximado por `usage_update` en `dsh-puente.ts`). Ventana supuesta de
   5 h como Claude (OpenCode no la documenta). Lo usado fuera de trama no se ve; la interfaz lo dice.
2. **Varias cuentas de OpenCode (hecho; falta probar con un login real).** Medido con opencode 2.1.4 (el aislamiento NO es sólo por estado: se probó): el login vive en
   `$XDG_DATA_HOME/opencode/opencode.db` y los comandos de un tiro hablan con un servicio de fondo (puerto 49374, registro en
   `$XDG_STATE_HOME/opencode/service.json`) que ya corre con los datos del dueño. Cambiar sólo `XDG_STATE_HOME` NO aísla (da
   error de puerto; y `XDG_STATE_HOME` solo tampoco aísla el login, que está en los datos). Diseño: cada cuenta agregada tiene `data/` y `state/` propios (`~/.config/trama/cuentas/<id>/`, con marca
   `.trama-cuenta`) y opencode corre con `XDG_DATA_HOME`/`XDG_STATE_HOME` de ella **y `--standalone`** (servidor propio; `login`,
   `ver --verificar` y `correr.mjs` lo agregan). `opencode acp` (líder) corre en proceso: alcanza con el entorno; el puente lee
   `TRAMA_OPENCODE_CUENTA=<id>` (`app/electron/opencode-cuenta.ts`, falla cerrado). Sin selector de cuenta en la interfaz para el
   líder todavía: sólo por esa variable; los workers, con `pa --cuenta <id>`. Pedidos (`c`) y marcas de agotado (`@cuenta`) van
   por cuenta; la fila de OpenCode de la barra sale sólo de trama (no de `reparto`). Quitar con `--borrar-credenciales` borra
   únicamente su carpeta (`carpeta_borrable`; nunca `~/.local/{share,state}/opencode`). Tests: `tests/cuentas-opencode.test.ts`
   (con opencode falso y, si está, el real sin login). **Para probar con login real:** Ajustes > Plan y cupos > OpenCode >
   Agregar cuenta, poner nombre, tocar «Iniciar sesión» (o `cuentas login <id>`), completar el navegador, volver y ver que
   la cuenta figura conectada (`cuentas ver <id> --verificar`) y que `pa <proy> -m opencode:opencode/beam-free --cuenta <id> "hola"`
   responde y suma un pedido con esa cuenta, sin tocar el login del dueño (`opencode auth list` sigue igual).
   **Plan detectado solo (hecho).** `cuentas --json --verificar` suma `plan_detectado` a cada cuenta de OpenCode, leído de
   `opencode models` con el entorno de ESA cuenta (`gratis` si lista modelos y ninguno `opencode-go/*`; `go` si hay alguno;
   nada si no contesta o con error). La tarjeta de Ajustes lo muestra como «detectado» y lo aplica sola si difiere; el
   selector Gratis/Go/Go Plus quedó plegado («elegido a mano») de respaldo. `cuentas plan <id> --detectar` lo guarda en una
   agregada. **Límites:** (a) no se pudo comprobar el caso con Go (no hay cuenta con Go a mano; sólo se ve con salida
   inventada en los tests), (b) Go y Go Plus usan el mismo catálogo `opencode-go/*`: no se distinguen, Go Plus sigue siendo
   manual (si lo elegiste a mano y se detecta Go, no se pisa), (c) la API de la Console necesita los tokens de `opencode.db`
   (secretos, no se leen).
   **Barra de cupos.** Una cuenta por proveedor: sin subfila de cuenta ni «principal»; 2 o más: la fila del proveedor y debajo
   una por cuenta con su nombre. Google dibuja una subfila por grupo (lo que traiga: 5 h, semana o ninguna). El reinicio va
   siempre junto al %; en barra angosta (≤ 15 rem útiles) el nombre pasa arriba y las dos celdas debajo, el logo no se
   esconde. Capturas: `HILOS_VARIANTE=cupos-todo[-dos][-angosta] scripts/captura.sh normal`.
3. **Port a Windows, etapa 5 (EMPEZADA).** `app/electron/cli/pa/{ayuda,contrato,entorno}.ts` (~500 líneas) y `pa --version`
   en el `pa` de bash. Falta el punto de entrada, el parseo completo, los subcomandos de lectura y los casos de paridad
   `app/tests/paridad/casos-pa.ts`. Detalle de etapas en `motor/docs/port-windows-plan.md`.
4. **Ajustes > Proyectos rehecho** (ver estado abajo): una tarjeta por proyecto con nombre, renombrar e instrucciones juntos,
   aviso arriba si hay proyectos sin unificar y "Unificar todos". Lo mecánico se aplica directo (con copia en `md-backup`);
   cuando hay que fusionar contenido distinto, la idea es lanzar un worker de `pa` que lo haga en su rama y se revise en Ramas.

## Estado de la última pasada

Verificado antes del commit final: los dos `tsc` sin errores, `vite build` bien, `npm test` 1784 pasan, 0 fallan, 53 salteados.

| Parte | Estado |
|---|---|
| OpenCode como proveedor (tarjeta, barra lateral, pedidos contados por trama) | Terminado y con tests |
| Varias cuentas de OpenCode | Hecho y con tests (opencode falso y real sin login); falta probar un login real (punto 2) |
| Etapa 5 de Windows (`pa` en TS) | Empezada: `ayuda`, `contrato`, `entorno`; falta entrada, parseo, subcomandos y paridad |
| Ajustes > Proyectos: tarjeta única, aviso y "Unificar todos" mecánico | Terminado y con tests (`app/src/paneles/unificar-clase.ts`) |
| Fusión con un worker de `pa` (casos con contenido distinto) | **Hecho.** IPC `orq:mdFusionar` (fusión y acortado con brief, no relanzar si hay hilo o rama pendiente, botón a Ramas) |

**Fusión con worker (implementado en `app/electron/paneles.ts`, `nucleo.ts`, `ProyectosMd.tsx`, `AjustesProyectos.tsx`):**
1. IPC nuevo `orq:mdFusionar` en `app/electron/nucleo.ts` (sumarlo a `SOLO_PC_TAILNET`), `preload.cts`, `src/puente.ts` y la
   fuente fija de `src/datos/proyectos.ts`. Lanza `pa <nombrePa(slug)> --async --tipo codigo-acotado "<brief>"` sin `-m` (que
   reparto elija), por `enCola`, validando el slug con `PROYECTO` (ver `argvLanzarRama` en `app/electron/paneles.ts`).
2. Brief: no perder ninguna regla; deduplicar sólo lo idéntico; ante contradicciones dejar las dos versiones marcadas con un
   comentario para el dueño; CLAUDE.md y GEMINI.md quedan como `MD_STUB` (`instrucciones-md.ts`); avisar si pasa `topeAgents`;
   commitear en su rama. Así la rama aparece en el panel de Ramas para revisar e integrar.
3. No relanzar si ya hay un hilo vivo o una rama sin integrar de esa fusión (`pa --hilos --json` con un marcador en la tarea;
   como mínimo, un Set por sesión de la interfaz).
4. En la tarjeta: "Un agente lo está fusionando: revisalo en Ramas", con un botón al panel de Ramas.
5. Tests del argv y del no relanzar.

## Hecho: panel derecho de contexto (base e interfaz)

Para el líder que se está mirando y sus workers: en qué se va el contexto y apagar cosas para TODO Trama. El main y los canales están;
la interfaz la hace otro worker encima. Todo vale para Linux y Windows (el worker de Windows corre el port `electron/cli/pa`).

- **Canales** (`electron/canales/contrato.ts`, `nucleo.ts`, `preload.cts` → `window.hilos.paneles.*`, tipos en `src/puente.ts`; ruta
  `local` en `maquinas-contrato.ts`; `windows/src/canales.json` regenerado). Leer anda también por la red (celular); `apagados:fijar`
  es sólo de la PC (`SOLO_PC_TAILNET`).
  - `contexto:desglose` — `desgloseContexto({ lider: sid } | { worker: id })` → `Desglose` (`electron/contexto-desglose.ts`):
    `usado`/`ventana` (+ `ventanaEstimada`), `categorias` (`sistema`, `herramientas`, `mcp`, `skills`, `memoria`, `agentes`, `mensajes`,
    `reserva`, `libre`; las `diferido` no suman), `herramientas` (integradas, con tokens y `usos`), `mcp` (por servidor con sus
    herramientas, tokens, `cargada` y `usos`), `skills` (tokens, origen, plugin, `usos`), `memoria` (por archivo), `usos` crudos y
    `sinUso` (lo que pesa y no se usó en la sesión: el candidato a apagar). `fuente`: `claude` (líder de Claude vivo: el `/context` por
    el canal de control, `get_context_usage` con `detail: "summary"`, sin turno ni interrupción; exacto), `transcript` (worker de `pa`, o
    líder sin proceso: el total del último pedido del `.jsonl`, lo fijo del primero, memoria y skills medidas de los archivos; todo con
    `estimado: true`) o `sin-desglose` (Gemini, dsh, OpenCode, o sin transcript; `motivo` dice por qué). Mostrar "≈" en lo estimado.
  - `skills:catalogo` — `catalogoSkills({ q?, sid? })` → `{ skills, total, exactos }`: cada skill con `clave` (la del apagado:
    `plugin:skill` si es de un plugin), descripción, `origen`/`de`, `tokens` (estimados; exactos si se pasa el `sid` de un líder de
    Claude vivo) y `estado` (`activa`, `apagada` por Trama, `plugin-apagado`). `q` busca sin tildes ni mayúsculas, todas las palabras.
  - `apagados:leer` — `leerApagados()` → `{ apagados: { skills, mcp, herramientas, memoria }, protegidas, motores }`.
  - `apagados:fijar` — `fijarApagado(tipo, nombre, apagado)` → lo mismo más `lideres: { reiniciados, pendientes }` y
    `aviso: "proximo-mensaje"`: la vista tiene que decir "se aplica al próximo mensaje". Nombres: skill = su `clave`; MCP = el nombre del
    servidor como lo muestra `/mcp` (`claude.ai Notion`); herramienta = integrada (`WebFetch`) o `mcp__srv__herr`; memoria = ruta o glob
    absolutos. `Bash`, `Read`, `Edit` y `Write` no se dejan apagar (`HERRAMIENTAS_PROTEGIDAS`).
- **Cómo se aplica** (`electron/apagados.ts`): el registro vive en `<config de trama>/apagados.json` y de él sale
  `apagados-claude.json`, un pedazo de settings de Claude Code (`skillOverrides: { x: "off" }`, `permissions.deny` con `mcp__<servidor>`
  y las herramientas, `claudeMdExcludes`). Sin nada apagado no hay pedazo y todo queda como antes. Workers: `pa` (bash, con jq) y su port
  (`settingsWorker`) lo suman a su `--settings` (excludes y deny agregados a los propios); caso de paridad en
  `tests/paridad/casos-lanzar.ts`. Líderes de Claude: un `--settings <pedazo>` en `argvLider`; al cambiar algo, `aplicarApagadosLideres`
  cierra los ociosos y el próximo mensaje los relanza con `--resume` (la conversación sigue entera); los que están respondiendo, al
  terminar el turno. Gemini, dsh, OpenCode, Ollama y los locales no lo toman (no cargan skills ni memoria de Claude Code).
  Nunca se toca `~/.claude.json` ni credenciales.
- Tests: `tests/contexto-panel.test.ts` (fixtures inventados).
- **Interfaz** (`src/paneles/PanelContexto.tsx`, `contexto-panel.css`, lógica pura en `contexto-vista.ts` con `tests/contexto-vista.test.ts`; datos en
  `src/datos/contexto.ts` con fixtures en `fixtures-contexto.ts`): reemplaza al panel de consumo (borrado, con su prueba). Mira al líder abierto (o al de
  lo abierto: un worker o un subagente) y a sus workers sin cerrar. Dos pestañas: "Sesiones" (el líder siempre abierto y cada worker en una fila plegable con
  su mini barra; cada uno con barra apilada, mapa de bloques y categorías que se abren con sus ítems: tokens, usos, "nunca usada" y el interruptor) y
  "Catálogo de skills" (buscar sin tildes, filtros todas / apagadas / nunca usadas, plugin). "Nunca usada" sólo se afirma con una sesión medida
  (`sabeUsos`). Apagar vale global y el aviso va siempre a la vista y, tras cada cambio, en una región `role=status`. Sigue usando el botón del pie, la
  tecla `t` y la preferencia `consumo` (sólo se guarda desde la ventana). En el celular ocupa la pantalla (se abre desde el botón del pie de la lista) y
  sólo se mira: apagar es de la PC. Capturas: `contexto-panel`, `contexto-panel-cat`, `contexto-panel-skills`, `contexto-panel-ayuda` (el "?" abierto) y `contexto-panel-previa` (con `HILOS_VARIANTE=sin-base`, sin el prompt base).
  - **"?" en cada categoría y pieza** (`Ayuda` en `PanelContexto.tsx`, textos `ctxp.ayuda.*`): una o dos líneas en palabras simples; "Compact reserve" (Reserva)
    explica que es lo que Claude Code deja libre para poder compactar.
  - **Sistema y Herramientas**: Sistema muestra el texto real del prompt de Claude Code partido en secciones (`partirPrompt` en `contexto-sesion.ts`, de
    `prompt_snapshot` del transcript; lo que no tiene título figura como "Instrucción suelta"). Herramientas lista cada una con sus tokens, las cargadas y las
    diferidas aparte (también con `/context` en `summary`, que no trae `systemTools`: se completa con el transcript). No hizo falta ningún proxy: Claude Code
    anota en el transcript el pedido que armó (`api-request-shape` y `prompt_snapshot`), así que no se toca ningún header ni token.
  - **Vista previa** (tercera pestaña; `electron/contexto-previa.ts`, `contexto-base.ts`; canales `contexto:previa` y `contexto:capturarBase`, este último sólo
    desde la PC y también en `windows/src/canales.json`): elegís Líder nuevo o Worker nuevo, proyecto y modelo, y calcula sin lanzar nada lo que cargaría
    (sistema, herramientas, CLAUDE.md por archivo, memoria, skills, MCP y hooks) con los apagados de Trama aplicados; los interruptores son los mismos
    (`apagados:fijar`). El prompt base y las herramientas se capturan UNA vez por versión de `claude` con `claude -p ok` (modelo más chico, carpeta vacía,
    sin `ANTHROPIC_*`: siempre la suscripción), se leen de su transcript y se guardan sólo el prompt y las herramientas en `<config de trama>/prompt-base.json`
    (se guardan las 6 versiones más nuevas); el transcript de esa corrida se borra. Un worker de `pa` va sin MCP y sin el `CLAUDE.md` del home. Los MCP
    figuran "sin dato": su peso se sabe recién al conectar. Todo estimado (caracteres / 3,5).
- **Medición de lo cargado** (v0.2.32; `electron/contexto-sesion.ts`, `contexto-desglose.ts`, `tests/contexto-sesion.test.ts`): en Claude Code las
  herramientas de MCP son diferidas (sólo el nombre hasta `ToolSearch`), así que `desdeClaude` deja las `isLoaded === false` en `diferidos` (se
  muestran aparte y NO suman) y los resultados de esas herramientas que quedaron en los mensajes en `resultados` (van dentro de Mensajes). Los
  ítems de cada categoría se topan a su total (`topar`: nunca la superan). El líder vivo guarda su última medición exacta (`ultimaMedicion`,
  `medirConRespaldo`): si al refrescar no contesta, se muestra esa, con el aviso `desactualizado`, y la cifra no cambia. **Sistema** se parte en
  piezas del transcript (prompt, CLAUDE.md/AGENTS.md por archivo, memoria, hooks de inicio, lista de skills y de herramientas diferidas, entorno)
  con su texto (cortado a 4000 caracteres, `truncado`); lo que no se pudo separar queda como "sin separar". Viaja dentro del desglose: no hay canal
  nuevo (nada que tocar en `windows/src/canales.json`).
- **Usos de skills** (`usosDeHistorial` en `skills-catalogo.ts`): el catálogo suma los usos de las sesiones de los últimos 30 días (herramienta
  `Skill` más los `/comandos` que escribió la persona, que cuenta el parser 2 del historial: subir `PARSER` reindexa una vez en segundo plano) y las
  skills que un hook mete solo (`porHook`: "cargada por hook", nunca "nunca usada"). Si el historial todavía indexa, `usos` es `null`, no se afirma
  "nunca usada" y el panel reintenta cada 15 s (hasta 6 veces).
- **Apagados y Compactar:** lo apagado sale del total, de la barra y del mapa (queda gris y tachado en su lista; si la medición ya no lo trae, un
  ítem "fantasma" deja prenderlo). Compactar (Mensajes, botón y clic derecho; sólo líderes de la app y ociosos) manda `/compact` con
  `liderMandar`, mira `useCompactando` y, al terminar, vuelve a medir y dice "de A a B tokens"; a los 30 s sin empezar avisa. Los workers no
  reciben comandos. Captura de refresco: `contexto-panel` con `HILOS_VARIANTE=refrescado`.
- Pendiente: un aviso en vivo (`apagados:cambio`) si hace falta con dos ventanas abiertas; el nombre de un servidor MCP que Claude Code muestra con
  espacios (`claude.ai Notion`) puede llegar del desglose ya normalizado (`claude_ai_Notion`): el panel lo apaga con lo que le llega.

## Pendiente (en orden sugerido)

1. **Mergear** la rama `claude/elegant-sagan-gvgbq5` a `main` e instalar.
2. **Probar varias cuentas de OpenCode con un login real** (punto 2 de arriba) y confirmar la detección del plan con Go.
3. **Revisión completa de experiencia de usuario** antes de seguir sumando cosas: ver `motor/docs/ux-pendientes.md`.
4. **Port a Windows**, etapas 5 a 17 + W (prueba en un Windows real). Estimado: 3 a 5 días de agentes. Ideas a tomar del PR de
   Gonza ([FeroxShark/trama#1](https://github.com/FeroxShark/trama/pull/1), NO se mergea; tiene problemas de seguridad):
   terminal interactiva con `powershell -NoProfile -Command` y marca de rc (etapa 14), salud y hooks de inicio sin Git Bash
   (etapa 14), `windows/src/nativo.js` como esqueleto de la carcasa (etapa 15), listar skills de `~/.claude/skills`. Cuando
   esté la versión de Windows, avisarle a Gonza que la descargue.
5. **Confirmar los ids `opencode-go/*`** con `opencode models` cuando el dueño tenga Go contratado.
6. **AA:** ver si la API de AA trae costo, tokens y tiempo por esfuerzo para dejar de cargar la tabla a mano. Faltan en la tabla
   Gemini 3.8 Flash medium/low y GPT-6 Luna medium (sin costo), DeepSeek V4.1 Pro (no existe en AA) y GPT-6 Sol Daybreak (sin
   datos).

## Datos útiles

- **Ajustes > Locales (modelos locales detectados):** `app/electron/locales-deteccion.ts` mira (sin prender nada) llama.cpp, LM Studio,
  vLLM y Ollama: instalado / apagado / andando, sus modelos y la VRAM. La ventana lo pinta en `LocalesDetectados.tsx` (canal
  `locales:detectar`), con las guías de instalación de Linux y Windows (`locales-detectados.ts`). Prender y apagar el servicio de un modelo
  son los canales `locales:prender` / `locales:apagar` (sólo units de systemd que la detección encuentra; sólo con el clic, tras un aviso
  de que ocupa la GPU; no existen por la tailnet). **Falta en Windows:** no hay units, así que ahí Trama muestra y guía pero no prende ni
  apaga. «Usar como motor» agrega el modelo a los `locales` del borrador de Modelos con el arnés elegido (`ollama:<m>` = Claude Code,
  `dsh:ollama/<m>` = dsh) y se aplica con el Guardar de Modelos; OpenCode no va por acá (usa sus propios proveedores).
- Uso medido de OpenCode del dueño: ~200–250 pedidos por día. Go cuesta 10 USD/mes con topes equivalentes a ~80 USD de
  DeepSeek V4.1 Flash; conviene si lo usa todos los días.
- PR abierto de Gonza: #1 (rama `windows-nativo` del fork `MaxCuratAnima/trama`). El dueño se lo comunica él.
