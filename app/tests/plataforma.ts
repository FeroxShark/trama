// Ayudas para las pruebas que sólo tienen sentido en Linux/macOS: las que corren bash, /bin/sh, python3, scripts con
// shebang, leen /proc, miran modos de archivo (chmod), crean symlinks o mandan señales POSIX.
//
//   import { soloPosix } from "./plataforma.ts";
//   test("x", { skip: soloPosix("usa bash") }, () => { ... });
//
// Para un archivo entero: `import { testPosix as test } from "./plataforma.ts"` en lugar de `test` de node:test; cada
// `test(...)` del archivo queda salteado en Windows y corre igual que antes en Linux.
//
// TRAMA_SIMULAR_WIN32=1 hace que todo esto se comporte como en Windows aunque se corra en Linux, para ver qué se
// saltearía (`TRAMA_SIMULAR_WIN32=1 npm test` y mirar «# skipped»; la diferencia contra el npm test común son las pruebas
// POSIX). No cambia `process.platform`: sólo lo que devuelven estas ayudas.
import { test as nodeTest } from "node:test";

/** `true` en Linux/macOS (y siempre que no se simule Windows). */
export const POSIX: boolean = process.platform !== "win32" && process.env.TRAMA_SIMULAR_WIN32 !== "1";

/** Para `{ skip: soloPosix("motivo") }`: el motivo en Windows, `false` en el resto. */
export const soloPosix = (motivo = "necesita herramientas POSIX"): string | false => (POSIX ? false : `sólo POSIX: ${motivo}`);

type Opciones = NonNullable<Parameters<typeof nodeTest>[1]> & object;
type Cuerpo = Parameters<typeof nodeTest>[2];

/** `test` de node:test que en Windows queda salteado (si ya traía un `skip`, se respeta). */
export function testPosix(nombre: string, a?: Opciones | Cuerpo, b?: Cuerpo) {
  const opciones: Opciones = typeof a === "function" || a === undefined ? {} : a;
  const cuerpo = (typeof a === "function" ? a : b) as Cuerpo;
  const skip = opciones.skip || soloPosix();
  return nodeTest(nombre, { ...opciones, skip }, cuerpo);
}
