// Imágenes a un líder (B26): validación en el main, el `content` del stream-json,
// el transcript que las trae de vuelta, el turno que las muestra y la cola que no las pierde.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { BASE64_MAX, contenidoUsuario, escala, IMAGENES_MAX, imagenesDe, imagenesDeContenido, LADO_MAX } from "../electron/imagenes.ts";
import { argvLider, conversacionDe, cortar, entornoLider, lineaUsuario, parsearLinea, type Evento } from "../electron/lider-arma.ts";
import { turnos } from "../src/hilo/turnos.ts";
import { crearCola } from "../electron/cola.ts";
import type { Mensaje } from "../src/datos/contrato.ts";

// Un PNG de 1×1 (inventado, público).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const img = { tipo: "image/png", datos: PNG };
const clave = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return String((e as Error).message).split("\u0001")[1];
  }
  return null;
};

test("escala: el lado largo a LADO_MAX, sin agrandar ni deformar", () => {
  assert.deepEqual(escala(800, 600), { ancho: 800, alto: 600 });
  assert.deepEqual(escala(4000, 3000), { ancho: LADO_MAX, alto: 1500 });
  assert.deepEqual(escala(1000, 5000), { ancho: 400, alto: LADO_MAX });
  assert.deepEqual(escala(9000, 1), { ancho: LADO_MAX, alto: 1 });
});

test("imagenesDe: sólo png/jpeg/webp/gif en base64, con tope de tamaño y de cantidad", () => {
  assert.deepEqual(imagenesDe(undefined), []);
  assert.deepEqual(imagenesDe([{ ...img, extra: 1 }]), [img]);
  for (const tipo of ["image/jpeg", "image/webp", "image/gif"]) assert.equal(imagenesDe([{ tipo, datos: PNG }])[0].tipo, tipo);
  assert.equal(clave(() => imagenesDe([{ tipo: "image/svg+xml", datos: PNG }])), "i18n:main.imagenTipo");
  assert.equal(clave(() => imagenesDe([{ tipo: "image/png", datos: "no es base64!" }])), "i18n:main.imagenRara");
  assert.equal(clave(() => imagenesDe([{ tipo: "image/png", datos: "" }])), "i18n:main.imagenRara");
  assert.equal(clave(() => imagenesDe("x")), "i18n:main.imagenRara");
  assert.equal(clave(() => imagenesDe([{ tipo: "image/png", datos: "A".repeat(BASE64_MAX + 4) }])), "i18n:main.imagenGrande");
  assert.equal(clave(() => imagenesDe(Array.from({ length: IMAGENES_MAX + 1 }, () => img))), "i18n:main.imagenesMuchas");
});

test("lineaUsuario: sin imágenes, texto; con imágenes, bloques image (base64) y después el texto", () => {
  assert.deepEqual(JSON.parse(lineaUsuario("hola")), { type: "user", message: { role: "user", content: "hola" } });
  assert.deepEqual(JSON.parse(lineaUsuario("mirá esto", [img, { tipo: "image/jpeg", datos: PNG }])), {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: PNG } },
        { type: "text", text: "mirá esto" },
      ],
    },
  });
  // Sólo la imagen: sin bloque de texto vacío.
  assert.deepEqual(contenidoUsuario("  ", [img]), [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }]);
});

test("transcript: el mensaje con imágenes las trae (y uno con sólo una imagen no se pierde)", () => {
  const linea = (o: object) => JSON.stringify(o);
  const t = [
    linea({ type: "user", timestamp: "2026-10-04T10:00:00Z", message: { role: "user", content: contenidoUsuario("qué ves", [img]) } }),
    linea({ type: "assistant", timestamp: "2026-10-04T10:00:05Z", message: { id: "m1", model: "claude-opus-5-5", role: "assistant", content: [{ type: "text", text: "un punto" }] } }),
    linea({ type: "user", timestamp: "2026-10-04T10:01:00Z", message: { role: "user", content: contenidoUsuario("", [img]) } }),
  ].join("\n");
  const r = conversacionDe("s", "/t.jsonl", t);
  assert.equal(r.total, 3);
  assert.equal(r.mensajes[0].texto, "qué ves");
  assert.deepEqual(r.mensajes[0].imagenes, [img]);
  assert.equal(r.mensajes[1].imagenes, undefined);
  assert.deepEqual(r.mensajes[2], { i: 2, rol: "user", texto: "", herramientas: [], imagenes: [img], ts: "2026-10-04T10:01:00Z", modelo: null });
  // Un bloque de imagen raro (url, tipo desconocido) no se muestra.
  assert.deepEqual(imagenesDeContenido([{ type: "image", source: { type: "url", url: "https://x" } }, { type: "image", source: { type: "base64", media_type: "image/bmp", data: PNG } }]), []);

  const items = turnos(r.mensajes as Mensaje[]);
  assert.deepEqual(
    items.filter((x) => x.tipo === "yo").map((x) => (x.tipo === "yo" ? [x.texto, x.imagenes?.length ?? 0] : null)),
    [
      ["qué ves", 1],
      ["", 1],
    ],
  );
});

test("cola: lo que no salió se queda en la cola con sus imágenes, y así se guarda", async () => {
  let guardado = "";
  const c = crearCola({
    disponible: async () => "app",
    traer: async () => ({ ok: true }),
    mandar: () => Promise.reject(new Error("no")),
    total: async () => null,
    textoError: () => "no",
    guardar: async (json) => void (guardado = json),
    avisar: () => {},
  });
  c.encolar("s", { texto: "", modelo: "m", effort: "high", imagenes: [img] });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(c.lista("s").map((x) => x.imagenes), [[img]]);
  assert.equal(c.error("s"), "no");
  assert.deepEqual(JSON.parse(guardado).colas.s[0].imagenes, [img]);
});

test("claude falso: un mensaje con imágenes contesta el eco con cuántas", async () => {
  const FALSO = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
  const argv = argvLider({ modelo: "claude-sonnet-5-5", effort: "high", sid: "36ac312b-6241-4230-b3b3-c3decacc39c0", nombre: "trama-0a1b", resume: false });
  const p = spawn(process.execPath, [FALSO, ...argv], { env: entornoLider({ ...process.env, TRAMA_FALSO_MS: "1" }, os.homedir()) as NodeJS.ProcessEnv });
  const eventos: Evento[] = [];
  let resto = "";
  const fin = new Promise<void>((ok) => {
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d: string) => {
      const c = cortar(resto, d);
      resto = c.resto;
      for (const x of c.lineas)
        for (const e of parsearLinea(x)) {
          eventos.push(e);
          if (e.tipo === "fin") ok();
        }
    });
  });
  p.stdin.write(lineaUsuario("mirá", [img, img]));
  await fin;
  p.kill();
  assert.equal(eventos.filter((e) => e.tipo === "parcial").map((e) => (e as { texto: string }).texto).join(""), "eco: [2 imágenes] mirá");
});
