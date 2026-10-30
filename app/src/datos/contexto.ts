// De dónde saca los datos el panel de contexto: el main (`contexto:desglose`, `skills:catalogo`, `apagados:leer`, `apagados:fijar`) o,
// en bench y capturas, los fixtures. Leer anda también por la red (celular); apagar es sólo de la PC.
import { MODO } from "../modo";
import { main, mensaje } from "../puente";
import type { Desglose } from "../../electron/contexto-desglose";
import type { Catalogo, VistaApagados } from "../../electron/contexto-panel";
import { APAGADOS_FALSOS, catalogoFalso, desgloseFalso } from "./fixtures-contexto";
import type { TipoApagado } from "../paneles/contexto-vista";

export type Quien = { lider: string } | { worker: string };
/** Lo que contesta apagar o prender algo: el registro nuevo y qué pasó con los líderes (el aviso es siempre "próximo mensaje"). */
export type Fijado = VistaApagados & { lideres: { reiniciados: number; pendientes: number }; aviso: "proximo-mensaje" };

export type FuenteContexto = {
  desglose(q: Quien): Promise<Desglose>;
  /** Con `sid` de un líder de Claude vivo, los tokens de cada skill son exactos. */
  catalogo(sid?: string): Promise<Catalogo>;
  apagados(): Promise<VistaApagados>;
  fijar(tipo: TipoApagado, nombre: string, apagado: boolean): Promise<Fijado>;
};

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

let apagadosFijo: VistaApagados = structuredClone(APAGADOS_FALSOS);

const fija: FuenteContexto = {
  async desglose(q) {
    await espera(40);
    return desgloseFalso(q);
  },
  async catalogo() {
    await espera(40);
    const c = catalogoFalso();
    // El estado sale del registro, como en el main.
    for (const s of c.skills) if (s.estado !== "plugin-apagado") s.estado = apagadosFijo.apagados.skills.includes(s.clave) ? "apagada" : "activa";
    return c;
  },
  async apagados() {
    await espera(20);
    return structuredClone(apagadosFijo);
  },
  async fijar(tipo, nombre, apagado) {
    await espera(60);
    const l = apagadosFijo.apagados[tipo];
    apagadosFijo = { ...apagadosFijo, apagados: { ...apagadosFijo.apagados, [tipo]: apagado ? [...new Set([...l, nombre])] : l.filter((n) => n !== nombre) } };
    return { ...structuredClone(apagadosFijo), lideres: { reiniciados: 0, pendientes: 0 }, aviso: "proximo-mensaje" };
  },
};

const fallar = (e: unknown): never => {
  throw new Error(mensaje(e));
};

const conMain = (m: NonNullable<typeof main>): FuenteContexto => ({
  async desglose(q) {
    return (await m.paneles.desgloseContexto(q).catch(fallar)) as Desglose;
  },
  async catalogo(sid) {
    return (await m.paneles.catalogoSkills(sid ? { sid } : {}).catch(fallar)) as Catalogo;
  },
  async apagados() {
    return (await m.paneles.leerApagados().catch(fallar)) as VistaApagados;
  },
  async fijar(tipo, nombre, apagado) {
    return (await m.paneles.fijarApagado(tipo, nombre, apagado).catch(fallar)) as Fijado;
  },
});

export const fuenteContexto: FuenteContexto = MODO.fixtures || !main ? fija : conMain(main);
