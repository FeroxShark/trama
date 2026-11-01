// Un líder de opencode cuando el servidor le contesta «se acabó el uso gratis» y opencode (1.19) NO cierra el turno: queda colgado.
// El puente (dsh-puente.ts) tiene que cortar el turno y mostrar el aviso en palabras claras: por el error que cuenta opencode (stderr o
// como primer mensaje) o, si no dice nada, por el tope sin eventos. Usa un `opencode acp` falso (scripts/opencode-acp-falso.mjs).
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entornoTmp, hasta } from "./dsh-ayuda.ts";
import { MODELO_FALSO } from "./opencode-ayuda.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { tmp, home } = entornoTmp("lider-opencode-colgado");
Object.assign(process.env, {
  HOME: home,
  HILOS_STATE: path.join(tmp, "estado"),
  REPARTO_STATE: path.join(tmp, "reparto"),
  HILOS_SESIONES: path.join(tmp, "sesiones"),
  CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
  TRAMA_MODELOS: path.join(tmp, "modelos.json"),
  TRAMA_CLAVES: path.join(tmp, "config", "claves.env"),
  TRAMA_DUENO: "Ana",
  HILOS_CLAUDE: path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs"),
  HILOS_OPENCODE: path.join(import.meta.dirname, "..", "scripts", "opencode-acp-falso.mjs"),
  HILOS_PA: path.join(tmp, "fuera-del-path", "pa"),
  TRAMA_OPENCODE_SIN_EVENTOS_MS: "1500",
  PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
});

const lider = await import("../electron/lider.ts");
type Ev = { sid: string; e: any };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  await lider.cerrarTodos(true);
  rmSync(tmp, { recursive: true, force: true });
});
const fines = (sid: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === "fin").map((x) => x.e);
const agotado = () => {
  const f = path.join(process.env.REPARTO_STATE!, "agotado.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
};

for (const modo of ["stderr", "mensaje"]) {
  test(`opencode cuenta el límite gratis (${modo}) y no cierra el turno: el turno termina con el aviso de sin cupo y queda agotado`, { timeout: 60_000 }, async () => {
    process.env.FALSO_ACP_MODO = modo;
    const sid = await lider.nuevo({ modelo: MODELO_FALSO, effort: "high", texto: "hola" });
    await hasta(() => fines(sid).length === 1, 40_000, `el turno quedó colgado: ${JSON.stringify(fines(sid))}`);
    const err = String(fines(sid)[0].error);
    assert.match(err, /i18n:main\.opencodeSinCupo/, err);
    assert.doesNotMatch(err, /AI_APICallError|Free usage limit/);
    assert.ok(agotado()["opencode-free"]?.hasta, "el uso gratis de OpenCode quedó marcado agotado");
  });
}

test("opencode se cuelga sin decir nada: el tope sin eventos corta el turno y lo dice", { timeout: 60_000 }, async () => {
  rmSync(path.join(process.env.REPARTO_STATE!, "agotado.json"), { force: true });
  process.env.FALSO_ACP_MODO = "mudo";
  const sid = await lider.nuevo({ modelo: MODELO_FALSO, effort: "high", texto: "hola" });
  await hasta(() => fines(sid).length === 1, 40_000, `el turno quedó colgado: ${JSON.stringify(fines(sid))}`);
  assert.match(String(fines(sid)[0].error), /i18n:main\.opencodeSinRespuesta/);
  assert.equal(agotado()["opencode-free"], undefined, "sin saber la causa no se marca agotado");
});
