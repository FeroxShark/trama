// Qué terminal se abre para Actualizar (electron/terminal-lanzar.ts), con un PATH de mentira.
import assert from "node:assert/strict";
import test from "node:test";
import { soloPosix } from "./plataforma.ts";
import { resolverTerminal } from "../electron/terminal-lanzar.ts";

const hay = (...fs: string[]) => (f: string) => fs.includes(f);

test("HILOS_TERMINAL manda, con la bandera de su terminal si la conocemos", () => {
  assert.deepEqual(resolverTerminal({ HILOS_TERMINAL: "/x/falsa" }, hay()), ["/x/falsa"]);
  assert.deepEqual(resolverTerminal({ HILOS_TERMINAL: "konsole" }, hay()), ["konsole", "--nofork", "-e"]);
  assert.deepEqual(resolverTerminal({ HILOS_TERMINAL: "gnome-terminal" }, hay()), ["gnome-terminal", "--wait", "--"]);
});

test("$TERMINAL antes que las conocidas; después el orden de siempre", { skip: soloPosix("terminales de Linux ($TERMINAL, xterm…)") }, () => {
  const env = { PATH: "/usr/bin:/bin", TERMINAL: "alacritty" };
  assert.deepEqual(resolverTerminal(env, hay("/usr/bin/alacritty", "/usr/bin/kitty")), ["/usr/bin/alacritty", "-e"]);
  assert.deepEqual(resolverTerminal({ PATH: "/usr/bin" }, hay("/usr/bin/kitty", "/usr/bin/xterm")), ["/usr/bin/kitty"]);
  assert.deepEqual(resolverTerminal({ PATH: "/usr/bin" }, hay("/usr/bin/gnome-terminal", "/usr/bin/xterm")), ["/usr/bin/gnome-terminal", "--wait", "--"]);
  assert.deepEqual(resolverTerminal({ PATH: "/usr/bin" }, hay("/usr/bin/xterm")), ["/usr/bin/xterm", "-e"]);
});

test("sin ninguna: null", { skip: soloPosix("terminales de Linux ($TERMINAL, xterm…)") }, () => {
  assert.equal(resolverTerminal({ PATH: "/usr/bin" }, hay()), null);
});

test("x-terminal-emulator toma la bandera de la terminal a la que resuelve (gnome-terminal.wrapper, konsole)", { skip: soloPosix("terminales de Linux") }, () => {
  const env = { PATH: "/usr/bin" };
  const a = (destino: string) => (f: string) => (f === "/usr/bin/x-terminal-emulator" ? destino : f);
  assert.deepEqual(resolverTerminal(env, hay("/usr/bin/x-terminal-emulator"), "linux", a("/etc/alternatives/gnome-terminal.wrapper")), ["/usr/bin/x-terminal-emulator", "--wait", "--"]);
  assert.deepEqual(resolverTerminal(env, hay("/usr/bin/x-terminal-emulator"), "linux", a("/usr/bin/gnome-terminal")), ["/usr/bin/x-terminal-emulator", "--wait", "--"]);
  assert.deepEqual(resolverTerminal(env, hay("/usr/bin/x-terminal-emulator"), "linux", a("/usr/bin/konsole")), ["/usr/bin/x-terminal-emulator", "--nofork", "-e"]);
  assert.deepEqual(resolverTerminal(env, hay("/usr/bin/x-terminal-emulator"), "linux", a("/usr/bin/xterm")), ["/usr/bin/x-terminal-emulator", "-e"]);
  assert.deepEqual(resolverTerminal(env, hay("/usr/bin/x-terminal-emulator"), "linux", a("/usr/bin/foo")), ["/usr/bin/x-terminal-emulator", "-e"]);
});
