// El acceso del celular con el motor en modo local (TRAMA_LOCAL=1, lo que instala el producto): el servidor de 127.0.0.1
// sigue siendo el de siempre y, si Ajustes prende el acceso, se suma el de la tailnet (sólo las IPs de Tailscale, las reglas de
// remoto.json) sin reiniciar. Con un `tailscale` falso (la "IP de Tailscale" es 127.0.0.1: nada sale de esta máquina) y
// `process.platform` simulado para Windows donde hace falta. Ver docs/remoto.md.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-celular-local-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const libre = () =>
  new Promise<number>((ok) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => ok(p));
    });
  });
const puertoTailnet = await libre();
const puertoLocal = await libre();

const tailscale = path.join(tmp, "tailscale");
writeFileSync(
  tailscale,
  `#!/bin/sh
[ "$1" = status ] || exit 1
printf '{"BackendState":"Running","MagicDNSSuffix":"x.ts.net.","Self":{"TailscaleIPs":["127.0.0.1"],"DNSName":"maquina.x.ts.net.","UserID":1}}'
`,
);
const ip = path.join(tmp, "ip-falso");
writeFileSync(ip, "#!/bin/sh\nexec sleep 600\n");
chmodSync(tailscale, 0o755);
chmodSync(ip, 0o755);
const estado = path.join(tmp, "estado");
mkdirSync(estado);
mkdirSync(path.join(tmp, "dist"));
writeFileSync(path.join(tmp, "dist", "index.html"), '<html><head><script type="module" src="./a.js"></script></head><body>trama</body></html>');
writeFileSync(path.join(tmp, "preload.cjs"), '"use strict";\n');

process.env.HOME = path.join(tmp, "home");
process.env.HILOS_STATE = estado;
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = path.join(tmp, "pa");
process.env.HILOS_PA = path.join(import.meta.dirname, "..", "scripts", "pa-falso.sh");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_HISTORIAL = "0";
process.env.HILOS_TAILSCALE = tailscale;
process.env.HILOS_IP = ip;
process.env.TRAMA_LOCAL = "1";
process.env.TRAMA_TOKEN = "0";
process.env.TRAMA_PUERTO = String(puertoLocal);

const nucleo = await import("../electron/nucleo.ts");
const { armarRemoto } = await import("../electron/remoto-armar.ts");
nucleo.armarNucleo();
const fn = (c: string) => new Map(nucleo.manejadoresAnotados()).get(c)!;
const ventana = { sender: {} };

/** El código HTTP que contesta ese puerto de 127.0.0.1 con ese `Host`, o 0 si no hay nadie. */
const codigo = (puerto: number, host: string) =>
  new Promise<number>((ok) => {
    const r = http.get({ host: "127.0.0.1", port: puerto, path: "/", headers: { host }, timeout: 1500 }, (res) => {
      res.resume();
      ok(res.statusCode ?? 0);
    });
    r.on("error", () => ok(0));
    r.on("timeout", () => (r.destroy(), ok(0)));
  });
async function hasta(cond: () => Promise<boolean>, ms = 10_000) {
  const fin = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > fin) throw new Error("no llegó");
    await new Promise((r) => setTimeout(r, 100));
  }
}
const conPlataforma = async <T>(plataforma: string, cuerpo: () => Promise<T>): Promise<T> => {
  const antes = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: plataforma });
  try {
    return await cuerpo();
  } finally {
    Object.defineProperty(process, "platform", antes);
  }
};

test("modo local: sin remoto.json sólo hay 127.0.0.1; Ajustes prende la tailnet al guardar y la apaga sin reiniciar", { timeout: 40_000 }, async () => {
  armarRemoto({ dist: path.join(tmp, "dist"), preload: path.join(tmp, "preload.cjs"), consulta: () => ({}) });
  await hasta(async () => (await codigo(puertoLocal, "localhost")) !== 0);
  assert.equal(await codigo(puertoTailnet, "maquina.x.ts.net"), 0, "apagado: la tailnet no abre nada");

  // El navegador local (la carcasa de Windows) lee y guarda; es editable porque hay Tailscale.
  const nav = { remoto: "pc", ip: "127.0.0.1", navegador: true };
  const leido = (await fn("remoto:leer")(nav)) as { editable: boolean; activo: boolean };
  assert.deepEqual([leido.editable, leido.activo], [true, false]);
  const g = (await fn("remoto:guardar")(nav, { activo: true, puerto: puertoTailnet, dispositivos: ["celu"] })) as { escuchando: string[] };
  assert.deepEqual(g.escuchando, [`http://maquina.x.ts.net:${puertoTailnet}/`]);
  // Escucha en la IP de Tailscale (aquí falsa), con las reglas de siempre: quien no es un dispositivo anotado recibe 403.
  assert.equal(await codigo(puertoTailnet, "maquina.x.ts.net"), 403);
  assert.equal(await codigo(puertoTailnet, "otro.com"), 403, "Host ajeno");
  // Y lo local sigue como estaba: 127.0.0.1 con su Host, sin mirar remoto.json.
  assert.equal(await codigo(puertoLocal, "localhost"), 200);
  assert.equal(await codigo(puertoLocal, "maquina.x.ts.net"), 403, "el servidor local no acepta el nombre de la tailnet");

  await fn("remoto:guardar")(nav, { activo: false, puerto: puertoTailnet, dispositivos: ["celu"] });
  assert.equal(await codigo(puertoTailnet, "maquina.x.ts.net"), 0, "apagado desde Ajustes: se cierra en el acto");
  assert.equal(await codigo(puertoLocal, "localhost"), 200);
});

test("modo local: el celular (servidor de la tailnet) no cambia ajustes ni el acceso; el navegador local sí", async () => {
  const celular = (canal: string, args: unknown[]) => nucleo.llamarRemoto(canal, args, "cel", "100.64.0.9", { tailnet: true });
  await assert.rejects(celular("ajustes:guardar", [{ plan: "pro" }]), /main\.soloPc/);
  await assert.rejects(celular("modelos:sondear", ["http://127.0.0.1:1"]), /main\.modelosSoloPc/);
  await assert.rejects(celular("remoto:guardar", [{ activo: true, puerto: puertoTailnet, dispositivos: ["celu", "otro"] }]), /main\.remotoSoloPc/);
  assert.deepEqual(await celular("remoto:leer", []), { version: 1, editable: false });
  // Una IP que no es loopback tampoco es de acá, aunque el pedido no venga marcado.
  await assert.rejects(nucleo.llamarRemoto("remoto:guardar", [{ activo: true, puerto: puertoTailnet, dispositivos: ["celu"] }], "cel", "100.64.0.9"), /main\.remotoSoloPc/);
  // El navegador local (marcado por modo-local) sí.
  const local = (await nucleo.llamarRemoto("remoto:leer", [], "pc", "127.0.0.1", { local: true })) as { editable: boolean };
  assert.equal(local.editable, true);
  await assert.rejects(nucleo.llamarRemoto("ajustes:guardar", [{ plan: "oro" }], "pc", "127.0.0.1", { local: true }), /main\.ajustesPlan/, "llega a validar");
  // `remoto:guardar` nunca acepta 0.0.0.0 ni un `host`, tampoco desde la PC.
  const nav = { remoto: "pc", ip: "127.0.0.1", navegador: true };
  await assert.rejects(fn("remoto:guardar")(nav, { activo: true, puerto: puertoTailnet, dispositivos: ["0.0.0.0"] }));
  await assert.rejects(fn("remoto:guardar")(nav, { activo: true, puerto: puertoTailnet, dispositivos: ["celu"], host: "0.0.0.0" }));
});

test("sin Tailscale: la PC recibe cómo instalarlo (según la plataforma); el celular, nada", async () => {
  const antes = process.env.HILOS_TAILSCALE;
  const antesPath = process.env.PATH;
  process.env.HILOS_TAILSCALE = "";
  process.env.PATH = "";
  try {
    for (const plataforma of ["win32", "linux"] as const) {
      const r = await conPlataforma(plataforma, () => fn("remoto:leer")(ventana) as Promise<unknown>);
      assert.deepEqual(r, { version: 1, editable: false, sinTailscale: plataforma });
    }
    assert.deepEqual(await fn("remoto:leer")({ remoto: "pc", ip: "127.0.0.1", navegador: true }), { version: 1, editable: false, sinTailscale: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux" });
    assert.deepEqual(await nucleo.llamarRemoto("remoto:leer", [], "cel", "100.64.0.9", { tailnet: true }), { version: 1, editable: false });
  } finally {
    process.env.HILOS_TAILSCALE = antes;
    process.env.PATH = antesPath;
  }
});

// Sin nada más: el proceso de prueba sale (los servidores y el `ip` falso siguen vivos).
test("fin", () => void setTimeout(() => process.exit(0), 100).unref());
