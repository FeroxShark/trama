// Qué terminal se abre para Actualizar (electron/terminal-lanzar.ts), con un PATH de mentira.
import assert from "node:assert/strict";
import test from "node:test";
import { soloPosix } from "./plataforma.ts";
import { resolverTerminal } from "../electron/terminal-lanzar.ts";

const hay = (...fs: string[]) => (f: string) => fs.includes(f);

test("HILOS_TERMINAL manda, con la bandera de su terminal si la conocemos", () => {
  assert.deepEqual(resolverTerminal({ HILOS_TERMINAL: "/x/falsa" }, hay()), ["/x/falsa"]);
  assert.deepEqual(resolverTerminal({ HILOS_TERMINAL: "konsole" }, hay()), ["konsole", "-e"]);
});

test("$TERMINAL antes que las conocidas; después el orden de siempre", { skip: soloPosix("terminales de Linux ($TERMINAL, xterm…)") }, () => {
  const env = { PATH: "/usr/bin:/bin", TERMINAL: "alacritty" };
  assert.deepEqual(resolverTerminal(env, hay("/usr/bin/alacritty", "/usr/bin/kitty")), ["/usr/bin/alacritty", "-e"]);
  assert.deepEqual(resolverTerminal({ PATH: "/usr/bin" }, hay("/usr/bin/kitty", "/usr/bin/xterm")), ["/usr/bin/kitty"]);
  assert.deepEqual(resolverTerminal({ PATH: "/usr/bin" }, hay("/usr/bin/gnome-terminal", "/usr/bin/xterm")), ["/usr/bin/gnome-terminal", "--"]);
  assert.deepEqual(resolverTerminal({ PATH: "/usr/bin" }, hay("/usr/bin/xterm")), ["/usr/bin/xterm", "-e"]);
});

test("sin ninguna: null", { skip: soloPosix("terminales de Linux ($TERMINAL, xterm…)") }, () => {
  assert.equal(resolverTerminal({ PATH: "/usr/bin" }, hay()), null);
});
