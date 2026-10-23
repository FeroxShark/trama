#!/bin/bash
# PreToolUse hook: block catastrophic Bash commands even when the session runs
# with --dangerously-skip-permissions (the asistente window does).
# Voice can be mis-transcribed, so a few irreversible patterns must never run
# unconfirmed. Exit 2 = block + feed reason back to Claude (it will ask the user).
input=$(cat)
# Las guardas que parsean el comando (docker-guard.py, nvibrant-guard.py) viven al lado de este
# archivo, que llega por symlink desde ~/.claude/hooks: de ahi el readlink -f. Las carga el python
# de abajo con guardia_externa(), solo si el COMANDO (no el JSON entero: cwd y transcript_path
# tambien pueden decir docker) nombra su palabra.
printf '%s' "$input" | TRAMA_GUARD_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" python3 -c '
import json, sys, re
import os
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if d.get("tool_name") != "Bash":
    sys.exit(0)
# Enforce everywhere (2026-07-27). It used to enforce only when cwd was
# ~/.assistant-session, but assistant-launch.sh runs `cd $HOME` since it was changed
# to share memory with the terminal sessions -> the guard had been dead for every
# voice session, which is exactly the session that runs --dangerously-skip-permissions.
# On top of that settings.json sets permissions.defaultMode = "dontAsk", so no session
# gets prompts anyway. Patterns below are catastrophic-only, so blanket enforcement
# costs nothing in false positives.
cmd = (d.get("tool_input", {}) or {}).get("command", "") or ""

patterns = [
    r"(?<![\w-])rm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rf][a-zA-Z]*\b.*\s(/|~|\$HOME|\.config|\.claude)",
    r"(?<![\w-])rm\s+-[a-zA-Z]*r[a-zA-Z]*f|(?<![\w-])rm\s+-[a-zA-Z]*f[a-zA-Z]*r",
    r"(?<![\w-])rm\s+-[rf]{1,2}\s+/",
    r"\bdd\b.*\bof=/dev/",
    r"\bof=/dev/(sd|nvme|disk|mmcblk)",
    r">\s*/dev/(sd|nvme|disk|mmcblk)",
    r"\bmkfs(\.\w+)?\b",
    r"\bwipefs\b",
    r"\b(parted|fdisk|sgdisk)\b.*\b/dev/",
    r"\bshred\b",
    r"\btruncate\s+-s\s*0\b",
    r"\bpacman\s+-R",
    r"\byay\s+-R",
    r"\bparu\s+-R",
    r"\bgit\s+push\b.*(--force\b|-f\b)",
    r"\bchmod\s+-R\s+0*777\s+/",
    r"\bchown\s+-R\b.*\s/(\s|$)",
    r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:",
]

# ---------------------------------------------------------------------------
# BACKUPS (2026-09-13). Por qué existe este bloque:
#   El 2026-09-12 un arnés de prueba mal escrito resolvió su "sandbox" al punto de
#   montaje REAL del USB de backups y corrió cinco veces la retención del backup
#   semanal con RETENCION=3. Se perdieron 10 backups semanales (junio-agosto 2026)
#   que existían únicamente ahí. Nadie lo bloqueó porque nada miraba el destino.
#
#   Regla: cualquier VERBO destructivo cuyo objetivo caiga en un destino de backup
#   se bloquea. Leer (ls, cat, du, sha256sum -c, stat, find sin -delete) pasa
#   siempre: el objetivo es no romper la auditoría, sólo la escritura.
#
#   Lo propio de cada instalación (etiquetas de los USB de backup, puntos de montaje
#   históricos, el congelado de más abajo) sale de config, no de este archivo:
#   ~/.config/trama/guard.json (TRAMA_GUARD_CONFIG lo redirige):
#   {"etiquetas_usb": ["..."], "montajes": ["/ruta"],
#    "congelado": {"etiqueta": "...", "marcador": "~/ruta/CONGELADO", "patrones": ["regex"]}}
#   Sin archivo valen sólo los destinos genéricos de abajo.
#
#   LÍMITE HONESTO: el hook lee el STRING del comando, no el contenido de lo que
#   ese comando ejecuta. `bash /tmp/algo.sh` con un rm adentro pasa igual. La
#   defensa real contra eso es la papelera de backup-configs-weekly.sh (la poda
#   mueve, no borra) y el gate de INVOCATION_ID. Esto es la tercera capa, no la
#   primera.
# ---------------------------------------------------------------------------
def config_guard():
    ruta = os.environ.get("TRAMA_GUARD_CONFIG") or os.path.join(
        os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "trama", "guard.json")
    try:
        with open(ruta, encoding="utf-8") as f:
            c = json.load(f)
        return c if isinstance(c, dict) else {}
    except (OSError, ValueError):
        return {}

def lista_cfg(c, clave):
    v = c.get(clave)
    return [x for x in v if isinstance(x, str) and x] if isinstance(v, list) else []

CFG = config_guard()
ETIQUETAS_USB = lista_cfg(CFG, "etiquetas_usb")
MONTAJES = lista_cfg(CFG, "montajes")
CONGELADO = CFG.get("congelado") if isinstance(CFG.get("congelado"), dict) else {}

DESTINOS_BACKUP = (
    r"(?:/run/media/[^\s]*"          # udisksctl monta acá: /run/media/$USER/<etiqueta>
    + "".join("|" + re.escape(m) for m in MONTAJES) +   # puntos de montaje históricos (config)
    r"|/media/[^\s]*"                # por si algo monta al estilo viejo
    r"|~/backups|\$HOME/backups|/home/[^/\s]+/backups"   # fallback local de configs
    r"|\.papelera"                   # la red de seguridad no se vacía a mano
    + ("|by-label/(?:" + "|".join(re.escape(e) for e in ETIQUETAS_USB) + ")" if ETIQUETAS_USB else "")
    + ")"
)

patterns += [
    # rm / mv / cp -f / shred / truncate apuntando a un destino de backup
    r"(?<![\w-])rm\b[^|;&]*" + DESTINOS_BACKUP,
    r"\bmv\b[^|;&]*" + DESTINOS_BACKUP,
    r"\bshred\b[^|;&]*" + DESTINOS_BACKUP,
    r"\btruncate\b[^|;&]*" + DESTINOS_BACKUP,
    # find ... -delete / -exec rm
    r"\bfind\b[^|;&]*" + DESTINOS_BACKUP + r"[^|;&]*(-delete|-exec\s+rm)",
    r"\bfind\b[^|;&]*(-delete|-exec\s+rm)[^|;&]*" + DESTINOS_BACKUP,
    # rsync --delete con un destino de backup (borra lo que no esté en el origen)
    r"\brsync\b[^|;&]*--delete[^|;&]*" + DESTINOS_BACKUP,
    # redirección que PISA un archivo de backup (el destino del > es lo que importa;
    # `cat /run/media/... > /tmp/x` no matchea porque mira lo que sigue al >)
    r">\s*\"?\x27?" + DESTINOS_BACKUP,
    # dd escribiendo sobre el USB
    r"\bdd\b[^|;&]*\bof=[^\s]*" + DESTINOS_BACKUP,
    # desmontar/formatear el USB de backups
]
if ETIQUETAS_USB:
    # desmontar/apagar el USB de backups
    patterns.append(r"\budisksctl\s+(unmount|power-off)\b[^|;&]*(?:" + "|".join(re.escape(e) for e in ETIQUETAS_USB) + ")")

# ---------------------------------------------------------------------------
# DIRECTORIOS DE BUILD EN RAM (2026-09-21). Por que existe este bloque:
#   /tmp y /dev/shm son tmpfs: lo que se escribe ahi ocupa RAM, no disco. El
#   2026-09-21 un worker de verificacion corrio cargo test con
#   CARGO_TARGET_DIR=/tmp/verif-target; el target de debug crecio a 6,8 GB,
#   el zram se lleno y earlyoom mato 137 procesos en 35 segundos: todas las
#   instancias de claude y el juego que estaba abierto. Ningun patron lo miraba
#   porque el comando no era destructivo: solo escribia mucho en el lugar
#   equivocado.
#
#   Regla: un directorio de salida de build (cargo target-dir) que apunte a tmpfs
#   se bloquea. El reemplazo va en disco: ~/.cache/<algo>-target.
#   Leer o listar /tmp sigue pasando; lo que se bloquea es DIRIGIR el build ahi.
#
#   LIMITE HONESTO: mira el string del comando. Un script que exporte la variable
#   adentro pasa igual, y npm/vite/ffmpeg escribiendo a mano en /tmp tambien.
#   La defensa de fondo es ram-guard avisando a tiempo; esto es la capa barata.
# ---------------------------------------------------------------------------
TMPFS_RAM = r"(?:/tmp|/dev/shm|\$TMPDIR)"

patterns += [
    r"CARGO_TARGET_DIR\s*=\s*[\"\x27]?" + TMPFS_RAM,
    r"--target-dir(?:\s+|=)[\"\x27]?" + TMPFS_RAM,
    r"CARGO_BUILD_TARGET_DIR\s*=\s*[\"\x27]?" + TMPFS_RAM,
]

# ---------------------------------------------------------------------------
# CONGELADO TEMPORAL DE UN USB DE BACKUPS (2026-09-13).
#   El USB quedó desmontado a propósito para dejar intactos los inodos de los 10
#   backups borrados, por si se intenta recuperarlos con extundelete/ext4magic.
#   Montarlo escribe el journal de ext4 y puede pisarlos. Se bloquea el montaje
#   hasta que el dueño decida si intenta la recuperación.
#   Todo el bloque es config: guard.json -> "congelado" (etiqueta, marcador, patrones).
#   Sin esa clave no hay congelado.
#
#   PARA DESCONGELAR: borrar el archivo marcador. Eso es todo: no hay que tocar este archivo.
#
#   El congelado lo manda el MARCADOR, no una constante. Antes eran dos fuentes de verdad
#   que podian discrepar, y apagar la constante dejaba en rojo los seis casos de tests que
#   solo bloquean con el congelado puesto. Ahora hay un solo lugar, y el propio marcador
#   explica por que esta y como se sale.
# ---------------------------------------------------------------------------
#   `bash -n <script>` (chequeo de sintaxis) queda exento: no ejecuta nada, y sin la
#   exención no se puede ni validar un cambio en estos scripts mientras dure el congelado.
#   La exención usa fullmatch A PROPÓSITO: con un match de prefijo,
#   `bash -n x.sh; bash ~/.local/bin/usb-healthcheck.sh` quedaba exento ENTERO y corría
#   el healthcheck contra el USB congelado. Tiene que ser un chequeo de sintaxis solo,
#   sin nada encadenado.
#   TRAMA_GUARD_FORZAR_CONGELADO=1 AGREGA el congelado, nunca lo saca. Es un override que
#   solo puede apretar, asi que no es una puerta de escape: los tests lo usan para ejercitar
#   los patrones del congelado sin depender de que el USB este congelado de verdad.
MARCADOR_CONGELADO = os.path.expanduser(CONGELADO.get("marcador") or "")
ETIQUETA_CONGELADA = CONGELADO.get("etiqueta") or ""
USB_CONGELADO = bool(CONGELADO) and (
    (MARCADOR_CONGELADO != "" and os.path.exists(MARCADOR_CONGELADO))
    or os.environ.get("TRAMA_GUARD_FORZAR_CONGELADO") == "1"
)
ES_CHEQUEO_SINTAXIS = re.fullmatch(r"\s*bash\s+-n\s+\S+\s*", cmd) is not None
if USB_CONGELADO and not ES_CHEQUEO_SINTAXIS:
    if ETIQUETA_CONGELADA:
        patterns += [
            r"\budisksctl\s+mount\b[^|;&]*" + re.escape(ETIQUETA_CONGELADA),
            r"\bmount\b[^|;&]*" + re.escape(ETIQUETA_CONGELADA),
        ]
    patterns += lista_cfg(CONGELADO, "patrones")

# ---------------------------------------------------------------------------
# Guardas que necesitan PARSEAR el comando (no alcanza un regex) viven en modulos al lado de
# este archivo: se cargan solo si el comando nombra su palabra, y exponen revisar(d) -> 0|2.
# nvibrant-guard.py: nvibrant sin sus 7 valores pone Digital Vibrance 0 en TODOS los monitores
# (2026-09-28). La version regex de aca adentro se salteaba con timeout/env/uvx/bash -c y
# bloqueaba invocaciones validas con redirecciones (review 2026-09-30 #3 y #12).
# ---------------------------------------------------------------------------
GUARD_DIR = os.environ.get("TRAMA_GUARD_DIR") or ""
# Si falta un modulo (o uno del que depende), se bloquean SOLO los comandos de su disparo, con el
# motivo: antes python3 salia 2 por "can\x27t open file" y eso bloqueaba todo (review 2026-09-30 #5).
# Un error interno del modulo, en cambio, deja pasar (un guard roto se termina desactivando).
def guardia_externa(archivo, disparo, requiere=()):
    if not re.search(disparo, cmd):
        return
    for falta in (archivo,) + tuple(requiere):
        ruta = os.path.join(GUARD_DIR, falta)
        if not os.path.isfile(ruta):
            sys.stderr.write(
                "GUARD: falta " + ruta + " (lo carga destructive-guard.sh; se copio el hook sin sus "
                "modulos o se movio?). Hasta que vuelva, bloqueo SOLO los comandos que nombran "
                + disparo + "; el resto pasa. Restauralo desde ~/orquestador/hooks. | cmd: " + cmd[:300]
            )
            sys.exit(2)
    ruta = os.path.join(GUARD_DIR, archivo)
    try:
        import importlib.util
        sys.dont_write_bytecode = True  # sin __pycache__ en hooks/
        spec = importlib.util.spec_from_file_location(archivo.replace("-", "_")[:-3], ruta)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        rc = mod.revisar(d)
    except Exception:
        import traceback
        sys.stderr.write(archivo + ": error al cargarlo (deja pasar):\n" + traceback.format_exc())
        return
    if rc == 2:
        sys.exit(2)

guardia_externa("docker-guard.py", r"docker|podman")
guardia_externa("nvibrant-guard.py", "nvibrant", requiere=("docker-guard.py",))

for p in patterns:
    if re.search(p, cmd):
        sys.stderr.write(
            "GUARD: comando potencialmente destructivo bloqueado por seguridad "
            "(modo asistente sin prompts). Confirma EXPLICITAMENTE con el usuario "
            "en voz/texto antes de ejecutarlo. Patron: " + p + " | cmd: " + cmd[:300]
        )
        sys.exit(2)
sys.exit(0)
'
