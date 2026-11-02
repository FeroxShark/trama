// Un líder de la app con su proceso vivo cuando trama se corta sin cerrarlo (se reinicia la PC, se cae la app): al
// arrancar queda dormido (nunca Murió: cerrar o reiniciar la app no mata a un líder) y vuelve a tener proceso con su sesión. Lo que `cerrarTodos` cerró bien queda dormido,
// no cortado (electron/lider.ts: `corriendo`, `marcarCortados`). Armado como tests/lider-reinicio.test.ts: la trama nueva
// es otra copia del módulo leyendo el mismo lideres.json.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-cortado-")));
const arranques = path.join(tmp, "arranques.jsonl");
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = path.join(tmp, "pa");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "registry.json");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.TRAMA_FALSO_LOG = arranques;
process.env.TRAMA_FALSO_MS = "20";
mkdirSync(process.env.HILOS_SESIONES);
writeFileSync(process.env.PROYECTOS_REGISTRY, "{}");

const { leerStatusline } = await import("../electron/statusline.ts");
const antes = await import("../electron/lider.ts");
let despues: typeof antes | undefined;
after(async () => {
  await antes.cerrarTodos(true);
  await despues?.cerrarTodos(true);
});

type Ev = { sid: string; tipo: string };
const eventos: Ev[] = [];
antes.alEvento((sid, e) => eventos.push({ sid, tipo: e.tipo }));

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
const M = { modelo: "claude-opus-5-5", effort: "high" };
type Fila = { sid: string; dormido?: number; corriendo?: number; murio?: number; motivo?: string };
const enDisco = (): Fila[] => JSON.parse(readFileSync(path.join(tmp, "estado", "lideres.json"), "utf8")).lideres;
const fila = (sid: string) => enDisco().find((g) => g.sid === sid)!;

test("cerrar la trama bien: lo que tenía proceso queda dormido y ya no figura como corriendo", { timeout: 30_000 }, async () => {
  const a = await antes.nuevo({ ...M, texto: "hola" });
  const b = await antes.nuevo({ ...M, texto: "hola" });
  await hasta(() => [a, b].every((sid) => eventos.some((x) => x.sid === sid && x.tipo === "fin")));
  await hasta(() => [a, b].every((sid) => fila(sid)?.corriendo !== undefined), 5_000);
  assert.deepEqual(await antes.cerrarTodos(false), []);
  // Lo de `fin` se escribe al disco sin esperarlo: se mira cuando ya está.
  await hasta(() => [a, b].every((sid) => fila(sid)?.corriendo === undefined), 5_000);
  for (const sid of [a, b]) {
    assert.ok(fila(sid).dormido, "lo que cerró la trama queda dormido");
    assert.equal(fila(sid).corriendo, undefined, "y su proceso ya terminó");
    assert.equal(fila(sid).murio, undefined);
  }
});

test("un proceso que se corta con la trama andando: al arrancar queda dormido (no Murió) y vuelve con su sesión; el dormido no se toca", { timeout: 30_000 }, async () => {
  const [sid, dormido] = (await antes.lideresApp()).filter((g) => g.dormido).map((g) => g.sid);
  // Como lo deja una caída: el proceso no llegó a cerrarse (sin `fin`), así que `corriendo` quedó en disco y sin `dormido`.
  const ls = JSON.parse(readFileSync(path.join(tmp, "estado", "lideres.json"), "utf8"));
  for (const g of ls.lideres) if (g.sid === sid) {
    delete g.dormido;
    g.corriendo = Math.floor(Date.now() / 1000);
  }
  writeFileSync(path.join(tmp, "estado", "lideres.json"), JSON.stringify(ls));

  // La trama nueva: otra copia del módulo, sin procesos.
  despues = (await import("../electron/lider.ts?arranque=2")) as typeof antes;
  assert.deepEqual(await despues.marcarCortados(), [sid], "sólo el que se cortó; el dormido sigue como estaba");
  assert.equal(fila(sid).murio, undefined, "reiniciar la app (o que Windows la mate) no vuelve muerto a un líder");
  assert.equal(fila(sid).motivo, undefined);
  assert.ok((fila(sid).dormido ?? 0) > 0, "queda dormido: se retoma solo");
  assert.equal(fila(sid).corriendo, undefined);
  assert.ok(fila(dormido).dormido, "el dormido no se toca");
  assert.equal(despues.procDe(sid), null);
  const l = (await leerStatusline()).lideres.lideres.find((x) => x.id === sid)!;
  assert.equal(l.caido, undefined, "la barra no le pone señal de muerte");

  // Vuelve a tener proceso con su sesión, sin que nadie escriba, y sin ser Murió.
  assert.deepEqual([...(await despues.reanudarDormidos(0))].sort(), [sid, dormido].sort());
  await hasta(() => despues!.procDe(sid) !== null);
  assert.equal(fila(sid).murio, undefined);
  await hasta(() => existsSync(arranques) && readFileSync(arranques, "utf8").includes(sid));
});
