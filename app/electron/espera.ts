// "Te espera": qué líderes esperan al usuario. Un líder espera si tiene un permiso o una pregunta sin contestar
// (`pide`) o si terminó su turno y quedó ocioso (`listo`). Sin Electron ni reloj: se deriva de lo que ya llega
// (`ocupado` y `pide` de cada lista de líderes) y se apaga cuando el usuario abre esa conversación o le escribe.
// Lo usa nucleo.ts sobre cada lectura del statusline; lo prueba tests/espera.test.ts.
/** Por qué espera y desde cuándo (epoch ms): la misma forma que `EsperaLider` de src/datos/contrato.ts. */
export type EsperaLider = { motivo: "pide" | "listo"; desde: number };

type Visto = { vivo: boolean; ocupado: boolean; pide?: boolean };
type Estado = {
  /** Estaba respondiendo la última vez que se lo vio. */
  ocupado: boolean;
  /** Tenía algo sin contestar la última vez que se lo vio. */
  pide: boolean;
  /** El usuario ya vio el pedido que sigue pendiente: no vuelve a esperar hasta que llegue otro. */
  vistoPide: boolean;
  espera: EsperaLider | null;
};

export function crearEspera(ahora: () => number = Date.now) {
  const estados = new Map<string, Estado>();

  return {
    /**
     * Anota la espera en cada líder de la lista (la pone o la saca; si ya tenía, queda la de antes) y olvida a los
     * que ya no están. `conCola`: los que tienen algo en cola, que sale solo al terminar el turno: no esperan.
     * Un líder visto por primera vez no espera (uno ocioso hace rato no es urgente): hace falta ver su cambio.
     */
    aplicar<L extends { id: string } & Visto & { espera?: EsperaLider }>(lideres: L[], conCola: ReadonlySet<string> = new Set()): void {
      const vistos = new Set<string>();
      for (const l of lideres) {
        vistos.add(l.id);
        const antes = estados.get(l.id);
        const pide = l.vivo && l.pide === true;
        const e: Estado = antes ?? { ocupado: l.ocupado, pide: false, vistoPide: false, espera: null };
        if (!l.vivo) {
          e.espera = null;
        } else if (pide) {
          if (!e.pide) e.vistoPide = false;
          if (e.vistoPide) e.espera = null;
          else if (e.espera?.motivo !== "pide") e.espera = { motivo: "pide", desde: e.espera?.desde ?? ahora() };
        } else if (l.ocupado) {
          // Trabaja otra vez (el usuario le escribió, salió la cola, contestó el pedido): ya no espera.
          e.espera = null;
        } else if (e.ocupado || (e.pide && !e.vistoPide)) {
          // Terminó su turno (o quedó sin el pedido que tenía): espera su respuesta, salvo que lo siga la cola.
          if (conCola.has(l.id)) e.espera = null;
          else if (e.espera?.motivo !== "listo") e.espera = { motivo: "listo", desde: e.espera?.desde ?? ahora() };
        }
        if (!pide) e.vistoPide = false;
        e.ocupado = l.ocupado;
        e.pide = pide;
        estados.set(l.id, e);
        if (e.espera) l.espera = e.espera;
        else delete l.espera;
      }
      for (const sid of estados.keys()) if (!vistos.has(sid)) estados.delete(sid);
    },
    /** El usuario abrió esa conversación o le escribió. `true` si había algo que apagar. */
    visto(sid: string): boolean {
      const e = estados.get(sid);
      if (!e) return false;
      const habia = e.espera !== null;
      e.espera = null;
      if (e.pide) e.vistoPide = true;
      return habia;
    },
    /** Cuántos esperan ahora. */
    cuantos: () => [...estados.values()].filter((e) => e.espera).length,
  };
}

export type Espera = ReturnType<typeof crearEspera>;
