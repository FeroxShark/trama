#!/usr/bin/env node
// Prueba de humo del motor, igual en Linux y en Windows (etapa 17 del port, motor/docs/port-windows-plan.md; la corre el job
// `windows` de .github/workflows/ci.yml). Todo en un tmp (HOME, estado, registry, repo git): nunca los datos del usuario.
//   locks      un lock tomado se ve, no se toma dos veces, y se suelta solo cuando muere el proceso que lo tenía
//   enlaces    carpeta enlazada (symlink / junction) y borrarla no toca el destino
//   pa         el pa de TS como proceso (--brief) y el de async.ts (--estado), arrancados por ruta como en el instalador
//   primer     lanzar un worker en primer plano con un claude falso: rc 0, argv, json, .ultimo
//   async      lanzar con lanzarAsync (proceso suelto), pa --esperar y su resultado
//   matar      un worker colgado, pa <proy> --matar --id: muere el claude, el pa, y se limpia el .running
//   motor      dist-electron/motor.js (Electron como Node si está, si no node): contesta por el socket / la pipe, un segundo sale 3
// Mientras el pa de TS no despache `pa <proyecto> "<tarea>"` entero (etapas 6-10 sin enchufar en pa.ts), «primer» y «async»
// llaman a lanzarClaude / lanzarAsync directo (con la Corrida armada acá) y el hijo de async es este mismo script con --hijo.
//   node scripts/humo-motor.mjs [etapa …]     (sin etapas: todas; `motor` pide `npx tsc -p tsconfig.electron.json` antes)
import { spawn, spawnSync, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const AQUI = import.meta.dirname;
const APP = path.resolve(AQUI, "..");
const SELF = path.join(AQUI, "humo-motor.mjs");
const FALSO = path.join(AQUI, "claude-humo-falso.mjs");
const WIN = process.platform === "win32";
const mod = (r) => import(new URL(r, import.meta.url).href);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function hasta(que, cond, ms = 20_000) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > fin) throw new Error(`no llegó: ${que}`);
    await dormir(100);
  }
}

const vivo = (pid) => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** Mata un árbol de procesos (en Windows `kill` solo deja a los nietos). */
function matarArbol(pid) {
  if (WIN) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ya no estaba */
    }
  }
}

// ------------------------------------------------------------------------------------------------ el sandbox

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "humo-")));
const home = path.join(tmp, "home");
const proy = path.join(tmp, "proy", "demo");
const estado = path.join(tmp, "estado", "pa");
for (const d of [home, proy, estado, path.join(estado, "demo"), path.join(tmp, "local"), path.join(tmp, "roaming")]) mkdirSync(d, { recursive: true });

/** El entorno de cada llamada: sin nada del usuario (ni PA_*, ni su claude). */
function entorno(extra = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|HILOS_|TRAMA_|CLAUDE_|HUMO_)/.test(k)) e[k] = v;
  return {
    ...e,
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: path.join(tmp, "local"),
    APPDATA: path.join(tmp, "roaming"),
    PA_STATE: estado,
    PA_PROJ: path.join(tmp, "claude-proyectos"),
    PA_JEFE: "",
    PA_JEFE_ID: "",
    PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
    HILOS_STATE: path.join(tmp, "hilos"),
    HILOS_LOCAL: path.join(tmp, "run"),
    HUMO_CLAUDE_LOG: path.join(tmp, "claude-argv.jsonl"),
    ...extra,
  };
}

function repo() {
  const g = (...a) => execFileSync("git", ["-c", "user.name=humo", "-c", "user.email=humo@example.com", ...a], { cwd: proy, stdio: "pipe", env: entorno() });
  g("init", "-q", "-b", "main");
  writeFileSync(path.join(proy, "README.md"), "demo\n");
  g("add", "README.md");
  g("commit", "-q", "-m", "inicial");
  writeFileSync(path.join(tmp, "registry.json"), JSON.stringify({ projects: [{ name: "demo", path: proy, desc: "demo" }] }));
}

function io() {
  const r = { out: "", err: "" };
  return { r, out: (s) => (r.out += s), err: (s) => (r.err += s) };
}

const corrida = (ts, o = {}) => ({
  proyecto: "demo", slug: "demo", ts, ruta: proy, rutaTrabajo: proy, rama: "", base: "", origen: "", puesto: "aca", leer: false, usaWorktree: false,
  tengoLock: true, modelo: "claude-sonnet-5-5", esfuerzo: "high", cuenta: "claude", tarea: "tarea de humo", tareaJefe: "tarea de humo", lanzo: "jefe",
  sid: "00000000-0000-4000-8000-0000000000" + ts.slice(-2).padStart(2, "0"), resume: false, conMcp: false, maxTurns: "5", maxBudget: "", autocompact: "",
  baseDelta: [], jefe: "", jefeId: "", async: false, ...o,
});

// ------------------------------------------------------------------------------------------------ etapas

const etapas = {
  async locks() {
    const { tomar, probar } = await mod("../electron/cli/base/lock.ts");
    const ruta = path.join(tmp, "lock", "demo");
    mkdirSync(path.dirname(ruta), { recursive: true });
    assert.equal(await probar(ruta), false, "libre antes de tomarlo");
    const a = await tomar(ruta);
    assert.ok(a, "tomó el lock");
    assert.equal(await probar(ruta), true, "ocupado");
    assert.equal(await tomar(ruta), null, "no se toma dos veces");
    await a.liberar();
    assert.equal(await probar(ruta), false, "libre al liberar");
    // el que lo tenía muere: se suelta solo (named pipe / socket abstracto, sin archivo que limpiar)
    const hijo = spawn(process.execPath, ["--input-type=module", "-e", `
      import { tomar } from ${JSON.stringify(new URL("../electron/cli/base/lock.ts", import.meta.url).href)};
      const l = await tomar(${JSON.stringify(ruta)}, { mantenerVivo: true, alMensaje: (m) => ({ ok: true, eco: m.hola }) });
      console.log(l ? "tomado" : "ocupado");
    `], { stdio: ["ignore", "pipe", "inherit"] });
    try {
      await new Promise((ok, mal) => {
        hijo.stdout.once("data", (d) => (String(d).includes("tomado") ? ok() : mal(new Error("el hijo no tomó el lock"))));
        hijo.once("error", mal);
      });
      assert.equal(await probar(ruta), true, "ocupado por otro proceso");
      assert.equal(await tomar(ruta), null);
      const { consultar } = await mod("../electron/cli/base/lock.ts");
      assert.deepEqual(await consultar(ruta, { hola: "mundo" }), { ok: true, eco: "mundo" }, "el canal de control del lock contesta");
    } finally {
      matarArbol(hijo.pid);
    }
    await hasta("el lock se suelta al morir su dueño", async () => !(await probar(ruta)), 10_000);
    const b = await tomar(ruta);
    assert.ok(b, "se puede volver a tomar");
    await b.liberar();
  },

  async enlaces() {
    const { enlazarDir, borrarSinSeguir, esLink } = await mod("../electron/cli/base/enlaces.ts");
    const destino = path.join(tmp, "cache", "node_modules");
    mkdirSync(path.join(destino, "pkg"), { recursive: true });
    writeFileSync(path.join(destino, "pkg", "index.js"), "ok\n");
    const wt = path.join(tmp, "wt", "demo");
    const tipo = enlazarDir(destino, path.join(wt, "node_modules"));
    assert.equal(tipo, WIN ? "junction" : "symlink");
    assert.ok(esLink(path.join(wt, "node_modules")), "es un enlace");
    assert.equal(readFileSync(path.join(wt, "node_modules", "pkg", "index.js"), "utf8"), "ok\n", "se lee a través del enlace");
    writeFileSync(path.join(wt, "node_modules", "pkg", "nuevo.js"), "x\n");
    assert.ok(existsSync(path.join(destino, "pkg", "nuevo.js")), "se escribe a través del enlace");
    borrarSinSeguir(wt);
    assert.ok(!existsSync(wt), "el worktree se borró");
    assert.ok(existsSync(path.join(destino, "pkg", "index.js")) && existsSync(path.join(destino, "pkg", "nuevo.js")), "el destino quedó intacto");
    assert.ok(readdirSync(path.join(destino, "pkg")).length === 2);
    assert.ok(lstatSync(destino).isDirectory());
  },

  async pa() {
    const env = entorno();
    const pa = spawnSync(process.execPath, [path.join(APP, "electron", "cli", "pa.ts"), "--brief"], { env, encoding: "utf8", timeout: 30_000 });
    assert.equal(pa.status, 0, `pa.ts --brief: ${pa.stderr}`);
    assert.match(pa.stdout, /Objetivo:/, "la plantilla del brief");
    const asy = spawnSync(process.execPath, [path.join(APP, "electron", "cli", "pa", "async.ts"), "--estado"], { env, encoding: "utf8", timeout: 30_000 });
    assert.equal(asy.status, 0, `async.ts --estado: ${asy.stderr}`);
  },

  async primer() {
    const { prologo } = await mod("../electron/cli/pa/entorno.ts");
    const { lanzarClaude } = await mod("../electron/cli/pa/lanzar.ts");
    const salida = io();
    const pa = prologo([], entorno(), salida);
    const ts = "20261028-100000-11";
    const rc = await lanzarClaude(pa, corrida(ts), { claude: FALSO, senalesProceso: false });
    assert.equal(rc, 0, `rc de lanzarClaude\n${salida.r.err}`);
    assert.match(salida.r.out, /hice la tarea de humo/, "muestra el RESULTADO");
    assert.ok(!/SIN VERIFICAR/.test(salida.r.out), "trae VERIFICACION");
    const json = JSON.parse(readFileSync(path.join(estado, "demo", `${ts}.json`), "utf8"));
    assert.equal(json.is_error, false);
    assert.ok(existsSync(path.join(estado, "demo.ultimo")), ".ultimo");
    assert.ok(!existsSync(path.join(estado, "demo@aca.running")), "el .running se borró al terminar");
    const argv = readFileSync(entorno().HUMO_CLAUDE_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(argv.length, 1);
    assert.ok(argv[0].args.includes("-p") && argv[0].args.includes("--session-id"), `argv de claude: ${argv[0].args.join(" ")}`);
    assert.equal(realpathSync.native(argv[0].cwd), realpathSync.native(proy), "claude corrió en el proyecto");
  },

  async async() {
    const { prologo } = await mod("../electron/cli/pa/entorno.ts");
    const { lanzarAsync, cmdEsperar } = await mod("../electron/cli/pa/async.ts");
    const salida = io();
    const pa = prologo([], entorno(), salida);
    const ts = await lanzarAsync(pa, { proyecto: "demo", slug: "demo", dir: path.join(estado, "demo"), leer: false, hijoArgs: ["--hijo"], comando: [process.execPath, SELF] });
    assert.match(ts, /^\d{8}-\d{6}-\d+$/);
    assert.match(salida.r.out, /lanzado en background/);
    const rc = await cmdEsperar(pa, ["demo", "--id", ts, "--timeout", "60"], { pausaMs: 200 });
    assert.equal(rc, 0, `rc de --esperar\n${salida.r.out}\n${salida.r.err}`);
    assert.match(salida.r.out, /hice la tarea de humo/, "--esperar entrega el resultado");
  },

  async matar() {
    const { prologo } = await mod("../electron/cli/pa/entorno.ts");
    const { lanzarAsync, main } = await mod("../electron/cli/pa/async.ts");
    const pidArchivo = path.join(tmp, "claude-colgado.pid");
    rmSync(pidArchivo, { force: true });
    const env = entorno({ HUMO_CLAUDE_MODO: "colgar", HUMO_CLAUDE_PID: pidArchivo });
    const salida = io();
    const pa = prologo([], env, salida);
    const ts = await lanzarAsync(pa, { proyecto: "demo", slug: "demo", dir: path.join(estado, "demo"), leer: false, hijoArgs: ["--hijo"], comando: [process.execPath, SELF] });
    const run = path.join(estado, "demo@aca.running");
    const campos = await hasta("el .running con el pid del claude", () => {
      try {
        const c = Object.fromEntries(readFileSync(run, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
        return c.pid && existsSync(pidArchivo) ? c : null;
      } catch {
        return null;
      }
    });
    const claudePid = Number(readFileSync(pidArchivo, "utf8"));
    assert.ok(vivo(claudePid) && vivo(campos.pa_pid), "claude y el pa hijo están vivos");
    const m = io();
    const rc = await main(["demo", "--matar", "--id", ts], env, m);
    assert.equal(rc, 0, `rc de --matar\n${m.r.out}\n${m.r.err}`);
    assert.match(m.r.out, /matado/);
    await hasta("que mueran el claude y el pa hijo", () => !vivo(claudePid) && !vivo(campos.pa_pid), 15_000);
    assert.ok(!existsSync(run), "el .running se limpió");
  },

  async motor() {
    const motor = path.join(APP, "dist-electron", "motor.js");
    assert.ok(existsSync(motor), "falta dist-electron/motor.js: correr antes `npx tsc -p tsconfig.electron.json`");
    const { carpetaMotor, socketMotor } = await mod("../electron/rutas.ts");
    const env = entorno({
      HILOS_SESIONES: path.join(tmp, "sesiones"),
      CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
      HILOS_CLAUDE: FALSO,
      HILOS_TAILSCALE: path.join(tmp, "sin-tailscale"),
      HILOS_HISTORIAL: "0",
      HILOS_BUILD: path.join(tmp, "build"),
      XDG_RUNTIME_DIR: path.join(tmp, "xdg"),
    });
    mkdirSync(env.HILOS_BUILD, { recursive: true });
    mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
    mkdirSync(env.HILOS_LOCAL, { recursive: true, mode: 0o700 });
    const sock = socketMotor(carpetaMotor(env), env);
    const electron = path.join(APP, "node_modules", "electron", "dist", WIN ? "electron.exe" : "electron");
    const conElectron = existsSync(electron);
    const lanzar = () => {
      const p = spawn(conElectron ? electron : process.execPath, [motor], { env: conElectron ? { ...env, ELECTRON_RUN_AS_NODE: "1" } : env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let log = "";
      p.stdout.on("data", (d) => (log += d));
      p.stderr.on("data", (d) => (log += d));
      const salida = new Promise((ok) => p.once("exit", (c, s) => ok(c ?? s)));
      return { p, salida, log: () => log };
    };
    const rpc = (canal, args = []) =>
      new Promise((ok, mal) => {
        const r = http.request({ socketPath: sock, path: "/rpc", method: "POST", headers: { "content-type": "application/json", "x-trama-cliente": "c0ffee01" }, timeout: 5000 }, (res) => {
          let t = "";
          res.setEncoding("utf8");
          res.on("data", (d) => (t += d));
          res.on("end", () => ok(JSON.parse(t)));
        });
        r.on("error", mal);
        r.on("timeout", () => r.destroy(new Error("rpc sin respuesta")));
        r.end(JSON.stringify({ canal, args }));
      });
    const a = lanzar();
    try {
      await hasta(`el motor contesta por ${sock}\n${a.log()}`, async () => {
        try {
          return (await rpc("leidos:leer")).ok === true;
        } catch {
          return false;
        }
      }, 60_000);
      assert.equal((await rpc("borradores:leer")).ok, true, "otro canal del núcleo");
      assert.match(String((await rpc("app:salir", [false])).error), /canal desconocido/);
      const dueno = JSON.parse(readFileSync(path.join(env.HILOS_STATE, "dueno"), "utf8"));
      assert.equal(dueno.pid, a.p.pid, "dueno anota su pid");
      const b = lanzar();
      const t = setTimeout(() => matarArbol(b.p.pid), 40_000);
      const codigo = await b.salida;
      clearTimeout(t);
      assert.equal(codigo, 3, `el segundo motor sale con 3\n${b.log()}`);
      assert.equal((await rpc("leidos:leer")).ok, true, "el primero sigue contestando");
    } finally {
      if (WIN) matarArbol(a.p.pid);
      else a.p.kill("SIGTERM");
      const fin = await Promise.race([a.salida, dormir(15_000).then(() => "colgado")]);
      if (fin === "colgado") matarArbol(a.p.pid);
      else if (!WIN) assert.equal(fin, 0, `SIGTERM: sale con 0\n${a.log()}`);
    }
    await assert.rejects(rpc("leidos:leer"), "después de salir ya no contesta");
  },

  // el hijo de «async» y «matar» (recibe el entorno de lanzarAsync): toma el puesto (acá, el tree principal), lanza al claude y deja el .listo al salir
  async hijo() {
    const { prologo } = await mod("../electron/cli/pa/entorno.ts");
    const { lanzarClaude } = await mod("../electron/cli/pa/lanzar.ts");
    const pa = prologo([], process.env, { out: () => {}, err: (s) => process.stderr.write(s) });
    const ts = process.env.PA_TS;
    writeFileSync(path.join(estado, "demo", `${ts}.puesto`), "aca");
    const rc = await lanzarClaude(pa, corrida(ts, { async: true }), { claude: FALSO, senalesProceso: !WIN });
    process.exitCode = rc;
  },
};

// ------------------------------------------------------------------------------------------------ main

const pedidas = process.argv.slice(2).filter((a) => a !== "--hijo");
if (process.argv.includes("--hijo")) {
  await etapas.hijo();
} else {
  const orden = ["locks", "enlaces", "pa", "primer", "async", "matar", "motor"];
  const aCorrer = pedidas.length ? pedidas : orden;
  for (const e of aCorrer) assert.ok(etapas[e] && e !== "hijo", `etapa desconocida: ${e} (hay ${orden.join(", ")})`);
  repo();
  let fallas = 0;
  for (const e of aCorrer) {
    const t0 = Date.now();
    try {
      await etapas[e]();
      console.log(`ok - ${e} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (err) {
      fallas++;
      console.log(`FALLA - ${e}: ${err?.stack ?? err}`);
    }
  }
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* un antivirus o un hijo que todavía cierra: es un tmp */
  }
  console.log(fallas ? `${fallas} etapa(s) con falla` : `humo: ${aCorrer.length} etapa(s) bien`);
  process.exitCode = fallas ? 1 : 0;
}
