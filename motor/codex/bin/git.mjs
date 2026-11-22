// Guardia de git de los workers de codex y dsh/opencode en Windows (git.cmd la llama con node). Ver guardias.mjs.
import { ejecutar, guardiaGit } from "./guardias.mjs";
process.exit(ejecutar("git", guardiaGit, process.argv.slice(2)));
