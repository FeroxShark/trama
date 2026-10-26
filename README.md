# Trama

Trama es una app de escritorio para trabajar con varios agentes de Claude Code (o Gemini) a la vez:
un líder que reparte tareas y workers que las hacen, cada uno en su propio worktree de git, y un
tablero donde quedan las preguntas que necesitan tu respuesta.

Tiene dos partes:

- **app/**: la interfaz, en Electron y en el navegador.
- **motor/**: `pa` (delegar trabajo a un worker), `tablero` (pendientes y preguntas), `trama-motor`
  (el servidor sin ventana, en `127.0.0.1:8791`) y los hooks que protegen a los workers.

## Requisitos

- Claude Code (`claude`) con tu cuenta, o `agy` (Gemini) con la tuya.
- Git. El instalador de Linux baja Node.js 22 o más nuevo, `claude` y `agy` si faltan.
- Opcional: [Ollama](https://ollama.com), para modelos locales.
- Opcional: `opencode` (`npm i -g opencode-ai`), para líderes y workers con los modelos gratis de OpenCode.
- Opcional: `dsh` (DeepSeek Harness, `npm i -g --prefix ~/.local @deepseek-ai/dsh`; el instalador de Linux lo baja si hay
  `npm`), para modelos de Ollama o DeepSeek. Ver [Usar Trama gratis](#usar-trama-gratis-opencode--ollama).

## Instalar en Windows 11

1. Bajá `Trama-Setup-<versión>.exe` de la página de Releases del repositorio y ejecutalo.
2. El asistente prepara WSL2 con Ubuntu 24.04 (puede pedir reiniciar), instala el motor adentro de
   Ubuntu, conecta tu cuenta y ofrece configurar Ollama.
3. Abrí Trama desde el menú Inicio.

## Instalar en Linux (Ubuntu, Debian o WSL2 con systemd)

Desde la raíz de este árbol:

```bash
cd app && npm ci && npm run build && cd ..                 # compila la interfaz y el motor (dist-electron/)
sudo bash motor/scripts/instalar-producto.sh --solo-apt    # paquetes del sistema, una vez
bash motor/scripts/instalar-producto.sh                    # instalación de usuario
```

Deja `pa`, `tablero`, `trama-estado` y `trama-motor` en `~/.local/bin`, el motor como servicio de usuario
(`trama-motor.service`), los hooks de Claude Code y el plugin de Gemini si hay `agy`. Es idempotente: si
algo no se puede hacer, lo dice como aviso, y `trama-estado --json` muestra qué quedó.

Si hay sesión gráfica (o pasás `--escritorio`; `--sin-escritorio` lo evita) también deja al día la app de escritorio:
baja Electron a `~/.local/share/trama/app`, instala el lanzador `trama` y reinicia la ventana si estaba abierta.

**Actualizar** es un solo comando:

```bash
cd ~/Proyectos/trama; git pull; bash motor/scripts/instalar-producto.sh
```

Los comandos son enlaces a esta carpeta: no la muevas ni la borres. Al terminar, corré
`trama-motor abrir` (abre `http://localhost:8791` con la clave de esta instalación).

## Cómo se trabaja

La idea es una sola: vos hablás con un **líder**, y el líder reparte el trabajo en **workers**.

Cada worker es un Claude (o un Gemini) que corre **adentro de tu proyecto**, en su propio worktree de
git y en su propia rama. Nunca toca tu copia de trabajo: podés seguir escribiendo código mientras
trabajan. Cuando termina, te deja la rama lista y vos decidís si entra o no.

### La app

Corré `trama-motor abrir` (o abrí Trama desde el menú, en Windows).

- **La barra de la izquierda** es el árbol: una fila por líder, y colgando de cada uno sus workers.
  Un punto de color dice en qué anda cada uno: trabajando, terminó, te necesita, trabado.
- **Un líder nuevo** se crea con el botón de arriba. Elegís modelo y, si querés, la carpeta donde
  corre. Le escribís como a cualquier chat.
- **Si le escribís mientras trabaja**, el mensaje espera en la cola y sale solo cuando termina el
  turno. Si no querés esperar, `Ctrl+Enter` (o el botón con el rayo) lo manda ya: el agente lo recibe
  en la primera pausa segura, sin cortarle lo que esté haciendo. Anda con líderes de Claude y de
  Gemini; con un modelo local (Ollama) no hay ese canal, y el mensaje espera en la cola.
- **Para ver qué hizo un worker**, tocá su fila: están los pasos que dio, con los diffs.
- **El botón ✓** de una fila integra la rama (o archiva, si no hay rama). Si los tests fallan, no
  integra y te lo dice.

Trama queda viva en segundo plano: cerrar la ventana la esconde. Para cerrarla del todo, `Ctrl+Q`.

### `pa`: delegar desde la terminal

Lo mismo que hace el líder, pero a mano. Los proyectos salen de
`~/.config/proyectos/registry.json`.

```bash
pa miproyecto "arreglá el parseo de fechas en el importador"   # espera y devuelve el resultado
pa miproyecto --async "lo mismo, pero sin bloquear la terminal"
pa miproyecto --tipo mecanico "renombrá la función vieja"      # tipo barato, modelo barato
pa miproyecto --leer "¿dónde se valida el login?"              # sólo lectura, no escribe nada
```

Mientras corren:

```bash
workers                        # qué está trabajando ahora
workers ver <id>               # espiarle el chat
pa --esperar miproyecto --id <id>
```

Cuando terminan, el trabajo **no está en tu rama principal** hasta que lo integres:

```bash
pa miproyecto --ramas                  # qué quedó sin integrar
pa miproyecto --integrar <id>          # entra a main
pa miproyecto --integrar <id> --tests  # sólo si los tests pasan
pa miproyecto --revertir <id>          # deshacer una integración
pa miproyecto --descartar <id>         # tirar la rama
```

Si el worker se topa con algo que sólo vos podés decidir, no adivina: lo deja anotado en el tablero.

#### Tareas bien dadas, trabajo verificado

- **Brief.** Un líder escribe cada tarea con cinco secciones: *Objetivo, Archivos, Listo cuando, Cómo verificar, No tocar*
  (`pa --brief` imprime la plantilla; `pa miproyecto --brief-archivo tarea.md` la lee de un archivo). Si faltan "Listo cuando"
  o "Cómo verificar", `pa` avisa por stderr, pero no bloquea. Con un modelo de inteligencia baja (< 70 en `reparto --tabla`)
  avisa además que conviene dar pasos chicos, y el worker recibe esa consigna en su contrato.
- **`AGENTS.md`.** Gemini, Codex y los modelos de OpenCode no leen `CLAUDE.md`. `pa` les inyecta el `AGENTS.md` del proyecto
  (o su `CLAUDE.md` si no hay), hasta 8000 caracteres. `pa miproyecto --agents-md` imprime una plantilla (build, tests,
  convenciones, qué no tocar) para llenar cuando falta.
- **Verificación obligatoria.** El RESULTADO del worker lleva una sección `VERIFICACION` con el comando que corrió y un
  extracto real de la salida. Si falta o dice "ninguna", la corrida igual termina, pero queda marcada `verificado: false`:
  `pa` imprime `SIN VERIFICAR`, y también lo muestran `pa --estado`, `pa --hilos --json` y `workers ultimo`.
- **Lecciones.** `pa miproyecto --leccion "no uses X: falla sin red"` guarda una línea en
  `~/.local/state/pa/<proyecto>/lecciones.md` (tope 30 líneas / 3000 caracteres; pasado el tope `pa --estado` marca
  `NECESITA-PODA` y `--lecciones-podar` explica cómo reescribirlas). `pa --bien-auto` suma solo las corridas descartadas o
  retrabajadas. Las últimas lecciones viajan en el contrato de cada worker del proyecto. `--lecciones` las imprime.
- **Auditar.** `pa miproyecto --auditar <id|rama> [-m modelo]` lanza un revisor de sólo lectura que lee el diff contra
  main y reporta problemas por severidad (CRITICO / ALTO / MEDIO / BAJO). No corre tests (el modo lectura no lo permite):
  para eso, `pa miproyecto --integrar <id> --tests`.

### `tablero`: lo que te espera

Un solo lugar para pendientes, preguntas, ideas y lo hecho. Los workers escriben acá solos cuando
necesitan una decisión tuya.

```bash
tablero resumen                      # qué te espera, ramas sin integrar, avisos
tablero listar                       # todo lo abierto
tablero agregar "probar el importador con un CSV grande"
tablero ver 42                       # un item entero, con sus opciones
tablero responder 42 "la opción 2"   # contestar sin cerrarlo
tablero cerrar 42                    # hecho
```

Dos vistas que valen la pena:

```bash
tablero ficha miproyecto   # dónde quedó: último commit, ramas sueltas, qué sigue
tablero hoy                # qué se hizo en el día
```

Las columnas van `bandeja → sigue → en-curso → espera → hecho`, más `ideas` aparte. En la app, la
pestaña **Te esperan** del Tablero muestra lo mismo y te deja contestar con botones.

## Modelos

Sin configurar nada, `pa` le pide a `reparto` que elija el modelo de cada worker: según el tipo de tarea
(la calidad mínima que pide) y el cupo que te queda en cada suscripción (Claude, y Gemini o ChatGPT si
las tenés). Si `reparto` no contesta, o la tarea no pasa por él (por ejemplo con `--effort xhigh`), cae
a Claude Sonnet con effort `high` (`--tipo mecanico` va a Haiku). `-m` siempre gana.

Para fijar el modelo por tipo de tarea, o para usar modelos locales de Ollama, escribí
`~/.config/trama/modelos.json`:

```json
{
  "version": 1,
  "reparto": "fijo",
  "lider":   {"modelo": "claude-opus-5-5", "effort": "high"},
  "workers": {
    "default":  {"modelo": "claude-sonnet-5-5", "effort": "high"},
    "mecanico": {"modelo": "ollama:qwen3-coder:30b"}
  },
  "locales": [
    {"id": "ollama:qwen3-coder:30b", "nombre": "Qwen3 Coder 30B",
     "url": "http://localhost:11434", "modelo": "qwen3-coder:30b"}
  ]
}
```

- `reparto` es `"auto"` (el default) o `"fijo"`. Con `"auto"` el modelo de cada worker lo elige
  `reparto` y `workers.<tipo>` sólo se usa de respaldo, si `reparto` no puede contestar. Con `"fijo"`
  manda `workers.<tipo>`: elige modelo y effort de `pa --tipo <tipo>` (sin `-m`), y lo que no está cae
  en `default`. Si querés que `workers` se respete, poné `"reparto": "fijo"`.
- `ollama:<modelo>` usa el servidor de `url` (por default `http://localhost:11434`). Las variables de
  Ollama se pasan sólo al proceso de ese worker.
- `dsh:<proveedor>/<modelo>` (`dsh:ollama/qwen3-coder:30b`, `dsh:deepseek/deepseek-v4-flash`) y
  `opencode:<proveedor>/<modelo>` (`opencode:opencode/deepseek-v4.1-flash-free`; la lista sale de
  `opencode models`) también valen en `workers.<tipo>.modelo` y en `lider`. Sin `effort`.
- `calidad` pisa la calidad (0 a 100) con la que `reparto` pesa cada modelo, por ejemplo
  `"calidad": {"opencode:opencode/glm-5.3-flash-free": 55, "dsh:ollama/*": 40}`.
- Si el archivo no valida, `pa` lo avisa en una línea y sigue con los modelos de fábrica.
- `pa --modelos` muestra qué modelo y effort va a usar cada tipo (y qué elegiría `reparto` hoy).

## Usar Trama gratis (OpenCode / Ollama)

Hay dos caminos, los dos sin Claude, Gemini ni ChatGPT. Sirven para líderes (el chat de la app) y para workers (`pa`).

**Modelos gratis de OpenCode: por el programa `opencode`.** OpenCode (opencode.ai) regala modelos como
`deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, `nemotron-3-ultra-free` o `big-pickle`, pero sólo los deja usar
desde su propio programa, con tu cuenta de OpenCode Console: desde cualquier otro cliente (aun con tu key) contestan
`429 Free usage limit reached`. Por eso Trama no los llama: lanza `opencode` y le deja el login y el modelo.

1. **Instalá opencode:** `npm i -g opencode-ai` (o el instalador de opencode.ai).
2. **Conectate:** corré `opencode`, escribí `/connect` y elegí **OpenCode Console**. Se hace una vez; Trama usa ese login.
3. **Usalo.** En la app, el selector de modelos tiene la empresa **OpenCode** con los modelos de `opencode models` (los
   gratis primero y marcados «Gratis»; **Ajustes > DeepSeek Harness > El programa opencode** muestra si está instalado y
   conectado, y **Actualizar modelos** vuelve a listarlos). En `pa`:
   ```bash
   pa miproyecto -m opencode:opencode/deepseek-v4.1-flash-free "arreglá el parseo de fechas"
   pa --modelos        # los modelos de opencode y de dsh, cuáles andan y cuáles son gratis
   ```
   El id es `opencode:` más lo que imprime `opencode models` (`<proveedor>/<modelo>`). Sin `-m`, si no tenés Claude,
   Gemini ni ChatGPT, `reparto` asigna solo el mejor modelo gratis de opencode (grupo `opencode-free`); con Claude
   instalado, sólo los usa para lo que no pide más calidad de la que tienen: se ajusta con `calidad` en `modelos.json`.

**Ollama (tu máquina) y DeepSeek: por `dsh`.**

1. **Instalá dsh.** El instalador de Linux lo hace solo si tenés `npm`; a mano:
   `npm i -g --prefix ~/.local @deepseek-ai/dsh` (con `--prefix ~/.local` no hace falta `sudo`).
   `trama-estado --json` dice si quedó (`dsh.instalado`).
2. **Elegí de dónde salen los modelos:**
   - **Ollama:** corré `ollama serve` y bajá un modelo (`ollama pull qwen3-coder:30b`). Sin key. Si Ollama está en
     otra máquina, `OLLAMA_HOST=http://otra:11434` o un `locales` en `modelos.json`.
   - **DeepSeek** (se paga): guardá tu key en **Ajustes > DeepSeek Harness**, o en `~/.config/trama/claves.env`
     (modo `0600`): `DEEPSEEK_API_KEY=tu-key`. La key de OpenCode de esa misma pantalla es sólo para sus modelos de
     pago a través de dsh; los gratis no la usan.
3. **Usalo:**
   ```bash
   pa miproyecto -m dsh:ollama/qwen3-coder:30b --tipo mecanico "renombrá la función vieja"
   ```

Para saber: los modelos gratis de la nube son más chicos y menos pulidos que Claude o Gemini. Lo que mandás a
OpenCode o a DeepSeek sale de tu máquina (pa no manda el `CLAUDE.md` personal ni la ficha del proyecto, ni nada si
el pedido o el repo parecen traer secretos); con Ollama todo queda local. Un worker de dsh o de opencode no retoma
sesiones (`--seguir`), ni `--leer`, `--mcp`, `--aca` ni `--max-budget-usd`.

## Correr el motor sin WSL

En Windows el motor corre hoy adentro de WSL2. El port a Node para que corra nativo está en marcha, y su
diseño está en `motor/docs/port-windows.md`: qué partes son contrato con la app (códigos de salida, stdout,
archivos de estado, JSON) y las trampas de la plataforma que hacen fallar un port que parece andar (no hay
SIGTERM, los locks de bash y los de Node no se ven entre sí, `MAX_PATH`, junctions, pid reusados). Leelo
antes de portar una pieza.

## Licencia

Trama se distribuye bajo licencia MIT (ver `LICENSE`). Los componentes de terceros y sus licencias están en
`app/THIRD_PARTY.md`.
