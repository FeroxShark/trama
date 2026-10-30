# Cambios

## 0.2.32

- Panel de contexto: MCP y skills medidos por lo que de verdad está cargado (los MCP diferidos casi no cuentan), y el total cuadra con sus ítems y no cambia al refrescar.
- Panel de contexto: «Sistema» partido en piezas (prompt base, cada CLAUDE.md, memoria, hooks de inicio, skills) con sus tokens y su texto.
- Catálogo de skills: cuenta los usos de todas las sesiones, incluidas las que carga un hook (por ejemplo caveman).
- Panel de contexto: lo apagado se ve gris y no suma; botón Compactar (y clic derecho) en Mensajes.
- Título corto del líder: ya no puede quedar texto de una herramienta como `<invoke_tool …>`; los títulos así se corrigen solos.
- Windows: actualizar ya no falla si un `node.exe` de Trama está en uso, el node de Trama va al final del PATH de los procesos hijos y la copia para volver atrás guarda bien `app.asar`.

## 0.2.31

- Avisos de workers al líder: ya no se pierden si el líder o Trama se reinician mientras el worker corre. Quedan en una cola persistente y cuentan como entregados sólo cuando llegaron; al retomar un líder le llega un resumen de sus workers que terminaron mientras no estaba.

## 0.2.30

- Panel derecho de contexto nuevo: sólo el líder que mirás y sus workers, con barra apilada, mapa de bloques y lista por categoría (mensajes, herramientas, MCP, skills, memoria, sistema). Cada skill, conector, herramienta o archivo de memoria muestra sus tokens, cuántas veces se usó ("nunca usada") y un interruptor para apagarlo en todo Trama.
- Catálogo de skills con buscador y filtros (apagadas, nunca usadas, por plugin).
- Aviso de conversación inactiva: muestra sólo los tokens, sin el % de cupo estimado (no era fiable).

## 0.2.29

- Ajustes: la tabla "Precios de API" sale sólo en Ajustes > Modelos (aparecía arriba de todas las pestañas).

## 0.2.28

- Windows: ya no se abren ventanas de CMD sueltas (líderes, agy, MCP y chequeos corren con la consola oculta).
- Líder de agy (Gemini/Flash): sus workers ya no mueren al terminar el turno; en Windows salen afuera del job.
- Cupo de agy en la cabecera: se lee cada 10 min (antes 3 min, y cada lectura levantaba todos los MCP).
- Retomar un líder de Claude usa la cuenta principal elegida.
- Caché vencida: al retomar una conversación larga, Trama pregunta si seguir la misma sesión o empezar con un resumen, con el gasto estimado; se puede recordar la elección (Ajustes).
- Relevo más compacto: menos tokens al pasar a un líder nuevo.
- Títulos cortos: los chats se titulan con ≤6 palabras del tema (no el primer mensaje entero) y los workers por el Objetivo del brief; un título puesto a mano no se toca.
- Actividad: cada archivo que el agente, un worker o un subagente lee, escribe o edita se abre en el visor (imagen con miniatura, PDF, texto, markdown, audio, video; si no, con la app del sistema).
- Avisos de workers: el texto ya no queda aplastado; título en dos líneas, motivo debajo y el botón de relanzar en su fila.
- agy: el conteo de tokens de entrada ya no da negativo.

## 0.2.27

- Actualizar seguro: Trama guarda la versión anterior; si la nueva no abre o se cierra sola dos veces, vuelve sola y avisa. Botón "Volver a la versión anterior" en Ajustes > General.
- Nuevo líder arranca en el proyecto seleccionado o el último usado (no en la carpeta personal), con el selector de proyecto a la vista.
- Las conversaciones de workers se agrupan bajo su proyecto en vez de aparecer como proyectos sueltos.
- Cambiar de cuenta en una conversación: el aviso de Claude sale traducido, en una línea, con "Volver a <cuenta>"; y se avisa antes de cambiar.
- Workers: comparten node_modules sólo si el lockfile es el mismo; si no, instalan el suyo.
- `npm run check:changed`: chequeo rápido de sólo lo que cambió.

## 0.2.26

- Avisos de Trama (worker terminó/falló) se ven como fila de sistema, no como mensaje tuyo; el id abre el hilo del worker.
- Panel de Conectores (/mcp) rediseñado: agrupado, con ícono y estado en palabra; los apagados en el proyecto se prenden con un interruptor y los que piden sesión llevan a claude.ai.
- Barra de cupos: "2 d 17 h" en vez de "2 d", y la fecha y hora exactas del reinicio al pasar el mouse.
- Estadísticas: costo equivalente en dólares por modelo (precios editables en Ajustes > Modelos) y tiempo en cola de los workers.
- Limpieza de worktrees y ramas viejas ya integradas (Ajustes > Proyectos, con lista y confirmación; automática apagada).
- pa: cada worker deja una línea FRENÓ y `pa --rinde` junta las más frecuentes; se recompila solo si su código cambió.
- Windows: la carcasa quedó como adaptador fino y sin rastros de WSL.

## 0.2.25

- Limpieza de worktrees y ramas viejos de pa: `pa --limpiar [--ver|--si] [--dias N] [--json]` quita los puestos libres y sin cambios, las ramas de corridas que ya entraron a main y el build sin usar, con N días de antigüedad (7 por defecto); nunca una rama con trabajo sin integrar ni algo en curso. En Ajustes > Proyectos: lista de lo que se borraría, confirmación y una pasada automática que viene apagada.
- Gemini (agy): los modelos dependen de la cuenta, la región y la versión de agy. `reparto` elige sólo entre los que ese agy ofrece (los que no conoce entran con calidad estimada y marcada `~`), el selector de modelos los muestra, y si agy rechaza un modelo `pa` lo marca como no disponible y relanza con el siguiente candidato en vez de cortar.
- Barra: proyectos y líderes ordenados por lo último que se usó, con control "Recientes | A-Z" que se recuerda.
- Workers con modelos locales (dsh): compactan antes de llenar el contexto, que sale del `-c` real del modelo.
- Tests: ya no crean líderes en el estado real ni dependen de la memoria libre o de la máquina.

## 0.2.24

- Windows: pasar un líder a Claude por Google ya no da "spawn ENAMETOOLONG" (el mensaje va por stdin).
- Windows: el plugin pa-worker de agy se instala solo; si un modelo no se puede usar, pa pasa al siguiente con cupo en vez de cortar.
- Subagentes de Claude Code: muestran modelo y esfuerzo, con de dónde salen.
- Subagentes: "Ver informe completo" muestra su texto.

## 0.2.23

- Proyectos: toda carpeta donde trabaja un líder se anota sola en Ajustes > Proyectos (también las de líderes que ya existían).
- Barra de cupos: con varias cuentas de un proveedor, cada una muestra "En uso" o un botón "Usar primero".
- Ajustes: la barra de Guardar aparece sólo cuando hay cambios.
- Selector de modelo y esfuerzo unidos: el panel deja elegir también el esfuerzo.

## 0.2.22

- Windows: las cuentas agregadas de Claude comparten conversaciones, plugins, skills y ajustes con la principal (como en Linux). Las que ya existían se unen solas, sin borrar nada. Retomar una conversación con otra cuenta ya no da "No conversation found".
- Windows: los agentes usan PowerShell en vez de Git Bash (Ajustes > General > Terminal de los agentes).
- Imágenes que manda el líder (rutas locales o de herramientas) se ven en la conversación; si no existen, lo dice.
- Una sola lista de canales para Linux y Windows.
- Linux: AppImage en cada release.

## 0.2.21

- Cuentas: botón "Usar primero" en cada cuenta y selector de cuenta en el líder. Trama nunca cambia de cuenta sola.
- Ajustes > Celular: prender, agregar o quitar un dispositivo se aplica al instante; el link y el QR aparecen solos.
- Líder y workers: cada texto que escribe el modelo mientras trabaja queda en la conversación, en orden.
- Celular: la barra de copiar, volver y hacer rama ya no tapa el texto; íconos del modo que se ven en todos lados.
- CI de Windows en verde.

## 0.2.20

- NVIDIA NIM: clave, ayuda, modelos y cupo en la app; un límite de NVIDIA enfría sólo ese modelo.
- Ajustes > Locales: pantalla completa de modelos locales.
- Pensamiento del líder en vivo mientras trabaja.
- Líder caído: "Este líder se detuvo" con botón Retomar.
- Panel derecho: por cada worker vivo, cuánto lleva, el último paso y un botón para abrirlo.
- Conversaciones de Claude Code en cada proyecto ("De Claude Code"), para retomarlas en Trama.
- Ajustes > Conectores: catálogo de plugins (anthropics/skills, oficiales u otro repo) y plugins sincronizados de claude.ai.
- Windows: conectar una segunda cuenta ya no muestra "main.cuentasFallo".
- Windows: DeepSeek Harness se detecta en `%USERPROFILE%\.local\dsh.cmd`.

## 0.2.19

- Versiones nuevas casi al instante (Linux y Windows): Trama mira cada 2 minutos, al volver a la ventana y al volver la red; el aviso siempre muestra la última.

## 0.2.18

- Ajustes > Conectores: skills, plugins, servidores MCP y hooks en un solo lugar, con de dónde viene cada uno, qué hace, buscador y prender/apagar.
- Mensaje mandado con el líder trabajando: dice "en cola" hasta que el líder lo recibe.
- Editar un mensaje: la caja crece con el texto y se pueden quitar, agregar o pegar capturas.
- Bienvenida: "Conectar otra cuenta" aunque Claude ya esté conectado; estado de los modelos locales.
- Ramas: "Ver el análisis" vuelve a la conversación del líder que analizó la rama.
- Avisos al líder: uno solo al terminar la tanda (o por worker, en Ajustes > General); cupo y cuelgues, al momento.
- Artificial Analysis: actualizar desde la laptop o el celular ya no da error de conexión.

## 0.2.17

- Acceso desde el celular con Trama instalada (Linux y Windows): se prende desde Ajustes, sin tocar el servicio; escucha sólo en Tailscale y sólo entran los dispositivos de la lista.
- Windows: los cupos de Claude (cuenta de siempre y agregadas) se leen bien.
- Ajustes > OpenCode y Modelos: el texto ya no se amontona ni se sale de la pantalla.

## 0.2.16

- Windows nativo: elegir carpeta (agregar proyectos, carpeta del líder), portapapeles, salir y los demás pedidos de la ventana ya andan (antes "canal desconocido").
- Ajustes > Actualizaciones también en Linux; el aviso ya no queda trabado en "Actualizando…" de una instalación vieja.
- Logos de proyectos: Trama usa el ícono del proyecto (favicon, logo, ícono de la app) o la inicial; en Ajustes > Proyectos se puede elegir otro.
- Prueba de humo de Windows (`windows/humo/humo-gonza.ps1`).

## 0.2.15

- Windows nativo: el `pa` de TypeScript tiene todos los modos (conversaciones, archivar, renombrar, proyectos, medición, modelos, workers con todos los motores, relanzar sin cupo). Se acabó el error "todavía no está en el pa de TypeScript".
- Windows nativo: la barra de título vuelve, transparente, y los botones de Windows ya no tapan nada.

## 0.2.14

- Windows nativo: `pa`, `reparto`, `tablero` y `cuentas` se lanzan bien (conversaciones que no se guardaban, Plan y cupos sin datos).
- Windows nativo: sin barra de título; el contenido ocupa toda la ventana y los botones flotan arriba a la derecha.
- Windows nativo: la versión sale de la app (no más 0.1.3), se llama Trama y no Electron, y cada release trae lo que necesita "Buscar actualizaciones".
- Windows nativo: Handy se detecta donde lo instala su instalador; actualizar Antigravity usa `agy update`.

## 0.2.13

- Windows nativo (beta, sin WSL): instalador .exe en esta release. Al instalar trae solas las cuentas de Claude de una Trama anterior (copia sus logins, no toca los originales).
- `pa` en TypeScript conectado de punta a punta (se prueba con `TRAMA_PA=ts`; lo que falta cae al de siempre).
- Tests: un archivo que se pasa del tope de tiempo se corta entero, sin dejar procesos colgados.
- Docs: estado del port a Windows y lista de pruebas para un Windows real.

## 0.2.12

- Avisos de workers: ya no avisan "se cortó sin dejar mensaje" de un worker que sigue corriendo.
- CI en verde (Linux, Windows y armado del .exe nativo); prueba de humo del motor en Windows.
- Windows (en camino): todas las piezas de `pa` portadas a TypeScript (opciones, lanzar, motores, `reparto`); falta conectarlas.

## 0.2.11

- Windows (en camino, todavía no se publica): la app ya sabe abrir la terminal, cortar procesos y lanzar programas en Windows; `pa` en TypeScript avanza (puestos, worktrees, esperar/parar/matar, integrar y lecciones); `tablero` y `cuentas` portados; carcasa nativa y armado del .exe listos para probar en CI.
- CI: los tests que dependían de esta máquina ya no rompen el job de Linux y cada archivo tiene tope de tiempo.

## 0.2.10

- Avisos de workers: cuando uno termina, falla o se cuelga, el líder que lo lanzó se entera solo; notificación de escritorio para fallas y para "terminó la tanda" (configurable en Ajustes > General). Falla por cupo: dice el proveedor, cuándo vuelve y ofrece relanzar con otro modelo.
- Ajustes > Plan y cupos > Avanzado: los umbrales donde pa deja de usar un proveedor son editables, para Claude y Google, con botón para volver al de fábrica.
- Los topes de OpenCode Go se leen de OpenCode (con respaldo sin red, que muestra la fecha).
- Un subagente cortado por una interrupción ya no queda "Running" para siempre.
- `gate --espejo` corre el test oculto; `gate --plan` calcula tamaño, riesgo y archivos calientes desde el plan.

## Sin publicar

- Avisos de workers: cuando uno termina, falla (por cupo, con el proveedor y cuándo vuelve) o se cuelga (15 min sin actividad), el líder que lo lanzó recibe un mensaje corto por la cola y el dueño una notificación (PC y celular) por las fallas y cuando termina toda la tanda; los terminados normales suman un punto en la bandeja. Se prende en Ajustes > General; una falla por cupo ofrece «Relanzar con otro modelo».

## 0.2.9

- Los topes de OpenCode Go (pedidos cada 5 h y USD por mes, Go y Go Plus) se leen de opencode.ai/go al arrancar y cada día, y se guardan con su fecha de lectura; sin conexión se muestra la copia que viene con Trama («Datos del <fecha>»). `reparto` y los workers leen lo mismo.
- `pa --tarea` anota cada corrida en `estado.tsv` (`--subtarea`); `gate` anota su resultado ahí y corre el chequeo con las dependencias del proyecto (antes daba rojo falso).
- `pa --async` con varios modelos (`-m a,b`) relanza solo con el siguiente si se corta OpenCode; `--auditar --decisiones` le pasa al auditor lo decidido a propósito.
- `clasificar` nuevo: dice qué hacer con un intento fallido (rehacer el pedido, reintentar, subir de modelo o preguntarle al dueño).

## 0.2.8

- Actualizar ya no queda trabado en "Actualizando…" si el instalador anterior terminó después de que arrancó el motor nuevo.

## 0.2.7

- El botón "Notas de la versión" del aviso de Trama nueva abre el release en el navegador (antes no hacía nada).

## 0.2.6

- OpenCode 2.x: los workers ya no pueden escribir fuera de su carpeta (cada corrida usa su propio servidor y la config bloquea lo de afuera; en el líder, pregunta).
- OpenCode 2.x: una corrida que termina bien ya no se marca como fallida (2.x no cierra el último paso).
- `pa`: rechaza modelos y esfuerzos apagados en Ajustes; fases, tareas y rúbrica para medir el rendimiento; `gate` para revisar el trabajo de un worker antes de integrarlo.
- Ajustes > Modelos: contexto antes de compactar, por familia (Haiku 300k).

## 0.2.5

- El aviso de Trama nueva aparece a los 30 min como mucho (antes 6 h).
- Ajustes > General: versión de Trama y botón "Buscar actualizaciones".

## 0.2.4

- El líder elige modelo y esfuerzo de cada worker según el pedido. `reparto --resumen` le da al arrancar un resumen corto de cada modelo (nivel por esfuerzo, costo, cupo, para qué sirve); `reparto` sólo avisa si el modelo elegido no tiene cupo.
- Haiku por defecto para lo que se puede describir con precisión, con guía de cómo escribirle el pedido. Sonnet si es ambiguo o Haiku falló; Opus sólo para bases, bug sin pista o tras un fallo.

## 0.2.3

- Actualizar desde la app sin cortar trabajo: con líderes o workers activos ofrece "Actualizar cuando terminen" o "Actualizar ya" (con confirmación). Al terminar avisa "Trama X instalada" con botón para reiniciar la ventana.
- El instalador corrido desde `motor/scripts` de un checkout ya compila la app y anota de dónde actualizar (antes quedaba en la versión vieja diciendo "listo").
- Ajustes > Proyectos: botón "Merge with AI" en el aviso de instrucciones repartidas.
- Reparto: frontend y código de varias partes piden nivel Sonnet, no Argon (sin cupo de Argon caía en Opus).

## 0.2.2

- Mensajes en cola: todo lo encolado le llega al líder junto, en un solo mensaje y entre herramientas, sin interrumpir.
- Barra de cupos: logos siempre visibles, Google con filas de Gemini, Claude/GPT y Argon (5 h y semana), cuánto falta para el reinicio a la vista y tooltip corto. Sin filas "principal" repetidas.
- OpenCode: varias cuentas (cada una aislada), plan Gratis/Go/Go Plus detectado solo y fila propia en la barra.
- Subagentes: los terminados se pliegan y se archivan.
- Chip de modelo: muestra el esfuerzo en todos los motores (palabra y gráfico, max lleno).
- Proyectos: estado de instrucciones legible, "Acortar con un agente" y fusión con un agente.
- Transición corta entre vistas y piezas nuevas de Ajustes.
- Base para detectar modelos locales de llama.cpp, LM Studio y vLLM (la pantalla llega en la próxima).

## 0.2.1

- Aviso de "hay una Trama nueva": Trama mira el último release y ofrece Actualizar desde la app (sin GitHub ni comandos).
- Cambiar el modelo o el esfuerzo mientras el líder trabaja: se aplica al próximo mensaje, y un mensaje en cola sale con lo elegido al mandarse. El selector marca "próx." cuando hay un cambio pendiente.
- Subagentes en la vista grande: tocar su tarjeta abre sus pasos, en vivo o con el informe final.

## 0.2.0

### Modelos y motores
- OpenCode y DeepSeek Harness como motores de líderes y workers, con modelos gratis (OpenCode) y Ollama.
- Seguir una conversación con otro motor (Claude, Gemini, OpenCode, DeepSeek Harness): se pasa el historial y queda una raya "Siguió con…". Pide confirmación antes de cambiar.
- OpenCode Go (plan pago de OpenCode, apagado por defecto): en Ajustes > OpenCode se elige Gratis / Go / Go Plus. Con Go, sus modelos se ofrecen a líderes y workers como «Plan Go», con cupo propio por modelo (un 429 agota sólo ese modelo, unas 5 h) y costo marginal ~0 en el reparto. Los topes por modelo están en `motor/opencode/go-topes.json` y se ven en Plan y cupos. Sin Go, opencode usa un modelo gratis para los títulos de sesión (antes podía intentar uno de pago y dejar un 402).
- Selector de modelos compacto: proveedores a la izquierda, búsqueda en todos, marca "Gratis" / "De pago".
- Inteligencia de los modelos desde Artificial Analysis, actualizada a diario y por esfuerzo (low, medium, high, xhigh, max). `reparto --aa-diag` muestra con qué entrada de AA se emparejó cada modelo.
- El modo de permisos queda fijo y explicado en líderes de Gemini, OpenCode y DeepSeek Harness.
- Volver, Editar y Ramificar en todos los motores (no sólo Claude) y en conversaciones con varios motores.
- El rayito de caché sólo en Claude, con la duración real del pedido (1 h con suscripción, 5 min con API o créditos).

### Reparto de workers y cupos
- Ritmo semanal: si la semana va más rápido que el cupo, los workers pasan a modelos gratis o de Google; si sobra cupo cerca del reinicio, se aprovecha.
- Perfiles Ahorro / Equilibrado / Rendimiento y reserva del semanal de Claude para el líder.
- `pa --plan ausente|gastar-hoy|ahorrar-hoy|ver|borrar`: avisarle a los agentes que mañana no estás o que hoy conviene gastar o ahorrar.
- El mínimo de calidad por tipo se mide al mismo esfuerzo (las tareas de código acotado vuelven a Sonnet, no a Opus).
- Elegir qué modelos pueden usar los workers.

### Orquestación
- Tareas con plantilla (Listo cuando / Cómo verificar), detalle según la inteligencia del modelo, verificación obligatoria ("sin verificar"), lecciones por proyecto con poda, y `pa --auditar` para que otro modelo revise una rama.
- `AGENTS.md` como única fuente de instrucciones para todos los motores: `pa --unificar-md` y "Unificar en AGENTS.md" en Ajustes > Proyectos.

### App
- Barra lateral: sección "Activas" arriba con las sesiones calientes; proyectos con nombre propio (Ajustes > Proyectos); la fila se abre tocando cualquier parte.
- Usos rediseñados por proveedor y grupo, también con la barra angosta.
- Temas de color (Sistema, Oscuro, Claro, Bosque, Atardecer, Grafito, Contraste), probados para contraste y deuteranomalía.
- Ramas: tarjetas con filtros, "Aplicar todos los veredictos", Auditar; "Analizar de nuevo" con cualquier modelo.
- Guías por pantalla para usuarios nuevos y para lo nuevo de cada versión ("no volver a mostrar", "más tarde" o apagarlas en Ajustes > Guía).
- Estadísticas y Tablero rediseñados; Guía en Ajustes; umbral de compactar libre.
- La caja de texto queda en una sola fila a cualquier ancho y sigue al modelo real del líder.

### Instalación
- Un solo comando actualiza el motor y la app de escritorio: `git pull; bash motor/scripts/instalar-producto.sh`.
