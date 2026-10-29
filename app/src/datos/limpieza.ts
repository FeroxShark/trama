// La limpieza de worktrees y ramas viejos de `pa` (Ajustes > Proyectos, electron/limpieza-pa.ts): la config (pasada automática y días),
// lo que se quitaría y quitarlo. Del main o, en bench y capturas, de fixtures.
import { MODO } from "../modo";
import { main, mensaje } from "../puente";
import { CONFIG_LIMPIEZA_DEFAULT, type ConfigLimpieza, type PlanLimpieza } from "../../electron/limpieza-pa";

export type { ConfigLimpieza, PlanLimpieza };

export interface FuenteLimpieza {
  config(): Promise<ConfigLimpieza>;
  guardar(cambio: Partial<ConfigLimpieza>): Promise<ConfigLimpieza>;
  /** Lo que se quitaría con esa antigüedad. No toca nada. */
  ver(dias: number): Promise<PlanLimpieza>;
  /** Lo quita (después de que se vio la lista y se confirmó). */
  aplicar(dias: number): Promise<PlanLimpieza>;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GB = 1024 ** 3;

const planFalso = (dias: number, aplicado: boolean): PlanLimpieza => ({
  dias,
  aplicado,
  enUso: ["proyecto-demo@2"],
  builds: [{ puesto: "proyecto-demo@3", dir: "target", bytes: 3.4 * GB }],
  worktrees: [
    { puesto: "proyecto-demo@4", dias: dias + 13, bytes: 1.2 * GB },
    { puesto: "proyecto-demo@5", dias: dias + 9, bytes: 0.8 * GB },
  ],
  ramas: [
    { proyecto: "proyecto-demo", rama: "pa/proyecto-demo/20261001-101010-4242", dias: dias + 20, commits: 3 },
    { proyecto: "proyecto-demo", rama: "pa/proyecto-demo/20261002-111111-4343", dias: dias + 19, commits: 0 },
  ],
  bytes: 5.4 * GB,
});

let guardadoFalso: ConfigLimpieza = { ...CONFIG_LIMPIEZA_DEFAULT };
const fija: FuenteLimpieza = {
  async config() {
    return { ...guardadoFalso };
  },
  async guardar(cambio) {
    await espera(100);
    guardadoFalso = { ...guardadoFalso, ...cambio };
    return { ...guardadoFalso };
  },
  async ver(dias) {
    await espera(250);
    return planFalso(dias, false);
  },
  async aplicar(dias) {
    await espera(400);
    if (MODO.falla === "limpieza") throw new Error("pa --limpiar: el candado de git sigue tomado");
    return planFalso(dias, true);
  },
};

const rechazo = (e: unknown): never => {
  throw new Error(mensaje(e));
};

const conMain = (m: NonNullable<typeof main>): FuenteLimpieza => ({
  async config() {
    return (await m.paneles.limpieza().catch(rechazo)) as ConfigLimpieza;
  },
  async guardar(cambio) {
    return (await m.paneles.guardarLimpieza(cambio).catch(rechazo)) as ConfigLimpieza;
  },
  async ver(dias) {
    return (await m.paneles.verLimpieza(dias).catch(rechazo)) as PlanLimpieza;
  },
  async aplicar(dias) {
    return (await m.paneles.aplicarLimpieza(dias).catch(rechazo)) as PlanLimpieza;
  },
});

export const fuenteLimpieza: FuenteLimpieza = MODO.fixtures || !main ? fija : conMain(main);
