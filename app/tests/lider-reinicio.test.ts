// Reiniciar trama no pierde líderes (electron/lider.ts: `cerrarTodos` los deja `dormido`, `reanudarDormidos` los
// levanta; statusline.ts no los esconde). Tres líderes —uno ocupado, uno quieto, uno recién creado sin turnos—
// con el claude falso: el "reinicio" es una segunda copia del módulo (otro `procs`) leyendo el mismo
// `lideres.json`. Lo que no puede levantarse queda Murió con su motivo. Armado como tests/lider-murio.test.ts.
import { test, after } from "node:test";
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

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-reinicio-")));
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

const antes = await import("../electron/lider.ts");
const { leerStatusline } = await import("../electron/statusline.ts");
after(async () => {
  await antes.cerrarTodos(true);
  await despues?.cerrarTodos(true);
});
let despues: typeof antes | undefined;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
const M = { modelo: "claude-opus-5-5", effort: "high" };
const eventosAntes: { sid: string; tipo: string }[] = [];
antes.alEvento((sid, e) => eventosAntes.push({ sid, tipo: e.tipo }));
const lanzamientos = (sid: string) =>
  (existsSync(arranques) ? readFileSync(arranques, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { args: string[] }) : []).filter((x) => x.args.includes(sid));

test("reiniciar con un líder ocupado, uno quieto y uno sin turnos: los tres vuelven, y el que no puede queda Murió con motivo", { timeout: 60_000 }, async () => {
  const quieto = await antes.nuevo({ ...M, texto: "hola" });
  await hasta(() => eventosAntes.some((x) => x.sid === quieto && x.tipo === "fin"));
  const ocupado = await antes.nuevo({ ...M, texto: "despacio" });
  await hasta(() => antes.procDe(ocupado)?.ocupado === true);
  // Sin un solo turno: no contesta nunca, no deja transcript; al reiniciar se lo corta.
  const sinTurnos = await antes.nuevo({ ...M, texto: "colgate" });
  // El que no va a poder levantarse: su carpeta ya no existe.
  const roto = await antes.nuevo({ ...M, texto: "hola" });
  await hasta(() => eventosAntes.some((x) => x.sid === roto && x.tipo === "fin"));

  // Como los transcripts de verdad (el falso no los escribe): los que tuvieron turnos.
  for (const sid of [quieto, ocupado, roto]) {
    const t = antes.transcriptPorDefecto(sid);
    mkdirSync(path.dirname(t), { recursive: true });
    writeFileSync(t, JSON.stringify({ type: "user", cwd: os.homedir(), message: { role: "user", content: "hola" } }) + "\n");
  }
  // Viejos (de hace días): cuando no tienen proceso, la barra los esconde, salvo que sigan `dormido`.
  const viejo = Math.floor(Date.now() / 1000) - 5 * 86400;
  for (const g of await antes.lideresApp()) {
    g.creado = viejo;
    g.ultimo = g.sid === sinTurnos ? 0 : viejo;
  }
  (await antes.lideresApp()).find((g) => g.sid === roto)!.cwd = path.join(tmp, "no-existe");

  // === Reiniciar: salen todos (el ocupado termina su turno; el colgado se corta al tope) ===
  const cortados = await antes.cerrarTodos(false, 4000);
  assert.equal(cortados.length, 1, "sólo el colgado no cerró a tiempo");
  // El cortado sale por la señal: su `exit` llega un instante después.
  await hasta(() => antes.conProceso().length === 0);
  const enDisco = () => JSON.parse(readFileSync(path.join(tmp, "estado", "lideres.json"), "utf8")).lideres as { sid: string; dormido?: number; murio?: number; motivo?: string }[];
  for (const sid of [quieto, ocupado, sinTurnos, roto]) assert.ok(enDisco().find((g) => g.sid === sid)!.dormido, "anotado como dormido, en disco");
  // Hasta que alguien los levante, ninguno desaparece de la barra aunque su último turno sea de hace días.
  const ids = () => leerStatusline().then((s) => s.lideres.lideres.map((l) => l.id));
  for (const sid of [quieto, ocupado, sinTurnos, roto]) assert.ok((await ids()).includes(sid), `${sid} sigue en la barra`);

  // === Arranca la trama nueva ===
  despues = (await import("../electron/lider.ts?arranque=2")) as typeof antes;
  assert.equal(despues.conProceso().length, 0, "otra copia del módulo: nada vivo todavía");
  const vueltos = await despues.reanudarDormidos(0);
  assert.deepEqual([...vueltos].sort(), [quieto, ocupado, sinTurnos, roto].sort());
  for (const sid of [quieto, ocupado, sinTurnos]) assert.ok(despues.procDe(sid)?.pid, `${sid} volvió con proceso`);
  // (El falso anota su arranque un instante después de lanzarlo.)
  await hasta(() => [quieto, ocupado, sinTurnos].every((sid) => lanzamientos(sid).length === 2));
  // Con transcript: --resume. Sin turnos no hay nada que retomar: --session-id (un --resume ahí falla).
  for (const sid of [quieto, ocupado]) assert.ok(lanzamientos(sid).at(-1)!.args.includes("--resume"), "los que tuvieron turnos: --resume");
  assert.ok(lanzamientos(sinTurnos).at(-1)!.args.includes("--session-id"), "el que no tuvo turnos: --session-id");
  assert.equal(lanzamientos(sinTurnos).at(-1)!.args.includes("--resume"), false);
  assert.equal(enDisco().some((g) => g.dormido), false, "ya no quedan dormidos");

  // El que no se pudo levantar: Murió con motivo, en la lista.
  await hasta(() => enDisco().find((g) => g.sid === roto)?.murio !== undefined);
  const g = enDisco().find((x) => x.sid === roto)!;
  assert.ok(g.motivo && /ENOENT|no-existe/.test(g.motivo), `motivo: ${g.motivo}`);
  assert.equal(despues.procDe(roto), null);

  // Y un mensaje a uno que volvió anda como siempre.
  await despues.mandar({ sid: quieto, texto: "seguimos", ...M });
  await hasta(() => despues!.procDe(quieto)?.ocupado === false, 5000).catch(() => {});
});

test("sin dormidos no se lanza nada (un arranque normal, o el segundo)", async () => {
  const otra = (await import("../electron/lider.ts?arranque=3")) as typeof antes;
  assert.deepEqual(await otra.reanudarDormidos(0), []);
  await otra.cerrarTodos(true);
});
