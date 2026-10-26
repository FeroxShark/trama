// Editar / Volver acá sobre un mensaje anterior a una compactación abre un líder nuevo (rama de una copia). Ese líder tiene que
// sobrevivir a un reinicio de trama: seguir en lideres.json con el sid real de su transcript, no el de la copia, y recordar de
// dónde salió. Transcripts inventados, `claude` falso. Armado como tests/rebobinar-previa.test.ts.
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

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-reinicio-copia-")));
const carpeta = path.join(tmp, "trabajo");
mkdirSync(carpeta);
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = path.join(tmp, "pa");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "registry.json");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.TRAMA_FALSO_MS = "20";
mkdirSync(process.env.HILOS_SESIONES);
writeFileSync(process.env.PROYECTOS_REGISTRY, "{}");

const lider = await import("../electron/lider.ts");
after(() => lider.cerrarTodos(true));

const SID = "36ac312b-6241-4230-b3b3-c3decacc39c0";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const linea = (o: object) => JSON.stringify(o) + "\n";
const base = { timestamp: "2026-10-26T10:00:00Z", sessionId: SID, cwd: carpeta };
const user = (uuid: string, parentUuid: string | null, texto: string) => linea({ ...base, type: "user", uuid, parentUuid, message: { role: "user", content: texto } });
const asist = (uuid: string, parentUuid: string, texto: string) =>
  linea({
    ...base,
    type: "assistant",
    uuid,
    parentUuid,
    message: { id: `msg_${uuid.slice(-3)}`, role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: texto }], usage: { input_tokens: 5, output_tokens: 5 } },
  });
const marca = linea({ ...base, type: "system", subtype: "compact_boundary", uuid: U(9), parentUuid: null, compactMetadata: { trigger: "auto", preTokens: 100 } });
const compactada =
  user(U(1), null, "uno") + asist(U(2), U(1), "dos") + user(U(3), U(2), "tres") + asist(U(4), U(3), "cuatro") + marca + user(U(10), U(9), "cinco") + asist(U(11), U(10), "seis");

const dir = path.join(tmp, "claude", "projects", carpeta.replace(/[^a-zA-Z0-9]/g, "-"));
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, `${SID}.jsonl`), compactada);

const archivo = path.join(process.env.HILOS_STATE, "lideres.json");
const leer = () => JSON.parse(readFileSync(archivo, "utf8")).lideres as { sid: string; nombre: string; rama?: unknown; origen?: { sid: string; titulo: string } }[];
const hasta = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(ok(), "no llegó a tiempo");
};

test("Editar antes de la compactación: el líder nuevo sigue en lideres.json tras reiniciar, con su sid real y de dónde salió", async () => {
  const nuevo = await lider.rebobinar({ sid: SID, uuid: U(3), texto: "tres, editado", modelo: "claude-opus-5-5", effort: "high", previa: true });
  assert.ok(nuevo, "abrió un líder nuevo");
  assert.notEqual(nuevo, SID);
  // El primer turno termina: de ahí en más es un líder como cualquier otro (sin `rama`).
  await hasta(() => existsSync(archivo) && leer().some((l) => l.sid === nuevo && !l.rama));

  // El reinicio: se cierra todo y un módulo nuevo lee el disco, como el proceso que arranca.
  await lider.cerrarTodos(true);
  const reiniciado = await import("../electron/lider.ts?reinicio");
  const ls = await reiniciado.lideresApp();
  const g = ls.find((l) => l.sid === nuevo);
  assert.ok(g, "el líder nuevo sigue listado tras reiniciar");
  assert.equal(ls.filter((l) => l.sid !== SID && l.sid !== nuevo).length, 0, "ni la copia ni otro sid figuran como líder");
  assert.equal(g.rama, undefined);
  assert.equal(g.origen?.sid, SID, "recuerda de qué líder salió");
  assert.equal(g.origen?.titulo, "uno", "y cómo se llamaba");
  await reiniciado.cerrarTodos(true);
});

test("tituloDeRama: la rama lleva ↳ mientras se llame igual que su origen", async () => {
  const { tituloDeRama } = await import("../electron/tema.ts");
  assert.equal(tituloDeRama("uno", { titulo: "uno" }), "↳ uno");
  assert.equal(tituloDeRama("otro", { titulo: "uno" }), "otro", "con título propio no se toca");
  assert.equal(tituloDeRama("uno", undefined), "uno");
  assert.equal(tituloDeRama("", { titulo: "" }), "");
});
