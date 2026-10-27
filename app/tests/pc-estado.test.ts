// electron/pc-estado.ts: "PC apagada · Prender" en la trama del Dell. Con un `prender-pc` falso (scripts/prender-pc-falso.sh)
// y una PC falsa que abre su puerto sólo después de que el "paquete" salió. Nada sale a la red: todo en 127.0.0.1 y un tmp.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-pc-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const FALSO = path.join(import.meta.dirname, "..", "scripts", "prender-pc-falso.sh");
const LOG = path.join(tmp, "prender.log");
const PAQUETE = path.join(tmp, "paquete");
process.env.PRENDER_FALSO_LOG = LOG;
process.env.PC_FALSA_PAQUETE = PAQUETE;
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = path.join(tmp, "pa");
process.env.HILOS_PA = path.join(import.meta.dirname, "..", "scripts", "pa-falso.sh");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_HISTORIAL = "0";
process.env.HILOS_CLAUDE_SETTINGS = path.join(tmp, "claude-settings.json");

const { crearPc } = await import("../electron/pc-estado.ts");
const { parsearMaquinas } = await import("../electron/maquinas-config.ts");

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const llamadas = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean) : []);
const hasta = async (cond: () => boolean, ms = 4000) => {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await espera(15);
  assert.ok(cond(), "no pasó a tiempo");
};

/** Un puerto libre de loopback. */
const libre = () =>
  new Promise<number>((resolver) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolver(p));
    });
  });

/** La PC falsa: abre su puerto un rato después de que el paquete salió (el archivo aparece) y lo cierra con `apagar`. */
function pcFalsa(puerto: number) {
  let servidor: net.Server | null = null;
  const reloj = setInterval(() => {
    if (!servidor && existsSync(PAQUETE)) {
      servidor = net.createServer((s) => s.destroy());
      servidor.listen(puerto, "127.0.0.1");
    }
  }, 20);
  return {
    abierta: () => servidor?.listening === true,
    apagar() {
      clearInterval(reloj);
      servidor?.close();
      servidor?.closeAllConnections?.();
      servidor = null;
      rmSync(PAQUETE, { force: true });
    },
  };
}

function nueva(puerto: number, extra: { plazoMs?: number; comando?: string } = {}) {
  const cambios: string[] = [];
  const pc = crearPc({
    maquina: { id: "pc", nombre: "PC", url: `http://127.0.0.1:${puerto}`, prender: extra.comando ?? FALSO },
    alCambio: (e) => cambios.push(e.estado + (e.error ? `:${e.error}` : "")),
    plazoMs: extra.plazoMs ?? 5000,
    cadaMs: 25,
  });
  return { pc, cambios };
}

test("apagada → Prender (el paquete sale una vez) → Prendiendo… → la PC aparece → prendida; otra vez Prender no manda nada", async () => {
  rmSync(LOG, { force: true });
  const puerto = await libre();
  const falsa = pcFalsa(puerto);
  const { pc, cambios } = nueva(puerto);
  assert.equal((await pc.leer()).estado, "apagada");
  assert.deepEqual(cambios, [], "apagada ya era el estado: no hay cambio que avisar");

  const e = await pc.prender();
  assert.equal(e.estado, "prendiendo");
  assert.deepEqual(llamadas(), ["prender-pc"], "el comando se corre sin argumentos");
  assert.equal((await pc.leer()).estado, "prendiendo", "mientras prende, leer no la pisa con apagada");

  await hasta(() => pc.ultimo().estado === "prendida");
  assert.deepEqual(cambios, ["prendiendo", "prendida"]);
  assert.equal(pc.ultimo().error, null);

  await pc.prender();
  assert.equal(llamadas().length, 1, "ya prendida no se manda otro paquete");

  // Se apaga sin que nadie avise: la próxima mirada lo ve.
  falsa.apagar();
  await espera(50);
  assert.equal((await pc.leer()).estado, "apagada");
  assert.equal(cambios.at(-1), "apagada");
  pc.cerrar();
});

test("Prender dos veces seguidas manda un solo paquete", async () => {
  rmSync(LOG, { force: true });
  const puerto = await libre();
  const falsa = pcFalsa(puerto);
  const { pc } = nueva(puerto);
  await Promise.all([pc.prender(), pc.prender()]);
  assert.equal(llamadas().length, 1);
  await hasta(() => pc.ultimo().estado === "prendida");
  falsa.apagar();
  pc.cerrar();
});

test("el comando falla: vuelve a apagada con lo que dijo, y se puede volver a probar", async () => {
  rmSync(LOG, { force: true });
  process.env.PRENDER_FALSO_FALLA = "falta MAC";
  try {
    const puerto = await libre();
    const { pc, cambios } = nueva(puerto);
    const e = await pc.prender();
    assert.equal(e.estado, "apagada");
    assert.equal(e.error, "prender-pc: falta MAC");
    assert.deepEqual(cambios, ["prendiendo", "apagada:prender-pc: falta MAC"]);
    delete process.env.PRENDER_FALSO_FALLA;
    assert.equal((await pc.prender()).estado, "prendiendo");
    assert.equal(llamadas().length, 2);
    pc.cerrar();
  } finally {
    delete process.env.PRENDER_FALSO_FALLA;
  }
});

test("un comando que no existe: apagada con el motivo, sin romper", async () => {
  const puerto = await libre();
  const { pc } = nueva(puerto, { comando: path.join(tmp, "no-existe") });
  const e = await pc.prender();
  assert.equal(e.estado, "apagada");
  assert.ok(e.error && e.error.length > 0);
  pc.cerrar();
});

test("la PC no aparece en el plazo: vuelve a apagada con la clave del main", async () => {
  rmSync(LOG, { force: true });
  rmSync(PAQUETE, { force: true });
  const puerto = await libre();
  const { pc, cambios } = nueva(puerto, { plazoMs: 200 });
  await pc.prender();
  await hasta(() => pc.ultimo().estado === "apagada");
  assert.match(pc.ultimo().error ?? "", /main\.pcNoContesto/);
  assert.equal(cambios[0], "prendiendo");
  pc.cerrar();
});

test("maquinas.json: `prender` es una ruta (o true); lo demás se anota como malo; sin él nada cambia", () => {
  const r = parsearMaquinas({
    version: 1,
    esta: "dell",
    maquinas: [
      { id: "pc", url: "http://192.0.2.1:4545", prender: "~/.local/bin/prender-pc" },
      { id: "otra", url: "http://192.0.2.2:4545", prender: true },
      { id: "mala", url: "http://192.0.2.3:4545", prender: "prender-pc --mirar" },
      { id: "peor", url: "http://192.0.2.4:4545", prender: 3 },
      { id: "nada", url: "http://192.0.2.5:4545" },
    ],
  });
  assert.ok(!("error" in r));
  assert.deepEqual(
    r.maquinas.map((m) => [m.id, m.prender]),
    [
      ["pc", "~/.local/bin/prender-pc"],
      ["otra", "~/.local/bin/prender-pc"],
      ["nada", undefined],
    ],
  );
  assert.ok(!("prender" in r.maquinas[2]!));
  assert.equal(r.malas.length, 2);
});

test("el núcleo del Dell: pc:leer / pc:prender / pc:cambio, y la PC no se junta como máquina", async () => {
  rmSync(LOG, { force: true });
  const nucleo = await import("../electron/nucleo.ts");
  const puerto = await libre();
  const falsa = pcFalsa(puerto);
  mkdirSync(path.dirname(nucleo.ARCHIVO_MAQUINAS), { recursive: true });
  writeFileSync(
    nucleo.ARCHIVO_MAQUINAS,
    JSON.stringify({ version: 1, esta: "dell", maquinas: [{ id: "pc", nombre: "PC", url: `http://127.0.0.1:${puerto}`, prender: FALSO }] }),
  );
  const cambios: string[] = [];
  nucleo.escuchar((c, d) => c === "pc:cambio" && cambios.push((d as { estado: string }).estado));
  nucleo.armarNucleo();
  assert.deepEqual(await nucleo.llamarRemoto("pc:leer", [], "cel"), { id: "pc", nombre: "PC", url: `http://127.0.0.1:${puerto}`, estado: "apagada", error: null });
  const e = (await nucleo.llamarRemoto("pc:prender", [], "cel")) as { estado: string };
  assert.equal(e.estado, "prendiendo");
  await hasta(() => cambios.includes("prendida"));
  assert.deepEqual(cambios, ["prendiendo", "prendida"]);
  assert.deepEqual(llamadas(), ["prender-pc"]);
  // Nunca se conectó a su motor: sólo el puerto se miró (el servidor falso destruye lo que llega).
  assert.equal(nucleo.RUTAS["pc:leer"], "local");
  assert.equal(nucleo.RUTAS["pc:prender"], "local");
  assert.equal(nucleo.EVENTOS["pc:cambio"], "local");
  falsa.apagar();
});
