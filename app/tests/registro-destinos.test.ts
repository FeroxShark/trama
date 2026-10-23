import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// El registry de mentira, antes de importar (registro.ts lee la ruta al cargar).
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-destinos-"));
for (const d of ["zeta", "Alfa", "viejo", "uno", "dos"]) mkdirSync(path.join(tmp, d));
mkdirSync(path.join(tmp, "x", "pa", "worktrees", "ramita"), { recursive: true });
writeFileSync(path.join(tmp, "uno", "shell.qml"), "");
writeFileSync(path.join(tmp, "dos", "shell.qml"), "");
writeFileSync(
  path.join(tmp, "registry.json"),
  JSON.stringify({
    projects: [
      { name: "zeta", path: path.join(tmp, "zeta"), estado: "activo" },
      { name: "Alfa", path: path.join(tmp, "Alfa") },
      // Un alias de la misma carpeta: un solo destino.
      { name: "Alfa grande", path: path.join(tmp, "Alfa") },
      { name: "viejo", path: path.join(tmp, "viejo"), estado: "Retirado" },
      { name: "fantasma", path: path.join(tmp, "no-existe") },
      { name: "ramita", path: path.join(tmp, "x", "pa", "worktrees", "ramita") },
      // Dos scripts con el mismo nombre de archivo: el slug es el mismo, sale una vez.
      { name: "mixer", path: path.join(tmp, "uno", "shell.qml") },
      { name: "flota", path: path.join(tmp, "dos", "shell.qml") },
      { name: "sistema", path: "~" },
    ],
  }),
);
process.env.PROYECTOS_REGISTRY = path.join(tmp, "registry.json");
const { destinos } = await import("../electron/registro.ts");

test("destinos: sólo lo que existe, sin retirados ni worktrees de pa, sin repetidos y por nombre", async () => {
  assert.deepEqual(await destinos(), ["alfa", "shell.qml", "zeta"]);
});
