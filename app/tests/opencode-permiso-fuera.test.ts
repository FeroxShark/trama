// Tests unitarios de conPermisoFuera: paridad entre motor y app.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
// @ts-expect-error: modulo .mjs sin tipos (el runner de pa no tiene TypeScript)
import * as cfg from "../../motor/opencode/config.mjs";
import * as app from "../electron/opencode.ts";

type Implementacion = (
  env?: Record<string, string | undefined>,
  valor?: any,
  home?: string,
  leer?: (f: string) => string
) => Record<string, string | undefined>;

const implementaciones: { nombre: string; fn: Implementacion }[] = [
  { nombre: "motor (motor/opencode/config.mjs)", fn: cfg.conPermisoFuera },
  { nombre: "app (app/electron/opencode.ts)", fn: app.conPermisoFuera },
];

const sinArchivos = (_f: string): string => {
  throw new Error("ENOENT");
};

const DUMMY_HOME = path.join(import.meta.dirname, "falso-home");

test("config sin permission: agrega external_directory con el valor (ask y deny)", () => {
  for (const { nombre, fn } of implementaciones) {
    const resDeny = fn({}, "deny", DUMMY_HOME, sinArchivos);
    assert.ok(resDeny.OPENCODE_CONFIG_CONTENT, `${nombre}: debe fijar OPENCODE_CONFIG_CONTENT`);
    assert.deepEqual(
      JSON.parse(resDeny.OPENCODE_CONFIG_CONTENT!),
      { permission: { external_directory: "deny" } },
      nombre
    );

    const resAsk = fn({}, "ask", DUMMY_HOME, sinArchivos);
    assert.ok(resAsk.OPENCODE_CONFIG_CONTENT, `${nombre}: debe fijar OPENCODE_CONFIG_CONTENT`);
    assert.deepEqual(
      JSON.parse(resAsk.OPENCODE_CONFIG_CONTENT!),
      { permission: { external_directory: "ask" } },
      nombre
    );

    const resVacio = fn({ OPENCODE_CONFIG_CONTENT: "{}" }, "deny", DUMMY_HOME, sinArchivos);
    assert.deepEqual(
      JSON.parse(resVacio.OPENCODE_CONFIG_CONTENT!),
      { permission: { external_directory: "deny" } },
      nombre
    );

    const base = { model: "opencode/algo", autoupdate: false };
    const resOtras = fn({ OPENCODE_CONFIG_CONTENT: JSON.stringify(base) }, "ask", DUMMY_HOME, sinArchivos);
    assert.deepEqual(
      JSON.parse(resOtras.OPENCODE_CONFIG_CONTENT!),
      { model: "opencode/algo", autoupdate: false, permission: { external_directory: "ask" } },
      nombre
    );
  }
});

test("config con otras claves en permission: las conserva y agrega external_directory", () => {
  for (const { nombre, fn } of implementaciones) {
    const configInicial = {
      model: "opencode/big-pickle",
      permission: {
        read: "allow",
        edit: "ask",
        bash: "deny",
      },
    };

    const resDeny = fn({ OPENCODE_CONFIG_CONTENT: JSON.stringify(configInicial) }, "deny", DUMMY_HOME, sinArchivos);
    assert.deepEqual(
      JSON.parse(resDeny.OPENCODE_CONFIG_CONTENT!),
      {
        model: "opencode/big-pickle",
        permission: {
          read: "allow",
          edit: "ask",
          bash: "deny",
          external_directory: "deny",
        },
      },
      `${nombre} (deny)`
    );

    const resAsk = fn({ OPENCODE_CONFIG_CONTENT: JSON.stringify(configInicial) }, "ask", DUMMY_HOME, sinArchivos);
    assert.deepEqual(
      JSON.parse(resAsk.OPENCODE_CONFIG_CONTENT!),
      {
        model: "opencode/big-pickle",
        permission: {
          read: "allow",
          edit: "ask",
          bash: "deny",
          external_directory: "ask",
        },
      },
      `${nombre} (ask)`
    );
  }
});

test("config que ya trae external_directory en OPENCODE_CONFIG_CONTENT: no lo pisa", () => {
  for (const { nombre, fn } of implementaciones) {
    const conAllow = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        permission: { external_directory: "allow", read: "ask" },
      }),
      OTRA_VAR: "conservar",
    };
    const resDeny = fn(conAllow, "deny", DUMMY_HOME, sinArchivos);
    assert.deepEqual(resDeny, conAllow, `${nombre}: debe devolver el env original sin tocar`);
    assert.equal(
      JSON.parse(resDeny.OPENCODE_CONFIG_CONTENT!).permission.external_directory,
      "allow",
      `${nombre}: conserva allow`
    );

    const resAsk = fn(conAllow, "ask", DUMMY_HOME, sinArchivos);
    assert.deepEqual(resAsk, conAllow, `${nombre}: debe devolver el env original sin tocar`);

    const conAsk = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        permission: { external_directory: "ask" },
      }),
    };
    const resDenyDesdeAsk = fn(conAsk, "deny", DUMMY_HOME, sinArchivos);
    assert.deepEqual(resDenyDesdeAsk, conAsk, `${nombre}: no pisa ask con deny`);
  }
});

test("config que ya trae external_directory en archivos globales del disco: no lo pisa", () => {
  const rutaOpencodeJson = path.join(DUMMY_HOME, ".config", "opencode", "opencode.json");
  const rutaOpencodeJsonc = path.join(DUMMY_HOME, ".config", "opencode", "opencode.jsonc");
  const rutaHomeOpencode = path.join(DUMMY_HOME, ".opencode", "opencode.json");
  const rutaCustom = path.join(DUMMY_HOME, "custom", "opencode.json");

  const archivosPrueba = [
    { desc: "OPENCODE_CONFIG personalizado", env: { OPENCODE_CONFIG: rutaCustom }, ruta: rutaCustom },
    { desc: "config base opencode.json", env: {}, ruta: rutaOpencodeJson },
    { desc: "config base opencode.jsonc", env: {}, ruta: rutaOpencodeJsonc },
    { desc: "config home opencode.json", env: {}, ruta: rutaHomeOpencode },
  ];

  for (const { desc, env, ruta } of archivosPrueba) {
    for (const { nombre, fn } of implementaciones) {
      const leerConDoble = (f: string) =>
        f === ruta ? "{\n  \"permission\": {\n    \"external_directory\": \"allow\"\n  }\n}" : sinArchivos(f);
      const rDoble = fn(env, "deny", DUMMY_HOME, leerConDoble);
      assert.deepEqual(rDoble, env, `${nombre} (${desc} comillas dobles): no debe pisar external_directory del archivo`);

      const leerConSimple = (f: string) =>
        f === ruta ? "{\n  'permission': {\n    'external_directory': 'ask'\n  }\n}" : sinArchivos(f);
      const rSimple = fn(env, "deny", DUMMY_HOME, leerConSimple);
      assert.deepEqual(rSimple, env, `${nombre} (${desc} comillas simples): no debe pisar external_directory del archivo`);

      const leerSinExternal = (f: string) =>
        f === ruta ? "{\n  \"model\": \"otro/modelo\"\n}" : sinArchivos(f);
      const rSin = fn(env, "deny", DUMMY_HOME, leerSinExternal);
      assert.ok(rSin.OPENCODE_CONFIG_CONTENT, `${nombre} (${desc} sin external): agrega OPENCODE_CONFIG_CONTENT`);
      assert.deepEqual(
        JSON.parse(rSin.OPENCODE_CONFIG_CONTENT!),
        { permission: { external_directory: "deny" } },
        `${nombre} (${desc} sin external)`
      );
    }
  }
});

test("motor/opencode/config.mjs usa deny como valor por defecto", () => {
  const resDefault = cfg.conPermisoFuera({}, undefined, DUMMY_HOME, sinArchivos);
  assert.ok(resDefault.OPENCODE_CONFIG_CONTENT);
  assert.equal(
    JSON.parse(resDefault.OPENCODE_CONFIG_CONTENT).permission.external_directory,
    "deny"
  );
});

test("paridad estricta entre motor/opencode/config.mjs y app/electron/opencode.ts", () => {
  const casos: Array<{
    desc: string;
    env: Record<string, string | undefined>;
    valor: "ask" | "deny";
    leer?: (f: string) => string;
  }> = [
    { desc: "env vacio con deny", env: {}, valor: "deny" },
    { desc: "env vacio con ask", env: {}, valor: "ask" },
    {
      desc: "variables ajenas conservadas",
      env: { FOO: "bar", PWD: "directorio/de/prueba" },
      valor: "deny",
    },
    {
      desc: "config previa sin permission",
      env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ autoupdate: false, small_model: "m" }) },
      valor: "ask",
    },
    {
      desc: "config previa con permission y otras reglas",
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          permission: { read: "allow", write: "ask" },
        }),
      },
      valor: "deny",
    },
    {
      desc: "config previa que ya tiene external_directory",
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          permission: { external_directory: "allow", edit: "ask" },
        }),
      },
      valor: "deny",
    },
    {
      desc: "archivo en disco con external_directory",
      env: { XDG_CONFIG_HOME: path.join(DUMMY_HOME, ".xdg") },
      valor: "ask",
      leer: (f: string) => (f.includes("opencode.json") ? "{\"external_directory\": \"deny\"}" : sinArchivos(f)),
    },
  ];

  for (const caso of casos) {
    const resCfg = cfg.conPermisoFuera(caso.env, caso.valor, DUMMY_HOME, caso.leer ?? sinArchivos);
    const resApp = app.conPermisoFuera(caso.env, caso.valor, DUMMY_HOME, caso.leer ?? sinArchivos);
    assert.deepEqual(resCfg, resApp, `Paridad fallo en: ${caso.desc}`);
  }
});

test("robustez ante configs invalidas: devuelve el env original sin alterarlo", () => {
  for (const { nombre, fn } of implementaciones) {
    const roto = { OPENCODE_CONFIG_CONTENT: "{no-es-json-valido" };
    assert.deepEqual(fn(roto, "deny", DUMMY_HOME, sinArchivos), roto, `${nombre}: json roto`);

    const array = { OPENCODE_CONFIG_CONTENT: "[1, 2, 3]" };
    assert.deepEqual(fn(array, "deny", DUMMY_HOME, sinArchivos), array, `${nombre}: array`);

    const texto = { OPENCODE_CONFIG_CONTENT: "\"string\"" };
    assert.deepEqual(fn(texto, "deny", DUMMY_HOME, sinArchivos), texto, `${nombre}: string`);

    const nulo = { OPENCODE_CONFIG_CONTENT: "null" };
    assert.deepEqual(fn(nulo, "deny", DUMMY_HOME, sinArchivos), nulo, `${nombre}: null`);

    const permString = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: "allow" }),
    };
    assert.deepEqual(fn(permString, "deny", DUMMY_HOME, sinArchivos), permString, `${nombre}: permission string`);

    const permArray = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: ["read"] }),
    };
    assert.deepEqual(fn(permArray, "deny", DUMMY_HOME, sinArchivos), permArray, `${nombre}: permission array`);

    const permNull = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: null }),
    };
    assert.deepEqual(fn(permNull, "deny", DUMMY_HOME, sinArchivos), permNull, `${nombre}: permission null`);

    const permBool = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: true }),
    };
    assert.deepEqual(fn(permBool, "deny", DUMMY_HOME, sinArchivos), permBool, `${nombre}: permission boolean`);
  }
});
