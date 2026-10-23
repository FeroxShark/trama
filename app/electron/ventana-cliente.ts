// La ventana como cliente del motor (electron/motor.ts): cuando el motor responde en el socket local
// (electron/local.ts) y `dueno` lo confirma, este proceso no arma núcleo, cola, líderes ni remoto. Cada
// canal del núcleo se anota en el IPC y se reenvía al `/rpc` del socket; lo que el motor difunde llega
// por `/eventos` (Server-Sent Events, numerados) y sale a la ventana con `webContents.send`.
// Los de la pantalla de la PC (salir, volver, ir a la ventana, changelog, íconos, bench, captura) se
// resuelven acá (ventana-canales.ts, bench.ts, main.ts).
// Si el motor se va (se reinicia, lo matan) se reintenta solo, cada vez más espaciado (hasta 5 s), y la
// vista dice "Reconectando" (canal `remoto:conexion`, el mismo del celular: src/Conexion.tsx). Un motor
// nuevo (otra época) contesta `resinc` y la página se recarga: se pone al día sola.
import { ipcMain } from "electron";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { cerrarDelTodo } from "./cierre.js";
import { log, silencio } from "./log.js";
import { armarCanalesVentana, iconosVentana, ventanas } from "./ventana-canales.js";

/** El pedido del socket que devuelve los canales del núcleo (`CANALES` en nucleo.ts; acá no se carga el núcleo). */
const CANALES = "local:canales";
/** Lo que se resuelve en la ventana aunque el motor lo tenga: los íconos con `nativeImage`, y los errores del renderer van a `ventana.log`. */
const PROPIOS = new Set(["proyectos:iconos", "bitacora:escribir"]);
/** El motor late cada 20 s (remoto.ts); sin latido 2,5 veces eso, la conexión se da por caída. */
const LATIDO_MS = 20_000;
/** Cuánto espera un pedido hecho con el motor caído a que vuelva, antes de fallar. */
const ESPERA_MS = 15_000;

export type Cliente = {
  /** Si está conectado ahora (para quien carga la página: si está caída, se lo dice enseguida). */
  caida(): boolean;
};

/** Un error de conexión que garantiza que el pedido no llegó: se puede reintentar sin hacerlo dos veces. */
const noLlego = (e: unknown) => ["ECONNREFUSED", "ENOENT", "EAGAIN"].includes((e as NodeJS.ErrnoException)?.code ?? "");

/** Los bytes de un adjunto no entran en JSON: van en base64 y el motor los vuelve a armar (remoto.ts, `$bin`). */
function binarios(this: Record<string, unknown>, k: string, v: unknown) {
  const o = this[k];
  if (o instanceof Uint8Array) return { $bin: Buffer.from(o.buffer, o.byteOffset, o.byteLength).toString("base64") };
  if (o instanceof ArrayBuffer) return { $bin: Buffer.from(o).toString("base64") };
  return v;
}

/**
 * Se conecta al motor y anota los canales. Devuelve cuando ya están anotados (antes de crear la ventana:
 * un pedido sin manejador fallaría). `recargar` vuelve a cargar la página (un motor nuevo).
 * Con un build nuevo el motor avisa `saliendo` (el cartel, `reinicio:cambio`): `motorSaliendo` anota cómo estaba la
 * ventana y, cuando contesta el motor nuevo, `motorNuevo` relanza el proceso en vez de sólo recargar la página.
 */
export async function armarCliente(o: { sock: string; recargar: () => void; irse: () => void; motorSaliendo?: () => void; motorNuevo?: () => void }): Promise<Cliente> {
  const id = randomBytes(12).toString("hex");
  let conectado = false;
  let caida = false;
  let fallos = 0;
  let ultimo = "";
  let motorSeVa = false;
  let relanzando = false;
  let guardia: NodeJS.Timeout | undefined;
  let flujo: http.ClientRequest | null = null;
  let esperan: (() => void)[] = [];
  const anotados = new Set<string>();

  const avisar = (c: boolean) => {
    if (c === caida) return;
    caida = c;
    log.escribir(c ? "aviso" : "info", "cliente", c ? "se perdió el motor: reconectando" : "motor de vuelta");
    for (const v of ventanas()) v.webContents.send("remoto:conexion", !c);
  };

  function pedirUna(canal: string, args: unknown[]): Promise<unknown> {
    return new Promise((ok, mal) => {
      let cuerpo: string;
      try {
        cuerpo = JSON.stringify({ canal, args }, binarios);
      } catch (e) {
        return mal(e);
      }
      const req = http.request(
        { socketPath: o.sock, path: "/rpc", method: "POST", headers: { "content-type": "application/json", "x-trama-cliente": id, "content-length": Buffer.byteLength(cuerpo) } },
        (res) => {
          const partes: Buffer[] = [];
          res.on("data", (b: Buffer) => partes.push(b));
          res.on("error", mal);
          res.on("end", () => {
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
      req.on("error", mal);
      req.end(cuerpo);
    });
  }

  /** Espera a que vuelva la conexión (con tope); `false` si no volvió. */
  const volver = () =>
    new Promise<boolean>((ok) => {
      if (conectado) return ok(true);
      const t = setTimeout(() => {
        esperan = esperan.filter((f) => f !== listo);
        ok(false);
      }, ESPERA_MS);
      const listo = () => {
        clearTimeout(t);
        ok(true);
      };
      esperan.push(listo);
    });

  /** Un pedido al motor. Si el motor no estaba (el pedido no llegó), espera a que vuelva y lo intenta una vez más. */
  async function pedir(canal: string, args: unknown[]): Promise<unknown> {
    if (!conectado && !(await volver())) throw new Error("ECONNREFUSED: sin conexión con el motor de trama");
    try {
      return await pedirUna(canal, args);
    } catch (e) {
      if (!noLlego(e)) throw e;
      perdida(false);
      if (!(await volver())) throw e;
      return pedirUna(canal, args);
    }
  }

  /** Anota en el IPC los canales del motor que todavía no están (uno nuevo llega con un motor nuevo). */
  async function anotar() {
    const canales = (await pedirUna(CANALES, [])) as string[];
    for (const c of canales) {
      if (anotados.has(c) || PROPIOS.has(c)) continue;
      anotados.add(c);
      ipcMain.handle(c, (_e, ...args: unknown[]) => pedir(c, args));
    }
  }

  const vigilar = (ms: number) => {
    clearTimeout(guardia);
    guardia = setTimeout(() => perdida(true), ms);
  };

  // Un corte suelto se reintenta enseguida y sin decir nada; si sigue, se avisa y se insiste cada vez más
  // espaciado (hasta 5 s). El silencio (ni latidos ni respuesta) se avisa de una.
  function perdida(silencioso: boolean) {
    // Sin flujo ya hay un reintento en camino (un pedido que falló mientras tanto no agrega otro).
    if (!flujo) return;
    // El motor avisó que se iba y se fue: esta ventana no espera al motor nuevo para irse, así los dos arrancan a la vez
    // (la ventana nueva espera al motor nuevo, electron/main.ts `esperarMotorNuevo`).
    if (motorSeVa && o.motorNuevo && !relanzando) {
      relanzando = true;
      log.escribir("info", "cliente", "el motor se fue por un build nuevo: se relanza la ventana sin esperarlo");
      o.motorNuevo();
    }
    const f = flujo;
    flujo = null;
    f.destroy();
    conectado = false;
    fallos++;
    if (silencioso || fallos > 1) avisar(true);
    clearTimeout(guardia);
    guardia = setTimeout(conectar, fallos === 1 ? 300 : Math.min(fallos - 1, 5) * 1000);
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
    vigilar(LATIDO_MS * 2.5);
    if (tipo === "hola") {
      fallos = 0;
      conectado = true;
      avisar(false);
      for (const f of esperan.splice(0)) f();
      void anotar().catch(silencio("cliente"));
      return;
    }
    if (tipo === "resinc") {
      // Otro motor (o se perdió algo que ya no se puede reponer): se empieza de nuevo, y la página se pone al día.
      ultimo = "";
      if (motorSeVa && o.motorNuevo) {
        if (!relanzando) {
          relanzando = true;
          log.escribir("info", "cliente", "motor nuevo tras un build: se relanza la ventana");
          o.motorNuevo();
        }
        return;
      }
      log.escribir("info", "cliente", "motor nuevo: se recarga la página");
      o.recargar();
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
    if (m.c === "reinicio:cambio" && (m.d as { saliendo?: unknown } | null)?.saliendo === true && !motorSeVa) {
      motorSeVa = true;
      log.escribir("info", "cliente", "el motor se va por un build nuevo");
      o.motorSaliendo?.();
    }
    for (const v of ventanas()) v.webContents.send(m.c, m.d);
  }

  function conectar() {
    const req = http.get({ socketPath: o.sock, path: `/eventos?c=${id}${ultimo ? `&desde=${encodeURIComponent(ultimo)}` : ""}` }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return perdida(false);
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
    });
    flujo = req;
    // Hasta el `hola` se espera poco: un intento colgado no se queda ahí.
    vigilar(8000);
    req.on("error", () => {
      if (flujo === req) perdida(false);
    });
  }

  // Lo de la pantalla de la PC. Cerrar y dejar que sigan es irse sólo la ventana: los líderes y los workers viven en el motor y no se
  // cortan. Cerrar y parar todo se lo pide al motor (`app:pararTodo`: sus workers y sus líderes) y, si no quedó nadie respondiendo, se va la ventana.
  armarCanalesVentana((x) =>
    cerrarDelTodo(x, {
      hacer: async (modo, forzar) => (modo === "parar" ? Number(await pedir("app:pararTodo", [forzar])) || 0 : 0),
      irse: o.irse,
    }),
  );
  ipcMain.handle("proyectos:iconos", () => iconosVentana());
  ipcMain.handle("bitacora:escribir", (_e, x: { donde?: unknown; detalle?: unknown }) => {
    const donde = String(x?.donde ?? "?").slice(0, 60);
    log.escribir("error", `renderer/ventana ${donde}`, String(x?.detalle ?? "").slice(0, 8192));
  });

  await anotar();
  conectar();
  log.escribir("info", "cliente", `ventana cliente del motor (${o.sock})`);
  return { caida: () => caida };
}
