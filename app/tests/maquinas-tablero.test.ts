// El tablero junto de las dos máquinas (electron/tablero-junto.ts, maquinas.ts; etapa 7, M5): este proceso es la PC
// y otro es el Dell (tests/fixtures/motor-otra.ts), cada uno con SU tablero temporal (el CLI `tablero` de verdad, con
// `TABLERO_DIR` en un tmp). Los números de item se repiten en los dos: los de allá llegan como `dell:N` con su
// máquina y cada acción corre el CLI de la máquina del item. Con el Dell caído sus items no están y se avisa.
// Sin el CLI `tablero` instalado se saltea. Nunca toca el tablero de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const bin = process.env.HILOS_TABLERO ?? [...(process.env.PATH ?? "").split(":"), path.join(os.homedir(), ".local/bin")].map((d) => path.join(d, "tablero")).find((f) => existsSync(f));
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-maq-tablero-"));
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
  TABLERO_DIR: path.join(tmp, quien, "tablero"),
  PROYECTOS_REGISTRY: path.join(tmp, quien, "registry.json"),
  HILOS_TABLERO: bin ?? "",
});
const DELL = entorno("dell");
const PC = entorno("pc");
// Antes de cualquier import de electron/: las rutas del estado y del tablero se fijan al importar.
delete process.env.TABLERO_VISTA;
Object.assign(process.env, PC);
for (const e of [DELL, PC]) {
  for (const d of [e.HILOS_STATE, e.PA_STATE]) mkdirSync(d, { recursive: true });
  mkdirSync(path.join(e.HILOS_STATE, "..", "proy", "atlas"), { recursive: true });
  writeFileSync(e.PROYECTOS_REGISTRY, JSON.stringify({ projects: [{ name: "atlas", path: path.join(e.HILOS_STATE, "..", "proy", "atlas"), desc: "La web" }] }));
}
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

/** El CLI `tablero` contra el tablero temporal de esa máquina (nunca el real: sin TABLERO_VISTA). */
const cli = (e: ReturnType<typeof entorno>, ...args: string[]) => execFileSync(bin!, args, { env: { ...process.env, ...e }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const enDisco = (e: ReturnType<typeof entorno>) => JSON.parse(cli(e, "listar", "--todo", "--json")) as { id: number; titulo: string; columna: string; respuesta?: unknown }[];

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

type It = { id: number | string; titulo: string; maquina?: string; maquinaNombre?: string };
type Crudo = { vista: { columnas: Record<string, It[]>; contadores: Record<string, number> }; hecho: It[]; proyectos: { proyecto: string; abiertos: number }[]; caidas: string[] };

test("dos tableros: items de ambos con el mismo número, cada acción al tablero de su máquina, y con el Dell caído sus items no están", { skip: !bin && "no está el CLI `tablero`" }, async () => {
  // Cada máquina con su tablero: el item 1 existe en las dos.
  cli(PC, "init");
  cli(DELL, "init");
  const aPC = Number(cli(PC, "agregar", "--columna=espera-dueno", "--proyecto=atlas", "--", "De la PC: revisar el arranque"));
  const aDell = Number(cli(DELL, "agregar", "--columna=espera-dueno", "--proyecto=atlas", "--", "Del Dell: probar la exportación"));
  const bDell = Number(cli(DELL, "agregar", "--columna=sigue", "--proyecto=atlas", "--", "Del Dell: ordenar la cola"));
  assert.equal(aPC, aDell, "el número de item se repite en las dos máquinas");

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
  const leer = async () => (await pedir("tablero:leer")) as Crudo;
  const titulos = (c: Crudo, col: string) => (c.vista.columnas[col] ?? []).map((i) => i.titulo);

  // Los de allá entran con su máquina y el id con prefijo; los de acá, como siempre.
  const junto = await hasta(async () => {
    const c = await leer();
    return (c.vista.columnas["espera-dueno"] ?? []).some((i) => i.maquina === "dell") && c;
  });
  const espera = junto.vista.columnas["espera-dueno"];
  assert.deepEqual(espera.map((i) => [i.id, i.maquina]), [[aPC, undefined], [`dell:${aDell}`, "dell"]]);
  assert.equal(espera[1].maquinaNombre, "Dell");
  assert.deepEqual(titulos(junto, "sigue"), ["Del Dell: ordenar la cola"]);
  assert.deepEqual(junto.caidas, []);
  assert.deepEqual(junto.proyectos.map((p) => [p.proyecto, p.abiertos]), [["atlas", 3]], "el mismo proyecto es una fila con lo abierto de las dos");
  assert.equal(await pedir("tablero:esperan"), 2, "el número del pie suma las dos");

  // Cerrar el item de allá corre el CLI del Dell; el de acá con el mismo número no se toca.
  await pedir("tablero:cerrar", `dell:${aDell}`);
  assert.equal(enDisco(DELL).find((i) => i.id === aDell)?.columna, "hecho");
  assert.equal(enDisco(PC).find((i) => i.id === aPC)?.columna, "espera-dueno");
  // Y el cambio de allá llega solo: lo hecho de allá figura, con su máquina, y el pie baja.
  const c2 = await hasta(async () => {
    const c = await leer();
    return c.hecho.some((i) => i.id === `dell:${aDell}`) && c;
  });
  assert.equal(c2.hecho.find((i) => i.id === `dell:${aDell}`)?.maquina, "dell");
  assert.ok(eventos.some(([c]) => c === "tablero:cambio"));
  assert.equal(await pedir("tablero:esperan"), 1);

  // Mover y responder también van a su máquina; un número pelado es de acá.
  await pedir("tablero:mover", `dell:${bDell}`, "ideas");
  assert.equal(enDisco(DELL).find((i) => i.id === bDell)?.columna, "ideas");
  await pedir("tablero:responder", aPC, { tipo: "pregunta", texto: "sí, dale" });
  assert.ok(enDisco(PC).find((i) => i.id === aPC)?.respuesta, "la respuesta quedó en el tablero de acá");
  assert.ok(!enDisco(DELL).find((i) => i.id === aDell)?.respuesta, "y no en el de allá");

  // Un item nuevo cuyo texto parece un prefijo de máquina cae en el tablero de acá.
  await pedir("tablero:agregar", "dell: no es una máquina", "atlas");
  assert.ok(enDisco(PC).some((i) => i.titulo === "dell: no es una máquina"));
  assert.ok(!enDisco(DELL).some((i) => i.titulo === "dell: no es una máquina"));

  // El Dell se muere: sus items se van, el de acá queda y se dice cuál no está. Una acción sobre uno de allá falla clara.
  dell.p.kill("SIGKILL");
  const sola = await hasta(async () => {
    const c = await leer();
    return c.caidas.length && c;
  });
  assert.deepEqual(sola.caidas, ["Dell"]);
  assert.ok(!Object.values(sola.vista.columnas).flat().some((i) => i.maquina));
  assert.ok(!sola.hecho.some((i) => i.maquina));
  await assert.rejects(pedir("tablero:cerrar", `dell:${bDell}`), /main\.maquinaSinConexion/);

  // Vuelve (mismo puerto): sus items vuelven solos y el aviso se va.
  await arrancarDell(dell.port);
  const vuelta = await hasta(async () => {
    const c = await leer();
    return !c.caidas.length && c.vista.columnas["ideas"]?.some((i) => i.id === `dell:${bDell}`) && c;
  }, 30_000);
  assert.deepEqual(vuelta.caidas, []);
});

// El núcleo de acá deja sus watchers armados (como en la app): el proceso de prueba sale solo.
after(() => void setTimeout(() => process.exit(0), 50).unref());
