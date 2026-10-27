// Prender y apagar el acceso desde el celular desde Ajustes (canal `remoto:guardar` + remoto-armar.ts) sin reiniciar:
// con un `remoto.json` apagado no se escucha en ninguna IP; al prenderlo escucha en la IP de Tailscale (falsa, en
// 127.0.0.1: nada sale de esta máquina) y al apagarlo deja de escuchar. El estado se lee de lo que el servidor dice.
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-recarga-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const libre = await new Promise<number>((ok) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => ok(p));
  });
});
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
// Arranca apagado, con la lista guardada.
writeFileSync(path.join(estado, "remoto.json"), JSON.stringify({ version: 1, puerto: libre, dispositivos: ["cel"], activo: false }));

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

const nucleo = await import("../electron/nucleo.ts");
const { armarRemoto } = await import("../electron/remoto-armar.ts");

const contesta = () =>
  new Promise<boolean>((ok) => {
    const r = http.get({ host: "127.0.0.1", port: libre, path: "/", headers: { host: "maquina.x.ts.net" }, timeout: 1000 }, (res) => {
      res.resume();
      ok(true);
    });
    r.on("error", () => ok(false));
    r.on("timeout", () => (r.destroy(), ok(false)));
  });

test("apagado no escucha; Ajustes lo prende y lo apaga sin reiniciar", { timeout: 30_000 }, async () => {
  nucleo.armarNucleo();
  const guardar = new Map(nucleo.manejadoresAnotados()).get("remoto:guardar")!;
  const ventana = { sender: {} };
  armarRemoto({ dist: path.join(tmp, "dist"), preload: path.join(tmp, "preload.cjs"), consulta: () => ({}) });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await contesta(), false, "apagado: nada escucha");

  const prendido = (await guardar(ventana, { activo: true, puerto: libre, dispositivos: ["cel"] })) as { escuchando: string[] };
  assert.equal(await contesta(), true, "prendido desde Ajustes: escucha ya");
  assert.deepEqual(prendido.escuchando, [`http://maquina.x.ts.net:${libre}/`]);

  const apagado = (await guardar(ventana, { activo: false, puerto: libre, dispositivos: ["cel"] })) as { activo: boolean; escuchando: string[] };
  assert.equal(await contesta(), false, "apagado desde Ajustes: deja de escuchar");
  assert.deepEqual([apagado.activo, apagado.escuchando], [false, []]);
  // Sin nada más: el proceso de prueba sale.
  setTimeout(() => process.exit(0), 50).unref();
});
