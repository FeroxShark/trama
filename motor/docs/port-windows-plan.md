# Trama nativo en Windows (sin WSL), en el mismo código

## Estado (2026-10-28)
- Etapa 0: hecha (`2aadb1f` — `.gitattributes` LF, tests compatibles con cmd, `soloPosix`, CI linux + windows-latest).
- Etapa 1: hecha (`d1b8ef2` — Base TS multiplataforma: `lock`, `archivo`, `enlaces`, `proc`, `git`).
- Etapa 2: hecha (`fdca343` — Arnés de paridad de `pa`: 29 casos comparando bash vs TS).
- Etapa 3: hecha (`fd7372c` — Herramientas chicas en TS: `proyecto-ruta`, `trama-estado`, `workers`).
- Etapa 4: hecha (`66e0296` — Hooks en `.mjs` sin bash ni jq, registro de hooks en TS).
- Etapa 5: hecha (`12f3926` — CLI de `pa` en TS: parseo, validaciones, política de modelos, rúbrica y `modelos.json`).
- Etapa 6: hecha (`857e629` — Lanzar worker de claude en TS: settings, contrato, argv, rastro, al_salir).
- Etapa 7: hecha (`06e63ee` — Puestos, tope global, RAM, worktrees y cachés de `pa` en TS).
- Etapa 8: hecha (`73da113` — `pa` en TS: `--estado`, `--esperar`, `--esperar-todos`, `--parar`, `--matar` y el fork de `--async`).
- Etapa 9: hecha (`2f71772` — `pa` en TS: ramas, integrar, descartar, lecciones y auditar o actualizar).
- Etapa 10: hecha (`a922184` — `pa` en TS: otros motores: agy, codex, dsh, opencode, ollama).
- Etapa 11: hecha en Linux (`motor/bin/pa`, `reparto`, `tablero` y `cuentas` defaultean a TS; `TRAMA_PA=bash`, `TRAMA_REPARTO=py`, `TRAMA_TABLERO=py`, `TRAMA_CUENTAS_CLI=py` vuelven a los originales). Respaldo de una o dos versiones antes de borrar los originales.
- Etapa 12: hecha (`3e390eb` — `tablero` y `cuentas` en TypeScript).
- Etapa 13: hecha (`211f1f9` — `reparto` en TypeScript).
- Etapa 14: hecha (`8dfd8d6` — Ramas win32 en la app: terminal con `wt` y `cmd start`, interrumpir sin SIGINT, binarios `.cmd`, capacidades, datos de opencode).
- Etapa 15: hecha (`87eb6e0` — Carcasa nativa de Windows: supervisor del motor con chequeo por rpc, PATH de usuario, clave Run, pasos sin WSL).
- Etapa 16: hecha (`7321717` — Payload nativo por lista permitida, `electron-builder-nativo.yml` y build del `.exe` en CI).
- Etapa 17: hecha (`7306c6e` — Prueba de humo del motor en Windows y Linux en CI).
- Etapa W: falta (lista corta de pruebas en un Windows real, ver `motor/docs/windows-prueba-real.md`).

## Contexto
Gonza va a hacer su propia versión aparte; nosotros seguimos el desarrollo de Trama en el repo de Ferox. Objetivo:
Trama corre nativo en Windows (sin WSL, sin bash/jq/flock en el camino crítico), **en el mismo código** que Linux, y
cada instalador baja sólo lo de su sistema. El trabajo de Gonza se usa sólo como ideas (su rama es pública).

Relevamiento hecho (agente Plan, leyendo el repo):
- Ya hay base en main: `motor/docs/port-windows.md` (diseño de Ferox para portar el motor a Node, con las trampas de
  Windows), `app/electron/rutas.ts` (rutas `%LOCALAPPDATA%\trama\…` y named pipe), `binario.ts` (en win32 busca
  `pa.js`, que todavía no existe), `procesos.ts` (`taskkill /T /F`, Git bash), `tests/mayusculas.test.ts`.
- Lo que ata a Linux: `motor/bin/pa` (bash, ~4.700 líneas de código; jq ×89, flock ×45, setsid, kill/pgrep, /proc,
  uuidgen, timeout, date -d, symlinks), `reparto`/`tablero`/`cuentas`/`trama-estado` (Python, `fcntl`, `os.kill(pid,0)`
  — en Windows eso MATA el proceso), hooks bash con jq, `trama-motor`/systemd, instaladores bash.
- `windows/` hoy es la carcasa WSL2; su payload copia todo `motor/` y `app/` (incluye lo de Linux).
- No hay `.gitattributes` (CRLF rompe los scripts), ni CI, ni tests de `pa` en bash.

## Enfoque
**Un solo motor en TypeScript para los dos sistemas** (opción híbrida que termina en todo-TS):
- El código nuevo vive en `app/electron/cli/` (compila con el `tsconfig.electron.json` que ya existe y reusa `rutas.ts`,
  `binario.ts`, `procesos.ts`). Salida `dist-electron/cli/pa.js`, etc.
- En Linux, `motor/bin/pa` pasa a ser un despachador: usa el `pa` de TS cuando llegue a paridad; el bash queda en el
  repo, congelado, detrás de `TRAMA_PA=bash` por una o dos versiones (no se borra). Así cada función nueva se escribe una
  sola vez.
- Locks: socket abstracto en Linux / named pipe en Windows (se liberan solos si el proceso muere; sin addons nativos).
- Python: para la primera versión de Windows se empaqueta Python embebible sólo en el instalador de Windows con 3
  arreglos (lock con `msvcrt`, vida de proceso sin `os.kill`, `newline="\n"`); después se porta a TS.
- Hooks a `.mjs` corridos con un `node.exe` empaquetado.

**Instaladores separados:**
- Linux (`instalar-producto.sh`, `app/scripts/instalar.sh`): sin cambios en lo que bajan; test que asegura que nunca
  tocan `windows/`, electron-builder ni NSIS.
- Windows: payload nuevo por **lista permitida** (`windows/scripts/preparar-payload-nativo.mjs`): app compilada, hooks
  `.mjs`, plantillas, `node.exe` fijado con sha256 — nada de `.sh`, `.service`, systemd ni WSL. `electron-builder-nativo.yml`
  aparte. La carcasa corre siempre nativa: el modo WSL (`wsl.js`, `pasos.js`, su limpieza y manifiesto y `electron-builder.yml`) se sacó
  en la tanda U paso 3 (#1784). `windows/src/main.js` sólo conecta ventana, instalador y actualizador; lo que la página le pide al
  main sale del contrato único de canales (`app/electron/canales/contrato.ts` → `windows/src/canales.json`) y
  `windows/tests/canales.test.js` lo compara con los handlers de la carcasa.
- Arranque en Windows: clave `Run` de HKCU + la carcasa supervisa al motor como hijo (en lugar de systemd).

## Etapas (cada una, un agente; yo reviso cada diff)
0. `.gitattributes` (LF), `npm test` compatible con cmd, ayudante `soloPosix` para los tests que usan bash, mayúsculas
   también en `motor/`; **CI de GitHub** con jobs linux + windows-latest (sólo tests al principio).
1. Base TS: `cli/base/{lock,archivo,enlaces,proc,git}.ts` + tests en los dos sistemas.
2. Arnés de paridad: corre cada caso con el `pa` bash y el TS (claude falso headless) y compara salida, código, argv y
   archivos de estado.
3. Herramientas chicas en TS: `proyecto-ruta`, `trama-estado`, `workers`.
4. Hooks a `.mjs` + registro de hooks en TS.
5–10. `pa` en TS por partes: CLI/contrato/política → lanzar (argv de claude, `.ultimo/.listo`) → puestos/worktrees/
   cachés → async/esperar/parar/matar → hilos/ramas/integrar/lecciones/auditar/plan → otros motores (agy, codex, dsh,
   opencode, ollama).
11. Cambio en Linux al `pa` de TS (bash detrás de `TRAMA_PA=bash`), con una o dos semanas de uso tuyo antes de seguir.
12–13. `tablero`, `cuentas` y `reparto` a TS (o Python embebido sólo en Windows mientras tanto).
14. Ramas win32 en la app: terminal (`wt`/`cmd start`), interrumpir sin SIGINT, binarios npm `.cmd`, capacidades
   (sin kitty/hyprland/systemd), carpeta de datos de opencode.
15. Carcasa nativa: `pasos-nativo.js`, `nativo.js` (supervisa al motor, chequeo por `/rpc`), PATH de usuario, clave Run,
   manifiesto para desinstalar.
16. Payload nativo + `electron-builder-nativo.yml` + build del `.exe` en CI (sin wine).
17. Prueba de humo del motor en Windows en CI (repo temporal, claude falso, async, matar, locks, junctions, motor.js).
W. Lista corta de pruebas en un Windows real (login de claude, carpeta `~/.claude/projects`, agy/dsh disponibles,
   Defender, SmartScreen). Esto lo tiene que correr alguien con Windows.

Orden: 0 → 1 → 2 primero; 3, 4 y 14 en paralelo; 5→10 en fila; Windows beta después de 17 + W.
Mientras dure 6–9, cada cambio al `pa` bash va con su caso de paridad (o se congela).

**Esfuerzo honesto:** unas 40 sesiones de agente, ~13k líneas de TS + ~5k de tests; 6–10 semanas con tu revisión.

## Verificación
- Cada etapa: `tsc` ×2, `vite build`, `node --test`, `windows/` tests, y el job de Windows de GitHub Actions en verde.
- Paridad bash vs TS en CI de Linux antes del cambio de la etapa 11.
- Prueba de humo del motor en `windows-latest` (etapa 17) y build del `.exe` como artefacto.
- Etapa W en un Windows real antes de publicar la release.

## Primer paso al aprobar
Etapas 0 y 1 (en paralelo: CI + `.gitattributes` + `soloPosix` por un lado; base TS de locks/procesos/archivos por otro),
en la rama `claude/elegant-sagan-gvgbq5`. Antes, guardo este diseño en `motor/docs/port-windows-plan.md`.

## Arnés de paridad (etapa 2)
Vive en `app/tests/paridad/` y se corre con `npm run test:paridad` (en `app/`). No entra en `npm test`.
- Cada caso corre dos veces, en sandboxes nuevos (HOME, estado, registry y un proyecto git `demo` en un tmp, `claude` = el
  falso headless `app/scripts/claude-falso.mjs`): con el bash (`motor/bin/pa`, A) y con el segundo `pa` (B).
- B sale de `TRAMA_PA_B`: un comando (`node dist-electron/cli/pa.js`) o una lista JSON (`["node","ruta con espacios/pa.js"]`).
  Sin la variable compara bash contra bash: sirve para ver que el caso es determinista y que la normalización alcanza.
  `TRAMA_PARIDAD_SOLO=<texto>` corre sólo los casos cuyo nombre lo contiene.
- Compara: stdout y stderr, código de salida, argv que recibió `claude` (de `TRAMA_FALSO_LOG`, un argumento por línea) y los
  archivos del estado (`PA_STATE`, menos `lock/`, `worktrees/` y `*.log`; el contenido de `*.pid` se ignora).
- Normaliza (`normalizar.ts`, con su test): la carpeta del sandbox → `<TMP>`, uuids, ids de corrida `AAAAMMDD-HHMMSS-pid`,
  shas de git, fechas ISO, epochs, días sueltos, duraciones, pids y la RAM libre. Todo lo demás se compara tal cual.
- Los tests usan `testPosix` (el bash no corre en Windows).

### Cómo agregar un caso
En `app/tests/paridad/casos.ts`, un objeto más en `casos`:
```ts
{ nombre: "área: qué prueba", args: ["demo", "--sin-jefe", "-m", M, "hacé algo"], rc: 78 }
```
- `args`: los argumentos de `pa` (o `(c) => [...]` si necesita rutas del sandbox: `c.proyecto`, `c.estado`, `c.aux`, `c.home`).
- `rc`: código que debe dar el bash (la paridad con B se compara siempre; `rc` evita casos que no prueban lo que dicen).
- `pasos: [{ args, rc, env, stdin }, ...]` para varios comandos seguidos en el mismo sandbox (async + esperar, plan max + ver).
- `preparar: (c) => {...}` deja archivos o ramas antes de correr; `env` suma variables; `estadoIgnorar: [/regex/]` saca rutas
  del estado que sean legítimamente no deterministas.
- Si el caso falla bash-contra-bash, falta normalizar algo: agregarlo a `normalizar.ts` (con un caso en `normalizar.test.ts`)
  antes de culpar al segundo `pa`. Con el claude falso una tarea real termina en 78 (contesta «ok» sin RESULTADO): es esperado.
- Cada cambio al `pa` bash va con su caso (regla de las etapas 6–9).

## Regla fija: Windows sin bash
La versión nativa de Windows no lleva bash en ninguna forma (ni de respaldo): nada de `.sh`, Git Bash, WSL ni jq en el
payload ni en el camino de ejecución. El respaldo `TRAMA_PA=bash` es sólo de Linux. La etapa 14 saca la búsqueda de Git
Bash de `app/electron/procesos.ts`, y la 16 suma un test que falla si el payload de Windows contiene un `.sh` o invoca bash.
