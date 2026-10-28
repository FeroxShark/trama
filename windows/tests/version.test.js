"use strict";
// La versión de la carcasa sale de app/package.json (src/version.js). Se prueba con un repo de mentira con esa forma.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sincronizarVersion } = require("../src/version.js");

function repoDeMentira(versionApp) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "trama-version-"));
  const app = path.join(raiz, "app");
  const windows = path.join(raiz, "windows");
  fs.mkdirSync(app);
  fs.mkdirSync(windows);
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "trama", version: versionApp }, null, 2) + "\n");
  fs.writeFileSync(path.join(windows, "package.json"), JSON.stringify({ name: "trama-windows", version: "0.1.4" }, null, 2) + "\n");
  fs.writeFileSync(
    path.join(windows, "package-lock.json"),
    JSON.stringify({ name: "trama-windows", version: "0.1.2", lockfileVersion: 3, packages: { "": { name: "trama-windows", version: "0.1.2" } } }, null, 2) + "\n",
  );
  return { app, windows, raiz };
}

test("copia la versión de app/package.json a package.json y al package-lock.json (raíz y paquete vacío)", () => {
  const { app, windows, raiz } = repoDeMentira("0.2.13");
  try {
    assert.equal(sincronizarVersion({ app, windows }), "0.2.13");
    assert.equal(JSON.parse(fs.readFileSync(path.join(windows, "package.json"), "utf8")).version, "0.2.13");
    const lock = JSON.parse(fs.readFileSync(path.join(windows, "package-lock.json"), "utf8"));
    assert.equal(lock.version, "0.2.13");
    assert.equal(lock.packages[""].version, "0.2.13");
    assert.equal(lock.name, "trama-windows", "no toca lo demás");
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test("si ya coincide no reescribe el package.json", () => {
  const { app, windows, raiz } = repoDeMentira("0.2.13");
  try {
    sincronizarVersion({ app, windows });
    const antes = fs.statSync(path.join(windows, "package.json")).mtimeMs;
    sincronizarVersion({ app, windows });
    assert.equal(fs.statSync(path.join(windows, "package.json")).mtimeMs, antes);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test("una versión de app que no es semver corta el armado sin tocar windows/", () => {
  const { app, windows, raiz } = repoDeMentira("0.2.13-dev más");
  try {
    assert.throws(() => sincronizarVersion({ app, windows }), /no tiene una versión válida/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(windows, "package.json"), "utf8")).version, "0.1.4");
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});
