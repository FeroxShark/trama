// Un líder de DeepSeek Harness de punta a punta por electron/lider.ts (→ dsh-puente.ts → `dsh --profile acp` → scripts/openai-falso.mjs): la clase del
// modelo, la URL del Ollama de modelos.json, el prefacio (dsh no lee CLAUDE.md), el transcript aparte, y que no se cruce con Claude ni
// Gemini en la misma sesión. Sin `dsh` (TRAMA_DSH_BIN…) se saltea. HOME, HILOS_STATE y DSH_HOME en un tmp.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DSH, SIN_DSH, arrancarFalso, entornoTmp, hasta, usuarios } from "./dsh-ayuda.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { tmp, home, dshHome } = entornoTmp("lider-dsh");
writeFileSync(path.join(home, "CLAUDE.md"), "# Reglas de prueba\n\n## Jefe (sesión en `~`)\n- Delegás con `pa <proyecto> \"<tarea>\"`. MARCA-CLAUDE-MD\n");
process.env.HOME = home;
process.env.DSH_HOME = dshHome;
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_MODELOS = path.join(tmp, "modelos.json");
process.env.TRAMA_CLAVES = path.join(tmp, "config", "claves.env");
process.env.TRAMA_DUENO = "Ana";
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
if (DSH) process.env.HILOS_DSH = DSH;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.OPENCODE_API_KEY;
process.env.HILOS_PA = path.join(tmp, "fuera-del-path", "pa");
process.env.PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(":");

const lider = await import("../electron/lider.ts");
const { guardarClave } = await import("../electron/claves.ts");
const { claseDeModelo, familiaDeModelo } = await import("../electron/modelos-config.ts");
type Ev = { sid: string; e: any };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  await lider.cerrarTodos(true);
  rmSync(tmp, { recursive: true, force: true });
});
const de = (sid: string, tipo: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === tipo).map((x) => x.e);

test("la clase de un modelo dsh y su familia: no se cruza con Claude ni Gemini, pero Ollama sigue siendo de Claude", () => {
  assert.equal(claseDeModelo("dsh:opencode/big-pickle"), "dsh");
  assert.equal(claseDeModelo("dsh:ollama/qwen2.5-coder:7b"), "dsh");
  assert.equal(claseDeModelo("ollama:qwen3-coder:30b"), "ollama");
  assert.equal(claseDeModelo("gemini-4-argon"), "gemini");
  assert.equal(claseDeModelo("claude-opus-5-5"), "claude");
  assert.equal(familiaDeModelo("ollama:qwen3-coder:30b"), "claude");
  assert.equal(familiaDeModelo("claude-opus-5-5"), "claude");
  assert.equal(familiaDeModelo("agy:claude-opus-5-5-high"), "gemini");
  assert.equal(familiaDeModelo("dsh:deepseek/deepseek-v4-flash"), "dsh");
  assert.equal(lider.transcriptDsh("abc"), path.join(process.env.HILOS_STATE!, "dsh", "abc.jsonl"));
});

test("un líder de dsh con Ollama contesta: la URL del local de modelos.json, el prefacio con sus CLAUDE.md y su transcript aparte", { skip: SIN_DSH, timeout: 120_000 }, async () => {
  const falso = await arrancarFalso(tmp);
  after(() => falso.cerrar());
  // El local de modelos.json que sirve `fake-model`: su URL (sin /v1) es la que se le pasa a dsh.
  const url = falso.baseURL.replace(/\/v1\/?$/, "");
  mkdirSync(path.dirname(process.env.TRAMA_MODELOS!), { recursive: true });
  writeFileSync(process.env.TRAMA_MODELOS!, JSON.stringify({ version: 1, locales: [{ id: "ollama:fake-model", nombre: "Fake", url, modelo: "fake-model" }] }));
  const sid = await lider.nuevo({ modelo: "dsh:ollama/fake-model", effort: "high", texto: "hola dsh" });
  await hasta(() => de(sid, "fin").length === 1, 90_000, `el turno no terminó: ${JSON.stringify(de(sid, "fin"))}`);
  assert.equal(de(sid, "fin")[0].error, null);
  assert.ok(de(sid, "mensaje").length > 0, "salió al menos un mensaje del modelo");
  const todo = usuarios(falso.pedidos().at(-1)!).join("\n");
  assert.match(todo, /líder de Trama/);
  assert.match(todo, /DeepSeek Harness/, "el prefacio dice que corre dentro de dsh, no como Gemini");
  assert.match(todo, /MARCA-CLAUDE-MD/, "dsh no lee CLAUDE.md: el prefacio se lo da");
  assert.match(todo, /hola dsh/);
  // Su transcript es aparte de los de Claude y lo encuentra el mismo lector.
  const t = await lider.transcriptDe(sid);
  assert.equal(t, path.join(process.env.HILOS_STATE!, "dsh", `${sid}.jsonl`));
  assert.ok(readFileSync(t!, "utf8").includes("hola dsh"));
  // (Seguir con un modelo de otro motor ya no se rechaza: lo prueba tests/lider-cambio-motor.test.ts.) Lo que sí: un `dsh:` mal armado no se lanza.
  await assert.rejects(lider.mandar({ sid, texto: "x", modelo: "dsh:nube/algo", effort: "high" }), /main\.dshModelo|nube/);
});

test("DeepSeek sin su key: el turno termina con el motivo (falta DEEPSEEK_API_KEY), sin colgarse", { skip: SIN_DSH, timeout: 120_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "dsh:deepseek/deepseek-v4-flash", effort: "high", texto: "hola" });
  await hasta(() => de(sid, "fin").length === 1, 90_000, `no terminó: ${JSON.stringify(de(sid, "fin"))}`);
  assert.match(String(de(sid, "fin")[0].error ?? ""), /DEEPSEEK_API_KEY/);
});

test("una key guardada DESPUÉS de lanzar el líder vale en el próximo turno (y la conversación sigue); si se borra, vuelve a la pública", { skip: SIN_DSH, timeout: 180_000 }, async () => {
  const falso = await arrancarFalso(tmp, { OPENAI_FALSO_CLAVE: "oc-clave-nueva-9999" });
  after(() => falso.cerrar());
  const antes = process.env.TRAMA_DSH_URL;
  process.env.TRAMA_DSH_URL = falso.baseURL; // lo hereda el puente: opencode habla con el falso
  after(() => (antes === undefined ? delete process.env.TRAMA_DSH_URL : (process.env.TRAMA_DSH_URL = antes)));
  const modelo = "dsh:opencode/deepseek-v4.1-flash-free";
  // Sin key propia: el falso la rechaza (cupo de la clave pública agotado) y el error es el accionable de OpenCode, no el del límite de Claude.
  const sid = await lider.nuevo({ modelo, effort: "high", texto: "uno" });
  await hasta(() => de(sid, "fin").length === 1, 90_000, `no terminó: ${JSON.stringify(de(sid, "fin"))}`);
  assert.match(String(de(sid, "fin")[0].error), /se terminó el uso gratis de la clave pública/);
  // La persona guarda su key en Ajustes y le escribe al MISMO líder.
  await guardarClave("OPENCODE_API_KEY", "oc-clave-nueva-9999");
  await lider.mandar({ sid, texto: "dos", modelo, effort: "high" });
  await hasta(() => de(sid, "fin").length === 2, 90_000, `no terminó el 2.º: ${JSON.stringify(de(sid, "fin"))}`);
  assert.equal(de(sid, "fin")[1].error, null, "usó la key recién guardada");
  assert.ok(falso.pedidos().some((r) => r.headers.authorization === "Bearer oc-clave-nueva-9999"));
  // Un tercer turno con la sesión retomada: sigue la conversación (el primer mensaje sigue en el contexto del modelo).
  await lider.mandar({ sid, texto: "tres", modelo, effort: "high" });
  await hasta(() => de(sid, "fin").length === 3, 90_000);
  assert.equal(de(sid, "fin")[2].error, null);
  assert.match(usuarios(falso.pedidos().at(-1)!).join("\n"), /uno/);
  // Y borrarla también vale: vuelve a la pública y el falso la rechaza.
  await guardarClave("OPENCODE_API_KEY", null);
  await lider.mandar({ sid, texto: "cuatro", modelo, effort: "high" });
  await hasta(() => de(sid, "fin").length === 4, 90_000);
  assert.match(String(de(sid, "fin")[3].error), /clave pública/);
});
