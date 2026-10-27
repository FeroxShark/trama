// electron/motor.ts de punta a punta, con los fakes y todo en un tmp (HOME incluido): contesta por el
// socket, anota `dueno`, un segundo motor sale con 3, quien se reconecta con `desde` recibe lo que se
// perdió, y SIGTERM guarda lo que esperaba (los leídos), suelta el socket y `dueno`, y sale con 0.
// Corre como Node (con el hook que lleva los `.js` al `.ts`), igual que con ELECTRON_RUN_AS_NODE.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const raiz = path.join(import.meta.dirname, "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-motor-"));
const estado = path.join(tmp, "estado");
const run = path.join(tmp, "run");
const sock = path.join(run, "trama", "motor.sock");
mkdirSync(run, { mode: 0o700 });
mkdirSync(path.join(tmp, "build"));
const gancho = path.join(tmp, "gancho.mjs");
writeFileSync(
  gancho,
  `import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
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
`,
);

const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: path.join(tmp, "home"),
  XDG_RUNTIME_DIR: run,
  HILOS_STATE: estado,
  HILOS_SESIONES: path.join(tmp, "sesiones"),
  CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
  PA_STATE: path.join(tmp, "pa"),
  PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
  HILOS_PA: path.join(raiz, "scripts", "pa-falso.sh"),
  HILOS_CLAUDE: path.join(raiz, "scripts", "claude-falso.mjs"),
  HILOS_TABLERO: "/bin/false",
  HILOS_TAILSCALE: "/bin/false",
  HILOS_HISTORIAL: "0",
  HILOS_BUILD: path.join(tmp, "build"),
};

const vivos = new Set<ChildProcess>();
after(() => {
  for (const p of vivos) p.kill("SIGKILL");
  rmSync(tmp, { recursive: true, force: true });
});

function lanzar(): { p: ChildProcess; salida: Promise<number | null>; err: () => string } {
  const p = spawn(process.execPath, ["--import", gancho, path.join(raiz, "electron", "motor.ts")], { env, stdio: ["ignore", "ignore", "pipe"] });
  vivos.add(p);
  let err = "";
  p.stderr!.on("data", (d) => (err += d));
  const salida = new Promise<number | null>((ok) => p.once("exit", (c) => (vivos.delete(p), ok(c))));
  return { p, salida, err: () => err };
}

async function hasta(cond: () => boolean, ms = 15_000) {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) throw new Error("no llegó");
    await new Promise((r) => setTimeout(r, 50));
  }
}

function rpc(canal: string, args: unknown[]): Promise<{ ok: boolean; valor?: unknown; error?: string }> {
  return new Promise((ok, mal) => {
    const r = http.request({ socketPath: sock, path: "/rpc", method: "POST", headers: { "content-type": "application/json", "x-trama-cliente": "c0ffee01" } }, (res) => {
      let t = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (t += d));
      res.on("end", () => ok(JSON.parse(t)));
    });
    r.on("error", mal);
    r.end(JSON.stringify({ canal, args }));
  });
}

function oir(ruta: string, listo: (t: string) => boolean): Promise<{ texto: string; cortar(): void }> {
  return new Promise((ok, mal) => {
    const r = http.get({ socketPath: sock, path: ruta }, (res) => {
      let t = "";
      res.setEncoding("utf8");
      res.on("data", (d) => {
        t += d;
        if (listo(t)) ok({ texto: t, cortar: () => r.destroy() });
      });
    });
    r.on("error", mal);
  });
}

test("el motor contesta por el socket, retoma eventos con desde y SIGTERM guarda", { timeout: 60_000 }, async () => {
  const a = lanzar();
  await hasta(() => existsSync(sock) && existsSync(path.join(estado, "dueno")));

  const dueno = JSON.parse(readFileSync(path.join(estado, "dueno"), "utf8"));
  assert.equal(dueno.pid, a.p.pid);
  assert.equal(typeof dueno.procStart, "string");

  // Un canal del núcleo, y uno de la ventana que también vive acá (por red no se puede).
  const leidos = await rpc("leidos:leer", []);
  assert.deepEqual(leidos, { ok: true, valor: {} });
  assert.equal((await rpc("borradores:leer", [])).ok, true);
  assert.match(String((await rpc("app:salir", [false])).error), /canal desconocido/);

  // Otro motor no arranca: el socket es el candado.
  const b = lanzar();
  assert.equal(await b.salida, 3);
  assert.ok(existsSync(sock), "el segundo no le borró el socket al primero");

  // Eventos: se corta, pasa algo, y al volver con `desde` llega lo que se perdió.
  const uno = await oir("/eventos?c=c0ffee01", (t) => t.includes("event: hola"));
  const id = /id: (\S+)/.exec(uno.texto.slice(uno.texto.indexOf("event: hola")))![1];
  uno.cortar();
  const orden = { carpetas: ["alfa", "beta"], lideres: {} };
  assert.equal((await rpc("nombres:orden", [orden])).ok, true);
  const dos = await oir(`/eventos?c=c0ffee01&desde=${id}`, (t) => t.includes("event: hola"));
  dos.cortar();
  const datos = [...dos.texto.matchAll(/^data: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]));
  assert.deepEqual(
    datos.filter((d) => d.c === "nombres:orden").map((d) => d.d.carpetas),
    [["alfa", "beta"]],
  );

  // Un leído recién marcado espera su debounce (300 ms): SIGTERM lo escribe antes de salir.
  const ts = Math.floor(Date.now() / 1000);
  assert.equal((await rpc("leidos:marcar", ["20261014-120000-1", ts])).ok, true);
  a.p.kill("SIGTERM");
  assert.equal(await a.salida, 0, a.err());
  const guardado = JSON.parse(readFileSync(path.join(estado, "leidos.json"), "utf8"));
  assert.equal(guardado.leidos["20261014-120000-1"], ts);
  assert.ok(!existsSync(sock), "suelta el socket");
  assert.ok(!existsSync(path.join(estado, "dueno")), "suelta dueno");
});
