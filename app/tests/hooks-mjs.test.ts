// Los hooks de motor/hooks en Node (.mjs): corren con node sin jq ni bash, así que estas pruebas corren también en Windows. La
// paridad contra los .sh (mismas entradas, mismas salidas) está en tests/paridad/casos-hooks.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HOOKS = path.join(import.meta.dirname, "..", "..", "motor", "hooks");
const hook = (nombre: string) => path.join(HOOKS, `${nombre}.mjs`);

type Salida = { rc: number | null; stdout: string; stderr: string };
const temporal = () => mkdtempSync(path.join(tmpdir(), "trama-hooks-"));
/** Entorno limpio de lo de Trama, con la casa y el estado en `dir`. */
function entorno(dir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|CLAUDE)/.test(k)) base[k] = v;
  return { ...base, HOME: dir, USERPROFILE: dir, PA_STATE: path.join(dir, "estado"), XDG_CONFIG_HOME: path.join(dir, "config"), ...extra };
}
function correr(nombre: string, args: string[], stdin: unknown, env: NodeJS.ProcessEnv): Salida {
  const input = typeof stdin === "string" ? stdin : JSON.stringify(stdin);
  const r = spawnSync(process.execPath, [hook(nombre), ...args], { input, encoding: "utf8", env });
  return { rc: r.status, stdout: r.stdout, stderr: r.stderr };
}
const bash = (command: string, extra: Record<string, unknown> = {}) => ({ tool_name: "Bash", tool_input: { command, ...extra } });
const conTemporal = (f: (dir: string) => void) => {
  const dir = temporal();
  try {
    f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("hooks .mjs: todos pasan node --check", () => {
  for (const n of ["latido", "destructive-guard", "statusline-espejo", "agy-pa", "docker-guard"]) {
    const r = spawnSync(process.execPath, ["--check", hook(n)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${n}.mjs: ${r.stderr}`);
  }
});

// ============================================================================ statusline-espejo

const ESTADO_LINEA = {
  session_id: "abc-123",
  cwd: "/home/u/p",
  workspace: { current_dir: "/home/u/p/sub" },
  model: { id: "claude-sonnet-5-5" },
  prompt_cache: { ttl: 300 },
  rate_limits: { five_hour: { used_percentage: 12.5, resets_at: 1790000000 }, seven_day: { used_percentage: 40, resets_at: 1790500000 } },
};

test("statusline-espejo: escribe la sesión y suma al historial sólo cuando cambia", () => {
  conTemporal((dir) => {
    const env = entorno(dir);
    const sl = path.join(dir, "estado", "statusline");
    const r = correr("statusline-espejo", [], ESTADO_LINEA, env);
    assert.deepEqual([r.rc, r.stdout, r.stderr], [0, "", ""]);
    const ses = JSON.parse(readFileSync(path.join(sl, "abc-123.json"), "utf8"));
    assert.equal(ses.version, 1);
    assert.equal(ses.cwd, "/home/u/p/sub", "workspace.current_dir gana a cwd");
    assert.equal(ses.modelo, "claude-sonnet-5-5");
    assert.deepEqual(ses.prompt_cache, { ttl: 300 });
    assert.equal(ses.config_dir, null);
    assert.deepEqual(Object.keys(ses), ["version", "ts", "session_id", "cwd", "modelo", "prompt_cache", "config_dir", "rate_limits"]);
    const historial = () => readFileSync(path.join(sl, "historial.jsonl"), "utf8").trim().split("\n");
    assert.equal(historial().length, 1);
    const fila = JSON.parse(historial()[0]!);
    assert.deepEqual(Object.keys(fila), ["ts", "h5", "h5_reset", "sem", "sem_reset"]);
    assert.deepEqual([fila.h5, fila.h5_reset, fila.sem, fila.sem_reset], [12.5, 1790000000, 40, 1790500000]);
    correr("statusline-espejo", [], ESTADO_LINEA, env);
    assert.equal(historial().length, 1, "lo mismo no suma otra línea");
    correr("statusline-espejo", [], { ...ESTADO_LINEA, rate_limits: { ...ESTADO_LINEA.rate_limits, five_hour: { used_percentage: 13, resets_at: 1790000000 } } }, env);
    assert.equal(historial().length, 2);
  });
});

test("statusline-espejo: config_dir sale de CLAUDE_CONFIG_DIR y va también al historial", () => {
  conTemporal((dir) => {
    correr("statusline-espejo", [], ESTADO_LINEA, entorno(dir, { CLAUDE_CONFIG_DIR: "/cuenta/2" }));
    const sl = path.join(dir, "estado", "statusline");
    assert.equal(JSON.parse(readFileSync(path.join(sl, "abc-123.json"), "utf8")).config_dir, "/cuenta/2");
    assert.equal(JSON.parse(readFileSync(path.join(sl, "historial.jsonl"), "utf8")).config_dir, "/cuenta/2");
  });
});

test("statusline-espejo: un session_id raro, sin rate_limits o un JSON roto no rompen nada", () => {
  conTemporal((dir) => {
    const env = entorno(dir);
    const sl = path.join(dir, "estado", "statusline");
    for (const raro of [{ ...ESTADO_LINEA, session_id: "../x" }, { ...ESTADO_LINEA, session_id: "" }, "{roto", "", "[1]"]) {
      const r = correr("statusline-espejo", [], raro, env);
      assert.equal(r.rc, 0);
    }
    assert.equal(existsSync(sl), false, "no se escribió nada");
    correr("statusline-espejo", [], { ...ESTADO_LINEA, rate_limits: undefined }, env);
    assert.equal(existsSync(path.join(sl, "abc-123.json")), true);
    assert.equal(existsSync(path.join(sl, "historial.jsonl")), false, "sin cuota no hay historial");
  });
});

test("statusline-espejo: le pasa la entrada al statusline original y devuelve su salida y su código", () => {
  conTemporal((dir) => {
    const env = entorno(dir);
    const eco = "process.stdin.pipe(process.stdout)";
    const r = correr("statusline-espejo", [process.execPath, "-e", eco], ESTADO_LINEA, env);
    assert.equal(r.rc, 0);
    assert.deepEqual(JSON.parse(r.stdout), ESTADO_LINEA);
    const e = correr("statusline-espejo", [process.execPath, "-e", "process.exit(7)"], ESTADO_LINEA, env);
    assert.equal(e.rc, 7);
    const n = correr("statusline-espejo", ["trama-no-existe-xyz"], ESTADO_LINEA, env);
    assert.equal(n.rc, 127);
  });
});

// ============================================================================ latido

const leerHb = (ruta: string) => Object.fromEntries(readFileSync(ruta, "utf8").trimEnd().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

test("latido: pre y post dejan el heartbeat con una línea por campo", () => {
  conTemporal((dir) => {
    const hb = path.join(dir, "w1.heartbeat");
    const env = entorno(dir);
    let r = correr("latido", [hb, "pre"], bash("ls -la", { description: "listar\ttodo\ny más" }), env);
    assert.deepEqual([r.rc, r.stdout, r.stderr], [0, "", ""]);
    let h = leerHb(hb);
    assert.deepEqual([h.tool, h.envuelo, h.desc], ["Bash", "1", "listar todo y más"]);
    assert.match(h.epoch!, /^\d{10}$/);
    r = correr("latido", [hb, "post"], bash("ls -la"), env);
    h = leerHb(hb);
    assert.deepEqual([h.envuelo, h.desc], ["0", "ls -la"]);
    assert.equal(readFileSync(hb, "utf8").includes("\r"), false);
  });
});

test("latido: la descripción se corta a 160 bytes y sin herramienta queda «?»", () => {
  conTemporal((dir) => {
    const hb = path.join(dir, "w1.heartbeat");
    correr("latido", [hb, "pre"], { tool_name: "Task", tool_input: { description: "a".repeat(300) } }, entorno(dir));
    assert.equal(leerHb(hb).desc!.length, 160);
    correr("latido", [hb, "pre"], "esto no es json", entorno(dir));
    assert.equal(leerHb(hb).tool, "?");
  });
});

test("latido: las guardias de git, release, timeout y background bloquean con exit 2 y el motivo por stderr", () => {
  conTemporal((dir) => {
    const hb = path.join(dir, "w1.heartbeat");
    const env = entorno(dir, { TRAMA_DUENO: "Ana" });
    const bloquea = (cmd: Record<string, unknown> | string, trozo: RegExp, extra: Record<string, unknown> = {}) => {
      const r = correr("latido", [hb, "pre"], typeof cmd === "string" ? bash(cmd, extra) : cmd, env);
      assert.equal(r.rc, 2, `${JSON.stringify(cmd)} => ${r.rc}`);
      assert.match(r.stderr, trozo);
      assert.equal(r.stdout, "");
    };
    const pasa = (cmd: string, extra: Record<string, unknown> = {}) => {
      const r = correr("latido", [hb, "pre"], bash(cmd, extra), env);
      assert.deepEqual([r.rc, r.stdout, r.stderr], [0, "", ""], cmd);
    };
    bloquea("sleep 1", /run_in_background/, { run_in_background: true });
    bloquea("cargo build --release", /build de release.*binario que usa Ana/, { timeout: 1 });
    bloquea("cargo test", /parámetro 'timeout'/);
    bloquea("git stash", /nada de 'git stash'/);
    bloquea("git -C x add -A", /git add -A/);
    bloquea("git commit -am x", /git commit -a/);
    bloquea("cargo clean", /cargo clean/);
    pasa("cargo test", { timeout: 600000 });
    pasa("git stash list");
    pasa("git add src/a.ts");
    pasa("git commit -m x");
    assert.equal(leerHb(hb).tool, "Bash", "el latido se escribe aunque la guardia bloquee");
  });
});

test("latido: instalar dependencias se bloquea sólo si hay otro worker que escribe vivo (el pid se prueba de verdad)", () => {
  conTemporal((dir) => {
    const estado = path.join(dir, "estado");
    mkdirSync(estado, { recursive: true });
    const hb = path.join(estado, "w1.heartbeat");
    const env = entorno(dir);
    writeFileSync(path.join(estado, "w1.running"), "proyecto=demo\n");
    const instalar = () => correr("latido", [hb, "pre"], bash("npm install lodash"), env);
    assert.equal(instalar().rc, 0, "sin otro worker");
    writeFileSync(path.join(estado, "demo@2.running"), "proyecto=demo\npid=2147483000\n");
    assert.equal(instalar().rc, 0, "el otro ya no existe");
    writeFileSync(path.join(estado, "demo@2.running"), `proyecto=demo\npid=${process.pid}\nleer=1\n`);
    assert.equal(instalar().rc, 0, "el otro es --leer");
    writeFileSync(path.join(estado, "demo@2.running"), `proyecto=demo\npid=${process.pid}\n`);
    const r = instalar();
    assert.equal(r.rc, 2);
    assert.match(r.stderr, /otro worker corriendo/);
  });
});

test("latido: PA_RECORTE reescribe el comando de los tests y respeta el resto de tool_input", () => {
  conTemporal((dir) => {
    const hb = path.join(dir, "w1.heartbeat");
    const r = correr("latido", [hb, "pre"], bash("npm test", { timeout: 300000, description: "tests" }), entorno(dir, { PA_RECORTE: "150" }));
    assert.equal(r.rc, 0);
    const o = JSON.parse(r.stdout);
    assert.equal(o.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.deepEqual(Object.keys(o.hookSpecificOutput.updatedInput), ["command", "timeout", "description"]);
    assert.match(o.hookSpecificOutput.updatedInput.command, /^set -o pipefail; \( npm test \) 2>&1 \| awk -v n=150 /);
    for (const sin of ["npm test | tail", "npm test && ls", "ls"]) {
      assert.equal(correr("latido", [hb, "pre"], bash(sin, { timeout: 1 }), entorno(dir, { PA_RECORTE: "150" })).stdout, "", sin);
    }
    assert.equal(correr("latido", [hb, "pre"], bash("npm test", { timeout: 1 }), entorno(dir, { PA_RECORTE: "0" })).stdout, "");
  });
});

test("latido: --leer sólo deja pasar git de lectura", () => {
  conTemporal((dir) => {
    const hb = path.join(dir, "w1.heartbeat");
    const env = entorno(dir);
    const rc = (cmd: string) => correr("latido", [hb, "pre", "leer"], bash(cmd), env).rc;
    for (const ok of ["git log --oneline", "git -C /x diff HEAD | head -50", "git --no-pager show HEAD", "git branch", "git branch --list 'f*'", "git branch -vv", "git worktree list", "git stash list", "git stash show"]) {
      assert.equal(rc(ok), 0, ok);
    }
    for (const mal of ["ls", "git log; ls", "git log > x", "git log $(x)", "git diff --output=x", "git grep -Oless x", "git branch nueva", "git branch -d x", "git worktree add x", "git stash pop", "git commit -m x", "git log | sort -o x", "git log || ls"]) {
      assert.equal(rc(mal), 2, mal);
    }
    assert.equal(correr("latido", [hb, "pre", "leer"], { tool_name: "Read", tool_input: {} }, env).rc, 0);
  });
});

test("latido: el contador de turnos avisa cuando quedan 5 o menos y se corta con un contador roto", () => {
  conTemporal((dir) => {
    const hb = path.join(dir, "w1.heartbeat");
    const env = entorno(dir, { PA_MAX_TURNS: "7" });
    const salidas: string[] = [];
    for (let i = 0; i < 8; i++) salidas.push(correr("latido", [hb, "post"], bash("ls"), env).stdout);
    assert.equal(readFileSync(`${hb}.turnos`, "utf8"), "8");
    assert.equal(salidas[0], "", "quedan 6");
    const quedan = salidas.map((s) => (s ? Number(/quedan como mucho (-?\d+)/.exec(JSON.parse(s).hookSpecificOutput.additionalContext)?.[1]) : null));
    assert.deepEqual(quedan, [null, 5, 4, 3, 2, 1, 0, null]);
    assert.equal(JSON.parse(salidas[1]!).hookSpecificOutput.hookEventName, "PostToolUse");
    writeFileSync(`${hb}.turnos`, "abc");
    correr("latido", [hb, "post"], bash("ls"), env);
    assert.equal(readFileSync(`${hb}.turnos`, "utf8"), "abc", "un contador que no es un número no se reescribe");
  });
});

test("latido: el aviso de «movido a background» sólo mira el principio de la respuesta de un Bash", () => {
  conTemporal((dir) => {
    const hb = path.join(dir, "w1.heartbeat");
    const env = entorno(dir);
    const frase = "Command did not complete within its 120000ms timeout and was moved to the background";
    const aviso = (resp: unknown, tool = "Bash") => correr("latido", [hb, "post"], { tool_name: tool, tool_input: { command: "x" }, tool_response: resp }, env).stdout;
    assert.match(JSON.parse(aviso(frase)).hookSpecificOutput.additionalContext, /mandó ese comando a background/);
    assert.match(aviso({ stdout: frase }), /additionalContext/);
    assert.equal(aviso(`${"x".repeat(320)} ${frase}`), "", "más allá de los 300 bytes no cuenta");
    assert.equal(aviso(frase, "Read"), "");
  });
});

// ============================================================================ destructive-guard y docker-guard

test("destructive-guard: bloquea con exit 2 y deja el patrón en stderr; lo demás pasa", () => {
  conTemporal((dir) => {
    const env = entorno(dir, { TRAMA_DUENO: "Ana" });
    const rc = (cmd: string) => correr("destructive-guard", [], bash(cmd), env);
    const malos: [string, RegExp][] = [
      ["rm -rf /", /destructivo.*Patron: .*rm.*cmd: rm -rf \//],
      ["git push --force origin main", /destructivo/],
      ["dd if=/dev/zero of=/dev/sda", /destructivo/],
      ["CARGO_TARGET_DIR=/tmp/x cargo test", /CARGO_TARGET_DIR/],
      ["pkill -f sway", /sesion grafica/],
      ["docker run --privileged debian", /docker\/podman bloqueado: --privileged.*desktop de Ana/],
      ["bash -c 'docker run -v /dev:/dev x'", /montar \/dev del host/],
      ["docker run --entrypoint systemd x", /systemd\/init/],
    ];
    for (const [cmd, re] of malos) {
      const r = rc(cmd);
      assert.equal(r.rc, 2, cmd);
      assert.match(r.stderr, re, cmd);
      assert.equal(r.stdout, "");
    }
    for (const bien of ["ls -la", "rm foo.txt", "git push origin main", "docker ps", "docker run --init debian sleep 1", "pkill -f '^mpv x'", "echo docker es lindo"]) {
      const r = rc(bien);
      assert.deepEqual([r.rc, r.stderr], [0, ""], bien);
    }
    assert.equal(correr("destructive-guard", [], { tool_name: "Read", tool_input: { file_path: "/etc/passwd" } }, env).rc, 0);
    assert.equal(correr("destructive-guard", [], "{roto", env).rc, 0);
    assert.equal(correr("destructive-guard", [], "", env).rc, 0);
  });
});

test("destructive-guard: la config (guard.json) agrega destinos de backup y el congelado", () => {
  conTemporal((dir) => {
    const cfg = path.join(dir, "guard.json");
    const marcador = path.join(dir, "CONGELADO");
    writeFileSync(cfg, JSON.stringify({ etiquetas_usb: ["MI-USB"], montajes: ["/mnt/viejo"], congelado: { etiqueta: "CONGE", marcador, patrones: ["recuperar-todo"] } }));
    const env = entorno(dir, { TRAMA_GUARD_CONFIG: cfg });
    const rc = (cmd: string) => correr("destructive-guard", [], bash(cmd), env).rc;
    assert.equal(rc("rm -r /mnt/viejo/x"), 2);
    assert.equal(rc("rm /dev/disk/by-label/MI-USB/x"), 2);
    assert.equal(rc("udisksctl unmount -b /dev/disk/by-label/MI-USB"), 2);
    assert.equal(rc("udisksctl mount -b /dev/disk/by-label/CONGE"), 0, "sin marcador no hay congelado");
    writeFileSync(marcador, "x");
    assert.equal(rc("udisksctl mount -b /dev/disk/by-label/CONGE"), 2);
    assert.equal(rc("recuperar-todo ahora"), 2);
    assert.equal(rc("bash -n ~/x.sh"), 0, "el chequeo de sintaxis solo queda exento");
    assert.equal(rc("bash -n x.sh; recuperar-todo"), 2);
  });
});

test("docker-guard: analiza el comando (wrappers, shells, heredocs, imágenes locales no) y exporta revisar", async () => {
  const { revisar } = (await import(pathToFileURL(hook("docker-guard")).href)) as { revisar: (d: unknown) => number };
  const r = (command: string, extra: Record<string, unknown> = {}) => revisar({ tool_name: "Bash", tool_input: { command }, ...extra });
  assert.equal(r("docker run --privileged x"), 2);
  assert.equal(r("sudo -u root env A=1 docker run --cap-add ALL x"), 2);
  assert.equal(r("timeout 5 podman create --device /dev/dri x"), 2);
  assert.equal(r("sh -c 'docker run --pid=host x'"), 2);
  assert.equal(r("echo \"$(docker run --ipc=host x)\""), 2);
  assert.equal(r("cat <<EOF | sudo bash\ndocker run --privileged x\nEOF"), 2);
  assert.equal(r("cat <<EOF\n$(docker run --privileged x)\nEOF"), 2);
  assert.equal(r("cat <<'EOF'\n$(docker run --privileged x)\nEOF"), 0, "con comillas el shell no expande");
  assert.equal(r("docker run -v /var/run/dbus:/x y"), 2);
  assert.equal(r("docker run -v /srv/datos:/d y"), 0);
  assert.equal(r("docker run --mount type=bind,src=/run/user/1000,dst=/r y"), 2);
  assert.equal(r("docker run debian sh -c 'exec systemd'"), 2);
  assert.equal(r("docker run --init --rm -it -v /tmp/x:/x debian bash"), 0);
  assert.equal(r("docker run --device /dev/net/tun x"), 0);
  assert.equal(r("docker run --privileged=false x"), 0);
  assert.equal(r("docker -H ssh://h run --privileged x"), 2);
  assert.equal(r("docker ps"), 0);
  assert.equal(revisar({ tool_name: "Read", tool_input: { command: "docker run --privileged x" } }), 0);
  assert.equal(revisar(null), 0);
  assert.equal(r("cd /dev && docker run -v .:/x y"), 0, "el cd literal sólo cambia el cwd; un origen relativo no se evalúa");
});

// ============================================================================ agy-pa

const llamada = (name: string, args: Record<string, unknown> = {}) => ({ toolCall: { name, args } });

test("agy-pa: sin worker sólo corre destructive-guard y no imprime nada si no tiene nada que decir", () => {
  conTemporal((dir) => {
    const env = entorno(dir);
    const ok = correr("agy-pa", ["pre"], llamada("run_command", { CommandLine: "ls -la" }), env);
    assert.deepEqual([ok.rc, ok.stdout], [0, ""]);
    const mal = correr("agy-pa", ["pre"], llamada("run_command", { CommandLine: "rm -rf /" }), env);
    assert.equal(mal.rc, 0);
    const o = JSON.parse(mal.stdout);
    assert.equal(o.decision, "deny");
    assert.match(o.reason, /^GUARD: comando potencialmente destructivo/);
    assert.equal(correr("agy-pa", ["post"], llamada("run_command", { CommandLine: "ls" }), env).stdout.trim(), "{}");
    assert.equal(correr("agy-pa", ["inv"], { invocationNum: 3 }, env).stdout.trim(), "{}");
  });
});

test("agy-pa: en un worker aplica privacidad, allowlist, git y las guardias de latido; y escribe el latido", () => {
  conTemporal((dir) => {
    const raiz = "/work/wt";
    const hb = path.join(dir, "agy.heartbeat");
    const env = entorno(dir, { PA_AGY_HB: hb, PA_AGY_RAIZ: raiz, PA_AGY_RAMA: "rama-x", PA_MAX_TURNS: "30" });
    const pre = (obj: unknown, extra: Record<string, string> = {}) => {
      const r = correr("agy-pa", ["pre"], obj, { ...env, ...extra });
      assert.equal(r.rc, 0);
      return r.stdout ? JSON.parse(r.stdout) : null;
    };
    const razon = (obj: unknown, extra?: Record<string, string>) => pre(obj, extra)?.reason as string | undefined;
    assert.equal(pre(llamada("run_command", { CommandLine: "git status" })), null);
    assert.equal(leerHb(hb).tool, "Bash", "el latido sale de la traducción a Claude");
    assert.match(razon(llamada("browser_subagent", { Task: "x" }))!, /no está permitida/);
    assert.match(razon(llamada("view_file", { AbsolutePath: "/etc/passwd" }))!, /privacidad.*\/etc\/passwd/);
    assert.match(razon(llamada("view_file", { AbsolutePath: "../../../etc/hosts" }))!, /privacidad/);
    assert.equal(pre(llamada("view_file", { AbsolutePath: "src/a.ts" })), null);
    assert.equal(pre(llamada("view_file", { AbsolutePath: "/tmp/x" })), null);
    assert.match(razon(llamada("run_command", { CommandLine: "curl https://x.y" }))!, /sin red/);
    assert.match(razon(llamada("run_command", { CommandLine: "sudo ssh h" }))!, /sin red/);
    assert.match(razon(llamada("run_command", { CommandLine: "git clone x" }))!, /sin red/);
    assert.match(razon(llamada("run_command", { CommandLine: "cd" }))!, /sin ruta/);
    assert.match(razon(llamada("run_command", { CommandLine: "eval ls" }))!, /eval/);
    assert.match(razon(llamada("run_command", { CommandLine: "cat /etc/shadow" }))!, /privacidad/);
    assert.match(razon(llamada("run_command", { CommandLine: "git push" }))!, /git push/);
    assert.match(razon(llamada("run_command", { CommandLine: "git reset --hard" }))!, /rama-x/);
    assert.match(razon(llamada("run_command", { CommandLine: "git rebase main" }))!, /rebasees/);
    assert.equal(pre(llamada("run_command", { CommandLine: "git rebase main" }), { PA_AGY_REBASE: "1" }), null);
    assert.equal(pre(llamada("run_command", { CommandLine: "git checkout -- a.ts" })), null);
    assert.match(razon(llamada("write_to_file", { TargetFile: "/home/otro/a.txt" }))!, /fuera de tu worktree/);
    assert.equal(pre(llamada("write_to_file", { TargetFile: `${raiz}/a.txt` })), null);
    assert.match(razon(llamada("run_command", { CommandLine: "git add -A" }))!, /git add -A/, "la guardia de latido sale como deny");
    assert.match(razon(llamada("run_command", { CommandLine: "cargo build --release" }))!, /build de release/);
    const rec = pre(llamada("run_command", { CommandLine: "npm test" }), { PA_RECORTE: "100" });
    assert.equal(rec.decision, "allow");
    assert.match(rec.overwrite.CommandLine, /^set -o pipefail; \( npm test \)/);
    assert.match(razon(llamada("run_command", { CommandLine: "ls" }), { PA_AGY_MODO: "leer" })!, /LECTURA/);
    assert.match(razon(llamada("write_to_file", { TargetFile: `${raiz}/a` }), { PA_AGY_MODO: "leer" })!, /LECTURA/);
  });
});

test("agy-pa: PostInvocation avisa cerca del tope y termina pasado el tope", () => {
  conTemporal((dir) => {
    const env = entorno(dir, { PA_AGY_HB: path.join(dir, "agy.heartbeat"), PA_MAX_TURNS: "30" });
    const inv = (n: number) => JSON.parse(correr("agy-pa", ["inv"], { invocationNum: n }, env).stdout);
    assert.deepEqual(inv(3), {});
    assert.match(inv(27).injectSteps[0].ephemeralMessage, /te quedan como mucho 3 turnos/);
    assert.deepEqual(inv(31), { terminationBehavior: "terminate" });
  });
});
