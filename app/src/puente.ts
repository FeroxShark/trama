// Lo único que el frontend sabe del proceso main: `window.hilos`, que expone
// el preload (electron/preload.cts) con contextBridge. Lo que llega del main
// se trata como `unknown` hasta que src/datos/fuente.ts le mira la versión.
import type { Dif } from "./datos/hilos-dif";
import type { Imagen } from "../electron/imagenes";
import type { EstadoLocales, ResultadoProbar } from "../electron/locales";
import type { ResultadoDeteccion } from "../electron/locales-deteccion";
import type { EstadoVram, ResultadoLiberar } from "../electron/vram";
import type { EventoLider, Statusline } from "./datos/contrato";
import type { DatosPasar, RamaBrief } from "../electron/asistente";
import { textoMain } from "./i18n";

type Bench = {
  modo(): Promise<boolean>;
  listo(): Promise<number>;
  cpu(): Promise<unknown>;
  fin(reporte: unknown): Promise<void>;
};

type Soltar = () => void;


/** Una lectura de `pa --hilos --json`; `n` crece con cada corrida (0: la guardada del arranque anterior). */
export type Lectura = { n: number; datos: unknown } | { n: number; error: string };
/** Lo que llega por `hilos.alCambiar`: la lectura entera o sólo lo que cambió contra la anterior (`src/datos/hilos-dif.ts`). */
export type Envio = Lectura | { n: number; dif: Dif };

type Main = {
  bench: Bench;
  statusline: { leer(): Promise<Statusline>; sincronizar(): Promise<Statusline>; alCambiar(fn: (s: Statusline) => void): Soltar };
  hilos: {
    leer(): Promise<Lectura>;
    /** La última lista buena (`~/.local/state/hilos/hilos.json`) o `null`. */
    guardados(): Promise<unknown>;
    /** La última lista entera: para cuando una diferencia no cierra con la que se tiene. */
    completa(): Promise<Lectura>;
    alCambiar(fn: (l: Envio) => void): Soltar;
    /** Los ids que nombró cada tanda nueva de `eventos.jsonl`. */
    alEvento(fn: (ids: string[]) => void): Soltar;
    /** Cada línea nueva de `eventos.jsonl` (un worker que arranca o se frena). */
    alEventoPa(fn: (eventos: unknown) => void): Soltar;
  };
  leidos: { leer(): Promise<Record<string, number>>; marcar(id: string, ts: number): Promise<void> };
  /** Lo que el usuario le cambió a la barra (B20, `~/.local/state/hilos/nombres.json`), sin validar. */
  nombres: {
    leer(): Promise<unknown>;
    titulo(id: string, titulo: string): Promise<void>;
    proyecto(sid: string, slug: string | null): Promise<void>;
    oculto(slug: string, si: boolean): Promise<void>;
    /** El orden entero que quedó tras arrastrar. */
    orden(orden: unknown): Promise<void>;
    /** El orden que se guardó (acá o desde el otro lado: la ventana o el celular), sin validar. */
    alOrden(fn: (orden: unknown) => void): Soltar;
  };
  /** Los slugs del registry, sin validar. */
  carpetas(): Promise<unknown>;
  /** Cada nombre del registry (alias incluidos) con el slug de su carpeta, sin validar. */
  slugsPorNombre(): Promise<unknown>;
  /** Lo que la app recuerda (`~/.local/state/hilos/preferencias.json`): el esfuerzo por modelo, el idioma, la letra, las fuentes y la vista de la barra. */
  preferencias: {
    leer(): Promise<{ effort: Record<string, string>; cacheVencida?: "seguir" | "resumen" }>;
    effort(modelo: string, effort: string): Promise<void>;
    idioma(idioma: string): Promise<void>;
    apariencia(a: { letra?: number; fuente?: string; mono?: string; tema?: string }): Promise<void>;
    /** Los mensajes tiernos (B17), prendidos o apagados. */
    tiernos(si: boolean): Promise<void>;
    /** La notificación de "te espera", prendida o apagada. */
    avisarEspera(si: boolean): Promise<void>;
    /** La notificación de un worker que falla o de una tanda que terminó, prendida o apagada. */
    avisarWorkers(si: boolean): Promise<void>;
    /** La terminal de líderes y workers en Windows (Ajustes > General): PowerShell o Git Bash. */
    terminalAgentes(t: "powershell" | "gitbash"): Promise<void>;
    /** Cómo se avisa al líder de un worker: al terminar la tanda (`tanda`) o por cada worker (`worker`). */
    avisoLider(v: "tanda" | "worker"): Promise<void>;
    /** Qué hacer con el primer mensaje cuando la caché venció y el contexto es grande: `preguntar` (por defecto), `seguir` o `resumen`. */
    cacheVencida(v: "preguntar" | "seguir" | "resumen"): Promise<void>;
    vista(vista: "todo" | "lideres"): Promise<void>;
    /** El panel de consumo, a la vista u oculto. */
    consumo(si: boolean): Promise<void>;
    /** ¿Abrir la bienvenida sola? Nunca se vio y no es una corrida de prueba. */
    bienvenidaPendiente(): Promise<boolean>;
    /** Marca la bienvenida como vista (`true`) o vuelve a dejarla pendiente. */
    bienvenida(si: boolean): Promise<void>;
    /** Las guías de pantalla (src/guia): su estado guardado (sin validar: `normalizarGuias`) y un cambio de ese estado, que devuelve el que quedó. */
    guias(): Promise<unknown>;
    guiasOp(op: unknown): Promise<unknown>;
  };
  /** El panel de consumo (electron/consumo.ts): lo que contesta va sin validar (`consumoDe`). */
  consumo: {
    mirar(pedido: { lideres: string[]; workers: string[] }): Promise<unknown>;
    soltar(): Promise<void>;
    alCambiar(fn: (c: unknown) => void): Soltar;
  };
  /** Los pasos de un worker (electron/pasos-worker.ts): lo que contesta va sin validar (`vistaDe`, `cambioDe`). */
  pasos: {
    mirar(id: string): Promise<unknown>;
    soltar(): Promise<void>;
    alCambiar(fn: (c: unknown) => void): Soltar;
  };
  pa: {
    /** Settle: integra o archiva según `origen` y `rama` (electron/settle.ts). */
    cerrar(h: { id: string; proyecto: string; rama: string | null; origen: string }): Promise<void>;
    /** `pa --hilo <id> --json -n <n> [--antes <antes>]`, sin validar (ver fuente.ts). */
    hilo(x: { id: string; n?: number; antes?: number | null }): Promise<unknown>;
    parar(id: string): Promise<void>;
  };
  /** slug → `titulo` del registry, sin validar. */
  titulos(): Promise<unknown>;
  /** Los proyectos con su nombre para mostrar (electron/proyectos-alias.ts); `renombrar(slug, null)` lo saca. */
  proyectosNombres: { lista(): Promise<unknown>; renombrar(slug: string, nombre: string | null): Promise<unknown>; logo(slug: string, logo: string | null): Promise<unknown> };
  /** slug → data URL del logo de cada proyecto que tiene uno. */
  iconos(): Promise<Record<string, string>>;
  /** Dictar (electron/dictado.ts): un WAV 16 kHz mono de hasta 5 min → el texto que dijo (Handy, en la máquina del motor). */
  /** `modelos` / `elegirModelo`: el modelo de Handy de Ajustes (electron/dictado-modelos.ts), sin validar. */
  dictado: { transcribir(x: { datos: Uint8Array }): Promise<string>; modelos(): Promise<unknown>; elegirModelo(id: string): Promise<unknown> };
  /** Los modelos locales (electron/locales.ts): su contexto, la cuenta de la VRAM y Probar (carga el modelo de verdad). */
  locales: {
    leer(): Promise<EstadoLocales>;
    guardar(x: { id: string; ctx: number }): Promise<EstadoLocales>;
    probar(x: { id: string; ctx: number }): Promise<ResultadoProbar>;
    /** Lo que hay instalado o andando en esta máquina (sólo se lee). */
    detectar(): Promise<ResultadoDeteccion>;
    /** Prende el servicio de un modelo detectado (ocupa la GPU): sólo con el clic, la ventana ya pidió confirmar. */
    prender(unit: string): Promise<{ ok: boolean; error?: string }>;
    apagar(unit: string): Promise<{ ok: boolean; error?: string }>;
  };
  /** Quién tiene la GPU y cómo liberarla (electron/vram.ts): la lista no toca nada; `liberar` para o reinicia un servicio (sólo con el clic). */
  vram: {
    leer(): Promise<EstadoVram>;
    liberar(x: { id: string }): Promise<ResultadoLiberar>;
  };
  /** Las conversaciones de Claude Code que no son de Trama (electron/claude-code.ts), sin validar. */
  claudeCode: {
    listar(): Promise<unknown>;
  };
  /** Una imagen local que nombra un líder en su texto (electron/imagen-local.ts): `{ tipo, datos }`, o `null` si no está. */
  imagen: {
    leer(ruta: string): Promise<unknown>;
  };
  /** Un archivo que nombra la actividad de un worker (electron/archivo-ver.ts), sin validar; `null` si ya no está. */
  archivoVer(ruta: string): Promise<unknown>;
  /** Los líderes: los de la app se manejan desde acá; los de la terminal se leen (electron/lider.ts). */
  lider: {
    /** Un líder nuevo con su primer mensaje; devuelve su session_id. */
    nuevo(x: { modelo: string; effort: string; texto: string; imagenes?: Imagen[]; modo?: string; rol?: "analista"; carpeta?: string; cuenta?: string }): Promise<string>;
    /** `empezar: "resumen"`: sesión fresca con el relevo compacto (caché vencida); devuelve el sid del líder nuevo si lo hubo. */
    mandar(x: { sid: string; texto: string; imagenes?: Imagen[]; modelo: string; effort: string; empezar?: "resumen" }): Promise<string | null>;
    mandarYa(x: { sid: string; texto: string; imagenes?: Imagen[]; modelo: string; effort: string }): Promise<void>;
    /** Guarda un archivo adjunto (no imagen) y devuelve su ruta absoluta. */
    archivo(x: { nombre: string; datos: Uint8Array }): Promise<string>;
    parar(sid: string): Promise<void>;
    /** Cambiar el modo de permisos (vivo: `set_permission_mode`; dormido: para el próximo `--resume`). */
    modo(x: { sid: string; modo: string }): Promise<void>;
    cuenta(x: { sid: string; cuenta: string }): Promise<void>;
    /** Contestar un pedido de permiso (`can_use_tool`): permitir, o negar con un mensaje para el modelo. */
    permiso(x: { sid: string; id: string; ok: boolean; mensaje?: string; respuestas?: Record<string, string> }): Promise<void>;
    /** Los pedidos sin contestar de un líder (una vista recargada no los vio llegar), sin validar. */
    pendientes(sid: string): Promise<unknown>;
    /** Los slash commands que dijo la última sesión, sin validar. */
    comandos(): Promise<unknown>;
    /** Los output styles (`{ actual, lista }`) que dijo la última sesión, sin validar. */
    estilos(): Promise<unknown>;
    /** `/output-style`: "vivo" si ya se aplicó, "pendiente" si va al próximo líder que arranque. */
    estilo(x: { sid: string; estilo: string }): Promise<unknown>;
    /** Cerrar uno de la app: termina su proceso y lo saca de lideres.json. */
    cerrar(sid: string, motivo?: string): Promise<void>;
    /** Retomar uno sin proceso: pasa a ser de la app, sin lanzar nada. `{ ok }` o `{ ok: false, motivo }`, sin validar. */
    retomar(x: { sid: string; modelo: string; effort: string; nombre?: string }): Promise<unknown>;
    /**
     * Editar / Volver acá: sigue desde el mensaje `uuid` con `texto` (electron/lider.ts, `rebobinar`). Devuelve `null`, o el sid
     * del líder nuevo si el punto era anterior a una compactación (`previa`): ahí se sigue en una copia, no en el mismo líder.
     */
    rebobinar(x: { sid: string; uuid: string; texto: string; imagenes?: unknown; modelo: string; effort: string; previa?: boolean }): Promise<string | null>;
    /** Ramificar: un líder nuevo con la conversación hasta el mensaje `uuid`; devuelve su sid. */
    ramificar(x: { sid: string; uuid: string; modelo: string; effort: string }): Promise<string>;
    /** Su transcript con la forma de `pa --hilo --json`, sin validar. */
    conversacion(x: { sid: string; antes?: number | null }): Promise<unknown>;
    /** Mirar el transcript de uno (el abierto) o de ninguno. */
    mirar(sid: string | null): Promise<void>;
    /** El usuario abrió esa conversación (o le escribió): el líder deja de esperarlo. */
    visto(sid: string): Promise<void>;
    /** Traer a la app uno abierto en una terminal (cierra ese `claude`): `{ ok }` o `{ ok: false, motivo }`. */
    traer(x: { sid: string; modelo: string; effort: string; nombre?: string; modo?: string; cortar?: boolean }): Promise<unknown>;
    /** "Ir a la ventana": `false` si no se la pudo ubicar. */
    ir(pid: number): Promise<boolean>;
    /** ¿Se puede ubicar la ventana de ese proceso? */
    ubicable(pid: number): Promise<boolean>;
    /** A la cola del líder (electron/cola.ts): sale cuando quede libre. */
    encolar(x: { sid: string; texto: string; imagenes?: Imagen[]; modelo: string; effort: string; modo?: string; nombre?: string }): Promise<void>;
    /** Lo elegido en la caja mientras hay cola: el mensaje que sale lleva lo vigente en ese momento. */
    colaSeleccion(x: { sid: string; modelo: string; effort: string }): Promise<void>;
    colaQuitar(x: { sid: string; id: number }): Promise<void>;
    /** Todas las colas con algo, sin validar. */
    colas(): Promise<unknown>;
    /** Ahora: reintenta lo que había fallado y, con `cortar`, corta al de la terminal. */
    colaYa(x: { sid: string; cortar?: boolean }): Promise<void>;
    /** Cambió la cola de un líder (`AvisoCola`), sin validar. */
    alCola(fn: (x: unknown) => void): Soltar;
    alEvento(fn: (x: { sid: string; e: EventoLider }) => void): Soltar;
    alTranscript(fn: (sid: string) => void): Soltar;
  };
  /** Los paneles del pie (Ajustes, Estadísticas, acciones de Ramas): ver src/datos/paneles.ts. */
  paneles: {
    ajustes(): Promise<unknown>;
    /** Los proyectos con `lecciones.necesita-poda` (electron/orquestacion.ts), sin validar. */
    leccionesPendientes(): Promise<unknown>;
    /** La instrucción de `pa <proy> --lecciones-podar` para que un agente reescriba las lecciones. */
    /** La limpieza de worktrees y ramas viejos de `pa`: la config, guardarla, lo que se quitaría y quitarlo (limpieza-pa.ts). */
    limpieza(): Promise<unknown>;
    guardarLimpieza(cambio: { auto?: boolean; dias?: number }): Promise<unknown>;
    verLimpieza(dias: number): Promise<unknown>;
    aplicarLimpieza(dias: number): Promise<unknown>;
    textoPoda(slug: string): Promise<string>;
    leerLecciones(slug: string): Promise<string>;
    /** Guarda lecciones.md; devuelve `{ necesitaPoda }`. */
    guardarLecciones(slug: string, texto: string): Promise<unknown>;
    /** `pa <proy> --auditar <id> -m … --async`; no rechaza si `pa` falla: devuelve su código y lo último que dijo. */
    auditar(x: { id: string; proyecto: string; modelo: string }): Promise<{ rc: number; dijo: string }>;
    /** `pa <proy> --agents-md`: la plantilla si falta el archivo, y la ruta del proyecto. */
    agentsMd(slug: string): Promise<unknown>;
    /** Unificar instrucciones (electron/unificar-md.ts): el estado de CLAUDE/GEMINI/AGENTS.md, el plan, aplicarlo (con la huella del plan visto) y editar AGENTS.md. */
    mdEstado(slug: string): Promise<unknown>;
    mdPlan(slug: string): Promise<unknown>;
    mdAplicar(slug: string, huella: string): Promise<unknown>;
    mdFusionar(slug: string, tipo?: "acortar" | "fusionar"): Promise<{ rc: number; dijo: string }>;
    leerAgents(slug: string): Promise<string>;
    guardarAgents(slug: string, texto: string): Promise<unknown>;
    /** Los umbrales del anillo de contexto (`{ autoCompact }`, electron/contexto.ts), sin validar. */
    umbralContexto(): Promise<unknown>;
    medicion(): Promise<unknown>;
    /** El registro histórico (electron/historial.ts) de los últimos 7 o 30 días, de todos o de un rol; sin validar. */
    historial(dias: number, rol: string | null): Promise<unknown>;
    /** Lo último que se midió del peso de arrancar (electron/arranque.ts), o `null` si nunca; sin validar. */
    arranqueMedido(): Promise<unknown>;
    /** Mide ahora el peso exacto de arrancar (cuatro pedidos cortos a `claude`); nunca rechaza; sin validar. */
    medirArranque(): Promise<unknown>;
    /** No rechaza si `pa` falla: devuelve su código de salida y lo último que dijo. */
    rama(accion: string, h: { id: string; proyecto: string }): Promise<{ rc: number; dijo: string }>;
    /** Lanza un worker de rama (`pa --actualizar … -m … --effort … --tipo …`); no rechaza si `pa` falla: devuelve su código y lo último que dijo. */
    lanzar(x: { accion: string; id: string; proyecto: string; modelo: string; effort: string; texto?: string }): Promise<{ rc: number; dijo: string }>;
    /** Reescribe las filas de worker de la tabla de routing de `~/CLAUDE.md`; devuelve cómo quedó o el error. */
    routing(cambios: { rol: string; modelo: string | null; effort: string | null }[]): Promise<unknown>;
    /** La config de modelos (`~/.config/trama/modelos.json`) con la tabla efectiva de `pa --modelos --json` si existe; sin validar. */
    modelos(): Promise<unknown>;
    /** Lo que `pa --modelos --json` dice que corre hoy (y lo que elegiría `reparto`): tarda, por eso va aparte de `modelos`. `null` sin `pa` o con uno viejo. */
    efectivoModelos(): Promise<unknown>;
    /** Guarda esa config (atómico; rechaza con el motivo sin escribir) (sólo `modelos.json`; las filas de `~/CLAUDE.md` no se tocan: eso es `routing`); devuelve cómo quedó. */
    guardarModelos(config: unknown): Promise<unknown>;
    /** Pregunta a un Ollama (`GET <url>/api/tags`) qué modelos tiene; nunca rechaza por no contestar. */
    sondearOllama(url: string): Promise<unknown>;
    /** Empieza a bajar un modelo de Ollama (`/api/pull`); el progreso llega por `alBajar`. Rechaza con el motivo (sólo desde la PC). */
    bajarModelo(url: string, modelo: string): Promise<unknown>;
    cancelarBajada(url: string, modelo: string): Promise<void>;
    /** Las bajadas en curso o terminadas desde que arrancó el motor. */
    bajadas(): Promise<unknown>;
    /** Qué hay en esta máquina para Ollama: si está instalado, la distro, la GPU con su VRAM y los comandos de instalar y arrancar; sólo lee. */
    entornoOllama(): Promise<unknown>;
    /** DeepSeek Harness: si está instalado (y su versión), qué API keys hay (nunca el valor) y cómo instalarlo. */
    estadoDsh(): Promise<unknown>;
    /** `npm i -g @deepseek-ai/dsh`; rechaza con el motivo. Devuelve el estado de después. Sólo desde la PC. */
    instalarDsh(): Promise<unknown>;
    /** Guarda (o borra, con `null`) una API key en `claves.env`; devuelve el estado. Sólo desde la PC. */
    claveDsh(nombre: string, valor: string | null): Promise<unknown>;
    /** Prueba un proveedor (`opencode`, `deepseek`, `ollama`) con la key guardada; nunca rechaza por no contestar. */
    probarDsh(proveedor: string, url?: string): Promise<unknown>;
    /** Conectores: lo que ve un líder de ese motor (`claude mcp list` + los propios de Trama). Tarda con Claude (prueba cada servidor). */
    estadoMcp(x: { motor: string; local?: boolean; fresco?: boolean }): Promise<unknown>;
    /** Los servidores MCP propios de Trama (nunca los valores, sólo si hay). */
    listaMcp(): Promise<unknown>;
    /** Agrega o reemplaza uno; los valores secretos van a `claves.env`. Devuelve la lista. Sólo desde la PC. */
    guardarMcp(entrada: unknown): Promise<unknown>;
    quitarMcp(nombre: string): Promise<unknown>;
    /** Los nombres de los conectores que Claude Code apagó para el proyecto del líder (`disabledMcpServers` de la cuenta activa). */
    apagadosMcp(): Promise<unknown>;
    /** Apaga (`true`) o prende uno de esos conectores; escribe sólo esa clave del proyecto. Devuelve la lista nueva. Sólo desde la PC. */
    fijarApagadoMcp(nombre: string, apagado: boolean): Promise<unknown>;
    /** Todo lo que tiene conectado Claude Code (skills, plugins, MCP, hooks), sin secretos. */
    inventarioConectores(): Promise<unknown>;
    /** Prende o apaga un plugin o un servidor de `.mcp.json`; devuelve el inventario nuevo. */
    alternarConector(id: string, activo: boolean): Promise<unknown>;
    /** Panel de contexto: en qué se va el contexto de un líder o de un worker (`Desglose`, electron/contexto-desglose.ts). */
    desgloseContexto(x: { lider: string } | { worker: string }): Promise<unknown>;
    /** Las skills instaladas, buscables (`q`), con tokens y estado (`Catalogo`, electron/contexto-panel.ts). Con `sid` de un líder vivo, tokens exactos. */
    catalogoSkills(x?: { q?: string; sid?: string }): Promise<unknown>;
    /** El apagado global de Trama (`VistaApagados`). */
    leerApagados(): Promise<unknown>;
    /** Apaga o prende una skill, un servidor MCP, una herramienta o un archivo de memoria para todo Trama. Sólo desde la PC. */
    fijarApagado(tipo: "skills" | "mcp" | "herramientas" | "memoria", nombre: string, apagado: boolean): Promise<unknown>;
    /** Los catálogos de plugins de Claude Code (los oficiales de Anthropic y los que se agregaron) con lo que traen. */
    catalogosPlugins(): Promise<unknown>;
    /** `claude plugin marketplace add <usuario/repo>` con la cuenta elegida (vacío: la de siempre); devuelve los catálogos. Sólo desde la PC. */
    agregarCatalogoPlugins(repo: string, cuenta?: string): Promise<unknown>;
    /** `claude plugin install <plugin>@<catálogo>`; devuelve los catálogos. Sólo desde la PC. */
    instalarPlugin(plugin: string, catalogo: string, cuenta?: string): Promise<unknown>;
    /** `claude plugin uninstall <plugin>@<catálogo>`; devuelve los catálogos. Sólo desde la PC. */
    quitarPlugin(plugin: string, catalogo: string, cuenta?: string): Promise<unknown>;
    /** `reparto --tabla --json`: cada modelo que reparto conoce con su inteligencia, cupo y si está permitido; `null` sin `reparto` o con uno viejo. */
    repartoTabla(): Promise<unknown>;
    /** Artificial Analysis: si hay key (nunca el valor) y de cuándo es la caché de inteligencias. */
    estadoAA(): Promise<unknown>;
    /** Baja la lista de Artificial Analysis ahora (ignora el día de vigencia); devuelve qué pasó y cómo quedó la caché. Sólo desde la PC. */
    refrescarAA(): Promise<unknown>;
    /** OpenCode (el programa `opencode`): instalado, versión, login y cuántos modelos ofrece. */
    estadoOpencode(): Promise<unknown>;
    /** Vuelve a listar los modelos (`opencode models --refresh`); rechaza con el motivo. Devuelve el estado de después. */
    actualizarOpencode(): Promise<unknown>;
    /** OpenCode Go (plan pago, apagado por defecto): el plan elegido y los topes por modelo. */
    planOpencode(): Promise<unknown>;
    /** Elige el plan (`gratis` | `go` | `go-plus`; sólo desde la PC) y devuelve la vista de después. */
    guardarPlanOpencode(plan: string): Promise<unknown>;
    /** NVIDIA NIM (gratis): si hay clave (el valor nunca viaja), los modelos que ofrece reparto y el tope por minuto. */
    estadoNvidia(): Promise<unknown>;
    /** Guarda qué modelos de NIM se ofrecen (sólo desde la PC); devuelve el estado de después o rechaza con el motivo. */
    guardarModelosNvidia(lista: string[]): Promise<unknown>;
    /** Una llamada mínima con la clave guardada (sólo desde la PC); nunca rechaza por no contestar. */
    probarNvidia(): Promise<unknown>;
    alBajar(fn: (b: unknown) => void): Soltar;
    /** Artificial Analysis terminó de bajar de fondo y la tabla de «Modelos para workers» tiene datos nuevos. */
    alTablaNueva(fn: () => void): Soltar;
    /** Escribe el plan (`pa --plan`) y/o la red de seguridad (`autoCompactWindow`); rechaza con el motivo; devuelve Ajustes como quedó. */
    guardarAjustes(cambio: { plan?: string; red_seguridad?: number | null }): Promise<unknown>;
    /** El acceso desde el celular (`remoto.json`) y dónde está escuchando; por la tailnet, `{ editable: false }`. */
    remoto(): Promise<unknown>;
    /** Guarda el acceso desde el celular y deja el servidor como dice; rechaza con el motivo (nada se escribe). */
    guardarRemoto(config: { activo: boolean; puerto: number; dispositivos: string[] }): Promise<unknown>;
    /** El brief del analista de Ramas (B22): commits, archivos, edad y líder de cada rama; el texto lo arma src/datos/analista.ts. */
    brief(
      hs: {
        id: string;
        proyecto: string;
        rama: string;
        estado: string;
        commits: number;
        tarea: string;
        resultado: string | null;
        decision: string | null;
        fin: number;
        jefe_id: string | null;
      }[],
    ): Promise<RamaBrief[]>;
    /** Lo que lleva el primer mensaje de "Pasárselo a un líder" (lo de arriba más la DECISION entera); el texto lo arma src/datos/asistente.ts. */
    pasar(h: {
      id: string;
      proyecto: string;
      rama: string | null;
      commits: number;
      tarea: string;
      resultado: string | null;
      decision: string | null;
    }): Promise<DatosPasar>;
    /** Lo de "Pasárselo" más cómo terminó y si el proyecto tiene `tests` (Retomar, B22; el texto, src/datos/retomar.ts). */
    retomar(h: {
      id: string;
      proyecto: string;
      rama: string | null;
      commits: number;
      tarea: string;
      resultado: string | null;
      decision: string | null;
      estado: string;
    }): Promise<DatosPasar & { estado: string; tests: boolean }>;
  };
  /** La salud de lo integrado (B25, electron/salud.ts), sin validar. */
  salud: {
    leer(): Promise<unknown>;
    /** Lo que lleva "Mandar a verificar y arreglar" (electron/paneles.ts, `arreglarDatos`); el texto, src/datos/arreglar.ts. */
    arreglar(h: { id: string; proyecto: string; rama: string | null }): Promise<unknown>;
    alCambiar(fn: (e: unknown) => void): Soltar;
  };
  /** "Integrar solo lo seguro" de Ramas (B22, electron/autointegrar.ts), sin validar. */
  auto: {
    leer(): Promise<unknown>;
    prender(si: boolean): Promise<void>;
    alCambiar(fn: (e: unknown) => void): Soltar;
  };
  /** El aviso de Claude Code nuevo: `null` si no hay (o no se pudo saber). */
  claude: {
    version(): Promise<unknown>;
    /** Dismiss: hasta que salga otra. */
    descartar(): Promise<void>;
    /** `claude update`: `{ ok, version | error, abiertos }`, sin validar. */
    actualizar(): Promise<unknown>;
    /** Relanza (al próximo mensaje, `--resume`) los líderes de la app que no responden: `{ reiniciados, ocupados }`. */
    reiniciar(): Promise<unknown>;
    /** Abre el CHANGELOG en el navegador. */
    changelog(): Promise<void>;
    alCambiar(fn: (a: unknown) => void): Soltar;
  };
  /** El aviso de Antigravity CLI (`agy`) nuevo: `null` si no hay, no se pudo saber o `agy` no está instalado. */
  agy: {
    version(): Promise<unknown>;
    descartar(): Promise<void>;
    /** Actualizar: abre una terminal con paru y espera a que la cierren: `{ ok, version | error }`, sin validar. */
    actualizar(): Promise<unknown>;
    alCambiar(fn: (a: unknown) => void): Soltar;
  };
  /** El aviso de "hay una Trama nueva": `null` si no hay, no se pudo saber o esta instalación no viene de un checkout. */
  trama: {
    version(): Promise<unknown>;
    /** "Check for updates" de Ajustes: consulta ya, `{ ultima, nueva }` sin validar. */
    buscar(): Promise<unknown>;
    descartar(): Promise<void>;
    /** Las notas de la Trama nueva en el navegador del sistema: sólo si la URL es de github.com (electron/ventana-canales.ts). */
    notas(url: string): Promise<void>;
    /** Actualizar (git + instalador, en el main) en el modo "ya" o "esperar" a que no haya nada ocupado: `{ ok, version | error }` al arrancar, sin validar. El avance es `actualizacion`. */
    actualizar(modo: "ya" | "esperar"): Promise<unknown>;
    cancelarEspera(): Promise<void>;
    /** Reconocer el "instalada" o el error. */
    limpiar(): Promise<void>;
    /** En qué anda Actualizar (`{ fase, version | error }`, sin validar) y qué cortaría hoy (`{ lideres, workers, otras, leyendo }`). */
    actualizacion(): Promise<unknown>;
    ocupacion(): Promise<unknown>;
    /** Reinicia el proceso de la ventana (sólo la ventana de la PC; en el navegador no existe). */
    reiniciarVentana?(): Promise<void>;
    /** Actualizar seguro (sólo la ventana de la PC): la versión anterior guardada a la que se puede volver, o `null`; volver a ella; y el aviso de que se volvió sola, que se gasta al leerlo. Sin validar. */
    anterior?(): Promise<unknown>;
    volverAnterior?(): Promise<unknown>;
    avisoVuelta?(): Promise<unknown>;
    alCambiar(fn: (a: unknown) => void): Soltar;
    alCambiarActualizacion(fn: (e: unknown) => void): Soltar;
  };
  /** Lo que falta del setup (Handy, agy, Ollama, el login): `{ version, faltas: [{ id, url }] }`, sin validar. */
  setup: {
    estado(): Promise<unknown>;
    descartar(id: string): Promise<void>;
  };
  /** Si Claude y Gemini (agy) están conectados: `{ version, claude, agy }` con `{ instalado, logueado, cuenta, error }`, sin validar. */
  cuentas: {
    estado(): Promise<unknown>;
    /** Las cuentas del CLI `cuentas` (`{version,cuentas}` o `null` sin él), sin validar; `verificar` pregunta el login (lento). */
    lista(verificar: boolean): Promise<unknown>;
    agregar(proveedor: string, nombre: string): Promise<unknown>;
    renombrar(id: string, nombre: string): Promise<unknown>;
    quitar(id: string, borrarCredenciales: boolean): Promise<unknown>;
    login(id: string): Promise<unknown>;
    plan(id: string, plan: string): Promise<unknown>;
    /** Deja a esa cuenta como la que se usa primero en su proveedor (`cuentas preferir`). */
    preferir(id: string): Promise<unknown>;
  };
  /** Por la tailnet (el celular): `false` cuando se cae la conexión con la PC, `true` al volver. En la ventana no avisa nunca. */
  conexion: {
    alCambiar(fn: (conectado: unknown) => void): Soltar;
  };
  /** El tablero de pendientes del usuario (electron/tablero.ts): `leer`, sin validar; el resto corre el CLI `tablero`. */
  tablero: {
    leer(): Promise<unknown>;
    // Un id con prefijo (`servidor:12`) es de un item de otra máquina: el main manda la acción a su tablero.
    mover(id: number | string, columna: string): Promise<void>;
    cerrar(id: number | string): Promise<void>;
    tirar(id: number | string): Promise<void>;
    posponer(id: number | string, hasta: string): Promise<void>;
    agregar(texto: string, proyecto: string | null, maquina?: string): Promise<unknown>;
    /** `tablero responder <id>`: la respuesta queda en el item (`null`: la saca). Ver electron/tablero.ts, `RespuestaCli`. */
    responder(id: number | string, r: unknown): Promise<void>;
    /** Cuántos esperan al usuario sin respuesta (el número del botón del pie), sin validar; `null` si no hay vista. */
    esperan(): Promise<unknown>;
    alCambiar(fn: () => void): Soltar;
  };
  /** Lo que el usuario tocó en el tablero nuevo y todavía no mandó (electron/pendientes.ts), sin validar. */
  pendientes: { leer(): Promise<unknown>; guardar(x: unknown): Promise<void> };
  /** Quién está compactando su contexto (electron/compactando.ts): id → epoch (s) desde cuándo, sin validar. */
  compactando: { leer(): Promise<unknown>; alCambiar(fn: (c: unknown) => void): Soltar };
  /** Los subagentes de cada sesión con proceso (electron/subagentes.ts): sesión → lista, sin validar; y el informe entero de uno. */
  subagentes: { leer(): Promise<unknown>; informe(sid: string, id: string): Promise<string | null>; alCambiar(fn: (x: unknown) => void): Soltar };
  pintado(): void;
  /** Cerrar del todo (Ctrl+Q, la bandeja) con lo elegido en el diálogo. Con líderes respondiendo y sin `forzar` no hace nada: devuelve cuántos son. Por la tailnet no existe. */
  salir(x: { modo: "seguir" | "parar"; forzar: boolean }): Promise<number>;
  /** La bandeja del sistema: sus textos traducidos, y el pedido de "Cerrar del todo" desde su menú. */
  bandeja?: { textos(t: { abrir: string; cerrar: string }): Promise<void>; alPedirSalida(fn: () => void): Soltar };
  /** "Te espera" en la pantalla de la PC: el número en la bandeja, la notificación y el toque a la notificación. Por la tailnet no existe. */
  espera?: {
    estado(x: { n: number; texto: string }): Promise<void>;
    notificar(x: { sid: string; titulo: string; cuerpo: string }): Promise<void>;
    alAbrir(fn: (sid: string) => void): Soltar;
  };
  /** El texto del portapapeles leído por el main (respaldo del Ctrl+V de la caja). El objeto existe también en el navegador, pero ahí el canal se rechaza: usalo sólo si `esVentana()`. */
  portapapeles?: { texto(): Promise<string> };
  /** El selector nativo de carpetas (campo "Carpeta" de un líder nuevo): la ruta o `null` si se canceló. El objeto existe también en el navegador, pero ahí el canal se rechaza: mostralo sólo si `esVentana()`. */
  carpeta?: { elegir(): Promise<string | null> };
  /** El selector nativo de una imagen para el logo de un proyecto: la imagen achicada a 64 px (data URL) o `null` si se canceló. Como `carpeta`: sólo con `esVentana()`. */
  archivo?: { elegirLogo(): Promise<string | null>; /** Abre el archivo con la app del sistema; `false` si no se pudo. */ abrir(ruta: string): Promise<boolean> };
  /** Vuelve a cargar la ventana (el cartel de error); por la tailnet no existe. */
  recargar?(): Promise<void>;
  /** Un error del renderer, al log del main (src/errores.ts). */
  bitacora?(x: { donde: string; detalle: string }): Promise<void>;
  /** Qué máquinas hay y cómo están (electron/nucleo.ts `estadoMaquinas`), sin validar: la barra pone el ícono y el "sin conexión". */
  maquinas: { leer(): Promise<unknown>; alCambiar(fn: (e: unknown) => void): Soltar };
  /** Los modelos que agrega `~/.config/trama/modelos.json` (Gemini, Ollama, el líder por defecto), sin validar; `null` sin el archivo. */
  modelos?: { config(): Promise<unknown> };
  /** El nombre del dueño de la máquina (electron/dueno.ts), sin validar; `null` si no se sabe. */
  dueno?: { nombre(): Promise<unknown> };
  /** El cartel "Hay una actualización disponible": un build de trama más nuevo que el que corre (electron/relanzar.ts), sin validar. */
  reinicio: { leer(): Promise<unknown>; pedir(igual?: boolean): Promise<void>; cancelar(): Promise<void>; marca(paso: string): Promise<void>; alCambiar(fn: (r: unknown) => void): Soltar };
  /** La PC que la otra máquina sabe prender (electron/pc-estado.ts): su estado y Prender; sin PC configurada, `leer` da null. */
  /** Avisos de los workers (electron/avisos-worker.ts): terminó, falló o se colgó (sin validar), y relanzar uno caído por cupo. */
  workers?: { alAviso(fn: (a: unknown) => void): Soltar; relanzar(id: string): Promise<unknown> };
  pc: { leer(): Promise<unknown>; prender(): Promise<unknown>; alCambiar(fn: (e: unknown) => void): Soltar };
  /** Volver como estaba tras ese reinicio (sólo la ventana): lo que tenía abierto y escrito (src/volver.ts). */
  volver: { leer(): Promise<unknown>; guardar(vista: unknown): Promise<void>; alPedir(fn: () => void): Soltar; anotar(vista: unknown): Promise<void> };
  /** Lo escrito sin mandar, en disco (sólo la ventana; electron/borradores.ts). */
  borradores: { leer(): Promise<unknown>; guardar(foto: unknown): Promise<void> };
};

declare global {
  interface Window {
    hilos?: Main;
  }
}

const sinBench: Bench = {
  modo: async () => false,
  listo: async () => 0,
  cpu: async () => null,
  fin: async () => {},
};

// Sin preload (Vite abierto en un navegador) el bench queda apagado y los
// datos son los fixtures (ver MODO.fixtures).
export const bench: Bench = window.hilos?.bench ?? sinBench;
export const main: Main | null = window.hilos ?? null;

/**
 * ¿Es la ventana de Electron (la pantalla de la PC)? El navegador (tailnet o modo local) recibe el mismo objeto `main`,
 * así que lo que es de la ventana (selector de carpetas, portapapeles del sistema, salir…) existe ahí aunque no funcione: se mira esto.
 */
export const esVentana = (): boolean => typeof navigator !== "undefined" && /\bElectron\//.test(navigator.userAgent);

/**
 * Electron envuelve los rechazos del main ("Error invoking remote method 'x': Error: …"): queda sólo
 * el mensaje, traducido si el main lo mandó como clave (`textoMain`).
 */
export const mensaje = (e: unknown) =>
  textoMain(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ""));
