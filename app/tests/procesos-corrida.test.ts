// Lo que un worker deja corriendo después de terminar (electron/cli/pa/procesos-corrida.ts): cada worker lleva `PA_CORRIDA=<id>` en
// el entorno y `pa` avisa, al terminar la corrida y en `pa --estado`, qué procesos siguen vivos con esa etiqueta. No baja nada.
// Lo puro va contra un /proc de mentira; lo real (sólo Linux) lanza un node que duerme y lo baja por su pid exacto.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { cmdEstado } from "../electron/cli/pa/async.ts";
import { prologo } from "../electron/cli/pa/entorno.ts";
import { entornoClaude, type Lanzamiento } from "../electron/cli/pa/lanzar.ts";
import { VAR_CORRIDA, avisoQuedaron, procesosDeCorrida, procesosPorCorrida, quedaronAlTerminar } from "../electron/cli/pa/procesos-corrida.ts";
import { esperarHasta } from "./esperar.ts";

const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pa-procesos-corrida-")));
after(() => rmSync(raiz, { recursive: true, force: true }));

/** Un /proc de mentira: `{ pid: [entorno, argv] }`. */
function procFalso(nombre: string, procesos: Record<number, [string[], string[]]>): string {
  const dir = path.join(raiz, nombre);
  for (const [pid, [vars, argv]] of Object.entries(procesos)) {
    mkdirSync(path.join(dir, pid), { recursive: true });
    writeFileSync(path.join(dir, pid, "environ"), vars.join("\0") + "\0");
    writeFileSync(path.join(dir, pid, "cmdline"), argv.join("\0") + "\0");
  }
  mkdirSync(path.join(dir, "self"), { recursive: true }); // lo que no es un pid se saltea
  return dir;
}
const ID = "20261125-101010-4242";

test("procesosDeCorrida: sólo los que llevan la etiqueta de ESA corrida, con su comando en una línea; fuera de Linux, nada", () => {
  const procDir = procFalso("uno", {
    4001: [["HOME=/h", `${VAR_CORRIDA}=${ID}`], ["python3", "vigilar.py", "--cada", "5"]],
    4002: [["HOME=/h", `${VAR_CORRIDA}=20261125-101010-9999`], ["sleep", "600"]],
    4003: [["HOME=/h", `OTRA_${VAR_CORRIDA}=${ID}`], ["bash"]],
    4004: [[`${VAR_CORRIDA}=${ID}`], ["node", "x".repeat(200)]],
  });
  const q = procesosDeCorrida(ID, { procDir, plat: "linux" });
  assert.deepEqual(q.map((p) => p.pid), [4001, 4004]);
  assert.equal(q[0]!.cmd, "python3 vigilar.py --cada 5");
  assert.equal(q[1]!.cmd.length, 70);
  assert.ok(q[1]!.cmd.endsWith("…"));
  assert.deepEqual([...procesosPorCorrida({ procDir, plat: "linux" }).keys()].sort(), ["20261125-101010-9999", ID].sort());
  assert.deepEqual(procesosDeCorrida(ID, { procDir, plat: "win32" }), []);
  assert.deepEqual(procesosDeCorrida("", { procDir, plat: "linux" }), []);
  assert.deepEqual(procesosDeCorrida("../x", { procDir, plat: "linux" }), []);
});

test("quedaronAlTerminar: lo que está saliendo tiene su gracia; sin nada vivo no espera", async () => {
  const procDir = procFalso("dos", { 5001: [[`${VAR_CORRIDA}=${ID}`], ["sleep", "600"]], 5002: [[`${VAR_CORRIDA}=${ID}`], ["node", "mcp.js"]] });
  let vueltas = 0;
  // el 5002 sale en la primera espera; el 5001 se queda
  const dormir = async () => {
    vueltas++;
    rmSync(path.join(procDir, "5002"), { recursive: true, force: true });
  };
  const q = await quedaronAlTerminar(ID, { procDir, plat: "linux", graciaMs: 1000, pasoMs: 250, dormir });
  assert.deepEqual(q.map((p) => p.pid), [5001]);
  assert.equal(vueltas, 4);
  vueltas = 0;
  assert.deepEqual(await quedaronAlTerminar("20261125-000000-1", { procDir, plat: "linux", dormir }), []);
  assert.equal(vueltas, 0);
});

test("avisoQuedaron: una línea con los pids y el kill exacto; sin procesos, vacío", () => {
  assert.equal(avisoQuedaron(ID, []), "");
  assert.equal(
    avisoQuedaron(ID, [{ pid: 7, cmd: "sleep 600" }]),
    `pa: aviso: la corrida ${ID} terminó y dejó 1 proceso corriendo: 7 sleep 600. No los bajo (pueden ser a propósito); si sobran: kill 7\n`,
  );
  const muchos = Array.from({ length: 7 }, (_, i) => ({ pid: 10 + i, cmd: i ? `c${i}` : "" }));
  const a = avisoQuedaron(ID, muchos);
  assert.match(a, /dejó 7 procesos corriendo: 10; 11 c1; 12 c2; 13 c3; 14 c4; y 2 más\./);
  assert.ok(a.endsWith("kill 10 11 12 13 14 15 16\n"));
  assert.equal(a.split("\n").length, 2);
});

test("el worker de claude sale con la etiqueta de su corrida", () => {
  const l = { pa: { env: { PATH: "/bin", [VAR_CORRIDA]: "la-del-jefe" }, plat: "linux" }, envClaude: {}, c: { ts: ID } } as unknown as Lanzamiento;
  assert.equal(entornoClaude(l)[VAR_CORRIDA], ID);
});

test("de verdad: un proceso suelto con la etiqueta se encuentra, y `pa --estado` lo nombra si la corrida es de este estado y ya no corre", { skip: process.platform !== "linux" }, async () => {
  const id = `20261125-121212-${process.pid}`;
  // espera-justificada: no es una espera del test; es el hijo, que tiene que seguir vivo hasta que el test lo baje por su pid
  const hijo = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { env: { ...process.env, [VAR_CORRIDA]: id }, stdio: "ignore", detached: true, windowsHide: true });
  try {
    await esperarHasta(() => procesosDeCorrida(id).some((p) => p.pid === hijo.pid), { tope: 5000 });
    const estado = path.join(raiz, "estado");
    mkdirSync(path.join(estado, "demo"), { recursive: true });
    let o = "";
    const pa = prologo([], { HOME: raiz, USERPROFILE: raiz, PA_STATE: estado, PA_JEFE: "", PA_JEFE_ID: "", PATH: process.env.PATH }, { out: (s) => (o += s), err: () => {} });
    // la corrida no es de este estado: no se nombra (los tests de un worker no ven al worker que los corre)
    await cmdEstado(pa);
    assert.doesNotMatch(o, /QUEDÓ VIVO/);
    // ya es de este estado y terminó: se nombra con su pid y el kill
    writeFileSync(path.join(estado, "demo", `${id}.hilo`), "tarea=x\n");
    o = "";
    await cmdEstado(pa);
    assert.match(o, new RegExp(`QUEDÓ VIVO demo +\\(id: ${id}, la corrida terminó y dejó 1 proceso: ${hijo.pid} .*; si sobran: kill ${hijo.pid}\\)`));
    // sigue corriendo (su .running vive): no es un resto
    writeFileSync(path.join(estado, "demo.running"), `proyecto=demo\nid=${id}\npuesto=1\ninicio=1\npa_pid=${process.pid}\n`);
    o = "";
    await cmdEstado(pa);
    assert.doesNotMatch(o, /QUEDÓ VIVO/);
  } finally {
    hijo.kill("SIGKILL");
  }
  await esperarHasta(() => !procesosDeCorrida(id).length, { tope: 5000 });
});
