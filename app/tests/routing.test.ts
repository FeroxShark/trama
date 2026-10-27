// La tabla de routing de CLAUDE.md (electron/routing.ts): leer las tres filas de
// worker y reescribirlas sin tocar nada más. Siempre sobre un CLAUDE.md de
// ejemplo en una carpeta temporal: nunca el ~/CLAUDE.md real.
import { test } from "node:test";
import { soloPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { escribirRouting, guardarRouting, leerRouting, parsearRouting, type Cambio } from "../electron/routing.ts";
import { cambiarIdioma, textoMain } from "../src/i18n/index.ts";

/** Los errores del main vienen como clave: se leen como los vería Ana en español. */
const enEs = (s: string) => {
  cambiarIdioma("es");
  try {
    return textoMain(s);
  } finally {
    cambiarIdioma("en");
  }
};
const lanza = (re: RegExp) => (e: unknown) => re.test(enEs((e as Error).message));

const EJEMPLO = `# Asistente de ejemplo

Texto de antes con | barras | que no son la tabla.

## Routing

<!-- trama:routing (la app trama edita esta tabla; no cambiar el formato de las filas) -->
| Rol | Modelo | Effort |
|---|---|---|
| Orquestador (jefe) | Opus 5.5 | high; xhigh plan grande |
| Worker que escribe código | \`claude-opus-5-5\` | medium acotado, high si toca varias partes |
| Worker exploración (leer repo, auditar; \`--leer\`) | \`claude-sonnet-5-5\` | high; xhigh auditoría grande |
| Frontend / diseño visual | \`claude-fable-5-1\` | high |
<!-- /trama:routing -->

- Una regla abajo.
Con espacios al final y sin salto al final`;

const ok = (r: ReturnType<typeof parsearRouting>) => {
  if ("error" in r) assert.fail(r.error);
  return r.filas;
};

test("lee las tres filas de worker, con el primer effort y el matiz", () => {
  assert.deepEqual(ok(parsearRouting(EJEMPLO)), [
    { rol: "codigo", modelo: "claude-opus-5-5", effort: "medium", nota: "medium acotado, high si toca varias partes" },
    { rol: "explorar", modelo: "claude-sonnet-5-5", effort: "high", nota: "high; xhigh auditoría grande" },
    { rol: "diseno", modelo: "claude-fable-5-1", effort: "high", nota: "high" },
  ]);
});

test("sin cambios reales, el texto queda byte a byte igual", () => {
  const mismos: Cambio[] = [
    { rol: "codigo", modelo: "claude-opus-5-5", effort: "medium" },
    { rol: "explorar", modelo: "claude-sonnet-5-5", effort: "high" },
    { rol: "diseno", modelo: "claude-fable-5-1", effort: "high" },
  ];
  assert.equal(escribirRouting(EJEMPLO, mismos), EJEMPLO);
});

test("reescribe sólo la fila que cambia", () => {
  const nuevo = escribirRouting(EJEMPLO, [{ rol: "diseno", modelo: "claude-opus-5-5", effort: "xhigh" }]);
  const antes = EJEMPLO.split("\n");
  const despues = nuevo.split("\n");
  assert.equal(despues.length, antes.length);
  const distintas = antes.flatMap((l, i) => (l === despues[i] ? [] : [i]));
  assert.deepEqual(distintas, [antes.indexOf("| Frontend / diseño visual | `claude-fable-5-1` | high |")]);
  assert.equal(despues[distintas[0]], "| Frontend / diseño visual | `claude-opus-5-5` | xhigh |");
});

test("si sólo cambia el modelo, el matiz del effort se queda", () => {
  const nuevo = escribirRouting(EJEMPLO, [{ rol: "codigo", modelo: "claude-sonnet-5-5", effort: "medium" }]);
  assert.match(nuevo, /^\| Worker que escribe código \| `claude-sonnet-5-5` \| medium acotado, high si toca varias partes \|$/m);
});

test("lo decide el líder: se escribe, se lee y se puede volver a un modelo", () => {
  const sin = escribirRouting(EJEMPLO, [{ rol: "explorar", modelo: null, effort: null }]);
  assert.match(sin, /^\| Worker exploración \(leer repo, auditar; `--leer`\) \| lo decide el líder \| — \|$/m);
  assert.deepEqual(ok(parsearRouting(sin))[1], { rol: "explorar", modelo: null, effort: null, nota: "—" });
  const con = escribirRouting(sin, [{ rol: "explorar", modelo: "claude-sonnet-5-5", effort: "high" }]);
  assert.match(con, /^\| Worker exploración \(leer repo, auditar; `--leer`\) \| `claude-sonnet-5-5` \| high \|$/m);
});

test("respeta CRLF", () => {
  const crlf = EJEMPLO.replace(/\n/g, "\r\n");
  const nuevo = escribirRouting(crlf, [{ rol: "diseno", modelo: "claude-opus-5-5", effort: "high" }]);
  assert.equal(nuevo, escribirRouting(EJEMPLO, [{ rol: "diseno", modelo: "claude-opus-5-5", effort: "high" }]).replace(/\n/g, "\r\n"));
});

test("sin marcadores (instalación nueva): lee 'lo decide el líder' y escribe el bloque sólo si hay algo que guardar", () => {
  const plantilla = "# Líder de Trama\n\nTexto del líder.\n";
  const filas = ok(parsearRouting(plantilla));
  assert.deepEqual(filas.map((f) => [f.rol, f.modelo, f.effort]), [["codigo", null, null], ["explorar", null, null], ["diseno", null, null]]);
  // Sin cambios reales, el archivo no se toca.
  assert.equal(escribirRouting(plantilla, [{ rol: "codigo", modelo: null, effort: null }]), plantilla);
  const nuevo = escribirRouting(plantilla, [{ rol: "codigo", modelo: "claude-opus-5-5", effort: "high" }]);
  assert.ok(nuevo.startsWith(plantilla.trimEnd() + "\n\n"));
  assert.equal((nuevo.match(/<!-- trama:routing/g) ?? []).length, 1);
  const r = ok(parsearRouting(nuevo));
  assert.deepEqual([r[0].modelo, r[0].effort, r[1].modelo], ["claude-opus-5-5", "high", null]);
  // Un archivo vacío también sirve, y con CRLF el bloque sigue en CRLF.
  assert.equal(ok(parsearRouting(""))[2].modelo, null);
  assert.ok(!/[^\r]\n/.test(escribirRouting("a\r\nb\r\n", [{ rol: "diseno", modelo: "claude-opus-5-5", effort: "low" }])));
});

test("con un solo marcador el archivo está roto: error y nada que escribir", () => {
  const roto = EJEMPLO.replace("<!-- /trama:routing -->\n", "");
  assert.match(enEs((parsearRouting(roto) as { error: string }).error), /No encuentro la tabla de routing/);
  assert.throws(() => escribirRouting(roto, [{ rol: "codigo", modelo: "claude-opus-5-5", effort: "high" }]), lanza(/No encuentro/));
});

test("formatos inesperados: error", () => {
  const casos: [string, RegExp][] = [
    [EJEMPLO.replace("<!-- /trama:routing -->", "<!-- /trama:routing -->\n<!-- /trama:routing -->"), /una vez cada uno/],
    [EJEMPLO.replace("| Frontend / diseño visual | `claude-fable-5-1` | high |\n", ""), /Falta la fila "Frontend/],
    [EJEMPLO.replace("| high |\n<!-- /", "| high | extra |\n<!-- /"), /4 columnas/],
    [EJEMPLO.replace("`claude-fable-5-1`", "Fable 5.1"), /modelo que no entiendo/],
    [EJEMPLO.replace("| Frontend / diseño visual | `claude-fable-5-1` | high |", "| Frontend / diseño visual | `claude-fable-5-1` | high |\n| Frontend / diseño visual | x | high |"), /2 veces/],
  ];
  for (const [texto, error] of casos) assert.match(enEs((parsearRouting(texto) as { error: string }).error), error);
});

test("valida lo que llega para escribir", () => {
  assert.throws(() => escribirRouting(EJEMPLO, [{ rol: "codigo", modelo: "x | y", effort: "high" }]), lanza(/modelo raro/));
  assert.throws(() => escribirRouting(EJEMPLO, [{ rol: "codigo", modelo: "claude-opus-5-5", effort: "mucho" }]), lanza(/effort raro/));
});

test("guardarRouting escribe atómico y sigue el symlink; con error no toca el archivo", { skip: soloPosix("symlinks") }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "routing-"));
  const real = path.join(dir, "real.md");
  const link = path.join(dir, "CLAUDE.md");
  writeFileSync(real, EJEMPLO);
  symlinkSync(real, link);

  const r = await guardarRouting([{ rol: "codigo", modelo: "claude-opus-5-5", effort: "high" }], link);
  assert.equal(ok(r)[0].effort, "high");
  assert.equal(readFileSync(real, "utf8"), escribirRouting(EJEMPLO, [{ rol: "codigo", modelo: "claude-opus-5-5", effort: "high" }]));
  assert.deepEqual(readdirSync(dir).sort(), ["CLAUDE.md", "real.md"]);
  assert.deepEqual(ok(await leerRouting(link))[0].effort, "high");

  const roto = path.join(dir, "roto.md");
  writeFileSync(roto, "# nada\n<!-- trama:routing -->\n");
  const mal = await guardarRouting([{ rol: "codigo", modelo: "claude-opus-5-5", effort: "high" }], roto);
  assert.ok("error" in mal);
  assert.equal(readFileSync(roto, "utf8"), "# nada\n<!-- trama:routing -->\n");
  assert.ok("error" in (await leerRouting(path.join(dir, "no-existe.md"))));
});

test("guardarRouting: sin CLAUDE.md lo crea con el bloque; y reemplazar conserva el modo del original", { skip: soloPosix("modo de archivo") }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "routing-"));
  const nuevo = path.join(dir, "CLAUDE.md");
  const r = await guardarRouting([{ rol: "codigo", modelo: "claude-opus-5-5", effort: "high" }], nuevo);
  assert.equal(ok(r)[0].effort, "high");
  assert.ok(readFileSync(nuevo, "utf8").includes("trama:routing"));
  // Sin cambios que hacer no inventa un archivo vacío.
  const otro = path.join(dir, "otro.md");
  await guardarRouting([], otro);
  assert.equal(existsSync(otro), false);
  // El modo del original se conserva.
  const privado = path.join(dir, "privado.md");
  writeFileSync(privado, EJEMPLO, { mode: 0o600 });
  chmodSync(privado, 0o600);
  await guardarRouting([{ rol: "codigo", modelo: "claude-opus-5-5", effort: "high" }], privado);
  assert.equal(statSync(privado).mode & 0o777, 0o600);
});
