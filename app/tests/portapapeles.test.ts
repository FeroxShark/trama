import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Los imports de src/ van sin extensión: se llevan al .ts (como tests/fuente.test.ts).
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.includes("/src/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { textoDelPortapapeles, TOPE_PEGADO } = await import("../electron/portapapeles.ts");
const { pegadoSinTexto } = await import("../src/hilo/adjuntos.ts");

/** Un `clipboard` de Electron de mentira: tipo → texto (o un error al leerlo). */
function falso(texto: string, tipos: Record<string, string | Error> = {}) {
  return {
    leidos: [] as string[],
    readText: async () => texto,
    read() {
      const leidos = this.leidos;
      return Promise.resolve([
        {
          types: Object.keys(tipos),
          async getType(t: string) {
            leidos.push(t);
            const v = tipos[t];
            if (v === undefined || v instanceof Error) throw v ?? new Error("no hay " + t);
            return { text: async () => v };
          },
        },
      ]);
    },
  };
}

test("portapapeles: readText manda y no toca los tipos", async () => {
  const cb = falso("hola", { UTF8_STRING: "otro" });
  assert.equal(await textoDelPortapapeles(cb), "hola");
  assert.deepEqual(cb.leidos, []);
});

test("portapapeles: sin text/plain, cualquier tipo de texto de la app de origen (UTF-8 primero)", async () => {
  for (const f of ["UTF8_STRING", "TEXT", "STRING", "text/plain;charset=utf-8", "text/x-moz-text-internal"]) {
    assert.equal(await textoDelPortapapeles(falso("", { [f]: "ñandú ✓" })), "ñandú ✓", f);
  }
  const cb = falso("", { STRING: "latin", "text/html": "<b>x</b>", UTF8_STRING: "utf8" });
  assert.equal(await textoDelPortapapeles(cb), "utf8");
  assert.ok(!cb.leidos.includes("text/html"), "el html no es texto plano");
});

test("portapapeles: sin ningún texto avisa los tipos y da vacío; un tipo que falla pasa al siguiente", async () => {
  let dicho: string[] = [];
  assert.equal(await textoDelPortapapeles(falso("", { "image/png": "x", "text/html": "<i/>" }), (f) => (dicho = f)), "");
  assert.deepEqual(dicho, ["image/png", "text/html"]);
  assert.equal(await textoDelPortapapeles(falso("", { UTF8_STRING: new Error("x"), TEXT: "bien" })), "bien");
  const roto = { readText: () => Promise.reject(new Error("x")), read: () => Promise.reject(new Error("y")) };
  assert.equal(await textoDelPortapapeles(roto), "");
});

test("portapapeles: lo enorme se corta al tope y los NUL finales se van", async () => {
  assert.equal((await textoDelPortapapeles(falso("a".repeat(TOPE_PEGADO + 5)))).length, TOPE_PEGADO);
  assert.equal(await textoDelPortapapeles(falso("", { TEXT: "hola\0\0" })), "hola");
});

/** Un DataTransfer de mentira. */
const datos = (types: string[], plain = "", files: unknown[] = []) =>
  ({ types, items: files.map((f) => ({ kind: "file", getAsFile: () => f })), files, getData: (t: string) => (t === "text/plain" ? plain : "") }) as unknown as DataTransfer;

test("pegadoSinTexto: sólo cuando el navegador no tiene qué pegar", () => {
  assert.equal(pegadoSinTexto(datos([])), true, "offer vacío");
  assert.equal(pegadoSinTexto(datos(["UTF8_STRING"])), true, "tipo que Chromium no toma");
  assert.equal(pegadoSinTexto(datos(["text/plain"], "")), true, "text/plain anunciado pero vacío");
  assert.equal(pegadoSinTexto(datos(["text/plain"], "hola")), false);
  assert.equal(pegadoSinTexto(datos(["text/html"])), false, "el html lo pega el navegador");
  assert.equal(pegadoSinTexto(datos(["Files"], "", [{}])), false, "un archivo va por adjuntar");
  assert.equal(pegadoSinTexto(null), false);
});
