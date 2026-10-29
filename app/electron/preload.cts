// Preload sandboxeado (CommonJS a la fuerza): lo único que ve el frontend del
// proceso main es `window.hilos`.
import { contextBridge, ipcRenderer } from "electron";
// Sólo tipos: un preload con sandbox no puede cargar otro archivo. Los canales salen de la lista única (electron/canales/contrato.ts):
// uno que no esté ahí no compila, y tests/canales.test.ts comprueba que cada uno de la lista se usa acá.
import type { CanalEnvio, CanalEvento, CanalInvoke } from "./canales/contrato.ts";

/** Pedirle algo al main por un canal de la lista. */
const invocar = (canal: CanalInvoke, ...args: unknown[]): Promise<any> => ipcRenderer.invoke(canal, ...args);

/** Suscribirse a un canal del main; devuelve cómo desuscribirse. */
const oir = (canal: CanalEvento) => (fn: (dato: unknown) => void) => {
  const f = (_e: unknown, dato: unknown) => fn(dato);
  ipcRenderer.on(canal, f);
  return () => {
    ipcRenderer.off(canal, f);
  };
};

contextBridge.exposeInMainWorld("hilos", {
  bench: {
    modo: (): Promise<boolean> => invocar("bench:modo"),
    listo: (): Promise<number> => invocar("bench:listo"),
    cpu: (): Promise<unknown> => invocar("bench:cpu"),
    fin: (reporte: unknown): Promise<void> => invocar("bench:fin", reporte),
  },
  statusline: {
    leer: (): Promise<unknown> => invocar("statusline:leer"),
    sincronizar: (): Promise<unknown> => invocar("statusline:sincronizar"),
    alCambiar: oir("statusline:cambio"),
  },
  hilos: {
    leer: (): Promise<unknown> => invocar("hilos:leer"),
    /** La última lista entera (si se perdió el hilo de las diferencias de `alCambiar`). */
    completa: (): Promise<unknown> => invocar("hilos:completa"),
    guardados: (): Promise<unknown> => invocar("hilos:guardados"),
    alCambiar: oir("hilos:cambio"),
    /** Los ids que nombró cada tanda nueva de `eventos.jsonl`. */
    alEvento: oir("eventos:ids"),
    /** Cada línea nueva: un worker que arranca o se frena (`EventoPa`). */
    alEventoPa: oir("eventos:pa"),
  },
  leidos: {
    leer: (): Promise<unknown> => invocar("leidos:leer"),
    marcar: (id: string, ts: number): Promise<void> => invocar("leidos:marcar", id, ts),
  },
  nombres: {
    leer: (): Promise<unknown> => invocar("nombres:leer"),
    titulo: (id: string, titulo: string): Promise<void> => invocar("nombres:titulo", id, titulo),
    proyecto: (sid: string, slug: string | null): Promise<void> => invocar("nombres:proyecto", sid, slug),
    oculto: (slug: string, si: boolean): Promise<void> => invocar("nombres:oculto", slug, si),
    orden: (orden: unknown): Promise<void> => invocar("nombres:orden", orden),
    alOrden: oir("nombres:orden"),
  },
  /** Los slugs del registry (Mover a proyecto…). */
  carpetas: (): Promise<unknown> => invocar("proyectos:carpetas"),
  /** Cada nombre del registry con el slug de su carpeta (Iniciar una tarea del tablero). */
  slugsPorNombre: (): Promise<unknown> => invocar("proyectos:nombres"),
  preferencias: {
    leer: (): Promise<unknown> => invocar("preferencias:leer"),
    effort: (modelo: string, effort: string): Promise<void> => invocar("preferencias:effort", modelo, effort),
    idioma: (idioma: string): Promise<void> => invocar("preferencias:idioma", idioma),
    apariencia: (a: unknown): Promise<void> => invocar("preferencias:apariencia", a),
    tiernos: (si: boolean): Promise<void> => invocar("preferencias:tiernos", si),
    avisarEspera: (si: boolean): Promise<void> => invocar("preferencias:avisarEspera", si),
    avisarWorkers: (si: boolean): Promise<void> => invocar("preferencias:avisarWorkers", si),
    terminalAgentes: (t: string): Promise<void> => invocar("preferencias:terminalAgentes", t),
    avisoLider: (v: string): Promise<void> => invocar("preferencias:avisoLider", v),
    vista: (vista: string): Promise<void> => invocar("preferencias:vista", vista),
    consumo: (si: boolean): Promise<void> => invocar("preferencias:consumo", si),
    bienvenidaPendiente: (): Promise<boolean> => invocar("preferencias:bienvenidaPendiente"),
    bienvenida: (si: boolean): Promise<void> => invocar("preferencias:bienvenida", si),
    guias: (): Promise<unknown> => invocar("preferencias:guias"),
    guiasOp: (op: unknown): Promise<unknown> => invocar("preferencias:guiasOp", op),
  },
  /** El panel de consumo (a la derecha): lo que consumió cada modelo y cómo va cada sesión. */
  consumo: {
    mirar: (pedido: unknown): Promise<unknown> => invocar("consumo:mirar", pedido),
    soltar: (): Promise<void> => invocar("consumo:soltar"),
    alCambiar: oir("consumo:cambio"),
  },
  /** Los pasos de un worker (la vista de worker): `mirar` contesta la vista entera, después llegan los cambios por lotes. */
  pasos: {
    mirar: (id: string): Promise<unknown> => invocar("pasos:mirar", id),
    soltar: (): Promise<void> => invocar("pasos:soltar"),
    alCambiar: oir("pasos:cambio"),
  },
  pa: {
    cerrar: (h: unknown): Promise<void> => invocar("pa:cerrar", h),
    hilo: (x: unknown): Promise<unknown> => invocar("pa:hilo", x),
    parar: (id: string): Promise<void> => invocar("pa:parar", id),
  },
  /** slug → `titulo` del registry de cada proyecto que tiene uno. */
  titulos: (): Promise<unknown> => invocar("proyectos:titulos"),
  /** Los proyectos del registry con su nombre para mostrar (electron/proyectos-alias.ts); `renombrar` lo cambia (`null`: lo saca). */
  proyectosNombres: {
    lista: (): Promise<unknown> => invocar("proyectos:lista"),
    renombrar: (slug: string, nombre: string | null): Promise<unknown> => invocar("proyectos:renombrar", slug, nombre),
    /** Guarda el logo elegido a mano (la data URL que devolvió `elegirLogo`); `null`: vuelve al automático. */
    logo: (slug: string, logo: string | null): Promise<unknown> => invocar("proyectos:logo", slug, logo),
  },
  /** slug → data URL del logo de cada proyecto que tiene uno (electron/iconos.ts). */
  iconos: (): Promise<unknown> => invocar("proyectos:iconos"),
  dictado: {
    transcribir: (x: unknown): Promise<string> => invocar("dictado:transcribir", x),
    modelos: (): Promise<unknown> => invocar("dictado:modelos"),
    elegirModelo: (id: string): Promise<unknown> => invocar("dictado:elegirModelo", id),
  },
  /** Los modelos locales (electron/locales.ts): su contexto, la cuenta de la VRAM y Probar. */
  locales: {
    leer: (): Promise<unknown> => invocar("locales:leer"),
    guardar: (x: unknown): Promise<unknown> => invocar("locales:guardar", x),
    probar: (x: unknown): Promise<unknown> => invocar("locales:probar", x),
    detectar: (): Promise<unknown> => invocar("locales:detectar"),
    prender: (unit: string): Promise<unknown> => invocar("locales:prender", unit),
    apagar: (unit: string): Promise<unknown> => invocar("locales:apagar", unit),
  },
  /** Quién tiene la GPU y cómo liberarla (electron/vram.ts). */
  vram: {
    leer: (): Promise<unknown> => invocar("vram:leer"),
    liberar: (x: unknown): Promise<unknown> => invocar("vram:liberar", x),
  },
  /** Las conversaciones de Claude Code que no son de Trama (electron/claude-code.ts). */
  claudeCode: {
    listar: (): Promise<unknown> => invocar("claudeCode:listar"),
  },
  /** Una imagen local que nombra un líder (electron/imagen-local.ts): `{ tipo, datos }` en base64, o `null` si no está. */
  imagen: { leer: (ruta: string): Promise<unknown> => invocar("imagen:leer", ruta) },
  lider: {
    nuevo: (x: unknown): Promise<string> => invocar("lider:nuevo", x),
    mandar: (x: unknown): Promise<void> => invocar("lider:mandar", x),
    mandarYa: (x: unknown): Promise<void> => invocar("lider:mandarYa", x),
    archivo: (x: unknown): Promise<string> => invocar("lider:archivo", x),
    parar: (sid: string): Promise<void> => invocar("lider:parar", sid),
    modo: (x: unknown): Promise<void> => invocar("lider:modo", x),
    cuenta: (x: unknown): Promise<void> => invocar("lider:cuenta", x),
    permiso: (x: unknown): Promise<void> => invocar("lider:permiso", x),
    pendientes: (sid: string): Promise<unknown> => invocar("lider:pendientes", sid),
    comandos: (): Promise<unknown> => invocar("lider:comandos"),
    estilos: (): Promise<unknown> => invocar("lider:estilos"),
    estilo: (x: unknown): Promise<unknown> => invocar("lider:estilo", x),
    cerrar: (sid: string, motivo?: string): Promise<void> => invocar("lider:cerrar", sid, motivo),
    retomar: (x: unknown): Promise<unknown> => invocar("lider:retomar", x),
    rebobinar: (x: unknown): Promise<string | null> => invocar("lider:rebobinar", x),
    ramificar: (x: unknown): Promise<string> => invocar("lider:ramificar", x),
    conversacion: (x: unknown): Promise<unknown> => invocar("lider:conversacion", x),
    mirar: (sid: string | null): Promise<void> => invocar("lider:mirar", sid),
    visto: (sid: string): Promise<void> => invocar("lider:visto", sid),
    traer: (x: unknown): Promise<unknown> => invocar("lider:traer", x),
    ir: (pid: number): Promise<boolean> => invocar("lider:ir", pid),
    ubicable: (pid: number): Promise<boolean> => invocar("lider:ubicable", pid),
    encolar: (x: unknown): Promise<void> => invocar("lider:encolar", x),
    colaSeleccion: (x: unknown): Promise<void> => invocar("lider:colaSeleccion", x),
    colaQuitar: (x: unknown): Promise<void> => invocar("lider:colaQuitar", x),
    colas: (): Promise<unknown> => invocar("lider:colas"),
    colaYa: (x: unknown): Promise<void> => invocar("lider:colaYa", x),
    alCola: oir("lider:cola"),
    /** Lo que sale del stream de un líder de la app: `{ sid, e }`. */
    alEvento: oir("lider:evento"),
    /** Cambió el transcript del líder mirado (su sid). */
    alTranscript: oir("lider:transcript"),
  },
  paneles: {
    ajustes: (): Promise<unknown> => invocar("ajustes:leer"),
    umbralContexto: (): Promise<unknown> => invocar("contexto:umbral"),
    medicion: (): Promise<unknown> => invocar("medicion:leer"),
    historial: (dias: number, rol: string | null): Promise<unknown> => invocar("historial:consultar", dias, rol),
    arranqueMedido: (): Promise<unknown> => invocar("historial:arranque"),
    medirArranque: (): Promise<unknown> => invocar("historial:medir"),
    rama: (accion: string, h: unknown): Promise<unknown> => invocar("pa:rama", accion, h),
    lanzar: (x: unknown): Promise<unknown> => invocar("pa:lanzar", x),
    routing: (cambios: unknown): Promise<unknown> => invocar("routing:guardar", cambios),
    modelos: (): Promise<unknown> => invocar("modelos:leer"),
    efectivoModelos: (): Promise<unknown> => invocar("modelos:efectivo"),
    guardarModelos: (config: unknown): Promise<unknown> => invocar("modelos:guardar", config),
    sondearOllama: (url: string): Promise<unknown> => invocar("modelos:sondear", url),
    bajarModelo: (url: string, modelo: string): Promise<unknown> => invocar("modelos:bajar", url, modelo),
    cancelarBajada: (url: string, modelo: string): Promise<void> => invocar("modelos:cancelarBajada", url, modelo),
    bajadas: (): Promise<unknown> => invocar("modelos:bajadas"),
    entornoOllama: (): Promise<unknown> => invocar("modelos:entorno"),
    estadoDsh: (): Promise<unknown> => invocar("dsh:estado"),
    instalarDsh: (): Promise<unknown> => invocar("dsh:instalar"),
    claveDsh: (nombre: string, valor: string | null): Promise<unknown> => invocar("dsh:clave", nombre, valor),
    probarDsh: (proveedor: string, url?: string): Promise<unknown> => invocar("dsh:probar", proveedor, url),
    estadoMcp: (x: { motor: string; local?: boolean; fresco?: boolean }): Promise<unknown> => invocar("mcp:estado", x),
    listaMcp: (): Promise<unknown> => invocar("mcp:lista"),
    guardarMcp: (entrada: unknown): Promise<unknown> => invocar("mcp:guardar", entrada),
    quitarMcp: (nombre: string): Promise<unknown> => invocar("mcp:quitar", nombre),
    apagadosMcp: (): Promise<unknown> => invocar("mcp:apagados"),
    fijarApagadoMcp: (nombre: string, apagado: boolean): Promise<unknown> => invocar("mcp:fijarApagado", nombre, apagado),
    inventarioConectores: (): Promise<unknown> => invocar("conectores:inventario"),
    alternarConector: (id: string, activo: boolean): Promise<unknown> => invocar("conectores:alternar", id, activo),
    catalogosPlugins: (): Promise<unknown> => invocar("plugins:catalogos"),
    agregarCatalogoPlugins: (repo: string, cuenta?: string): Promise<unknown> => invocar("plugins:agregarCatalogo", repo, cuenta),
    instalarPlugin: (plugin: string, catalogo: string, cuenta?: string): Promise<unknown> => invocar("plugins:instalar", plugin, catalogo, cuenta),
    quitarPlugin: (plugin: string, catalogo: string, cuenta?: string): Promise<unknown> => invocar("plugins:quitar", plugin, catalogo, cuenta),
    repartoTabla: (): Promise<unknown> => invocar("reparto:tabla"),
    estadoAA: (): Promise<unknown> => invocar("aa:estado"),
    refrescarAA: (): Promise<unknown> => invocar("aa:refrescar"),
    estadoOpencode: (): Promise<unknown> => invocar("opencode:estado"),
    actualizarOpencode: (): Promise<unknown> => invocar("opencode:actualizar"),
    planOpencode: (): Promise<unknown> => invocar("opencode:plan"),
    guardarPlanOpencode: (plan: string): Promise<unknown> => invocar("opencode:planGuardar", plan),
    estadoNvidia: (): Promise<unknown> => invocar("nvidia:estado"),
    guardarModelosNvidia: (lista: string[]): Promise<unknown> => invocar("nvidia:modelos", lista),
    probarNvidia: (): Promise<unknown> => invocar("nvidia:probar"),
    alBajar: oir("modelos:bajando"),
    alTablaNueva: oir("reparto:tablaNueva"),
    guardarAjustes: (cambio: unknown): Promise<unknown> => invocar("ajustes:guardar", cambio),
    remoto: (): Promise<unknown> => invocar("remoto:leer"),
    guardarRemoto: (config: unknown): Promise<unknown> => invocar("remoto:guardar", config),
    brief: (hs: unknown): Promise<unknown> => invocar("ramas:brief", hs),
    limpieza: (): Promise<unknown> => invocar("limpieza:leer"),
    guardarLimpieza: (cambio: unknown): Promise<unknown> => invocar("limpieza:guardar", cambio),
    verLimpieza: (dias: number): Promise<unknown> => invocar("limpieza:ver", dias),
    aplicarLimpieza: (dias: number): Promise<unknown> => invocar("limpieza:aplicar", dias),
    leccionesPendientes: (): Promise<unknown> => invocar("orq:lecciones"),
    textoPoda: (slug: string): Promise<string> => invocar("orq:podaTexto", slug),
    leerLecciones: (slug: string): Promise<string> => invocar("orq:leccionesLeer", slug),
    guardarLecciones: (slug: string, texto: string): Promise<unknown> => invocar("orq:leccionesGuardar", slug, texto),
    auditar: (x: unknown): Promise<unknown> => invocar("orq:auditar", x),
    agentsMd: (slug: string): Promise<unknown> => invocar("orq:agentsMd", slug),
    mdEstado: (slug: string): Promise<unknown> => invocar("orq:mdEstado", slug),
    mdPlan: (slug: string): Promise<unknown> => invocar("orq:mdPlan", slug),
    mdAplicar: (slug: string, huella: string): Promise<unknown> => invocar("orq:mdAplicar", slug, huella),
    mdFusionar: (slug: string, tipo?: "acortar" | "fusionar"): Promise<unknown> => invocar("orq:mdFusionar", slug, tipo),
    leerAgents: (slug: string): Promise<string> => invocar("orq:agentsLeer", slug),
    guardarAgents: (slug: string, texto: string): Promise<unknown> => invocar("orq:agentsGuardar", slug, texto),
    retomar: (h: unknown): Promise<unknown> => invocar("hilo:retomar", h),
    pasar: (h: unknown): Promise<string> => invocar("hilo:pasar", h),
  },
  /** Qué máquinas hay y cómo están (el ícono del líder y el "sin conexión" de la barra). */
  maquinas: {
    leer: (): Promise<unknown> => invocar("maquinas:leer"),
    alCambiar: oir("maquinas:cambio"),
  },
  /** Los modelos que agrega `~/.config/trama/modelos.json` (Gemini, Ollama, el líder por defecto); `null` sin el archivo. */
  modelos: {
    config: (): Promise<unknown> => invocar("modelos:config"),
  },
  /** El nombre del dueño de la máquina (electron/dueno.ts). */
  dueno: {
    nombre: (): Promise<string | null> => invocar("dueno:nombre"),
  },
  /** La salud de lo integrado (B25, electron/salud.ts). */
  salud: {
    leer: (): Promise<unknown> => invocar("salud:leer"),
    arreglar: (h: unknown): Promise<unknown> => invocar("salud:arreglar", h),
    alCambiar: oir("salud:cambio"),
  },
  /** "Integrar solo lo seguro" de Ramas (electron/autointegrar.ts). */
  auto: {
    leer: (): Promise<unknown> => invocar("auto:leer"),
    prender: (si: boolean): Promise<void> => invocar("auto:prender", si),
    alCambiar: oir("auto:cambio"),
  },
  /** El aviso de Claude Code nuevo del pie (electron/actualizacion.ts). */
  claude: {
    version: (): Promise<unknown> => invocar("claude:version"),
    descartar: (): Promise<void> => invocar("claude:descartar"),
    actualizar: (): Promise<unknown> => invocar("claude:actualizar"),
    reiniciar: (): Promise<unknown> => invocar("claude:reiniciar"),
    changelog: (): Promise<void> => invocar("claude:changelog"),
    alCambiar: oir("claude:version"),
  },
  /** El aviso de Antigravity CLI (`agy`) nuevo del pie (electron/actualizacion-agy.ts). */
  agy: {
    version: (): Promise<unknown> => invocar("agy:version"),
    descartar: (): Promise<void> => invocar("agy:descartar"),
    actualizar: (): Promise<unknown> => invocar("agy:actualizar"),
    alCambiar: oir("agy:version"),
  },
  /** El aviso de "hay una Trama nueva" del pie (electron/actualizacion-trama.ts). */
  trama: {
    version: (): Promise<unknown> => invocar("trama:version"),
    buscar: (): Promise<unknown> => invocar("trama:buscar"),
    descartar: (): Promise<void> => invocar("trama:descartar"),
    actualizar: (modo: "ya" | "esperar"): Promise<unknown> => invocar("trama:actualizar", modo),
    cancelarEspera: (): Promise<void> => invocar("trama:cancelarEspera"),
    limpiar: (): Promise<void> => invocar("trama:limpiar"),
    actualizacion: (): Promise<unknown> => invocar("trama:actualizacion"),
    ocupacion: (): Promise<unknown> => invocar("trama:ocupacion"),
    reiniciarVentana: (): Promise<void> => invocar("trama:reiniciarVentana"),
    notas: (url: string): Promise<void> => invocar("trama:notas", url),
    alCambiar: oir("trama:version"),
    alCambiarActualizacion: oir("trama:actualizacion"),
  },
  /** Lo que falta del setup (electron/setup.ts). */
  setup: {
    estado: (): Promise<unknown> => invocar("setup:estado"),
    descartar: (id: string): Promise<void> => invocar("setup:descartar", id),
  },
  /** Si Claude y Gemini (agy) están conectados (electron/cuentas.ts). */
  cuentas: {
    estado: (): Promise<unknown> => invocar("cuentas:estado"),
    lista: (verificar: boolean): Promise<unknown> => invocar("cuentas:lista", verificar),
    agregar: (proveedor: string, nombre: string): Promise<unknown> => invocar("cuentas:agregar", proveedor, nombre),
    renombrar: (id: string, nombre: string): Promise<unknown> => invocar("cuentas:renombrar", id, nombre),
    quitar: (id: string, borrarCredenciales: boolean): Promise<unknown> => invocar("cuentas:quitar", id, borrarCredenciales),
    login: (id: string): Promise<unknown> => invocar("cuentas:login", id),
    plan: (id: string, plan: string): Promise<unknown> => invocar("cuentas:plan", id, plan),
    preferir: (id: string): Promise<unknown> => invocar("cuentas:preferir", id),
  },
  /** Sólo por la tailnet (lo arma electron/remoto-cliente.ts; en la ventana no llega nunca): `false` = se cayó la conexión con la PC. */
  conexion: {
    alCambiar: oir("remoto:conexion"),
  },
  /** El tablero de pendientes (electron/tablero.ts): lo lee de `vista.json`, lo escribe el CLI `tablero`. */
  tablero: {
    leer: (): Promise<unknown> => invocar("tablero:leer"),
    mover: (id: number, columna: string): Promise<void> => invocar("tablero:mover", id, columna),
    cerrar: (id: number): Promise<void> => invocar("tablero:cerrar", id),
    tirar: (id: number): Promise<void> => invocar("tablero:tirar", id),
    posponer: (id: number, hasta: string): Promise<void> => invocar("tablero:posponer", id, hasta),
    agregar: (texto: string, proyecto: string | null, maquina?: string): Promise<unknown> => invocar("tablero:agregar", texto, proyecto, maquina),
    responder: (id: number, r: unknown): Promise<void> => invocar("tablero:responder", id, r),
    esperan: (): Promise<unknown> => invocar("tablero:esperan"),
    /** El CLI reescribió la vista. */
    alCambiar: oir("tablero:cambio"),
  },
  /** Lo que el usuario tocó en el tablero nuevo y todavía no mandó (electron/pendientes.ts). */
  pendientes: {
    leer: (): Promise<unknown> => invocar("pendientes:leer"),
    guardar: (x: unknown): Promise<void> => invocar("pendientes:guardar", x),
  },
  /** Quién está compactando su contexto (electron/compactando.ts): id → desde cuándo. */
  compactando: {
    leer: (): Promise<unknown> => invocar("compactando:leer"),
    alCambiar: oir("compactando:cambio"),
  },
  /** Los subagentes de cada sesión con proceso (electron/subagentes.ts): sesión → lista, sin validar; y el informe entero de uno. */
  subagentes: {
    leer: (): Promise<unknown> => invocar("subagentes:leer"),
    informe: (sid: string, id: string): Promise<string | null> => invocar("subagentes:informe", sid, id),
    alCambiar: oir("subagentes:cambio"),
  },
  /** Para la captura offscreen: avisa que los datos ya están pintados. */
  pintado: (): void => ipcRenderer.send("captura:pintado" satisfies CanalEnvio),
  salir: (x: { modo: "seguir" | "parar"; forzar: boolean }): Promise<number> => invocar("app:salir", x),
  /** La bandeja del sistema (sólo la ventana de la PC): los textos de su menú ya traducidos, y el pedido de "Cerrar del todo" desde ahí. */
  bandeja: {
    textos: (t: { abrir: string; cerrar: string }): Promise<void> => invocar("bandeja:textos", t),
    alPedirSalida: oir("app:pedirSalida"),
  },
  /** "Te espera" en la pantalla de la PC (sólo la ventana): el número en la bandeja, la notificación y el toque a la notificación. */
  espera: {
    estado: (x: { n: number; texto: string }): Promise<void> => invocar("espera:estado", x),
    notificar: (x: { sid: string; titulo: string; cuerpo: string }): Promise<void> => invocar("espera:notificar", x),
    alAbrir: oir("espera:abrir"),
  },
  /** El texto del portapapeles leído por el main, por si el Ctrl+V del navegador no lo trae (sólo la ventana). */
  portapapeles: { texto: (): Promise<string> => invocar("portapapeles:texto") },
  /** El selector nativo de carpetas (el campo "Carpeta" de un líder nuevo); sólo la ventana de la PC. */
  carpeta: { elegir: (): Promise<string | null> => invocar("carpeta:elegir") },
  /** El selector nativo de una imagen para el logo de un proyecto: la imagen ya achicada a 64 px (data URL) o `null` si se canceló; sólo la ventana de la PC. */
  archivo: { elegirLogo: (): Promise<string | null> => invocar("archivo:elegirLogo") },
  /** Vuelve a cargar la ventana (el cartel de error); sólo en la ventana de la PC. */
  recargar: (): Promise<void> => invocar("app:recargar"),
  /** Un error del renderer, al log del main (electron/log.ts). */
  bitacora: (x: { donde: string; detalle: string }): Promise<void> => invocar("bitacora:escribir", x),
  /** El cartel "Hay una actualización disponible" (un build de trama más nuevo que el que corre). */
  /** "PC apagada · Prender" (sólo con una PC configurada en maquinas.json de la otra máquina). */
  workers: {
    /** Un worker terminó, falló o se colgó (electron/avisos-worker.ts). */
    alAviso: oir("workers:aviso"),
    relanzar: (id: string): Promise<unknown> => invocar("workers:relanzar", { id }),
  },
  pc: {
    leer: (): Promise<unknown> => invocar("pc:leer"),
    prender: (): Promise<unknown> => invocar("pc:prender"),
    alCambiar: oir("pc:cambio"),
  },
  reinicio: {
    leer: (): Promise<unknown> => invocar("reinicio:leer"),
    pedir: (igual?: boolean): Promise<void> => invocar("reinicio:pedir", igual === true),
    cancelar: (): Promise<void> => invocar("reinicio:cancelar"),
    marca: (paso: string): Promise<void> => invocar("reinicio:marca", paso),
    alCambiar: oir("reinicio:cambio"),
  },
  /** Volver como estaba tras ese reinicio: lo que la ventana tenía abierto y escrito. */
  volver: {
    leer: (): Promise<unknown> => invocar("volver:leer"),
    guardar: (vista: unknown): Promise<void> => invocar("volver:guardar", vista),
    alPedir: oir("volver:pedir"),
    anotar: (vista: unknown): Promise<void> => invocar("volver:anotar", vista),
  },
  /** Lo escrito sin mandar, en disco (electron/borradores.ts): lo de la vez anterior, y la foto entera con cada cambio. */
  borradores: {
    leer: (): Promise<unknown> => invocar("borradores:leer"),
    guardar: (foto: unknown): Promise<void> => invocar("borradores:guardar", foto),
  },
});
