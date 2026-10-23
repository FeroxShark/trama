// En qué modo abrió la app. El main lo pasa en la query (`?guion=barra`), así
// se sabe de forma síncrona antes del primer render: nada de parpadeos.

const q = new URLSearchParams(location.search);

const CAPTURAS = [
  "normal",
  "hover",
  // La cabecera con el uso del plan en sus tres casos: todo, el 5 h sin hora de reinicio y ningún límite sabido,
  // con los dos tips abiertos (docs/estado/limites.md; el panel de consumo no tiene captura fija, lo mira scripts/prueba-consumo.mjs).
  "uso",
  "uso-sin-hora",
  "uso-sin-dato",
  "colapsado",
  "cerrados",
  "modelo",
  "esfuerzo",
  "trabajando",
  "oculta",
  "vacio",
  // La vista de hilo y los líderes (docs/estado/B3/, B7/).
  "buscar",
  "lider",
  "lider-terminal",
  // Un líder que mataron, con Retomar (`HILOS_VARIANTE=no`: no se pudo) (docs/estado/retomar-lider/).
  "lider-muerto",
  // Lo mismo con un líder de Trama al que mataron su `claude` (era de la app, no de una terminal): Murió + Retomar, sin caja.
  "lider-app-muerto",
  "lider-nuevo",
  // Un modelo local elegido: sus niveles de esfuerzo (`local-esfuerzo`) y el detalle del contexto con la cuenta de la VRAM (`local-ctx`; `HILOS_VARIANTE=error` deja a Probar con el motivo; `HILOS_VARIANTE=vram` lo deja sin lugar, con ComfyUI y Handy por liberar) (docs/estado/locales.md).
  "local-esfuerzo",
  "local-ctx",
  // El indicador y los avisos del chat de un líder, y la confirmación de su Settle (docs/estado/B12/).
  "lider-trabajando",
  "lider-avisos",
  "lider-plan",
  "lider-permiso",
  "lider-preguntas",
  // Dos tandas de cuatro preguntas largas a la vez: una sola a la vista, "1 de 2", el cuerpo scrollea y Enviar queda fijo.
  "lider-preguntas-dos",
  "lider-comandos",
  // Dictar: el botón del micrófono en la caja; `HILOS_VARIANTE=grabando` (contador), `transcribiendo`, `error` (Reintentar y Descartar) e `inseguro` (apagado, por http) (docs/estado/dictado.md).
  "lider-dictado",
  "settle-confirmar",
  // El árbol líder → workers con los pliegues abiertos (docs/estado/B6/).
  "arbol",
  "aviso",
  // Los paneles del pie (docs/estado/B5/).
  "ajustes",
  "ramas",
  "ramas-confirmar",
  "ramas-analista",
  // Una rama que chocó con main (80): su fila ofrece Actualizar; el paso previo de lanzarlo (modelo, esfuerzo, texto), y con el error de pa.
  "ramas-conflicto",
  "ramas-lanzar",
  "ramas-lanzar-error",
  "estadisticas",
  "estadisticas-30",
  // Estadísticas con el peso de arrancar ya medido ("Medir exacto"), en lugar del estimado (docs/estado/estadisticas-peso.md).
  "estadisticas-medido",
  // El aviso de Claude Code nuevo en el pie, cerrado y abierto (docs/estado/B11/).
  "claude",
  "claude-abierto",
  "claude-actualizado",
  // Lo terminado escondido: la barra en "sólo líderes" y un líder con su "N terminados" desplegado (docs/estado/B15/).
  "solo-lideres",
  "ocultos",
  // La vista de todo con un líder de terminal de tres vivos y ocho terminados: la línea "N terminados" plegada (docs/estado/vista-todo.md).
  "terminados",
  // El anillo de contexto de la caja del líder: 30, 75 y 95 %, y su detalle abierto (docs/estado/B16/).
  "contexto-30",
  "contexto-75",
  "contexto-95",
  "contexto-abierto",
  // Lo de sistema en la conversación, en un líder y en un worker (docs/estado/B18/).
  "lider-sistema",
  "sistema",
  // Lo que hizo el modelo, herramienta por herramienta (Bash y Edit abiertos), compactar y el relevo del líder (docs/estado/B19/).
  "herramientas",
  // La conversación de un worker con el final de lo que devolvió cada herramienta, plegado bajo su línea (docs/estado/chat-listas.md).
  "herramientas-resultados",
  "lider-compactando",
  // Un worker y un líder de terminal compactando: la fila y el chat (`HILOS_VARIANTE=lider`: la vista del líder) (docs/estado/chat-vivo/).
  "compactando",
  "lider-relevo",
  // El segundo nivel del menú de "/" (/output-style con sus valores) (docs/estado/B23/).
  "lider-valores",
  // Imágenes en el globo y en la caja (docs/estado/B26/).
  "lider-imagenes",
  // Tablas del markdown en la respuesta de un líder (docs/estado/tablas/).
  "lider-tabla",
  // Cada forma del texto de un mensaje, y lo que no tiene espacios (`HILOS_VARIANTE=pegado`) (docs/estado/formato/).
  "lider-formato",
  // Tablas y bloques de código adentro de listas numeradas y con viñetas, anidadas (docs/estado/chat-listas.md).
  "lider-listas",
  // El botón del hover en las filas de los líderes: Archivar (quieto) y Cerrar líder (respondiendo).
  "lider-hover",
  // El razonamiento del líder en el chat: plegado en cada turno ("Pensó"); `HILOS_VARIANTE=abierto` abre uno y `=vivo` lo deja llegando, con "Pensando…" abierto (docs/estado/pensando.md).
  "lider-pensando",
  // Te espera: un líder de terminal que terminó y el de la app (abierto) que pide un permiso; fila y cabecera con la marca en ámbar (docs/estado/te-espera.md).
  "te-espera",
  // El tablero de pendientes: el kanban, el detalle de una tarjeta y la vista Proyectos (docs/estado/tablero/).
  "tablero",
  "tablero-detalle",
  "tablero-proyectos",
  // Iniciar tareas del tablero: la confirmación con tres marcadas de dos proyectos (docs/estado/tablero-iniciar/).
  "tablero-iniciar",
  // Los items pospuestos con su lista abierta y "Traer de vuelta" (docs/estado/tablero-etapa5/).
  "tablero-pospuestos",
  // El tablero junto de las máquinas: items de la otra con su nombre al lado del número y el aviso de una máquina sin conexión (docs/estado/tablero-maquinas/).
  "tablero-maquinas",
  // El cartel "Hay una actualización disponible" arriba del pie, esperando a un líder y a su worker, y con eso sin eventos hace 20 min: "Reiniciar igual" (docs/estado/actualizacion/).
  "actualizacion",
  "actualizacion-espera",
  "actualizacion-colgado",
  // "PC apagada · Prender" en la trama del Dell: apagada, "Prendiendo…" y prendida con Abrir (docs/estado/maquinas.md).
  "pc-apagada",
  "pc-prendiendo",
  "pc-prendida",
  // El cartel "Reconectando con la PC…" (sólo se ve por la tailnet; docs/estado/visual/).
  "conexion",
  // El cartel de un error al pintar, en vez de la ventana en blanco (src/ErrorBoundary.ts; docs/estado/contencion.md).
  "error",
  // Nada miente mientras carga: un worker recién lanzado ("Arrancando…"), la conversación mientras se lee
  // (`HILOS_VARIANTE=lider`: la de un líder) y uno frenado a propósito, sin rojo (`HILOS_VARIANTE=lideres`: el resumen de su líder) (docs/estado/carga-honesta/).
  "arrancando",
  "leyendo",
  // Un worker en cola (con su tarea, bajo su líder, "En cola · motivo", sin spinner) y otro que murió sin arrancar (docs/estado/worker-en-cola.md).
  "worker-en-cola",
  "frenado",
  // El tablero nuevo (Te esperan), con pendientes de fixture: la lista de proyectos, uno abierto con respuestas y el chat del líder con el mensaje armado
  // (`HILOS_VARIANTE=parados` despliega los parados, `abajo` baja hasta las pruebas, `mandadas` baja y despliega Mandadas, `todo` abre la pestaña Todo) (docs/estado/tablero-nuevo/).
  "tablero-nuevo",
  "tablero-nuevo-proyecto",
  "tablero-nuevo-chat",
  // "Responder y avisar" en las preguntas de atlas ya contestadas: a un líder (su terminal), a elegir entre dos (el que originó la pregunta y el de la carpeta)
  // (`HILOS_VARIANTE=elegir` abre el selector, `sin` abre baliza, sin ningún líder: ni botón) (docs/estado/tablero-avisar/).
  "tablero-nuevo-avisar",
  // El teclado: el anillo de foco en una fila de la barra y en un control de la caja del líder, y la lista de atajos (`?`) (docs/estado/teclado.md).
  "foco-barra",
  "foco-caja",
  "atajos",
  // Cerrar del todo (Ctrl+Q, la bandeja): la pregunta con sus dos salidas y, con líderes respondiendo, la confirmación (docs/estado/bandeja.md).
  "salir",
  "salir-ocupados",
  // El panel de consumo a la derecha de un líder abierto; a 800 px (ancho intermedio) ocupa el lugar de la conversación (docs/estado/consumo.md).
  "consumo",
  // El orden de la barra: a mitad de un arrastre (lo que se lleva apagado, la línea donde cae) y el menú de una carpeta con Subir / Bajar / Orden por defecto (docs/estado/orden-barra.md).
  "orden-arrastrando",
  "orden-menu",
  // El orden por prioridad, el de fábrica (`Orden.prioridad`): te necesita, caché vivo y el resto por actividad (docs/estado/orden-prioridad.md).
  "orden-prioridad",
  // "Mover a proyecto…" de un líder, con la lista larga: el buscador, Automático aparte, el marcado y el dónde está ahora.
  "mover-menu",
  // Trama en dos máquinas (docs/estado/maquinas.md): con el Dell conectado, la barra con su líder y sus workers y el ícono de máquina en cada líder;
  // abierto el líder del Dell (el ícono y el nombre en la cabecera); con el Dell sin conexión (sus filas no están y la barra lo dice); y con
  // el Dell en otra versión ("sólo lectura"). Con una sola máquina nada de esto aparece: las demás capturas no cambian.
  "maquinas",
  "maquinas-lider",
  "maquinas-caida",
  "maquinas-version",
  // La caja de un líder nuevo con el selector de máquina abierto: con el Dell conectado, y con el Dell sin conexión (se ve, dice por qué y no se elige).
  "maquinas-selector",
  "maquinas-selector-caida",
  // La caja de un líder nuevo con el campo "Carpeta" abierto y una ruta puesta.
  "lider-nuevo-carpeta",
  // El cartel "Actualizando Trama…" en cada paso: 1 y 2 son de la ventana que se va (con velo, se ve la app detrás), 3 y 4 de la que llega.
  "actualizando-1",
  "actualizando-2",
  "actualizando-3",
  "actualizando-4",
  // La vista de un worker con pasos (src/hilo/Worker.tsx): uno que terminó y uno que sigue corriendo `npm test` (docs/estado/worker-vista.md).
  "worker-vista",
  "worker-vista-vivo",
] as const;

export type Captura = (typeof CAPTURAS)[number];

const captura = q.get("captura");
const guion = q.get("guion");

export const MODO = {
  /**
   * `b0`: la pantalla de prueba de B0. `barra`: la barra corriendo su guion de
   * medición. `paneles`: lo mismo con los paneles del pie (src/paneles/guion.ts).
   */
  guion: guion === "b0" || guion === "barra" || guion === "paneles" ? guion : null,
  /** Estado forzado para las capturas de `docs/estado/` (sin mouse ni teclado). */
  captura: (CAPTURAS as readonly string[]).includes(captura ?? "") ? (captura as Captura) : null,
  /** El reloj quieto de las capturas comparadas (`?ahora=`, src/reloj-fijo.ts): sin fase en lo que late. */
  quieto: q.has("ahora"),
  falla: q.get("falla"),
  /** El renderer murió varias veces seguidas y el main dejó sólo el cartel: el detalle de la muerte (electron/main.ts). */
  cartel: q.get("cartel"),
  /**
   * Una variante de la captura (`HILOS_VARIANTE`): `modelo` abre el selector de
   * modelo de Ajustes (`fuente` y `mono`, los de las fuentes); `asistente` llena Nuevo líder
   * con el prompt del asistente de Ramas; `sin-uso`, los límites sin dato; `error` (con `ajustes` o
   * `estadisticas`), el panel que no cargó con su Reintentar (`error-historial`: sólo el registro histórico,
   * que queda debajo de lo que se ve sin scrollear: lo mira scripts/prueba-paneles.mjs).
   * Con `ajustes`: `celular` deja a la vista el acceso desde el celular; `editando` lo que se cambió sin guardar
   * (plan, red de seguridad y un dispositivo nuevo, con Guardar y Cancelar a mano) y `editando-mal` lo que no vale
   * (red de 50 tokens, puerto 80, una dirección en vez de un dispositivo), con su motivo en línea.
   * Modelos y proveedores (`AjustesModelos.tsx`): `mdl` deja a la vista la sección con un archivo de muestra, `mdl-agregar` con el
   * panel de agregar un modelo local abierto, `mdl-lider` con el selector del líder abierto y `sinmdl` sin archivo (lo de hoy).
   */
  variante: q.get("variante"),
  /** Fixtures de Estadísticas con pocos datos: lo que se ve los primeros días (`HILOS_POCOS=1`). */
  pocos: q.has("pocos"),
  /** Capturas y mediciones no recuerdan nada entre corridas (ni ancho, ni colapsados, ni leídos). */
  datosFijos: captura !== null || guion !== null,
  /**
   * Datos falsos en vez de `pa`. Lo decide el main (`HILOS_FIXTURES`; sin ella,
   * fixtures en bench y captura). Sin main (Vite en un navegador), fixtures.
   */
  fixtures: q.has("fixtures") ? q.get("fixtures") !== "0" : true,
  /** La vista de la barra al abrir (preferencias.json): todo o sólo líderes. */
  vista: q.get("vista") === "lideres" ? ("lideres" as const) : ("todo" as const),
  /** El panel de consumo (a la derecha) a la vista al abrir (preferencias.json); sin nada guardado, oculto. */
  consumo: q.get("consumo") === "1" || captura === "consumo",
  /** Cómo se llama esta máquina (lo pasa el main con datos reales): va en la ficha de cada worker. */
  maquina: q.get("maquina"),
  /** La ventana es cliente del motor (electron/ventana-cliente.ts): lo que se cae es el motor, no la PC. */
  cliente: q.get("cliente") === "1",
  /** Esta ventana nace de un reinicio por un build nuevo: el cartel "Actualizando Trama…" desde el primer cuadro (src/actualizando.ts). */
  actualizando: q.get("actualizando") === "1",
  /** El usuario del sistema (lo pasa el main con datos reales): el nombre de la carpeta del home. */
  usuario: q.get("usuario"),
};
