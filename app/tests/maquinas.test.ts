// Trama en dos máquinas, la unión en sólo lectura (electron/maquinas.ts): este proceso es la PC (el núcleo de
// verdad con un `maquinas.json`) y otro proceso es el Dell (tests/fixtures/motor-otra.ts: otro núcleo de verdad
// servido en 127.0.0.2). Los dos con el `pa` y el `claude` falsos, cada uno con su estado en un tmp: los ids de
// los workers son los mismos en las dos y no chocan. Se ven las filas de ambas, lo que pasa allá llega acá, su
// conversación se lee, ninguna acción se le manda, y con el Dell muerto queda la lista de acá sola.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
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

const raiz = path.join(import.meta.dirname, "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-maquinas-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const entorno = (quien: string) => ({
  HILOS_STATE: path.join(tmp, quien, "estado"),
  HILOS_SESIONES: path.join(tmp, quien, "sesiones"),
  CLAUDE_CONFIG_DIR: path.join(tmp, quien, "claude"),
  PA_STATE: path.join(tmp, quien, "pa"),
  PA_FALSO_LOG: path.join(tmp, quien, "pa.log"),
  PA_FALSO_AHORA: "1790000000",
  HILOS_PA: path.join(raiz, "scripts", "pa-falso.sh"),
  HILOS_CLAUDE: path.join(raiz, "scripts", "claude-falso.mjs"),
  HILOS_HISTORIAL: "0",
  HILOS_CLAUDE_SETTINGS: path.join(tmp, quien, "claude-settings.json"),
});
const DELL = entorno("dell");
const PC = entorno("pc");
// Antes de cualquier import de electron/: las rutas del estado se fijan al importar.
Object.assign(process.env, PC);
for (const e of [DELL, PC]) for (const d of [e.HILOS_STATE, e.PA_STATE]) mkdirSync(d, { recursive: true });
writeFileSync(path.join(DELL.HILOS_STATE, "preload.cjs"), "");

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta<T>(f: () => Promise<T | null | false> | T | null | false, ms = 15_000): Promise<T> {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > fin) assert.fail("no pasó a tiempo");
    await espera(50);
  }
}

/** El motor del Dell, en otro proceso. */
async function arrancarDell(puerto = 0) {
  const p = spawn(process.execPath, [path.join(raiz, "tests", "fixtures", "motor-otra.ts")], {
    env: { ...process.env, ...DELL, PUERTO: String(puerto) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  after(() => void p.kill("SIGKILL"));
  const port = await new Promise<number>((ok, mal) => {
    let t = "";
    p.stdout.on("data", (b) => {
      t += b;
      if (t.includes("\n")) ok(Number(t.trim()));
    });
    p.on("exit", (c) => mal(new Error(`el Dell salió con ${c}`)));
  });
  return { p, port };
}

test("sin otra máquina configurada no se arma nada", async () => {
  const { crearMaquinas } = await import("../electron/maquinas.ts");
  const { SOLA } = await import("../electron/maquinas-config.ts");
  let armados = 0;
  const m = crearMaquinas({ config: SOLA, alEvento: () => {}, alCambio: () => {}, cliente: () => (armados++, null as never) });
  assert.equal(m, null);
  assert.equal(armados, 0);
});

test("dos motores: filas de ambos, eventos de allá, su conversación se lee, sus acciones van a su motor, y con el Dell caído la de acá sola", async () => {
  const dell = await arrancarDell();
  writeFileSync(
    path.join(PC.HILOS_STATE, "maquinas.json"),
    JSON.stringify({ version: 1, esta: "pc", maquinas: [{ id: "dell", nombre: "Dell", url: `http://127.0.0.2:${dell.port}` }] }),
  );
  const nucleo = await import("../electron/nucleo.ts");
  nucleo.armarNucleo();
  after(() => nucleo.correrSalida());
  const eventos: [string, unknown][] = [];
  nucleo.escuchar((c, d) => void eventos.push([c, d]));
  const pedir = (canal: string, ...args: unknown[]) => nucleo.llamarLocal(canal, args, "prueba");
  type H = { id: string; jefe_id?: string; maquina?: string };
  const lista = async () => ((await pedir("hilos:completa")) as { datos?: { hilos: H[] } }).datos?.hilos ?? [];

  // La barra pregunta qué máquinas hay y cómo están (M3): esta y el Dell, que se avisa al cambiar.
  type Estados = { esta: { id: string; nombre: string }; otras: { id: string; nombre: string; fase: string; acceso: string }[] };
  const estados = async () => (await pedir("maquinas:leer")) as Estados;
  assert.deepEqual((await estados()).esta, { id: "pc", nombre: "PC" });
  assert.deepEqual((await estados()).otras.map((o) => o.id), ["dell"]);

  await pedir("hilos:leer");
  const todas = await hasta(async () => {
    const l = await lista();
    return l.some((h) => h.maquina === "dell") && l;
  });
  // Los mismos ids en las dos máquinas: los de allá con prefijo y su máquina; los de acá, como siempre.
  const local = todas.filter((h) => !h.maquina);
  const otras = todas.filter((h) => h.maquina);
  assert.ok(local.length > 0);
  assert.equal(otras.length, local.length);
  assert.ok(local.every((h) => !h.id.includes(":")));
  assert.ok(otras.every((h) => h.maquina === "dell" && h.id.startsWith("dell:")));
  assert.ok(local.some((h) => h.id === "20261003-100200-33333") && otras.some((h) => h.id === "dell:20261003-100200-33333"));
  assert.equal(otras.find((h) => h.id === "dell:20261003-100200-33333")?.jefe_id, "dell:s-falso-lider");
  assert.equal(local.find((h) => h.id === "20261003-100200-33333")?.jefe_id, "s-falso-lider");

  // Lo que pasa allá (un worker nuevo) llega acá: sus eventos con prefijo y la lista con la fila nueva.
  const nuevo = "20991231-000000-1";
  appendFileSync(path.join(DELL.PA_STATE, "lanzados.tsv"), `${nuevo}\tatlas\tTarea de allá\tclaude-opus-5-5\tmedium\t\t${Math.floor(Date.now() / 1000)}\n`);
  appendFileSync(path.join(DELL.PA_STATE, "eventos.jsonl"), `{"version":1,"ts":${Math.floor(Date.now() / 1000)},"tipo":"inicio","id":"${nuevo}","proyecto":"atlas"}\n`);
  await hasta(() => eventos.some(([c, d]) => c === "eventos:ids" && (d as string[]).includes(`dell:${nuevo}`)));
  await hasta(() => eventos.some(([c, d]) => c === "eventos:pa" && (d as { id: string }[]).some((e) => e.id === `dell:${nuevo}`)));
  await hasta(async () => (await lista()).some((h) => h.id === `dell:${nuevo}` && h.maquina === "dell"));
  assert.ok(!(await lista()).some((h) => h.id === nuevo));

  // Su conversación se le pide a su motor con el id de allá; las acciones, con el mismo build, van a su motor (tests/maquinas-acciones.test.ts).
  const conv = await pedir("pa:hilo", { id: "dell:20261003-100000-11111", n: 5 });
  assert.deepEqual(conv, await pedir("pa:hilo", { id: "20261003-100000-11111", n: 5 }));
  assert.match(readFileSync(DELL.PA_FALSO_LOG, "utf8"), /--hilo 20261003-100000-11111/);

  // El Dell se muere: sus filas se van y queda la lista de acá, como hoy. Lo de allá dice que no hay conexión.
  dell.p.kill("SIGKILL");
  const sola = await hasta(async () => {
    const l = await lista();
    return !l.some((h) => h.maquina) && l;
  });
  assert.deepEqual(sola.map((h) => h.id), local.map((h) => h.id));
  await hasta(async () => (await estados()).otras[0].fase === "caida");
  assert.ok(eventos.some(([c, d]) => c === "maquinas:cambio" && (d as Estados).otras[0].fase === "caida"));
  await assert.rejects(pedir("pa:hilo", { id: "dell:20261003-100000-11111" }), /main\.maquinaSinConexion/);
  // Y lo de acá sigue andando.
  assert.ok(await pedir("pa:hilo", { id: "20261003-100000-11111", n: 5 }));

  // Vuelve (mismo puerto): sus filas vuelven solas.
  await arrancarDell(dell.port);
  await hasta(async () => (await lista()).some((h) => h.id === `dell:${nuevo}`), 30_000);
  assert.deepEqual(
    { fase: (await estados()).otras[0].fase, acceso: (await estados()).otras[0].acceso },
    { fase: "conectada", acceso: "si" },
  );
});

// El núcleo de acá deja sus watchers armados (como en la app): el proceso de prueba sale solo.
after(() => void setTimeout(() => process.exit(0), 50).unref());
