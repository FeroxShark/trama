// motor/bin/clasificar: la clase de falla y la acción del último intento de una subtarea (protocolo v2, sección 7), leída
// de un PA_STATE de prueba (estado.tsv, medicion.tsv, los .json y .corrida de cada corrida). Los ids y las rutas son
// inventados. La tabla de la rúbrica sale del pa del repo (`pa --rubrica`), con un modelos.json vacío: no mira nada real.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const CLASIFICAR = path.join(MOTOR, "bin", "clasificar");
const tmp = mkdtempSync(path.join(os.tmpdir(), "clasificar-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const PROY = "proyecto-demo";
const SLUG = "tarea-demo";
const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const MODELOS = path.join(tmp, "modelos.json");
writeFileSync(MODELOS, "{}\n");

const id = (n: number) => `20260101-1000${String(n).padStart(2, "0")}-${String(n).padStart(6, "0")}`;
/** Una fila de estado.tsv (usd fijo). */
const fila = (subtarea: string, intento: number, corrida: string, modelo: string, exit: string, gate: string) =>
  [subtarea, String(intento), corrida, modelo, "xhigh", exit, gate, "0.10"];

const COLS_MED = ["id", "compactaciones", "rubrica", "rub_fila"] as const;
type Med = Partial<Record<(typeof COLS_MED)[number], string>>;
interface Fixture {
  filas: string[][];
  medicion?: Med[];
  json?: Record<string, object>;
  corridas?: Record<string, string>;
}

let n = 0;
/** Un PA_STATE nuevo con lo que dice el fixture. Devuelve su ruta. */
function estado(f: Fixture): string {
  const state = path.join(tmp, `estado-${n++}`);
  const dir = path.join(state, PROY);
  mkdirSync(path.join(dir, "tareas", SLUG), { recursive: true });
  const enc = ["subtarea", "intento", "id", "modelo", "effort", "exit", "gate", "usd"];
  writeFileSync(path.join(dir, "tareas", SLUG, "estado.tsv"), [enc, ...f.filas].map((r) => r.join("\t")).join("\n") + "\n");
  if (f.medicion) {
    writeFileSync(path.join(state, "medicion.tsv"), [[...COLS_MED], ...f.medicion.map((m) => COLS_MED.map((c) => m[c] ?? ""))]
      .map((r) => r.join("\t")).join("\n") + "\n");
  }
  for (const [i, j] of Object.entries(f.json ?? {})) writeFileSync(path.join(dir, `${i}.json`), JSON.stringify(j));
  for (const [i, t] of Object.entries(f.corridas ?? {})) writeFileSync(path.join(dir, `${i}.corrida`), t);
  return state;
}

function correr(state: string, subtarea: string, extra: string[] = []) {
  return spawnSync(CLASIFICAR, [PROY, SLUG, subtarea, ...extra], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: tmp, PA_STATE: state, TRAMA_MODELOS: MODELOS },
  });
}

/** La clasificación en JSON (la corrida tiene que salir 0). */
function clase(state: string, subtarea: string) {
  const r = correr(state, subtarea, ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as { clase: string; accion: string; motivo: string; modelo: string | null; effort: string | null; fila: unknown };
}

const RUB_EJECUTAR = "A=chico B=ejecutar C=completo D=bajo E=si";
const RUB_DECIDIR_NO = "A=chico B=decidir C=completo D=bajo E=no";

test("gate 21 (salió de lo permitido) → brief", () => {
  const s = estado({ filas: [fila("T1", 1, id(1), HAIKU, "0", "21")] });
  assert.equal(clase(s, "T1").clase, "brief");
});

test("exit 78 con compactación → partición; con fila 1b de la rúbrica → dueño", () => {
  const medicion = [{ id: id(2), compactaciones: "2", rubrica: RUB_EJECUTAR, rub_fila: "10" }];
  const s = estado({ filas: [fila("T2", 1, id(2), HAIKU, "78", "-")], medicion });
  assert.equal(clase(s, "T2").clase, "particion");
  const s1b = estado({
    filas: [fila("T2", 1, id(2), SONNET, "78", "-")],
    medicion: [{ id: id(2), compactaciones: "1", rubrica: "A=grande B=ejecutar C=completo D=bajo E=si I=si", rub_fila: "1b" }],
  });
  assert.equal(clase(s1b, "T2").clase, "dueno");
});

test("exit 78 con max-turns (subtype error_max_turns en el .json) → partición", () => {
  const s = estado({
    filas: [fila("T3", 1, id(3), HAIKU, "78", "-")],
    json: { [id(3)]: { subtype: "error_max_turns", is_error: true, result: "" } },
  });
  assert.equal(clase(s, "T3").clase, "particion");
});

test("exit 78 sin compactación ni max-turns → dueño (no es partición)", () => {
  const s = estado({ filas: [fila("T4", 1, id(4), HAIKU, "78", "-")], medicion: [{ id: id(4), compactaciones: "0" }] });
  assert.equal(clase(s, "T4").clase, "dueno");
});

test("DECISION distinta de nada en el RESULTADO → estimación, subir B", () => {
  const json = (decision: string) => ({ result: `RESULTADO: hecho\nVERIFICACION: npm test verde\nDECISION: ${decision}\nSIGUE: nada` });
  const s = estado({
    filas: [fila("T5", 1, id(5), HAIKU, "0", "0")],
    json: { [id(5)]: json("¿Mover el panel a la izquierda o dejarlo a la derecha?") },
    medicion: [{ id: id(5), rubrica: RUB_EJECUTAR, rub_fila: "10" }],
  });
  const c = clase(s, "T5");
  assert.equal(c.clase, "estimacion");
  assert.equal(c.modelo, SONNET);
  assert.equal(c.effort, "high");
  assert.match(c.accion, /subir B/);

  const sNada = estado({ filas: [fila("T5", 1, id(6), HAIKU, "0", "0")], json: { [id(6)]: json("nada") } });
  assert.equal(clase(sNada, "T5").clase, "ok");
  // "nada. Supuestos: …" no es nada: es un pendiente, y cuenta como decisión
  const sSupuesto = estado({ filas: [fila("T5", 1, id(7), HAIKU, "0", "0")], json: { [id(7)]: json("nada. Supuestos: el color") } });
  assert.equal(clase(sSupuesto, "T5").clase, "estimacion");
});

test("gate 22, 25 o 26 → trampa", () => {
  for (const gate of ["22", "25", "26"]) {
    const s = estado({ filas: [fila("T6", 1, id(8), HAIKU, "0", gate)] });
    assert.equal(clase(s, "T6").clase, "trampa", `gate ${gate}`);
  }
});

test("gate 23 por primera vez → puntual (--seguir al mismo id)", () => {
  const s = estado({ filas: [fila("T7", 1, id(9), HAIKU, "0", "23")] });
  const c = clase(s, "T7");
  assert.equal(c.clase, "puntual");
  assert.match(c.accion, new RegExp(`--seguir --id ${id(9)}`));
});

test("gate 23 por segunda vez: subir B da otro modelo → estimación; la tabla da el mismo → brief", () => {
  const medicion = [{ id: id(10), rubrica: RUB_EJECUTAR, rub_fila: "10" }];
  const s = estado({
    filas: [fila("T8", 1, id(10), HAIKU, "0", "23"), fila("T8", 2, id(11), HAIKU, "0", "23")],
    medicion: [...medicion, { id: id(11), rubrica: RUB_EJECUTAR, rub_fila: "10" }],
  });
  const c = clase(s, "T8");
  assert.equal(c.clase, "estimacion");
  assert.equal(c.modelo, SONNET);
  assert.match(c.accion, /subir B/);

  // B ya es decidir y E ya es no: no hay paso que subir, la tabla da el mismo modelo que se usó
  const igual = estado({
    filas: [fila("T9", 1, id(12), SONNET, "0", "23"), fila("T9", 2, id(13), SONNET, "0", "23")],
    medicion: [{ id: id(13), rubrica: RUB_DECIDIR_NO, rub_fila: "3b" }],
  });
  assert.equal(clase(igual, "T9").clase, "brief");
});

test("gate 23 por segunda vez sin rúbrica guardada → dueño (no sé qué subir)", () => {
  const s = estado({ filas: [fila("T10", 1, id(14), HAIKU, "0", "23"), fila("T10", 2, id(15), HAIKU, "0", "23")] });
  assert.equal(clase(s, "T10").clase, "dueno");
});

test("el último intento es el que cuenta (intento 2 con gate 21 → brief, aunque el 1 fuera 23)", () => {
  const s = estado({ filas: [fila("T11", 1, id(16), HAIKU, "0", "23"), fila("T11", 2, id(17), HAIKU, "0", "21")] });
  assert.equal(clase(s, "T11").clase, "brief");
});

test("exit 0 con la rama igual a su base → brief; con cambios y gate 0 → ok", () => {
  const repo = path.join(tmp, "repo-demo");
  const git = (...a: string[]) => {
    const r = spawnSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" });
    assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  mkdirSync(repo, { recursive: true });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(repo, "a.txt"), "a\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "main");
  git("branch", `pa/${PROY}/${id(18)}`, "main"); // sin cambios
  git("checkout", "-q", "-b", `pa/${PROY}/${id(19)}`, "main");
  writeFileSync(path.join(repo, "a.txt"), "a cambiado\n");
  git("commit", "-qam", "cambio");
  git("checkout", "-q", "main");
  const corrida = (rama: string) => `ruta_trabajo=${repo}\nrama=${rama}\nbase=${base}\nproyecto=${PROY}\n`;
  const vacio = estado({
    filas: [fila("T12", 1, id(18), HAIKU, "0", "-")],
    corridas: { [id(18)]: corrida(`pa/${PROY}/${id(18)}`) },
  });
  assert.equal(clase(vacio, "T12").clase, "brief");
  const conCambio = estado({
    filas: [fila("T13", 1, id(19), HAIKU, "0", "0")],
    corridas: { [id(19)]: corrida(`pa/${PROY}/${id(19)}`) },
  });
  assert.equal(clase(conCambio, "T13").clase, "ok");
});

test("cualquier otro gate (24, rojos nuevos) → dueño", () => {
  const s = estado({ filas: [fila("T14", 1, id(20), HAIKU, "0", "24")] });
  assert.equal(clase(s, "T14").clase, "dueno");
});

test("sin estado.tsv o sin esa subtarea: sale 2 con el motivo", () => {
  const s = estado({ filas: [fila("T15", 1, id(21), HAIKU, "0", "0")] });
  const falta = correr(s, "T99");
  assert.equal(falta.status, 2);
  assert.match(falta.stderr, /no hay intentos de 'T99'/);
  const sinArchivo = correr(path.join(tmp, "no-existe"), "T15");
  assert.equal(sinArchivo.status, 2);
  assert.match(sinArchivo.stderr, /no encuentro/);
});

test("sin --json imprime la clase, la acción y el motivo", () => {
  const s = estado({ filas: [fila("T16", 1, id(22), HAIKU, "0", "21")] });
  const r = correr(s, "T16");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^clase: brief\n/);
  assert.match(r.stdout, /acción: /);
  assert.match(r.stdout, /motivo: gate 21/);
});
