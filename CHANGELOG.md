# Cambios

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
