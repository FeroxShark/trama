// "Ir a la ventana" (electron/terminal.ts): qué se lee del entorno y del `kitten @ ls`, y el
// camino entero contra un kitten y un hyprctl de mentira: la pestaña exacta de kitty, cuál de
// sus ventanas del sistema es (título de marca) y el `dispatch` en la sintaxis que entienda
// el compositor. Nunca toca el kitty ni el Hyprland de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-terminal-"));
const KITTY = process.ppid;
const falso = (nombre: string, cuerpo: string) => {
  const f = path.join(tmp, nombre);
  writeFileSync(f, `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst d = ${JSON.stringify(tmp)};\nconst a = process.argv.slice(2);\nfs.appendFileSync(d + "/${nombre}.log", JSON.stringify(a) + "\\n");\n${cuerpo}\n`);
  chmodSync(f, 0o755);
  return f;
};
// kitten @ --to <socket> ls | focus-window --match id:N | set-window-title --match id:N [título]
process.env.HILOS_KITTEN = falso(
  "kitten",
  `const c = a.slice(3);
if (c[0] === "ls") process.stdout.write(fs.readFileSync(d + "/ls.json", "utf8"));
else if (c[0] === "set-window-title") c[3] ? fs.writeFileSync(d + "/titulo", c[3]) : fs.rmSync(d + "/titulo", { force: true });`,
);
// hyprctl clients -j | dispatch …: con `viejo`, un Hyprland que no entiende la sintaxis de Lua.
process.env.HILOS_HYPRCTL = falso(
  "hyprctl",
  `if (a[0] === "clients") {
  const t = fs.existsSync(d + "/titulo") ? fs.readFileSync(d + "/titulo", "utf8") : "zsh";
  process.stdout.write(fs.readFileSync(d + "/clientes.json", "utf8").replace("@TITULO@", t));
} else {
  const lua = a[1].startsWith("hl.dsp.");
  console.log(lua === !fs.existsSync(d + "/viejo") ? "ok" : "Invalid dispatcher");
}`,
);

const { enfoques, irA, kittyDe, shellDeVentana, ubicar } = await import("../electron/terminal.ts");

const hijos: ReturnType<typeof spawn>[] = [];
/** Un proceso de mentira con ese entorno (el `claude` de una terminal). */
const proceso = (env: Record<string, string>) => {
  const h = spawn("sleep", ["300"], { env, stdio: "ignore" });
  hijos.push(h);
  return h.pid!;
};
after(() => {
  for (const h of hijos) h.kill("SIGKILL");
  rmSync(tmp, { recursive: true, force: true });
});
const llamadas = (cual: string): string[][] => {
  const f = path.join(tmp, `${cual}.log`);
  const r = existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  rmSync(f, { force: true });
  return r;
};
const clientes = (cs: unknown[]) => writeFileSync(path.join(tmp, "clientes.json"), JSON.stringify(cs));
const ls = (ventana: number, pid: number) =>
  writeFileSync(path.join(tmp, "ls.json"), JSON.stringify([{ id: 1, tabs: [{ id: 1, windows: [{ id: 3, pid: 1 }] }, { id: 2, windows: [{ id: ventana, pid }] }] }]));

test("kittyDe: la ventana y el socket salen del entorno del proceso", () => {
  assert.deepEqual(kittyDe("A=1\0KITTY_WINDOW_ID=7\0KITTY_LISTEN_ON=unix:/tmp/mykitty-99\0B=2\0"), { socket: "unix:/tmp/mykitty-99", ventana: 7 });
  assert.equal(kittyDe("KITTY_WINDOW_ID=7\0"), null, "sin socket no hay control remoto");
  assert.equal(kittyDe("KITTY_LISTEN_ON=unix:/x\0KITTY_WINDOW_ID=abc\0"), null);
  assert.equal(kittyDe(""), null);
});

test("shellDeVentana: el pid del shell de esa ventana, en cualquier pestaña", () => {
  const arbol = [{ tabs: [{ windows: [{ id: 1, pid: 10 }] }, { windows: [{ id: 7, pid: 70 }] }] }, { tabs: [{ windows: [{ id: 9, pid: 90 }] }] }];
  assert.equal(shellDeVentana(arbol, 7), 70);
  assert.equal(shellDeVentana(arbol, 9), 90);
  assert.equal(shellDeVentana(arbol, 8), null);
  assert.equal(shellDeVentana({ no: "es" }, 7), null);
});

test("enfoques: primero la sintaxis de Lua, después la vieja; una dirección rara no llega al compositor", () => {
  assert.deepEqual(enfoques("0x55aa"), [
    ["dispatch", 'hl.dsp.focus({ window = "address:0x55aa" })'],
    ["dispatch", "focuswindow", "address:0x55aa"],
  ]);
  assert.deepEqual(enfoques('0x1" }) os.execute("x'), []);
});

test("en kitty: cambia a la pestaña de esa ventana y enfoca la ventana del sistema que muestra la marca", { timeout: 20_000 }, async () => {
  // El `claude` cuelga del shell de la ventana 7 (acá, este test), que cuelga de kitty.
  const pid = proceso({ KITTY_WINDOW_ID: "7", KITTY_LISTEN_ON: "unix:/tmp/de-mentira" });
  ls(7, process.pid);
  // kitty es un solo proceso: sus dos ventanas del sistema tienen el mismo pid.
  clientes([
    { address: "0xaaa", pid: KITTY, title: "otra" },
    { address: "0xbbb", pid: KITTY, title: "@TITULO@" },
  ]);
  assert.deepEqual(await ubicar(pid), { tipo: "kitty", socket: "unix:/tmp/de-mentira", ventana: 7, kitty: KITTY });
  llamadas("kitten");
  llamadas("hyprctl");
  assert.equal(await irA(pid), true);
  const k = llamadas("kitten").map((a) => a.slice(3));
  assert.deepEqual(k[1], ["focus-window", "--match", "id:7"]);
  assert.equal(k[2][0], "set-window-title");
  assert.match(k[2][3], /^trama-[0-9a-f]{8}$/);
  assert.deepEqual(k.at(-1), ["set-window-title", "--match", "id:7"], "el título vuelve a ser el del programa");
  assert.equal(existsSync(path.join(tmp, "titulo")), false);
  const d = llamadas("hyprctl").filter((a) => a[0] === "dispatch");
  assert.deepEqual(d, [["dispatch", 'hl.dsp.focus({ window = "address:0xbbb" })']], "la que mostró la marca, no la otra");
});

test("el entorno miente (la ventana ya no está, o el proceso no cuelga de ella): no se la ubica por kitty", { timeout: 20_000 }, async () => {
  const pid = proceso({ KITTY_WINDOW_ID: "7", KITTY_LISTEN_ON: "unix:/tmp/de-mentira" });
  clientes([
    { address: "0xaaa", pid: KITTY, title: "a" },
    { address: "0xbbb", pid: KITTY, title: "b" },
  ]);
  ls(8, process.pid);
  assert.equal(await ubicar(pid), null, "esa ventana de kitty ya no existe");
  ls(7, 1);
  assert.equal(await ubicar(pid), null, "la ventana 7 es de otro shell");
  assert.equal(await irA(pid), false);
  assert.deepEqual(llamadas("hyprctl").filter((a) => a[0] === "dispatch"), [], "sin ubicarla no se enfoca nada");
});

test("sin kitty: la ventana del primer ancestro que tenga una sola; con un Hyprland viejo, la sintaxis vieja", { timeout: 20_000 }, async () => {
  const pid = proceso({});
  clientes([{ address: "0xccc", pid: process.pid, title: "foot" }]);
  assert.deepEqual(await ubicar(pid), { tipo: "compositor", direccion: "0xccc" });
  writeFileSync(path.join(tmp, "viejo"), "");
  llamadas("hyprctl");
  assert.equal(await irA(pid), true);
  assert.deepEqual(llamadas("hyprctl").filter((a) => a[0] === "dispatch"), [
    ["dispatch", 'hl.dsp.focus({ window = "address:0xccc" })'],
    ["dispatch", "focuswindow", "address:0xccc"],
  ]);
  rmSync(path.join(tmp, "viejo"));
  // Dos ventanas con ese pid: no se sabe cuál.
  clientes([
    { address: "0xccc", pid: process.pid, title: "a" },
    { address: "0xddd", pid: process.pid, title: "b" },
  ]);
  assert.equal(await ubicar(pid), null);
  clientes([]);
  assert.equal(await ubicar(pid), null);
  assert.equal(await ubicar(0), null);
});
