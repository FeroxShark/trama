// DeepSeek Harness en Windows: `npm i -g --prefix <casa>\.local` deja `dsh.cmd` en la RAÍZ de ese prefijo (no en `bin\`), y el
// `npm` global en `%APPDATA%\npm`. Detección, instalación, "Volver a mirar" y el comando que se muestra, con la plataforma simulada
// (process.platform) y un disco falso. Corre en cualquier sistema.
import assert from "node:assert/strict";
import { test } from "node:test";
import { paraLanzar } from "../electron/binario.ts";
import { PAQUETE_DSH, SCRIPTS_DSH, comandoInstalarDsh, estadoDsh, instalarDsh } from "../electron/dsh-ajustes.ts";
import { prefijoDsh, resolverDsh } from "../electron/dsh.ts";
import { type DepsDeteccion, detectarArneses } from "../electron/locales-deteccion.ts";

const hay = (...fs: string[]) => (f: string) => fs.includes(f);
const CASA = "C:\\Users\\Ana";
const APPDATA_NPM = `${CASA}\\AppData\\Roaming\\npm`;
const DSH_RAIZ = `${CASA}\\.local\\dsh.cmd`;
const NPM = `${APPDATA_NPM}\\npm.cmd`;
const WENV = { USERPROFILE: CASA, APPDATA: `${CASA}\\AppData\\Roaming`, Path: `C:\\Windows\\System32;${APPDATA_NPM}` };

/** Corre `f` con `process.platform` simulado y lo restaura aunque tire. */
async function conPlataforma<T>(plat: string, f: () => Promise<T> | T): Promise<T> {
  const antes = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: plat });
  try {
    return await f();
  } finally {
    Object.defineProperty(process, "platform", antes);
  }
}

/** Un disco falso mutable: lo que `npm` deja al instalar se ve en la siguiente mirada, sin reiniciar. */
const discoFalso = (...archivos: string[]) => new Set(archivos);

test("dsh en Windows: se encuentra en la raíz del prefijo de instalación (.local\\dsh.cmd)", () => {
  assert.equal(prefijoDsh(CASA, "win32"), `${CASA}\\.local`);
  assert.equal(resolverDsh(WENV, CASA, hay(DSH_RAIZ), "win32"), DSH_RAIZ);
  // lo de antes sigue valiendo: `bin\` y el global de npm
  assert.equal(resolverDsh(WENV, CASA, hay(`${CASA}\\.local\\bin\\dsh.cmd`), "win32"), `${CASA}\\.local\\bin\\dsh.cmd`);
  assert.equal(resolverDsh(WENV, CASA, hay(`${APPDATA_NPM}\\dsh.cmd`), "win32"), `${APPDATA_NPM}\\dsh.cmd`);
  assert.equal(resolverDsh(WENV, CASA, hay(), "win32"), "dsh");
  assert.equal(resolverDsh({ ...WENV, HILOS_DSH: "X:\\dsh.cmd" }, CASA, hay(DSH_RAIZ), "win32"), "X:\\dsh.cmd");
});

test("dsh en Linux no mira la raíz de ~/.local (sigue igual)", () => {
  assert.equal(resolverDsh({ PATH: "" }, "/h", hay("/h/.local/dsh"), "linux"), "dsh");
  assert.equal(resolverDsh({ PATH: "" }, "/h", hay("/h/.local/bin/dsh"), "linux"), "/h/.local/bin/dsh");
  assert.equal(comandoInstalarDsh("/h", "linux"), `npm i -g --prefix ~/.local ${SCRIPTS_DSH} ${PAQUETE_DSH}`);
});

test("el comando que se muestra en Windows usa la ruta real de la casa, sin ~", () => {
  const c = comandoInstalarDsh(CASA, "win32");
  assert.equal(c, `npm i -g --prefix ${CASA}\\.local ${SCRIPTS_DSH} ${PAQUETE_DSH}`);
  assert.ok(!c.includes("~"));
  // con espacios en la casa, va entre comillas
  assert.equal(comandoInstalarDsh("C:\\Users\\Ana Pérez", "win32"), `npm i -g --prefix "C:\\Users\\Ana Pérez\\.local" ${SCRIPTS_DSH} ${PAQUETE_DSH}`);
});

test("dsh se lanza en Windows por cmd.exe (un .cmd no se ejecuta directo)", () => {
  const l = paraLanzar(DSH_RAIZ, ["--version"], {}, "win32");
  assert.equal(l.file, "cmd.exe");
  assert.equal(l.verbatim, true);
  assert.ok(l.args.includes("/c"));
});

test("estado en Windows: instalado con dsh.cmd en la raíz del prefijo, versión y npm del PATH", async () => {
  const disco = discoFalso(NPM, DSH_RAIZ);
  const llamadas: string[] = [];
  const d = {
    env: WENV as NodeJS.ProcessEnv,
    home: CASA,
    existe: (f: string) => disco.has(f),
    correr: async (bin: string) => {
      llamadas.push(bin);
      return "0.2.1\n";
    },
  };
  const e = await conPlataforma("win32", () => estadoDsh(d, {}));
  assert.equal(e.instalado, true);
  assert.equal(e.versionDsh, "0.2.1");
  assert.equal(e.hayNpm, true);
  assert.equal(e.comando, comandoInstalarDsh(CASA, "win32"));
  assert.deepEqual(llamadas, [DSH_RAIZ]);
});

test("instalar en Windows: --prefix con la ruta real, y 'Volver a mirar' lo ve sin reiniciar", async () => {
  const disco = discoFalso(NPM);
  const llamadas: string[][] = [];
  const d = {
    env: WENV as NodeJS.ProcessEnv,
    home: CASA,
    existe: (f: string) => disco.has(f),
    correr: async (bin: string, args: string[]) => {
      llamadas.push([bin, ...args]);
      if (bin === "npm") disco.add(DSH_RAIZ); // npm deja dsh.cmd en la raíz del prefijo
      return bin === "npm" ? "" : "0.2.1\n";
    },
  };
  await conPlataforma("win32", async () => {
    assert.equal((await estadoDsh(d, {})).instalado, false, "antes de instalar no está");
    const e = await instalarDsh(d);
    assert.equal(e.instalado, true, "después de instalar sale instalado en la misma sesión");
    assert.equal(e.versionDsh, "0.2.1");
  });
  assert.deepEqual(llamadas[0], ["npm", "install", "-g", "--prefix", `${CASA}\\.local`, SCRIPTS_DSH, PAQUETE_DSH]);
});

test("detección de arneses en Windows: dsh.cmd en la raíz de .local, con su versión; sin él, no instalado", async () => {
  const deps = (disco: Set<string>): DepsDeteccion =>
    ({
      home: CASA,
      env: WENV as NodeJS.ProcessEnv,
      existe: (f: string) => disco.has(f),
      ejecutar: async (bin: string, args: string[]) => {
        if (bin === DSH_RAIZ && args[0] === "--version") return "0.2.1\n";
        return "";
      },
      leer: async () => null,
      listarDir: async () => [],
      stat: async () => null,
      pedirJson: async () => null,
      puertoAbierto: async () => false,
    }) as unknown as DepsDeteccion;
  const disco = discoFalso(NPM);
  const dshDe = async () => (await detectarArneses(deps(disco), "win32")).find((a) => a.id === "dsh")!;

  const antes = await conPlataforma("win32", dshDe);
  assert.equal(antes.instalado, false, "sin dsh.cmd no figura instalado");
  assert.equal(antes.comando, comandoInstalarDsh(CASA, "win32"));

  disco.add(DSH_RAIZ);
  const despues = await conPlataforma("win32", dshDe);
  assert.equal(despues.instalado, true, "'Volver a mirar' lo detecta sin reiniciar");
  assert.equal(despues.version, "0.2.1");
});
