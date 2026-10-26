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

Los comandos son enlaces a esta carpeta: no la muevas ni la borres. Al terminar, abrí
`http://localhost:8791`.

## Cómo se trabaja

La idea es una sola: vos hablás con un **líder**, y el líder reparte el trabajo en **workers**.

Cada worker es un Claude (o un Gemini) que corre **adentro de tu proyecto**, en su propio worktree de
git y en su propia rama. Nunca toca tu copia de trabajo: podés seguir escribiendo código mientras
trabajan. Cuando termina, te deja la rama lista y vos decidís si entra o no.

### La app

Abrí `http://localhost:8791` (o Trama desde el menú, en Windows).

- **La barra de la izquierda** es el árbol: una fila por líder, y colgando de cada uno sus workers.
  Un punto de color dice en qué anda cada uno: trabajando, terminó, te necesita, trabado.
- **Un líder nuevo** se crea con el botón de arriba. Elegís modelo y, si querés, la carpeta donde
  corre. Le escribís como a cualquier chat.
- **Si le escribís mientras trabaja**, el mensaje espera en la cola y sale solo cuando termina el
  turno. Si no querés esperar, `Ctrl+Enter` (o el botón con el rayo) lo manda ya: el agente lo recibe
  en la primera pausa segura, sin cortarle lo que esté haciendo.
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

Sin configurar nada, los workers usan Claude Sonnet con effort `high` (y `--tipo mecanico` va a Haiku). Para elegir modelo por tipo de
tarea, o para usar modelos locales de Ollama, escribí `~/.config/trama/modelos.json`:

```json
{
  "version": 1,
  "lider":   {"modelo": "claude-opus-5-5", "effort": "high"},
  "workers": {
    "default":  {"modelo": "claude-sonnet-5-5", "effort": "high"},
    "mecanico": {"modelo": "ollama:qwen3-coder:30b"}
  },
  "locales": [
    {"id": "ollama:qwen3-coder:30b", "nombre": "Qwen3 Coder 30B",
     "url": "http://localhost:11434", "modelo": "qwen3-coder:30b"}
  ],
  "gemini": {"cupo_max": 70, "sin_claude": "claude"}
}
```

- `workers.<tipo>` elige modelo y effort de `pa --tipo <tipo>` (sin `-m`); lo que no está cae en `default`.
- `ollama:<modelo>` usa el servidor de `url` (por default `http://localhost:11434`). Las variables de
  Ollama se pasan sólo al proceso de ese worker.
- Si el archivo no valida, `pa` lo avisa en una línea y sigue con los modelos de fábrica.
- `pa --modelos` muestra qué modelo y effort va a usar cada tipo.

## Correr el motor sin WSL

En Windows el motor corre hoy adentro de WSL2. El port a Node para que corra nativo está en marcha, y su
diseño está en `motor/docs/port-windows.md`: qué partes son contrato con la app (códigos de salida, stdout,
archivos de estado, JSON) y las trampas de la plataforma que hacen fallar un port que parece andar (no hay
SIGTERM, los locks de bash y los de Node no se ven entre sí, `MAX_PATH`, junctions, pid reusados). Leelo
antes de portar una pieza.

## Licencia

Trama se distribuye bajo licencia MIT (ver `LICENSE`). Los componentes de terceros y sus licencias están en
`app/THIRD_PARTY.md`.
