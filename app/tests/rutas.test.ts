// electron/rutas.ts, electron/binario.ts (resolverComando) y electron/procesos.ts por plataforma, con la plataforma inyectada:
// Linux no cambia (lo de siempre) y Windows arma rutas de `%LOCALAPPDATA%\trama`, `[node, script]`, la named pipe, taskkill y el bash de Git.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clavePath, entornoCmd, entornoPa, pathConLocal, resolverBinario, resolverComando } from "../electron/binario.ts";
import { readdirSync, readFileSync } from "node:fs";
import { hijoEnGrupo, matarArbol, shellDe } from "../electron/procesos.ts";
import { carpetaBin, carpetaMotor, configTrama, esPipe, estadoHilos, estadoPa, registroProyectos, socketMotor, vistaTablero } from "../electron/rutas.ts";

const HOME = "/home/ana";
const WENV = { LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local", USERPROFILE: "C:\\Users\\Ana", USERNAME: "Ana" };
const WHOME = "C:\\Users\\Ana";
const hay = (...fs: string[]) => (f: string) => fs.includes(f);

test("Linux: las rutas de siempre (XDG y ~/.local)", () => {
  assert.equal(estadoHilos({}, HOME, "linux"), "/home/ana/.local/state/hilos");
  assert.equal(estadoHilos({ HILOS_STATE: "/tmp/e" }, HOME, "linux"), "/tmp/e");
  assert.equal(estadoPa({}, HOME, "linux"), "/home/ana/.local/state/pa");
  assert.equal(configTrama({}, HOME, "linux"), "/home/ana/.config/trama");
  assert.equal(configTrama({ XDG_CONFIG_HOME: "/x" }, HOME, "linux"), "/x/trama");
  assert.equal(registroProyectos({}, HOME, "linux"), "/home/ana/.config/proyectos/registry.json");
  assert.equal(vistaTablero({}, HOME, "linux"), "/home/ana/.local/state/tablero/vista.json");
  assert.equal(vistaTablero({ TABLERO_DIR: "/t" }, HOME, "linux"), "/t/vista.json");
  assert.equal(vistaTablero({ TABLERO_VISTA: "/v.json", TABLERO_DIR: "/t" }, HOME, "linux"), "/v.json");
  assert.equal(carpetaBin({}, HOME, "linux"), "/home/ana/.local/bin");
  assert.equal(carpetaMotor({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux"), "/run/user/1000/trama");
  assert.equal(carpetaMotor({ HILOS_LOCAL: "/tmp/l" }, "linux"), "/tmp/l");
  assert.equal(socketMotor("/run/user/1000/trama", {}, "linux"), "/run/user/1000/trama/motor.sock");
});

test("Windows: todo bajo %LOCALAPPDATA%\\trama", () => {
  assert.equal(estadoHilos(WENV, WHOME, "win32"), "C:\\Users\\Ana\\AppData\\Local\\trama\\estado\\hilos");
  assert.equal(estadoPa(WENV, WHOME, "win32"), "C:\\Users\\Ana\\AppData\\Local\\trama\\estado\\pa");
  assert.equal(configTrama(WENV, WHOME, "win32"), "C:\\Users\\Ana\\AppData\\Local\\trama\\config");
  assert.equal(registroProyectos(WENV, WHOME, "win32"), "C:\\Users\\Ana\\AppData\\Local\\trama\\config\\proyectos\\registry.json");
  assert.equal(carpetaBin(WENV, WHOME, "win32"), "C:\\Users\\Ana\\AppData\\Local\\trama\\bin");
  assert.equal(estadoPa({ ...WENV, PA_STATE: "D:\\pa" }, WHOME, "win32"), "D:\\pa");
  // sin LOCALAPPDATA: AppData\Local del perfil
  assert.equal(carpetaBin({}, WHOME, "win32"), "C:\\Users\\Ana\\AppData\\Local\\trama\\bin");
});

test("el motor en Windows escucha en una named pipe; con otra carpeta (pruebas) la huella la distingue", () => {
  const propia = carpetaMotor(WENV, "win32");
  const pipe = socketMotor(propia, WENV, "win32");
  assert.equal(pipe, "\\\\.\\pipe\\trama-motor-ana");
  assert.ok(esPipe(pipe));
  const prueba = socketMotor("C:\\tmp\\a", WENV, "win32");
  assert.match(prueba, /^\\\\\.\\pipe\\trama-motor-ana-[0-9a-f]{8}$/);
  assert.notEqual(prueba, socketMotor("C:\\tmp\\b", WENV, "win32"));
  assert.ok(!esPipe("/run/user/1000/trama/motor.sock"));
});

test("PATH: ; y 'Path' en Windows, : y PATH en Linux", () => {
  assert.equal(pathConLocal({ PATH: "/usr/bin:/bin" }, HOME, "linux"), "/home/ana/.local/bin:/usr/bin:/bin");
  const w = pathConLocal({ ...WENV, Path: "C:\\Windows;C:\\Git\\bin" }, WHOME, "win32");
  assert.equal(w, "C:\\Users\\Ana\\AppData\\Local\\trama\\bin;C:\\Windows;C:\\Git\\bin");
  assert.equal(clavePath({ Path: "x" }, "win32"), "Path");
  assert.equal(clavePath({ PATH: "x" }, "linux"), "PATH");
  const e = entornoPa({ Path: "C:\\Windows" }, WHOME, "win32");
  assert.equal(e.Path, "C:\\Users\\Ana\\AppData\\Local\\trama\\bin;C:\\Windows");
  assert.equal(e.PATH, undefined);
});

test("resolverComando: Linux [binario]; Windows [node, script.js] y nunca un .cmd", () => {
  assert.deepEqual(resolverComando("pa", "HILOS_PA", { PATH: "/usr/bin" }, HOME, hay("/usr/bin/pa"), "linux"), ["/usr/bin/pa"]);
  assert.deepEqual(resolverComando("pa", "HILOS_PA", { HILOS_PA: "/tmp/falso.sh" }, HOME, hay(), "linux"), ["/tmp/falso.sh"]);
  const nodeW = "C:\\Users\\Ana\\AppData\\Local\\trama\\node\\node.exe";
  const jsBin = "C:\\Users\\Ana\\AppData\\Local\\trama\\bin\\pa.js";
  assert.deepEqual(resolverComando("pa", "HILOS_PA", WENV, WHOME, hay(nodeW, jsBin), "win32"), [nodeW, jsBin]);
  // la variable apunta a un .js: node + ese script; a un .exe: tal cual
  assert.deepEqual(resolverComando("pa", "HILOS_PA", { ...WENV, HILOS_PA: "D:\\x\\pa.js" }, WHOME, hay(nodeW), "win32"), [nodeW, "D:\\x\\pa.js"]);
  assert.deepEqual(resolverComando("pa", "HILOS_PA", { ...WENV, HILOS_PA: "D:\\x\\pa.exe" }, WHOME, hay(nodeW), "win32"), ["D:\\x\\pa.exe"]);
  // el script dentro de la app
  const app = "C:\\Users\\Ana\\AppData\\Local\\trama\\app\\bin\\tablero.js";
  assert.deepEqual(resolverComando("tablero", "HILOS_TABLERO", WENV, WHOME, hay(nodeW, app), "win32"), [nodeW, app]);
  // sin nada: el nombre pelado (el error de spawn dice qué falta)
  assert.deepEqual(resolverComando("reparto", "HILOS_REPARTO", WENV, WHOME, hay(), "win32"), ["reparto"]);
  assert.equal(resolverBinario("claude", "HILOS_CLAUDE", { Path: "C:\\bin" }, WHOME, hay("C:\\bin\\claude.exe"), "win32"), "C:\\bin\\claude.exe");
});

test("entornoCmd: el Electron propio se porta como node sólo cuando es el 'node' del prefijo", () => {
  assert.deepEqual(entornoCmd(["/usr/bin/pa"], { A: "1" }), { A: "1" });
  assert.deepEqual(entornoCmd(["node", "x.js"], { A: "1" }), { A: "1" });
});

test("matarArbol: Linux kill(-pid); Windows taskkill /T /F; pids imposibles no hacen nada", () => {
  const visto: string[] = [];
  const kill = (pid: number, senal: string) => void visto.push(`${pid} ${senal}`);
  const taskkill = (a: string[]) => void visto.push(a.join(" "));
  matarArbol(4321, "SIGTERM", { plat: "linux", kill, taskkill });
  matarArbol(4321, "SIGKILL", { plat: "win32", kill, taskkill });
  matarArbol(undefined, "SIGKILL", { plat: "win32", kill, taskkill });
  matarArbol(1, "SIGKILL", { plat: "linux", kill, taskkill });
  assert.deepEqual(visto, ["-4321 SIGTERM", "/T /F /PID 4321"]);
  // un grupo vacío (ESRCH) no tira
  matarArbol(4321, "SIGTERM", { plat: "linux", kill: () => { throw Object.assign(new Error("x"), { code: "ESRCH" }); } });
});

test("shellDe: Linux bash / sh de siempre; Windows cmd.exe verbatim, nunca bash", () => {
  assert.deepEqual(shellDe("bash", "npm test", {}, "linux"), { file: "bash", args: ["-c", "npm test"], verbatim: false });
  assert.deepEqual(shellDe("sh", "echo $HOME", {}, "linux"), { file: "/bin/sh", args: ["-c", "echo $HOME"], verbatim: false });
  assert.deepEqual(shellDe("bash", 'node "a b.mjs"', {}, "win32"), { file: "cmd.exe", args: ["/d", "/s", "/c", '"node "a b.mjs""'], verbatim: true });
  assert.equal(shellDe("sh", "x", { ComSpec: "C:\\Windows\\System32\\cmd.exe" }, "win32").file, "C:\\Windows\\System32\\cmd.exe");
  assert.ok(!/bash/.test(JSON.stringify(shellDe("bash", "x", {}, "win32"))));
});

test("hijoEnGrupo: Linux sí (kill(-pid)); Windows no: `detached` le quitaría la consola y cada hijo de agy/Claude abriría una ventana", () => {
  assert.equal(hijoEnGrupo("linux"), true);
  assert.equal(hijoEnGrupo("darwin"), true);
  assert.equal(hijoEnGrupo("win32"), false);
  // Quien lanza líderes, agy o chequeos con pipes no puede volver a `detached: true` pelado (en Windows = DETACHED_PROCESS).
  for (const f of ["agy-puente.ts", "lider.ts", "salud.ts"]) {
    const src = readFileSync(new URL(`../electron/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /detached: true, windowsHide/, `${f}: detached: true + windowsHide`);
    assert.match(src, /detached: hijoEnGrupo\(\), windowsHide: true/, `${f}: usa hijoEnGrupo()`);
  }
});

test("Windows: lo que lanza la carcasa (windows/src), el motor (motor/*.mjs) y los .cts también oculta la consola (`windowsHide`)", () => {
  // Excepciones a propósito: el principio de la llamada. Hoy no hay ninguna; una consola a la vista se anota acá con su motivo.
  const aPropósito: string[] = [];
  const raices = [new URL("../../windows/src/", import.meta.url), new URL("../../motor/", import.meta.url), new URL("../electron/", import.meta.url)];
  const faltan: string[] = [];
  for (const raiz of raices) {
    for (const f of readdirSync(raiz, { recursive: true, encoding: "utf8" })) {
      if (!/\.(js|mjs|cjs|cts)$/.test(f) || /(^|[\\/])(node_modules|payload|dist[\w-]*)[\\/]/.test(f)) continue;
      const src = readFileSync(new URL(f, raiz), "utf8");
      // `proc.spawn(`, `cp.execFile(`… (los `.exec(` de las regex no cuentan: sólo spawn/execFile/fork).
      for (const m of src.matchAll(/(?<![\w$])(?:[\w$]+\.)?(?:spawn|spawnSync|execFile|execFileSync|fork)\(/g)) {
        let i = m.index + m[0].length;
        for (let abiertos = 1; abiertos > 0 && i < src.length; i++) abiertos += src[i] === "(" ? 1 : src[i] === ")" ? -1 : 0;
        const llamada = src.slice(m.index, i);
        if (llamada.includes("windowsHide") || aPropósito.some((p) => llamada.startsWith(p))) continue;
        faltan.push(`${raiz.pathname.split("/").slice(-3).join("/")}${f}: ${llamada.slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(faltan, []);
});

test("Trama no arranca Ollama: nada ejecuta el binario `ollama` ni su app (sólo se sondea el puerto y se mira `where`)", () => {
  const raiz = new URL("../electron/", import.meta.url);
  const culpables: string[] = [];
  for (const f of readdirSync(raiz, { recursive: true, encoding: "utf8" })) {
    if (!f.endsWith(".ts") || f === "locales-deteccion.ts") continue; // esa se controla abajo: sólo corre `ollama` fuera de Windows
    const src = readFileSync(new URL(f, raiz), "utf8");
    // Ejecutar `ollama` (o «ollama app») como programa: en Windows su cliente abre la ventana «Welcome to Ollama».
    if (/(?:ejecutar|spawn|spawnSync|execFile|execFileSync|correr|lanzarSuelto)\(\s*['"`](?:ollama|[^'"`]*ollama app)/i.test(src)) culpables.push(f);
  }
  assert.deepEqual(culpables, []);
  const src = readFileSync(new URL("../electron/locales-deteccion.ts", import.meta.url), "utf8");
  assert.match(src, /ollamaInstalado && plat !== 'win32'/, "locales-deteccion: en Windows no se corre `ollama --version`");
});

test("Windows: ningún proceso de fondo abre una consola visible (sin `windowsHide`, cada `claude` o `git` de fondo muestra un CMD un instante)", () => {
  // Sólo Linux: nunca corren en Windows.
  const soloLinux = new Set(["bench.ts", "dictado.ts", "pc-estado.ts", "remoto-armar.ts", "terminal.ts", "volver.ts"]);
  // El principio de la llamada de las que no se ocultan a propósito: terminal a la vista, salida heredada o rama que no es de Windows.
  const aPropósito = [
    'execFile("systemctl"', // main: el servicio del motor en Linux
    "spawn(process.execPath, process.argv.slice(1), { detached: true", // motor: se relanza suelto; `detached` ya no tiene consola
    "spawn(term,", // actualizador: la terminal donde corre la actualización
    "spawn(term[0]!", // workers: `ver` en una terminal
    "spawn(prog,", // cuentas: el comando de la persona, con stdio heredado
    "spawnSync(prefijo[0]!", // pa: subcomando con stdio heredado
    "spawnSync(process.execPath, [...process.execArgv", // pa: relanzarse con stdio heredado
    'execFileSync("ps"', // la rama no Windows de la lista de procesos
    "spawn(c, a, op)", // envoltorios: quien los llama pasa `windowsHide`
    "spawn({ detached })", // un comentario
    "spawn(p.cmd, p.args, { cwd: p.cwd, detached: true", // `detached` ya no tiene consola: `windowsHide` no cambia nada
  ];
  const raiz = new URL("../electron/", import.meta.url);
  const faltan: string[] = [];
  for (const f of readdirSync(raiz, { recursive: true, encoding: "utf8" })) {
    if (!f.endsWith(".ts") || soloLinux.has(f)) continue;
    const src = readFileSync(new URL(f, raiz), "utf8");
    // Sin el punto delante: `cp.spawn(` y `child_process.execFile(` también cuentan (antes se colaban).
    for (const m of src.matchAll(/(?<![\w])(?:spawn|spawnSync|execFile|execFileSync)\(/g)) {
      let i = m.index + m[0].length;
      for (let abiertos = 1; abiertos > 0 && i < src.length; i++) abiertos += src[i] === "(" ? 1 : src[i] === ")" ? -1 : 0;
      const llamada = src.slice(m.index, i);
      // `...opciones` en lider.ts ya trae `windowsHide: true`.
      if (llamada.includes("windowsHide") || /\.\.\.opciones\b/.test(llamada) || aPropósito.some((p) => llamada.startsWith(p))) continue;
      faltan.push(`${f}: ${llamada.slice(0, 80)}`);
    }
  }
  assert.deepEqual(faltan, []);
});
