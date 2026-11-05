// Dónde encuentra `pa` el motor (reparto, tablero, cuentas, hooks) en cada forma de instalar. El bug: `carpetaMotor` suponía
// `<app>/../motor`, que sólo existe en un checkout; en la instalación de escritorio (`~/.local/share/trama/{app,fuente/motor}`)
// `reparto` "no existía", todo caía a Sonnet, el tablero y los hooks (latido) quedaban mudos.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { avisarFalta, resolverMotor, type OpcionesMotor, type Pa } from "../electron/cli/pa/entorno.ts";
import { settingsWorker } from "../electron/cli/pa/lanzar.ts";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "motor-resolver-"));

// Las formas de instalar de Linux se prueban con rutas POSIX y un disco falso, no con el temporal: con `plat: "linux"` y una ruta real de
// Windows (`C:\…`), `path.posix` no entiende la carpeta y la prueba miente en esa máquina. La plataforma es lo que se inyecta; la real va abajo.
const MOTOR = ["bin/pa", "bin/reparto", "bin/tablero", "hooks/latido.sh"];
/** Un disco falso: los archivos, lo anotado (primera línea) y los enlaces (`readlink -f`). */
const disco = (archivos: string[], o: { lineas?: Record<string, string>; enlaces?: Record<string, string> } = {}): OpcionesMotor => {
  const hay = new Set(archivos);
  return { existe: (f) => hay.has(f), leer: (f) => o.lineas?.[f] ?? null, real: (f) => o.enlaces?.[f] ?? null };
};
const motorEn = (dir: string) => MOTOR.map((f) => path.posix.join(dir, f));
/** La carpeta `electron/cli/pa` (o `dist-electron/cli/pa`) de una app dentro de `<app>`. */
const cliPa = (app: string) => path.posix.join(app, "dist-electron", "cli", "pa");

test("instalación de escritorio: app en ~/.local/share/trama/app y motor en ../fuente/motor", () => {
  const share = "/home/ana/.local/share/trama";
  const m = resolverMotor({}, { desde: cliPa(`${share}/app`), home: "/home/ana", plat: "linux", ...disco(motorEn(`${share}/fuente/motor`)) });
  assert.equal(m.dir, `${share}/fuente/motor`);
  assert.equal(m.bin, `${share}/fuente/motor/bin`);
  assert.equal(m.hooks, `${share}/fuente/motor/hooks`);
  assert.equal(m.via, "fuente");
  assert.ok(m.binOk && m.hooksOk);
});

test("checkout (y worktree): motor/ al lado de app/", () => {
  const m = resolverMotor({}, { desde: cliPa("/src/trama/app"), home: "/home/ana", plat: "linux", ...disco(motorEn("/src/trama/motor")) });
  assert.equal(m.dir, "/src/trama/motor");
  assert.equal(m.via, "checkout");
});

test("app en una carpeta suelta: sigue el checkout anotado por instalar-producto.sh y, si no, el enlace de ~/.local/bin/pa", () => {
  const home = "/home/ana";
  const o = { desde: cliPa("/suelta/app"), home, plat: "linux" as const };
  const motor = "/donde/motor";
  // sin nada que lo guíe: no está, y se dice (binOk/hooksOk en false)
  const nada = resolverMotor({}, { ...o, ...disco(motorEn(motor)) });
  assert.equal(nada.binOk, false);
  assert.equal(nada.hooksOk, false);
  // el enlace de ~/.local/bin/pa
  const enlaces = { [`${home}/.local/bin/pa`]: `${motor}/bin/pa` };
  const porEnlace = resolverMotor({}, { ...o, ...disco(motorEn(motor), { enlaces }) });
  assert.equal(porEnlace.dir, motor);
  assert.equal(porEnlace.via, "enlace de pa");
  // el checkout anotado gana al enlace
  const lineas = { [`${home}/.config/trama/checkout`]: "/otro" };
  const anotado = resolverMotor({}, { ...o, ...disco([...motorEn(motor), ...motorEn("/otro/motor")], { lineas, enlaces }) });
  assert.equal(anotado.dir, "/otro/motor");
  assert.equal(anotado.via, "checkout anotado");
});

test("con el disco de verdad, en la plataforma que corre: checkout e instalación con fuente/ se encuentran", () => {
  const raiz = tmp();
  try {
    const copiar = (dir: string) => {
      for (const f of MOTOR) {
        const r = path.join(dir, ...f.split("/"));
        mkdirSync(path.dirname(r), { recursive: true });
        writeFileSync(r, "");
      }
    };
    const home = path.join(raiz, "h");
    const instalada = path.join(raiz, "instalada");
    copiar(path.join(instalada, "fuente", "motor"));
    const m1 = resolverMotor({}, { desde: path.join(instalada, "app", "dist-electron", "cli", "pa"), home });
    assert.equal(m1.dir, path.join(instalada, "fuente", "motor"));
    assert.equal(m1.bin, path.join(instalada, "fuente", "motor", "bin"));
    assert.equal(m1.via, "fuente");
    assert.ok(m1.binOk && m1.hooksOk);
    const checkout = path.join(raiz, "checkout");
    copiar(path.join(checkout, "motor"));
    const m2 = resolverMotor({}, { desde: path.join(checkout, "app", "dist-electron", "cli", "pa"), home });
    assert.equal(m2.dir, path.join(checkout, "motor"));
    assert.equal(m2.via, "checkout");
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

test("Windows nativo: un checkout (`motor\\` al lado de `app\\`) y, desde una carpeta suelta, la instalación de %LOCALAPPDATA%", () => {
  const desdeCheckout = new Set(["C:\\src\\trama\\motor\\bin\\pa", "C:\\src\\trama\\motor\\hooks\\latido.mjs"]);
  const c = resolverMotor({}, { desde: "C:\\src\\trama\\app\\dist-electron\\cli\\pa", home: "C:\\Users\\f", plat: "win32", existe: (f) => desdeCheckout.has(f) });
  assert.equal(c.via, "checkout");
  assert.equal(c.bin, "C:\\src\\trama\\motor\\bin");
  assert.ok(c.binOk && c.hooksOk);
  const instalada = new Set(["D:\\datos\\trama\\bin\\reparto.cmd", "D:\\datos\\trama\\app\\hooks\\latido.mjs"]);
  const i = resolverMotor({ LOCALAPPDATA: "D:\\datos" }, { desde: "C:\\suelta\\app\\dist-electron\\cli\\pa", home: "C:\\Users\\f", plat: "win32", existe: (f) => instalada.has(f) });
  assert.equal(i.via, "instalación");
  assert.equal(i.bin, "D:\\datos\\trama\\bin");
  assert.equal(i.hooks, "D:\\datos\\trama\\app\\hooks");
  assert.ok(i.binOk && i.hooksOk);
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
  const bien = resolverMotor({}, { desde: cliPa("/share/app"), home: "/home/ana", plat: "linux", ...disco(motorEn("/share/fuente/motor")) });
  const e1: string[] = [];
  const s = JSON.parse(settingsWorker(paDe(bien, e1), { hb: "/e/hb", leer: false }));
  assert.deepEqual(e1, []);
  assert.match(JSON.stringify(s.hooks), /\/share\/fuente\/motor\/hooks\/latido\.sh/);
  // un motor sin hooks
  const roto = resolverMotor({ TRAMA_MOTOR_DIR: "/home/ana/vacio" }, { home: "/home/ana", plat: "linux", ...disco([]) });
  const e2: string[] = [];
  const pa = paDe(roto, e2);
  settingsWorker(pa, { hb: "/e/hb", leer: false });
  settingsWorker(pa, { hb: "/e/hb", leer: false });
  assert.equal(e2.length, 1);
  assert.match(e2[0]!, /pa: no encuentro los hooks del worker \(latido, destructive-guard\).*vía TRAMA_MOTOR_DIR/);
});

test("Windows nativo: el settings del worker lanza los hooks .mjs del motor resuelto, no bash", () => {
  const dentro = new Set(["C:\\t\\bin\\pa.cmd", "C:\\t\\app\\hooks\\latido.mjs"]);
  const m = resolverMotor({}, { desde: "C:\\t\\app\\dist-electron\\cli\\pa", home: "C:\\Users\\f", plat: "win32", existe: (f) => dentro.has(f) });
  const e: string[] = [];
  const pa = { ...paDe(m, e), plat: "win32", home: "C:\\Users\\f" } as Pa;
  const comandos = JSON.stringify(JSON.parse(settingsWorker(pa, { hb: "C:\\e\\hb", leer: false, node: "C:\\t\\node\\node.exe" })).hooks);
  assert.deepEqual(e, []);
  assert.match(comandos, /C:\/t\/app\/hooks\/latido\.mjs/);
  assert.doesNotMatch(comandos, /bash|latido\.sh/);
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
