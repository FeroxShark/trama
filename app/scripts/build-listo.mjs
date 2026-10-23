// Lo último de `npm run build`: deja `dist-electron/.listo` para que trama (electron/relanzar.ts) sepa que el build
// terminó de verdad y avise de la actualización enseguida, en vez de esperar la quietud larga de un build a medias.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist-electron", ".listo"), `${Date.now()}\n`);
