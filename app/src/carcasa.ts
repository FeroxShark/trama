// Lo que la carcasa de Windows (`windows/`) le deja a la página de Trama: `window.carcasa`, que su preload expone
// también acá (cuentas y, más abajo, actualizaciones y restos). Fuera del .exe (Linux, el celular) no existe y Ajustes no muestra nada de cuentas. Con
// `HILOS_VARIANTE=cuentas` (captura) se finge una, con Claude conectado y Gemini sin conectar.
import { MODO } from "./modo";

export type Cuenta = { instalado: boolean; logueado: boolean; cuenta?: string | null; error?: string | null };
export type CuentasOk = { claude: Cuenta; agy: Cuenta };
export type Cuentas = CuentasOk | { error: string };
export type Proveedor = "claude" | "gemini";

type Carcasa = {
  /** Qué cuentas están conectadas ahora (`trama-estado` en Ubuntu). */
  cuentas(): Promise<Cuentas>;
  /** Abre una consola de Ubuntu con el CLI del proveedor para iniciar sesión. */
  conectar(proveedor: Proveedor): Promise<{ error?: string } | undefined>;
};

const FALSA: Carcasa = {
  cuentas: async () => ({ claude: { instalado: true, logueado: true }, agy: { instalado: true, logueado: false } }),
  conectar: async () => ({}),
};

export function carcasa(): Carcasa | null {
  if ((MODO.variante ?? "").startsWith("cuentas")) return FALSA;
  const c = (window as unknown as { carcasa?: Partial<Carcasa> }).carcasa;
  return c && typeof c.cuentas === "function" && typeof c.conectar === "function" ? (c as Carcasa) : null;
}

// --- Actualizar y quitar restos de versiones anteriores (Ajustes > Trama para Windows). Las capturas (`HILOS_VARIANTE=carcasa*`) usan una carcasa de mentira. ---

export type EstadoActualizacion = {
  fase: "inactiva" | "buscando" | "al-dia" | "descargando" | "lista" | "error";
  version?: string;
  progreso?: number;
  mensaje?: string;
};

export type ItemResto = {
  id: string;
  ambito: "windows" | "wsl";
  tipo: string;
  ruta: string;
  que: string;
  grupo?: string;
  /** quitar: de Trama, se puede sacar · datos: datos propios de la app (sólo el desinstalador) · ajeno: parece de otro, se deja · queda: compartido, se deja */
  accion: "quitar" | "datos" | "ajeno" | "queda";
  auto?: boolean;
};

export type PlanRestos = { modo: string; version: string; items: ItemResto[] };
export type ResultadoQuitar = { resultados: { id: string; estado: string; detalle?: string }[] };
export type ConError = { error: string; detalle?: string };

export type CarcasaActualiza = {
  version(): Promise<string>;
  actualizacion(): Promise<EstadoActualizacion | null>;
  buscarActualizacion(): Promise<void>;
  reiniciarParaActualizar(): Promise<void>;
  onActualizacion(cb: (e: EstadoActualizacion) => void): void;
  restosPlan(): Promise<PlanRestos | ConError>;
  restosQuitar(ids: string[]): Promise<ResultadoQuitar | ConError>;
};

const v = MODO.variante ?? "";
export const FIXTURE_CARCASA = MODO.captura === "ajustes" && v.startsWith("carcasa");

const PLAN_MUESTRA: PlanRestos = {
  modo: "restos",
  version: "0.2.0",
  items: [
    { id: "win-nativo-app", ambito: "windows", tipo: "carpeta", ruta: "%LOCALAPPDATA%\\trama\\app", que: "El motor de Trama y sus hooks", accion: "quitar", grupo: "motor-nativo" },
    { id: "win-nativo-node", ambito: "windows", tipo: "carpeta", ruta: "%LOCALAPPDATA%\\trama\\node", que: "El Node.js propio de Trama (node.exe)", accion: "quitar", grupo: "motor-nativo" },
    { id: "win-nativo-bin", ambito: "windows", tipo: "carpeta", ruta: "%LOCALAPPDATA%\\trama\\bin", que: "Los comandos de Trama (pa.cmd, trama-estado.cmd…)", accion: "quitar", grupo: "motor-nativo" },
    { id: "win-cache-actualizador", ambito: "windows", tipo: "carpeta", ruta: "%LOCALAPPDATA%\\trama-windows-updater", que: "Un archivo tuyo con el nombre de la caché del actualizador", accion: "ajeno", grupo: "carcasa" },
  ],
};

function carcasaDeMentira(): CarcasaActualiza {
  const estado: EstadoActualizacion =
    v === "carcasa-bajando" ? { fase: "descargando", version: "0.2.0", progreso: 42 } : v === "carcasa-lista" ? { fase: "lista", version: "0.2.0" } : { fase: "al-dia" };
  return {
    version: async () => "0.1.0",
    actualizacion: async () => estado,
    buscarActualizacion: async () => {},
    reiniciarParaActualizar: async () => {},
    onActualizacion: () => {},
    restosPlan: async () => PLAN_MUESTRA,
    restosQuitar: async () => ({ resultados: [] }),
  };
}

/** `null` fuera de la carcasa de Windows. */
export const carcasaActualiza: CarcasaActualiza | null = FIXTURE_CARCASA ? carcasaDeMentira() : ((globalThis as { carcasa?: CarcasaActualiza }).carcasa ?? null);

// El preload registra un solo `ipcRenderer.on` por llamada y no tiene cómo soltarlo: acá se registra una vez y se reparte.
const oyentes = new Set<(e: EstadoActualizacion) => void>();
let enganchado = false;
export function alCambiarActualizacion(cb: (e: EstadoActualizacion) => void): () => void {
  if (carcasaActualiza && !enganchado) {
    enganchado = true;
    carcasaActualiza.onActualizacion((e) => oyentes.forEach((f) => f(e)));
  }
  oyentes.add(cb);
  return () => void oyentes.delete(cb);
}

export const esError = <T>(x: T | ConError): x is ConError => typeof x === "object" && x !== null && "error" in x;
export const comoError = (x: unknown): ConError => ({ error: x instanceof Error ? x.message : String(x) });
