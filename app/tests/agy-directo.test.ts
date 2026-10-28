// Imágenes y «Mandar ya» de un líder de Gemini (agy-puente.ts + agy-falso). Base: un líder de Gemini de punta a punta (electron/lider.ts → agy-puente.ts → scripts/agy-falso.mjs): los eventos que pinta la
// app, su transcript aparte, el archivo de sesión que ve la barra (y `pa`), la continuidad con `--conversation` (también tras
// cerrar y volver) y su repetición si agy ya no la tiene. Nunca el agy de verdad. HOME en un tmp: el prefacio lee sus CLAUDE.md.
import { test, after } from "node:test";
import { soloPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-gemini-dir-"));
const home = path.join(tmp, "home");
mkdirSync(home, { recursive: true });
writeFileSync(path.join(home, "CLAUDE.md"), "# Reglas de prueba\n\n## Jefe (sesión en `~`)\n- Delegás con `pa <proyecto> \"<tarea>\"`. MARCA-CLAUDE-MD\n");
process.env.HOME = home;
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_MODELOS = path.join(tmp, "no-existe.json");
process.env.TRAMA_DUENO = "Ana"; // los prompts nombran al dueño: aquí es siempre el mismo
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_AGY = path.join(import.meta.dirname, "..", "scripts", "agy-falso.mjs");
process.env.TRAMA_FALSO_LOG = path.join(tmp, "agy.log");
// Un `pa` fuera del PATH de la app (como bajo la unidad de systemd): el líder de Gemini tiene que poder llamarlo igual.
const dirPa = path.join(tmp, "fuera-del-path");
process.env.HILOS_PA = path.join(dirPa, "pa");
process.env.PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(":");
process.env.TRAMA_FALSO_MS = "20";
process.env.TRAMA_FALSO_MS_LENTO = "400";
process.env.TRAMA_AGY_DIRECTO_MS = "1500";

const lider = await import("../electron/lider.ts");
type Ev = { sid: string; e: any };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  await lider.cerrarTodos(true);
  rmSync(tmp, { recursive: true, force: true });
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 15_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
const de = (sid: string, tipo: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === tipo).map((x) => x.e);
// El log lo comparten el claude falso y el agy falso: las líneas de agy son las que traen `prompt`.
const llamadas = () =>
  (existsSync(process.env.TRAMA_FALSO_LOG!) ? readFileSync(process.env.TRAMA_FALSO_LOG!, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []).filter((l) => "prompt" in l);
const textos = (sid: string) => de(sid, "mensaje").map((m) => m.texto as string);


// PNG de 1x1 (los bytes importan: el archivo que ve agy tiene que ser la imagen que mandó la persona).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const M = { modelo: "gemini-3.8-flash", effort: "low" };

test("las imágenes llegan a agy como archivos: bytes intactos, la ruta en el prompt, sin el aviso de que no se ven, y se limpian", { skip: soloPosix("modos de archivo"), timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "mirá esto", imagenes: [{ tipo: "image/png", datos: PNG.toString("base64") }] });
  await hasta(() => de(sid, "fin").length === 1);
  const l = llamadas().at(-1)!;
  assert.doesNotMatch(l.prompt, /no pudiste ver/);
  const ruta = /(\/\S+\/gemini\/[^/\s]+\/img-\d+\.png)/.exec(l.prompt)?.[1];
  assert.ok(ruta, `el prompt trae la ruta: ${l.prompt}`);
  assert.ok(ruta.includes(path.join(process.env.HILOS_STATE!, "gemini", sid)));
  assert.match(l.prompt, /view_file/);
  assert.deepEqual(readFileSync(ruta), PNG);
  assert.equal(statSync(ruta).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(ruta)).mode & 0o777, 0o700);
  assert.match(textos(sid).join("\n"), /mirá esto/);
  // Un turno siguiente borra las del anterior; al cerrar el puente no queda la carpeta.
  await lider.mandar({ sid, texto: "sin imagen", ...M });
  await hasta(() => de(sid, "fin").length === 2);
  assert.ok(!existsSync(ruta), "las de turnos anteriores se borran");
  await lider.cerrarTodos(false);
  assert.ok(!existsSync(path.dirname(ruta)));
});

test("«Mandar ya» con Gemini: corta a agy en un límite de paso y sigue en la misma conversación, con un solo fin", { timeout: 60_000, skip: soloPosix("agy falso por shebang") }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "herramienta despacio uno" });
  await hasta(() => de(sid, "hace").length > 0);
  const n0 = llamadas().length;
  await lider.mandarDirecto({ sid, texto: "YA-GEMINI", ...M });
  assert.equal(lider.procDe(sid)?.directos, 1);
  await hasta(() => de(sid, "fin").length === 1, 30_000);
  assert.equal(de(sid, "fin")[0].error, null);
  assert.deepEqual(de(sid, "entregado").map((e) => e.texto), ["YA-GEMINI"]);
  assert.equal(lider.procDe(sid)?.directos, 0);
  const ll = llamadas().slice(n0 - 1);
  assert.equal(ll.length, 2, "agy corrió dos veces: la cortada y la que sigue");
  const conv = ll[0]!.args.includes("--conversation") ? ll[0]!.args[ll[0]!.args.indexOf("--conversation") + 1] : null;
  const conv2 = ll[1]!.args[ll[1]!.args.indexOf("--conversation") + 1];
  assert.ok(conv2 && (!conv || conv === conv2));
  assert.match(ll[1]!.prompt, /a mitad del turno[^\n]*\nYA-GEMINI/);
  assert.match(textos(sid).join("\n"), /eco: \[Mensaje[^\n]*\nYA-GEMINI/, "contestó el mensaje");
  await espera(400);
  assert.equal(de(sid, "fin").length, 1, "sigue siendo un solo turno");
  assert.equal(lider.procDe(sid)?.ocupado, false);
  // En el transcript el mensaje es de la persona, en el medio.
  const t = readFileSync((await lider.transcriptDe(sid))!, "utf8");
  assert.match(t, /YA-GEMINI/);
});

test("«Mandar ya» con Gemini sin turno en curso es un mensaje normal, y su eco igual llega", { timeout: 30_000, skip: soloPosix("agy falso por shebang") }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "uno" });
  await hasta(() => de(sid, "fin").length === 1);
  await lider.mandarDirecto({ sid, texto: "normal", ...M });
  await hasta(() => de(sid, "fin").length === 2);
  assert.match(textos(sid).join("\n"), /eco: normal/);
});
