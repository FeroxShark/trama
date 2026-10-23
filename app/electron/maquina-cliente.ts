// La trama de la PC como cliente del motor de OTRA máquina (el Dell), por TCP en la tailnet: el mismo
// `/rpc` y los mismos eventos (`/eventos`, numerados) de remoto.ts, que es lo que ya sirve cualquier motor
// con `remoto.json`. Es lo que hace ventana-cliente.ts con el socket local, pero sin Electron y para
// una máquina que se puede apagar: en vez de decir "Reconectando" sin parar, tiene tres fases
// (`conectando`, `conectada`, `caida`) y reintenta cada vez más espaciado.
// Quién es: la IP de la PC la autentica Tailscale en el Dell (`tailscale whois`, remoto.ts): acá no se manda
// ninguna credencial. El Dell nunca manda en la PC: este cliente sólo sale, nunca escucha.
// Un cliente de Node no es un navegador y no manda `Origin`, que el `/rpc` de remoto.ts exige (CSRF): lo
// manda él mismo, igual al `Host`, sin aflojar nada del servidor.
// Sin `electron`: lo prueba tests/maquina-cliente.test.ts contra un motor en 127.0.0.x.
import { randomBytes } from "node:crypto";
import http from "node:http";
import { CANAL_SALUDO, compatible, type Acceso, type Saludo } from "./maquinas-contrato.ts";

export { CANAL_SALUDO };

/** Cómo está la conexión con la máquina. `conectando`: todavía no hubo un primer `hola` (o se está reintentando en silencio). */
export type Fase = "conectando" | "conectada" | "caida";

export type EstadoMaquina = {
  fase: Fase;
  /** Lo que dijo el motor al saludar (`maquina:saludo`); `null` si todavía no saludó o no entiende el saludo. */
  saludo: Saludo | null;
  /** `compatible(saludo)`: "si", todo; "leer", otro build (sólo se lo mira); "no", sin saludo o no se entiende. */
  acceso: Acceso;
};

export type OpcionesMaquina = {
  /** La IP de Tailscale de la máquina (a la que se conecta). */
  ip: string;
  puerto: number;
  /** El nombre que el motor acepta en `Host` (uno de sus `nombres`, sin puerto); sin él, la IP. */
  host?: string;
  /** Un evento del motor (lo que difunde `enviar()` allá). */
  alEvento(canal: string, dato: unknown): void;
  /** Cambió la fase o la versión. */
  alCambiar?(e: EstadoMaquina): void;
  /** Se perdió algo que ya no se puede reponer, o el motor es otro (se reinició): hay que releer todo. */
  alResincronizar?(): void;
  /** Cada cuántos ms late el motor (remoto.ts: 20 s); sin latidos 2,5 veces esto, se da por caído. */
  latidoMs?: number;
  /** Cuánto espera un pedido con la máquina caída a que vuelva, antes de fallar. */
  esperaMs?: number;
  /** Cuánto espera el primer `hola` de un intento (un intento colgado no se queda ahí). */
  intentoMs?: number;
  /** La pausa antes de cada reintento, según los fallos seguidos; el último se repite. */
  pausasMs?: number[];
};

export type ClienteMaquina = {
  estado(): EstadoMaquina;
  /** Un canal del motor. Si estaba caído y el pedido no llegó, espera a que vuelva (con tope) y lo intenta una vez más. */
  pedir(canal: string, args?: unknown[]): Promise<unknown>;
  /** Corta todo y no reintenta más. */
  cerrar(): void;
};

/** Reintentos: uno enseguida y callado; después más espaciado, hasta 30 s (un Dell apagado no se golpea cada segundo). */
const PAUSAS_MS = [300, 1000, 2000, 5000, 10_000, 30_000];

/** Errores de conexión que garantizan que el pedido no llegó: se puede reintentar sin hacerlo dos veces. */
const noLlego = (e: unknown) => ["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes((e as NodeJS.ErrnoException)?.code ?? "");

/** Los bytes de un adjunto no entran en JSON: van en base64 y el motor los vuelve a armar (remoto.ts, `$bin`). */
function binarios(this: Record<string, unknown>, k: string, v: unknown) {
  const o = this[k];
  if (o instanceof Uint8Array) return { $bin: Buffer.from(o.buffer, o.byteOffset, o.byteLength).toString("base64") };
  if (o instanceof ArrayBuffer) return { $bin: Buffer.from(o).toString("base64") };
  return v;
}

export function armarClienteMaquina(o: OpcionesMaquina): ClienteMaquina {
  const id = randomBytes(12).toString("hex");
  const latidoMs = o.latidoMs ?? 20_000;
  const esperaMs = o.esperaMs ?? 15_000;
  const intentoMs = o.intentoMs ?? 8000;
  const pausas = o.pausasMs?.length ? o.pausasMs : PAUSAS_MS;
  const nombre = `${o.host ?? o.ip}:${o.puerto}`;
  // Sin keep-alive: un socket viejo que el Dell ya cerró no puede hacer fallar un pedido que sí hubiera llegado.
  const agente = new http.Agent({ keepAlive: false });

  let fase: Fase = "conectando";
  let saludo: Saludo | null = null;
  let fallos = 0;
  let ultimo = "";
  let cerrado = false;
  let guardia: NodeJS.Timeout | undefined;
  let flujo: http.ClientRequest | null = null;
  let esperan: (() => void)[] = [];
  const enVuelo = new Set<http.ClientRequest>();

  const estado = (): EstadoMaquina => ({ fase, saludo, acceso: saludo ? compatible(saludo) : "no" });
  const cambiar = (f: Fase, v: Saludo | null = saludo) => {
    if (f === fase && v === saludo) return;
    fase = f;
    saludo = v;
    o.alCambiar?.(estado());
  };

  const cabeceras = (extra: http.OutgoingHttpHeaders = {}): http.OutgoingHttpHeaders => ({
    host: nombre,
    origin: `http://${nombre}`,
    "x-trama-cliente": id,
    ...extra,
  });

  function pedirUna(canal: string, args: unknown[]): Promise<unknown> {
    return new Promise((ok, mal) => {
      let cuerpo: string;
      try {
        cuerpo = JSON.stringify({ canal, args }, binarios);
      } catch (e) {
        return mal(e);
      }
      const req = http.request(
        { host: o.ip, port: o.puerto, path: "/rpc", method: "POST", agent: agente, headers: cabeceras({ "content-type": "application/json", "content-length": Buffer.byteLength(cuerpo) }) },
        (res) => {
          const partes: Buffer[] = [];
          res.on("data", (b: Buffer) => partes.push(b));
          res.on("error", mal);
          res.on("end", () => {
            enVuelo.delete(req);
            let j: { ok?: boolean; valor?: unknown; error?: string } | null = null;
            try {
              j = JSON.parse(Buffer.concat(partes).toString("utf8"));
            } catch {}
            if (!j) return mal(new Error(`HTTP ${res.statusCode}`));
            if (!j.ok) return mal(new Error(String(j.error)));
            ok(j.valor);
          });
        },
      );
      enVuelo.add(req);
      req.on("error", (e) => {
        enVuelo.delete(req);
        mal(e);
      });
      req.end(cuerpo);
    });
  }

  /** Espera a que vuelva la conexión (con tope); `false` si no volvió. */
  const volver = () =>
    new Promise<boolean>((ok) => {
      if (fase === "conectada") return ok(true);
      if (cerrado) return ok(false);
      const t = setTimeout(() => {
        esperan = esperan.filter((f) => f !== listo);
        ok(false);
      }, esperaMs);
      const listo = () => {
        clearTimeout(t);
        ok(true);
      };
      esperan.push(listo);
    });

  async function pedir(canal: string, args: unknown[] = []): Promise<unknown> {
    if (fase !== "conectada" && !(await volver())) throw new Error("ECONNREFUSED: sin conexión con la otra máquina");
    try {
      return await pedirUna(canal, args);
    } catch (e) {
      if (!noLlego(e)) throw e;
      perdida(false);
      if (!(await volver())) throw e;
      return pedirUna(canal, args);
    }
  }

  const vigilar = (ms: number) => {
    clearTimeout(guardia);
    guardia = setTimeout(() => perdida(true), ms);
  };

  // Un corte suelto se reintenta enseguida y sin decir nada; si sigue, pasa a `caida` y se insiste cada vez
  // más espaciado. El silencio (ni latidos ni respuesta) se declara de una, y corta lo que estaba en vuelo:
  // si la máquina no contesta, ese pedido no va a contestar.
  function perdida(silencioso: boolean) {
    // Sin flujo ya hay un reintento en camino (un pedido que falló mientras tanto no agrega otro).
    if (cerrado || !flujo) return;
    const f = flujo;
    flujo = null;
    f.destroy();
    fallos++;
    if (silencioso || fallos > 1) {
      cambiar("caida", null);
      if (silencioso) for (const r of [...enVuelo]) r.destroy(new Error("ETIMEDOUT: la otra máquina dejó de contestar"));
    } else cambiar("conectando");
    clearTimeout(guardia);
    guardia = setTimeout(conectar, pausas[Math.min(fallos, pausas.length) - 1]);
  }

  /** Un evento entero del flujo (`event`, `id`, `data`). */
  function evento(texto: string) {
    let tipo = "";
    let eid = "";
    let data = "";
    for (const l of texto.split("\n")) {
      const k = l.indexOf(":");
      if (k <= 0) continue;
      const campo = l.slice(0, k);
      const valor = l.slice(k + 1).replace(/^ /, "");
      if (campo === "event") tipo = valor;
      else if (campo === "id") eid = valor;
      else if (campo === "data") data += data ? `\n${valor}` : valor;
    }
    if (eid) ultimo = eid;
    vigilar(latidoMs * 2.5);
    if (tipo === "hola") {
      fallos = 0;
      cambiar("conectada");
      for (const f of esperan.splice(0)) f();
      void saludar();
      return;
    }
    if (tipo === "resinc") {
      // Otro motor (o se perdió algo que ya no se puede reponer): se empieza de nuevo y quien usa esto relee todo.
      ultimo = "";
      o.alResincronizar?.();
      perdida(false);
      return;
    }
    if (tipo || !data) return;
    let m: { c: string; d: unknown };
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof m?.c === "string") o.alEvento(m.c, m.d);
  }

  /** Quién es el motor. Uno que no entiende el saludo (más viejo) o contesta otra cosa queda sin saludo: sin saludo no hay mando. */
  async function saludar() {
    let v: Saludo | null = null;
    try {
      const s = await pedirUna(CANAL_SALUDO, []);
      if (compatible(s) !== "no") v = s as Saludo;
    } catch {}
    if (!cerrado && fase === "conectada") cambiar("conectada", v);
  }

  function conectar() {
    if (cerrado) return;
    const req = http.get(
      { host: o.ip, port: o.puerto, path: `/eventos?c=${id}${ultimo ? `&desde=${encodeURIComponent(ultimo)}` : ""}`, agent: agente, headers: cabeceras() },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return void (flujo === req && perdida(false));
        }
        res.setEncoding("utf8");
        let resto = "";
        res.on("data", (t: string) => {
          resto += t;
          let k: number;
          while ((k = resto.indexOf("\n\n")) >= 0) {
            const uno = resto.slice(0, k);
            resto = resto.slice(k + 2);
            if (flujo === req) evento(uno);
          }
        });
        res.on("close", () => {
          if (flujo === req) perdida(false);
        });
      },
    );
    flujo = req;
    req.on("socket", (s) => s.setKeepAlive(true, 15_000));
    vigilar(Math.min(intentoMs, latidoMs * 2.5));
    req.on("error", () => {
      if (flujo === req) perdida(false);
    });
  }

  conectar();
  return {
    estado,
    pedir,
    cerrar() {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(guardia);
      flujo?.destroy();
      flujo = null;
      for (const r of [...enVuelo]) r.destroy(new Error("cerrado"));
      for (const f of esperan.splice(0)) f();
      agente.destroy();
    },
  };
}
