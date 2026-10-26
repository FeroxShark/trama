// Guardar el plan y la red de seguridad desde Ajustes (electron/ajustes-editar.ts): cada valor donde ya vive (`pa --plan`
// y `autoCompactWindow` de settings.json), validado antes de escribir nada y sin tocar el resto del archivo.
// Siempre sobre un settings.json de ejemplo y un `pa` de mentira: nunca el ~/.claude real.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-ajustes-editar-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
process.env.HILOS_STATE = tmp;
process.env.HILOS_CLAUDE_SETTINGS = path.join(tmp, "settings-que-no-se-toca.json");

const { conRed, guardarAjustes, validarCambio } = await import("../electron/ajustes-editar.ts");
const { cambiarIdioma, textoMain } = await import("../src/i18n/index.ts");

const enEs = (s: string) => {
  cambiarIdioma("es");
  try {
    return textoMain(s);
  } finally {
    cambiarIdioma("en");
  }
};
const lanza = (re: RegExp) => (e: unknown) => re.test(enEs((e as Error).message));

const SETTINGS = `{
  "model": "opus",
  "autoCompactWindow": 300000,
  "hooks": {
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "x"
          }
        ]
      }
    ]
  }
}
`;
let n = 0;
/** Un settings.json de ejemplo y un `pa` que anota lo que le piden (y contesta `rc`). */
function entorno(texto: string | null = SETTINGS, rc = 0) {
  const ruta = path.join(tmp, `settings-${++n}.json`);
  if (texto !== null) writeFileSync(ruta, texto);
  const llamadas: string[][] = [];
  const pa = async (args: string[]) => {
    llamadas.push(args);
    return { rc, dijo: rc ? "pa: no va" : "plan: " + args[1] };
  };
  return { ruta, llamadas, pa, leer: () => readFileSync(ruta, "utf8") };
}

// El archivo se reescribe como lo hace Claude Code (JSON.stringify con la sangría que ya tenía): las claves y su orden quedan.
test("guardar la red cambia sólo autoCompactWindow y deja el resto como estaba", async () => {
  const e = entorno();
  await guardarAjustes({ red_seguridad: 250_000 }, e.pa, e.ruta);
  assert.deepEqual(e.llamadas, [], "sin plan nuevo no se llama a pa");
  assert.equal(e.leer(), SETTINGS.replace("300000", "250000"));
  assert.deepEqual(readdirSync(tmp).filter((f) => f.endsWith(".tmp")), [], "no queda el temporal");
});

test("guardar el plan lo pide con `pa --plan` y no toca el settings", async () => {
  const e = entorno();
  await guardarAjustes({ plan: "pro" }, e.pa, e.ruta);
  assert.deepEqual(e.llamadas, [["--plan", "pro"]]);
  assert.equal(e.leer(), SETTINGS);
});

test("los dos juntos: el plan y la red", async () => {
  const e = entorno();
  await guardarAjustes({ plan: "max", red_seguridad: 400_000 }, e.pa, e.ruta);
  assert.deepEqual(e.llamadas, [["--plan", "max"]]);
  assert.equal(JSON.parse(e.leer()).autoCompactWindow, 400_000);
});

test("la red en null saca el autoCompactWindow; si no estaba, el archivo ni se reescribe", async () => {
  const e = entorno();
  await guardarAjustes({ red_seguridad: null }, e.pa, e.ruta);
  const j = JSON.parse(e.leer());
  assert.equal("autoCompactWindow" in j, false);
  assert.equal(j.model, "opus");
  const sin = entorno('{"a":1}');
  await guardarAjustes({ red_seguridad: null }, sin.pa, sin.ruta);
  assert.equal(sin.leer(), '{"a":1}');
});

test("conserva la sangría del archivo y crea el settings si no existía", async () => {
  assert.equal(conRed('{\n\t"a": 1\n}\n', 150_000), '{\n\t"a": 1,\n\t"autoCompactWindow": 150000\n}\n');
  assert.equal(conRed('{"a":1}', 150_000), '{"a":1,"autoCompactWindow":150000}\n');
  const e = entorno(null);
  await guardarAjustes({ red_seguridad: 200_000 }, e.pa, e.ruta);
  assert.deepEqual(JSON.parse(e.leer()), { autoCompactWindow: 200_000 });
});

test("escribe a través de un enlace (el settings suele ser un symlink a dotfiles) sin reemplazarlo", async () => {
  const real = path.join(tmp, "real.json");
  writeFileSync(real, SETTINGS);
  const enlace = path.join(tmp, "enlace.json");
  symlinkSync(real, enlace);
  await guardarAjustes({ red_seguridad: 123_000 }, entorno().pa, enlace);
  assert.equal(JSON.parse(readFileSync(real, "utf8")).autoCompactWindow, 123_000);
  assert.equal(readFileSync(enlace, "utf8"), readFileSync(real, "utf8"));
});

test("valida: lo que no vale se rechaza con el motivo y no se escribe nada", async () => {
  const e = entorno();
  const malos: [unknown, RegExp][] = [
    [{ plan: "gold" }, /plan es pro o max/],
    [{ plan: 1 }, /plan es pro o max/],
    [{ red_seguridad: 99_999 }, /entero entre/],
    [{ red_seguridad: 1_000_001 }, /entero entre/],
    [{ red_seguridad: 250_000.5 }, /entero entre/],
    [{ red_seguridad: "250000" }, /entero entre/],
    [{ red_seguridad: NaN }, /entero entre/],
    [{ plan: "pro", routing: [] }, /desconocido/],
    [{ autoCompactWindow: 1 }, /desconocido/],
    [null, /inválido/],
    [[], /inválido/],
    ["pro", /inválido/],
  ];
  for (const [cambio, re] of malos) {
    await assert.rejects(guardarAjustes(cambio, e.pa, e.ruta), lanza(re), JSON.stringify(cambio));
  }
  assert.deepEqual(e.llamadas, []);
  assert.equal(e.leer(), SETTINGS);
  assert.deepEqual(validarCambio({}), {});
});

test("si `pa` no acepta el plan, no se cambia el settings (todo o nada)", async () => {
  const e = entorno(SETTINGS, 2);
  await assert.rejects(guardarAjustes({ plan: "pro", red_seguridad: 111_000 }, e.pa, e.ruta), /pa: no va/);
  assert.equal(e.leer(), SETTINGS);
});

test("si el settings está roto no se pisa ni se llama a pa", async () => {
  const e = entorno("{ esto no es json");
  await assert.rejects(guardarAjustes({ plan: "pro", red_seguridad: 111_000 }, e.pa, e.ruta));
  assert.deepEqual(e.llamadas, []);
  assert.equal(e.leer(), "{ esto no es json");
  const lista = entorno("[1,2]");
  await assert.rejects(guardarAjustes({ red_seguridad: 111_000 }, lista.pa, lista.ruta), /no es un objeto/);
});

test("lo que elige la Bienvenida (250 k) es lo que Ajustes lee después: una sola clave, en tokens", async () => {
  const { leerUmbral } = await import("../electron/contexto.ts");
  const e = entorno(null);
  await guardarAjustes({ red_seguridad: 250_000 }, e.pa, e.ruta);
  assert.equal(JSON.parse(e.leer()).autoCompactWindow, 250_000);
  assert.equal(await leerUmbral(e.ruta), 250_000);
  // y reeditarlo desde Ajustes (otro valor del campo) pisa el mismo valor, no uno aparte
  await guardarAjustes({ red_seguridad: 300_000 }, e.pa, e.ruta);
  assert.equal(await leerUmbral(e.ruta), 300_000);
});
