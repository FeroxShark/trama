// Dictar desde WSL (electron/dictado-windows.ts): el `handy.exe` de Windows y el reconocedor que Windows trae, con un
// disco y un `Ejecutar` falsos. Nada de Windows ni de Handy de verdad.
import { test, after } from "node:test";
import { soloPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { argsSpeech, esWsl, handyExeEnMnt, handyExePorWhere, hayHandy, motoresDictado, GUION_SPEECH } from "../electron/dictado-windows.ts";
import { transcribir, type Ejecutar } from "../electron/dictado.ts";
import { codificarWav } from "../src/hilo/dictado.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-dictwin-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** Un /mnt/c inventado: carpeta → lo que tiene adentro. */
const discoCon = (arbol: Record<string, string[]>) => ({
  hay: (f: string) => f in arbol || Object.entries(arbol).some(([d, fs]) => fs.some((x) => path.join(d, x) === f)),
  lista: (d: string) => arbol[d] ?? [],
});
const WSL = { WSL_DISTRO_NAME: "Ubuntu-24.04" };
const nada = async () => {
  throw new Error("no debería correr nada");
};

test("handyExeEnMnt: el de AppData\\Local de cualquier usuario, sin importar mayúsculas; ignora Public", { skip: soloPosix("detección de Handy/wslpath: desde WSL, no desde Windows nativo") }, () => {
  const disco = discoCon({
    "/mnt/c/Users": ["Public", "gonza"],
    "/mnt/c/Users/gonza/AppData/Local/Handy": ["Handy.exe", "uninstall.exe"],
    "/mnt/c/Users/Public/AppData/Local/Handy": ["handy.exe"],
  });
  assert.equal(handyExeEnMnt({}, disco), "/mnt/c/Users/gonza/AppData/Local/Handy/Handy.exe");
  assert.equal(handyExeEnMnt({}, discoCon({ "/mnt/c/Users": ["gonza"] })), null);
  assert.equal(handyExeEnMnt({}, discoCon({ "/mnt/c/Program Files/Handy": ["handy.exe"] })), "/mnt/c/Program Files/Handy/handy.exe");
});

test("handyExeEnMnt: HILOS_HANDY_EXE manda, y si no existe no se busca otro", () => {
  const disco = discoCon({ "/x/handy.exe": [], "/mnt/c/Program Files/Handy": ["handy.exe"] });
  assert.equal(handyExeEnMnt({ HILOS_HANDY_EXE: "/x/handy.exe" }, disco), "/x/handy.exe");
  assert.equal(handyExeEnMnt({ HILOS_HANDY_EXE: "/y/handy.exe" }, disco), null);
});

test("handyExePorWhere: traduce la primera ruta de Windows con wslpath; sin where.exe, null", async () => {
  const vistos: string[] = [];
  const r = await handyExePorWhere(async (b, a) => (vistos.push(`${b} ${a.join(" ")}`), "C:\\Tools\\handy.exe\r\n"), async (p) => `/mnt/c/${p.slice(3).replaceAll("\\", "/")}`);
  assert.equal(r, "/mnt/c/Tools/handy.exe");
  assert.deepEqual(vistos, ["where.exe handy"]);
  assert.equal(await handyExePorWhere(nada, async (p) => p), null);
  assert.equal(await handyExePorWhere(async () => "INFORMACIÓN: no se pudo encontrar\r\n", async (p) => p), null);
});

test("esWsl: por la variable o por el interop", () => {
  assert.equal(esWsl(WSL, () => false), true);
  assert.equal(esWsl({}, (f) => f.endsWith("WSLInterop")), true);
  assert.equal(esWsl({}, () => false), false);
});

test("motoresDictado: con handy de Linux, sólo ése; fuera de WSL sin Handy, ninguno", { skip: soloPosix("detección de Handy/wslpath: desde WSL, no desde Windows nativo") }, async () => {
  const solo = async (env: Record<string, string>, ejec = (f: string) => f === "/usr/bin/handy") =>
    motoresDictado({ env, home: "/h", correr: nada, disco: discoCon({}), esEjecutable: ejec });
  const a = await solo({ PATH: "/usr/bin", ...WSL });
  assert.deepEqual(a.map((m) => [m.nombre, m.bin]), [["handy", "/usr/bin/handy"]]);
  assert.deepEqual(await solo({ PATH: "/usr/bin" }, () => false), []);
});

test("motoresDictado: en WSL sin handy de Linux, el .exe y detrás System.Speech; sin .exe, sólo System.Speech", { skip: soloPosix("detección de Handy/wslpath: desde WSL, no desde Windows nativo") }, async () => {
  const disco = discoCon({ "/mnt/c/Users": ["gonza"], "/mnt/c/Users/gonza/AppData/Local/Handy": ["handy.exe"] });
  const ps = (f: string) => f === "/mnt/c/WINDOWS/powershell.exe";
  const base = { env: { PATH: "/mnt/c/WINDOWS", ...WSL }, home: "/h", correr: async () => { throw new Error("sin where"); }, esEjecutable: ps };
  const con = await motoresDictado({ ...base, disco });
  assert.deepEqual(con.map((m) => m.nombre), ["handy-windows", "windows"]);
  const sin = await motoresDictado({ ...base, disco: discoCon({}) });
  assert.deepEqual(sin.map((m) => m.nombre), ["windows"]);
  assert.equal(await hayHandy({ ...base, disco }), true);
  assert.equal(await hayHandy({ ...base, disco: discoCon({}) }), false);
  // El interop apagado o HILOS_SPEECH=0: no hay reconocedor.
  assert.deepEqual(await motoresDictado({ ...base, disco: discoCon({}), esEjecutable: () => false }), []);
  assert.deepEqual(await motoresDictado({ ...base, env: { ...base.env, HILOS_SPEECH: "0" }, disco: discoCon({}) }), []);
});

test("argsSpeech: la ruta va entre comillas simples (y una comilla se duplica) y el script habla UTF-8", () => {
  const a = argsSpeech("\\\\wsl.localhost\\Ubuntu\\run\\d'x.wav");
  assert.equal(a[0], "-NoProfile");
  assert.match(a.at(-1)!, /'\\\\wsl\.localhost\\Ubuntu\\run\\d''x\.wav'$/);
  assert.match(GUION_SPEECH, /OutputEncoding.*UTF8/);
  assert.match(GUION_SPEECH, /DictationGrammar/);
});

const wav = () => codificarWav(new Float32Array(1600).fill(0.25));

test("transcribir con el .exe de Windows: le pasa la ruta traducida con wslpath -w y borra el WAV", { skip: soloPosix("detección de Handy/wslpath: desde WSL, no desde Windows nativo") }, async () => {
  const dir = path.join(tmp, "a");
  const vistos: string[][] = [];
  let archivo = "";
  const ejecutar: Ejecutar = async (bin, args) => {
    vistos.push([bin, ...args]);
    if (bin === "wslpath") return `\\\\wsl.localhost\\Ubuntu${args[1]}\r\n`;
    archivo = args[1];
    return "hola desde windows\r\n";
  };
  const motores = await motoresDictado({
    env: WSL, home: "/h", correr: nada, esEjecutable: () => false,
    disco: discoCon({ "/mnt/c/Users": ["gonza"], "/mnt/c/Users/gonza/AppData/Local/Handy": ["handy.exe"] }),
  });
  const texto = await transcribir({ datos: wav() }, { dir, motores: motores.slice(0, 1), ejecutar });
  assert.equal(texto, "hola desde windows");
  assert.equal(vistos[0][0], "wslpath");
  assert.equal(vistos[0][1], "-w");
  assert.match(archivo, /^\\\\wsl\.localhost\\Ubuntu\/.*dictado-.*\.wav$/);
  assert.deepEqual(existsSync(dir) ? (await import("node:fs")).readdirSync(dir) : [], []);
});

test("transcribir: si el .exe falla o no dice nada se prueba System.Speech; si nada anda, se cuenta el primer fallo", { skip: soloPosix("detección de Handy/wslpath: desde WSL, no desde Windows nativo") }, async () => {
  const dir = path.join(tmp, "b");
  const motores = await motoresDictado({
    env: { ...WSL, PATH: "/w" }, home: "/h", correr: nada, esEjecutable: (f) => f === "/w/powershell.exe",
    disco: discoCon({ "/mnt/c/Program Files/Handy": ["handy.exe"] }),
  });
  assert.deepEqual(motores.map((m) => m.nombre), ["handy-windows", "windows"]);
  const llamadas: string[] = [];
  const hacer = (handy: "falla" | "vacio", speech: "anda" | "falla"): Ejecutar => async (bin) => {
    if (bin === "wslpath") return "C:\\x.wav\n";
    llamadas.push(bin);
    if (bin.endsWith("handy.exe")) {
      if (handy === "falla") throw Object.assign(new Error("boom"), { stderr: "handy.exe: no entiendo --transcribe-file" });
      return "\n";
    }
    if (speech === "falla") throw Object.assign(new Error("x"), { stderr: "no hay reconocedor" });
    return "hola\r\nmundo\r\n";
  };
  assert.equal(await transcribir({ datos: wav() }, { dir, motores, ejecutar: hacer("falla", "anda") }), "hola mundo");
  assert.equal(await transcribir({ datos: wav() }, { dir, motores, ejecutar: hacer("vacio", "anda") }), "hola mundo");
  assert.deepEqual(llamadas, ["/mnt/c/Program Files/Handy/handy.exe", "/w/powershell.exe", "/mnt/c/Program Files/Handy/handy.exe", "/w/powershell.exe"]);
  await assert.rejects(transcribir({ datos: wav() }, { dir, motores, ejecutar: hacer("falla", "falla") }), /dictadoFalla.*no entiendo/s);
  await assert.rejects(transcribir({ datos: wav() }, { dir, motores: [], ejecutar: hacer("falla", "falla") }), /dictadoFalta/);
  assert.deepEqual(existsSync(dir) ? (await import("node:fs")).readdirSync(dir) : [], []);
});
