// La memoria y el CLAUDE.md del dueño en los workers que no son Claude: el interruptor por motor (`memoria_compartida` de
// modelos.json), el bloque de memoria (200 líneas, CRLF, líneas con pinta de secreto) y qué recibe cada motor.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { memoriaDe } from "../electron/contexto-local.ts";
import { Modelos } from "../electron/cli/pa/modelos.ts";
import { armarLlamada, type DatosLlamada, type Llamada } from "../electron/cli/pa/motores/llamada.ts";
import { motorMemoria } from "../electron/cli/pa/motores/modelos.ts";
import { bloqueMemoria, memoriaDueno, MEMORIA_MAX_LINEAS } from "../electron/cli/pa/motores/prompt.ts";

const io = { out: () => {}, err: () => {} };

function carpeta(t: TestContext): string {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pa-memoria-")));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  return raiz;
}
const textoPrompt = (l: Llamada): string => (l.json === "agy" ? JSON.parse(l.stdin!).message.content[0].text : l.stdin ?? l.tareaArchivo!.texto);

/** Una config del dueño con su CLAUDE.md, el MEMORY.md del proyecto `ruta` y el worktree aparte. */
function escenario(t: TestContext, memoria: string | null = "- [Gusto](gusto.md) — oscuro y liso\n", plat: "linux" | "win32" = "linux") {
  const raiz = carpeta(t);
  const claude = path.join(raiz, "claude");
  const ruta = path.join(raiz, "proyecto");
  const rutaTrabajo = path.join(raiz, "worktree");
  mkdirSync(claude);
  mkdirSync(ruta);
  mkdirSync(rutaTrabajo);
  writeFileSync(path.join(claude, "CLAUDE.md"), "REGLA-DEL-DUENO\n");
  const env = { CLAUDE_CONFIG_DIR: claude };
  const mem = memoriaDueno(env, raiz, ruta);
  if (memoria !== null) {
    mkdirSync(path.dirname(mem), { recursive: true });
    writeFileSync(mem, memoria);
  }
  const datos: DatosLlamada = {
    motor: "dsh", modelo: "dsh:deepseek/v4", contrato: "C", prompt: "Hacé el cambio.", rutaTrabajo, ruta, rama: "pa/demo/1", dir: raiz, ts: "1",
    hb: path.join(raiz, "hb"), mapaProy: path.join(raiz, "mapa"), gitComun: () => "", env, io, plat,
  };
  return { raiz, claude, mem, datos };
}

test("el interruptor por motor: agy→gemini, codex→codex, dsh ollama→local, dsh remoto→dsh, opencode→opencode", () => {
  assert.equal(motorMemoria("agy", "gemini-4-neon-high"), "gemini");
  assert.equal(motorMemoria("agy", "agy:claude-opus-5-5-high"), "gemini");
  assert.equal(motorMemoria("codex", "codex:gpt-6-sol-high"), "codex");
  assert.equal(motorMemoria("dsh", "dsh:ollama/qwen3"), "local");
  assert.equal(motorMemoria("dsh", "dsh:deepseek/v4"), "dsh");
  assert.equal(motorMemoria("dsh", "dsh:opencode/big-pickle"), "dsh");
  assert.equal(motorMemoria("dsh", "opencode:opencode/big-pickle"), "opencode");
});

test("Modelos.memoriaCompartida: sin archivo o sin la clave vale true; sólo `false` apaga ese motor", (t) => {
  const raiz = carpeta(t);
  const archivo = path.join(raiz, "modelos.json");
  const m = () => new Modelos({ TRAMA_MODELOS: archivo }, io, raiz, "linux");
  assert.equal(m().memoriaCompartida("gemini"), true, "sin archivo");
  writeFileSync(archivo, JSON.stringify({ version: 1 }));
  for (const k of ["gemini", "codex", "dsh", "opencode", "local"]) assert.equal(m().memoriaCompartida(k), true, `${k} sin la clave`);
  writeFileSync(archivo, JSON.stringify({ version: 1, memoria_compartida: { gemini: false, dsh: true, local: false } }));
  assert.equal(m().memoriaCompartida("gemini"), false);
  assert.equal(m().memoriaCompartida("local"), false);
  assert.equal(m().memoriaCompartida("dsh"), true);
  assert.equal(m().memoriaCompartida("codex"), true, "un motor sin la clave vale true");
});

test("la ruta de la memoria es la misma que usan los líderes", (t) => {
  const raiz = carpeta(t);
  for (const env of [{}, { CLAUDE_CONFIG_DIR: path.join(raiz, "c") }]) {
    for (const cwd of [path.join(raiz, "proyecto"), path.join(raiz, "con espacio", "ñandú")]) assert.equal(memoriaDueno(env, raiz, cwd), memoriaDe(raiz, cwd, env));
  }
});

test("bloqueMemoria: sin archivo o vacío no da nada; con CRLF no deja \\r; recorta a 200 líneas", (t) => {
  const raiz = carpeta(t);
  const f = path.join(raiz, "MEMORY.md");
  assert.equal(bloqueMemoria(f), "", "sin archivo");
  writeFileSync(f, " \n\n");
  assert.equal(bloqueMemoria(f), "", "vacío");
  writeFileSync(f, "- uno\r\n- dos\r\n");
  const b = bloqueMemoria(f);
  assert.doesNotMatch(b, /\r/);
  assert.match(b, /MEMORIA DEL DUEÑO/);
  assert.ok(b.includes(f), "dice dónde están los archivos");
  assert.match(b, /- uno\n- dos$/);
  writeFileSync(f, Array.from({ length: 250 }, (_, i) => `- entrada ${i + 1}`).join("\n") + "\n");
  const g = bloqueMemoria(f);
  assert.match(g, new RegExp(`- entrada ${MEMORIA_MAX_LINEAS}\\n`));
  assert.doesNotMatch(g, /- entrada 201\b/);
  assert.match(g, /truncado: el índice tiene 250 líneas/);
});

test("bloqueMemoria saca la línea con pinta de secreto y deja el resto", (t) => {
  const raiz = carpeta(t);
  const f = path.join(raiz, "MEMORY.md");
  writeFileSync(f, ["- [A](a.md) — normal", "- clave sk-abcdef123456 para el servicio", "- escribile a alguien@ejemplo.com", "- [B](b.md) — otra"].join("\n"));
  const b = bloqueMemoria(f);
  assert.match(b, /\[A\].*\n- \[B\]/);
  assert.doesNotMatch(b, /sk-abcdef|alguien@ejemplo/);
  writeFileSync(f, "- sk-abcdef123456\n");
  assert.equal(bloqueMemoria(f), "", "si no queda nada, no hay bloque");
});

for (const plat of ["linux", "win32"] as const) {
  test(`dsh y opencode remotos reciben el CLAUDE.md y la memoria con el interruptor prendido (${plat})`, (t) => {
    const { datos } = escenario(t, "- [Gusto](gusto.md) — oscuro y liso\n", plat);
    for (const [motor, modelo] of [["dsh", "dsh:deepseek/v4"], ["dsh", "dsh:opencode/big-pickle"], ["dsh", "opencode:opencode/big-pickle"], ["dsh", "dsh:ollama/qwen3"]] as const) {
      const p = textoPrompt(armarLlamada({ ...datos, motor, modelo }));
      assert.match(p, /REGLA-DEL-DUENO/, modelo);
      assert.match(p, /MEMORIA DEL DUEÑO[^\n]*\n- \[Gusto\]\(gusto\.md\)/, modelo);
      assert.ok(p.indexOf("REGLA-DEL-DUENO") < p.indexOf("MEMORIA DEL DUEÑO") && p.indexOf("MEMORIA DEL DUEÑO") < p.indexOf("TAREA:"), "orden: CLAUDE.md, memoria, tarea");
    }
  });
}

test("con el interruptor apagado no va ni el CLAUDE.md del dueño ni la memoria, en ningún motor", (t) => {
  const { datos } = escenario(t);
  for (const [motor, modelo] of [["dsh", "dsh:deepseek/v4"], ["dsh", "opencode:opencode/big-pickle"], ["dsh", "dsh:ollama/qwen3"], ["agy", "gemini-4-neon-high"], ["codex", "codex:gpt-6-sol-high"]] as const) {
    const p = textoPrompt(armarLlamada({ ...datos, motor, modelo, compartir: false }));
    assert.doesNotMatch(p, /REGLA-DEL-DUENO|MEMORIA DEL DUEÑO|Gusto/, `${motor} ${modelo}`);
    assert.match(p, /TAREA:\nHacé el cambio\./);
  }
});

test("agy y codex siguen recibiendo el CLAUDE.md y ahora la memoria; sin MEMORY.md no hay bloque", (t) => {
  const { datos } = escenario(t);
  for (const [motor, modelo] of [["agy", "gemini-4-neon-high"], ["codex", "codex:gpt-6-sol-high"]] as const) {
    const p = textoPrompt(armarLlamada({ ...datos, motor, modelo }));
    assert.match(p, /REGLA-DEL-DUENO/);
    assert.match(p, /MEMORIA DEL DUEÑO/);
  }
  const sin = escenario(t, null);
  const p = textoPrompt(armarLlamada({ ...sin.datos, modelo: "dsh:deepseek/v4" }));
  assert.match(p, /REGLA-DEL-DUENO/);
  assert.doesNotMatch(p, /MEMORIA DEL DUEÑO/);
});

test("la memoria es la del proyecto principal, no la del worktree", (t) => {
  const { datos, raiz, claude } = escenario(t, "- del principal\n");
  const otra = memoriaDueno({ CLAUDE_CONFIG_DIR: claude }, raiz, datos.rutaTrabajo);
  mkdirSync(path.dirname(otra), { recursive: true });
  writeFileSync(otra, "- del worktree\n");
  const p = textoPrompt(armarLlamada(datos));
  assert.match(p, /- del principal/);
  assert.doesNotMatch(p, /- del worktree/);
});

test("lo de la memoria y el CLAUDE.md del dueño nunca hace rebotar la corrida (el candado mira el pedido)", (t) => {
  const { datos, mem, claude } = escenario(t, "- clave sk-abcdef123456\n- [B](b.md)\n");
  writeFileSync(path.join(claude, "CLAUDE.md"), "REGLA-DEL-DUENO\nescribile a alguien@ejemplo.com\n");
  const p = textoPrompt(armarLlamada(datos)); // no tira
  assert.doesNotMatch(p, /sk-abcdef/);
  assert.match(p, /alguien@ejemplo\.com/, "el CLAUDE.md del dueño va entero: sólo se filtra la memoria");
  assert.match(p, /\[B\]/);
  assert.ok(mem);
});
