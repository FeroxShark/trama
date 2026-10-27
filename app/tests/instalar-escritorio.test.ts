// scripts/instalar.sh (--raiz, --sin-motor, StartupWMClass), el paso de escritorio de motor/scripts/instalar-producto.sh
// y la rama de `opencode auth list` de motor/bin/trama-estado. Todo en un tmp con HOME y XDG propios, un systemctl y
// un npm de mentira en el PATH y un install.js de Electron falso: no se baja ni se toca nada de verdad.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const repo = path.join(import.meta.dirname, "..");
const motor = path.join(repo, "..", "motor");
const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-escritorio-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

function ejecutable(ruta: string, texto: string) {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, texto);
  chmodSync(ruta, 0o755);
}

/** Un `systemctl` que contesta que hay systemd de usuario y anota cada llamada en `log`. */
function systemctlFalso(bin: string, log: string) {
  ejecutable(path.join(bin, "systemctl"), `#!/bin/sh\necho "$*" >>'${log}'\ncase "$*" in *show-environment*) exit 0;; *is-active*|*is-enabled*) exit 1;; esac\nexit 0\n`);
}

function casa(nombre: string) {
  const dir = path.join(tmp, nombre);
  const h = path.join(dir, "home");
  mkdirSync(h, { recursive: true });
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const log = path.join(dir, "systemctl.log");
  writeFileSync(log, "");
  systemctlFalso(bin, log);
  const env = { ...process.env, USER: "trama", HOME: h, XDG_DATA_HOME: path.join(h, ".local", "share"), XDG_CONFIG_HOME: path.join(h, ".config"), PATH: `${bin}:${process.env.PATH}` };
  return { dir, h, bin, log, env };
}

// --- app/scripts/instalar.sh -----------------------------------------------------------------------------
/** Una app mínima ya "compilada" para que instalar.sh no corra npm. */
function appFalsa(raiz: string) {
  for (const f of ["scripts/instalar.sh", "scripts/registrar-hook.mjs", "systemd/trama.service", "systemd/trama-motor.service", "public/favicon.svg", "public/icon.png"]) {
    mkdirSync(path.dirname(path.join(raiz, f)), { recursive: true });
    copyFileSync(path.join(repo, f), path.join(raiz, f));
  }
  ejecutable(path.join(raiz, "node_modules", "electron", "dist", "electron"), "#!/bin/sh\n");
  mkdirSync(path.join(raiz, "dist"), { recursive: true });
  mkdirSync(path.join(raiz, "dist-electron"), { recursive: true });
  writeFileSync(path.join(raiz, "dist", "index.html"), "");
  writeFileSync(path.join(raiz, "dist-electron", "main.js"), "");
}

function worktree(c: ReturnType<typeof casa>) {
  const principal = path.join(c.dir, "principal");
  const wt = path.join(c.dir, "wt");
  const git = (...a: string[]) => spawnSync("git", ["-C", principal, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
  mkdirSync(principal, { recursive: true });
  git("init", "-q");
  writeFileSync(path.join(principal, "x"), "x");
  git("add", "x");
  git("commit", "-q", "-m", "x");
  const r = git("worktree", "add", "-q", wt);
  assert.equal(r.status, 0, r.stderr);
  appFalsa(wt);
  return wt;
}

test("instalar.sh sin --raiz se niega desde un worktree, con --raiz no", () => {
  const c = casa("wt");
  const wt = worktree(c);
  const sin = spawnSync("bash", [path.join(wt, "scripts", "instalar.sh")], { encoding: "utf8", env: c.env });
  assert.equal(sin.status, 1);
  assert.match(sin.stderr, /worktree/);
  const con = spawnSync("bash", [path.join(wt, "scripts", "instalar.sh"), "--raiz", wt], { encoding: "utf8", env: c.env });
  assert.equal(con.status, 0, con.stderr + con.stdout);
  assert.ok(existsSync(path.join(c.h, ".local", "bin", "trama")));
  assert.match(readFileSync(path.join(c.h, ".local", "bin", "trama"), "utf8"), new RegExp(`raiz='${wt}'`));
});

test("instalar.sh: StartupWMClass=trama", () => {
  const c = casa("wm");
  const wt = worktree(c);
  const r = spawnSync("bash", [path.join(wt, "scripts", "instalar.sh"), "--raiz", wt, "--sin-motor"], { encoding: "utf8", env: c.env });
  assert.equal(r.status, 0, r.stderr);
  const d = readFileSync(path.join(c.h, ".local", "share", "applications", "trama.desktop"), "utf8");
  assert.match(d, /^StartupWMClass=trama$/m);
});

test("instalar.sh --sin-motor no escribe trama-motor.service; sin la opción sí", () => {
  const c = casa("motor");
  const wt = worktree(c);
  const unidad = path.join(c.h, ".config", "systemd", "user");
  let r = spawnSync("bash", [path.join(wt, "scripts", "instalar.sh"), "--raiz", wt, "--sin-motor"], { encoding: "utf8", env: c.env });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(path.join(unidad, "trama.service")));
  assert.ok(!existsSync(path.join(unidad, "trama-motor.service")));
  assert.ok(!/trama-motor/.test(readFileSync(c.log, "utf8")), readFileSync(c.log, "utf8"));
  r = spawnSync("bash", [path.join(wt, "scripts", "instalar.sh"), "--raiz", wt], { encoding: "utf8", env: c.env });
  assert.equal(r.status, 0, r.stderr);
  const u = readFileSync(path.join(unidad, "trama-motor.service"), "utf8");
  assert.ok(u.includes(wt) && !u.includes("@RAIZ@"));
});

// --- instalar-producto.sh --escritorio ---------------------------------------------------------------------
const comoRoot = process.getuid?.() === 0 && "corre como root (el instalador del producto haría el paso apt)";

test("instalar-producto.sh --escritorio: baja Electron una sola vez, instala el lanzador y reinicia trama.service", { skip: comoRoot }, async () => {
  const c = casa("producto");
  const bitacora = path.join(c.dir, "electron.log");
  // npm falso: `ci` deja tsc, vite y el install.js de Electron; `run build` deja el build.
  ejecutable(path.join(c.bin, "npm"), `#!/bin/sh
case "$1" in
  ci) mkdir -p node_modules/.bin node_modules/electron
      for b in tsc vite; do printf '#!/bin/sh\\n' >node_modules/.bin/$b; chmod +x node_modules/.bin/$b; done
      cat >node_modules/electron/install.js <<'JS'
const fs = require("fs");
fs.mkdirSync(__dirname + "/dist", { recursive: true });
fs.writeFileSync(__dirname + "/dist/electron", "#!/bin/sh\\n", { mode: 0o755 });
fs.appendFileSync(process.env.FAKE_ELECTRON_LOG, "install\\n");
JS
      ;;
  run) mkdir -p dist dist-electron; : >dist/index.html; : >dist-electron/motor.js ;;
esac
exit 0
`);
  const app = path.join(c.dir, "app-fuente");
  mkdirSync(path.join(app, "scripts"), { recursive: true });
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "trama", version: "0.0.0" }));
  writeFileSync(path.join(app, "package-lock.json"), "{}");
  appFalsa(app);
  rmSync(path.join(app, "node_modules"), { recursive: true, force: true });
  rmSync(path.join(app, "dist"), { recursive: true, force: true });
  rmSync(path.join(app, "dist-electron"), { recursive: true, force: true });

  // Algo que conteste en el puerto del motor, para no esperar los 20 s de motor_arriba.
  const srv = http.createServer((_, res) => res.end("ok"));
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const puerto = (srv.address() as { port: number }).port;
  const env = { ...c.env, TRAMA_INSTALAR_CLI: "0", TRAMA_PUERTO: String(puerto), FAKE_ELECTRON_LOG: bitacora, WAYLAND_DISPLAY: "", DISPLAY: "" };
  const correr = (...args: string[]) =>
    new Promise<{ status: number | null; salida: string }>((res) => {
      const p = spawn("bash", [path.join(motor, "scripts", "instalar-producto.sh"), "--app", app, ...args], { env });
      let salida = "";
      p.stdout.on("data", (d) => (salida += d));
      p.stderr.on("data", (d) => (salida += d));
      p.on("close", (status) => res({ status, salida }));
    });
  try {
    // Sin sesión gráfica y sin la opción: no se toca el escritorio.
    const sin = await correr();
    assert.equal(sin.status, 0, sin.salida);
    assert.ok(!existsSync(path.join(c.h, ".local", "bin", "trama")), sin.salida);
    assert.ok(!/app de escritorio/.test(sin.salida));
    // --sin-escritorio gana aunque haya sesión gráfica.
    env.WAYLAND_DISPLAY = "wayland-0";
    const no = await correr("--sin-escritorio");
    assert.ok(!existsSync(path.join(c.h, ".local", "bin", "trama")), no.salida);

    const r = await correr("--escritorio");
    assert.equal(r.status, 0, r.salida);
    const dst = path.join(c.h, ".local", "share", "trama", "app");
    assert.match(r.salida, /^ok\s+app de escritorio: /m);
    assert.ok(existsSync(path.join(dst, "node_modules", "electron", "dist", "electron")));
    assert.match(readFileSync(path.join(c.h, ".local", "bin", "trama"), "utf8"), new RegExp(`raiz='${dst}'`));
    assert.match(readFileSync(path.join(c.h, ".local", "share", "applications", "trama.desktop"), "utf8"), /StartupWMClass=trama/);
    assert.match(readFileSync(c.log, "utf8"), /try-restart trama\.service/);
    assert.equal(readFileSync(bitacora, "utf8"), "install\n");
    // La unidad del motor es la del producto (con node), no la de instalar.sh.
    assert.match(readFileSync(path.join(c.h, ".config", "systemd", "user", "trama-motor.service"), "utf8"), /Generada por instalar-producto\.sh/);

    // Segunda corrida: Electron ya está y el lock no cambió, no se baja de nuevo.
    const otra = await correr("--escritorio");
    assert.match(otra.salida, /^ok\s+app de escritorio: /m);
    assert.equal(readFileSync(bitacora, "utf8"), "install\n");
  } finally {
    srv.close();
  }
});

// --- trama-estado ----------------------------------------------------------------------------------------------
test("trama-estado: opencode sin auth.json pero con `auth list` de 2.x cuenta como logueado", { skip: spawnSync("python3", ["--version"]).status !== 0 && "sin python3" }, () => {
  const c = casa("estado");
  const falso = path.join(c.dir, "opencode");
  ejecutable(falso, `#!/bin/sh\ncase "$1" in --version) echo 2.0.1;; auth) printf '\\033[1mCredentials\\033[0m\\n  OpenCode Console  Personal   stored\\n';; esac\n`);
  const estado = (extra: Record<string, string>) => {
    const r = spawnSync("python3", [path.join(motor, "bin", "trama-estado"), "--json"], { encoding: "utf8", env: { ...c.env, HILOS_OPENCODE: falso, ...extra } });
    return JSON.parse(r.stdout);
  };
  const j = estado({});
  const op = j.opencode ?? j.programas?.opencode;
  assert.equal(op.instalado, true);
  assert.equal(op.logueado, true);
  // Sin la línea "stored" no cuenta.
  ejecutable(falso, `#!/bin/sh\ncase "$1" in --version) echo 2.0.1;; auth) echo '0 credentials';; esac\n`);
  const k = estado({});
  assert.equal((k.opencode ?? k.programas?.opencode).logueado, false);
});
