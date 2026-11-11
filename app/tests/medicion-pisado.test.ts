// `pa --bien-auto` (electron/cli/pa/medicion.ts): el retrabajo propio de una corrida (alguien la retomó con --seguir
// después de integrarla, se revirtió, u otra corrida que arrancó después de integrarla —o cuya tarea la nombra— le
// reescribió las líneas) contra el pisado de otra que ya corría en paralelo (la columna nueva `pisado`).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../electron/cli/pa/cli.ts";
import { deps as depsReales } from "../electron/cli/pa.ts";
import type { Env, Io } from "../electron/cli/pa/entorno.ts";
import { MEDICION_HEADER } from "../electron/cli/pa/ganchos.ts";

const ID_A = "20260101-100000-111";
const ID_B = "20260101-100000-222";
const ID_C = "20260101-100000-333";
/** La integración de la corrida A (hace meses: la ventana de 48 h ya cerró). */
const T0 = Math.floor(Date.parse("2026-01-01T10:00:00Z") / 1000);
const iso = (ep: number) => new Date(ep * 1000).toISOString().replace(/\.\d+Z$/, "+00:00");

const captura = (): Io & { o: string; e: string } => {
  const c = { o: "", e: "", out: (s: string) => void (c.o += s), err: (s: string) => void (c.e += s) };
  return c;
};

interface Armado {
  /** Cuándo arrancó la corrida que pisa (epoch): antes de T0 = en paralelo; después = retrabajo. */
  inicioB: number;
  /** La tarea de la corrida que pisa (si nombra a la original, es retrabajo). */
  tareaB?: string;
  /** Un .hilo con `origen` = la corrida A (un --seguir después de integrarla). */
  seguirA?: number;
  /** La última acción de A en integradas.tsv. */
  accionA?: string;
  /** Un header viejo (sin la columna `pisado`). */
  headerViejo?: boolean;
}

const fila = (o: Record<string, string>, header: string) => header.split("\t").map((c) => o[c] ?? "").join("\t");

interface Sandbox {
  env: Env;
  estado: string;
  limpiar: () => void;
}

/** Un estado con dos corridas integradas (A y B) y un repo git donde B pisa las líneas de A. */
function armar(a: Armado): Sandbox {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "medicion-pisado-")));
  const home = path.join(raiz, "home");
  const proyecto = path.join(raiz, "demo");
  const estado = path.join(raiz, "estado");
  mkdirSync(path.join(home, ".config", "proyectos"), { recursive: true });
  mkdirSync(path.join(estado, "demo"), { recursive: true });
  mkdirSync(proyecto, { recursive: true });
  const git = (...args: string[]) => spawnSync("git", ["-C", proyecto, "-c", "user.email=a@b", "-c", "user.name=x", ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(proyecto, "f.txt"), "uno\n");
  git("add", "f.txt");
  git("commit", "-qm", "base");
  const c0 = git("rev-parse", "HEAD").stdout.trim();
  writeFileSync(path.join(proyecto, "f.txt"), "A\n");
  git("add", "f.txt");
  git("commit", "-qm", "primera");
  const c1 = git("rev-parse", "HEAD").stdout.trim();
  writeFileSync(path.join(proyecto, "f.txt"), "B\n");
  git("add", "f.txt");
  git("commit", "-qm", "segunda");
  const c2 = git("rev-parse", "HEAD").stdout.trim();
  const reg = path.join(home, ".config", "proyectos", "registry.json");
  writeFileSync(reg, JSON.stringify({ projects: [{ name: "demo", path: proyecto }] }));
  const env: Env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|REPARTO_|CLAUDE)/.test(k)) env[k] = v;
  Object.assign(env, { HOME: home, USER: "g", XDG_CONFIG_HOME: path.join(home, ".config"), PA_STATE: estado, PROYECTOS_REGISTRY: reg });

  const header = a.headerViejo ? MEDICION_HEADER.split("\t").slice(0, -1).join("\t") : MEDICION_HEADER;
  const comun = { proyecto: "demo", modelo: "claude-sonnet-5-5", effort: "high", leer: "0", seguir: "0", tipo: "debug" };
  writeFileSync(
    path.join(estado, "medicion.tsv"),
    `${[header, fila({ ...comun, fecha: iso(T0), id: ID_A }, header), fila({ ...comun, fecha: iso(T0 + 600), id: ID_B }, header)].join("\n")}\n`,
  );
  const integ = [
    "fecha\tid\tproyecto\trama\trama_ppal\thead_antes\thead_despues\tcommits\tauto\taccion",
    `${iso(T0)}\t${ID_A}\tdemo\tpa/demo/${ID_A}\tmain\t${c0}\t${c1}\t1\t0\tintegrada`,
    `${iso(T0 + 600)}\t${ID_B}\tdemo\tpa/demo/${ID_B}\tmain\t${c1}\t${c2}\t1\t0\tintegrada`,
  ];
  if (a.accionA) integ.push(`${iso(T0 + 900)}\t${ID_A}\tdemo\tpa/demo/${ID_A}\tmain\t${c1}\t${c1}\t1\t0\t${a.accionA}`);
  writeFileSync(path.join(estado, "integradas.tsv"), `${integ.join("\n")}\n`);
  const hilo = (id: string, campos: Record<string, string | number>) =>
    writeFileSync(path.join(estado, "demo", `${id}.hilo`), `${Object.entries(campos).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
  hilo(ID_A, { inicio: T0 - 60, rama: `pa/demo/${ID_A}`, origen: "" });
  hilo(ID_B, { inicio: a.inicioB, rama: `pa/demo/${ID_B}`, origen: "", tarea: a.tareaB ?? "otra cosa" });
  if (a.seguirA !== undefined) hilo(ID_C, { inicio: a.seguirA, rama: `pa/demo/${ID_C}`, origen: ID_A, tarea: "seguí con lo que faltaba" });
  return { env, estado, limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}

/** Las filas de medicion.tsv por id. */
function filas(estado: string): Map<string, Record<string, string>> {
  const ls = readFileSync(path.join(estado, "medicion.tsv"), "utf8").split("\n").filter((l) => l !== "");
  const cols = ls[0]!.split("\t");
  const salida = new Map<string, Record<string, string>>();
  for (const l of ls.slice(1)) {
    const c = l.split("\t");
    const o: Record<string, string> = {};
    cols.forEach((n, i) => (o[n] = c[i] ?? ""));
    salida.set(o.id!, o);
  }
  return salida;
}

async function correr(a: Armado): Promise<{ filas: Map<string, Record<string, string>>; header: string }> {
  const s = armar(a);
  try {
    const io = captura();
    const rc = await main(["--bien-auto"], s.env, io, depsReales);
    assert.equal(rc, 0, `pa --bien-auto salió ${rc}: ${io.e}`);
    const texto = readFileSync(path.join(s.estado, "medicion.tsv"), "utf8");
    return { filas: filas(s.estado), header: texto.split("\n")[0]! };
  } finally {
    s.limpiar();
  }
}

test("una corrida que ya corría en paralelo y pisó las líneas: retrabajo 0 y pisado 1", async () => {
  const { filas: f } = await correr({ inicioB: T0 - 3600 });
  assert.equal(f.get(ID_A)?.integrada, "1");
  assert.equal(f.get(ID_A)?.retrabajo, "0");
  assert.equal(f.get(ID_A)?.pisado, "1");
});

test("una corrida que arrancó después de integrarla: retrabajo 1 y pisado 0", async () => {
  const { filas: f } = await correr({ inicioB: T0 + 60 });
  assert.equal(f.get(ID_A)?.retrabajo, "1");
  assert.equal(f.get(ID_A)?.pisado, "0");
});

test("una corrida cuya tarea nombra a la original: retrabajo 1 (aunque corriera en paralelo)", async () => {
  const { filas: f } = await correr({ inicioB: T0 - 3600, tareaB: `arreglá lo que rompió la corrida ${ID_A}` });
  assert.equal(f.get(ID_A)?.retrabajo, "1");
  assert.equal(f.get(ID_A)?.pisado, "0");
});

test("un --seguir después de integrarla: retrabajo 1", async () => {
  const { filas: f } = await correr({ inicioB: T0 + 60, seguirA: T0 + 120 });
  assert.equal(f.get(ID_A)?.retrabajo, "1");
});

test("un revert: retrabajo 1", async () => {
  const { filas: f } = await correr({ inicioB: T0 - 3600, accionA: "revertida" });
  assert.equal(f.get(ID_A)?.integrada, "1");
  assert.equal(f.get(ID_A)?.retrabajo, "1");
});

test("el header lleva la columna pisado antes de indivisible, al final", async () => {
  const { header } = await correr({ inicioB: T0 - 3600 });
  const cols = header.split("\t");
  assert.equal(cols[cols.length - 2], "pisado");
  assert.equal(cols.length, MEDICION_HEADER.split("\t").length);
});

test("un archivo viejo (sin la columna pisado) se lee igual y el header se actualiza", async () => {
  const { filas: f, header } = await correr({ inicioB: T0 - 3600, headerViejo: true });
  assert.equal(f.get(ID_A)?.retrabajo, "0");
  assert.equal(f.get(ID_A)?.pisado, "1");
  assert.equal(header.split("\t").at(-2), "pisado");
});
