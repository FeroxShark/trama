// Orquestación de `pa` (motor/bin/pa): brief con aviso, AGENTS.md para los motores que no leen CLAUDE.md, bloque de
// "pasos chicos" para modelos flojos, VERIFICACION (campo `verificado`), lecciones del proyecto y `--auditar`.
// Un `claude` falso (anota su argv y contesta el RESULTADO que le dé FALSO_RESULT) y un `opencode` falso (anota su stdin).
// HOME, estado y registry en un tmp: no toca nada de verdad.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-orq-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const home = path.join(tmp, "home");
const proy = path.join(tmp, "proy");
const estado = path.join(tmp, "estado");
const shim = path.join(tmp, "shim");
for (const d of [path.join(home, ".config", "proyectos"), proy, estado, shim]) mkdirSync(d, { recursive: true });
const git = (...a: string[]) => spawnSync("git", ["-C", proy, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
git("init", "-q", "-b", "main");
git("commit", "-q", "--allow-empty", "-m", "init");
writeFileSync(path.join(home, ".config", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: "demo", path: proy }] }));

const argvFile = path.join(tmp, "argv");
const stdinFile = path.join(tmp, "stdin");
const BIEN = "RESULTADO: hecho\nARCHIVOS: ninguno\nVERIFICACION: npm test\n  ok 12 - todo pasa\nDECISION: nada\nSIGUE: nada";
// claude falso: `--version` para el chequeo de instalación; lo demás vuelca el argv (separado por NUL) y contesta un JSON de resultado.
writeFileSync(
  path.join(shim, "claude"),
  `#!/bin/bash
if [[ "$1" == --version ]]; then echo "9.9.9 (Claude Code)"; exit 0; fi
printf '%s\\0' "$@" > "${argvFile}"
printf '{"type":"result","is_error":false,"result":%s,"session_id":"%s","num_turns":2,"duration_ms":1000,"total_cost_usd":0.01}' "$(printf '%s' "$FALSO_RESULT" | jq -Rs .)" "$(cat /proc/sys/kernel/random/uuid)"
`,
);
// opencode falso: lista tres modelos gratis y, al correr, guarda el prompt (stdin) y contesta un RESULTADO.
const ocFalso = path.join(tmp, "opencode-falso.sh");
writeFileSync(
  ocFalso,
  `#!/bin/bash
if [[ "$1" == models ]]; then printf 'opencode/beam-free\\nopencode/big-pickle\\n'; exit 0; fi
cat > "${stdinFile}"
echo '{"type":"step_start","sessionID":"ses_falso","part":{}}'
echo '{"type":"text","sessionID":"ses_falso","part":{"text":"RESULTADO: listo\\nARCHIVOS: ninguno\\nDECISION: nada\\nSIGUE: nada"}}'
echo '{"type":"step_finish","sessionID":"ses_falso","part":{"reason":"stop","cost":0,"tokens":{"input":5,"output":2,"reasoning":0,"cache":{"read":0,"write":0}}}}'
`,
);
chmodSync(ocFalso, 0o755);
chmodSync(path.join(shim, "claude"), 0o755);
if (spawnSync("sh", ["-c", "command -v uuidgen"]).status !== 0) {
  writeFileSync(path.join(shim, "uuidgen"), "#!/bin/sh\ncat /proc/sys/kernel/random/uuid\n");
  chmodSync(path.join(shim, "uuidgen"), 0o755);
}

function pa(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(path.join(MOTOR, "bin", "pa"), args, {
    encoding: "utf8",
    timeout: 90_000,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      PA_STATE: estado,
      STATE: estado,
      PA_PROJ: path.join(home, "claude-proyectos"),
      PROYECTOS_REGISTRY: path.join(home, ".config", "proyectos", "registry.json"),
      TRAMA_MODELOS: path.join(home, "no-hay.json"),
      TRAMA_CLAVES: path.join(home, "no-hay.env"),
      REPARTO_STATE: path.join(tmp, "rep"),
      REPARTO_CLAUDE: "0",
      PA_REPARTO: "0",
      HILOS_OPENCODE: ocFalso,
      FALSO_RESULT: BIEN,
      PATH: `${MOTOR}/bin:${shim}:${process.env.PATH}`,
      ...env,
    },
  });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const paClaude = (extra: string[], tarea: string, env: Record<string, string> = {}) =>
  pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", ...extra, tarea], env);
/** El system prompt (--append-system-prompt) con el que el `claude` falso fue llamado. */
const contratoClaude = () => {
  const a = readFileSync(argvFile, "utf8").split("\0");
  return a[a.indexOf("--append-system-prompt") + 1] ?? "";
};
const hilos = () => readdirSync(path.join(estado, "proy")).filter((f) => f.endsWith(".hilo")).sort();
const leerHilo = (id: string) => readFileSync(path.join(estado, "proy", id), "utf8");
const BRIEF = "Objetivo: x\nArchivos: a.ts\nListo cuando: pasa el test\nCómo verificar: npm test\nNo tocar: b.ts";

test("brief: sin 'Listo cuando' ni 'Cómo verificar' avisa por stderr y NO bloquea; con el brief completo no avisa", () => {
  const sin = paClaude(["--tipo", "codigo-acotado"], "arreglá el bug del login");
  assert.equal(sin.rc, 0, sin.err);
  assert.match(sin.err, /aviso: a la tarea le falta "Listo cuando".*"Cómo verificar"/);
  const medio = paClaude(["--tipo", "codigo-acotado"], "Objetivo: x\nListo cuando: anda");
  assert.match(medio.err, /le falta "Cómo verificar"/);
  assert.doesNotMatch(medio.err, /le falta .*"Listo cuando"/);
  const completo = paClaude(["--tipo", "codigo-acotado"], BRIEF);
  assert.equal(completo.rc, 0, completo.err);
  assert.doesNotMatch(completo.err, /aviso: a la tarea le falta/);
});

test("brief: el contrato trae VERIFICACION y las secciones del brief; --brief imprime la plantilla; --brief-archivo lee la tarea de un archivo", () => {
  const tpl = pa(["--brief"]);
  assert.equal(tpl.rc, 0);
  for (const s of ["Objetivo:", "Archivos:", "Listo cuando:", "Cómo verificar:", "No tocar:"]) assert.ok(tpl.out.includes(s), s);
  const f = path.join(tmp, "brief.md");
  writeFileSync(f, BRIEF);
  const r = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--tipo", "codigo-acotado", "--brief-archivo", f]);
  assert.equal(r.rc, 0, r.err);
  assert.doesNotMatch(r.err, /aviso: a la tarea le falta/);
  const a = readFileSync(argvFile, "utf8").split("\0");
  assert.equal(a[a.indexOf("-p") + 1]!.startsWith("Objetivo: x"), true, "la tarea es el contenido del archivo");
  const c = contratoClaude();
  assert.match(c, /VERIFICACION: el comando/);
  assert.match(c, /"Listo cuando" es tu criterio de cierre/);
  const mal = pa(["demo", "--sin-jefe", "--brief-archivo", path.join(tmp, "no-existe.md")]);
  assert.equal(mal.rc, 2);
});

test("verificado: un RESULTADO con VERIFICACION (comando + salida) queda verificado=true; sin ella o con 'ninguna' queda false, y la corrida no falla", () => {
  const antes = new Set(hilos());
  const ok = paClaude(["--tipo", "codigo-acotado"], BRIEF);
  assert.equal(ok.rc, 0, ok.err);
  assert.doesNotMatch(ok.out, /SIN VERIFICAR/);
  const idOk = hilos().find((h) => !antes.has(h))!;
  assert.match(leerHilo(idOk), /^verificado=1$/m);
  const jsonOk = JSON.parse(readFileSync(path.join(estado, "proy", idOk.replace(/\.hilo$/, ".json")), "utf8"));
  assert.equal(jsonOk.verificado, true);

  for (const [etiqueta, res] of [
    ["sin sección", "RESULTADO: hecho\nARCHIVOS: ninguno\nDECISION: nada\nSIGUE: nada"],
    ["ninguna", "RESULTADO: hecho\nARCHIVOS: ninguno\nVERIFICACION: ninguna, no había tests\nDECISION: nada\nSIGUE: nada"],
    ["vacía", "RESULTADO: hecho\nARCHIVOS: ninguno\nVERIFICACION:\n\nDECISION: nada\nSIGUE: nada"],
  ] as const) {
    const vistos = new Set(hilos());
    const r = paClaude(["--tipo", "codigo-acotado"], BRIEF, { FALSO_RESULT: res });
    assert.equal(r.rc, 0, `${etiqueta}: ${r.err}`);
    assert.match(r.out, /SIN VERIFICAR/, etiqueta);
    const id = hilos().find((h) => !vistos.has(h))!;
    assert.match(leerHilo(id), /^verificado=0$/m, etiqueta);
    assert.equal(JSON.parse(readFileSync(path.join(estado, "proy", id.replace(/\.hilo$/, ".json")), "utf8")).verificado, false, etiqueta);
  }
  // aparece en pa --estado y en pa --hilos --json
  const est = pa(["--estado"]);
  assert.match(est.out, /SIN VERIFICAR\s+proy/);
  const hs = JSON.parse(pa(["--hilos", "--json"]).out);
  const lista = Array.isArray(hs) ? hs : (hs.hilos ?? []);
  assert.ok(lista.some((h: any) => h.verificado === false), "pa --hilos --json trae verificado");
  assert.ok(lista.some((h: any) => h.verificado === true));
});

test("AGENTS.md: a un motor que no es Claude se le inyecta (AGENTS.md gana a CLAUDE.md, fallback a CLAUDE.md, tope con aviso); a Claude no", () => {
  writeFileSync(path.join(proy, "CLAUDE.md"), "CLAUDE-DEL-PROYECTO: usa tabs");
  const sinAgents = pa(["demo", "--sin-jefe", "-m", "opencode:opencode/big-pickle", "tarea uno"]);
  assert.equal(sinAgents.rc, 0, sinAgents.err);
  assert.match(readFileSync(stdinFile, "utf8"), /CLAUDE-DEL-PROYECTO: usa tabs/, "fallback a CLAUDE.md");

  writeFileSync(path.join(proy, "AGENTS.md"), "AGENTS-DEL-PROYECTO: corré npm test");
  const conAgents = pa(["demo", "--sin-jefe", "-m", "opencode:opencode/big-pickle", "tarea dos"]);
  assert.equal(conAgents.rc, 0, conAgents.err);
  const p2 = readFileSync(stdinFile, "utf8");
  assert.match(p2, /AGENTS-DEL-PROYECTO: corré npm test/);
  assert.doesNotMatch(p2, /CLAUDE-DEL-PROYECTO/, "AGENTS.md gana a CLAUDE.md");

  // tope: 8000 caracteres por default (PA_AGENTS_MAX para el test), con nota de truncado
  writeFileSync(path.join(proy, "AGENTS.md"), "A".repeat(200) + "FINAL-NO-ENTRA");
  const largo = pa(["demo", "--sin-jefe", "-m", "opencode:opencode/big-pickle", "tarea tres"], { PA_AGENTS_MAX: "100" });
  assert.equal(largo.rc, 0, largo.err);
  const p3 = readFileSync(stdinFile, "utf8");
  assert.ok(p3.includes("A".repeat(100)) && !p3.includes("A".repeat(101)), "se corta en el tope");
  assert.doesNotMatch(p3, /FINAL-NO-ENTRA/);
  assert.match(p3, /truncado: .*AGENTS\.md tiene 214 caracteres/);

  // Claude lee CLAUDE.md solo: el contrato NO lleva el AGENTS.md
  writeFileSync(path.join(proy, "AGENTS.md"), "AGENTS-DEL-PROYECTO: corré npm test");
  const cl = paClaude(["--tipo", "codigo-acotado"], BRIEF);
  assert.equal(cl.rc, 0, cl.err);
  assert.doesNotMatch(readFileSync(argvFile, "utf8"), /AGENTS-DEL-PROYECTO/);
  rmSync(path.join(proy, "AGENTS.md"));
  rmSync(path.join(proy, "CLAUDE.md"));
});

test("--agents-md: imprime la plantilla si falta; si existe avisa y no la imprime (salvo --force)", () => {
  const falta = pa(["demo", "--agents-md"]);
  assert.equal(falta.rc, 0, falta.err);
  for (const s of ["# AGENTS.md", "## Build y arranque", "## Tests y verificación", "## Convenciones", "## No tocar"]) assert.ok(falta.out.includes(s), s);
  writeFileSync(path.join(proy, "AGENTS.md"), "ya hay");
  const hay = pa(["demo", "--agents-md"]);
  assert.equal(hay.rc, 0);
  assert.equal(hay.out, "");
  assert.match(hay.err, /ya tiene .*AGENTS\.md/);
  assert.match(pa(["demo", "--agents-md", "--force"]).out, /# AGENTS\.md/);
  rmSync(path.join(proy, "AGENTS.md"));
});

test("modelo de poca inteligencia (< 46 en unidades de AA): el contrato suma 'pasos chicos' y el jefe recibe un aviso; Claude Sonnet (51) no", () => {
  const flojo = pa(["demo", "--sin-jefe", "-m", "opencode:opencode/beam-free", "tarea cuatro"]);
  assert.equal(flojo.rc, 0, flojo.err);
  assert.match(flojo.err, /aviso: 'opencode:opencode\/beam-free' tiene inteligencia 37.3/);
  assert.match(readFileSync(stdinFile, "utf8"), /Trabajá en pasos chicos: un cambio por vez, corré la verificación después de CADA cambio/);
  const bueno = paClaude(["--tipo", "codigo-acotado"], BRIEF, { REPARTO_CLAUDE: "" });
  assert.equal(bueno.rc, 0, bueno.err);
  assert.doesNotMatch(contratoClaude(), /Trabajá en pasos chicos/);
  assert.doesNotMatch(bueno.err, /tiene inteligencia/);
});

test("lecciones: --leccion anota, no repite; se inyectan al contrato; --lecciones las imprime; pasado el tope queda necesita-poda en --estado", () => {
  const vacio = pa(["demo", "--lecciones"]);
  assert.match(vacio.out, /no tiene lecciones/);
  const a = pa(["demo", "--leccion", "no uses npm install: el worker no tiene red"]);
  assert.equal(a.rc, 0, a.err);
  pa(["demo", "--leccion", "no uses npm install: el worker no tiene red"]);
  pa(["demo", "--leccion", "los tests de e2e piden el puerto 3000 libre"]);
  const archivo = path.join(estado, "proy", "lecciones.md");
  const lineas = readFileSync(archivo, "utf8").trim().split("\n");
  assert.equal(lineas.length, 2, "la repetida no se anota dos veces");
  assert.match(lineas[0]!, /^- \d{4}-\d{2}-\d{2} no uses npm install/);
  assert.match(pa(["demo", "--lecciones"]).out, /puerto 3000 libre/);

  // inyectadas al contrato de un writer
  const r = paClaude(["--tipo", "codigo-acotado"], BRIEF);
  assert.equal(r.rc, 0, r.err);
  const c = contratoClaude();
  assert.match(c, /Lecciones de corridas anteriores en este proyecto/);
  assert.match(c, /no uses npm install/);

  // tope blando: 30 líneas -> necesita-poda; --estado lo informa; --lecciones-podar sólo imprime la instrucción
  assert.equal(existsSync(path.join(estado, "proy", "lecciones.necesita-poda")), false);
  for (let i = 0; i < 31; i++) pa(["demo", "--leccion", `lección número ${i} sobre algo distinto`]);
  assert.equal(existsSync(path.join(estado, "proy", "lecciones.necesita-poda")), true);
  assert.match(pa(["--estado"]).out, /NECESITA-PODA\s+proy/);
  const poda = pa(["demo", "--lecciones-podar"]);
  assert.equal(poda.rc, 0);
  assert.match(poda.out, /Podá las lecciones de 'proy'.*30 líneas y 3000 caracteres/);
  const dura = readFileSync(archivo, "utf8").trim().split("\n").length;
  assert.ok(dura <= 45, `tope duro de 45 líneas (hay ${dura})`);
  // al reescribirlo corto, la marca se va
  writeFileSync(archivo, "- 2026-10-26 una sola lección durable\n");
  pa(["demo", "--lecciones"]);
  assert.equal(existsSync(path.join(estado, "proy", "lecciones.necesita-poda")), false);
  // un --leer no lleva las lecciones
  writeFileSync(archivo, "- 2026-10-26 SOLO-PARA-ESCRIBIR\n");
  pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--leer", "--tipo", "lectura", "qué hace main"]);
  assert.doesNotMatch(readFileSync(argvFile, "utf8"), /SOLO-PARA-ESCRIBIR/);
});

test("lecciones: --bien-auto anota una línea por corrida descartada o retrabajada (una vez)", () => {
  const dir = path.join(estado, "proy");
  const id = "20260101-000000-9";
  writeFileSync(path.join(dir, `${id}.hilo`), "tarea=migrar la tabla vieja\nmodelo=claude-sonnet-5-5\nproyecto=proy\nleer=0\n");
  const hoy = new Date().toISOString().slice(0, 19) + "+00:00";
  const h = "fecha\tid\tproyecto\tmodelo\teffort\tleer\tseguir\tis_error\tnum_turns\tduration_s\ttokens\tcosto_usd\tbien\tplan\tcompactaciones\tautocompact\torigen\tcache_read\tcache_creation\tephemeral_1h\tephemeral_5m\ttipo\tintegrada\tretrabajo\tcuenta";
  const fila = [hoy, id, "proy", "claude-sonnet-5-5", "high", "0", "0", "false", "3", "10", "100", "0.1", "no", "pro", "0", "180000", "jefe", "", "", "", "", "codigo-acotado", "0", "", "claude"].join("\t");
  writeFileSync(path.join(estado, "medicion.tsv"), `${h}\n${fila}\n`);
  writeFileSync(path.join(dir, "lecciones.md"), "");
  const r = pa(["--bien-auto"]);
  assert.equal(r.rc, 0, r.err);
  const txt = readFileSync(path.join(dir, "lecciones.md"), "utf8");
  assert.match(txt, new RegExp(`\\[${id}\\] codigo-acotado con claude-sonnet-5-5: se descartó o quedó sin integrar. Tarea: migrar la tabla vieja`));
  pa(["--bien-auto"]);
  assert.equal(readFileSync(path.join(dir, "lecciones.md"), "utf8").split("\n").filter((l) => l.includes(id)).length, 1, "no se repite");
});

test("--auditar <id|rama>: corrida --leer con el contrato de auditoría (diff contra main, severidades, evidencia del autor); no va con --seguir", () => {
  // una rama de worker con un commit y su corrida (.corrida + .json con VERIFICACION)
  git("checkout", "-q", "-b", "pa/proy/aud1");
  writeFileSync(path.join(proy, "x.txt"), "hola");
  git("add", "x.txt");
  git("commit", "-q", "-m", "agrega x");
  git("checkout", "-q", "main");
  const dir = path.join(estado, "proy");
  const id = "20260102-000000-1";
  writeFileSync(path.join(dir, `${id}.corrida`), `rama=pa/proy/aud1\nruta_trabajo=${proy}\nproyecto=proy\n`);
  writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ result: BIEN }));

  const r = pa(["demo", "--sin-jefe", "--auditar", id, "-m", "claude-sonnet-5-5"]);
  assert.equal(r.rc, 0, r.err);
  const a = readFileSync(argvFile, "utf8").split("\0");
  const tarea = a[a.indexOf("-p") + 1]!;
  assert.match(tarea, /^AUDITORÍA de la rama pa\/proy\/aud1 \(sólo lectura/);
  assert.match(tarea, /diff main\.\.\.pa\/proy\/aud1/);
  assert.match(tarea, /CRITICO \/ ALTO \/ MEDIO \/ BAJO/);
  assert.match(tarea, /El autor declaró:\s+npm test\s+ok 12 - todo pasa/);
  const c = contratoClaude();
  assert.match(c, /Modo LECTURA: no escribís nada/, "es una corrida --leer");
  // la corrida quedó como lectura y tipo lectura
  const nuevo = hilos().filter((x) => x !== `${id}.hilo`).pop()!;
  assert.match(leerHilo(nuevo), /^leer=1$/m);
  assert.match(leerHilo(nuevo), /^tipo=lectura$/m);

  // también por nombre de rama
  const porRama = pa(["demo", "--sin-jefe", "--auditar", "pa/proy/aud1", "-m", "claude-sonnet-5-5"]);
  assert.equal(porRama.rc, 0, porRama.err);
  // errores: rama inexistente y combinación inválida
  const no = pa(["demo", "--sin-jefe", "--auditar", "no-existe"]);
  assert.equal(no.rc, 2);
  assert.match(no.err, /no encuentro esa corrida ni esa rama/);
  const mal = pa(["demo", "--sin-jefe", "--auditar", id, "--seguir"]);
  assert.equal(mal.rc, 2);
});

test("--auditar --decisiones <archivo>: el texto va al pedido del auditor bajo su título; sin archivo legible o sin --auditar sale 2", () => {
  git("checkout", "-q", "-b", "pa/proy/aud2");
  writeFileSync(path.join(proy, "y.txt"), "chau");
  git("add", "y.txt");
  git("commit", "-q", "-m", "agrega y");
  git("checkout", "-q", "main");
  const dec = path.join(tmp, "decisiones.md");
  writeFileSync(dec, "- El doble guion en el nombre es a propósito (lo pidió el dueño).\n");

  const r = pa(["demo", "--sin-jefe", "--auditar", "pa/proy/aud2", "--decisiones", dec, "-m", "claude-sonnet-5-5"]);
  assert.equal(r.rc, 0, r.err);
  const a = readFileSync(argvFile, "utf8").split("\0");
  const tarea = a[a.indexOf("-p") + 1]!;
  assert.match(tarea, /Decisiones tomadas a propósito \(no las marques como error\):\n- El doble guion en el nombre es a propósito/);
  assert.match(tarea, /Respondé con el bloque de siempre/, "la sección va antes de las instrucciones de respuesta");

  // sin --decisiones, la sección no aparece
  const sin = pa(["demo", "--sin-jefe", "--auditar", "pa/proy/aud2", "-m", "claude-sonnet-5-5"]);
  assert.equal(sin.rc, 0, sin.err);
  assert.doesNotMatch(readFileSync(argvFile, "utf8"), /Decisiones tomadas a propósito/);

  const falta = pa(["demo", "--sin-jefe", "--auditar", "pa/proy/aud2", "--decisiones", path.join(tmp, "no-existe.md")]);
  assert.equal(falta.rc, 2);
  assert.match(falta.err, /no existe o no se puede leer/);
  const suelto = pa(["demo", "--sin-jefe", "--decisiones", dec, "-m", "claude-sonnet-5-5", "hacé algo"]);
  assert.equal(suelto.rc, 2);
  assert.match(suelto.err, /sólo va con --auditar/);
});
