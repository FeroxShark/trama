// ¿Este módulo es el programa que se está ejecutando (`node archivo.js`) y no un `import`? Reemplaza al `import.meta.main`
// (Node 24+) para los entry points de cli/: el mismo archivo sirve de biblioteca para los tests y de herramienta suelta.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function esPrincipal(urlDelModulo: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(urlDelModulo));
  } catch {
    return false;
  }
}
