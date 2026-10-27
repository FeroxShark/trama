# Traspaso: estado de Trama al 27/10/2026

Para retomar el trabajo en otra sesión, con otra persona o con otra herramienta. Repo: `FeroxShark/trama`; se trabaja en una
rama y el dueño (Ferox) abre y mergea los PR desde la web de GitHub. `main` tiene una regla que impide borrarlo y reescribir su
historia (force push); se puede subir directo y mergear sin esperar el CI.

## Cómo se trabaja (reglas del dueño)

- **Idioma:** todo en español rioplatense (código comentado en español, interfaz es + en).
- **Accesibilidad:** el dueño tiene deuteranomalía. Ningún estado puede depender sólo del rojo o el verde: siempre con palabra
  o ícono.
- **CSS:** sólo con los tokens que ya existen. i18n en `app/src/i18n/es.ts` y `en.ts`.
- **Claves y secretos:** nunca se pegan ni se loguean. Viven sólo en `~/.config/trama/claves.env`.
- **Windows:** nada de bash, WSL ni Git Bash, ni siquiera de respaldo (regla fija, ver `motor/docs/port-windows-plan.md`).
- **Cuentas:** no rotar cuentas de Claude ni de OpenCode para esquivar límites.
- **PR:** no se abren salvo que el dueño lo pida. Sin nombres de modelos de IA en commits ni en PR.
- **Antes de cada commit**, desde `app/`: `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p tsconfig.electron.json --noEmit`,
  `npx vite build`, `npm test`. Si se toca el motor que se está portando: `npm run test:paridad`.
- **Instalar en la PC del dueño** (Linux), desde la carpeta del repo:
  `git checkout main; git pull; bash motor/scripts/instalar-producto.sh`. Desde la app: el aviso "Hay una Trama nueva" hace lo mismo (ver Hecho).

## Qué es Trama (mapa rápido)

- `app/`: Electron + React 19 + Vite + TS. `app/electron/` es el proceso principal (IPC en `nucleo.ts`, `preload.cts`,
  `src/puente.ts`); `app/src/` es la interfaz (barra lateral en `src/barra/`, ajustes en `src/paneles/`, hilos en `src/hilo/`).
  Tests con `node --test` (`app/scripts/test.mjs`).
- `motor/`: `bin/pa` (bash, delega tareas a workers en worktrees), `bin/reparto` (python, elige modelo según calidad y cupo),
  `bin/tablero`, `bin/cuentas`, `bin/trama-estado`, hooks (`motor/hooks/*.mjs`), runner de OpenCode (`motor/opencode/`).
- CI: `.github/workflows/ci.yml`, trabajos `linux` y `windows`.

## Hecho (ya en `main`)

- **Calidad por esfuerzo con Artificial Analysis (AA).** La base es el índice de inteligencia general de AA para todos los
  modelos. Los esfuerzos (low…max) salen de la API y de la tabla `motor/datos/aa-suplemento.json` (49 entradas cargadas el
  27/10 desde las páginas de AA: Claude 5.5, Gemini 4 Argon/3.8 Flash, Kimi, GLM, Qwen, DeepSeek V4.1 Flash, MiMo, MiniMax,
  GPT-6). Si la API trae un dato, manda la API. Lo que falta se estima con la pendiente de modelos de la misma empresa y se
  rotula "estimado". Nunca se rankea por max. **Costo = "Cost to Run" de AA (USD de correr el índice completo)**, no por
  tarea; el costo estimado se escala a esa unidad (`ESCALA_INDICE` en `app/src/paneles/efforts-dominados.ts`).
- **OpenCode Go** (plan gratis / go / go-plus, topes en `motor/opencode/go-topes.json`, agotado por modelo). Sin Go se fuerza
  un `small_model` gratis para evitar los 402 de GPT-6 Luna.
- **Conectores MCP:** `/mcp` en la app, Ajustes > Conectores (`mcp.json` + secretos en `claves.env`), se pasan a Claude, DeepSeek
  Harness y OpenCode; en Gemini figura "no disponible".
- **Menú de comandos por motor**, guías rápidas que no mueven la pantalla.
- **Aviso de "hay una Trama nueva" (Linux).** `app/electron/actualizacion-trama.ts` consulta `releases/latest` de GitHub
  (sin token) al abrir la app y cada 6 h, sin bloquear y en silencio si no hay red; compara por semver contra la `version`
  de `app/package.json` (0.2.0 contra v0.1.4: no avisa). Pie de la barra, mismo globito que Claude Code y agy
  (`AvisoClaude cual="trama"`): versión nueva, "Notas de la versión", "Actualizar" y "Ahora no" (recordado por versión).
  Actualizar corre en el main, por argv y sin shell, en el checkout de donde se instaló: `git fetch --tags`, `git checkout
  --detach refs/tags/<tag>` y `bash motor/scripts/instalar-producto.sh`; el tag pasa por `^v\d+\.\d+\.\d+$`. El instalador
  anota ese checkout en `~/.config/trama/checkout` (sólo si la fuente es un checkout git; si no, lo borra y la app no avisa).
  Una instalación hecha antes de este cambio no tiene el archivo: hay que reinstalar una vez (`git checkout main; git pull;
  bash motor/scripts/instalar-producto.sh`). Con cambios sin commitear en el checkout no toca nada y lo dice en el aviso.
  `trama:actualizar` es sólo de la PC (`SOLO_PC_TAILNET`) y el celular ni recibe el aviso. En la carcasa de Windows no se
  muestra (el `.exe` tiene lo suyo, Ajustes > Trama para Windows). El instalador respeta `TRAMA_SIN_REINICIO_VENTANA=1` (no
  reinicia la ventana que lo corre: el resultado dice "Listo, reiniciá Trama"). Tests: `app/tests/actualizacion-trama.test.ts`;
  capturas: `scripts/captura.sh trama|trama-abierto|trama-sucio`.
- **Port a Windows, etapas 0 a 4:** CI linux + windows, base TS (`app/electron/cli/base/`), arnés de paridad bash vs TS
  (`app/tests/paridad/`), `proyecto-ruta` / `trama-estado` / `workers` en TS, hooks en `.mjs`.

## Hecho: cambiar modelo o esfuerzo con el líder trabajando

- **Los selectores de modelo y esfuerzo de la caja del líder ya no se bloquean durante un turno.** El cambio no toca el turno en
  curso: se aplica al próximo mensaje que salga. Si lo elegido difiere de lo que usa el turno, el selector lleva un reloj y
  "próx." (tooltip y nombre accesible lo dicen; no depende del color). `app/src/hilo/pendiente.ts`, `Selector.tsx` (`pendiente`).
- **Cola:** un mensaje encolado sale con lo elegido en el momento en que se desencola, no con lo de cuando se encoló. La caja avisa
  cada cambio mientras hay cola (`lider:colaSeleccion`, `cola.elegir` en `app/electron/cola.ts`); la selección se olvida al
  vaciarse la cola.
- **Mandar ya:** `mandarDirecto` ya no rechaza si difiere el modelo o el esfuerzo: el mensaje entra con el del turno, y la caja
  dice "se aplica en el próximo turno" (`directo.pendiente`).
- **Cómo se aplica entre turnos (camino que ya existía, se reusa):** `mandar` en `app/electron/lider.ts`. Claude CLI: `set_model` /
  `apply_flag_settings` en vivo, sin relanzar. Gemini (agy), DeepSeek Harness y OpenCode: se cierra el proceso y se relanza con
  `--resume` en el límite de turno (la sesión no se pierde). Locales/Ollama: relanza con su endpoint.
- **Supuesto:** cambiar de motor (Claude, Gemini, DeepSeek Harness, OpenCode) a mitad de un turno queda como estaba: en el selector
  esas opciones se ven apagadas ("Otro motor: se cambia cuando el líder termine su turno") y `/model` lo rechaza; con el líder en
  reposo sigue con su confirmación. Ningún motor quedó sin cubrir dentro del mismo motor.
- **Supuesto:** el aviso de pendiente sólo existe con un turno en curso; en reposo, lo elegido simplemente sale con el próximo mensaje.
- Capturas: `HILOS_VARIANTE=pendiente|pendiente-modelo scripts/captura.sh lider-trabajando`.

## Hecho en esta última pasada (commit final de la rama `claude/elegant-sagan-gvgbq5`, falta mergear)

> Ver el resultado de cada parte más abajo en "Estado de la última pasada".

1. **OpenCode como un proveedor más.** Tarjeta única en Ajustes > Plan y cupos (logo, conectado/no, plan Gratis/Go/Go Plus
   adentro); Ajustes > OpenCode ya no tiene el selector del plan. Fila de OpenCode siempre visible en la barra lateral, con el
   mismo componente que los demás. Como OpenCode no expone el uso, **trama cuenta sus propios pedidos**
   (`app/electron/opencode-pedidos.ts`, archivo `opencode-pedidos.jsonl` en el estado de reparto; workers exacto por
   `step_finish` en `motor/opencode/correr.mjs`; líderes aproximado por `usage_update` en `dsh-puente.ts`). Ventana supuesta de
   5 h como Claude (OpenCode no la documenta). Lo usado fuera de trama no se ve; la interfaz lo dice.
2. **Varias cuentas de OpenCode (A MEDIAS).** El agente se cortó por presupuesto. Hay cambios en `motor/bin/cuentas`,
   `motor/bin/pa` (proveedor de cuenta `opencode`), `motor/bin/reparto` (`suf`), `app/electron/cuentas-varias*.ts`,
   `src/datos/cuentas.ts` y la tarjeta (`AgregarCuenta proveedor="opencode"`). Compila y los tests pasan, pero **no está
   probado de punta a punta**. Falta confirmar cómo aísla opencode cada login (su carpeta de datos / `auth.json`, p. ej. con
   `XDG_DATA_HOME`) y probar agregar, elegir y quitar una segunda cuenta con opencode real.
3. **Port a Windows, etapa 5 (EMPEZADA).** `app/electron/cli/pa/{ayuda,contrato,entorno}.ts` (~500 líneas) y `pa --version`
   en el `pa` de bash. Falta el punto de entrada, el parseo completo, los subcomandos de lectura y los casos de paridad
   `app/tests/paridad/casos-pa.ts`. Detalle de etapas en `motor/docs/port-windows-plan.md`.
4. **Ajustes > Proyectos rehecho** (ver estado abajo): una tarjeta por proyecto con nombre, renombrar e instrucciones juntos,
   aviso arriba si hay proyectos sin unificar y "Unificar todos". Lo mecánico se aplica directo (con copia en `md-backup`);
   cuando hay que fusionar contenido distinto, la idea es lanzar un worker de `pa` que lo haga en su rama y se revise en Ramas.

## Estado de la última pasada

Verificado antes del commit final: los dos `tsc` sin errores, `vite build` bien, `npm test` 1784 pasan, 0 fallan, 53 salteados.

| Parte | Estado |
|---|---|
| OpenCode como proveedor (tarjeta, barra lateral, pedidos contados por trama) | Terminado y con tests |
| Varias cuentas de OpenCode | A medias: compila y pasa tests, sin probar con opencode real (ver punto 2 de arriba) |
| Etapa 5 de Windows (`pa` en TS) | Empezada: `ayuda`, `contrato`, `entorno`; falta entrada, parseo, subcomandos y paridad |
| Ajustes > Proyectos: tarjeta única, aviso y "Unificar todos" mecánico | Terminado y con tests (`app/src/paneles/unificar-clase.ts`) |
| Fusión con un worker de `pa` (casos con contenido distinto) | **No hecho.** Hoy esos proyectos se marcan "hay que fusionar a mano" y se abren con Unificar en su tarjeta |

**Lo que falta de la fusión con worker, tal cual:**
1. IPC nuevo `orq:mdFusionar` en `app/electron/nucleo.ts` (sumarlo a `SOLO_PC_TAILNET`), `preload.cts`, `src/puente.ts` y la
   fuente fija de `src/datos/proyectos.ts`. Lanza `pa <nombrePa(slug)> --async --tipo codigo-acotado "<brief>"` sin `-m` (que
   reparto elija), por `enCola`, validando el slug con `PROYECTO` (ver `argvLanzarRama` en `app/electron/paneles.ts`).
2. Brief: no perder ninguna regla; deduplicar sólo lo idéntico; ante contradicciones dejar las dos versiones marcadas con un
   comentario para el dueño; CLAUDE.md y GEMINI.md quedan como `MD_STUB` (`instrucciones-md.ts`); avisar si pasa `topeAgents`;
   commitear en su rama. Así la rama aparece en el panel de Ramas para revisar e integrar.
3. No relanzar si ya hay un hilo vivo o una rama sin integrar de esa fusión (`pa --hilos --json` con un marcador en la tarea;
   como mínimo, un Set por sesión de la interfaz).
4. En la tarjeta: "Un agente lo está fusionando: revisalo en Ramas", con un botón al panel de Ramas.
5. Tests del argv y del no relanzar.

## Pendiente (en orden sugerido)

1. **Mergear** la rama `claude/elegant-sagan-gvgbq5` a `main` e instalar.
2. **Terminar varias cuentas de OpenCode** (punto 2 de arriba) y probarlo con opencode real.
3. **Revisión completa de experiencia de usuario** antes de seguir sumando cosas: ver `motor/docs/ux-pendientes.md`.
4. **Port a Windows**, etapas 5 a 17 + W (prueba en un Windows real). Estimado: 3 a 5 días de agentes. Ideas a tomar del PR de
   Gonza ([FeroxShark/trama#1](https://github.com/FeroxShark/trama/pull/1), NO se mergea; tiene problemas de seguridad):
   terminal interactiva con `powershell -NoProfile -Command` y marca de rc (etapa 14), salud y hooks de inicio sin Git Bash
   (etapa 14), `windows/src/nativo.js` como esqueleto de la carcasa (etapa 15), listar skills de `~/.claude/skills`. Cuando
   esté la versión de Windows, avisarle a Gonza que la descargue.
5. **Confirmar los ids `opencode-go/*`** con `opencode models` cuando el dueño tenga Go contratado.
6. **AA:** ver si la API de AA trae costo, tokens y tiempo por esfuerzo para dejar de cargar la tabla a mano. Faltan en la tabla
   Gemini 3.8 Flash medium/low y GPT-6 Luna medium (sin costo), DeepSeek V4.1 Pro (no existe en AA) y GPT-6 Sol Daybreak (sin
   datos).

## Datos útiles

- Uso medido de OpenCode del dueño: ~200–250 pedidos por día. Go cuesta 10 USD/mes con topes equivalentes a ~80 USD de
  DeepSeek V4.1 Flash; conviene si lo usa todos los días.
- PR abierto de Gonza: #1 (rama `windows-nativo` del fork `MaxCuratAnima/trama`). El dueño se lo comunica él.
