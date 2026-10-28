// Las ramas de Windows de la app (etapa 14), con la plataforma inyectada: terminal, interrumpir, binarios de npm (.cmd),
// capacidades y carpeta de datos de opencode. Corren en cualquier sistema.
import assert from "node:assert/strict";
import test from "node:test";
import { carpetasNpm, paraLanzar, resolverNpm } from "../electron/binario.ts";
import { capacidades } from "../electron/capacidades.ts";
import { resolverDsh } from "../electron/dsh.ts";
import { carpetasDatosOpencode, proveedoresConLogin, resolverOpencode } from "../electron/opencode.ts";
import { interrumpir, shellDe } from "../electron/procesos.ts";
import { detectarUnits } from "../electron/locales-deteccion.ts";
import { envoltorioWindows, resolverTerminal } from "../electron/terminal-lanzar.ts";

const hay = (...fs: string[]) => (f: string) => fs.includes(f);
const CASA = "C:\\Users\\Ana";
const WENV = { USERPROFILE: CASA, APPDATA: `${CASA}\\AppData\\Roaming`, LOCALAPPDATA: `${CASA}\\AppData\\Local`, Path: "C:\\Windows\\System32;C:\\Tools" };

test("terminal Windows: wt.exe si está; si no, cmd /c start; HILOS_TERMINAL manda", () => {
  const wt = "C:\\Tools\\wt.exe";
  assert.deepEqual(resolverTerminal(WENV, hay(wt), "win32"), [wt]);
  assert.deepEqual(resolverTerminal({ ...WENV, TERMINAL: "wt" }, hay(wt), "win32"), [wt]);
  assert.deepEqual(resolverTerminal(WENV, hay(), "win32"), ["cmd.exe", "/d", "/c", "start", "", "/wait"]);
  assert.deepEqual(resolverTerminal({ ...WENV, ComSpec: "C:\\Windows\\System32\\cmd.exe" }, hay(), "win32")?.[0], "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(resolverTerminal({ ...WENV, HILOS_TERMINAL: "D:\\mi\\term.exe" }, hay(), "win32"), ["D:\\mi\\term.exe"]);
});

test("terminal Windows: nunca sh, bash ni terminales de Linux", () => {
  for (const r of [resolverTerminal(WENV, hay("C:\\Tools\\xterm.exe"), "win32"), resolverTerminal(WENV, hay(), "win32")]) assert.ok(!/xterm|bash|\bsh\b/.test(JSON.stringify(r)));
});

test("terminal Linux sigue igual con la plataforma explícita", () => {
  assert.deepEqual(resolverTerminal({ PATH: "/usr/bin" }, hay("/usr/bin/kitty", "/usr/bin/xterm"), "linux"), ["/usr/bin/kitty"]);
  assert.equal(resolverTerminal({ PATH: "/usr/bin" }, hay(), "linux"), null);
});

test("envoltorio .cmd: llama la orden, anota el rc por un .tmp y espera tecla si falló", () => {
  const t = envoltorioWindows();
  assert.match(t, /^@echo off\r\ncall %\*\r\n/);
  assert.match(t, /rc\.tmp/);
  assert.match(t, /move \/y/);
  assert.match(t, /if %rc% neq 0/);
  assert.match(t, /pause/);
  assert.ok(!/\bsh\b|bash/.test(t));
});

test("interrumpir: Linux SIGINT al proceso; Windows taskkill al árbol (sin SIGINT)", () => {
  const señales: string[] = [];
  const hijo = { pid: 77, kill: (s: NodeJS.Signals) => (señales.push(s), true) };
  const tk: string[][] = [];
  interrumpir(hijo, { plat: "linux", taskkill: (a) => tk.push(a) });
  assert.deepEqual(señales, ["SIGINT"]);
  assert.deepEqual(tk, []);
  interrumpir(hijo, { plat: "win32", taskkill: (a) => tk.push(a) });
  assert.deepEqual(señales, ["SIGINT"]);
  assert.deepEqual(tk, [["/T", "/F", "/PID", "77"]]);
  interrumpir({ kill: () => true }, { plat: "win32", taskkill: (a) => tk.push(a) });
  assert.equal(tk.length, 1);
});

test("binarios de npm en Windows: .cmd en %APPDATA%\\npm, y se lanzan por cmd.exe", () => {
  const cmd = `${CASA}\\AppData\\Roaming\\npm\\dsh.cmd`;
  assert.deepEqual(carpetasNpm(WENV, CASA, "win32"), [`${CASA}\\AppData\\Roaming\\npm`]);
  assert.equal(resolverDsh(WENV, CASA, hay(cmd), "win32"), cmd);
  assert.equal(resolverDsh(WENV, CASA, hay(), "win32"), "dsh");
  assert.equal(resolverDsh({ ...WENV, HILOS_DSH: "X:\\dsh.cmd" }, CASA, hay(), "win32"), "X:\\dsh.cmd");
  assert.equal(resolverOpencode({ ...WENV, npm_config_prefix: "D:\\npm" }, CASA, hay("D:\\npm\\opencode.cmd"), "win32"), "D:\\npm\\opencode.cmd");
  // el del PATH gana al de la carpeta global, y .cmd antes que el nombre pelado
  assert.equal(resolverNpm("dsh", WENV, CASA, [], hay("C:\\Tools\\dsh", "C:\\Tools\\dsh.cmd"), "win32"), "C:\\Tools\\dsh.cmd");
});

test("binarios de npm en Linux: lo de siempre (sin .cmd)", () => {
  assert.equal(resolverDsh({ PATH: "/a:/b" }, "/home/x", hay("/b/dsh"), "linux"), "/b/dsh");
  assert.equal(resolverDsh({ PATH: "/a" }, "/home/x", hay("/home/x/.npm-global/bin/dsh"), "linux"), "/home/x/.npm-global/bin/dsh");
  assert.equal(resolverOpencode({ PATH: "/a" }, "/home/x", hay("/home/x/.opencode/bin/opencode"), "linux"), "/home/x/.opencode/bin/opencode");
  assert.deepEqual(carpetasNpm({ npm_config_prefix: "/opt/n" }, "/home/x", "linux"), ["/opt/n/bin", "/home/x/.npm-global/bin", "/usr/local/bin"]);
});

test("paraLanzar: .cmd/.bat por cmd.exe verbatim; .exe y Linux tal cual; rechaza lo que cmd no puede pasar", () => {
  assert.deepEqual(paraLanzar("C:\\n\\dsh.cmd", ["--version"], {}, "win32"), { file: "cmd.exe", args: ["/d", "/s", "/c", '"C:\\n\\dsh.cmd --version"'], verbatim: true });
  assert.deepEqual(paraLanzar("C:\\Program Files\\n\\x.cmd", ["--patch", "C:\\a b\\p.yaml"], { ComSpec: "C:\\W\\cmd.exe" }, "win32"), {
    file: "C:\\W\\cmd.exe",
    args: ["/d", "/s", "/c", '""C:\\Program Files\\n\\x.cmd" --patch "C:\\a b\\p.yaml""'],
    verbatim: true,
  });
  assert.deepEqual(paraLanzar("C:\\n\\dsh.exe", ["x"], {}, "win32"), { file: "C:\\n\\dsh.exe", args: ["x"], verbatim: false });
  assert.deepEqual(paraLanzar("/u/dsh.cmd", ["x"], {}, "linux"), { file: "/u/dsh.cmd", args: ["x"], verbatim: false });
  assert.throws(() => paraLanzar("a.cmd", ['x"&calc'], {}, "win32"), /no apto/);
  assert.throws(() => paraLanzar("a.cmd", ["%PATH%"], {}, "win32"), /no apto/);
});

test("shellDe en Windows es cmd.exe, jamás bash", () => {
  const s = shellDe("bash", "npm test", WENV, "win32");
  assert.equal(s.file, "cmd.exe");
  assert.deepEqual(s.args, ["/d", "/s", "/c", '"npm test"']);
});

test("capacidades: en Windows y macOS no hay kitty, Hyprland ni systemd; Tailscale sí (tailscale.exe)", () => {
  const todo = () => true;
  const w = capacidades({ ...WENV, HILOS_HYPRCTL: "x", HILOS_KITTEN: "y" }, CASA, todo, "win32");
  assert.deepEqual(w, { tailscale: true, hyprctl: false, kitten: false, systemd: false });
  assert.equal(capacidades({ PATH: "C:\\ts" }, CASA, hay("C:\\ts\\tailscale.exe"), "win32").tailscale, true);
  assert.deepEqual(capacidades({}, "/Users/a", todo, "darwin"), { tailscale: true, hyprctl: false, kitten: false, systemd: false });
  assert.deepEqual(capacidades({ PATH: "/u" }, "/h", todo, "linux"), { tailscale: true, hyprctl: true, kitten: true, systemd: true });
});

test("detectarUnits: sin systemd no mira ni corre systemctl", async () => {
  const llamadas: string[] = [];
  const d = { home: "C:\\Users\\Ana", listarDir: async () => (llamadas.push("dir"), []), ejecutar: async (c: string) => (llamadas.push(c), "") } as never;
  assert.deepEqual(await detectarUnits(d, "win32"), []);
  assert.deepEqual(llamadas, []);
});

test("carpeta de datos de opencode: XDG, ~/.local/share y, en Windows, LOCALAPPDATA y APPDATA", () => {
  assert.deepEqual(carpetasDatosOpencode({ XDG_DATA_HOME: "/d" }, "/home/x", "linux"), ["/d", "/home/x/.local/share"]);
  assert.deepEqual(carpetasDatosOpencode({}, "/home/x", "linux"), ["/home/x/.local/share"]);
  assert.deepEqual(carpetasDatosOpencode(WENV, CASA, "win32"), [`${CASA}\\.local\\share`, `${CASA}\\AppData\\Local`, `${CASA}\\AppData\\Roaming`]);
  // las credenciales se leen de las carpetas de la plataforma de verdad (Linux acá)
  assert.deepEqual(proveedoresConLogin({ XDG_DATA_HOME: "/no/existe" }, "/tampoco"), []);
});
