# Cambios

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
