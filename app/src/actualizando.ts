// "Actualizando Trama…": la tarjeta con la barra de pasos que cubre la ventana mientras trama se reinicia por un build
// nuevo. La pinta el script de index.html (`window.__act`), no React: la ventana nueva nace con ella, antes de que
// cargue nada. Los pasos son cosas que pasaron, no un reloj:
//   1 Preparando    la ventana que se va: el motor avisó `saliendo` (guarda lo abierto y cierra a los líderes)
//   2 Reiniciando   el motor ya se fue (la que se va), o el proceso nuevo ya pintó (la que llega, `?actualizando=1`)
//   3 Reconectando  la página montó y falta la primera respuesta del motor
//   4 Cargando      el motor contestó y falta la primera lista de hilos
// y al llegar la lista el cartel se va. Sólo avanza (un paso atrás no existe), y cada paso de la ventana nueva queda
// como marca en electron/reinicio-marcas.ts (`pagina-monto`, `pagina-conecto`, `lista`).
import { fuente } from "./datos/fuente";
import { MODO } from "./modo";
import { main } from "./puente";

export type Pantalla = { paso(n: number, velo: boolean): void; fin(): void };

/** Lo que tarda como mucho el cartel de la ventana que se va: si el reinicio no sale, deja de tapar (el aviso de la barra sigue). */
export const SE_RINDE_MS = 30_000;

export function crearSecuencia(x: { pantalla?: Pantalla; llega: boolean; marca?: (paso: string) => void; seRinde?: (fn: () => void, ms: number) => void }) {
  // La ventana nueva ya muestra el paso 2 desde el primer cuadro (lo pone index.html).
  let n = x.llega ? 2 : 0;
  let hecho = false;
  const ir = (nuevo: number, velo: boolean, marca?: string) => {
    if (hecho || nuevo <= n) return false;
    n = nuevo;
    x.pantalla?.paso(nuevo, velo);
    if (marca && x.llega) x.marca?.(marca);
    return true;
  };
  const terminar = () => {
    if (hecho) return;
    hecho = true;
    x.pantalla?.fin();
  };
  return {
    /** El motor avisó que se va por un build nuevo (la ventana que se va). */
    saliendo() {
      if (!x.llega && ir(1, true)) x.seRinde?.(terminar, SE_RINDE_MS);
    },
    /** Se cortó la conexión con el motor: sólo cuenta si ya había avisado que se iba. */
    motorCaido() {
      if (!x.llega && n >= 1) ir(2, true);
    },
    /** La página de la ventana nueva montó. */
    monto: () => x.llega && ir(3, false, "pagina-monto"),
    /** El motor contestó el primer pedido. */
    conecto: () => x.llega && ir(4, false, "pagina-conecto"),
    /** Llegó la primera lista de hilos: se va el cartel. */
    lista() {
      if (!x.llega || hecho) return;
      x.marca?.("lista");
      terminar();
    },
    paso: () => n,
    terminado: () => hecho,
  };
}

const pantalla = (): Pantalla | undefined => (window as unknown as { __act?: Pantalla }).__act;

const seq = crearSecuencia({
  pantalla: pantalla(),
  llega: MODO.actualizando,
  marca: (paso) => void main?.reinicio?.marca(paso).catch(() => {}),
  seRinde: (fn, ms) => void setTimeout(fn, ms),
});

/** Engancha la secuencia a lo que pasa de verdad (el aviso del motor, la conexión, la primera respuesta). Una sola vez, desde main.tsx. */
export function armarActualizando() {
  // Una captura fija el paso que se quiere ver (`actualizando-1` … `actualizando-4`).
  const c = /^actualizando-([1-4])$/.exec(MODO.captura ?? "");
  if (c) return void pantalla()?.paso(Number(c[1]), Number(c[1]) <= 2);
  fuente.alCambiarReinicio((r) => r.saliendo && seq.saliendo());
  main?.conexion?.alCambiar((ok) => ok === false && seq.motorCaido());
  if (MODO.actualizando) {
    seq.monto();
    void fuente.reinicio().then(() => seq.conecto());
  }
}

/** Se pintó la primera lista de hilos (src/barra/Barra.tsx). */
export const listaLista = () => seq.lista();
