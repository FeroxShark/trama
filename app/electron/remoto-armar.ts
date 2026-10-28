// Prende trama por la tailnet (remoto.ts) y la mantiene prendida: sólo si existe `remoto.json` en el
// estado propio (y no está apagado). En modo local (`TRAMA_LOCAL=1`) además hay siempre un servidor en 127.0.0.1 (el
// navegador de esta máquina, con token): el de la tailnet se suma a ése sólo si Ajustes prendió el acceso del celular. Escucha en las IPs de Tailscale de esta máquina y en ninguna otra; si cambian (Tailscale
// se levantó después, `tailscale down`/`up`, otra IP), cierra lo que tenía y vuelve a escuchar.
// El cambio lo avisa `ip -o monitor address dev tailscale0` (un proceso hijo que espera sin gastar nada);
// de respaldo, cada 5 min se le pregunta a Tailscale. Lo usan main.ts (todo en uno) y motor.ts.
// `remoto.json` se vuelve a leer con cada revisión y cuando Ajustes lo cambia (`recargar`, por el enlace de
// nucleo.ts): prender, apagar, otro puerto o quitar un dispositivo (se cortan sus conexiones) no piden reiniciar.
import { spawn, type ChildProcess } from "node:child_process";
import type http from "node:http";
import path from "node:path";
import { CHANGELOG } from "./actualizacion.js";
import { accesos } from "./celular-accesos.js";
import { identidadEsta } from "./consulta.js";
import { log, silencio } from "./log.js";
import { contarClientes, escuchar, llamarRemoto, ponerEnlaceRemoto, soltarRemoto } from "./nucleo.js";
import { ESTADO } from "./pa.js";
import { crearRemoto, leerConfig } from "./remoto.js";
import { permitido, tailnet } from "./tailnet.js";
import { crearRemotoLocal, IP_LOCAL, modoLocal, puertoLocal } from "./modo-local.js";

/** Cada cuánto se le pregunta a Tailscale por las dudas (y se reintenta escuchar). */
const RESPALDO_MS = 5 * 60_000;
/** Un cambio de dirección trae varias líneas seguidas: se espera a que se calme. */
const CALMA_MS = 1500;

export type OpcionesArmar = {
  /** La carpeta del frontend compilado (`dist/`) y el preload compilado. */
  dist: string;
  preload: string;
  consulta(): Record<string, string>;
};

/**
 * Modo local (`TRAMA_LOCAL=1`, docs/remoto.md): el servidor en 127.0.0.1 y ya, sin Tailscale ni `remoto.json`.
 * Si el puerto está ocupado reintenta (5, 15, 60 s y después cada 5 min); no hay nada que releer.
 * Siempre va aparte del servidor de la tailnet (armarTailnet): otra instancia, otras reglas (token y loopback acá).
 */
function armarLocal(o: OpcionesArmar) {
  const puerto = puertoLocal();
  const url = `http://localhost:${puerto}/`;
  let intentos = 0;
  const ESPERAS = [5, 15, 60];
  const abrir = async () => {
    let remoto: ReturnType<typeof crearRemotoLocal>;
    try {
      remoto = crearRemotoLocal({
        dist: o.dist,
        preload: o.preload,
        // El navegador del modo local es la interfaz principal (ya con el token): puede usar consumo y borradores.
        llamar: (canal, args, cliente, ip) => llamarRemoto(canal, args, cliente, ip, { local: true }),
        consulta: o.consulta,
        identidad: identidadEsta,
        seFue: soltarRemoto,
        changelog: CHANGELOG,
      });
      await remoto.escuchar(puerto);
    } catch (e) {
      const espera = ESPERAS[intentos++] ?? RESPALDO_MS / 1000;
      if (intentos === 1 || intentos === 4) console.error(`[remoto] no se pudo escuchar en ${IP_LOCAL}:${puerto} (${(e as Error).message}): se reintenta`);
      setTimeout(() => void abrir(), espera * 1000).unref();
      return;
    }
    escuchar(remoto.difundir);
    contarClientes(remoto.conectados);
    console.error(`[remoto] ${url} (modo local: sólo ${IP_LOCAL})`);
  };
  void abrir();
}

export function armarRemoto(o: OpcionesArmar) {
  if (modoLocal()) armarLocal(o);
  armarTailnet(o);
}

/** El servidor de la tailnet (el celular): se arma, se rearma y se cierra según `remoto.json` y lo que diga Tailscale. */
function armarTailnet(o: OpcionesArmar) {
  const archivo = path.join(ESTADO, "remoto.json");
  let cfg = leerConfig(archivo);
  const red = tailnet();
  /** `faltan`: las IPs de Tailscale en las que no se pudo escuchar (se reintentan en cada vuelta, aunque la firma no cambie). */
  let actual: { firma: string; urls: string[]; servidores: http.Server[]; quitar: () => void; faltan: string[]; abrir: (ip: string) => Promise<http.Server> } | null = null;
  let intentos = 0;

  function desarmar() {
    if (!actual) return;
    actual.quitar();
    for (const s of actual.servidores) {
      s.close();
      s.closeAllConnections();
    }
    actual = null;
  }

  /** Se pone al día con lo que dice Tailscale. `true` si quedó escuchando. */
  async function armar(): Promise<boolean> {
    const c = (cfg = leerConfig(archivo));
    if (!c) {
      desarmar();
      return true;
    }
    const yo = await red.yo();
    const firma = yo ? JSON.stringify([yo.nombre, [...yo.ips].sort(), c.puerto, c.dispositivos]) : "";
    if (actual?.firma === firma) {
      if (!actual.faltan.length) return true;
      // Sólo se había podido escuchar en alguna de las IPs: se reintentan las que faltan.
      const yaActual = actual;
      const abiertos = await Promise.allSettled(yaActual.faltan.map((ip) => yaActual.abrir(ip)));
      const faltan: string[] = [];
      abiertos.forEach((r, i) => (r.status === "fulfilled" ? yaActual.servidores.push(r.value) : faltan.push(yaActual.faltan[i])));
      if (actual === yaActual) yaActual.faltan = faltan;
      else for (const r of abiertos) if (r.status === "fulfilled") { r.value.close(); r.value.closeAllConnections(); }
      return !faltan.length;
    }
    if (actual) {
      log.escribir("info", "remoto", `cambió la dirección de Tailscale: se vuelve a escuchar (${yo ? yo.ips.join(", ") : "sin Tailscale"})`);
      desarmar();
    }
    if (!yo) return false;
    const remoto = crearRemoto({
      dist: o.dist,
      preload: o.preload,
      nombres: [yo.nombre, yo.nombre.split(".")[0], ...yo.ips.map((ip) => (ip.includes(":") ? `[${ip}]` : ip))],
      propias: yo.ips,
      entra: async (ip) => {
        const nodo = await red.quien(ip);
        const ok = permitido(yo, nodo, c.dispositivos);
        // Quien entró queda anotado para la lista de Ajustes > Celular (sólo nombre, sistema, IP y hora).
        if (ok && nodo) void accesos.anotar(nodo.nombre.slice(0, -(yo.sufijo.length + 1)), nodo.sistema ?? null, nodo.ip ?? null).catch(silencio("remoto"));
        return ok;
      },
      // `tailnet`: aun con el motor en modo local, lo que entra por acá es el celular (no puede lo de la PC).
      llamar: (canal, args, cliente, ip) => llamarRemoto(canal, args, cliente, ip, { tailnet: true }),
      consulta: o.consulta,
      identidad: identidadEsta,
      seFue: soltarRemoto,
      changelog: CHANGELOG,
    });
    const abiertos = await Promise.allSettled(yo.ips.map((ip) => remoto.escuchar(ip, c.puerto)));
    const servidores = abiertos.flatMap((a) => (a.status === "fulfilled" ? [a.value] : []));
    if (!servidores.length) return false;
    const faltan = yo.ips.filter((_, i) => abiertos[i].status === "rejected");
    if (faltan.length) console.error(`[remoto] no se pudo escuchar en ${faltan.join(", ")}: se reintenta`);
    const url = `http://${yo.nombre}:${c.puerto}/`;
    const quitarDifusion = escuchar(remoto.difundir);
    const quitarClientes = contarClientes(remoto.conectados);
    actual = { firma, urls: [url], servidores, quitar: () => (quitarDifusion(), quitarClientes()), faltan, abrir: (ip) => remoto.escuchar(ip, c.puerto) };
    console.error(`[remoto] ${url} (sólo tailnet; dispositivos: ${c.dispositivos.join(", ")})`);
    // Con alguna IP sin abrir devuelve false: el ciclo reintenta pronto en vez de esperar el respaldo de 5 min.
    return !faltan.length;
  }

  // De a una revisión por vez; lo que llega mientras tanto pide otra al terminar, y quien la pidió espera a esa.
  let vuelta: Promise<void> | null = null;
  let otra = false;
  function revisar(): Promise<void> {
    if (vuelta) {
      otra = true;
      return vuelta;
    }
    vuelta = (async () => {
      try {
        do {
          otra = false;
          const ok = await armar().catch((e) => {
            silencio("remoto")(e);
            return false;
          });
          if (!ok && ++intentos === 4) console.error("[remoto] todavía no se puede escuchar en la IP de Tailscale: se reintenta cada 5 min");
          if (ok) intentos = 0;
        } while (otra);
      } finally {
        vuelta = null;
      }
    })();
    return vuelta;
  }

  // El aviso del kernel: cada dirección que entra o sale de tailscale0 es una línea.
  let hijo: ChildProcess | null = null;
  let calma: NodeJS.Timeout | null = null;
  function monitor() {
    if (hijo) return;
    let p: ChildProcess;
    try {
      p = spawn(process.env.HILOS_IP || "ip", ["-o", "monitor", "address", "dev", "tailscale0"], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return;
    }
    hijo = p;
    p.stdout?.on("data", () => {
      if (calma) clearTimeout(calma);
      calma = setTimeout(() => void revisar(), CALMA_MS);
    });
    // Sin `ip` o sin tailscale0 (Tailscale apagado): queda el respaldo, que lo vuelve a lanzar.
    p.once("error", () => {});
    p.once("exit", () => {
      if (hijo === p) hijo = null;
    });
  }
  process.once("exit", () => hijo?.kill());

  // Al arrancar, Tailscale puede no estar listo: se insiste rápido; después, el respaldo cada 5 min.
  const ESPERAS = [0, 5, 15, 60];
  let proximo: NodeJS.Timeout | null = null;
  const ciclo = async () => {
    if (proximo) clearTimeout(proximo);
    proximo = null;
    await revisar();
    // Apagado: ni reloj ni `ip monitor`; vuelve cuando Ajustes lo prenda (`recargar`).
    if (!cfg) {
      hijo?.kill();
      hijo = null;
      return;
    }
    monitor();
    const espera = actual && !actual.faltan.length ? RESPALDO_MS : (ESPERAS[intentos] ?? RESPALDO_MS / 1000) * 1000;
    proximo = setTimeout(() => void ciclo(), espera);
    proximo.unref();
  };
  void ciclo();

  // Ajustes cambió `remoto.json`: se lee de nuevo y el servidor queda como dice (o se cierra, si ahora está apagado).
  ponerEnlaceRemoto({
    async recargar() {
      intentos = 0;
      await ciclo();
    },
    escuchando: () => actual?.urls ?? [],
  });
}
