# Trama

App de escritorio para manejar los workers de `pa` (Electron + motor). El traspaso completo, con lo hecho y lo que
falta, está en `motor/docs/traspaso.md`.

## Cómo se trabaja

- **Idioma:** todo en español rioplatense (código comentado en español, interfaz es + en).
- **Accesibilidad:** ningún estado puede depender sólo del rojo o el verde: siempre con palabra o ícono.
- **CSS:** sólo con los tokens que ya existen (`app/src/tokens.css`). Textos en `app/src/i18n/es.ts` y `en.ts`, con las
  mismas claves y las mismas `{variables}`.
- **Claves y secretos:** nunca se pegan ni se loguean. Viven sólo en `~/.config/trama/claves.env`.
- **Windows:** nada de bash, WSL ni Git Bash, ni siquiera de respaldo (ver `motor/docs/port-windows-plan.md`).
- **Linux y Windows siempre juntos:** todo cambio vale para las dos (app en `app/`, carcasa nativa en `windows/`). Si tocás
  algo de una (instalador, servicio, ventana, canales, rutas, binarios), hacelo también en la otra o, si no se puede en esta
  tarea, decilo en el RESULTADO con "FALTA EN <Linux|Windows>: …" para que el jefe lo anote. Un canal nuevo de la ventana
  va también en la carcasa (lo controla `tests/nucleo.test.ts`).
- **Sin consolas ni programas ajenos en Windows:** todo `spawn`/`execFile`/`fork` lleva `windowsHide: true` (en `app/electron`, `windows/src` y
  `motor/**/*.mjs`; lo controla `tests/rutas.test.ts`, con la lista `aPropósito` de excepciones). Y Trama nunca ejecuta `ollama`
  en Windows (su cliente puede abrir «Welcome to Ollama»): del servidor sólo se sondea el puerto y se mira `where`.
- **Binarios de terceros en Windows (`agy`, `claude`):** buscalos con `resolverAgy`/`resolverClaude` (PATH, `%USERPROFILE%\.local\bin`, prefijo de npm; puede ser `.exe` o `.cmd`) y lanzalos con `paraLanzar`, nunca `execFile`/`spawn` directo. Ningún texto de la interfaz nombra Ubuntu ni WSL (la carcasa es siempre nativa). Lo controla `tests/cuentas-windows.test.ts`.
- **Cuentas:** no rotar cuentas de Claude ni de OpenCode para esquivar límites.
- **PR:** no se abren salvo que el dueño lo pida. Sin nombres de modelos de IA en commits ni en PR.
- **Antes de cada commit**, desde `app/`: `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p tsconfig.electron.json --noEmit`,
  `npx vite build`, `npm test`. Si se toca el motor que se está portando: `npm run test:paridad`.
- **Chequeo rápido para workers:** desde `app/`, `npm run check:changed` (`app/scripts/check-changed.mjs`). Compara contra main
  (o contra `HEAD~1` si la rama es main) y corre sólo lo afectado: tsc de la interfaz y de electron; los tests que importan
  lo cambiado (directo o por cadena de imports), lo nombran o escriben su ruta; la paridad de las herramientas del motor
  (o de su port en `electron/cli`) que cambiaron (`TRAMA_PARIDAD_HERRAMIENTA`); y `windows/` si tocó algo ahí. Corre todo si
  cambia `scripts/test.mjs`, `package.json`, los tsconfig o `vite.config.ts`, si toca `tests/paridad/`, o si cambia algo de
  `motor/` o `electron/cli/` que no está en su tabla. No reemplaza el chequeo completo de arriba antes de un commit a main:
  no corre `vite build` ni el smoke de `humo-motor.mjs`.
- **Barra lateral:** Antes de rediseñar la barra, leer app/src/barra/CONVENCIONES.md y conservar cada señal o justificar el cambio en el RESULTADO. Lo controla `tests/barra-convenciones.test.ts`.
- **Internet en los workers:** `--leer` pasa `--tools` con lista cerrada (`HERRAMIENTAS_LEER` en `lanzar.ts`, espejo en `motor/bin/pa`); si se agrega una herramienta de Claude, va ahí o el `--leer` no la ve (WebSearch/WebFetch faltaban y no podía buscar). Un escritor no pasa `--tools`. Los hooks no filtran las web. codex corre con sandbox sin red y agy bloquea curl/wget por privacidad: su acceso web no se tocó.
- **Tests:** los tests no esperan por reloj; usá `esperarHasta` de `app/tests/esperar.ts` o `mock.timers`; una espera legítima lleva `// espera-justificada: <motivo>`.
- **Probar la interfaz solo (workers de frontend/diseño): `pantalla`** (`motor/bin/pantalla`, port directo en `app/electron/cli/pantalla.ts`;
  Linux y Windows, el .cmd lo arma `windows/src/payload-nativo.js`). Abre una Trama PROPIA offscreen con datos de ejemplo, en un HOME y un
  perfil temporales: no toca el escritorio, el puntero ni los datos del dueño. Todo va por Electron (`capturePage` y DevTools), sin dependencias.
  Necesita el build (`npm run build` en `app/`, o al menos `npx vite build` y `npx tsc -p tsconfig.electron.json`). Uso:
  `pantalla abrir [estado] [VAR=valor …] [--tam "1280 800"]` (estados de `Captura` en `src/modo.ts`, default `normal`; ej.
  `pantalla abrir lider-nuevo HILOS_TEMA=claro`) · `pantalla captura -o /tmp/x.png` y mirar el PNG con Read · `pantalla clic <x> <y>` (píxeles de la
  captura) o `clic --sel "<css>"` (el centro del elemento; `--derecho`, `--doble`) · `pantalla escribir "texto"` (en lo que tenga el foco: clic
  antes) · `pantalla tecla Enter|Tab|Escape|ctrl+a|F5…` · `pantalla rueda <dy> [x y]` · `pantalla donde "<css>"` · `pantalla leer ["<css>"]` (texto
  o `value` de un campo) · `pantalla js "<expresión>"` · `pantalla cerrar`. Hay que cerrarla al terminar (sola se cierra a los 10 min sin
  pedidos). Cada carpeta de trabajo tiene su ventana (`--sesion <nombre>` para tener dos). Sirve para ver y operar la interfaz con
  datos falsos; no prueba nada contra `pa` ni contra el motor. Una captura común (`scripts/captura.sh`) sigue siendo sólo una foto: sin clics.
- **`<id>.pid` de una corrida:** nunca preguntes `kill0`/`vivo` sobre ese número a secas: pasa por `pidDeCorrida` (`app/electron/cli/base/proc.ts`;
  atajos `pidCorridaVivo` y `corridaEnCola` en `cli/pa/corridas.ts`; respaldo bash: `pid_de_corrida` en `motor/bin/pa`). Un pid viejo puede ser el TID de un hilo
  ajeno o un pid reciclado, y `--parar` mataría a otro programa. Es de la corrida si es proceso (Linux: Tgid == Pid), no zombie y arrancó a más tardar 2 s
  después del mtime del `.pid` (el padre lo escribe después de lanzar al hijo). Fin de una corrida: `.listo` / `.entregado` (el `.json` NO: existe desde que arranca).
- **Carpeta del líder nuevo y retirados:** el selector arranca siempre en «Auto» (`lider:nuevo` con `auto: true`; el main infiere con el registry de
  SU máquina, `app/electron/carpeta-auto.ts`, sin modelo); lo elegido a mano manda. Un proyecto `estado: retirado` no se infiere ni se ofrece, y lo
  que corrió ahí se ve en la carpeta de su `reemplazado_por` (`app/electron/reemplazos.ts`; el `proyecto` del hilo no se toca: es el de `pa`).
  El riel ubica a un líder por worker, primer mensaje o lo movido a mano, nunca por su cwd. Detalle en `docs/estado/carpeta-auto-y-retirados.md`.
- **Carpeta de un líder en la barra (`armarArbol`):** `mover` (a mano) > Shark > `fijadas` > primer worker > `inferido` > general. Lo que se decide solo se fija con el líder (`nombres.json.fijadas`, vía `Arbol.decididas`) y no se recalcula; lo elegido a mano no se pierde (`nombres.json.bak`). No hagas depender la carpeta de algo que cambia por sondeo. Detalle en `docs/estado/carpeta-estable.md`; lo controla `tests/carpeta-estable.test.ts`.
- **`<proyecto>.running` de un worker:** mismo criterio que el `.pid`, y sólo por `pidDeRunning` / `pidDeCampoRunning` (`cli/base/proc.ts`; atajo `runningVivo` en
  `cli/pa/corridas.ts`; respaldo bash: `vivo` en `motor/bin/pa`). Nunca `kill0`/`vivo` sobre el `pid=` o `pa_pid=` a secas: un `.running` huérfano (pa o Trama
  muertos a lo bruto, en Windows `taskkill /F` no corre el trap) lleva un número que otro programa recicló. Sin proceso real la fila dice `murio`, `pa --parar` cierra el
  rastro (anota `fin=`, borra el `.running`) y `--matar` nunca señala un pid no validado. El límite de sesión (76) NO deja zombis: `pa` sale limpio (el trap borra el
  `.running`, deja `.listo` y `fin`), escribe `limite-<cuenta>` y nada reanuda solo cuando vuelve la cuota; sólo `-m a,b,c` pasa al siguiente modelo en esa misma corrida.
- **Cola de mensajes del líder (`app/electron/cola.ts`, se ve en `app/src/hilo/Bandeja.tsx`):** lo encolado con el líder trabajando sale TODO JUNTO en un solo
  mensaje (`juntar`), nunca uno por turno. Por defecto se entrega a mitad del turno, sin interrumpir, en el próximo límite de
  herramienta (`lider.mandarDirecto`, tras `AGRUPAR_MS`, 8 s, que deja editar antes de que salga y se reinicia con cada cambio); los motores sin ese canal (locales) lo entregan al
  terminar el turno. Ya no hay "Mandar ya" aparte: Ctrl+Enter es un Enter más. El mensaje no está en el chat hasta que entra: vive en la solapa de arriba de la caja, con Editar, Borrar y «Enviar ahora» (corta el paso, siempre preguntando).
  Nunca se pierde: en disco está todo lo que no entró, con su error e imágenes (`camino`, cada imagen en su archivo). Lo ya pasado al stdin no se puede retirar: queda en la solapa como «En camino». Detalle en `motor/docs/traspaso.md`.

- **Reinicio y actividad de los líderes (`app/electron/actividad-lider.ts`):** la `actividad` de un líder de la app es su último turno real, nunca
  que se haya levantado su proceso. `reanudarDormidos` sólo levanta a los dormidos con un turno en las últimas 24 h, o workers vivos, o cola; el resto
  queda sin proceso y su próximo mensaje hace `--resume`. «Limpiar chats» (`src/barra/Limpiar.tsx`, lógica en `limpiar-logica.ts`) archiva los quietos.
  (En este repo no hay `docs/estado/`: lo que ve el usuario de esto está en `src/barra/CONVENCIONES.md`.)
- **Dónde está el motor para `pa`:** `resolverMotor` (`app/electron/cli/pa/entorno.ts`) lo busca en este orden: `TRAMA_MOTOR_DIR`, `<raíz>/motor` (checkout, worktree),
  el payload de Windows (`<raíz>\bin` + `app\hooks`, sin carpeta `motor`), `<raíz>/fuente/motor` (instalación de escritorio de Linux: la app compilada vive en
  `~/.local/share/trama/app`), el checkout anotado en `~/.config/trama/checkout` y el enlace de `~/.local/bin/pa`. Todo lo que `pa` lanza del motor (`reparto`,
  `tablero`, `cuentas`, `repos-empujar`, hooks de latido y guardia) cuelga de `pa.bin`/`pa.hooks`; si falta, `avisarFalta` lo dice por stderr (nunca callado).
  Nada de `path.join(…, "..", "motor")` suelto. Si un worker sale siempre con el modelo por defecto, mirá primero el aviso «pa: no encuentro …».
- **Líder → workers:** se delega con `--tipo` y SIN `-m` ni `--effort` (los elige `reparto`); `-m` sólo con motivo (skill `trama-orquestar`). Si `reparto` falla,
  el resultado del worker lo dice («— reparto NO eligió el modelo», archivo `<id>.reparto-fallo`).

## Mapa rápido

- `app/`: Electron + React 19 + Vite + TS.
  - `app/electron/`: el proceso principal. IPC en `nucleo.ts`, `preload.cts` y `src/puente.ts`.
  - `app/src/`: la interfaz. Barra lateral en `src/barra/`, ajustes en `src/paneles/`, hilos en `src/hilo/`.
  - Tests con `node --test` (`app/scripts/test.mjs`, archivos en `app/tests/`).
  - Capturas sin abrir ventanas: `app/scripts/captura.sh <estado>` (estados en `Captura`, `src/modo.ts`; pide el build).
- `motor/`: `bin/pa` (bash, delega tareas a workers en worktrees), `bin/reparto` (python, elige modelo según calidad y
  cupo), `bin/tablero`, `bin/cuentas`, `bin/trama-estado`, hooks (`motor/hooks/*.mjs`), runner de OpenCode
  (`motor/opencode/`).
- CI: `.github/workflows/ci.yml`, trabajos `linux` y `windows`.
- **Salida en vivo de una tarea de fondo (`app/electron/tarea-salida.ts`, canal `tarea:salida`, se ve al desplegar una tarea en `app/src/hilo/Fondo.tsx`):** lee sólo el
  final (16 KB, 200 líneas) de `<tmp>/claude[-<uid>]/<cwd>/<sid>/tasks/<id>.output` (la ruta sale de "Output is being written to:" del resultado), con la ruta
  resuelta (`realpath.native`) antes de validar: un enlace o un `../` fuera de eso es `null`. El canal también lo llama el celular, así que NUNCA se le agrega lectura de
  rutas libres. La salida de un Agent es un enlace al transcript (fuera del temporal): queda "sin salida todavía" a propósito. Sin polling en reposo: el `setTimeout`
  (2 s) vive sólo mientras la fila está desplegada y la ventana visible. Variantes de captura: `HILOS_VARIANTE=fondo` / `fondo-abierto` en `lider-imagenes`.
