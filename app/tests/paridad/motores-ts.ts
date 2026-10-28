// El lado B de la paridad de los otros motores (casos-motores.ts): los mismos subcomandos que motores-bash.sh, con
// app/electron/cli/pa/motores. Imprime lo mismo que el bash para que el arnés compare salida, código y archivos.
import { readFileSync } from "node:fs";
import { dshClave, localDe } from "../../electron/cli/pa/motores/chequeo.ts";
import { armarLlamada } from "../../electron/cli/pa/motores/llamada.ts";
import {
  CODEX_MODELOS,
  DSH_MODELOS,
  GEMINI_MODELOS,
  OC_MODELOS,
  calza,
  codexEquivalente,
  dshGratis,
  dshModeloDe,
  dshProveedor,
  esCodex,
  esDsh,
  esGemini,
  esLocal,
  esOpencode,
  geminiEquivalente,
  opencodeGratis,
  proveedorCuentaDe,
  proveedorDeModelo,
} from "../../electron/cli/pa/motores/modelos.ts";
import { privacidad, secretoEn, secretoTrackeado } from "../../electron/cli/pa/motores/privacidad.ts";
import { agentsMdBloque } from "../../electron/cli/pa/motores/prompt.ts";
import { agyAJson, colaDe, comoJq, codexAJson, latir } from "../../electron/cli/pa/motores/salida.ts";

const out = (s: string) => process.stdout.write(s);
const io = { err: (s: string) => process.stderr.write(s) };
const linea = (s: string) => (s ? out(`${s}\n`) : undefined);
const leerONull = (f: string) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};
const sinFinal = (f: string) => (leerONull(f) ?? "").replace(/\n+$/, "");

const [sub = "", ...a] = process.argv.slice(2);
const env = process.env;
let rc = 0;
switch (sub) {
  case "agy-a-json": {
    const t = leerONull(a[0]!);
    if (t !== null) out(comoJq(agyAJson(t, colaDe(a[1]!), a[2]!, Number(a[3] || 0))) + "\n");
    else rc = 2;
    break;
  }
  case "codex-a-json": {
    const t = leerONull(a[0]!);
    if (t !== null) out(comoJq(codexAJson(t, colaDe(a[1]!), a[2]!, Number(a[3] || 0), sinFinal(a[4]!), Number(a[5] || 0))) + "\n");
    else rc = 2;
    break;
  }
  case "secreto-en":
    linea(secretoEn(a[0]!));
    break;
  case "secreto-trackeado":
    linea(secretoTrackeado(a[0]!));
    break;
  case "privacidad":
    linea(privacidad(a[0]!, a[1]!));
    break;
  case "equivalente":
    linea(geminiEquivalente(a[0]!));
    linea(codexEquivalente(a[0]!));
    break;
  case "clasificar": {
    const m = a[0]!;
    const b = (x: boolean) => (x ? "1" : "0");
    out(`proveedor=${proveedorDeModelo(m)}\nproveedor_cuenta=${proveedorCuentaDe(m)}\n`);
    out(`es_gemini=${b(esGemini(m))}\nes_codex=${b(esCodex(m))}\nes_dsh=${b(esDsh(m))}\nes_opencode=${b(esOpencode(m))}\nes_local=${b(esLocal(m))}\n`);
    if (esDsh(m)) out(`dsh_proveedor=${dshProveedor(m)}\ndsh_modelo=${dshModeloDe(m)}\ndsh_gratis=${b(dshGratis(m))}\n`);
    if (esOpencode(m)) out(`opencode_gratis=${b(opencodeGratis(m))}\n`);
    for (const [n, re] of [["GEMINI_MODELOS", GEMINI_MODELOS], ["CODEX_MODELOS", CODEX_MODELOS], ["DSH_MODELOS", DSH_MODELOS], ["OC_MODELOS", OC_MODELOS]] as const) if (calza(re, m)) out(`calza=${n}\n`);
    break;
  }
  case "clave": {
    const v = dshClave(a[0]!, env);
    out(`${v}rc=${v ? 0 : 1}\n`);
    break;
  }
  case "local-de": {
    const l = localDe(a[0]!, null, env);
    out(`${l.url}\t${l.modelo}\t${l.nombre}\n`);
    break;
  }
  case "latido":
    latir(a[0] === "codex" ? "codex" : esOpencode(a[1]!) ? "opencode" : "dsh", a[2]!, a[3]!);
    out(leerONull(a[3]!) ?? "");
    break;
  case "bloque":
    out(agentsMdBloque(a, env, io));
    break;
  case "armar": {
    const [motor, modelo, rutaTrabajo, ruta, rama, dir, ts, hb, mapaProy, leer, actualizar, maxTurns, ocEffort] = a as string[];
    const l = armarLlamada({
      motor: motor as "agy" | "codex" | "dsh",
      modelo: modelo!,
      contrato: env.P_CONTRATO ?? "",
      prompt: env.P_PROMPT ?? "",
      rutaTrabajo: rutaTrabajo!,
      ruta: ruta!,
      rama: rama!,
      dir: dir!,
      ts: ts!,
      hb: hb!,
      mapaProy: mapaProy!,
      leer: leer === "1",
      actualizar: !!actualizar,
      maxTurns: maxTurns || undefined,
      ocEffort: ocEffort || undefined,
      env,
      io,
    });
    // El bash arma sólo los argumentos: sin `node <runner>` adelante ni el `--tarea-archivo` que agrega al lanzar.
    const args = l.json === "runner" ? l.args.slice(1, -2) : l.args;
    out(JSON.stringify({ args, dsh_prompt: l.tareaArchivo?.texto ?? "", transcript: l.transcript }, null, 2) + "\n");
    for (const k of ["PA_AGY_HB", "PA_AGY_RAIZ", "PA_AGY_PPAL", "PA_AGY_RAMA", "PA_AGY_MAPA", "PA_AGY_MODO", "PA_AGY_REBASE", "PA_MAX_TURNS"])
      if (l.exporta[k] !== undefined) out(`${k}=${l.exporta[k]}\n`);
    break;
  }
  default:
    process.stderr.write("uso: motores-ts.ts <subcomando> ...\n");
    rc = 2;
}
process.exitCode = rc;
