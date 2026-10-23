// Lo que corre en el navegador cuando trama se abre por red (electron/remoto.ts) y no adentro de
// Electron: arma el mismo `window.hilos` del preload, pero con `fetch` (los pedidos) y Server-Sent
// Events (lo que avisa el main) en vez de IPC. No repite la lista de canales: ejecuta el preload
// de verdad con un `electron` de mentira, así lo que se agregue al preload ya anda por red.
// OJO: `cliente` viaja como texto (`cliente.toString()`): no puede usar nada de afuera de su
// cuerpo (ni imports ni constantes del módulo).

export type ConfigCliente = {
  /** La query que el main le pasa a la ventana (modo, idioma, letra…): el frontend la lee al cargar. */
  query: string;
  /** Lo que abre "ver cambios" del aviso de Claude Code: acá se abre en este navegador, no en la PC. */
  changelog: string;
  /** Cada cuántos ms late el servidor: sin latidos (2,5 veces esto), la conexión se da por caída y se reintenta. */
  latido: number;
};

type Oyente = (e: unknown, dato: unknown) => void;

export function cliente(cfg: ConfigCliente, preload: (require: (m: string) => unknown, exports: object) => void): void {
  const g = globalThis as any;
  if (g.hilos) return;
  g.history.replaceState(null, "", `${g.location.pathname}?${cfg.query}`);

  const azar = (n: number): string => Array.from(g.crypto.getRandomValues(new Uint8Array(n)), (b: number) => b.toString(16).padStart(2, "0")).join("");
  // Por http pelado (sin `tailscale serve`) no es contexto seguro y esto no existe.
  if (!g.crypto.randomUUID) {
    g.crypto.randomUUID = () => {
      const h = azar(16);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    };
  }

  const id = azar(12);
  const oyentes = new Map<string, Set<Oyente>>();
  let es: { close(): void; readyState: number } | null = null;
  let ultimo = "";
  let guardia = 0;
  let abrir = () => {};
  // Los pedidos esperan a que los avisos estén conectados: nada cambia entre leer y empezar a oír.
  const listo = new Promise<void>((r) => (abrir = r));
  g.setTimeout(abrir, 4000);

  // La conexión con la PC: si se cae (trama se relanzó, la PC se reinició, el celular cambió de red)
  // se reintenta sola, sin recargar la página, y la vista lo dice (canal `remoto:conexion`, que no
  // viene del servidor: lo arma este puente; `true` = conectado).
  let caida = false;
  let fallos = 0;
  const avisar = (c: boolean) => {
    if (c === caida) return;
    caida = c;
    oyentes.get("remoto:conexion")?.forEach((f) => f(null, !c));
  };
  const vigilar = (ms: number) => {
    g.clearTimeout(guardia);
    guardia = g.setTimeout(() => perdida(true), ms);
  };
  // Un corte suelto se reintenta enseguida y sin decir nada; si sigue, se avisa y se insiste cada vez
  // más espaciado (hasta 5 s). El silencio (ni latidos ni respuesta) se avisa de una.
  function perdida(silencio: boolean) {
    es?.close();
    es = null;
    fallos++;
    if (silencio || fallos > 1) avisar(true);
    g.clearTimeout(guardia);
    guardia = g.setTimeout(conectar, fallos === 1 ? 300 : Math.min(fallos - 1, 5) * 1000);
  }
  function conectar() {
    es?.close();
    const s = new g.EventSource(`eventos?c=${id}${ultimo ? `&desde=${ultimo}` : ""}`);
    es = s;
    // Hasta el `hola` se espera poco: un intento colgado (sin red) no se queda ahí.
    vigilar(Math.min(8000, cfg.latido * 2.5));
    const visto = (ev: { lastEventId?: string }) => {
      if (ev.lastEventId) ultimo = ev.lastEventId;
      vigilar(cfg.latido * 2.5);
    };
    s.addEventListener("hola", (ev: { lastEventId?: string }) => {
      visto(ev);
      fallos = 0;
      avisar(false);
      abrir();
    });
    s.addEventListener("latido", visto);
    // Un 502 (trama no está: lo contesta `tailscale serve`) cierra el EventSource para siempre, y un
    // error de red lo deja reintentando a su ritmo: en los dos casos se lo cierra y se reintenta acá.
    s.onerror = () => {
      if (es === s) perdida(false);
    };
    // Se perdió algo que ya no se puede reponer (o trama se reinició): se empieza de nuevo.
    s.addEventListener("resinc", () => g.location.reload());
    s.onmessage = (ev: { data: string; lastEventId?: string }) => {
      visto(ev);
      let m: { c: string; d: unknown };
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      oyentes.get(m.c)?.forEach((f) => f(null, m.d));
    };
  }
  conectar();
  // Al volver a la pestaña (el celular la durmió) no se espera al próximo latido.
  g.document.addEventListener("visibilitychange", () => {
    if (g.document.visibilityState === "visible" && es?.readyState !== 1) conectar();
  });
  // Un pedido que no llegó a trama: los avisos tampoco están llegando, aunque todavía no se note.
  const sospechar = () => {
    if (es && !caida && !fallos) perdida(false);
  };

  const b64 = (u: Uint8Array) => {
    let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000) as unknown as number[]);
    return g.btoa(s);
  };
  // Los bytes de un adjunto no entran en JSON: van en base64 y el servidor los vuelve a armar.
  const binarios = (_k: string, v: unknown) =>
    v instanceof Uint8Array ? { $bin: b64(v) } : v instanceof ArrayBuffer ? { $bin: b64(new Uint8Array(v)) } : v;

  const ipcRenderer = {
    async invoke(canal: string, ...args: unknown[]): Promise<unknown> {
      // Lo que es de la ventana de la PC no se pide: salir de trama, el bench y abrir el navegador de allá.
      if (canal === "app:salir") return 0;
      if (canal === "bench:modo") return false;
      if (canal.startsWith("bench:")) return null;
      if (canal === "claude:changelog") return void g.open(cfg.changelog, "_blank", "noopener");
      await listo;
      const r = await g
        .fetch("rpc", {
          method: "POST",
          headers: { "content-type": "application/json", "x-trama-cliente": id },
          body: JSON.stringify({ canal, args }, binarios),
        })
        .catch((e: unknown) => {
          sospechar();
          throw e;
        });
      const j = await r.json().catch(() => null);
      if (!j && r.status >= 502 && r.status <= 504) sospechar();
      if (!j) throw new Error(`HTTP ${r.status}`);
      if (!j.ok) throw new Error(String(j.error));
      return j.valor;
    },
    on(canal: string, f: Oyente) {
      let s = oyentes.get(canal);
      if (!s) oyentes.set(canal, (s = new Set()));
      s.add(f);
      // El que llega tarde (la vista monta después) se entera de que ya estaba caída.
      if (canal === "remoto:conexion" && caida) f(null, false);
    },
    off(canal: string, f: Oyente) {
      oyentes.get(canal)?.delete(f);
    },
    send() {},
  };
  const contextBridge = { exposeInMainWorld: (clave: string, api: unknown) => void (g[clave] = api) };
  preload(() => ({ contextBridge, ipcRenderer }), {});
}
