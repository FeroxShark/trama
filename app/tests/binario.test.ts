// node --test tests/  (Node corre el TypeScript directo, sin compilar)
import { test } from "node:test";
import { soloPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { entornoAgy, entornoPa, pathConLocal, resolverPa } from "../electron/binario.ts";

const HOME = "/home/ana";
const hay = (...fs: string[]) => (f: string) => fs.includes(f);

test("HILOS_PA gana siempre", () => {
  assert.equal(resolverPa({ HILOS_PA: "/tmp/pa-falso.sh", PATH: "/usr/bin" }, HOME, hay("/usr/bin/pa")), "/tmp/pa-falso.sh");
});

test("pa del PATH si está", { skip: soloPosix("rutas y PATH de Linux (/home/ana, :)") }, () => {
  assert.equal(resolverPa({ PATH: "/usr/bin:/opt/bin" }, HOME, hay("/opt/bin/pa", "/home/ana/.local/bin/pa")), "/opt/bin/pa");
});

test("sin pa en el PATH (sesión gráfica): ~/.local/bin/pa", { skip: soloPosix("rutas y PATH de Linux (/home/ana, :)") }, () => {
  assert.equal(resolverPa({ PATH: "/usr/bin" }, HOME, hay("/home/ana/.local/bin/pa")), "/home/ana/.local/bin/pa");
  assert.equal(resolverPa({}, HOME, hay("/home/ana/.local/bin/pa")), "/home/ana/.local/bin/pa");
});

test("en ningún lado: pa pelado (el error de spawn lo dice)", () => {
  assert.equal(resolverPa({ PATH: "/usr/bin" }, HOME, hay()), "pa");
});

test("el PATH de pa lleva ~/.local/bin adelante, una sola vez", { skip: soloPosix("rutas y PATH de Linux (/home/ana, :)") }, () => {
  assert.equal(pathConLocal({ PATH: "/usr/bin:/bin" }, HOME), "/home/ana/.local/bin:/usr/bin:/bin");
  assert.equal(pathConLocal({ PATH: "/usr/bin:/home/ana/.local/bin" }, HOME), "/home/ana/.local/bin:/usr/bin");
  assert.equal(pathConLocal({}, HOME), "/home/ana/.local/bin");
  const env = entornoPa({ PATH: "/usr/bin", OTRA: "1" }, HOME);
  assert.equal(env.OTRA, "1");
  assert.equal(env.PATH, "/home/ana/.local/bin:/usr/bin");
});

test("el entorno de agy trae la carpeta del pa encontrado, tras ~/.local/bin y sin repetirla", { skip: soloPosix("rutas y PATH de Linux (/home/ana, :)") }, () => {
  // pa en una carpeta que el PATH de la app no tiene (HILOS_PA): se agrega para que el líder de Gemini lo llame.
  assert.equal(entornoAgy({ HILOS_PA: "/opt/trama/pa", PATH: "/usr/bin" }, HOME, hay()).PATH, "/home/ana/.local/bin:/opt/trama:/usr/bin");
  // pa en ~/.local/bin: nada de más.
  assert.equal(entornoAgy({ PATH: "/usr/bin" }, HOME, hay("/home/ana/.local/bin/pa")).PATH, "/home/ana/.local/bin:/usr/bin");
  // pa en una carpeta que ya estaba en el PATH: pasa adelante, una sola vez.
  assert.equal(entornoAgy({ PATH: "/usr/bin:/opt/bin" }, HOME, hay("/opt/bin/pa")).PATH, "/home/ana/.local/bin:/opt/bin:/usr/bin");
  // sin pa en ningún lado: como pathConLocal, y el resto del entorno intacto.
  const e = entornoAgy({ PATH: "/usr/bin", OTRA: "1" }, HOME, hay());
  assert.equal(e.PATH, "/home/ana/.local/bin:/usr/bin");
  assert.equal(e.OTRA, "1");
});
