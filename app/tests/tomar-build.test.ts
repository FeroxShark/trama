// Un build nuevo con el motor aparte (electron/relanzar.ts `tomarBuild`, lo usa main.ts en `motorNuevo`): si main y
// preload son los que cargó el proceso de la ventana, alcanza con recargar la página; si no, o ante la duda, relanzar.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { huellaDeModulo, huellaProceso, tomarBuild } from "../electron/relanzar.ts";

const tmp = mkdtempSync(path.join(tmpdir(), "trama-tomar-build-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const h = (main: string | null, preload: string | null) => ({ main, preload });

test("tomarBuild: mismos main y preload recarga; cualquiera distinto o ilegible relanza", () => {
  assert.equal(tomarBuild(h("a", "p"), h("a", "p")), "recargar");
  assert.equal(tomarBuild(h("a", "p"), h("b", "p")), "relanzar", "main distinto");
  assert.equal(tomarBuild(h("a", "p"), h("a", "q")), "relanzar", "preload distinto");
  assert.equal(tomarBuild(h("a", "p"), h(null, "p")), "relanzar", "main ilegible ahora");
  assert.equal(tomarBuild(h("a", "p"), h("a", null)), "relanzar", "preload ilegible ahora");
  assert.equal(tomarBuild(h(null, "p"), h(null, "p")), "relanzar", "ilegible al arrancar, aunque coincida");
  assert.equal(tomarBuild(null, h("a", "p")), "relanzar");
  assert.equal(tomarBuild(h("a", "p"), null), "relanzar");
});

function build(nombre: string, archivos: Record<string, string>) {
  const raiz = path.join(tmp, nombre);
  mkdirSync(path.join(raiz, "dist-electron"), { recursive: true });
  mkdirSync(path.join(raiz, "dist"), { recursive: true });
  for (const [f, texto] of Object.entries(archivos)) writeFileSync(path.join(raiz, f), texto);
  return raiz;
}

const base = {
  "dist-electron/main.js": 'import { a } from "./a.js";\nconst b = await import("./b.js");\n',
  "dist-electron/a.js": "export const a = 1;\n",
  "dist-electron/b.js": "export const b = 2;\n",
  "dist-electron/suelto.js": "// nadie lo importa\n",
  "dist-electron/preload.cjs": 'require("./canales.cjs");\n',
  "dist-electron/canales.cjs": "module.exports = 1;\n",
  "dist/index.html": "<script src=assets/x-1.js></script>",
};

test("huellaProceso: un build que sólo cambia la página da recargar", () => {
  const raiz = build("pagina", base);
  const h0 = huellaProceso(raiz);
  assert.ok(h0.main && h0.preload);
  writeFileSync(path.join(raiz, "dist/index.html"), "<script src=assets/x-9.js></script>");
  writeFileSync(path.join(raiz, "dist-electron/suelto.js"), "// otro\n");
  assert.equal(tomarBuild(h0, huellaProceso(raiz)), "recargar");
});

test("huellaProceso: un módulo importado por main (también con import()) o por el preload cambia la huella", () => {
  const raiz = build("modulos", base);
  const h0 = huellaProceso(raiz);
  writeFileSync(path.join(raiz, "dist-electron/b.js"), "export const b = 3;\n");
  const h1 = huellaProceso(raiz);
  assert.notEqual(h1.main, h0.main);
  assert.equal(h1.preload, h0.preload);
  assert.equal(tomarBuild(h0, h1), "relanzar");
  writeFileSync(path.join(raiz, "dist-electron/canales.cjs"), "module.exports = 2;\n");
  const h2 = huellaProceso(raiz);
  assert.notEqual(h2.preload, h1.preload);
  assert.equal(tomarBuild(h1, h2), "relanzar");
});

test("huellaProceso: un archivo que falta deja la huella en null y relanza", () => {
  const raiz = build("falta", base);
  const h0 = huellaProceso(raiz);
  rmSync(path.join(raiz, "dist-electron/a.js"));
  const h1 = huellaProceso(raiz);
  assert.equal(h1.main, null);
  assert.equal(tomarBuild(h0, h1), "relanzar");
  assert.equal(huellaDeModulo(path.join(raiz, "dist-electron/no-existe.js")), null);
  assert.equal(huellaProceso(path.join(tmp, "sin-build")).preload, null);
});
