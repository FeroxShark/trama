// Casos de paridad de `tablero` y `cuentas` (originales en Python, motor/bin) contra su port a TS (app/electron/cli/tablero.ts y cuentas.ts).
// Mismo formato que casos.ts; cada caso dice `herramienta`. El tablero vive adentro del estado del sandbox (TABLERO_DIR) para que el
// arnés compare items.jsonl, seq, hecho/ y vista.json; el repo git propio del tablero (.git) no se compara. Todo es POSIX (los originales son
// Python y los fixtures usan scripts `#!/bin/sh`).
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto, Paso } from "./arnes.ts";

const escribir = (ruta: string, texto: string, modo?: number) => {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, texto);
  if (modo) chmodSync(ruta, modo);
};
const FECHA_GIT = "2024-01-01T12:00:00+00:00";
/** git en el proyecto del sandbox con fechas fijas: los hashes cortos (`%h`) salen iguales en las dos corridas. */
const gitFijo = (c: Contexto, ...a: string[]) =>
  spawnSync("git", ["-C", c.proyecto, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: FECHA_GIT, GIT_COMMITTER_DATE: FECHA_GIT } });
const hoyUtc = () => new Date().toISOString().slice(0, 10);

// ============================================================================ tablero

const DIR = (c: Contexto) => path.join(c.estado, "tablero");
const entornoTablero = (c: Contexto): Record<string, string> => ({
  TABLERO_DIR: DIR(c),
  TABLERO_VISTA: path.join(c.estado, "vista.json"),
  BARRENDERO_DIR: path.join(c.aux, "barrendero"),
  TRAMA_DUENO: "Ferox",
  TRAMA_PERFIL: path.join(c.home, "no-hay-perfil.json"),
});
const items = (c: Contexto, ...lineas: object[]) => escribir(path.join(DIR(c), "items.jsonl"), lineas.map((l) => JSON.stringify(l) + "\n").join(""));
const registro = (c: Contexto, projects: object[]) => escribir(path.join(c.home, ".config", "proyectos", "registry.json"), JSON.stringify({ projects }));
const item = (id: number, o: object = {}) => ({ id, columna: "bandeja", proyecto: "demo", titulo: `item ${id}`, detalle: "", prueba: "", origen: "", clave: "", head: null, creado: "2024-01-01T12:00:00+00:00", tocado: "2024-01-01T12:00:00+00:00", cerrado: null, hasta: null, ...o });

const p = (args: string[] | ((c: Contexto) => string[]), rc?: number, extra: Partial<Paso> = {}): Paso => ({ args, rc, ...extra });
const tb = (nombre: string, pasos: Paso[], preparar?: Caso["preparar"]): Caso => ({
  herramienta: "tablero",
  nombre: `tablero: ${nombre}`,
  pasos,
  preparar,
  env: entornoTablero,
  estadoIgnorar: [/(^|\/)\.git(\/|$)/],
});

/** Un proyecto con una rama de pa sin integrar, el árbol sucio, corridas de pa y un sigue: lo que mira `ficha`. */
const conRamasYCorridas = (c: Contexto) => {
  gitFijo(c, "commit", "-q", "--amend", "--allow-empty", "--reset-author", `--date=${FECHA_GIT}`, "-m", "init");
  gitFijo(c, "checkout", "-q", "-b", "pa/proy/20240101-000000-1");
  gitFijo(c, "commit", "-q", "--allow-empty", "-m", "trabajo");
  gitFijo(c, "checkout", "-q", "main");
  writeFileSync(path.join(c.proyecto, "suelto.txt"), "x");
  registro(c, [{ name: "demo", path: c.proyecto, desc: "proyecto de prueba, con una descripción un poco larga para que se corte", estado: "activo" }]);
  const hilo = (id: string, campos: string) => escribir(path.join(c.estado, "proy", `${id}.hilo`), campos);
  hilo("20240101-000000-1", "tarea=Hacer algo importante\nrama=pa/proy/20240101-000000-1\ndecision_nada=1\n");
  hilo("20240102-000000-2", "tarea=Esperar una decisión\ndecision_nada=0\ndecision=Decidir si se borra la tabla vieja\n");
  hilo("20240103-000000-3", "tarea=Una consulta\ndecision_nada=1\nleer=1\n");
  hilo("20240104-000000-4", "tarea=Sin resultado todavía\n");
  items(c, item(1, { columna: "espera-dueno", titulo: "decidir esto", prueba: "npm test" }), item(2, { columna: "en-curso", titulo: "en marcha" }), item(3, { columna: "sigue", clave: "sigue:demo", titulo: "el próximo paso", origen: "sigue", head: "0".repeat(40) }));
};

const casosDeTablero: Caso[] = [
  // --- ayuda y errores de uso (los textos de argparse)
  tb("uso: sin argumentos", [p([], 2)]),
  tb("ayuda: -h", [p(["-h"], 0)]),
  tb("ayuda: abreviada (--he)", [p(["--he"], 0)]),
  tb("ayuda: agregar -h", [p(["agregar", "-h"], 0)]),
  tb("ayuda: responder -h", [p(["responder", "-h"], 0)]),
  tb("uso: comando que no existe", [p(["zz"], 2)]),
  tb("uso: opción suelta antes del comando", [p(["--foo", "listar"], 2)]),
  tb("uso: ver sin id", [p(["ver"], 2)]),
  tb("uso: id que no es número", [p(["ver", "x"], 2)]),
  tb("uso: ver con un argumento de más", [p(["ver", "1", "2"], 2)]),
  tb("uso: agregar sin título", [p(["agregar"], 2)]),
  tb("uso: columna que no existe", [p(["agregar", "t", "--columna", "zz"], 2)]),
  tb("uso: opción ambigua (--o)", [p(["agregar", "t", "--o", "x"], 2)]),
  tb("uso: opción sin valor", [p(["listar", "--columna"], 2)]),
  tb("uso: opción desconocida del subcomando", [p(["listar", "--foo"], 2)]),
  tb("uso: posicional de más en listar", [p(["listar", "zz"], 2)]),
  tb("uso: --anda con --no-anda", [p(["responder", "1", "--anda", "--no-anda"], 2)]),
  tb("uso: --max no es número", [p(["resumen", "--max", "x"], 2)]),
  tb("uso: posponer sin fecha", [p(["posponer", "1"], 2)]),
  tb("uso: cerrar sin id", [p(["cerrar"], 2)]),
  tb("uso: tirar sin id", [p(["tirar"], 2)]),
  tb("uso: un posicional después de una opción se pierde (cerrar 1 --clave K 1)", [p(["cerrar", "1", "--clave", "K", "2"], 2)]),
  tb("abreviaturas, = y -- en la línea de comandos", [p(["agregar", "--col=ideas", "--", "-un título"], 0), p(["listar", "--col=ideas", "--tod"], 0)]),

  // --- init, agregar, listar, ver
  tb("init", [p(["init"], 0)]),
  tb("agregar y listar", [p(["agregar", "primero"], 0), p(["agregar", "segundo", "--columna", "ideas"], 0), p(["listar"], 0), p(["listar", "--json"], 0)]),
  tb("agregar: título vacío", [p(["agregar", "  "], 2)]),
  tb("agregar con todos los campos", [
    p(["agregar", "Un título", "--columna", "espera-dueno", "--proyecto", "demo", "--detalle", "el detalle", "--prueba", "npm test", "--origen", "shark", "--clave", "k1", "--hasta", "2030-01-02"], 0),
    p(["ver", "1"], 0),
    p(["ver", "1", "--json"], 0),
    p(["listar"], 0),
    p(["listar", "--pospuestos"], 0),
    p(["listar", "--todo"], 0),
  ]),
  tb("agregar pregunta con opciones y defecto", [
    p(["agregar", "¿cuál?", "--columna", "espera-dueno", "--tipo", "pregunta", "--simple", "  elegir   una ", "--contexto", " dos líneas ", "--opcion", "uno", "--opcion", "dos", "--defecto", "2"], 0),
    p(["ver", "1"], 0),
    p(["ver", "1", "--json"], 0),
  ]),
  tb("agregar: --defecto que no está", [p(["agregar", "t", "--opcion", "a", "--defecto", "9"], 2)]),
  tb("agregar: --detalle con --detalle-archivo", [p(["agregar", "t", "--detalle", "a", "--detalle-archivo", "/no/existe"], 2)]),
  tb("agregar: detalle por stdin", [p(["agregar", "t", "--detalle-archivo", "-"], 0, { stdin: "\n\nlínea uno\nlínea dos\n\n" }), p(["ver", "1"], 0)]),
  tb("agregar: archivo de detalle que no existe", [p(["agregar", "t", "--prueba-archivo", "/no/existe"], 2)]),
  tb("agregar: la misma clave actualiza y reabre", [
    p(["agregar", "uno", "--clave", "doctor:demo:x", "--origen", "doctor"], 0),
    p(["agregar", "uno cambiado", "--clave", "doctor:demo:x", "--detalle", "nuevo"], 0),
    p(["cerrar", "--clave", "doctor:demo:x", "--nota", "arreglado"], 0),
    p(["cerrar", "--clave", "doctor:demo:x"], 0),
    p(["listar", "--todo"], 0),
    p(["agregar", "uno otra vez", "--clave", "doctor:demo:x"], 0),
    p(["ver", "1"], 0),
  ]),
  tb("proyecto: registrado, alias, área, desconocido y ambiguo", [
    p(["agregar", "a", "--proyecto", "DEMO"], 0),
    p(["agregar", "b", "--proyecto", "casa"], 0),
    p(["agregar", "c", "--proyecto", "no-existe"], 0),
    p(["agregar", "d", "--proyecto", "otro"], 0),
    p(["agregar", "e", "--proyecto", "tit"], 0),
    p(["listar", "--proyecto", "demo"], 0),
    p(["listar", "--proyecto", "casa"], 0),
  ], (c) => registro(c, [{ name: "demo", path: c.proyecto, titulo: "Titulo Largo" }, { name: "otro-uno", path: path.join(c.aux, "uno") }, { name: "otro-dos", path: path.join(c.aux, "dos") }])),
  tb("fechas de --hasta", [
    p(["agregar", "hoy", "--hasta", "hoy"], 0),
    p(["agregar", "mañana", "--hasta", "mañana"], 0),
    p(["agregar", "tres días", "--hasta", "+3d"], 0),
    p(["agregar", "dos semanas", "--hasta", "+2s"], 0),
    p(["agregar", "ya", "--hasta", "ya"], 0),
    p(["agregar", "mal", "--hasta", "ayer"], 2),
    p(["agregar", "mal2", "--hasta", "2026-02-30"], 2),
    p(["listar", "--todo"], 0),
    p(["listar", "--pospuestos"], 0),
    p(["listar", "--json"], 0),
  ]),

  // --- mover, posponer, editar
  tb("mover: columna, proyecto y hasta", [
    p(["mover", "1", "--columna", "en-curso"], 0),
    p(["mover", "2", "--proyecto", "casa", "--hasta", "+5d"], 0),
    p(["mover", "1", "--columna", "hecho"], 0),
    p(["mover", "1", "--columna", "ideas"], 0),
    p(["mover", "1"], 2),
    p(["mover", "99", "--columna", "ideas"], 1),
    p(["listar", "--todo"], 0),
  ], (c) => items(c, item(1), item(2))),
  tb("posponer varios y traerlos de vuelta", [
    p(["posponer", "1", "2", "+4d"], 0),
    p(["listar", "--pospuestos"], 0),
    p(["posponer", "1", "ya"], 0),
    p(["posponer", "3", "+1d"], 1),
    p(["posponer", "1", "mañana-mal"], 2),
    p(["listar"], 0),
  ], (c) => items(c, item(1), item(2), item(3, { columna: "hecho", cerrado: "2024-01-02T10:00:00+00:00" }))),
  tb("editar: título, detalle, sumar y prueba", [
    p(["editar", "1", "--titulo", "  nuevo título "], 0),
    p(["editar", "1", "--detalle", "uno"], 0),
    p(["editar", "1", "--sumar", "dos"], 0),
    p(["editar", "1", "--detalle", "base", "--sumar", "extra"], 0),
    p(["editar", "1", "--prueba", "npm run x"], 0),
    p(["editar", "1"], 2),
    p(["editar", "1", "--titulo", " "], 2),
    p(["editar", "1", "--sumar", " "], 2),
    p(["editar", "99", "--titulo", "x"], 1),
    p(["ver", "1"], 0),
  ], (c) => items(c, item(1))),
  tb("editar: opciones, defecto, simple y contexto", [
    p(["editar", "1", "--opcion", "a", "--opcion", "b", "--defecto", "b", "--simple", "en simple", "--contexto", "algo"], 0),
    p(["editar", "1", "--defecto", "1"], 0),
    p(["editar", "1", "--opcion", "x", "--opcion", "y", "--opcion", "z"], 0),
    p(["editar", "1", "--defecto", "9"], 2),
    p(["editar", "1", "--sin-opciones", "--defecto", "1"], 2),
    p(["editar", "1", "--sin-opciones", "--simple", "", "--contexto", ""], 0),
    p(["editar", "1", "--tipo", "prueba"], 0),
    p(["ver", "1", "--json"], 0),
  ], (c) => items(c, item(1))),

  // --- responder
  tb("responder: pregunta con opción, texto suelto y borrar", [
    p(["responder", "1", "--opcion", "2"], 0),
    p(["responder", "1", "--opcion", "a"], 0),
    p(["responder", "1", "la opción que sea"], 0),
    p(["responder", "1", "--respuesta", "otra", "--opcion", "b"], 0),
    p(["responder", "1", "--opcion", "z"], 2),
    p(["responder", "1", "x", "--respuesta", "y"], 2),
    p(["responder", "1", "--respuesta", "  "], 2),
    p(["responder", "1"], 2),
    p(["responder", "1", "--nota", "n"], 2),
    p(["ver", "1"], 0),
    p(["responder", "1", "--borrar"], 0),
    p(["responder", "1", "--borrar"], 0),
    p(["responder", "1", "--borrar", "--nota", "x"], 2),
    p(["ver", "1", "--json"], 0),
  ], (c) => items(c, item(1, { columna: "espera-dueno", opciones: [{ id: "a", texto: "uno" }, { id: "b", texto: "dos" }] }))),
  tb("responder: prueba anda y no anda", [
    p(["responder", "1", "--anda", "--nota", " se ve bien "], 0),
    p(["responder", "1", "--no-anda"], 0),
    p(["responder", "1", "--anda", "--respuesta", "x"], 2),
    p(["responder", "2", "--anda"], 2),
    p(["responder", "3", "--anda"], 1),
    p(["ver", "1"], 0),
    p(["listar", "--json"], 0),
  ], (c) => items(c, item(1, { columna: "espera-dueno", prueba: "npm test" }), item(2, { columna: "espera-dueno", tipo: "pregunta" }), item(3, { columna: "hecho", cerrado: "2024-01-02T10:00:00+00:00" }))),

  // --- cerrar, tirar, sigue
  tb("cerrar y tirar", [
    p(["cerrar", "1", "--nota", "listo"], 0),
    p(["cerrar", "1"], 0),
    p(["cerrar", "2", "3"], 0),
    p(["tirar", "4"], 0),
    p(["tirar", "99"], 1),
    p(["cerrar", "--clave", "no-hay"], 0),
    p(["listar", "--columna", "hecho,tirado"], 0),
    p(["ver", "1"], 0),
  ], (c) => items(c, item(1), item(2), item(3), item(4))),
  tb("sigue: uno por proyecto, reemplaza y guarda el HEAD", [
    p(["sigue", "demo", "primer paso"], 0),
    p(["sigue", "demo", "primer paso"], 0),
    p(["sigue", "demo", "segundo paso", "--head", "abc123"], 0),
    p(["sigue", "casa", "algo de casa"], 0),
    p(["sigue", "fantasma", "x"], 0),
    p(["sigue", "demo", " "], 2),
    p(["sigue", " ", "x"], 2),
    p(["cerrar", "1"], 0),
    p(["sigue", "demo", "tercer paso"], 0),
    p(["listar", "--columna", "sigue", "--json"], 0),
  ]),

  // --- vistas
  tb("ficha: proyecto con ramas, corridas, esperas y sigue", [p(["ficha", "demo"], 0), p(["ficha", "demo", "--corta"], 0), p(["ficha", "demo", "--json"], 0)], conRamasYCorridas),
  tb("ficha: área, desconocido y proyecto sin repo", [p(["ficha", "casa"], 0), p(["ficha", "fantasma"], 0), p(["ficha", "sinrepo"], 0), p(["ficha", "sinrepo", "--json"], 0)], (c) => registro(c, [{ name: "sinrepo", path: path.join(c.aux, "sinrepo"), estado: "pausa" }])),
  tb("proyectos: días sin tocar, áreas y retirados", [p(["proyectos"], 0), p(["proyectos", "--json"], 0), p(["proyectos", "--retirados"], 0)], (c) => {
    gitFijo(c, "commit", "-q", "--amend", "--allow-empty", "--reset-author", `--date=${FECHA_GIT}`, "-m", "init");
    registro(c, [{ name: "demo", path: c.proyecto, estado: "activo" }, { name: "demo / alias", path: c.proyecto }, { name: "viejo", path: path.join(c.aux, "viejo"), estado: "retirado", desc: "ya no" }, { name: "idea", path: path.join(c.aux, "idea"), estado: "en preparación" }]);
    items(c, item(1, { proyecto: "demo" }), item(2, { proyecto: "casa" }), item(3, { proyecto: "suelto" }), item(4, { proyecto: "viejo" }), item(5, { proyecto: "demo", columna: "sigue", clave: "sigue:demo", titulo: "el paso" }));
  }),
  tb("hoy: integradas, cerrados y commits", [p(["hoy"], 0), p(["hoy", "--json"], 0), p(["hoy", "--fecha", "2024-01-01"], 0), p(["hoy", "--fecha", "ya"], 2), p(["hoy", "--fecha", "mal"], 2)], (c) => {
    gitFijo(c, "commit", "-q", "--amend", "--allow-empty", "--reset-author", `--date=${FECHA_GIT}`, "-m", "init");
    const ahora = `${hoyUtc()}T10:15:00+00:00`;
    escribir(path.join(c.estado, "integradas.tsv"), `fecha\tid\tproyecto\ta\tb\tc\td\tcommits\te\tresultado\n${ahora}\t20240101-000000-1\tproy\tx\tx\tx\tx\t3\tx\tintegrada\n${ahora}\t20240101-000000-2\tproy\tx\tx\tx\tx\tmuchos\tx\tintegrada\n${ahora}\t20240101-000000-3\tproy\tx\tx\tx\tx\t1\tx\tdescartada\n`);
    escribir(path.join(c.estado, "proy", "20240101-000000-1.hilo"), "tarea=Hacer algo\n");
    escribir(path.join(c.estado, "proy", "20240101-000000-1.json"), JSON.stringify({ result: "RESULTADO: Dejé el tablero andando. Faltan los tests.\nARCHIVOS: x\nDECISION: nada" }));
    escribir(path.join(c.estado, "proy", "20240101-000000-2.hilo"), "tarea=Otra tarea larga\n");
    items(c, item(1, { columna: "hecho", cerrado: `${hoyUtc()}T09:00:00+00:00` }), item(2, { columna: "tirado", cerrado: `${hoyUtc()}T09:30:00+00:00` }), item(3, { columna: "hecho", cerrado: "2024-01-01T09:00:00+00:00" }));
  }),
  tb("hoy: nada registrado", [p(["hoy"], 0)]),
  tb("resumen: esperas, ramas, doctor, bandeja y barrendero", [p(["resumen"], 0), p(["resumen", "--json"], 0), p(["resumen", "--max", "4"], 0), p(["resumen", "--max", "0"], 0)], (c) => {
    conRamasYCorridas(c);
    items(c, item(1, { columna: "espera-dueno", titulo: "más viejo", creado: "2023-12-01T12:00:00+00:00", prueba: "npm test" }), item(2, { columna: "espera-dueno", titulo: "otro" }), item(3, { columna: "espera-dueno", titulo: "tercero", hasta: "2999-01-01" }), item(4, { origen: "doctor", titulo: "FAIL de doctor" }), item(5, { clave: "doctor:demo:x", titulo: "otro doctor" }), item(6), item(7));
    escribir(path.join(c.aux, "barrendero", "informe.json"), JSON.stringify({ fecha: hoyUtc(), cerrados: [{ id: 6 }], movidos: [], fusionados: [{ id: 7 }] }));
  }),
  tb("resumen: nada pendiente", [p(["resumen"], 0), p(["resumen", "--json"], 0)]),
  tb("resumen: barrendero de hace dos días no cuenta", [p(["resumen"], 0)], (c) => escribir(path.join(c.aux, "barrendero", "informe.json"), JSON.stringify({ fecha: "2024-01-01", cerrados: [{ id: 1 }] }))),

  // --- archivo y estado
  tb("archivar: cerrados viejos al archivo mensual", [
    p(["archivar"], 0),
    p(["listar", "--todo"], 0),
    p(["ver", "2"], 0),
    p(["agregar", "nuevo"], 0),
    p(["archivar", "--dias", "0"], 0),
    p(["archivar", "--dias", "x"], 2),
  ], (c) => {
    items(c, item(1), item(2, { columna: "hecho", cerrado: "2024-01-05T10:00:00+00:00" }), item(3, { columna: "tirado", cerrado: "2024-02-05T10:00:00+00:00" }), item(4, { columna: "hecho", cerrado: `${hoyUtc()}T01:00:00+00:00` }));
    escribir(path.join(DIR(c), "seq"), "4\n");
  }),
  tb("ids: seq sin archivo reusa el máximo del archivo", [p(["agregar", "x"], 0)], (c) => escribir(path.join(DIR(c), "hecho", "2024-01.jsonl"), JSON.stringify(item(41, { columna: "hecho", cerrado: "2024-01-02T10:00:00+00:00" })) + "\n")),
  tb("columna vieja espera-<dueño> se lee como espera-dueno", [p(["listar", "--columna", "espera-dueno"], 0), p(["listar", "--columna", "espera-ferox"], 0), p(["agregar", "x", "--columna", "espera-ferox"], 0), p(["listar", "--json"], 0)], (c) => items(c, item(1, { columna: "espera-ferox" }))),
  tb("línea rota en items.jsonl: leer avisa, escribir se niega", [p(["listar"], 0), p(["agregar", "x"], 1), p(["cerrar", "1"], 1)], (c) => escribir(path.join(DIR(c), "items.jsonl"), JSON.stringify(item(1)) + "\nesto no es json\n[1, 2]\n")),
  tb("ver: un item archivado y uno que no existe", [p(["ver", "7"], 0), p(["ver", "#7", "--json"], 0), p(["ver", "8"], 1)], (c) => escribir(path.join(DIR(c), "hecho", "2024-01.jsonl"), JSON.stringify(item(7, { columna: "hecho", cerrado: "2024-01-02T10:00:00+00:00" })) + "\n")),
  tb("vista.json se regenera en cada escritura", [p(["agregar", "uno", "--columna", "espera-dueno"], 0), p(["agregar", "dos", "--hasta", "+9d"], 0), p(["cerrar", "1"], 0), p(["sigue", "demo", "un paso"], 0)]),
];

// ============================================================================ cuentas

const entornoCuentas = (c: Contexto): Record<string, string> => ({
  TRAMA_CUENTAS: path.join(c.estado, "cuentas.json"),
  TRAMA_CUENTAS_HOME: c.home,
  // un opencode de mentira (lista modelos de Go y dice que tiene --standalone) para que el resultado no dependa de lo instalado
  PATH: `${path.join(c.aux, "bin")}${path.delimiter}${path.join(c.raiz, "shim")}${path.delimiter}/usr/bin${path.delimiter}/bin`,
});
const conOpencode = (c: Contexto) => escribir(path.join(c.aux, "bin", "opencode"), `#!/bin/sh\ncase "$1" in models) echo "opencode-go/glm"; echo "opencode/otro";; *) echo "usage: opencode --standalone";; esac\n`, 0o755);
const compartido = (c: Contexto) => {
  escribir(path.join(c.home, ".claude", "settings.json"), '{"a": 1}');
  escribir(path.join(c.home, ".claude", "hooks", "h.sh"), "x");
  escribir(path.join(c.home, ".codex", "config.toml"), "m = 1");
  escribir(path.join(c.home, ".gitconfig"), "[user]");
};
const cu = (nombre: string, pasos: Paso[], preparar?: Caso["preparar"], sinOpencode = false): Caso => ({
  herramienta: "cuentas",
  nombre: `cuentas: ${nombre}`,
  pasos,
  preparar: (c) => {
    if (!sinOpencode) conOpencode(c);
    preparar?.(c);
  },
  env: entornoCuentas,
});

const casosCuentas: Caso[] = [
  cu("ayuda: -h", [p(["-h"], 0)]),
  cu("ayuda: comando desconocido", [p(["zz"], 2)]),
  cu("listar: solo las cuentas de siempre", [p([], 0), p(["listar"], 0), p(["--json"], 0), p(["listar", "--json"], 0)]),
  cu("listar: sin opencode instalado", [p(["--json"], 0)], undefined, true),
  cu("agregar: slug, repetidos y --id", [
    p(["agregar", "claude", "Trabajo"], 0),
    p(["agregar", "claude", "Trabajo"], 0),
    p(["agregar", "google", "Mi Cuenta Ñandú Ωmega"], 0),
    p(["agregar", "chatgpt", "ChatGPT personal", "--id", "chat-1"], 0),
    p(["agregar", "opencode", "!!!"], 0),
    p(["agregar", "claude", "x", "--id", "chat-1"], 2),
    p(["agregar", "claude", "x", "--id", "claude"], 2),
    p(["agregar", "claude", "x", "--id", "Mal_Id"], 2),
    p(["agregar", "nube", "x"], 2),
    p(["agregar", "claude"], 2),
    p(["agregar", "claude", "x", "--otra", "y"], 2),
    p(["listar"], 0),
    p(["listar", "--json"], 0),
  ], compartido),
  cu("agregar: los symlinks a lo compartido y la marca de la carpeta", [p(["agregar", "claude", "Trabajo"], 0), p(["agregar", "google", "Casa"], 0), p(["agregar", "chatgpt", "Codex"], 0), p(["agregar", "opencode", "Oc"], 0)], compartido),
  cu("env: cada proveedor, texto y JSON", [
    p(["agregar", "claude", "Trabajo"], 0),
    p(["agregar", "google", "Casa"], 0),
    p(["agregar", "chatgpt", "Codex"], 0),
    p(["agregar", "opencode", "Oc"], 0),
    p(["env", "claude"], 0),
    p(["env", "claude", "--json"], 0),
    p(["env", "trabajo"], 0),
    p(["env", "trabajo", "--json"], 0),
    p(["env", "casa"], 0),
    p(["env", "casa", "--json"], 0),
    p(["env", "codex"], 0),
    p(["env", "codex", "--json"], 0),
    p(["env", "oc"], 0),
    p(["env", "oc", "--json"], 0),
    p(["env", "opencode", "--json"], 0),
    p(["env", "nada"], 1),
    p(["env"], 2),
    p(["env", "trabajo", "--xml"], 2),
  ]),
  cu("ver: texto, JSON y --verificar", [
    p(["agregar", "claude", "Trabajo"], 0),
    p(["ver", "trabajo"], 0),
    p(["ver", "trabajo", "--json"], 0),
    p(["ver", "google", "--json", "--verificar"], 0),
    p(["ver", "opencode", "--verificar", "--json"], 0),
    p(["ver", "nada"], 1),
    p(["ver"], 2),
    p(["ver", "trabajo", "--otra"], 2),
  ]),
  cu("login --imprimir", [
    p(["agregar", "claude", "Trabajo"], 0),
    p(["agregar", "google", "Casa"], 0),
    p(["agregar", "chatgpt", "Codex"], 0),
    p(["agregar", "opencode", "Oc"], 0),
    p(["login", "claude", "--imprimir"], 0),
    p(["login", "trabajo", "--imprimir"], 0),
    p(["login", "casa", "--imprimir"], 0),
    p(["login", "codex", "--imprimir"], 0),
    p(["login", "oc", "--imprimir"], 0),
    p(["login", "opencode", "--imprimir"], 0),
    p(["login", "nada", "--imprimir"], 1),
    p(["login"], 2),
  ]),
  cu("login --imprimir: opencode viejo sin --standalone", [p(["agregar", "opencode", "Oc"], 0), p(["login", "oc", "--imprimir"], 0)], (c) => escribir(path.join(c.aux, "bin", "opencode"), `#!/bin/sh\necho "usage: opencode"\n`, 0o755)),
  cu("renombrar", [
    p(["agregar", "claude", "Trabajo"], 0),
    p(["renombrar", "trabajo", "Trabajo nuevo"], 0),
    p(["renombrar", "claude", "Mi Claude"], 0),
    p(["renombrar", "claude", "  "], 2),
    p(["renombrar", "nada", "x"], 1),
    p(["renombrar", "trabajo"], 2),
    p(["listar", "--json"], 0),
  ]),
  cu("quitar: deja la carpeta, o la borra con --borrar-credenciales", [
    p(["agregar", "claude", "Uno"], 0),
    p(["agregar", "claude", "Dos"], 0),
    p(["quitar", "uno"], 0),
    p(["quitar", "dos", "--borrar-credenciales"], 0),
    p(["quitar", "dos"], 1),
    p(["quitar", "claude"], 2),
    p(["quitar"], 2),
    p(["quitar", "uno", "--otra"], 2),
    p(["listar", "--json"], 0),
  ], compartido),
  cu("quitar --borrar-credenciales: una carpeta ajena no se borra", [
    p(["quitar", "ajena", "--borrar-credenciales"], 1),
    p(["quitar", "propia", "--borrar-credenciales"], 0),
    p(["quitar", "casa", "--borrar-credenciales"], 1),
  ], (c) => {
    escribir(path.join(c.estado, "cuentas.json"), JSON.stringify({ version: 1, cuentas: [{ id: "ajena", proveedor: "claude", nombre: "Ajena", dir: path.join(c.aux, "ajena") }, { id: "propia", proveedor: "claude", nombre: "Propia", dir: path.join(c.aux, "propia") }, { id: "casa", proveedor: "claude", nombre: "Casa", dir: c.home }] }));
    escribir(path.join(c.aux, "ajena", "datos.txt"), "x");
    escribir(path.join(c.aux, "propia", ".trama-cuenta"), "propia\n");
  }),
  cu("plan de OpenCode: fijar, detectar y errores", [
    p(["agregar", "opencode", "Oc"], 0),
    p(["agregar", "claude", "Cl"], 0),
    p(["plan", "oc", "go-plus"], 0),
    p(["plan", "oc", "--detectar"], 0),
    p(["plan", "oc", "gratis"], 0),
    p(["plan", "oc", "--detectar"], 0),
    p(["plan", "opencode", "--detectar"], 0),
    p(["plan", "opencode", "go"], 2),
    p(["plan", "oc", "mucho"], 2),
    p(["plan", "cl", "go"], 1),
    p(["plan", "cl", "--detectar"], 1),
    p(["plan", "oc"], 2),
    p(["listar", "--json"], 0),
    p(["env", "oc", "--json"], 0),
  ]),
  cu("plan --detectar: opencode que no lista nada", [p(["plan", "opencode", "--detectar"], 3)], (c) => escribir(path.join(c.aux, "bin", "opencode"), `#!/bin/sh\nexit 0\n`, 0o755)),
  cu("cuentas.json con entradas inválidas y repetidas", [p(["listar", "--json"], 0), p(["env", "casa", "--json"], 0)], (c) => {
    escribir(path.join(c.estado, "cuentas.json"), JSON.stringify({ version: 1, cuentas: [{ id: "claude", proveedor: "claude", nombre: "Mi Claude" }, { id: "casa", proveedor: "google", nombre: "Casa" }, { id: "casa", proveedor: "chatgpt", nombre: "Repetida" }, { id: "Mala_Id", proveedor: "claude" }, { id: "x", proveedor: "nube" }, "texto", { id: "chat", proveedor: "chatgpt", dir: "~/mis-cuentas/chat" }, { id: "sin-nombre", proveedor: "opencode", plan: "mucho" }] }));
  }),
  cu("sesión: lee los archivos de credenciales", [p(["listar", "--json"], 0), p(["ver", "trabajo", "--json"], 0)], (c) => {
    escribir(path.join(c.home, ".claude", ".credentials.json"), "{}");
    escribir(path.join(c.home, ".codex", "auth.json"), "{}");
    escribir(path.join(c.estado, "cuentas.json"), JSON.stringify({ version: 1, cuentas: [{ id: "trabajo", proveedor: "claude", nombre: "Trabajo", dir: path.join(c.aux, "trabajo") }, { id: "codex", proveedor: "chatgpt", nombre: "Codex" }] }));
    escribir(path.join(c.aux, "trabajo", ".credentials.json"), "{}");
  }),
];

/** Los casos de `tablero` y de `cuentas`. */
export const casosTablero: Caso[] = [...casosDeTablero, ...casosCuentas];
