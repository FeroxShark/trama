// Guardia de cargo de los workers de codex y dsh/opencode en Windows (cargo.cmd la llama con node). Ver guardias.mjs.
import { ejecutar, guardiaCargo } from "./guardias.mjs";
process.exit(ejecutar("cargo", guardiaCargo, process.argv.slice(2)));
