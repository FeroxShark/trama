// El texto que va llegando de un líder (`parcial`), de punta a punta en el main: el claude falso
// contesta "novela" de a un delta por palabra y electron/lider.ts los junta (PARCIAL_MS) antes de
// pasarlos. Lo que sale: muchos menos eventos que deltas, el mismo texto, y siempre antes del
// mensaje entero. El entorno va antes del import (lider.ts lo lee al cargar).
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-parciales-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.TRAMA_FALSO_MS = "30";
process.env.TRAMA_FALSO_TOKEN_MS = "3";

const lider = await import("../electron/lider.ts");
type Ev = { sid: string; t: number; e: { tipo: string; texto?: string } };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, t: Date.now(), e }));
after(() => lider.cerrarTodos(true));

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 15_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
const de = (sid: string) => eventos.filter((x) => x.sid === sid);

test("un delta por palabra: salen juntados, con el mismo texto y antes del mensaje entero", { timeout: 30_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "novela" });
  await hasta(() => de(sid).some((x) => x.e.tipo === "fin"));
  const es = de(sid);
  const parciales = es.filter((x) => x.e.tipo === "parcial");
  const mensajes = es.filter((x) => x.e.tipo === "mensaje");
  assert.equal(mensajes.length, 1);
  const entero = mensajes[0].e.texto!;
  const deltas = entero.match(/\s*\S+/g)!.length;
  assert.ok(deltas > 200, `la novela es larga: ${deltas} deltas`);

  // El mismo texto, sin perder ni repetir nada.
  assert.equal(parciales.map((x) => x.e.texto).join(""), entero);
  // Se ve crecer (varios pedazos), pero no un evento por palabra.
  assert.ok(parciales.length >= 4, `llegó en pedazos: ${parciales.length}`);
  assert.ok(parciales.length < deltas / 3, `${parciales.length} eventos para ${deltas} deltas`);
  // A lo sumo uno cada PARCIAL_MS (el primero sale ya).
  const duro = parciales.at(-1)!.t - parciales[0].t;
  assert.ok(parciales.length <= Math.ceil(duro / lider.PARCIAL_MS) + 2, `${parciales.length} eventos en ${duro} ms`);
  for (let i = 1; i < parciales.length - 1; i++) assert.ok(parciales[i].t - parciales[i - 1].t >= lider.PARCIAL_MS - 5, `dos seguidos a ${parciales[i].t - parciales[i - 1].t} ms`);
  // Todo el texto llegó antes que el mensaje entero: ése sólo lo reemplaza.
  assert.ok(es.indexOf(parciales.at(-1)!) < es.indexOf(mensajes[0]));
  assert.equal(es.slice(es.indexOf(mensajes[0])).filter((x) => x.e.tipo === "parcial").length, 0);
});

test("una respuesta corta: el primer pedazo sale ya y no queda nada sin salir", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola" });
  await hasta(() => de(sid).some((x) => x.e.tipo === "fin"));
  const es = de(sid);
  const parciales = es.filter((x) => x.e.tipo === "parcial");
  assert.equal(parciales.map((x) => x.e.texto).join(""), "eco: hola");
  assert.equal(parciales[0].e.texto, "eco");
  assert.ok(es.indexOf(parciales.at(-1)!) < es.findIndex((x) => x.e.tipo === "mensaje"));
});

test("pensá: el razonamiento sale juntado, antes del texto, y el mensaje entero lo trae", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "pensá en voz alta" });
  await hasta(() => de(sid).some((x) => x.e.tipo === "fin"));
  const es = de(sid);
  const pens = es.filter((x) => x.e.tipo === "pensamiento");
  const parc = es.filter((x) => x.e.tipo === "parcial");
  const mensajes = es.filter((x) => x.e.tipo === "mensaje") as (Ev & { e: { pensado?: string } })[];
  const dicho = pens.map((x) => x.e.texto).join("");
  assert.equal(dicho, "Ana pide algo corto. Pienso en cómo contestarlo y lo respondo sin vueltas.");
  // El mensaje entero del razonamiento trae lo mismo, y llega después de todos sus pedazos.
  const conPensado = mensajes.find((x) => x.e.pensado);
  assert.equal(conPensado?.e.pensado, dicho);
  assert.ok(es.indexOf(pens.at(-1)!) < es.indexOf(conPensado!));
  // El texto llega después del razonamiento, nunca antes.
  assert.ok(es.indexOf(pens.at(-1)!) < es.indexOf(parc[0]));
  assert.equal(parc.map((x) => x.e.texto).join(""), "eco: pensá en voz alta");
});
