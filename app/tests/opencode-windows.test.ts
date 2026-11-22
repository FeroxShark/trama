// OpenCode en Windows (CTX-53): dónde se busca `opencode.cmd` (npm) y cómo se lo lanza (por cmd.exe, no directo: EINVAL). Linux no cambia.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Cuentas } from "../electron/cli/cuentas.ts";
import { dirsOpencode } from "../electron/cli/pa/motores/chequeo.ts";

const HOME = "C:\\Users\\ana";

test("win32: dirsOpencode incluye %APPDATA%\\npm y .local\\bin con rutas de Windows", () => {
  const d = dirsOpencode({ APPDATA: `${HOME}\\AppData\\Roaming` }, HOME, "win32");
  assert.ok(d.includes(`${HOME}\\AppData\\Roaming\\npm`), d.join(" | "));
  assert.ok(d.includes(`${HOME}\\.local\\bin`));
  assert.ok(d.includes(`${HOME}\\.opencode\\bin`));
  assert.ok(d.every((x) => !x.includes("/")), "sin barras de Linux");
});

test("linux: dirsOpencode es la lista de siempre", () => {
  assert.deepEqual(dirsOpencode({ npm_config_prefix: "/opt/npm" }, "/home/ana", "linux"), [
    "/home/ana/.opencode/bin",
    "/home/ana/.local/bin",
    "/opt/npm/bin",
    "/home/ana/.npm-global/bin",
    "/usr/local/bin",
  ]);
});

/** Un `spawn` falso que anota qué se lanzó y termina con código 0. */
function falso() {
  const vistos: { cmd: string; args: string[]; o: SpawnOptions }[] = [];
  const spawn = (cmd: string, args: string[], o: SpawnOptions) => {
    vistos.push({ cmd, args, o });
    const h = new EventEmitter() as ChildProcess;
    Object.assign(h, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid: 1 });
    setImmediate(() => {
      (h.stdout as PassThrough).end();
      (h.stderr as PassThrough).end();
      h.emit("close", 0, null);
    });
    return h;
  };
  return { vistos, spawn };
}
const io = { out: () => {}, err: () => {} };

test("win32: un opencode.cmd se lanza por cmd.exe /d /s /c con argumentos verbatim", async () => {
  const f = falso();
  const c = new Cuentas({ ComSpec: "C:\\Windows\\System32\\cmd.exe" }, io);
  const cmd = `${HOME}\\AppData\\Roaming\\npm\\opencode.cmd`;
  const r = await c.correrOpencode(cmd, ["models"], { spawn: f.spawn, input: "" }, "win32");
  assert.equal(r.codigo, 0);
  assert.equal(f.vistos[0]!.cmd, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(f.vistos[0]!.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(f.vistos[0]!.o.windowsVerbatimArguments, true);
  assert.equal(f.vistos[0]!.o.windowsHide, true);
});

test("linux: opencode se lanza directo, sin cmd.exe", async () => {
  const f = falso();
  const c = new Cuentas({}, io);
  await c.correrOpencode("/usr/bin/opencode", ["models"], { spawn: f.spawn, input: "" }, "linux");
  assert.equal(f.vistos[0]!.cmd, "/usr/bin/opencode");
  assert.deepEqual(f.vistos[0]!.args, ["models"]);
  assert.notEqual(f.vistos[0]!.o.windowsVerbatimArguments, true);
});
