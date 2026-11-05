// Dónde encuentra `pa` el motor (reparto, tablero, cuentas, hooks) en cada forma de instalar. El bug: `carpetaMotor` suponía
// `<app>/../motor`, que sólo existe en un checkout; en la instalación de escritorio (`~/.local/share/trama/{app,fuente/motor}`)
// `reparto` "no existía", todo caía a Sonnet, el tablero y los hooks (latido) quedaban mudos.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { avisarFalta, resolverMotor, type Pa } from "../electron/cli/pa/entorno.ts";
import { settingsWorker } from "../electron/cli/pa/lanzar.ts";

const toque = (f: string) => {
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, "");
};
/** Un motor completo en `<dir>`: bin/pa, bin/reparto, bin/tablero, hooks/latido.sh. */
const motorEn = (dir: string) => {
  for (const f of ["bin/pa", "bin/reparto", "bin/tablero", "hooks/latido.sh"]) toque(path.join(dir, f));
};
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "motor-resolver-"));
/** La carpeta `electron/cli/pa` (o `dist-electron/cli/pa`) de una app dentro de `<app>`. */
const cliPa = (app: string) => path.join(app, "dist-electron", "cli", "pa");

test("instalación de escritorio: app en ~/.local/share/trama/app y motor en ../fuente/motor", () => {
  const raiz = tmp();
  try {
    const share = path.join(raiz, ".local", "share", "trama");
    motorEn(path.join(share, "fuente", "motor"));
    mkdirSync(cliPa(path.join(share, "app")), { recursive: true });
    const m = resolverMotor({}, { desde: cliPa(path.join(share, "app")), home: raiz, plat: "linux" });
    assert.equal(m.dir, path.join(share, "fuente", "motor"));
    assert.equal(m.bin, path.join(share, "fuente", "motor", "bin"));
    assert.equal(m.hooks, path.join(share, "fuente", "motor", "hooks"));
    assert.equal(m.via, "fuente");
    assert.ok(m.binOk && m.hooksOk);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("checkout (y worktree): motor/ al lado de app/", () => {
  const raiz = tmp();
  try {
    motorEn(path.join(raiz, "motor"));
    mkdirSync(cliPa(path.join(raiz, "app")), { recursive: true });
    const m = resolverMotor({}, { desde: cliPa(path.join(raiz, "app")), home: path.join(raiz, "h"), plat: "linux" });
    assert.equal(m.dir, path.join(raiz, "motor"));
    assert.equal(m.via, "checkout");
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("app en una carpeta suelta: sigue el checkout anotado por instalar-producto.sh y, si no, el enlace de ~/.local/bin/pa", () => {
  const raiz = tmp();
  try {
    const home = path.join(raiz, "h");
    const app = path.join(raiz, "suelta", "app");
    mkdirSync(cliPa(app), { recursive: true });
    const motor = path.join(raiz, "donde", "motor");
    motorEn(motor);
    // sin nada que lo guíe: no está, y se dice (binOk/hooksOk en false)
    const nada = resolverMotor({}, { desde: cliPa(app), home, plat: "linux" });
    assert.equal(nada.binOk, false);
    assert.equal(nada.hooksOk, false);
    // el enlace de ~/.local/bin/pa
    mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    symlinkSync(path.join(motor, "bin", "pa"), path.join(home, ".local", "bin", "pa"));
    const porEnlace = resolverMotor({}, { desde: cliPa(app), home, plat: "linux" });
    assert.equal(porEnlace.dir, motor);
    assert.equal(porEnlace.via, "enlace de pa");
    // el checkout anotado gana al enlace
    const otro = path.join(raiz, "otro");
    motorEn(path.join(otro, "motor"));
    toque(path.join(home, ".config", "trama", "checkout"));
    writeFileSync(path.join(home, ".config", "trama", "checkout"), `${otro}\n`);
    const anotado = resolverMotor({}, { desde: cliPa(app), home, plat: "linux" });
    assert.equal(anotado.dir, path.join(otro, "motor"));
    assert.equal(anotado.via, "checkout anotado");
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("TRAMA_MOTOR_DIR manda, aunque no exista (y entonces se avisa)", () => {
  const m = resolverMotor({ TRAMA_MOTOR_DIR: "/no/existe/motor" }, { desde: "/x/app/dist-electron/cli/pa", home: "/h", plat: "linux", existe: () => false });
  assert.equal(m.dir, "/no/existe/motor");
  assert.equal(m.via, "TRAMA_MOTOR_DIR");
  assert.equal(m.binOk, false);
});

test("Windows nativo: <raíz>\\{app,bin,node}: los .cmd en bin\\ y los hooks .mjs en app\\hooks, sin carpeta motor", () => {
  const dentro = new Set(["C:\\Users\\f\\AppData\\Local\\trama\\bin\\pa.cmd", "C:\\Users\\f\\AppData\\Local\\trama\\app\\hooks\\latido.mjs"]);
  const m = resolverMotor(
    { LOCALAPPDATA: "C:\\Users\\f\\AppData\\Local" },
    { desde: "C:\\Users\\f\\AppData\\Local\\trama\\app\\dist-electron\\cli\\pa", home: "C:\\Users\\f", plat: "win32", existe: (f) => dentro.has(f) },
  );
  assert.equal(m.via, "payload");
  assert.equal(m.bin, "C:\\Users\\f\\AppData\\Local\\trama\\bin");
  assert.equal(m.hooks, "C:\\Users\\f\\AppData\\Local\\trama\\app\\hooks");
  assert.ok(m.binOk && m.hooksOk);
});

const paDe = (motor: ReturnType<typeof resolverMotor>, err: string[]): Pa =>
  ({
    env: { PATH: "" },
    io: { out: () => {}, err: (s: string) => err.push(s) },
    plat: "linux",
    home: "/h",
    state: "/s",
    lockdir: "/s/lock",
    bin: motor.bin,
    hooks: motor.hooks,
    motor,
    plan: "pro",
    autocompact: null,
    puestos: 3,
    tope: 10,
    ramWorkerMb: 1,
    ramReservaMb: 1,
    ramRecienMin: 1,
  }) as Pa;

test("un hook que no se encuentra se ve por stderr (una sola vez), y el settings apunta a los hooks del motor resuelto", () => {
  const raiz = tmp();
  try {
    const share = path.join(raiz, "share");
    motorEn(path.join(share, "fuente", "motor"));
    const bien = resolverMotor({}, { desde: cliPa(path.join(share, "app")), home: raiz, plat: "linux" });
    const e1: string[] = [];
    const s = JSON.parse(settingsWorker(paDe(bien, e1), { hb: "/e/hb", leer: false }));
    assert.deepEqual(e1, []);
    assert.match(JSON.stringify(s.hooks), new RegExp(`${path.join(share, "fuente", "motor", "hooks").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/latido\\.sh`));
    // un motor sin hooks
    const roto = resolverMotor({ TRAMA_MOTOR_DIR: path.join(raiz, "vacio") }, { home: raiz, plat: "linux" });
    const e2: string[] = [];
    const pa = paDe(roto, e2);
    settingsWorker(pa, { hb: "/e/hb", leer: false });
    settingsWorker(pa, { hb: "/e/hb", leer: false });
    assert.equal(e2.length, 1);
    assert.match(e2[0]!, /pa: no encuentro los hooks del worker \(latido, destructive-guard\).*vía TRAMA_MOTOR_DIR/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("avisarFalta: una vez por pieza, con dónde se buscó", () => {
  const err: string[] = [];
  const m = resolverMotor({}, { desde: "/x/app/dist-electron/cli/pa", home: "/h", plat: "linux", existe: () => false });
  const pa = paDe(m, err);
  avisarFalta(pa, "reparto", "/x/motor/bin/reparto");
  avisarFalta(pa, "reparto", "/x/motor/bin/reparto");
  avisarFalta(pa, "tablero", "/x/motor/bin/tablero");
  assert.equal(err.length, 2);
  assert.match(err[0]!, /pa: no encuentro reparto \(\/x\/motor\/bin\/reparto\)\. Motor: .* busqué en /);
});

test("avisoReparto: el resultado dice que reparto no eligió (lee <id>.reparto-fallo); sin el archivo no dice nada", async () => {
  const { avisoReparto } = await import("../electron/cli/pa/resultado-lanzar.ts");
  const raiz = tmp();
  try {
    const base = path.join(raiz, "20261105-000000-1");
    assert.equal(avisoReparto(base), "");
    writeFileSync(`${base}.reparto-fallo`, "no existe /x/motor/bin/reparto\nmodelo=claude-sonnet-5-5\n");
    assert.match(avisoReparto(base), /^— reparto NO eligió el modelo \(no existe \/x\/motor\/bin\/reparto\); corrió con claude-sonnet-5-5\./);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
