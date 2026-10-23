// Quién es quién en la tailnet, para el acceso remoto (electron/remoto.ts). La identidad no la
// dice el pedido: la dice Tailscale. `tailscale status` cuenta quién es esta máquina (sus IPs, su
// nombre, su dueño) y `tailscale whois <ip>` de qué nodo y de qué usuario es la IP que se conectó
// (la IP de origen dentro de la tailnet la autentica WireGuard: no se puede falsificar).
// Ninguno de los dos pide sudo. Puro salvo `tailnet()`: lo prueba tests/tailnet.test.ts.
import { execFile } from "node:child_process";
import os from "node:os";
import { resolverBinario } from "./binario.ts";

/** Esta máquina en la tailnet. */
export type Yo = {
  /** Sus IPs de Tailscale (v4 y, si hay, v6): sólo en esas se escucha. */
  ips: string[];
  /** Su nombre entero de MagicDNS, sin el punto final. */
  nombre: string;
  /** El sufijo de la tailnet (`<algo>.ts.net`). */
  sufijo: string;
  /** El id del usuario dueño de este nodo. */
  usuario: number;
};

/** El nodo dueño de una IP. */
export type Nodo = { nombre: string; usuario: number; etiquetado: boolean };

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" ? (x as Record<string, unknown>) : null);
const sinPunto = (s: string) => s.replace(/\.$/, "").toLowerCase();

/** `tailscale status --json --peers=false` → esta máquina, o `null` si Tailscale no está andando. */
export function yoDe(json: unknown): Yo | null {
  const d = obj(json);
  const s = obj(d?.Self);
  if (!d || !s || d.BackendState !== "Running") return null;
  const ips = Array.isArray(s.TailscaleIPs) ? s.TailscaleIPs.filter((x): x is string => typeof x === "string") : [];
  const sufijo = typeof d.MagicDNSSuffix === "string" ? sinPunto(d.MagicDNSSuffix) : "";
  if (!ips.length || typeof s.DNSName !== "string" || typeof s.UserID !== "number" || !sufijo) return null;
  return { ips, nombre: sinPunto(s.DNSName), sufijo, usuario: s.UserID };
}

/** `tailscale whois --json <ip>` → el nodo, o `null` si no se entiende. */
export function nodoDe(json: unknown): Nodo | null {
  const n = obj(obj(json)?.Node);
  if (!n || typeof n.Name !== "string" || typeof n.User !== "number") return null;
  return { nombre: sinPunto(n.Name), usuario: n.User, etiquetado: Array.isArray(n.Tags) && n.Tags.length > 0 };
}

/**
 * Sólo el usuario: el nodo es del mismo usuario que esta máquina (uno etiquetado no es de nadie) y es
 * uno de los dispositivos anotados (nombres cortos de la tailnet). Sin lista no entra nadie.
 */
export function permitido(yo: Yo, nodo: Nodo | null, dispositivos: readonly string[]): boolean {
  if (!nodo || nodo.etiquetado || nodo.usuario !== yo.usuario) return false;
  return dispositivos.some((d) => nodo.nombre === `${d.toLowerCase()}.${yo.sufijo}`);
}

/** `::ffff:100.x` → `100.x`; sin zona. */
export const ipLimpia = (ip: string | undefined) => (ip ?? "").replace(/^::ffff:/i, "").replace(/%.*$/, "").toLowerCase();

/** Una IP y nada más (lo que va de argumento a `tailscale whois`). */
export const esIp = (s: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) || (/^[0-9a-f:]{2,39}$/.test(s) && s.includes(":"));

const BIN = resolverBinario("tailscale", "HILOS_TAILSCALE", process.env, os.homedir());
const correr = (args: string[]) =>
  new Promise<unknown>((resolve) => {
    execFile(BIN, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });

/** Cuánto se recuerda de quién es una IP (y que no es de nadie: que insistir no lance procesos). */
const RECUERDA_MS = 60_000;

/** La tailnet de verdad: pregunta con el CLI y recuerda un rato cada respuesta. */
export function tailnet(ahora: () => number = Date.now) {
  const vistos = new Map<string, { nodo: Promise<Nodo | null>; hasta: number }>();
  return {
    yo: async () => yoDe(await correr(["status", "--json", "--peers=false"])),
    quien(ip: string): Promise<Nodo | null> {
      if (!esIp(ip)) return Promise.resolve(null);
      const t = ahora();
      const v = vistos.get(ip);
      if (v && v.hasta > t) return v.nodo;
      if (vistos.size > 500) vistos.clear();
      const nodo = correr(["whois", "--json", ip]).then(nodoDe);
      vistos.set(ip, { nodo, hasta: t + RECUERDA_MS });
      return nodo;
    },
  };
}
