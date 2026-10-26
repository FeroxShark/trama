// Quién entró hace poco por la tailnet, para la lista de Ajustes > Celular. Cada pedido de un dispositivo anotado en `remoto.json`
// que Tailscale reconoce (tailscale whois, electron/tailnet.ts) deja acá su nombre corto, su sistema (android, iOS…), su IP de
// tailnet y cuándo fue, en `$HILOS_STATE/celular-accesos.json`. Sólo eso: nada del contenido de lo que pidió. Se escribe al
// primer acceso, si algo cambió y, mientras sigue usando trama, una vez por minuto como mucho. Lo que no entra hace un mes se
// va solo, y al quitar un dispositivo de la lista (remoto:guardar) se olvida el suyo. Sin `electron`: lo prueba tests/celular-accesos.test.ts.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { silencio } from "./log.js";
import { ESTADO, escribirAtomico } from "./pa.js";

export type Acceso = {
  /** El nombre corto del dispositivo en la tailnet (el de `remoto.json`). */
  nombre: string;
  /** `Hostinfo.OS` según Tailscale (android, iOS, windows…), si lo dice. */
  sistema: string | null;
  /** Su IP de tailnet, si Tailscale la dice. */
  ip: string | null;
  /** Cuándo fue el último pedido (epoch, milisegundos). */
  visto: number;
};

export const ARCHIVO_ACCESOS = path.join(ESTADO, "celular-accesos.json");
/** Cada cuánto se reescribe el archivo por un dispositivo que sigue entrando. */
export const ESCRIBE_CADA_MS = 60_000;
/** Cuánto se recuerda un dispositivo que no volvió. */
export const RECUERDA_MS = 30 * 24 * 3600_000;
const TOPE = 50;

const texto = (x: unknown, largo: number): string | null => (typeof x === "string" && x && x.length <= largo ? x : null);

export function crearAccesos(archivo = ARCHIVO_ACCESOS, ahora: () => number = Date.now) {
  let mapa: Map<string, Acceso> | null = null;
  const escrito = new Map<string, number>();
  let cargando: Promise<Map<string, Acceso>> | null = null;

  const cargar = () =>
    (cargando ??= (async () => {
      const m = new Map<string, Acceso>();
      try {
        const j = JSON.parse(await readFile(archivo, "utf8")) as { version?: unknown; dispositivos?: unknown };
        if (j?.version === 1 && Array.isArray(j.dispositivos))
          for (const d of j.dispositivos as Record<string, unknown>[]) {
            const nombre = texto(d?.nombre, 63);
            if (nombre && typeof d.visto === "number" && Number.isFinite(d.visto)) m.set(nombre, { nombre, sistema: texto(d.sistema, 20), ip: texto(d.ip, 45), visto: d.visto });
          }
      } catch {
        // Sin archivo (o roto): se empieza de cero.
      }
      // Lo que anotó un pedido mientras se leía gana sobre lo del disco.
      for (const [k, v] of mapa ?? []) m.set(k, v);
      return (mapa = m);
    })());

  const vigentes = (m: Map<string, Acceso>) => [...m.values()].filter((a) => ahora() - a.visto < RECUERDA_MS).sort((a, b) => b.visto - a.visto).slice(0, TOPE);
  const guardar = (m: Map<string, Acceso>) => escribirAtomico(archivo, JSON.stringify({ version: 1, dispositivos: vigentes(m) }, null, 2) + "\n").catch(silencio("celular-accesos"));

  return {
    /** Un pedido de `nombre` (ya reconocido por Tailscale y anotado en `remoto.json`). */
    async anotar(nombre: string, sistema: string | null, ip: string | null): Promise<void> {
      const m = await cargar();
      const t = ahora();
      const antes = m.get(nombre);
      const nuevo: Acceso = { nombre, sistema, ip, visto: t };
      m.set(nombre, nuevo);
      const cambio = !antes || antes.sistema !== sistema || antes.ip !== ip;
      if (cambio || t - (escrito.get(nombre) ?? 0) >= ESCRIBE_CADA_MS) {
        escrito.set(nombre, t);
        await guardar(m);
      }
    },
    /** Los dispositivos que entraron en el último mes, el más reciente primero. */
    async leer(): Promise<Acceso[]> {
      return vigentes(await cargar());
    },
    /** Deja sólo los de `conservar`: lo de un dispositivo quitado de la lista no queda. */
    async olvidar(conservar: readonly string[]): Promise<void> {
      const m = await cargar();
      const ok = new Set(conservar.map((c) => c.toLowerCase()));
      let cambio = false;
      for (const k of [...m.keys()])
        if (!ok.has(k.toLowerCase())) {
          m.delete(k);
          escrito.delete(k);
          cambio = true;
        }
      if (cambio) await guardar(m);
    },
  };
}

/** El de esta corrida (el de remoto-armar.ts y el de Ajustes). */
export const accesos = crearAccesos();
