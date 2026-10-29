"use strict";
// Lo que la limpieza (limpieza.js) toca de Windows de verdad: reg.exe y el disco.

const { spawn } = require("node:child_process");
const fs = require("node:fs");

// Rutas con %VARIABLES%, el disco y el registro (HKCU).
function entornoWindows(env = process.env) {
  const reg = (args) =>
    new Promise((resolver) => {
      const p = spawn("reg.exe", args, { windowsHide: true, stdio: "ignore" });
      p.on("error", () => resolver(false));
      p.on("close", (c) => resolver(c === 0));
    });
  return {
    expandir: (ruta) => ruta.replace(/%([^%]+)%/g, (m, n) => env[Object.keys(env).find((k) => k.toLowerCase() === n.toLowerCase()) || ""] ?? m),
    async tipo(ruta) {
      try {
        const st = fs.lstatSync(ruta);
        return st.isSymbolicLink() ? "enlace" : st.isDirectory() ? "carpeta" : "archivo";
      } catch {
        return null;
      }
    },
    borrar: (ruta) => fs.promises.rm(ruta, { recursive: true, force: true, maxRetries: 3 }),
    registro: {
      hay: (clave, valor) => reg(["query", clave, "/v", valor]),
      async quitar(clave, valor) {
        if (!(await reg(["delete", clave, "/v", valor, "/f"]))) throw new Error(`No pude quitar ${clave}\\${valor}`);
      },
    },
  };
}

module.exports = { entornoWindows };
