// «Revisar con otro modelo»: el prompt, la lectura de lo que contesta el revisor, la marca del mensaje que recibe el líder, los
// revisores permitidos y la orquestación de punta a punta con un revisor simulado (sin gastar cupo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADJUNTO_BYTES, ADJUNTOS_MAX, ADJUNTOS_TOTAL, archivosDelPlan, rutasDelPlan, leerMensajeRevision, mensajeParaLider, parsearRevision, promptRevisor, revisarPlan, revisoresPermitidos, respuestaDeAgy, type DepsRevision } from "../electron/revision-plan.ts";

const RESPUESTA = "## Qué está bien\n- El orden\n\n## Riesgos y huecos\n- Falta un test\n\n## Mejoras concretas\n- Agregar el test\n\n## Plan mejorado\n1. Test\n2. Código\n";

test("promptRevisor: lleva el pedido, el plan, las rutas y las cuatro secciones", () => {
  const p = promptRevisor({ plan: "# Plan\n1. Hacer X", pedido: "armá X", cwd: "/p/trama" });
  for (const s of ["armá X", "# Plan", "/p/trama", "## Qué está bien", "## Riesgos y huecos", "## Mejoras concretas", "## Plan mejorado"]) assert.ok(p.includes(s), s);
});

test("parsearRevision: parte las cuatro secciones; sin encabezados queda todo en libre", () => {
  const r = parsearRevision(RESPUESTA);
  assert.deepEqual([r.bien, r.riesgos, r.mejoras], ["- El orden", "- Falta un test", "- Agregar el test"]);
  assert.equal(r.plan, "1. Test\n2. Código");
  assert.equal(parsearRevision("Está bien, dale.").libre, "Está bien, dale.");
});

test("el mensaje del líder va y vuelve con su marca (y un mensaje común no es una revisión)", () => {
  const m = mensajeParaLider("gemini-4-argon", "Gemini 4 Argon", parsearRevision(RESPUESTA));
  assert.match(m, /ExitPlanMode/);
  const v = leerMensajeRevision(m)!;
  assert.equal(v.modelo, "gemini-4-argon");
  assert.equal(v.nombre, "Gemini 4 Argon");
  assert.equal(v.riesgos, "- Falta un test");
  assert.equal(v.plan, "1. Test\n2. Código");
  assert.equal(leerMensajeRevision("hola"), null);
  assert.equal(leerMensajeRevision(mensajeParaLider("m", "M", parsearRevision("sin formato")))?.libre, "sin formato");
});

test("revisoresPermitidos: sólo Claude y Gemini, sin lo desactivado en Ajustes", () => {
  const ids = ["claude-opus-5-5", "claude-sonnet-5-5", "gemini-4-argon", "ollama:qwen", "opencode:opencode/x-free"];
  assert.deepEqual(revisoresPermitidos(ids, []), ["claude-opus-5-5", "claude-sonnet-5-5", "gemini-4-argon"]);
  assert.deepEqual(revisoresPermitidos(ids, ["opus", "gemini-4-argon"]), ["claude-sonnet-5-5"]);
});

test("respuestaDeAgy: el response del result; un error rechaza", () => {
  assert.equal(respuestaDeAgy('{"event":"init"}\n{"event":"result","result":{"status":"SUCCESS","response":"hola"}}\n'), "hola");
  assert.throws(() => respuestaDeAgy('{"event":"result","result":{"status":"ERROR","response":"sin red"}}\n'), /sin red/);
});

function deps(salida: string | Error): { d: DepsRevision; hecho: { prompt: string; negado: string[]; mandado: string[] } } {
  const hecho = { prompt: "", negado: [] as string[], mandado: [] as string[] };
  return {
    hecho,
    d: {
      correr: async (_m, _e, p) => {
        hecho.prompt = p;
        if (salida instanceof Error) throw salida;
        return salida;
      },
      pedidoOriginal: async () => "armá X",
      cwd: () => "/p/trama",
      nombre: () => "Gemini 4 Argon",
      negar: (m) => hecho.negado.push(m),
      mandar: async (t) => void hecho.mandado.push(t),
    },
  };
}

test("revisarPlan (revisor simulado): niega el plan, le manda la revisión al líder y devuelve la tarjeta", async () => {
  const { d, hecho } = deps(RESPUESTA);
  const v = await revisarPlan({ modelo: "gemini-4-argon", effort: "high", plan: "# Plan\n1. X" }, d);
  assert.ok(hecho.prompt.includes("armá X") && hecho.prompt.includes("# Plan"));
  assert.equal(hecho.negado.length, 1);
  assert.equal(hecho.mandado.length, 1);
  assert.equal(leerMensajeRevision(hecho.mandado[0])?.mejoras, "- Agregar el test");
  assert.equal(v.nombre, "Gemini 4 Argon");
  assert.equal(v.plan, "1. Test\n2. Código");
});

test("revisarPlan: si el revisor falla o no dice nada, el plan sigue pendiente (no se niega ni se manda nada)", async () => {
  for (const salida of [new Error("sin respuesta"), "   "]) {
    const { d, hecho } = deps(salida);
    await assert.rejects(revisarPlan({ modelo: "gemini-4-argon", effort: "high", plan: "# P" }, d));
    assert.deepEqual([hecho.negado, hecho.mandado], [[], []]);
  }
  await assert.rejects(revisarPlan({ modelo: "m", effort: "", plan: "  " }, deps("x").d));
});

test("rutasDelPlan: saca las rutas de archivo del texto, sin versiones ni dominios ni repetidas", () => {
  const r = rutasDelPlan("1. Tocar `app/electron/lider.ts` y ./src/a.css.\n2. Subir a v1.2 y mirar example.com, otra vez app/electron/lider.ts y README.md");
  assert.deepEqual(r, ["app/electron/lider.ts", "src/a.css", "README.md"]);
});

test("archivosDelPlan: sólo lo que está dentro del proyecto, con topes y sin secretos", async () => {
  const dir = "/p/trama";
  const grande = "x".repeat(ADJUNTO_BYTES + 500);
  const archivos: Record<string, string> = {
    [`${dir}/app/lider.ts`]: "export const a = 1;",
    [`${dir}/grande.md`]: grande,
    [`${dir}/.env`]: "CLAVE=secreta",
    [`/etc/passwd`]: "root",
  };
  const d = { leer: async (r: string) => archivos[r], esArchivo: async (r: string) => r in archivos };
  const r = await archivosDelPlan("app/lider.ts grande.md .env ../../etc/passwd /etc/passwd falta.ts", dir, d);
  assert.deepEqual(r.map((a) => [a.ruta, a.cortado]), [["app/lider.ts", false], ["grande.md", true]]);
  assert.equal(r[1].texto.length, ADJUNTO_BYTES);
  assert.deepEqual(await archivosDelPlan("app/lider.ts", undefined, d), []);
  const muchos = Array.from({ length: 12 }, (_, i) => `f${i}.ts`);
  const m = Object.fromEntries(muchos.map((f) => [`${dir}/${f}`, "y".repeat(9000)]));
  const rr = await archivosDelPlan(muchos.join(" "), dir, { leer: async (r) => m[r], esArchivo: async (r) => r in m });
  assert.ok(rr.length <= ADJUNTOS_MAX && rr.reduce((n, a) => n + a.texto.length, 0) <= ADJUNTOS_TOTAL);
});

test("revisarPlan: los archivos que pide `archivos` van pegados en el prompt del revisor", async () => {
  const { d, hecho } = deps(RESPUESTA);
  await revisarPlan({ modelo: "gemini-4-argon", effort: "high", plan: "# P\ntocar app/a.ts" }, { ...d, archivos: async () => [{ ruta: "app/a.ts", texto: "const SECRETO_VISIBLE = 1;", cortado: false }] });
  assert.ok(hecho.prompt.includes("### app/a.ts") && hecho.prompt.includes("SECRETO_VISIBLE"));
});
