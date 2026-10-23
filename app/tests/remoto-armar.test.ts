// electron/remoto-armar.ts: trama por la tailnet se rearma sola si cambia la IP de Tailscale. Con un
// `tailscale` falso (la IP sale de un archivo, en 127.0.0.x: nada sale de esta máquina) y un `ip monitor`
// falso que avisa un cambio a los 2 s: escucha en la primera IP, y tras el aviso en la nueva y no en la vieja.
import { test, after } from "node:test";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-rearme-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const libre = await new Promise<number>((ok) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => ok(p));
  });
});
const ipArchivo = path.join(tmp, "ip");
writeFileSync(ipArchivo, "127.0.0.1");
const tailscale = path.join(tmp, "tailscale");
writeFileSync(
  tailscale,
  `#!/bin/sh
[ "$1" = status ] || exit 1
printf '{"BackendState":"Running","MagicDNSSuffix":"x.ts.net.","Self":{"TailscaleIPs":["%s"],"DNSName":"maquina.x.ts.net.","UserID":1}}' "$(cat '${ipArchivo}')"
`,
);
const ip = path.join(tmp, "ip-falso");
writeFileSync(ip, "#!/bin/sh\nsleep 2\necho '5: tailscale0    inet 127.0.0.2/32'\nexec sleep 600\n");
chmodSync(tailscale, 0o755);
chmodSync(ip, 0o755);
const estado = path.join(tmp, "estado");
mkdirSync(estado);
writeFileSync(path.join(estado, "remoto.json"), JSON.stringify({ version: 1, puerto: libre, dispositivos: ["cel"] }));

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

const { armarRemoto } = await import("../electron/remoto-armar.ts");

/** ¿Contesta HTTP en esa IP? (403: no es un dispositivo anotado; alcanza con que escuche). */
const contesta = (host: string) =>
  new Promise<boolean>((ok) => {
    const r = http.get({ host, port: libre, path: "/", headers: { host: "maquina.x.ts.net" }, timeout: 1000 }, (res) => {
      res.resume();
      ok(true);
    });
    r.on("error", () => ok(false));
    r.on("timeout", () => (r.destroy(), ok(false)));
  });

async function hasta(cond: () => Promise<boolean>, ms = 15_000) {
  const fin = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > fin) throw new Error("no llegó");
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("cambia la IP de Tailscale: se deja la vieja y se escucha en la nueva", { timeout: 30_000 }, async () => {
  armarRemoto({ dist: path.join(tmp, "dist"), preload: path.join(tmp, "preload.cjs"), consulta: () => ({}) });
  await hasta(() => contesta("127.0.0.1"));
  assert.equal(await contesta("127.0.0.2"), false);
  writeFileSync(ipArchivo, "127.0.0.2");
  await hasta(() => contesta("127.0.0.2"));
  assert.equal(await contesta("127.0.0.1"), false);
  // Sin nada más: el proceso de prueba sale (el hijo `ip` se mata al salir).
  setTimeout(() => process.exit(0), 50).unref();
});
