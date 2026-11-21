// Los workers de agy (Gemini) con la herramienta de archivos nueva de agy (read_file / write_file / edit_file, parámetro `Path`)
// y comandos con "/" o "~" de prosa o de código: entradas con la forma real de los streams de la corrida 20261121-053147-125364.
// Antes, el hook de agy-pa negaba las tres herramientas (no estaban en la allowlist) y el filtro de privacidad negaba `echo "a / b"`.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HOOK = path.join(import.meta.dirname, "..", "..", "motor", "hooks", "agy-pa.mjs");
const RAIZ = "/work/wt";

function conWorker(f: (pre: (nombre: string, args: Record<string, unknown>, extra?: Record<string, string>) => { reason?: string } | null) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "trama-agy-nombres-"));
  try {
    const base: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|CLAUDE)/.test(k)) base[k] = v;
    const env = { ...base, HOME: "/home/trama-falso", USERPROFILE: "/home/trama-falso", PA_STATE: path.join(dir, "estado"), PA_AGY_HB: path.join(dir, "hb"), PA_AGY_RAIZ: RAIZ, PA_AGY_RAMA: "rama-x", PA_MAX_TURNS: "30" };
    f((nombre, args, extra = {}) => {
      const input = JSON.stringify({ toolCall: { name: nombre, args } });
      const r = spawnSync(process.execPath, [HOOK, "pre"], { input, encoding: "utf8", env: { ...env, ...extra } });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout ? JSON.parse(r.stdout) : null;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("agy-pa: read_file / write_file / edit_file (Path) andan dentro del worktree y no fuera", () => {
  conWorker((pre) => {
    assert.equal(pre("read_file", { Path: `${RAIZ}/docs/reglas/tablero.md` }), null);
    assert.equal(pre("read_file", { Path: `${RAIZ}/a.ts`, StartLine: 10, EndLine: 40 }), null);
    assert.equal(pre("read_file", { Path: "app/src/a.ts" }), null);
    assert.equal(pre("write_file", { Path: `${RAIZ}/app/src/datos/tablero-vivo.ts` }), null);
    assert.equal(pre("edit_file", { Path: `${RAIZ}/app/src/barra/acople-logica.ts` }), null);
    assert.equal(pre("write_file", { Path: "/tmp/x.txt" }), null);
    // lo que los hooks protegen a propósito sigue cerrado
    assert.match(pre("read_file", { Path: "/etc/passwd" })?.reason ?? "", /privacidad/);
    assert.match(pre("read_file", { Path: "/home/ferox/.gemini/config/skills/taste-skill/SKILL.md" })?.reason ?? "", /privacidad/);
    assert.match(pre("read_file", { Path: "../../../etc/hosts" })?.reason ?? "", /privacidad/);
    assert.match(pre("write_file", { Path: "/home/ferox/.local/state/pa/worktrees/orquestador/x.py" })?.reason ?? "", /privacidad|fuera de tu worktree/);
    assert.match(pre("edit_file", { Path: "/home/ferox/Proyectos/trama/a.ts" })?.reason ?? "", /privacidad|fuera de tu worktree/);
    assert.match(pre("write_file", {})?.reason ?? "", /qué archivo/);
    // sigue habiendo allowlist: lo que no es de archivos ni terminal no corre
    assert.match(pre("schedule", { DurationSeconds: 240, Prompt: "x" })?.reason ?? "", /'schedule' no está permitida/);
    assert.equal(pre("manage_task", { Action: "status", TaskId: "a/task-300" }), null);
  });
});

test("agy-pa: en --leer, read_file corre y write_file / edit_file no", () => {
  conWorker((pre) => {
    const leer = { PA_AGY_MODO: "leer" };
    assert.equal(pre("read_file", { Path: `${RAIZ}/a.ts` }, leer), null);
    assert.match(pre("write_file", { Path: `${RAIZ}/a.ts` }, leer)?.reason ?? "", /LECTURA.*'write_file'/);
    assert.match(pre("edit_file", { Path: `${RAIZ}/a.ts` }, leer)?.reason ?? "", /LECTURA.*'edit_file'/);
  });
});

test("agy-pa: la herramienta `bash` pasa por las mismas guardias que run_command", () => {
  conWorker((pre) => {
    assert.equal(pre("bash", { CommandLine: "cd app && sed -n 40,70p /tmp/pa.txt" }), null);
    assert.match(pre("bash", { CommandLine: "cat /etc/shadow" })?.reason ?? "", /privacidad/);
    assert.match(pre("bash", { CommandLine: "git push" })?.reason ?? "", /git push/);
  });
});

test("agy-pa: un '/' o '~' de prosa o de código no es una ruta, pero las rutas sensibles siguen cerradas", () => {
  conWorker((pre) => {
    // los comandos reales que se negaron: "/" suelto dentro de un echo
    const real1 = 'nl -ba app/src/barra/Barra.tsx | sed -n \'340,465p\'\necho "=== Barra.tsx liderNuevo / carpetaNueva ==="\nrg -n -C 5 "LIDER_NUEVO|nuevaEn" app/src/barra/Barra.tsx | head -n 60';
    assert.equal(pre("run_command", { CommandLine: real1 }), null);
    // código con "~", "//", "/**" y división dentro de un heredoc entrecomillado y de comillas
    const heredoc = [
      "python3 - <<'PY'",
      "from pathlib import Path",
      "n = 10 / 2  # división",
      "p = Path('app/src/a.ts')",
      "p.write_text('''// comentario",
      "/** doc */",
      "const re = /^~foo/;  // ~ y ~usuario",
      "''')",
      "print(n ~ 3 if False else 0)",
      "PY",
    ].join("\n");
    assert.equal(pre("run_command", { CommandLine: heredoc }), null);
    assert.equal(pre("run_command", { CommandLine: `node -e 'console.log(8 / 2, "~", "//")'` }), null);
    assert.equal(pre("run_command", { CommandLine: "rg -n 'a / b|~x' app/src" }), null);
    // lo que de verdad protege
    for (const malo of [
      "cat ~/.ssh/id_rsa",
      "cat /etc/passwd",
      "cat /home/trama-falso/.config/trama/claves.env",
      "ls /",
      "cd ~",
      "ls ~",
      "cat ~root/.ssh/id_rsa",
      'cat "/etc/passwd"',
      "python3 - <<'PY'\nopen('/home/ferox/.ssh/id_rsa').read()\nPY",
      "echo hola; ls //",
    ]) {
      assert.match(pre("run_command", { CommandLine: malo })?.reason ?? "", /privacidad/, malo);
    }
  });
});
