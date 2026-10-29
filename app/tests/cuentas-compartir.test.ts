// Lo compartido de una cuenta agregada de Claude en Windows (junction/hardlink) y la migración sin pérdida de lo que la cuenta ya
// tenía propio. Windows se simula (platform win32 + junction y hardlink inyectados): en Linux se materializan como symlink/hardlink.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../electron/cli/cuentas.ts";
import { soloPosix } from "./plataforma.ts";

const raiz = mkdtempSync(path.join(os.tmpdir(), "trama-compartir-"));
after(() => rmSync(raiz, { recursive: true, force: true }));
let n = 0;

function escenario() {
  const home = path.join(raiz, `h${n++}`);
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  const env = { HOME: home, TRAMA_CUENTAS_HOME: home, TRAMA_CUENTAS: path.join(home, "cfg", "cuentas.json"), PATH: "/usr/bin:/bin" };
  const dir = path.join(home, "cfg", "cuentas", "sonda");
  const tipos: string[] = [];
  const enlace = {
    // Windows pediría un junction a la ruta de Windows; acá se arma el symlink al destino de verdad (el mismo nombre bajo ~/.claude).
    symlink: (_d: string, e: string, t?: string) => {
      tipos.push(`${path.basename(e)}:${t}`);
      symlinkSync(path.join(home, ".claude", path.basename(e)), e, "dir");
    },
    link: (d: string, e: string) => {
      tipos.push(`${path.basename(e)}:hardlink`);
      linkSync(d, e);
    },
  };
  const correr = async (plataforma: NodeJS.Platform, ...a: string[]) => {
    const real = process.platform;
    let err = "";
    Object.defineProperty(process, "platform", { value: plataforma });
    try {
      const rc = await main(a, env, { out: () => {}, err: (s) => (err += s) }, enlace);
      return { rc, err };
    } finally {
      Object.defineProperty(process, "platform", { value: real });
    }
  };
  const w = (p: string, t: string) => (mkdirSync(path.dirname(p), { recursive: true }), writeFileSync(p, t));
  return { home, dir, tipos, correr, w, claude: (...p: string[]) => path.join(home, ".claude", ...p) };
}

const esEnlace = (p: string) => lstatSync(p).isSymbolicLink();

test("win32: agregar con ~/.claude completo deja junction en carpetas y hardlink en archivos", { skip: soloPosix("symlinks de prueba") }, async () => {
  const e = escenario();
  for (const c of ["hooks", "skills", "agents", "commands", "plugins", "projects", "sessions", "output-styles"]) mkdirSync(e.claude(c));
  e.w(e.claude("settings.json"), "{}");
  e.w(e.claude("CLAUDE.md"), "x");
  const r = await e.correr("win32", "agregar", "claude", "Sonda");
  assert.equal(r.rc, 0);
  for (const c of ["hooks", "skills", "plugins", "projects", "agents"]) assert.ok(e.tipos.includes(`${c}:junction`), c);
  assert.ok(e.tipos.includes("settings.json:hardlink") && e.tipos.includes("CLAUDE.md:hardlink"));
  assert.equal(statSync(path.join(e.dir, "settings.json")).ino, statSync(e.claude("settings.json")).ino);
});

test("migración: carpetas propias con contenido se mueven a ~/.claude sin pisar y recién ahí pasan a junction", { skip: soloPosix("symlinks de prueba") }, async () => {
  const e = escenario();
  e.w(e.claude("projects", "-proy-a", "uno.jsonl"), "A1");
  mkdirSync(e.claude("plugins"));
  await e.correr("win32", "agregar", "claude", "Sonda");
  // Claude crea cosas propias porque no había enlace (el escenario las pone como carpetas reales)
  for (const c of ["projects", "plugins", "skills"]) rmSync(path.join(e.dir, c), { recursive: true, force: true });
  e.w(path.join(e.dir, "projects", "-proy-a", "dos.jsonl"), "A2");
  e.w(path.join(e.dir, "projects", "-proy-a", "uno.jsonl"), "A1"); // mismo contenido: no se pierde
  e.w(path.join(e.dir, "projects", "-proy-b", "tres.jsonl"), "B3");
  e.w(path.join(e.dir, "plugins", "config.json"), "P");
  e.w(path.join(e.dir, "skills", "mia", "SKILL.md"), "S"); // ~/.claude/skills no existe
  const r = await e.correr("win32", "env", "sonda");
  assert.equal(r.rc, 0);
  assert.equal(r.err, "");
  assert.equal(readFileSync(e.claude("projects", "-proy-a", "dos.jsonl"), "utf8"), "A2");
  assert.equal(readFileSync(e.claude("projects", "-proy-a", "uno.jsonl"), "utf8"), "A1");
  assert.equal(readFileSync(e.claude("projects", "-proy-b", "tres.jsonl"), "utf8"), "B3");
  assert.equal(readFileSync(e.claude("plugins", "config.json"), "utf8"), "P");
  assert.equal(readFileSync(e.claude("skills", "mia", "SKILL.md"), "utf8"), "S");
  for (const c of ["projects", "plugins", "skills"]) {
    assert.ok(esEnlace(path.join(e.dir, c)), c);
    assert.equal(realpathSync(path.join(e.dir, c)), realpathSync(e.claude(c)));
  }
});

test("migración: lo que choca con distinto contenido no se pisa ni se borra y se avisa; la carpeta sigue propia", { skip: soloPosix("symlinks de prueba") }, async () => {
  const e = escenario();
  e.w(e.claude("plugins", "a.json"), "DE-CLAUDE");
  await e.correr("win32", "agregar", "claude", "Sonda");
  rmSync(path.join(e.dir, "plugins"), { recursive: true, force: true });
  e.w(path.join(e.dir, "plugins", "a.json"), "DE-LA-CUENTA");
  e.w(path.join(e.dir, "plugins", "b.json"), "B");
  const r = await e.correr("win32", "env", "sonda");
  assert.match(r.err, /sonda: .*plugins sigue siendo propia: 1 cosa/);
  assert.equal(readFileSync(e.claude("plugins", "a.json"), "utf8"), "DE-CLAUDE");
  assert.equal(readFileSync(path.join(e.dir, "plugins", "a.json"), "utf8"), "DE-LA-CUENTA");
  assert.equal(readFileSync(e.claude("plugins", "b.json"), "utf8"), "B"); // lo que sí se podía mover se movió
  assert.ok(!esEnlace(path.join(e.dir, "plugins")));
});

test("migración de archivos: settings.json vacío se reemplaza por hardlink; copia vieja se actualiza con respaldo; más nuevo y distinto se conserva", { skip: soloPosix("symlinks de prueba") }, async () => {
  const e = escenario();
  e.w(e.claude("settings.json"), '{"a":1}');
  await e.correr("win32", "agregar", "claude", "Sonda");
  const t = path.join(e.dir, "settings.json");
  rmSync(t, { force: true });
  e.w(t, ""); // el que crea Claude
  await e.correr("win32", "env", "sonda");
  assert.equal(statSync(t).ino, statSync(e.claude("settings.json")).ino);
  // copia desacoplada y vieja
  rmSync(t);
  e.w(t, '{"viejo":1}');
  utimesSync(t, new Date(2020, 1, 1), new Date(2020, 1, 1));
  await e.correr("win32", "env", "sonda");
  assert.equal(readFileSync(t, "utf8"), '{"a":1}');
  assert.equal(readFileSync(t + ".trama-previo", "utf8"), '{"viejo":1}');
  // propia y más nueva: se conserva
  rmSync(t);
  e.w(t, '{"propio":1}');
  utimesSync(e.claude("settings.json"), new Date(2020, 1, 1), new Date(2020, 1, 1));
  const r = await e.correr("win32", "env", "sonda");
  assert.match(r.err, /más nuevo/);
  assert.equal(readFileSync(t, "utf8"), '{"propio":1}');
});

test("migración de archivos: sin original en ~/.claude, el de la cuenta se mueve allá y queda enlazado", { skip: soloPosix("symlinks de prueba") }, async () => {
  const e = escenario();
  await e.correr("win32", "agregar", "claude", "Sonda");
  e.w(path.join(e.dir, "settings.json"), '{"solo":1}');
  await e.correr("win32", "env", "sonda");
  assert.equal(readFileSync(e.claude("settings.json"), "utf8"), '{"solo":1}');
  assert.equal(statSync(path.join(e.dir, "settings.json")).ino, statSync(e.claude("settings.json")).ino);
  assert.ok(existsSync(e.dir) && readdirSync(e.dir).length > 0);
});

test("linux: una carpeta propia con contenido también se migra (symlink)", { skip: soloPosix("symlinks") }, async () => {
  const e = escenario();
  await e.correr("linux", "agregar", "claude", "Sonda");
  rmSync(path.join(e.dir, "projects"), { recursive: true, force: true });
  e.w(path.join(e.dir, "projects", "-p", "x.jsonl"), "X");
  await e.correr("linux", "env", "sonda");
  assert.equal(readFileSync(e.claude("projects", "-p", "x.jsonl"), "utf8"), "X");
  assert.ok(esEnlace(path.join(e.dir, "projects")));
});
