#!/usr/bin/env python3
"""docker-guard: bloquea docker/podman que pueden tocar el HOST de la sesión del dueño.

Lo carga destructive-guard.sh (hook PreToolUse de Bash de TODAS las sesiones: la de `~`, las de
proyecto y los workers de `pa`, que lo llevan explícito en su --settings) y llama a `revisar(d)`
con el JSON del hook; 2 = bloquear, con el motivo por stderr (le vuelve al modelo). Suelto, lee el
JSON por stdin y sale con ese código.

Por qué existe (un incidente real): un worker corrió en el desktop un contenedor con
systemd como PID 1 (debian + systemd-sysv, CMD /lib/systemd/systemd, --network none) y con el
cgroup/dispositivos del host al alcance. Ese systemd arrancó sus units contra el host (el journal
mostró modprobe@drm, systemd-sysctl y el journald del contenedor escribiendo al del host), en el
mismo segundo el login manager cerró la sesión gráfica y el dueño tuvo que reiniciar la PC. Un contenedor
no es un sandbox si le das --privileged, /dev, /sys, cgroup, D-Bus o el namespace del host.

Qué mira (todo sobre docker/podman/docker-compose/podman-compose `run` y `create`, y `compose
run|up|create|watch|scale`, también detrás de sudo/env/timeout/xargs, `sh -c '…'`, `$(…)` y
backticks (también dentro de comillas dobles), heredocs que van a un shell en cualquier punto del
pipeline (`cat <<EOF | bash`, `sudo -u x bash <<EOF`) y los `$(…)` del cuerpo de un heredoc sin
comillas, que el shell expande aunque el heredoc vaya a `cat`):
  --privileged, --device (salvo /dev/net/tun, ver abajo), --device-cgroup-rule
  -v/--volume/--mount con origen en /dev /sys /proc /run/systemd /run/udev /run/dbus /run/user
    (el bus de sesión y el socket de Wayland) y sus /var/run/… (o un ancestro: /, /run, /var/run)
  --pid=host --ipc=host --cgroupns=host
  --cap-add SYS_ADMIN|ALL (y SYS_MODULE|SYS_RAWIO: cargan módulos / tocan hardware del host)
  --security-opt con `unconfined`
  init/systemd como proceso: /sbin/init, /lib/systemd/systemd, … como comando o --entrypoint, o
    porque la IMAGEN los trae de Entrypoint/Cmd (se consulta con `image inspect`, que no corre nada)
  compose: lo mismo pero leyendo el compose.yaml (PyYAML; sin PyYAML no se mira), respetando
    -f y --project-directory; `command:`/`entrypoint:` string se parten como shell; y el init que
    trae la imagen del servicio (`image inspect`) o el Dockerfile de su `build:` (último
    CMD/ENTRYPOINT, y si no los define, los de su FROM)
`--init` (tini) NO se toca: es seguro.

LÍMITES HONESTOS: mira el TEXTO del comando (y los compose.yaml que nombra). Un script que hace
docker adentro (`bash run.sh`), los RUN de un Dockerfile/`docker build`, un `build:` remoto
(URL o con variables), montar
`docker.sock` (el contenedor puede lanzar otros), `docker exec`/`docker start` de algo ya creado,
y el `cd` que no sea literal, pasan. Es una barrera contra el error del modelo, no contra un
adversario. Si el hook mismo se rompe, deja pasar (exit 0): nunca frena nada por un bug propio.
"""
import json
import os
import posixpath
import re
import shlex
import shutil
import subprocess
import sys
import traceback

def nombre_dueno():
    """TRAMA_DUENO -> `dueno` de perfil.json -> $USER con mayúscula inicial -> "el usuario"."""
    n = (os.environ.get("TRAMA_DUENO") or "").strip()
    if not n:
        perfil = os.environ.get("TRAMA_PERFIL") or os.path.join(
            os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "trama", "perfil.json")
        try:
            with open(perfil, encoding="utf-8") as f:
                n = str(json.load(f).get("dueno") or "").strip()
        except (OSError, ValueError, AttributeError):
            n = ""
    if not n:
        u = (os.environ.get("USER") or "").strip()
        n = u[:1].upper() + u[1:]
    return n or "el usuario"


EXPLICACION = (
    "Un worker corrió en el desktop de {D} un contenedor con systemd como "
    "PID 1 (debian + systemd-sysv); ese systemd operó contra el host, el login manager cerró la "
    "sesión gráfica y hubo que reiniciar la PC. Un contenedor con --privileged, --device, /dev, /sys, "
    "/sys/fs/cgroup, /run/systemd, /run/udev o el D-Bus del host, con pid/ipc/cgroupns=host, "
    "--cap-add SYS_ADMIN|ALL o seccomp/apparmor unconfined comparte kernel y servicios con la "
    "sesión gráfica: toca el HOST, no es un sandbox. Alternativas: (1) probá sin systemd de PID 1 "
    "(un proceso normal en el contenedor; `--init` sí está permitido); (2) si necesitás systemd o "
    "hardware real, dejalo para una VM o para el server (ssh); (3) pedíselo al jefe/{D}, que "
    "lo corre a mano fuera de esta sesión."
)


class Bloqueo(Exception):
    pass


# --- qué es peligroso ---------------------------------------------------------------------
# /proc: escribir en /proc/sysrq-trigger (o /proc/sys) del host lo reinicia o lo reconfigura.
# /run/user: el runtime dir de la sesión (D-Bus de usuario, wayland, pipewire): con él, systemd
# --user para el compositor. Los dos entraron con el review del 2026-09-30.
RAICES_HOST = ("/dev", "/sys", "/proc", "/run/systemd", "/run/udev", "/run/dbus", "/run/user",
               "/var/run/systemd", "/var/run/udev", "/var/run/dbus", "/var/run/user")
# Contienen a las de arriba: montarlos entrega también el socket de systemd / D-Bus, y un mount
# `:ro` no protege un socket unix (connect() no mira el flag del mount).
ANCESTROS_HOST = ("/", "/run", "/var/run")
CAPS_PELIGROSAS = {"SYS_ADMIN", "ALL", "SYS_MODULE", "SYS_RAWIO"}
# Únicos dispositivos que se dejan pasar con --device / `devices:`. /dev/net/tun es el TUN de
# los sidecars de tailscale (adguard, homepage, immich, pihole y uptime-kuma de ~/servicios lo
# usan): no toca cgroups, systemd ni la sesión gráfica. Cualquier otro (/dev/kvm, /dev/dri,
# /dev/sda...) sigue bloqueado.
DEVICES_INOFENSIVOS = {"/dev/net/tun"}


def device_inofensivo(spec):
    return str(spec).strip().split(":")[0] in DEVICES_INOFENSIVOS
INIT_RE = re.compile(r"(?<![\w./-])(?:/usr)?(?:/local)?/(?:s?bin/init|lib/systemd/systemd|bin/systemd)(?![\w./-])")

# --- flags que llevan valor (para saber dónde termina el nombre y empieza la imagen) --------
# Sacados de `docker run --help` / `docker compose run --help` (docker 29.8) más los propios de
# podman. Un flag desconocido se toma como booleano; si un flag futuro lleva valor y no está acá,
# la imagen se confunde con su valor y lo que sigue se lee como comando del contenedor.
RUN_LARGAS = set("--" + s for s in """add-host annotation attach blkio-weight blkio-weight-device cap-add
cap-drop cgroup-parent cgroupns cgroups cgroup-conf cidfile cpu-period cpu-quota cpu-rt-period cpu-rt-runtime
cpu-shares cpus cpuset-cpus cpuset-mems detach-keys device device-cgroup-rule device-read-bps device-read-iops
device-write-bps device-write-iops dns dns-option dns-search domainname entrypoint env env-file env-from-file
env-merge expose gpus group-add health-cmd health-interval health-retries health-start-interval
health-start-period health-timeout hostname ip ip6 ipc isolation label label-file link link-local-ip
log-driver log-opt mac-address memory memory-reservation memory-swap memory-swappiness mount name network
network-alias oom-score-adj pid pids-limit platform publish pull restart runtime security-opt shm-size
stop-signal stop-timeout storage-opt sysctl tmpfs ulimit umask user userns uts volume volume-driver
volumes-from workdir authfile arch os cert-dir creds decryption-key gidmap uidmap subuidname subgidname
hostuser hooks-dir image-volume init-path pod pod-id-file pidfile conmon-pidfile passwd-entry group-entry
sdnotify secret seccomp-policy timeout tz unsetenv variant preserve-fds retry retry-delay read-only-tmpfs
chrootdirs systemd mac""".split())
RUN_CORTAS = set("acehlmpuvw")
GLOBAL_LARGAS = set("--" + s for s in """config context host log-level tlscacert tlscert tlskey connection url
identity root runroot storage-driver storage-opt cgroup-manager events-backend hooks-dir conmon runtime
network-backend network-config-dir imagestore tmpdir volumepath cni-config-dir namespace""".split())
GLOBAL_CORTAS = set("Hcl")
COMPOSE_LARGAS = set("--" + s for s in "file project-name profile project-directory env-file ansi parallel progress".split())
COMPOSE_CORTAS = set("fp")

DOCKERS = {"docker", "podman", "docker-compose", "podman-compose"}
SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "ash"}
WRAPPERS = {"sudo", "doas", "pkexec", "env", "command", "exec", "nohup", "timeout", "setsid", "nice", "ionice",
            "stdbuf", "xargs", "watch", "unbuffer", "flock", "chrt", "taskset", "builtin", "chronic"}
RESERVADAS = {"{", "}", "!", "if", "then", "else", "elif", "do", "while", "until", "time"}
ASIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
COMPOSE_NOMBRES = ("compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml")
# Los verbos de compose que CREAN o arrancan contenedores desde el compose.yaml. `watch` hace `up`
# por default (tiene --no-up) y `scale` crea réplicas: entraron con el review del 2026-09-30.
# start/restart/ps/logs/down no: operan sobre lo ya creado, como `docker start`.
VERBOS_COMPOSE = ("run", "create", "up", "watch", "scale")
COMPOSE_OVERRIDE = ("compose.override.yaml", "compose.override.yml",
                    "docker-compose.override.yaml", "docker-compose.override.yml")


# --- lectura del comando --------------------------------------------------------------------
# Separadores de lista (no de pipe): lo que queda entre dos es UNA pipeline.
SEP_LISTA = re.compile(r";|&&|\|\||(?<![<>&|])&(?![>&])")


def segmento_es_shell(seg):
    """¿El comando de este segmento es un shell local, directo o detrás de wrappers?
    `bash`, `sudo -u root bash`, `timeout 60 sh -s`: sí. `ssh h bash`, `docker run -i img sh`: no
    (la orden es ssh / docker, el shell corre en otro lado)."""
    i = 0
    while i < len(seg) and (ASIGN.match(seg[i]) or seg[i] in RESERVADAS):
        i += 1
    wrapper = False
    for tok in seg[i:]:
        base = posixpath.basename(tok)
        if base in SHELLS:
            return True
        if base in WRAPPERS:
            wrapper = True
        elif not wrapper:
            return False
    return False


def linea_corre_shell(linea, ini, fin):
    """¿La pipeline donde está el heredoc (linea[ini:fin]) le pasa su cuerpo a un shell?
    Mira la pipeline entera, no sólo lo de antes del `<<`: en `cat <<EOF | bash` el shell va después.
    Desde el review del 2026-09-30: antes sólo contaba un `bash`/`sudo bash` pelado delante."""
    pipeline = SEP_LISTA.split(linea[:ini])[-1] + " " + SEP_LISTA.split(linea[fin:])[0]
    segs, _ = partir(pipeline)
    return any(segmento_es_shell(s) for s in segs)


def sacar_heredocs(texto):
    """Devuelve (texto sin los cuerpos de heredoc, [textos que corre un shell]).

    Un cuerpo es datos (`cat <<EOF`, el mensaje de un commit) salvo que su pipeline lo mande a un
    shell (`bash <<EOF`, `sudo -u x bash <<EOF`, `cat <<EOF | bash`). Aun siendo datos, si el
    delimitador va SIN comillas el shell de afuera expande los `$(…)` y backticks del cuerpo: esos
    sí se analizan. Sólo se quita si aparece la línea terminadora: sin ella no se toca nada, para
    que un `<<` suelto no se coma el resto del comando."""
    lineas = texto.split("\n")
    salida, scripts, i = [], [], 0
    while i < len(lineas):
        linea = lineas[i]
        salida.append(linea)
        i += 1
        for m in re.finditer(r"<<-?\s*(?:'([^']+)'|\"([^\"]+)\"|\\?([A-Za-z_]\w*))", linea):
            if m.start() > 0 and linea[m.start() - 1] == "<":      # <<< here-string
                continue
            delim = m.group(1) or m.group(2) or m.group(3)
            fin = next((j for j in range(i, len(lineas)) if lineas[j].strip() == delim), None)
            if fin is None:
                break
            cuerpo = "\n".join(lineas[i:fin])
            if linea_corre_shell(linea, m.start(), m.end()):
                scripts.append(cuerpo)
            elif not (m.group(1) or m.group(2) or "\\" in m.group(0)):   # <<EOF sin comillas
                scripts += subcomandos(cuerpo)
            i = fin + 1
            break
    return "\n".join(salida), scripts


def fin_subst(t, i):
    """Índice justo después del `)` que cierra un `$(` cuyo contenido empieza en t[i]. Respeta
    comillas y escapes de adentro (un `"` dentro del `$(…)` no cierra el string de afuera)."""
    n, prof = len(t), 1
    while i < n:
        c = t[i]
        if c == "\\":
            i += 2
        elif c == "'":
            j = t.find("'", i + 1)
            i = n if j < 0 else j + 1
        elif c == '"':
            i = fin_comillas(t, i + 1)
        elif c == "`":
            j = t.find("`", i + 1)
            i = n if j < 0 else j + 1
        elif t.startswith("$(", i):
            prof += 1
            i += 2
        elif c == "(":
            prof += 1
            i += 1
        elif c == ")":
            prof -= 1
            i += 1
            if prof == 0:
                return i
        else:
            i += 1
    return n


def fin_comillas(t, i):
    """Índice justo después del `"` que cierra un string que empieza en t[i]."""
    n = len(t)
    while i < n:
        c = t[i]
        if c == "\\":
            i += 2
        elif c == '"':
            return i + 1
        elif t.startswith("$(", i):
            i = fin_subst(t, i + 2)
        elif c == "`":
            j = t.find("`", i + 1)
            i = n if j < 0 else j + 1
        else:
            i += 1
    return n


def subcomandos(t):
    """`$(…)` (balanceado) y `…` dentro del texto de un string con comillas dobles: el shell los ejecuta."""
    res, i = [], 0
    while i < len(t):
        if t.startswith("$(", i):
            prof, j = 1, i + 2
            while j < len(t) and prof:
                prof += (t[j] == "(") - (t[j] == ")")
                j += 1
            res.append(t[i + 2:j - 1] if prof == 0 else t[i + 2:])
            i = j
        elif t[i] == "`":
            j = t.find("`", i + 1)
            j = len(t) if j < 0 else j
            res.append(t[i + 1:j])
            i = j + 1
        else:
            i += 1
    return res


def partir(texto):
    """Texto -> (segmentos, subtextos). Segmento = lista de palabras ya sin comillas, cortada en
    ; & | ( ) $( ` y saltos de línea. Las redirecciones (y su objetivo) se descartan; los comentarios
    también. subtextos = lo que corre un `$(…)`/backtick metido en un string con comillas dobles."""
    texto = texto.replace("\\\n", "")
    n = len(texto)
    segs, subs = [[]], []
    palabra, hay, saltar = [], False, False
    i = 0

    def cerrar():
        nonlocal palabra, hay, saltar
        if hay:
            if saltar:
                saltar = False
            else:
                segs[-1].append("".join(palabra))
        palabra, hay = [], False

    def cortar():
        nonlocal saltar
        cerrar()
        saltar = False
        if segs[-1]:
            segs.append([])

    while i < n:
        c = texto[i]
        if c == "\\" and i + 1 < n:
            palabra.append(texto[i + 1]); hay = True; i += 2
        elif c == "'":
            j = texto.find("'", i + 1)
            j = n if j < 0 else j
            palabra.append(texto[i + 1:j]); hay = True; i = j + 1
        elif c == '"':
            # Los $(…) y backticks de adentro se cortan con fin_subst, que respeta SUS comillas:
            # `"$(docker run -v "/dev:/dev" x)"` es un solo string (review 2026-09-30 #10).
            j, buf = i + 1, []
            while j < n and texto[j] != '"':
                if texto[j] == "\\" and j + 1 < n and texto[j + 1] in '"\\$`':
                    buf.append(texto[j + 1]); j += 2
                elif texto.startswith("$(", j):
                    k = fin_subst(texto, j + 2)
                    subs.append(texto[j + 2:k - 1] if texto[k - 1:k] == ")" else texto[j + 2:k])
                    buf.append(texto[j:k]); j = k
                elif texto[j] == "`":
                    k = texto.find("`", j + 1)
                    k = n if k < 0 else k
                    subs.append(texto[j + 1:k])
                    buf.append(texto[j:k + 1]); j = k + 1
                else:
                    buf.append(texto[j]); j += 1
            palabra.append("".join(buf)); hay = True; i = j + 1
        elif texto.startswith("$(", i):
            cortar(); i += 2
        elif c == "`" or c in ";&|()\n":
            cortar(); i += 1
        elif c in " \t":
            cerrar(); i += 1
        elif c == "#" and not hay:
            j = texto.find("\n", i)
            i = n if j < 0 else j
        elif c in "<>":
            if hay and "".join(palabra).isdigit():      # `2>&1`: el 2 es un fd, no una palabra
                palabra, hay = [], False
            else:
                cerrar()
            while i < n and texto[i] in "<>&|-":
                i += 1
            while i < n and texto[i] in " \t":
                i += 1
            # Sólo hay objetivo que saltear si sigue una palabra: `>&-` no tiene, `<(cmd)` es un
            # comando, y `> $(cmd)` también corre cmd. Si no, el salto quedaba armado y se comía
            # la primera palabra del comando siguiente (`true 2>&-; docker run …`, review #9).
            if i < n and texto[i] not in ";&|()\n`" and not texto.startswith("$(", i):
                saltar = True
        else:
            palabra.append(c); hay = True; i += 1
    cerrar()
    return [s for s in segs if s], subs


class Ctx:
    def __init__(self, cwd):
        self.cwd = cwd


def analizar(texto, ctx, prof=0):
    if prof > 5:
        return
    texto, scripts = sacar_heredocs(texto)
    segs, subs = partir(texto)
    for s in scripts + subs:
        analizar(s, ctx, prof + 1)
    for seg in segs:
        analizar_segmento(seg, ctx, prof)


def script_de_shell(args):
    """El argumento de `-c` de un shell (None si corre un archivo o no hay -c)."""
    i = 0
    while i < len(args):
        a = args[i]
        if re.fullmatch(r"-[A-Za-z]*c[A-Za-z]*", a):
            return args[i + 1] if i + 1 < len(args) else None
        if a in ("-o", "+o", "-O", "+O"):
            i += 2
            continue
        if not a.startswith(("-", "+")):
            return None
        i += 1
    return None


def analizar_segmento(seg, ctx, prof):
    i = 0
    while i < len(seg) and (ASIGN.match(seg[i]) or seg[i] in RESERVADAS):
        i += 1
    if i >= len(seg):
        return
    if seg[i] == "cd":
        destino = next((a for a in seg[i + 1:] if not a.startswith("-")), "~")
        if "$" not in destino:
            destino = os.path.expanduser(destino)
            ctx.cwd = posixpath.normpath(posixpath.join(ctx.cwd or "/", destino))
        return
    wrapper = False
    for j in range(i, len(seg)):
        base = posixpath.basename(seg[j])
        if base in DOCKERS:
            analizar_docker(base, seg[j + 1:], ctx)
            return
        if base in SHELLS:
            script = script_de_shell(seg[j + 1:])
            if script is not None:
                analizar(script, ctx, prof + 1)
            return
        if base == "eval":
            analizar(" ".join(seg[j + 1:]), ctx, prof + 1)
            return
        if base in WRAPPERS:
            wrapper = True
        elif not wrapper:
            return


# --- docker/podman ---------------------------------------------------------------------------
def parsear(args, largas, cortas, i=0):
    """Opciones desde args[i] hasta el primer posicional. -> ([(nombre, valor|None)], índice del posicional)."""
    opts, n = [], len(args)
    while i < n:
        a = args[i]
        if a == "--":
            return opts, i + 1
        if a == "-" or not a.startswith("-"):
            return opts, i
        if a.startswith("--"):
            nombre, eq, val = a.partition("=")
            if eq:
                opts.append((nombre, val))
            elif nombre in largas:
                opts.append((nombre, args[i + 1] if i + 1 < n else ""))
                i += 1
            else:
                opts.append((nombre, None))
        else:                                   # cluster corto: -itv /dev:/dev, -p8080:80
            for j in range(1, len(a)):
                if a[j] in cortas:
                    resto = a[j + 1:]
                    if resto.startswith("="):
                        resto = resto[1:]
                    if resto:
                        opts.append(("-" + a[j], resto))
                    else:
                        opts.append(("-" + a[j], args[i + 1] if i + 1 < n else ""))
                        i += 1
                    break
                opts.append(("-" + a[j], None))
        i += 1
    return opts, i


def siguiente(args, i, largas, cortas):
    opts, i = parsear(args, largas, cortas, i)
    return (opts, args[i], i + 1) if i < len(args) else (opts, None, i)


def analizar_docker(base, args, ctx):
    es_compose_bin = base.endswith("-compose")
    if es_compose_bin:
        opts_c, sub, i = siguiente(args, 0, COMPOSE_LARGAS | GLOBAL_LARGAS, COMPOSE_CORTAS | GLOBAL_CORTAS)
        compose = True
        globales = []
    else:
        globales, sub, i = siguiente(args, 0, GLOBAL_LARGAS, GLOBAL_CORTAS)
        compose, opts_c = sub == "compose", []
        if compose:
            opts_c, sub, i = siguiente(args, i, COMPOSE_LARGAS, COMPOSE_CORTAS)
        elif sub == "container":
            _, sub, i = siguiente(args, i, set(), set())
    if compose:
        if sub in VERBOS_COMPOSE:
            revisar_compose_archivos(opts_c, ctx, "podman" if base.startswith("podman") else "docker")
        if sub != "run":
            return
    elif sub not in ("run", "create"):
        return
    opts, k = parsear(args, RUN_LARGAS, RUN_CORTAS, i)
    imagen = args[k] if k < len(args) else None
    comando = args[k + 1:] if imagen is not None else []
    revisar_opciones(opts)
    entrypoint = next((v for n, v in reversed(opts) if n == "--entrypoint"), None)
    revisar_init(entrypoint, comando)
    remoto = any(n in ("-H", "--host", "-c", "--context", "--connection", "--url", "-r", "--remote")
                 for n, _ in globales)
    if not compose and imagen and entrypoint is None and not remoto:
        revisar_imagen(base, imagen, comando)


def falso(v):
    return v is not None and v.strip().lower() in ("false", "0", "no", "f", "n")


def fuente_peligrosa(src):
    """¿Este origen de bind mount es (o contiene) algo del host que no se puede compartir?"""
    if not src.startswith("/"):                 # volumen con nombre, relativo, ~ o $VAR: no lo sé
        return False
    norm = posixpath.normpath(re.sub(r"^/+", "/", src))
    reales = {norm}
    try:
        reales.add(os.path.realpath(norm))
    except Exception:
        pass
    for c in reales:
        if c in ANCESTROS_HOST:
            return True
        if any(c == r or c.startswith(r + "/") for r in RAICES_HOST):
            return True
    return False


def revisar_opciones(opts):
    for nombre, val in opts:
        v = (val or "").strip()
        if nombre == "--privileged" and not falso(val):
            raise Bloqueo("--privileged le da al contenedor todos los dispositivos y capacidades del host")
        if nombre == "--device-cgroup-rule" or (nombre == "--device" and not device_inofensivo(v)):
            raise Bloqueo(f"{nombre} {v}: expone dispositivos del host")
        if nombre in ("-v", "--volume") and ":" in v and fuente_peligrosa(v.split(":")[0]):
            raise Bloqueo(f"montar {v.split(':')[0]} del host ({nombre} {v})")
        if nombre == "--mount":
            for campo in v.split(","):
                k, _, x = campo.partition("=")
                if k.strip() in ("source", "src") and fuente_peligrosa(x.strip()):
                    raise Bloqueo(f"montar {x.strip()} del host (--mount {v})")
        if nombre in ("--pid", "--ipc", "--cgroupns") and v.lower() == "host":
            raise Bloqueo(f"{nombre}={v} comparte ese namespace con el host")
        if nombre == "--cap-add":
            for cap in v.upper().split(","):
                cap = cap.strip()
                cap = cap[4:] if cap.startswith("CAP_") else cap
                if cap in CAPS_PELIGROSAS:
                    raise Bloqueo(f"--cap-add {v}: la capacidad {cap} actúa sobre el host")
        if nombre == "--security-opt" and "unconfined" in v.lower():
            raise Bloqueo(f"--security-opt {v} apaga el aislamiento (seccomp/apparmor/systempaths)")


# `systemd` pelado como comando de un script: al principio, tras ; & | o tras exec.
SYSTEMD_EN_SCRIPT = re.compile(r"(?:^|[;&|(]|\bexec)\s*systemd(?![\w./-])")


def es_init(tokens):
    """¿El primer proceso sería systemd / un init de verdad?"""
    if tokens and posixpath.basename(str(tokens[0])) == "systemd":
        return True
    # un `sh -c "exec systemd"`: el script es un token con espacios, o el que sigue a un -c
    toks = [str(t) for t in tokens]
    for k in range(1, len(toks)):
        es_script = " " in toks[k] or ";" in toks[k] or re.fullmatch(r"-[A-Za-z]*c[A-Za-z]*", toks[k - 1])
        if es_script and SYSTEMD_EN_SCRIPT.search(toks[k]):
            return True
    return any(INIT_RE.search(str(t)) for t in tokens)


def tokens_compose(val):
    """`command:`/`entrypoint:` de compose: lista tal cual, o string partido como lo parte compose
    (shlex). Antes el string entero era UN token y `systemd --system` no se veía (review #8)."""
    if isinstance(val, list):
        return [str(t) for t in val]
    if isinstance(val, str):
        try:
            return shlex.split(val)
        except ValueError:
            return val.split()
    return []


def revisar_init(entrypoint, comando):
    if entrypoint is not None and es_init([entrypoint.strip()]):
        raise Bloqueo(f"--entrypoint {entrypoint}: systemd/init como proceso principal")
    if es_init(comando):
        raise Bloqueo(f"{' '.join(comando)[:80]}: systemd/init como proceso principal")


def revisar_imagen(base, imagen, comando):
    """El init también puede venir de la imagen (CMD /lib/systemd/systemd, como en el incidente).
    `image inspect` lee la config local: no corre ni descarga nada. Cualquier falla = no sé = pasa."""
    if base not in ("docker", "podman"):
        return
    r = init_de_imagen(base, imagen, solo=True)
    if not r:
        return
    ent, cmd = r
    efectivo = ent + (comando or cmd)
    if es_init(efectivo):
        raise Bloqueo(f"la imagen {imagen} arranca systemd/init como proceso principal "
                      f"({' '.join(map(str, efectivo))[:80]})")


# --- compose.yaml ----------------------------------------------------------------------------
def revisar_compose_archivos(opts_c, ctx, exe="docker"):
    try:
        import yaml
    except Exception:
        return
    base = ctx.cwd or os.getcwd()
    archivos = [v for n, v in opts_c if n in ("-f", "--file") and v and "$" not in v]
    # Sin -f, compose busca el archivo en --project-directory, no en el cwd (review #6).
    proyecto = next((v for n, v in reversed(opts_c) if n == "--project-directory" and v and "$" not in v), None)
    if archivos:
        archivos = [posixpath.join(base, os.path.expanduser(a)) for a in archivos]
    else:
        d = posixpath.join(base, os.path.expanduser(proyecto)) if proyecto else base
        for _ in range(12):                     # compose busca hacia arriba
            hallados = [posixpath.join(d, x) for x in COMPOSE_NOMBRES if os.path.isfile(posixpath.join(d, x))]
            if hallados:
                archivos = hallados[:1] + [posixpath.join(d, x) for x in COMPOSE_OVERRIDE
                                           if os.path.isfile(posixpath.join(d, x))]
                break
            padre = posixpath.dirname(d)
            if padre == d:
                break
            d = padre
    for a in archivos:
        try:
            if os.path.getsize(a) > 2_000_000:
                continue
            with open(a, encoding="utf-8") as f:
                doc = yaml.safe_load(f)
        except Exception:
            continue
        try:
            auditar_compose(doc, a, exe)
        except Bloqueo:
            raise
        except Exception:
            continue


def _verdad(v):
    return v is True or (isinstance(v, str) and v.strip().lower() in ("true", "yes", "on"))


def auditar_compose(doc, archivo, exe="docker"):
    servicios = (doc or {}).get("services") if isinstance(doc, dict) else None
    if not isinstance(servicios, dict):
        return
    for nombre, s in servicios.items():
        if not isinstance(s, dict):
            continue
        donde = f"{archivo}, servicio {nombre}"
        if _verdad(s.get("privileged")):
            raise Bloqueo(f"privileged: true ({donde})")
        for k in ("pid", "ipc", "cgroup"):
            if str(s.get(k, "")).strip().lower() == "host":
                raise Bloqueo(f"{k}: host ({donde})")
        if s.get("device_cgroup_rules"):
            raise Bloqueo(f"device_cgroup_rules ({donde})")
        for d in s.get("devices") or []:
            if not device_inofensivo(d.get("source", "") if isinstance(d, dict) else d):
                raise Bloqueo(f"devices: {d} ({donde})")
        for cap in s.get("cap_add") or []:
            cap = str(cap).strip().upper()
            if (cap[4:] if cap.startswith("CAP_") else cap) in CAPS_PELIGROSAS:
                raise Bloqueo(f"cap_add: {cap} ({donde})")
        for so in s.get("security_opt") or []:
            if "unconfined" in str(so).lower():
                raise Bloqueo(f"security_opt: {so} ({donde})")
        for v in s.get("volumes") or []:
            if isinstance(v, dict):
                src = str(v.get("source", "")) if v.get("type", "bind") == "bind" else ""
            else:
                src = str(v).split(":")[0] if ":" in str(v) else ""
            if src and fuente_peligrosa(src):
                raise Bloqueo(f"monta {src} del host ({donde})")
        for campo in ("entrypoint", "command"):
            if es_init(tokens_compose(s.get(campo))):
                raise Bloqueo(f"{campo}: systemd/init como proceso principal ({donde})")
        revisar_init_de_servicio(s, archivo, donde, exe)


def init_de_imagen(exe, imagen, solo=False):
    """Entrypoint+Cmd de una imagen local por `image inspect` (lee config, no corre nada), o None
    si no se sabe (no existe, no hay docker, variable, etc.). Desde compose, si el binario del
    compose falta O no conoce la imagen, prueba con el otro: a lo sumo tampoco la encuentra. Antes
    sólo probaba el otro si el primero faltaba, y con podman instalado `podman-compose up` de una
    imagen que sólo estaba en docker pasaba sin mirar."""
    if not isinstance(imagen, str) or not imagen or re.search(r"[$`\s]", imagen) or imagen.startswith("-"):
        return None
    otro = "docker" if exe == "podman" else "podman"
    ent = cmd = None
    for nombre in (exe,) if solo else (exe, otro):
        ruta = shutil.which(nombre)
        if not ruta:
            continue
        try:
            r = subprocess.run([ruta, "image", "inspect", "--format",
                                "{{json .Config.Entrypoint}}\t{{json .Config.Cmd}}", imagen],
                               capture_output=True, text=True, timeout=3, stdin=subprocess.DEVNULL)
            if r.returncode != 0:
                continue
            e, _, c = r.stdout.strip().partition("\t")
            ent, cmd = json.loads(e) or [], json.loads(c) or []
            break
        except Exception:
            continue
    if ent is None:
        return None
    ent = [ent] if isinstance(ent, str) else [str(t) for t in ent]
    cmd = [cmd] if isinstance(cmd, str) else [str(t) for t in cmd]
    return ent, cmd


def instruccion_dockerfile(valor):
    """CMD/ENTRYPOINT de un Dockerfile: forma exec (JSON) o forma shell (`/bin/sh -c "…"`)."""
    valor = valor.strip()
    if valor.startswith("["):
        try:
            v = json.loads(valor)
            if isinstance(v, list):
                return [str(t) for t in v]
        except Exception:
            pass
    return ["/bin/sh", "-c", valor]


def init_de_dockerfile(ruta, exe):
    """(entrypoint, cmd) efectivos de un Dockerfile: su último CMD/ENTRYPOINT de la última etapa,
    y lo que no defina lo hereda del FROM (si esa imagen está local). None si no se puede leer."""
    try:
        if os.path.getsize(ruta) > 1_000_000:
            return None
        with open(ruta, encoding="utf-8", errors="replace") as f:
            texto = f.read()
    except Exception:
        return None
    texto = re.sub(r"\\\n", " ", texto)
    desde, ent, cmd = None, None, None
    for linea in texto.split("\n"):
        m = re.match(r"\s*(FROM|CMD|ENTRYPOINT)\s+(.*)$", linea, re.I)
        if not m:
            continue
        k, v = m.group(1).upper(), m.group(2)
        if k == "FROM":                         # etapa nueva: lo de la anterior no cuenta
            partes = [p for p in v.split() if not p.startswith("--")]
            desde, ent, cmd = (partes[0] if partes else None), None, None
        elif k == "CMD":
            cmd = instruccion_dockerfile(v)
        else:
            ent, cmd = instruccion_dockerfile(v), None   # ENTRYPOINT resetea el CMD heredado
    if ent is None or cmd is None:
        base = init_de_imagen(exe, desde) if desde and desde.lower() != "scratch" else None
        if base:
            if ent is None:
                ent = base[0]
                cmd = base[1] if cmd is None else cmd
    return ent or [], cmd or []


def revisar_init_de_servicio(s, archivo, donde, exe):
    """El init que trae la imagen del servicio (o su Dockerfile de `build:`), como en `docker run`.
    Sin esto `docker compose up` de una imagen con CMD systemd pasaba (review 2026-09-30 #1)."""
    if s.get("entrypoint") is not None:          # un entrypoint propio descarta el de la imagen y su CMD
        return
    comando = tokens_compose(s.get("command")) if s.get("command") is not None else None
    efectivos = []
    build = s.get("build")
    if build is not None:
        if isinstance(build, str):
            contexto, dockerfile = build, "Dockerfile"
        elif isinstance(build, dict):
            contexto, dockerfile = str(build.get("context") or "."), str(build.get("dockerfile") or "Dockerfile")
        else:
            contexto, dockerfile = None, None
        if contexto and "://" not in contexto and "$" not in contexto + dockerfile:
            ruta = posixpath.join(posixpath.dirname(archivo), os.path.expanduser(contexto), dockerfile)
            if not os.path.isfile(ruta) and dockerfile == "Dockerfile":
                alt = posixpath.join(posixpath.dirname(archivo), os.path.expanduser(contexto), "Containerfile")
                ruta = alt if os.path.isfile(alt) else ruta
            r = init_de_dockerfile(ruta, exe)
            if r:
                efectivos.append((r, f"Dockerfile {ruta}"))
    imagen = s.get("image")
    if isinstance(imagen, str):
        r = init_de_imagen(exe, imagen)
        if r:
            efectivos.append((r, f"imagen {imagen}"))
    for (ent, cmd), origen in efectivos:
        final = ent + (comando if comando is not None else cmd)
        if es_init(final):
            raise Bloqueo(f"{origen} arranca systemd/init como proceso principal "
                          f"({' '.join(final)[:80]}; {donde})")


def main():
    try:
        d = json.load(sys.stdin)
    except Exception:
        return 0
    return revisar(d)


def revisar(d):
    """d = JSON del hook. 2 = bloquear (motivo por stderr), 0 = pasa. Lo llama destructive-guard.sh."""
    if not isinstance(d, dict) or d.get("tool_name") != "Bash":
        return 0
    cmd = (d.get("tool_input") or {}).get("command") or ""
    if not re.search(r"docker|podman", cmd):
        return 0
    try:
        analizar(cmd, Ctx(d.get("cwd") if isinstance(d.get("cwd"), str) else None))
    except Bloqueo as b:
        sys.stderr.write(f"GUARD: docker/podman bloqueado: {b}. {EXPLICACION.replace('{D}', nombre_dueno())} | cmd: {cmd[:300]}")
        return 2
    except Exception:
        sys.stderr.write("docker-guard: error interno (deja pasar):\n" + traceback.format_exc())
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
