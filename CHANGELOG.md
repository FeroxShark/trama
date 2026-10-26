# Cambios

## 0.2.0

### Modelos y motores
- OpenCode y DeepSeek Harness como motores de líderes y workers, con modelos gratis (OpenCode) y Ollama.
- Seguir una conversación con otro motor (Claude, Gemini, OpenCode, DeepSeek Harness): se pasa el historial y queda una raya "Siguió con…". Pide confirmación antes de cambiar.
- Selector de modelos compacto: proveedores a la izquierda, búsqueda en todos, marca "Gratis" / "De pago".
- Inteligencia de los modelos desde Artificial Analysis, actualizada a diario y por esfuerzo (low, medium, high, xhigh, max). `reparto --aa-diag` muestra con qué entrada de AA se emparejó cada modelo.
- El modo de permisos queda fijo y explicado en líderes de Gemini, OpenCode y DeepSeek Harness.

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
- Estadísticas y Tablero rediseñados; Guía en Ajustes; umbral de compactar libre.
- La caja de texto queda en una sola fila a cualquier ancho y sigue al modelo real del líder.

### Instalación
- Un solo comando actualiza el motor y la app de escritorio: `git pull; bash motor/scripts/instalar-producto.sh`.
