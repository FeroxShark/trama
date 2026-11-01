// El aislamiento de las corridas de prueba (electron/aislar.ts): qué cuenta como dato de Ana.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const { crearAislamiento, codigoSalida } = await import("../electron/aislar.ts");

// Rutas armadas con path.resolve: en Windows quedan como C:\home\ana, en Linux como /home/ana.
const R = (...p: string[]) => path.resolve(path.sep, ...p);
const ANA = R("home", "ana");
const TMP = R("tmp");
const armar = () => {
  const anotadas: string[] = [];
  const a = crearAislamiento({ home: [ANA], permitidas: [R("home", "ana", "proy", "hilos")], temporales: [TMP], anotar: (l: string) => anotadas.push(l) });
  return { a, anotadas };
};

test("lo de Ana: bajo el home y fuera del checkout", () => {
  const { a } = armar();
  assert.equal(a.ajeno(R("home", "ana", ".claude", "projects", "x.jsonl")), true);
  assert.equal(a.ajeno(R("home", "ana", ".local", "state", "hilos", "nombres.json")), true);
  assert.equal(a.ajeno(R("home", "ana", "CLAUDE.md")), true);
  assert.equal(a.ajeno(R("home", "ana", ".claude", "..", ".config", "proyectos", "registry.json")), true);
});

test("no es de Ana: el checkout, /tmp, el home mismo y lo de otro lado", () => {
  const { a } = armar();
  assert.equal(a.ajeno(R("home", "ana", "proy", "hilos", "dist", "index.html")), false);
  assert.equal(a.ajeno(R("home", "ana", "proy", "hilos")), false);
  assert.equal(a.ajeno(R("tmp", "trama-captura-1", "estado")), false);
  assert.equal(a.ajeno(ANA), false);
  assert.equal(a.ajeno(`${ANA}.bak${path.sep}x`), false);
  assert.equal(a.ajeno(R("usr", "lib", "x")), false);
});

test("el tmp que cuelga del home no es de Ana (en Windows %TEMP% está bajo el perfil)", () => {
  const tmp = R("home", "ana", "AppData", "Local", "Temp");
  const a = crearAislamiento({ home: [ANA], permitidas: [], temporales: [tmp], anotar: () => {} });
  assert.equal(a.ajeno(path.join(tmp, "trama-test-casa-1", "home", ".config")), false);
  assert.equal(a.ajeno(R("home", "ana", "AppData", "Local", "Otro", "x")), true);
  assert.equal(a.binarioAjeno(path.join(tmp, "falso", "pa")), false);
});

test("un binario: el nombre suelto cuenta, /tmp y el checkout no", () => {
  const { a } = armar();
  assert.equal(a.binarioAjeno("claude"), true);
  assert.equal(a.binarioAjeno(R("home", "ana", ".local", "bin", "pa")), true);
  assert.equal(a.binarioAjeno(R("tmp", "falso", "pa")), false);
  assert.equal(a.binarioAjeno(R("home", "ana", "proy", "hilos", "scripts", "pa-falso.sh")), false);
  assert.equal(a.binarioAjeno(R("usr", "bin", "env")), false);
});

test("un nombre suelto cuenta sólo si el PATH tiene carpetas del home", () => {
  const limpio = crearAislamiento({ home: [ANA], permitidas: [], temporales: [TMP], camino: () => [R("usr", "bin"), R("bin")].join(path.delimiter), anotar: () => {} });
  assert.equal(limpio.binarioAjeno("git"), false);
  const sucio = crearAislamiento({ home: [ANA], permitidas: [], temporales: [TMP], camino: () => [R("usr", "bin"), R("home", "ana", ".local", "bin")].join(path.delimiter), anotar: () => {} });
  assert.equal(sucio.binarioAjeno("git"), true);
});

test("sin violaciones el código de salida no cambia", () => {
  assert.equal(codigoSalida(0), 0);
  assert.equal(codigoSalida(3), 3);
});

// El cable de la suite: la precarga de `node --test` (scripts/aislar-pruebas.mjs) arma el aislamiento en cada archivo, y tocar el
// home de la persona (aunque sea sólo mirar un archivo que no existe) sale con 97. Si se quita la precarga, esta prueba falla.
test("la precarga de node --test arma el aislamiento: tocar el home de la persona sale con 97", () => {
  const precarga = path.join(import.meta.dirname, "..", "scripts", "aislar-pruebas.mjs");
  const sonda = `import fs from "node:fs"; import os from "node:os"; import path from "node:path"; fs.existsSync(path.join(os.userInfo().homedir, ".trama-aislar-sonda"));`;
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(precarga).href, "--input-type=module", "-e", sonda], { encoding: "utf8" });
  assert.equal(r.status, 97, r.stderr);
  assert.match(r.stderr, /\[aislar\] fs\.existsSync .*\.trama-aislar-sonda/);
});
