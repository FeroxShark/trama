// Un líder de opencode de punta a punta por electron/lider.ts (→ dsh-puente.ts con un modelo `opencode:` → `opencode acp` → scripts/openai-falso.mjs
// como proveedor `falso`): la clase del modelo, el prefacio (opencode no lee el CLAUDE.md de Trama), el transcript aparte en $HILOS_STATE/opencode,
// y que no se cruce con Claude, Gemini ni dsh en la misma sesión. Sin `opencode` (TRAMA_OPENCODE_BIN…) se saltea. HOME, XDG y HILOS_STATE en un tmp.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { arrancarFalso, entornoTmp, hasta, usuarios } from "./dsh-ayuda.ts";
import { MODELO_FALSO, OPENCODE, SIN_OPENCODE, entornoOpencodeTmp } from "./opencode-ayuda.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { tmp, home } = entornoTmp("lider-opencode");
writeFileSync(path.join(home, "CLAUDE.md"), "# Reglas de prueba\n\n## Jefe (sesión en `~`)\n- Delegás con `pa <proyecto> \"<tarea>\"`. MARCA-CLAUDE-MD\n");
const falso0 = await arrancarFalso(tmp);
Object.assign(process.env, entornoOpencodeTmp(home, falso0.baseURL));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.REPARTO_STATE = path.join(tmp, "reparto");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_MODELOS = path.join(tmp, "modelos.json");
process.env.TRAMA_CLAVES = path.join(tmp, "config", "claves.env");
process.env.TRAMA_DUENO = "Ana";
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
if (OPENCODE) process.env.HILOS_OPENCODE = OPENCODE;
process.env.HILOS_PA = path.join(tmp, "fuera-del-path", "pa");
process.env.PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(":");

const lider = await import("../electron/lider.ts");
const { claseDeModelo, familiaDeModelo } = await import("../electron/modelos-config.ts");
type Ev = { sid: string; e: any };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  falso0.cerrar();
  await lider.cerrarTodos(true);
  rmSync(tmp, { recursive: true, force: true });
});
const de = (sid: string, tipo: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === tipo).map((x) => x.e);

test("la clase de un modelo opencode y su familia: ni Claude, ni Gemini, ni dsh", () => {
  assert.equal(claseDeModelo("opencode:opencode/deepseek-v4.1-flash-free"), "opencode");
  assert.equal(claseDeModelo("dsh:opencode/big-pickle"), "dsh");
  assert.equal(familiaDeModelo("opencode:opencode/big-pickle"), "opencode");
  assert.equal(familiaDeModelo("dsh:deepseek/deepseek-v4-flash"), "dsh");
  assert.equal(familiaDeModelo("claude-opus-5-5"), "claude");
  assert.equal(lider.transcriptOpencode("abc"), path.join(process.env.HILOS_STATE!, "opencode", "abc.jsonl"));
});

test("un líder de opencode contesta: el prefacio con sus CLAUDE.md, su transcript aparte y sin cruzarse con otro motor", { skip: SIN_OPENCODE, timeout: 150_000 }, async () => {
  const sid = await lider.nuevo({ modelo: MODELO_FALSO, effort: "high", texto: "hola opencode" });
  await hasta(() => de(sid, "fin").length === 1, 120_000, `el turno no terminó: ${JSON.stringify(de(sid, "fin"))}`);
  assert.equal(de(sid, "fin")[0].error, null);
  assert.ok(de(sid, "mensaje").length > 0, "salió al menos un mensaje del modelo");
  const todo = usuarios(falso0.pedidos().at(-1)!).join("\n");
  assert.match(todo, /líder de Trama/);
  assert.match(todo, /MARCA-CLAUDE-MD/, "opencode no lee el CLAUDE.md de Trama: el prefacio se lo da");
  assert.match(todo, /hola opencode/);
  const t = await lider.transcriptDe(sid);
  assert.equal(t, path.join(process.env.HILOS_STATE!, "opencode", `${sid}.jsonl`));
  assert.ok(readFileSync(t!, "utf8").includes("hola opencode"));
  // (Seguir con un modelo de otro motor ya no se rechaza: lo prueba tests/lider-cambio-motor.test.ts.)
  await assert.rejects(lider.mandar({ sid, texto: "x", modelo: "opencode:suelto", effort: "high" }), /main\.opencodeModelo|suelto/);
  // Un segundo mensaje sigue la conversación (la sesión de opencode se conserva).
  await lider.mandar({ sid, texto: "segundo", modelo: MODELO_FALSO, effort: "high" });
  await hasta(() => de(sid, "fin").length === 2, 120_000);
  assert.equal(de(sid, "fin")[1].error, null);
  assert.match(usuarios(falso0.pedidos().at(-1)!).join("\n"), /hola opencode/);
});

test("se terminó el uso gratis de OpenCode: mensaje claro (no el error crudo) y el grupo opencode-free queda agotado para reparto", { skip: SIN_OPENCODE, timeout: 150_000 }, async () => {
  const sid = await lider.nuevo({ modelo: MODELO_FALSO, effort: "high", texto: "CUOTA por favor" });
  await hasta(() => de(sid, "fin").length === 1, 120_000, `el turno no terminó: ${JSON.stringify(de(sid, "fin"))}`);
  const err = String(de(sid, "fin")[0].error);
  assert.match(err, /i18n:main\.opencodeSinCupo/, err);
  assert.doesNotMatch(err, /session\/prompt|provider\.free-limit/);
  const marca = JSON.parse(readFileSync(path.join(process.env.REPARTO_STATE!, "agotado.json"), "utf8"));
  const vuelve = Date.parse(marca["opencode-free"].hasta);
  assert.ok(vuelve > Date.now() + 50 * 60_000 && vuelve <= Date.now() + 61 * 60_000, "sin hora conocida vence en ~1 h");
});
