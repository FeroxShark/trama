// En qué modo abrió la app. El main lo pasa en la query (`?guion=barra`), así
// se sabe de forma síncrona antes del primer render: nada de parpadeos.

const q = new URLSearchParams(location.search);

const CAPTURAS = [
  "normal",
  "hover",
  // La cabecera con el uso del plan en sus tres casos: todo, el 5 h sin hora de reinicio y ningún límite sabido,
  // con los dos tips abiertos (el panel de consumo no tiene captura fija, lo mira scripts/prueba-consumo.mjs).
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
  // La vista de hilo y los líderes.
  "buscar",
  "lider",
  "lider-terminal",
  // Un líder que mataron, con Retomar (`HILOS_VARIANTE=no`: no se pudo).
  "lider-muerto",
  // Lo mismo con un líder de Trama al que mataron su `claude` (era de la app, no de una terminal): Murió + Retomar, sin caja.
  "lider-app-muerto",
  "lider-nuevo",
  // Un modelo local elegido: sus niveles de esfuerzo (`local-esfuerzo`) y el detalle del contexto con la cuenta de la VRAM (`local-ctx`; `HILOS_VARIANTE=error` deja a Probar con el motivo; `HILOS_VARIANTE=vram` lo deja sin lugar, con ComfyUI y Handy por liberar).
  "local-esfuerzo",
  "local-ctx",
  // El indicador y los avisos del chat de un líder, y la confirmación de su Settle.
  "lider-trabajando",
  "lider-avisos",
  "lider-plan",
  "lider-permiso",
  "lider-preguntas",
  // Dos tandas de cuatro preguntas largas a la vez: una sola a la vista, "1 de 2", el cuerpo scrollea y Enviar queda fijo.
  "lider-preguntas-dos",
  // El menú de "/" abierto; `HILOS_VARIANTE=agy`: el de un líder de agy (marcas "Anthropic only" / "Google only").
  "lider-comandos",
  // Dictar: el botón del micrófono en la caja; `HILOS_VARIANTE=grabando` (contador), `transcribiendo`, `error` (Reintentar y Descartar) e `inseguro` (apagado, por http).
  "lider-dictado",
  "settle-confirmar",
  // El árbol líder → workers con los pliegues abiertos.
  "arbol",
  "aviso",
  // Los paneles del pie.
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
  // Estadísticas con el peso de arrancar ya medido ("Medir exacto"), en lugar del estimado.
  "estadisticas-medido",
  // Estadísticas sin ninguna corrida todavía (no hay medicion.tsv): el estado vacío, sin error ni botón.
  "estadisticas-vacia",
  // El aviso de Claude Code nuevo en el pie, cerrado y abierto.
  "claude",
  "claude-abierto",
  "claude-actualizado",
  // El aviso de "hay una Trama nueva" (release de GitHub) en el pie: cerrado, abierto y con cambios sin commitear en el checkout.
  "trama",
  "trama-abierto",
  "trama-sucio",
  // Lo mismo con trabajo en curso (Actualizar cuando terminen / ya) y con la Trama nueva ya instalada.
  "trama-ocupado",
  "trama-instalada",
  // "Falta configurar" en el pie (Handy y Ollama por instalar), cerrada y abierta.
  "setup",
  "setup-abierto",
  // Lo terminado escondido: la barra en "sólo líderes" y un líder con su "N terminados" desplegado.
  "solo-lideres",
  "ocultos",
  // La vista de todo con un líder de terminal de tres vivos y ocho terminados: la línea "N terminados" plegada.
  "terminados",
  // El anillo de contexto de la caja del líder: 30, 75 y 95 %, y su detalle abierto.
  "contexto-30",
  "contexto-75",
  "contexto-95",
  "contexto-abierto",
  // Lo de sistema en la conversación, en un líder y en un worker.
  "lider-sistema",
  // Seguir la conversación con un modelo de otro motor: la raya en el historial; variante `menu` el selector con todas las columnas, `confirmar` la nota para confirmar.
  "lider-cambio-motor",
  "sistema",
  // Lo que hizo el modelo, herramienta por herramienta (Bash y Edit abiertos), compactar y el relevo del líder.
  "herramientas",
  // La conversación de un worker con el final de lo que devolvió cada herramienta, plegado bajo su línea.
  "herramientas-resultados",
  "lider-compactando",
  // Un líder con subagentes: dos corriendo, uno terminado con su informe y uno que falló.
  "subagentes",
  // Un worker y un líder de terminal compactando: la fila y el chat (`HILOS_VARIANTE=lider`: la vista del líder).
  "compactando",
  "lider-relevo",
  // El segundo nivel del menú de "/" (/output-style con sus valores).
  "lider-valores",
  // Imágenes en el globo y en la caja.
  "lider-imagenes",
  // Un pedido propio abierto para editar: el campo con sus capturas y su archivo.
  "lider-editar",
  // Tablas del markdown en la respuesta de un líder.
  "lider-tabla",
  // Cada forma del texto de un mensaje, y lo que no tiene espacios (`HILOS_VARIANTE=pegado`).
  "lider-formato",
  // Tablas y bloques de código adentro de listas numeradas y con viñetas, anidadas.
  "lider-listas",
  // El botón del hover en las filas de los líderes: Archivar (quieto) y Cerrar líder (respondiendo).
  "lider-hover",
  // El razonamiento del líder en el chat: plegado en cada turno ("Pensó"); `HILOS_VARIANTE=abierto` abre uno y `=vivo` lo deja llegando, con "Pensando…" abierto.
  "lider-pensando",
  // Un líder de Gemini a mitad de un turno: su último paso de razonamiento en la tarjeta y cada comando con su estado.
  "lider-gemini",
  // Te espera: un líder de terminal que terminó y el de la app (abierto) que pide un permiso; fila y cabecera con la marca en ámbar.
  "te-espera",
  // El tablero de pendientes: el kanban, el detalle de una tarjeta y la vista Proyectos.
  "tablero",
  "tablero-detalle",
  "tablero-proyectos",
  // Iniciar tareas del tablero: la confirmación con tres marcadas de dos proyectos.
  "tablero-iniciar",
  // Los items pospuestos con su lista abierta y "Traer de vuelta".
  "tablero-pospuestos",
  // El aviso "Lecciones por podar" del tablero (variante `editor`: el editor de lecciones.md abierto).
  "tablero-lecciones",
  // El tablero junto de las máquinas: items de la otra con su nombre al lado del número y el aviso de una máquina sin conexión.
  "tablero-maquinas",
  // El tablero sin vista todavía (no hay tablero): el cuadro para anotar el primero y lo que es el tablero.
  "tablero-vacio",
  // El cartel "Hay una actualización disponible" arriba del pie, esperando a un líder y a su worker, y con eso sin eventos hace 20 min: "Reiniciar igual".
  "actualizacion",
  "actualizacion-espera",
  "actualizacion-colgado",
  // "PC apagada · Prender" en la trama de la otra máquina: apagada, "Prendiendo…" y prendida con Abrir.
  "pc-apagada",
  "pc-prendiendo",
  "pc-prendida",
  // El cartel "Reconectando con la PC…" (sólo se ve por la tailnet).
  "conexion",
  // El cartel de un error al pintar, en vez de la ventana en blanco (src/ErrorBoundary.ts).
  "error",
  // Nada miente mientras carga: un worker recién lanzado ("Arrancando…"), la conversación mientras se lee
  // (`HILOS_VARIANTE=lider`: la de un líder) y uno frenado a propósito, sin rojo (`HILOS_VARIANTE=lideres`: el resumen de su líder).
  "arrancando",
  "leyendo",
  // Un worker en cola (con su tarea, bajo su líder, "En cola · motivo", sin spinner) y otro que murió sin arrancar.
  "worker-en-cola",
  "frenado",
  // El tablero nuevo (Te esperan), con pendientes de fixture: la lista de proyectos, uno abierto con respuestas y el chat del líder con el mensaje armado
  // (`HILOS_VARIANTE=parados` despliega los parados, `abajo` baja hasta las pruebas, `mandadas` baja y despliega Mandadas, `todo` abre la pestaña Todo).
  "tablero-nuevo",
  "tablero-nuevo-proyecto",
  "tablero-nuevo-chat",
  // "Responder y avisar" en las preguntas de atlas ya contestadas: a un líder (su terminal), a elegir entre dos (el que originó la pregunta y el de la carpeta)
  // (`HILOS_VARIANTE=elegir` abre el selector, `sin` abre baliza, sin ningún líder: ni botón).
  "tablero-nuevo-avisar",
  // El teclado: el anillo de foco en una fila de la barra y en un control de la caja del líder, y la lista de atajos (`?`).
  "foco-barra",
  "foco-caja",
  "atajos",
  // Cerrar del todo (Ctrl+Q, la bandeja): la pregunta con sus dos salidas y, con líderes respondiendo, la confirmación.
  "salir",
  "salir-ocupados",
  // El panel de consumo a la derecha de un líder abierto; a 800 px (ancho intermedio) ocupa el lugar de la conversación.
  "consumo",
  // "De Claude Code (N)": la sección plegable de atlas abierta, con el buscador y las conversaciones (con una de carpeta que ya no existe y una de otra cuenta).
  "claude-code",
  // El orden de la barra: a mitad de un arrastre (lo que se lleva apagado, la línea donde cae) y el menú de una carpeta con Subir / Bajar / Orden por defecto.
  "orden-arrastrando",
  "orden-menu",
  // El orden por prioridad, el de fábrica (`Orden.prioridad`): te necesita, caché vivo y el resto por actividad.
  "orden-prioridad",
  // "Activas": la sección de arriba con líderes calientes de tres proyectos (te necesita, responde, workers vivos, caché caliente) y los fríos en su proyecto, con los proyectos calientes arriba.
  // `HILOS_VARIANTE=plegada` la deja plegada; `fijo` apaga la sección (cada líder en su proyecto).
  "activas",
  // "Mover a proyecto…" de un líder, con la lista larga: el buscador, Automático aparte, el marcado y el dónde está ahora.
  "mover-menu",
  // Trama en dos máquinas: con la otra máquina conectada, la barra con su líder y sus workers y el ícono de máquina en cada líder;
  // abierto el líder de la otra máquina (el ícono y el nombre en la cabecera); con la otra máquina sin conexión (sus filas no están y la barra lo dice); y con
  // la otra máquina en otra versión ("sólo lectura"). Con una sola máquina nada de esto aparece: las demás capturas no cambian.
  "maquinas",
  "maquinas-lider",
  "maquinas-caida",
  "maquinas-version",
  // La caja de un líder nuevo con el selector de máquina abierto: con la otra máquina conectada, y sin conexión (se ve, dice por qué y no se elige).
  "maquinas-selector",
  "maquinas-selector-caida",
  // La caja de un líder nuevo con el campo "Carpeta" abierto y una ruta puesta.
  "lider-nuevo-carpeta",
  // El cartel "Actualizando Trama…" en cada paso: 1 y 2 son de la ventana que se va (con velo, se ve la app detrás), 3 y 4 de la que llega.
  "actualizando-1",
  "actualizando-2",
  "actualizando-3",
  "actualizando-4",
  // La vista de un worker con pasos (src/hilo/Worker.tsx): uno que terminó y uno que sigue corriendo `npm test`.
  "worker-vista",
  "worker-vista-vivo",
  // La vista grande de un subagente (src/hilo/Subagente.tsx): el que corre `npm test`; `HILOS_VARIANTE=terminado`, el que terminó.
  "subagente-vista",
  // La bienvenida del primer arranque (src/paneles/Bienvenida.tsx); `HILOS_VARIANTE=<paso>` abre en ese paso.
  "bienvenida",
  // Las guías de pantalla (src/guia): `guia-<id>` muestra esa guía en su pantalla; `HILOS_VARIANTE=nuevo`, como si ya hubiera visto la anterior (sólo lo nuevo, con su marca).
  "guia-principal",
  "guia-lider",
  "guia-caja",
  "guia-worker",
  "guia-modelo",
  "guia-ajustes",
  "guia-ajustes-general",
  "guia-ajustes-modelos",
  "guia-ajustes-cupos",
  "guia-ajustes-proyectos",
  "guia-ajustes-guia",
  "guia-ramas",
  "guia-ramas-analisis",
  "guia-estadisticas",
  "guia-tablero",
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
  /** Estado forzado para las capturas (sin mouse ni teclado). */
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
   * panel de Ollama en otra dirección abierto, `mdl-lider` con el selector del líder abierto, `mdl-bajando` con un modelo bajándose a mitad,
   * `mdl-sinollama` con Ollama sin instalar (distro, GPU y el comando para copiar), `mdl-apagado` instalado pero apagado, `mdl-sugeridos` andando con los modelos sugeridos a la vista, `mdl-servidores` lo que se detecta en la máquina (llama.cpp, LM Studio, vLLM, Ollama), `mdl-prender` con el aviso de prender un modelo abierto `mdl-guias` las guías de instalación y `mdl-win` lo mismo visto desde Windows, `mdl-tope` con el aviso de un tope de Claude cruzado, `mdl-wk` la tabla «Modelos para workers» (`mdl-wk-todo` con todos los grupos abiertos, `mdl-wk-sin` sin la lista del reparto, `mdl-wk-cargando` con la tabla todavía cargando: se ve su esqueleto y el resto del panel ya listo; `mdl-efectivo-tarda` con «Hoy elegiría» todavía en espera) y `sinmdl` sin archivo (lo de hoy).
   * `cargando`: Modelos y Celular no reciben respuesta nunca: se ve su esqueleto (`PanelCargando.tsx`); `cargando-dsh` lo mismo con DeepSeek Harness (Modelos sí carga: el de dsh nace adentro de su sección).
   * OpenCode (`AjustesOpencode.tsx`): `oc-sin` sin instalar, `oc-sin-login` instalado sin sesión, `oc-go` con el plan Go prendido (y la tarjeta de topes en Plan y cupos).
   * Conectores (`AjustesConectoresInventario.tsx`): `mcp` deja a la vista el inventario de Claude Code y los servidores propios, `mcp-vacio` sin nada conectado; `plugins` el catálogo de plugins y `plugins-vacio` con los oficiales sin agregar.
   * NVIDIA NIM (`AjustesNvidia.tsx`, en Ajustes > OpenCode): `nim` con la clave guardada y dos modelos prendidos, `nim-falla` donde Probar falla; sin variante, sin clave. `cupos-nim`: Plan y cupos con la tarjeta y la fila de la barra con 25 de 40 pedidos.
   * DeepSeek Harness (`AjustesDsh.tsx`): `dsh` instalado y con la key de OpenCode guardada, `dsh-sin` sin instalar y sin keys, `dsh-falla` donde Instalar falla y DeepSeek rechaza su key; `dsh-menu` (con `modelo`) el selector con los modelos de dsh.
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
