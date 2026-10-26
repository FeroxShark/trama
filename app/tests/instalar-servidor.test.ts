// scripts/instalar-servidor.sh y systemd/trama-motor-servidor.service, todo en un tmp y sin tocar nada de
// verdad: un checkout falso con tsc y vite de mentira (escriben en el --outDir que se les pide y anotan qué
// había en el dist/ vivo mientras compilaban), el script en modo prueba (sin systemd, HOME y config en el
// tmp). Comprueba que se compila aparte, que un build que falla no toca el vivo, que no queda nada a medias,
// que la unidad pasa `systemd-analyze --user verify`, y que el motor compilado corre con el `node` pelado
// (sin node_modules ni Electron al lado).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, copyFileSync, renameSync, symlinkSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.join(import.meta.dirname, "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-servidor-"));
const vivos = new Set<ChildProcess>();
after(() => {
  for (const p of vivos) p.kill("SIGKILL");
  rmSync(tmp, { recursive: true, force: true });
});

// --- un checkout falso -----------------------------------------------------------------------------
const raiz = path.join(tmp, "Proyectos", "hilos");
// El script se niega a correr como root (es del usuario de los agentes): en un contenedor root no hay qué probar.
const comoRoot = process.getuid?.() === 0 && "corre como root";
const casa = path.join(tmp, "home");
const config = path.join(tmp, "config");
for (const d of ["scripts", "systemd", "node_modules/.bin", "node_modules/vite/bin", "node_modules/typescript/bin"]) mkdirSync(path.join(raiz, d), { recursive: true });
mkdirSync(casa, { recursive: true });
copyFileSync(path.join(repo, "scripts", "instalar-servidor.sh"), path.join(raiz, "scripts", "instalar-servidor.sh"));
chmodSync(path.join(raiz, "scripts", "instalar-servidor.sh"), 0o755);
copyFileSync(path.join(repo, "systemd", "trama-motor-servidor.service"), path.join(raiz, "systemd", "trama-motor-servidor.service"));
writeFileSync(path.join(raiz, "package.json"), JSON.stringify({ name: "falso", type: "module", version: "0.0.0" }));
writeFileSync(path.join(raiz, "package-lock.json"), "{}");
writeFileSync(path.join(raiz, "tsconfig.electron.json"), "{}");
for (const b of ["tsc", "vite"]) {
  writeFileSync(path.join(raiz, "node_modules", ".bin", b), "#!/bin/sh\n");
  chmodSync(path.join(raiz, "node_modules", ".bin", b), 0o755);
}
// Más nuevo que el package-lock: no hay `npm ci` (no hay red ni npm que valga acá).
writeFileSync(path.join(raiz, "node_modules", ".package-lock.json"), "{}");
utimesSync(path.join(raiz, "node_modules", ".package-lock.json"), new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));

const outDir = `const i = process.argv.indexOf("--outDir"); const out = process.argv[i + 1];`;
writeFileSync(
  path.join(raiz, "node_modules", "vite", "bin", "vite.js"),
  `import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
${outDir}
mkdirSync(out + "/assets", { recursive: true });
writeFileSync(out + "/index.html", "<html>" + readFileSync("version.txt", "utf8") + "</html>");
writeFileSync(out + "/assets/a.js", "//" + readFileSync("version.txt", "utf8"));
`,
);
writeFileSync(
  path.join(raiz, "node_modules", "typescript", "bin", "tsc"),
  `import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync } from "node:fs";
${outDir}
// Lo que ve el motor mientras se compila: el dist/ vivo (no el de .build-nuevo).
appendFileSync("testigo.txt", (existsSync("dist/index.html") ? readFileSync("dist/index.html", "utf8") : "(nada)") + "\\n");
mkdirSync(out, { recursive: true });
writeFileSync(out + "/preload.cjs", "// preload");
writeFileSync(out + "/motor.js", "// " + readFileSync("version.txt", "utf8") + "\\nconsole.log(1);\\n");
if (existsSync("falla")) process.exit(2);
`,
);
const version = (v: string) => writeFileSync(path.join(raiz, "version.txt"), v);

function instalar(...args: string[]) {
  return spawnSync("bash", [path.join(raiz, "scripts", "instalar-servidor.sh"), ...args], {
    cwd: raiz,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: casa,
      XDG_CONFIG_HOME: config,
      HILOS_STATE: path.join(tmp, "estado"),
      TRAMA_SERVIDOR_PRUEBA: "1",
    },
  });
}
const leer = (...p: string[]) => readFileSync(path.join(raiz, ...p), "utf8");
const testigo = () => leer("testigo.txt").trim().split("\n");

test("--mirar no cambia nada", { skip: comoRoot }, () => {
  version("v0");
  const r = instalar("--mirar");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /haría/);
  assert.ok(!existsSync(path.join(raiz, "dist")) && !existsSync(path.join(raiz, "dist-electron")) && !existsSync(path.join(raiz, ".build-nuevo")));
  assert.ok(!existsSync(path.join(config, "systemd")));
});

test("primera instalación: compila aparte, deja el build y enlaza la unidad", { skip: comoRoot }, () => {
  version("v1");
  const r = instalar();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(leer("dist", "index.html"), "<html>v1</html>");
  assert.match(leer("dist-electron", "motor.js"), /v1/);
  assert.ok(existsSync(path.join(raiz, "dist-electron", "preload.cjs")));
  assert.deepEqual(testigo(), ["(nada)"]);
  const enlace = path.join(config, "systemd", "user", "trama-motor-servidor.service");
  assert.equal(readlinkSync(enlace), path.join(raiz, "systemd", "trama-motor-servidor.service"));
  for (const d of [".build-nuevo", ".build-viejo"]) assert.ok(!existsSync(path.join(raiz, d)), `quedó ${d}`);
  assert.match(r.stderr, /remoto\.json/, "avisa que sin remoto.json nadie lo ve por la tailnet");
});

test("una actualización compila sin tocar el dist/ vivo y lo cambia entero al final", { skip: comoRoot }, () => {
  version("v2");
  const r = instalar();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(testigo(), ["(nada)", "<html>v1</html>"], "mientras compilaba, el dist/ vivo seguía siendo el anterior");
  assert.equal(leer("dist", "index.html"), "<html>v2</html>");
  assert.match(leer("dist-electron", "motor.js"), /v2/);
  assert.ok(!existsSync(path.join(raiz, ".build-viejo")) && !existsSync(path.join(raiz, ".build-nuevo")));
});

test("si el build falla, el vivo queda como estaba y no sobra nada", { skip: comoRoot }, () => {
  version("v3");
  writeFileSync(path.join(raiz, "falla"), "");
  const r = instalar();
  rmSync(path.join(raiz, "falla"));
  assert.notEqual(r.status, 0);
  assert.equal(leer("dist", "index.html"), "<html>v2</html>");
  assert.match(leer("dist-electron", "motor.js"), /v2/);
  for (const d of [".build-nuevo", ".build-viejo"]) assert.ok(!existsSync(path.join(raiz, d)), `quedó ${d}`);
});

test("un build incompleto (sin motor.js) no se cambia", { skip: comoRoot }, () => {
  version("v4");
  writeFileSync(path.join(raiz, "node_modules", "typescript", "bin", "tsc"), `import { mkdirSync } from "node:fs"; mkdirSync(process.argv[process.argv.indexOf("--outDir") + 1], { recursive: true });`);
  const r = instalar();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /incompleto/);
  assert.equal(leer("dist", "index.html"), "<html>v2</html>");
});

test("node_modules enlazado: se niega (npm ci borraría lo del otro lado)", { skip: comoRoot }, () => {
  const nm = path.join(raiz, "node_modules");
  const aparte = path.join(tmp, "nm-aparte");
  renameSync(nm, aparte);
  symlinkSync(aparte, nm);
  const r = instalar();
  rmSync(nm);
  renameSync(aparte, nm);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /es un enlace/);
});

test("la unidad pasa systemd-analyze --user verify", { skip: comoRoot || (spawnSync("systemd-analyze", ["--version"]).status !== 0 && "sin systemd-analyze") }, () => {
  // El verify comprueba que el ejecutable exista: un HOME de mentira con el node y el motor en su lugar.
  const h = path.join(tmp, "verify-home");
  mkdirSync(path.join(h, ".local", "bin"), { recursive: true });
  mkdirSync(path.join(h, "Proyectos", "hilos", "dist-electron"), { recursive: true });
  writeFileSync(path.join(h, ".local", "bin", "node"), "#!/bin/sh\n");
  chmodSync(path.join(h, ".local", "bin", "node"), 0o755);
  writeFileSync(path.join(h, "Proyectos", "hilos", "dist-electron", "motor.js"), "");
  const u = path.join(tmp, "verify-unidad");
  mkdirSync(u);
  copyFileSync(path.join(repo, "systemd", "trama-motor-servidor.service"), path.join(u, "trama-motor-servidor.service"));
  const r = spawnSync("systemd-analyze", ["--user", "verify", path.join(u, "trama-motor-servidor.service")], { encoding: "utf8", env: { ...process.env, HOME: h } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.stderr.trim() + r.stdout.trim(), "");
});

test("la unidad: sin Electron, con el tope de workers y sin que un worker muerto baje al motor", () => {
  const u = readFileSync(path.join(repo, "systemd", "trama-motor-servidor.service"), "utf8");
  const activas = u.split("\n").filter((l) => !l.startsWith("#"));
  assert.ok(activas.includes("Environment=PA_TOPE=2"));
  assert.ok(activas.includes("OOMPolicy=continue"));
  assert.ok(activas.includes("KillMode=process"));
  assert.ok(activas.includes("ExecStart=%h/.local/bin/node %h/Proyectos/hilos/dist-electron/motor.js"));
  assert.ok(!activas.some((l) => /ELECTRON_RUN_AS_NODE|node_modules/.test(l)));
  // OOMScoreAdjust negativo no lo puede aplicar una unidad de usuario: no va (sólo se nombra en el comentario).
  assert.ok(!activas.some((l) => l.startsWith("OOMScoreAdjust")));
});

test("el motor compilado corre con el node pelado, sin node_modules ni Electron", { timeout: 90_000 }, async () => {
  const r2 = path.join(tmp, "pelado");
  mkdirSync(path.join(r2, "dist"), { recursive: true });
  writeFileSync(path.join(r2, "dist", "index.html"), "<html></html>");
  copyFileSync(path.join(repo, "package.json"), path.join(r2, "package.json"));
  execFileSync(process.execPath, [path.join(repo, "node_modules", "typescript", "bin", "tsc"), "-p", path.join(repo, "tsconfig.electron.json"), "--outDir", path.join(r2, "dist-electron")], {
    cwd: repo,
    stdio: "pipe",
  });
  assert.ok(!existsSync(path.join(r2, "node_modules")));
  const run = path.join(tmp, "run");
  mkdirSync(run, { mode: 0o700 });
  const estado = path.join(tmp, "estado-motor");
  const p = spawn(process.execPath, [path.join(r2, "dist-electron", "motor.js")], {
    cwd: r2,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      PATH: process.env.PATH,
      HOME: path.join(tmp, "home-motor"),
      XDG_RUNTIME_DIR: run,
      HILOS_STATE: estado,
      HILOS_SESIONES: path.join(tmp, "sesiones"),
      CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
      PA_STATE: path.join(tmp, "pa"),
      PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
      HILOS_PA: path.join(repo, "scripts", "pa-falso.sh"),
      HILOS_CLAUDE: path.join(repo, "scripts", "claude-falso.mjs"),
      HILOS_TABLERO: "/bin/false",
      HILOS_TAILSCALE: "/bin/false",
      HILOS_HISTORIAL: "0",
      TRAMA_UNIDAD: "1",
      PA_TOPE: "2",
    },
  });
  vivos.add(p);
  let err = "";
  p.stderr!.on("data", (d) => (err += d));
  const salida = new Promise<number | null>((ok) => p.once("exit", (c) => (vivos.delete(p), ok(c))));
  const fin = Date.now() + 20_000;
  while (!existsSync(path.join(estado, "dueno")) || !existsSync(path.join(run, "trama", "motor.sock"))) {
    if (Date.now() > fin) throw new Error("el motor no arrancó: " + err);
    await new Promise((r) => setTimeout(r, 50));
  }
  p.kill("SIGTERM");
  assert.equal(await salida, 0, err);
  assert.ok(!existsSync(path.join(estado, "dueno")), "soltó el dueño al salir");
});
