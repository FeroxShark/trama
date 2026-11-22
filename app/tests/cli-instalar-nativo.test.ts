// instalar-nativo (electron/cli/instalar-nativo.ts): lo que la carcasa nativa de Windows corre después de copiar el payload.
// Corre en los dos sistemas (las carpetas se inyectan; `plataforma` sólo cambia cómo se escriben los comandos de los hooks).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { instalar, main, MARCA_SKILL, type OpcionesInstalar } from "../electron/cli/instalar-nativo.ts";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");

function conSandbox(f: (o: OpcionesInstalar, dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "trama-instalar-nativo-"));
  try {
    const app = path.join(dir, "trama", "app");
    mkdirSync(path.join(app, "hooks"), { recursive: true });
    for (const h of ["destructive-guard.mjs", "statusline-espejo.mjs", "latido.mjs", "nota-compactar.mjs"]) writeFileSync(path.join(app, "hooks", h), "// falso\n");
    mkdirSync(path.join(app, "skills", "trama-orquestar"), { recursive: true });
    writeFileSync(path.join(app, "skills", "trama-orquestar", "SKILL.md"), readFileSync(path.join(MOTOR, "skills", "trama-orquestar", "SKILL.md")));
    mkdirSync(path.join(app, "plantillas", "home"), { recursive: true });
    for (const p of ["CLAUDE.md", "GEMINI.md"]) writeFileSync(path.join(app, "plantillas", "home", p), `plantilla ${p}\n`);
    const home = path.join(dir, "home");
    mkdirSync(home);
    f({ app, home, node: "C:\\Users\\Ana López\\AppData\\Local\\trama\\node\\node.exe", registro: path.join(dir, "trama", "config", "proyectos", "registry.json"), plataforma: "win32" }, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("instala de cero: hooks .mjs con el node.exe propio, la skill copiada con marca, las plantillas y el registry vacío", () => {
  conSandbox((o) => {
    const r = instalar(o);
    assert.equal(r.mal, false, JSON.stringify(r.lineas));
    const s = JSON.parse(readFileSync(path.join(o.home, ".claude", "settings.json"), "utf8"));
    const guard = s.hooks.PreToolUse[0].hooks[0].command as string;
    assert.match(guard, /^"C:\/Users\/Ana López\/AppData\/Local\/trama\/node\/node\.exe" ".*destructive-guard\.mjs"$/);
    assert.equal(s.hooks.PreToolUse[0].matcher, "Bash|PowerShell");
    assert.ok(!/bash/.test(JSON.stringify(s)), "nada de bash en el settings de Windows");
    assert.match(s.statusLine.command, /statusline-espejo\.mjs/);
    assert.ok(existsSync(path.join(o.home, ".claude", "skills", "trama-orquestar", "SKILL.md")));
    assert.ok(existsSync(path.join(o.home, ".claude", "skills", "trama-orquestar", MARCA_SKILL)));
    assert.equal(readFileSync(path.join(o.home, "CLAUDE.md"), "utf8"), "plantilla CLAUDE.md\n");
    assert.deepEqual(JSON.parse(readFileSync(o.registro, "utf8")), { projects: [] });
  });
});

test("CTX-50: en Windows registra también hook-compactando, el resumen de modelos (startup|compact) y la nota antes de compactar, todo con node.exe y sin bash", () => {
  conSandbox((o, dir) => {
    const modelos = path.join(dir, "modelos.json");
    writeFileSync(modelos, JSON.stringify({ lider: { modelo: "claude-sonnet-4-6" }, nota_compactar_pct: 80 }));
    const r = instalar({ ...o, modelos });
    assert.equal(r.mal, false, JSON.stringify(r.lineas));
    const s = JSON.parse(readFileSync(path.join(o.home, ".claude", "settings.json"), "utf8"));
    const cmd = (evento: string, archivo: string) => {
      const g = (s.hooks[evento] as { matcher?: string; hooks: { command: string; timeout?: number }[] }[]).find((x) => x.hooks.some((h) => h.command.includes(archivo)));
      assert.ok(g, `${evento}: falta ${archivo}`);
      return { ...g!.hooks.find((h) => h.command.includes(archivo))!, matcher: g!.matcher };
    };
    const NODE = '"C:/Users/Ana López/AppData/Local/trama/node/node.exe"';
    for (const e of ["PreCompact", "PostCompact"]) assert.match(cmd(e, "hook-compactando.mjs").command, new RegExp(`^${NODE.replace(/[/.]/g, "\\$&")} ".*hook-compactando\\.mjs"$`));
    const res = cmd("SessionStart", "resumen-modelos.mjs");
    assert.equal(res.matcher, "startup|compact");
    assert.match(res.command, /^"C:\/Users\/Ana López\/.*resumen-modelos\.mjs"$|resumen-modelos\.mjs"$/);
    assert.equal(cmd("SessionStart", "nota-compactar.mjs").matcher, "compact");
    for (const e of ["PostToolUse", "UserPromptSubmit", "PreCompact", "SessionStart"]) assert.match(cmd(e, "nota-compactar.mjs").command, /nota-compactar\.mjs" --umbral \d+ --umbral-tarea \d+ --base 200000$/);
    assert.ok(!/bash|\.sh"|'/.test(JSON.stringify(s.hooks)), "nada de bash ni de comillas simples");
    // nota_compactar apagado: sin la nota, pero con el resto
    const apagado = path.join(dir, "apagado.json");
    writeFileSync(apagado, JSON.stringify({ nota_compactar: false }));
    rmSync(path.join(o.home, ".claude", "settings.json"));
    instalar({ ...o, modelos: apagado });
    const s2 = JSON.parse(readFileSync(path.join(o.home, ".claude", "settings.json"), "utf8"));
    assert.ok(!JSON.stringify(s2).includes("nota-compactar"));
    assert.ok(JSON.stringify(s2).includes("hook-compactando.mjs") && JSON.stringify(s2).includes("resumen-modelos.mjs"));
    // y sin nota-compactar.mjs en el payload no se registra (no apunta a un archivo que no está)
    rmSync(path.join(o.home, ".claude", "settings.json"));
    rmSync(path.join(o.app, "hooks", "nota-compactar.mjs"));
    instalar({ ...o, modelos });
    assert.ok(!readFileSync(path.join(o.home, ".claude", "settings.json"), "utf8").includes("nota-compactar"));
  });
});

test("una segunda vez no cambia nada: hooks ya enganchados, plantillas y registry que ya están", () => {
  conSandbox((o) => {
    instalar(o);
    writeFileSync(o.registro, '{"projects":[{"name":"x","path":"C:/x"}]}\n');
    writeFileSync(path.join(o.home, "CLAUDE.md"), "mío\n");
    const r = instalar(o);
    assert.equal(r.mal, false);
    assert.ok(r.lineas.some((l) => l.tipo === "ok" && /ya engancha los hooks/.test(l.texto)));
    assert.ok(r.lineas.some((l) => l.tipo === "hecho" && /actualizada la skill/.test(l.texto)));
    assert.equal(readFileSync(path.join(o.home, "CLAUDE.md"), "utf8"), "mío\n");
    assert.match(readFileSync(o.registro, "utf8"), /"x"/);
  });
});

test("no pisa una skill que no puso Trama ni un settings.json roto (avisa y sale con 1)", () => {
  conSandbox((o) => {
    const ajena = path.join(o.home, ".claude", "skills", "trama-orquestar");
    mkdirSync(ajena, { recursive: true });
    writeFileSync(path.join(ajena, "SKILL.md"), "la mía\n");
    writeFileSync(path.join(o.home, ".claude", "settings.json"), "{roto");
    let salida = "";
    const rc = main(["--json"], {}, (s) => (salida += s), o);
    assert.equal(rc, 1);
    const j = JSON.parse(salida);
    assert.ok(j.lineas.some((l: { tipo: string; texto: string }) => l.tipo === "aviso" && /no la puso Trama/.test(l.texto)));
    assert.ok(j.lineas.some((l: { tipo: string; texto: string }) => l.tipo === "aviso" && /no es un JSON válido/.test(l.texto)));
    assert.equal(readFileSync(path.join(ajena, "SKILL.md"), "utf8"), "la mía\n");
    assert.equal(readFileSync(path.join(o.home, ".claude", "settings.json"), "utf8"), "{roto");
  });
});

test("fuera de Windows no hace nada sin --forzar (no registra .mjs encima de los hooks de Linux)", () => {
  conSandbox((o) => {
    let salida = "";
    assert.equal(main([], {}, (s) => (salida += s), { ...o, plataforma: "linux" }), 2);
    assert.match(salida, /sólo para Trama nativo de Windows/);
    assert.ok(!existsSync(path.join(o.home, ".claude", "settings.json")));
    assert.equal(main(["--forzar"], {}, () => {}, { ...o, plataforma: "linux" }), 0);
  });
});

test("en texto, las líneas son las del instalador de Linux", () => {
  conSandbox((o) => {
    let salida = "";
    assert.equal(main([], {}, (s) => (salida += s), o), 0);
    assert.match(salida, /^hecho  .*settings\.json: destructive-guard, statusline-espejo, cierre por cupo, hook-compactando, resumen de modelos y nota antes de compactar registrados$/m);
    assert.match(salida, /^hecho  .*registry\.json \(vacío: agregá tus proyectos\)$/m);
  });
});
