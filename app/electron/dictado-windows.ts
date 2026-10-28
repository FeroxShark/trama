// Dictar desde Windows: el motor corre en Linux (WSL) o en Windows nativo, pero el micrófono y, casi siempre, Handy viven en
// Windows. Acá se decide con qué se transcribe: el `handy` de Linux (lo de siempre), el `handy.exe` de Windows (desde WSL, por
// el interop: /mnt/c o `where.exe`; en Windows nativo, en %LOCALAPPDATA%, %ProgramFiles% o el PATH) o, si no hay Handy en WSL,
// el reconocedor que Windows trae (System.Speech, por `powershell.exe`: sin instalar nada, sin red, sin GPU). Sin `electron`:
// lo prueba tests/dictado-windows.test.ts con un sistema de archivos y un `Ejecutar` falsos.
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolverBinario } from "./binario.ts";
import { plataformaActual } from "./rutas.ts";

type Env = Record<string, string | undefined>;

/** Cómo se corre un programa (el mismo molde que `Ejecutar` de dictado.ts, sin importarlo: dictado.ts importa éste). */
type Correr = (bin: string, args: string[], o: { timeout: number }) => Promise<string>;

/** Con qué se transcribe y cómo se le pasa el WAV. */
export type Motor = {
  nombre: "handy" | "handy-windows" | "windows";
  bin: string;
  /** Los argumentos para un WAV (`archivo` es una ruta de esta máquina; el motor de Windows la traduce). */
  args: (archivo: string, aWindows: (p: string) => Promise<string>) => Promise<string[]>;
};

/** Dónde se baja Handy. */
export const URL_HANDY = "https://handy.computer";

/** ¿Es un Linux dentro de WSL? (`WSL_DISTRO_NAME` o el interop montado). */
export const esWsl = (env: Env = process.env, hay: (f: string) => boolean = existsSync) =>
  !!env.WSL_DISTRO_NAME || hay("/proc/sys/fs/binfmt_misc/WSLInterop") || hay("/proc/sys/fs/binfmt_misc/WSLInterop-late");

/** Las carpetas de Windows donde Handy suele instalarse (NSIS por usuario o por máquina), vistas desde WSL. */
const CARPETAS = ["AppData/Local/Handy", "AppData/Local/Programs/Handy", "AppData/Local/Programs/handy"];
const GLOBALES = ["Program Files/Handy", "Program Files (x86)/Handy"];

type Disco = { hay: (f: string) => boolean; lista: (d: string) => string[] };
const discoReal: Disco = {
  hay: existsSync,
  lista: (d) => {
    try {
      return readdirSync(d);
    } catch {
      return [];
    }
  },
};

/** El `handy.exe` de Windows que se ve en `/mnt/c` (sin importar mayúsculas), o `null`. `HILOS_HANDY_EXE` manda. */
export function handyExeEnMnt(env: Env = process.env, disco: Disco = discoReal, raiz = "/mnt/c"): string | null {
  if (env.HILOS_HANDY_EXE) return disco.hay(env.HILOS_HANDY_EXE) ? env.HILOS_HANDY_EXE : null;
  const candidatas = [...GLOBALES.map((c) => path.join(raiz, c))];
  for (const u of disco.lista(path.join(raiz, "Users"))) {
    if (u.startsWith(".") || /^(Public|Default|Default User|All Users)$/i.test(u)) continue;
    for (const c of CARPETAS) candidatas.push(path.join(raiz, "Users", u, c));
  }
  for (const d of candidatas) {
    const exe = disco.lista(d).find((f) => f.toLowerCase() === "handy.exe");
    if (exe) return path.join(d, exe);
  }
  return null;
}

/** Lo mismo por `where.exe handy` (el PATH de Windows), traducido a ruta de WSL. `null` si no está o no hay interop. */
export async function handyExePorWhere(correr: Correr, aLinux: (p: string) => Promise<string>): Promise<string | null> {
  try {
    const salida = await correr("where.exe", ["handy"], { timeout: 5000 });
    const primera = salida.split(/\r?\n/).map((l) => l.trim()).find((l) => /^[A-Za-z]:\\/.test(l));
    return primera ? await aLinux(primera) : null;
  } catch {
    return null;
  }
}

/**
 * El `handy.exe` de la Windows nativa (sin WSL): `HILOS_HANDY_EXE` manda (si apunta a nada, no hay Handy); si no, la
 * instalación por usuario (`%LOCALAPPDATA%\Handy`), la de todo el equipo (`%ProgramFiles%\Handy`) y el PATH (`where.exe`).
 * Las rutas se arman con path.win32, así la prueba las arma igual desde Linux.
 */
export async function handyExeNativo(o: { env: Env; home: string; correr: Correr; disco: Disco }): Promise<string | null> {
  const c = path.win32;
  if (o.env.HILOS_HANDY_EXE) return o.disco.hay(o.env.HILOS_HANDY_EXE) ? o.env.HILOS_HANDY_EXE : null;
  const carpetas = [c.join(o.env.LOCALAPPDATA || c.join(o.home, "AppData", "Local"), "Handy"), ...(o.env.ProgramFiles ? [c.join(o.env.ProgramFiles, "Handy")] : [])];
  for (const d of carpetas) if (o.disco.hay(c.join(d, "handy.exe"))) return c.join(d, "handy.exe");
  return handyExePorWhere(o.correr, async (p) => p);
}

/**
 * El script de PowerShell que transcribe un WAV con System.Speech (viene con Windows). La salida va en UTF-8 para que
 * lleguen las tildes; la ruta entra como argumento, no pegada al texto del script.
 */
export const GUION_SPEECH = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Speech",
  "$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine",
  "$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))",
  "$r.SetInputToWaveFile($args[0])",
  "while ($true) { $x = $r.Recognize(); if ($null -eq $x) { break }; $x.Text }",
].join("; ");

/** Los argumentos de `powershell.exe` para correr `GUION_SPEECH` sobre una ruta de Windows. */
export const argsSpeech = (rutaWindows: string) => [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  `& { ${GUION_SPEECH} } '${rutaWindows.replace(/'/g, "''")}'`,
];

/** `wslpath` en un sentido o en el otro. */
export const traductor = (correr: Correr, flag: "-w" | "-u") => async (p: string) => (await correr("wslpath", [flag, p], { timeout: 5000 })).trim();

type Opciones = {
  env?: Env;
  home?: string;
  correr: Correr;
  disco?: Disco;
  /** ¿Es un ejecutable? (para el PATH; las pruebas lo reemplazan). */
  esEjecutable?: (f: string) => boolean;
};

/**
 * Los motores disponibles, en el orden en que se prueban. Linux (con `handy`): sólo él, como siempre. Windows nativo sin
 * `handy` en el PATH: el `handy.exe` de `handyExeNativo` o ninguno (el WAV va tal cual, sin `wslpath`). En WSL sin `handy`
 * de Linux: el `handy.exe` de Windows si está y, detrás, System.Speech (si el interop deja correr `powershell.exe`;
 * `HILOS_SPEECH=0` lo apaga). Fuera de WSL sin `handy`: ninguno.
 */
export async function motoresDictado(o: Opciones): Promise<Motor[]> {
  const env = o.env ?? process.env;
  const home = o.home ?? os.homedir();
  const linux = resolverBinario("handy", "HILOS_HANDY", env, home, o.esEjecutable);
  if (env.HILOS_HANDY || linux !== "handy") {
    return [{ nombre: "handy", bin: linux, args: async (a) => ["--transcribe-file", a] }];
  }
  const disco = o.disco ?? discoReal;
  if (plataformaActual() === "win32") {
    const exe = await handyExeNativo({ env, home, correr: o.correr, disco });
    return exe ? [{ nombre: "handy-windows", bin: exe, args: async (a) => ["--transcribe-file", a] }] : [];
  }
  if (!esWsl(env, disco.hay)) return [];
  const motores: Motor[] = [];
  const exe = handyExeEnMnt(env, disco) ?? (await handyExePorWhere(o.correr, traductor(o.correr, "-u")));
  if (exe) motores.push({ nombre: "handy-windows", bin: exe, args: async (a, aWin) => ["--transcribe-file", await aWin(a)] });
  const ps = resolverBinario("powershell.exe", "HILOS_POWERSHELL", env, home, o.esEjecutable);
  if (env.HILOS_SPEECH !== "0" && (ps !== "powershell.exe" || env.HILOS_POWERSHELL)) {
    motores.push({ nombre: "windows", bin: ps, args: async (a, aWin) => argsSpeech(await aWin(a)) });
  }
  return motores;
}

/** ¿Hay un Handy (de Linux o de Windows)? Es lo que mira el aviso de setup: System.Speech no cuenta como Handy. */
export const hayHandy = async (o: Opciones) => (await motoresDictado(o)).some((m) => m.nombre !== "windows");
