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
- **«Limpiar» del Tablero (`app/src/paneles/LimpiarTablero.tsx`, lógica pura en `src/datos/tablero-limpiar.ts`, tanda en `src/datos/tablero-tanda.ts`):** cierra en masa a `tirado`, NUNCA borra.
  Se sugiere y viene marcado lo desactualizado: proyecto `retirado` en el registry, clave `pa:<id>` con la corrida `integrado` (`pa --hilos`) y prueba que nombra una versión
  anterior de Trama; lo demás entra sólo si el usuario lo marca o elige un plazo. El CLI sólo trae `tirar` en lote (`tablero tirar 1 2 3`) y `mover` de a uno, así que se llama por item, de a
  4 (`correrEnLote`, con el candado del CLI más no acelera) y con progreso; usa los canales de siempre (`tablero:tirar` / `tablero:mover`), sin canal nuevo ni cambio en `windows/`.
  Deshacer reabre la última tanda con `mover --columna=<la de antes>` (se guarda en `localStorage`, caduca al día). Mientras corre, la lista del diálogo queda fija: cada cierre
  relee el tablero. Lo cubre `scripts/prueba-tablero.mjs` (tablero temporal) y `tests/tablero-limpiar.test.ts`.
- **Tests:** los tests no esperan por reloj; usá `esperarHasta` de `app/tests/esperar.ts` o `mock.timers`; una espera legítima lleva `// espera-justificada: <motivo>`.
  Bajo carga: un `probarLocal`/`asegurarLocal` sin `await` deja el lock `probando` tomado y la carpeta de la prueba sin borrar (ENOTEMPTY); cada probe se espera o se suelta en el `finally`. Un `setTimeout` de 20-30 ms para «que arranque lo otro» no alcanza: se espera la condición. Las escrituras disparadas con `void` las espera `esperarEscrituras` (`electron/pa.ts`) al cerrar. Altas en vuelo de `nuevo` (`registrarCarpetas`): `esperarRegistros` antes de tocar el registry en un test.
- **Tests y plataforma (el CI corre en Windows):** una ruta real (`os.tmpdir()`, `path.join`) en Windows es `C:\…`: nunca la mezcles con `plat: "linux"` (`path.posix` la toma como un solo segmento) ni le apliques `.replace(/^\//, "")` ni le sumes `"/"`. Para probar la lógica de OTRA plataforma: rutas literales de esa plataforma y disco falso (`existe`/`leer`/`real`, como `tests/motor-resolver.test.ts`); con disco real, sin inyectar la plataforma y con `path.join`/`path.sep`. Tampoco lances escrituras simultáneas al mismo archivo con `writeFile` crudo: se mezclan y el test falla a veces.
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

- **Cuenta de cada chat (Claude):** «Usar en nuevos» (riel y Plan y cupos) sólo vale para los chats nuevos; cada chat guarda su cuenta (`Guardado.cuenta`) y se cambia desde el chat
  (`CuentaLider`, `lider:cuenta`). Con la cuenta del chat en el tope (≥ 80 %), `OfertaCuenta` (`ofertaDeCambio` en `barra/cupos-riel-logica.ts`) ofrece pasar a otra con lugar: sólo
  ofrece, nunca cambia sola. Toda cuenta muestra 5 h y semana juntas, y «sin dato» si falta una (`carrilesCompletos`, `Mini` del riel): nunca el renglón vacío. Lo controla `tests/oferta-cuenta.test.ts`.

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
- **Limpieza de ramas y worktrees:** vive en `app/src/paneles/AjustesLimpieza.tsx` (`LimpiezaPa`) y se ve en dos lugares: Ajustes > Proyectos y el panel de Ramas (botón «Limpiar ramas y puestos viejos», captura `ramas-limpieza`). Un solo componente, nunca una copia; tirar siempre pasa por «Ver qué se borraría» y luego «Borrar lo de la lista». Lo controla `tests/ramas-limpieza-acceso.test.ts`. Los textos de Conectores llaman «conector» a lo que técnicamente es un servidor MCP (no «servidor propio»: suena a otra máquina).

- **Perfil de reparto `agresivo` (`PERFILES` en `motor/bin/reparto` y su par `app/electron/cli/reparto.ts`; el TS es el que corre por defecto, `TRAMA_REPARTO=py` fuerza el python):** gana el más barato (`costo` relativo: gratis 0, el resto el de su familia) entre lo que supera `minimo_por_tipo`,
  que sigue siendo piso duro (no se relaja como en `ahorro`); el puntaje sólo desempata. Reserva del líder 0,35 como `ahorro`. Un modelo que no gasta cupo (local, dsh/OpenCode) sin historial propio sólo entra en `lectura`/`mecanico` hasta tener
  5 corridas con dato y ≥ 50 % sin retrabajo en ESE tipo (medicion.tsv de los últimos 60 días, el mismo criterio de `pa --rinde`; `REPARTO_MEDICION` lo redirige en los tests); si no queda nada más, vuelve a entrar y el motivo lo dice. Flash
  sólo lee. `rendimiento` y `equilibrado` dan lo mismo con ritmo normal: la banda de calidad (`PESO_SOBRA`, `PREFERIDO_POR_TIPO`) ya decide. `reparto --tipo --json` suma `perfil_info` y, por candidato, `costo` e `historial` (`{n, ok_pct}`) para la interfaz.
  Con `ahorro` o `agresivo`, `pa` avisa por stderr al lanzar (`avisoPerfilAhorro` en `cli/pa/cli.ts`, `aviso_perfil_ahorro` en el bash) que el brief lleve pasos, archivos, «Listo cuando» y chequeo. Lo cubre `tests/reparto-agresivo.test.ts`.

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
- **Títulos de los chats (líderes) estables (`app/electron/titulo-estable.ts`, instancia en `titulo-fijo.ts`, `titulos-fijos.json`):** un título ya mostrado no se
  recalcula en un arranque, reinicio del motor ni relectura del transcript. Lo puesto a mano en Claude Code (`/rename`, `name` de la sesión) manda y no se
  pierde si deja de verse; el recorte del primer mensaje (provisorio) sólo lo reemplaza el primer título bueno (`ai-title` o generado), y ése queda. El rename desde
  Trama vive en `nombres.json` (`titulos`) y gana en la barra. Cualquier reparación de títulos (`corregirBasura`) sólo toca lo automático (`tienePropio`).
  Un título nuevo del líder pasa por `titulosFijos.titulo`, no por `tituloLider` a secas. Lo controla `tests/titulo-estable.test.ts`.
- **Uso de lo conectado (Ajustes > Conectores):** el orden por más usados / menos usados / último uso sale de `historial:consultar` (30 días) pasado por `usosDeHistorial` (`app/electron/usos-historial.ts`, puro, lo comparte con el catálogo de skills). El último día de uso sale de los días ya indexados (`Consulta.ultimo`: sólo nombres y días), sin tocar `PARSER`. Tres estados que no se mezclan: usado, **«sin uso en 30 días»** (0, nunca «nunca») y **«sin dato»** (null: hooks, plugins sin skills ni MCP, sin registro). Lo sin dato va siempre al final. Desde 200 filas un grupo se dibuja por bloques (`BloqueVirtual`). Lo controla `tests/conectores-vista.test.ts`.
- **Tienda de plugins (`electron/plugins-claude.ts`, `src/paneles/AjustesPlugins.tsx`):** `instalaciones`/`actualizado` de cada plugin salen de `~/.claude/plugins/plugin-catalog-cache.json`
  (`catalog.plugins["plugin@catálogo"].unique_installs` / `.last_updated`), una caché interna de Claude Code: sólo se lee, y un archivo o campo que falta o no sirve es
  `null` = «sin dato» (nunca 0 ni error; en el orden va siempre al final). La categoría es la del `marketplace.json`; sin ella, «Sin categoría». Filtro y orden son puros
  (`conectores-vista.ts`: `ordenarPlugins`, `filtrarCategoria`, `categoriasDe`). Los tests arman un catálogo falso en un tmp (`tests/plugins-tienda.test.ts`) y nunca llaman a `claude`.
- **«Te dejé esto en el tablero» (`app/src/hilo/tablero-dejado.ts`, `DejadoTablero.tsx`):** el chat de un líder muestra una tarjeta discreta (sin toast ni sonido, sin mover el scroll) cuando
  él o un worker suyo dejó algo para la persona. Líder: una llamada a Bash con `tablero agregar` (`--tipo pregunta|prueba`, `--prueba` o `--columna espera-dueno`) que DEVOLVIÓ el id
  (el CLI imprime sólo el id: sin id, con error o sólo nombrando el comando no cuenta; se arma en `turnos()` → `dejados`). Worker: el aviso de Trama al líder (enrutado por `jefe_id`)
  trae el id del worker, y sus items son los de clave `pa:<id>`, `pa:<id>:<n>`, `pa:<id>:p1`. El estado (te espera / ya respondiste / ya se cerró) sale del tablero leído, una lectura
  compartida (`tablero-dejado-fuente.ts`). Abrir = `pedirItem` (`paneles/tablero-abrir.ts`): la barra abre el panel y `TableroNuevo` muestra el item. Captura `lider-tablero-dejado`
  (`HILOS_VARIANTE=respondida|cerrada|muchas`); lo controla `tests/tablero-dejado.test.ts`. Límite: un `pa --seguir` anota con el id de la corrida original, que puede no ser el del aviso.
- **Descubrir skills y conectores MCP (Ajustes > Conectores, `app/electron/descubrir.ts`, UI `src/paneles/AjustesDescubrir.tsx`, lógica pura `descubrir-vista.ts`; canales `descubrir:catalogo|previa|instalar`):** el main baja como DATOS el registro MCP oficial (`registry.modelcontextprotocol.io/v0/servers`, paginado) y el árbol de `anthropics/skills` (sin `docx`, `pdf`, `pptx`, `xlsx`: no son open source; su README dice «for demonstration and educational purposes only» y se muestra), con tope de bytes y de tiempo, y lo cachea en `$HILOS_STATE/descubrir.json`; sólo al abrir sin copia de hoy o con «Actualizar», nunca por sondeo. Cada fuente falla por separado y conserva lo viejo. La interfaz manda sólo un `id`: lo que se instala sale de lo guardado, nunca de lo que diga el renderer. Skill: copia a `~/.claude/skills/<nombre>` (nombre y cada ruta validados, sin pisar una existente, cada archivo verificado contra el sha de blob de GitHub, temporal + `rename`; la confirmación lista archivos y avisa de scripts, y la huella de la previa evita instalar algo distinto de lo que se vio). MCP remoto: sólo `https`, entra por `guardarServidor` (los mismos conectores propios); el de paquete NUNCA se ejecuta: se muestra su comando y enlace. No usar Smithery ni awesome-claude-code (licencia). Las fechas que faltan son «sin dato» (las skills no traen fecha). Los tests (`tests/descubrir.test.ts`) usan un servidor HTTP falso en 127.0.0.1 y un HOME temporal. Capturas: `HILOS_VARIANTE=descubrir|descubrir-vacio|descubrir-falla`.
