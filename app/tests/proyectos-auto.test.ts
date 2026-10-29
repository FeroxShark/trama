// Alta automática de proyectos (electron/proyectos-auto.ts): la carpeta de cada líder queda en el registry sola, sin el home, sin
// carpetas del sistema y sin repetidos (en Windows sin distinguir mayúsculas). Rutas de las dos plataformas, con `plat` inyectado.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claveRuta, esCarpetaDeSistema, nombreParaAlta, normalizar, registrarCarpetas } from "../electron/proyectos-auto.ts";
import { POSIX } from "./plataforma.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-auto-"));
let n = 0;
const nuevoRegistro = (projects?: object[]) => {
  const f = path.join(tmp, `r${n++}`, "registry.json");
  if (projects) {
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify({ projects }));
  }
  return f;
};
const leer = (f: string) => (JSON.parse(readFileSync(f, "utf8")).projects as Record<string, unknown>[]);
const todasExisten = async () => true;
const mismaRuta = async (p: string) => p;

const WIN = { plat: "win32" as const, home: "C:\\Users\\Ana", existe: todasExisten, real: mismaRuta };
const LIN = { plat: "linux" as const, home: "/home/ana", existe: todasExisten, real: mismaRuta };

test("claveRuta: Windows sin mayúsculas ni distinguir / de \; Linux sí distingue", () => {
  assert.equal(claveRuta("C:\\Users\\Ana\\Proyectos\\App\\", "win32"), claveRuta("c:/users/ana/proyectos/app", "win32"));
  assert.equal(normalizar("C:/Users/Ana/App/", "win32"), "C:\\Users\\Ana\\App");
  assert.equal(normalizar("\\\\?\\C:\\Users\\Ana\\App", "win32"), "C:\\Users\\Ana\\App");
  assert.notEqual(claveRuta("/home/ana/App", "linux"), claveRuta("/home/ana/app", "linux"));
  assert.equal(claveRuta("/home/ana/app/", "linux"), "/home/ana/app");
});

test("esCarpetaDeSistema: home, raíces y sistema en Windows y Linux; las carpetas de trabajo no", () => {
  for (const r of ["C:\\Users\\Ana", "c:\\users\\ana\\", "C:\\", "D:\\", "C:\\Users", "C:\\Windows", "C:\\Windows\\System32", "C:\\Program Files\\Git", "C:\\Program Files (x86)\\X", "C:\\ProgramData"])
    assert.equal(esCarpetaDeSistema(r, "C:\\Users\\Ana", "win32"), true, r);
  for (const r of ["C:\\Users\\Ana\\Proyectos\\app", "D:\\trabajo\\app", "C:\\Users\\Ana\\Documents", "C:\\Programas\\app"])
    assert.equal(esCarpetaDeSistema(r, "C:\\Users\\Ana", "win32"), false, r);
  for (const r of ["/home/ana", "/home/ana/", "/", "/home", "/etc", "/usr/lib/x", "/var/log", "/bin", "/root"]) assert.equal(esCarpetaDeSistema(r, "/home/ana", "linux"), true, r);
  for (const r of ["/home/ana/proyectos/app", "/srv/app", "/opt/app", "/tmp/x", "/mnt/datos/app"]) assert.equal(esCarpetaDeSistema(r, "/home/ana", "linux"), false, r);
});

test("nombreParaAlta: el de la carpeta; si choca <padre>-<carpeta>, y después -2", () => {
  assert.equal(nombreParaAlta("C:\\Users\\Ana\\Mi App", new Set(), "win32"), "Mi App");
  assert.equal(nombreParaAlta("/home/ana/app", new Set(["app"]), "linux"), "ana-app");
  assert.equal(nombreParaAlta("/home/ana/app", new Set(["app", "ana-app"]), "linux"), "app-2");
  assert.equal(nombreParaAlta("/home/ana/App", new Set(["app"]), "linux"), "ana-App", "sin distinguir mayúsculas");
  assert.equal(nombreParaAlta("/home/ana/-raro", new Set(), "linux"), "raro");
});

test("Windows: registry vacío o inexistente se llena con las carpetas de los líderes, sin el home ni el sistema", async () => {
  const f = nuevoRegistro();
  const alta = await registrarCarpetas(
    f,
    ["C:\\Users\\Ana\\Proyectos\\tienda", "D:\\trabajo\\blog", "C:\\Users\\Ana", "C:\\Windows\\System32", "C:\\Program Files\\X", "C:\\", "relativa\\x", ""],
    WIN,
  );
  assert.deepEqual(alta, ["tienda", "blog"]);
  assert.deepEqual(leer(f), [
    { name: "tienda", path: "C:\\Users\\Ana\\Proyectos\\tienda" },
    { name: "blog", path: "D:\\trabajo\\blog" },
  ]);
});

test("Windows: sin duplicados aunque cambien mayúsculas, barras o la barra final; ni con carpetas ya anotadas", async () => {
  const f = nuevoRegistro([{ name: "Tienda", path: "C:\\Users\\Ana\\Proyectos\\Tienda", logo: "data:image/png;base64,xx", extra: 1 }]);
  const antes = readFileSync(f, "utf8");
  assert.deepEqual(await registrarCarpetas(f, ["c:/users/ana/proyectos/tienda/", "C:\\USERS\\ANA\\PROYECTOS\\TIENDA"], WIN), []);
  assert.equal(readFileSync(f, "utf8"), antes, "sin cambios no se reescribe");
  assert.deepEqual(await registrarCarpetas(f, ["D:\\a\\blog", "d:\\A\\Blog\\", "D:/a/BLOG"], WIN), ["blog"]);
  const ps = leer(f);
  assert.equal(ps.length, 2);
  assert.deepEqual(ps[0], { name: "Tienda", path: "C:\\Users\\Ana\\Proyectos\\Tienda", logo: "data:image/png;base64,xx", extra: 1 }, "lo anotado queda tal cual");
});

test("Windows: dos carpetas con el mismo nombre en lugares distintos no repiten nombre; los worktrees de pa no se anotan", async () => {
  const f = nuevoRegistro([{ name: "app", path: "C:\\x\\app" }]);
  const alta = await registrarCarpetas(f, ["D:\\otro\\app", "C:\\Users\\Ana\\AppData\\Local\\trama\\estado\\pa\\worktrees\\app@2", "C:\\Users\\Ana\\pa\\worktrees\\app@1"], WIN);
  assert.deepEqual(alta, ["otro-app"]);
});

test("Linux: se anota con el nombre de la carpeta; ~ y sistema no; repetidos con barra final no", async () => {
  const f = nuevoRegistro([{ name: "trama", path: "~/Proyectos/trama" }]);
  const alta = await registrarCarpetas(f, ["/home/ana/Proyectos/trama/", "/home/ana/Proyectos/shark", "/home/ana", "/etc", "/usr/share/x", "/srv/web"], LIN);
  assert.deepEqual(alta, ["shark", "web"]);
  assert.deepEqual(
    leer(f).map((p) => p.name),
    ["trama", "shark", "web"],
  );
  assert.deepEqual(await registrarCarpetas(f, ["/home/ana/Proyectos/shark", "/srv/web/"], LIN), []);
});

test("carpeta que no existe: no se anota", async () => {
  const f = nuevoRegistro([]);
  assert.deepEqual(await registrarCarpetas(f, ["/srv/fantasma"], { ...LIN, existe: async () => false }), []);
  assert.deepEqual(leer(f), []);
});

test("un registry que no se puede leer no se pisa; el .bak queda al escribir", async () => {
  const f = nuevoRegistro();
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, "{ roto");
  assert.deepEqual(await registrarCarpetas(f, ["/srv/web"], LIN), []);
  assert.equal(readFileSync(f, "utf8"), "{ roto");
  const g = nuevoRegistro([{ name: "uno", path: "/srv/uno" }]);
  await registrarCarpetas(g, ["/srv/web"], LIN);
  assert.equal(JSON.parse(readFileSync(`${g}.bak`, "utf8")).projects.length, 1);
});

test("altas simultáneas no se pisan", async () => {
  const f = nuevoRegistro([]);
  await Promise.all(["a", "b", "c", "d", "e"].map((x) => registrarCarpetas(f, [`/srv/${x}`], LIN)));
  assert.deepEqual(leer(f).map((p) => p.name).sort(), ["a", "b", "c", "d", "e"]);
});

test("Linux real: un symlink a una carpeta ya anotada es el mismo proyecto", { skip: !POSIX && "symlinks" }, async () => {
  const real = path.join(tmp, "real-app");
  mkdirSync(real);
  const enlace = path.join(tmp, "enlace-app");
  symlinkSync(real, enlace);
  const f = nuevoRegistro([{ name: "app", path: enlace }]);
  assert.deepEqual(await registrarCarpetas(f, [real, enlace], { home: "/nadie", plat: "linux" }), []);
  assert.equal(existsSync(`${f}.bak`), false);
});
