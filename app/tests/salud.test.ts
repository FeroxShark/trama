// La salud de lo integrado (B25): el predicado (src/datos/salud.ts) y la lectura
// de integradas.tsv / medicion.tsv (electron/salud.ts).
// electron/ importa con `.js`: el hook lo lleva al `.ts`; el entorno va antes del import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fueSola, salud, type EstadoSalud } from "../src/datos/salud.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-salud-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.PA_STATE = path.join(tmp, "pa");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "registry.json");
for (const v of ["HILOS_BENCH", "HILOS_CAPTURA", "HILOS_CAPTURA_PNG"]) delete process.env[v];
mkdirSync(process.env.PA_STATE, { recursive: true });
const m = await import("../electron/salud.ts");

const ID = "20261003-100700-99999";
const fila = (accion: string, auto = false) => ({
  id: ID,
  proyecto: "atlas",
  rama: `pa/atlas/${ID}`,
  head_antes: "a".repeat(40),
  head_despues: "b".repeat(40),
  commits: 3,
  auto,
  accion,
  ts: 1,
});
const vacio: EstadoSalud = { version: 1, integradas: {}, bienNo: [], chequeos: {}, corriendo: [] };
const con = (x: Partial<EstadoSalud>): EstadoSalud => ({ ...vacio, ...x });

test("sin datos o con tests verdes: verde", () => {
  assert.deepEqual(salud(ID, "integrado", null), { rojo: false, verificando: false });
  assert.deepEqual(salud(ID, "integrado", vacio), { rojo: false, verificando: false });
  const verdes = con({ integradas: { [ID]: fila("integrada") }, chequeos: { [ID]: { head: "b", rc: 0, cola: "", ts: 2 } } });
  assert.equal(salud(ID, "integrado", verdes).rojo, false);
});

test("verificando mientras el chequeo corre", () => {
  assert.deepEqual(salud(ID, "integrado", con({ corriendo: [ID] })), { rojo: false, verificando: true });
});

test("tests rojos en main después de integrar: rojo con la cola", () => {
  const s = con({ chequeos: { [ID]: { head: "b", rc: 1, cola: "FAIL tests/x.test.ts", ts: 2 } } });
  assert.deepEqual(salud(ID, "integrado", s), { rojo: true, motivo: "tests", rc: 1, cola: "FAIL tests/x.test.ts" });
  // Se pasaron del tope: también rojo.
  const tope = con({ chequeos: { [ID]: { head: "b", rc: 124, cola: "", ts: 2 } } });
  assert.deepEqual(salud(ID, "integrado", tope), { rojo: true, motivo: "tests", rc: 124, cola: null });
});

test("revertida (por integradas.tsv o por el estado) gana", () => {
  assert.equal((salud(ID, "integrado", con({ integradas: { [ID]: fila("revertida") } })) as { motivo: string }).motivo, "revertida");
  assert.equal((salud(ID, "revertido", vacio) as { motivo: string }).motivo, "revertida");
  const ambas = con({ integradas: { [ID]: fila("revertida") }, chequeos: { [ID]: { head: "b", rc: 2, cola: "boom", ts: 2 } }, bienNo: [ID] });
  assert.deepEqual(salud(ID, "integrado", ambas), { rojo: true, motivo: "revertida", rc: 2, cola: "boom" });
});

test("bien=no en medicion.tsv: rojo, pero los tests rojos ganan", () => {
  assert.deepEqual(salud(ID, "integrado", con({ bienNo: [ID] })), { rojo: true, motivo: "bien_no", rc: null, cola: null });
  const s = con({ bienNo: [ID], chequeos: { [ID]: { head: "b", rc: 1, cola: "x", ts: 2 } } });
  assert.equal((salud(ID, "integrado", s) as { motivo: string }).motivo, "tests");
});

test("lo de otro id no la pinta", () => {
  const otro = "20261003-100700-11111";
  const s = con({ bienNo: [otro], chequeos: { [otro]: { head: "b", rc: 1, cola: "x", ts: 2 } } });
  assert.equal(salud(ID, "integrado", s).rojo, false);
});

test("auto: por integradas.tsv (auto=1) o por auto.json", () => {
  assert.equal(fueSola(ID, vacio, new Set()), false);
  assert.equal(fueSola(ID, con({ integradas: { [ID]: fila("integrada", true) } }), new Set()), true);
  assert.equal(fueSola(ID, null, new Set([ID])), true);
});

// --- Lectura (electron/salud.ts) ---------------------------------------------------

const cab = "fecha\tid\tproyecto\trama\trama_ppal\thead_antes\thead_despues\tcommits\tauto\taccion";
const tsv = [
  cab,
  `2026-10-03T05:27:00-03:00\t${ID}\tatlas\tpa/atlas/${ID}\tmain\taaa1111\tbbb2222\t3\t1\tintegrada`,
  `2026-10-03T06:00:00-03:00\t20261003-100700-11111\tatlas\tpa/atlas/x\tmain\tbbb2222\tccc3333\t1\t0\tintegrada`,
  `2026-10-03T07:00:00-03:00\t${ID}\tatlas\tpa/atlas/${ID}\tmain\tccc3333\tddd4444\t3\t0\trevertida`,
  "",
].join("\n");

test("integradas.tsv: la última fila de cada id manda, por encabezado", async () => {
  const { filasIntegradas } = m;
  const f = filasIntegradas(tsv);
  assert.equal(Object.keys(f).length, 2);
  assert.equal(f[ID].accion, "revertida");
  assert.equal(f["20261003-100700-11111"].auto, false);
  assert.equal(f["20261003-100700-11111"].head_despues, "ccc3333");
  assert.equal(f["20261003-100700-11111"].ts, Date.parse("2026-10-03T06:00:00-03:00") / 1000);
  assert.deepEqual(filasIntegradas(""), {});
});

test("medicion.tsv: los ids con bien=no (el resto no)", async () => {
  const { idsBienNo } = m;
  const med = ["fecha\tid\tproyecto\tbien", `x\t${ID}\tatlas\tno, rompió main`, "x\t20261003-100700-11111\tatlas\tsi", "x\t20261003-100700-22222\tatlas\t", "x\t20261003-100700-33333\tatlas\tnotable"].join("\n");
  assert.deepEqual(idsBienNo(med), [ID]);
});

test("la cola de una salida larga: las últimas líneas, con tope de bytes", async () => {
  const { colaDe } = m;
  const salida = Array.from({ length: 100 }, (_, i) => `línea ${i}`).join("\n") + "\n\n";
  const c = colaDe(salida);
  assert.equal(c.split("\n").length, 40);
  assert.ok(c.endsWith("línea 99"));
  assert.ok(colaDe("x".repeat(10000)).length <= 4000);
});

// --- El chequeo: tests sobre main tras una integración nueva ------------------------

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => Promise<boolean>, ms = 10_000) {
  const t0 = Date.now();
  while (!(await f())) {
    if (Date.now() - t0 > ms) throw new Error("no pasó");
    await espera(50);
  }
}

test("una corrida que pasa a integrado corre los tests en main y guarda el rojo por id", async () => {
  const ruta = path.join(tmp, "proy", "atlas");
  mkdirSync(ruta, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", ["-C", ruta, ...a], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "uno");
  const cabeza = git("rev-parse", "HEAD");
  writeFileSync(process.env.PROYECTOS_REGISTRY!, JSON.stringify({ projects: [{ name: "Atlas", path: ruta, tests: "echo probando; echo 'not ok 1' >&2; exit 3" }] }));
  // pa anotó la integración: su head_despues es el HEAD de main.
  writeFileSync(
    path.join(process.env.PA_STATE!, "integradas.tsv"),
    `${cab}\n2026-10-03T05:27:00-03:00\t${ID}\tatlas\tpa/atlas/${ID}\tmain\tantes\t${cabeza}\t1\t1\tintegrada\n`,
  );
  const otra = "20261003-090000-55555";
  // La primera lista siembra: lo que ya estaba integrado no se chequea.
  await m.barrerSalud([{ id: otra, proyecto: "atlas", estado: "integrado" }]);
  await m.barrerSalud([{ id: otra, proyecto: "atlas", estado: "integrado" }, { id: ID, proyecto: "atlas", estado: "listo" }]);
  assert.deepEqual((await m.estadoSalud()).corriendo, []);
  await m.barrerSalud([{ id: otra, proyecto: "atlas", estado: "integrado" }, { id: ID, proyecto: "atlas", estado: "integrado" }]);
  await hasta(async () => !!(await m.estadoSalud()).chequeos[ID]);
  const s = await m.estadoSalud();
  assert.equal(s.chequeos[ID].rc, 3);
  assert.equal(s.chequeos[ID].head, cabeza);
  assert.match(s.chequeos[ID].cola, /not ok 1/);
  assert.equal(s.chequeos[otra], undefined);
  assert.equal(s.integradas[ID].auto, true);
  assert.deepEqual(salud(ID, "integrado", s), { rojo: true, motivo: "tests", rc: 3, cola: s.chequeos[ID].cola });
});

test("si alguien integra mientras corren, se cortan sin resultado", async () => {
  const ruta = path.join(tmp, "proy", "brote");
  mkdirSync(ruta, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", ["-C", ruta, ...a], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "uno");
  writeFileSync(process.env.PROYECTOS_REGISTRY!, JSON.stringify({ projects: [{ name: "brote", path: ruta, tests: "sleep 30" }] }));
  const id = "20261003-110000-77777";
  await m.barrerSalud([{ id, proyecto: "brote", estado: "listo" }]);
  await m.barrerSalud([{ id, proyecto: "brote", estado: "integrado" }]);
  await hasta(async () => (await m.estadoSalud()).corriendo.includes(id));
  m.abortarChequeo("brote");
  await hasta(async () => !(await m.estadoSalud()).corriendo.includes(id));
  assert.equal((await m.estadoSalud()).chequeos[id], undefined);
});

test("mientras la app integra en ese proyecto no arranca ninguno: espera y corre al terminar", async () => {
  const ruta = path.join(tmp, "proy", "cauce");
  mkdirSync(ruta, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", ["-C", ruta, ...a], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "cauce");
  writeFileSync(process.env.PROYECTOS_REGISTRY!, JSON.stringify({ projects: [{ name: "cauce", path: ruta, tests: "true" }] }));
  const id = "20261003-120000-88888";
  await m.barrerSalud([{ id, proyecto: "cauce", estado: "listo" }]);
  let soltar = () => {};
  const integrando = m.mientrasIntegra("cauce", () => new Promise<void>((ok) => (soltar = ok)));
  await m.barrerSalud([{ id, proyecto: "cauce", estado: "integrado" }]);
  await espera(300);
  assert.deepEqual((await m.estadoSalud()).corriendo, []);
  assert.equal((await m.estadoSalud()).chequeos[id], undefined);
  soltar();
  await integrando;
  await hasta(async () => !!(await m.estadoSalud()).chequeos[id]);
  assert.equal((await m.estadoSalud()).chequeos[id].rc, 0);
});
