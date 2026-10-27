// Casos de paridad de los hooks de motor/hooks: el `.sh` (A) contra el `.mjs` de al lado (B). Mismo formato que casos.ts; cada
// caso dice `herramienta` (latido, destructive-guard, statusline-espejo o agy-pa) y alimenta al hook con el JSON de stdin que
// manda Claude Code (o agy). Se compara stdout, stderr, código de salida y los archivos de estado (heartbeat, .turnos,
// statusline/*). Todo es POSIX: los originales son bash (con jq, flock y python3).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto } from "./arnes.ts";

const J = (o: unknown) => JSON.stringify(o);
const bash = (command: string, extra: Record<string, unknown> = {}, otros: Record<string, unknown> = {}) => J({ tool_name: "Bash", tool_input: { command, ...extra }, ...otros });
const escribir = (ruta: string, texto: string) => {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, texto);
};
const hbDe = (c: Contexto, nombre = "w1") => path.join(c.estado, `${nombre}.heartbeat`);

// ============================================================================ latido

type ArgsLatido = { fase?: string; modo?: string; hb?: string };
const la = (nombre: string, stdin: string, rc: number, o: ArgsLatido & { env?: Caso["env"]; preparar?: Caso["preparar"] } = {}): Caso => ({
  herramienta: "latido",
  nombre: `latido: ${nombre}`,
  args: (c) => [o.hb ?? hbDe(c), o.fase ?? "pre", ...(o.modo ? [o.modo] : [])],
  stdin,
  rc,
  env: o.env,
  preparar: o.preparar,
});

const pasoLatido = (stdin: string, rc: number, fase = "post", env?: Record<string, string>) => ({ args: (c: Contexto) => [hbDe(c), fase], stdin, rc, env });

/** Un worker de otro proyecto/slug vivo: `demo.running` con el pid de quien corre el test (vivo en las dos corridas). */
const otroWriter = (leer = false) => (c: Contexto) => {
  escribir(path.join(c.estado, "w1.running"), "proyecto=demo\npid=1\n");
  escribir(path.join(c.estado, "demo.running"), `proyecto=demo\npid=${process.pid}\n${leer ? "leer=1\n" : ""}`);
};

const casosLatido: Caso[] = [
  la("pre de Bash escribe el heartbeat", bash("ls -la", { description: "listar" }), 0),
  la("post escribe envuelo=0", bash("ls -la"), 0, { fase: "post" }),
  la("sin heartbeat (hb vacío) no escribe nada", bash("ls"), 0, { hb: "" }),
  la("la descripción cae al archivo y al patrón", J({ tool_name: "Read", tool_input: { file_path: "/tmp/x.ts" } }), 0),
  la("descripción con saltos y tabs, y más de 160 bytes", bash("echo hola", { description: `uno\ndos\ttres\r${"ñ".repeat(100)}` }), 0),
  la("entrada que no es JSON", "esto no es json", 0),
  la("entrada vacía", "", 0),
  la("herramienta sin tool_input", J({ tool_name: "Task" }), 0),
  la("run_in_background se bloquea", bash("sleep 1", { run_in_background: true }), 2),
  la("run_in_background false pasa", bash("sleep 1", { run_in_background: false }), 0),
  la("release: cargo build --release", bash("cargo build --release", { timeout: 600000 }), 2, { env: { TRAMA_DUENO: "Ana" } }),
  la("release: cargo -r en una cadena", bash("cd x && cargo test -r", { timeout: 600000 }), 2),
  la("release: cargo install", bash("cargo install --path .", { timeout: 600000 }), 2),
  la("release: tauri build", bash("npx tauri build", { timeout: 600000 }), 2),
  la("release: pnpm tauri -- build", bash("tauri -- build", { timeout: 600000 }), 2),
  la("release: --aca lo deja pasar", bash("cargo build --release", { timeout: 600000 }), 0, { hb: "/tmp/__x__/demo@aca.heartbeat", preparar: () => {} }),
  la("release: el dueño sale de perfil.json", bash("cargo build --release", { timeout: 600000 }), 2, {
    env: (c) => ({ TRAMA_PERFIL: path.join(c.aux, "perfil.json") }),
    preparar: (c) => escribir(path.join(c.aux, "perfil.json"), J({ dueno: "Beto" })),
  }),
  la("release: sin dueño usa USER", bash("cargo build --release", { timeout: 600000 }), 2, { env: { USER: "marta", TRAMA_PERFIL: "/no/existe.json" } }),
  la("timeout: cargo test sin timeout", bash("cargo test"), 2),
  la("timeout: npm run build sin timeout", bash("npm run build"), 2),
  la("timeout: npx tsc sin timeout", bash("npx tsc -p ."), 2),
  la("timeout: pytest sin timeout", bash("pytest -x"), 2),
  la("timeout: go sin timeout", bash("go"), 2),
  la("timeout: con timeout pasa", bash("cargo test", { timeout: 600000 }), 0),
  la("timeout: ls no necesita timeout", bash("ls"), 0),
  la("stash: git stash", bash("git stash", { timeout: 1 }), 2),
  la("stash: git -C x stash push", bash("git -C /x stash push -m a"), 2),
  la("stash: git stash list pasa", bash("git stash list"), 0),
  la("stash: git stash show pasa", bash("git stash show -p"), 0),
  la("add: git add -A", bash("git add -A"), 2),
  la("add: git add .", bash("git add . && git status"), 2),
  la("add: git add --update", bash("git add --update"), 2),
  la("add: git add archivo pasa", bash("git add src/a.ts"), 0),
  la("commit: git commit -a", bash("git commit -a -m x"), 2),
  la("commit: git commit -am", bash("git commit -am x"), 2),
  la("commit: git commit --all", bash("git commit --all"), 2),
  la("commit: git commit -m pasa", bash("git commit -m x"), 0),
  la("clean: cargo clean", bash("cargo clean"), 2),
  la("clean: cargo +nightly clean", bash("cargo +nightly clean"), 2),
  la("deps: npm install con otro writer vivo", bash("npm install lodash"), 2, { hb: undefined, preparar: otroWriter() }),
  la("deps: pip install con otro writer vivo", bash("pip3 install requests"), 2, { preparar: otroWriter() }),
  la("deps: uv sync con otro writer vivo", bash("uv sync"), 2, { preparar: otroWriter() }),
  la("deps: npm install sin otro writer pasa", bash("npm install lodash"), 0, { preparar: (c) => escribir(path.join(c.estado, "w1.running"), "proyecto=demo\n") }),
  la("deps: el otro es --leer, pasa", bash("npm install lodash"), 0, { preparar: otroWriter(true) }),
  la("deps: sin .running propio pasa", bash("npm i x"), 0),
  la("deps: pid inexistente pasa", bash("npm i x"), 0, {
    preparar: (c) => {
      escribir(path.join(c.estado, "w1.running"), "proyecto=demo\n");
      escribir(path.join(c.estado, "demo@2.running"), "proyecto=demo\npid=999999999\n");
    },
  }),
  la("deps: pa_pid de un worker de la rama", bash("npm ci"), 2, {
    preparar: (c) => {
      escribir(path.join(c.estado, "w1.running"), "proyecto=demo\n");
      escribir(path.join(c.estado, "demo@2.running"), `proyecto=demo\npa_pid=${process.pid}\n`);
    },
  }),
  // --- recorte de la salida de los tests ---
  la("recorte: npm test con PA_RECORTE reescribe el comando", bash("npm test", { timeout: 300000, description: "tests" }), 0, { env: { PA_RECORTE: "150" } }),
  la("recorte: cargo test con comillas", bash("cargo test -p x -- --nocapture 'a b'", { timeout: 1 }), 0, { env: { PA_RECORTE: "40" } }),
  la("recorte: apagado (0)", bash("npm test", { timeout: 300000 }), 0, { env: { PA_RECORTE: "0" } }),
  la("recorte: con pipe no se toca", bash("npm test | tail -5", { timeout: 300000 }), 0, { env: { PA_RECORTE: "150" } }),
  la("recorte: encadenado no se toca", bash("npm test && echo listo", { timeout: 300000 }), 0, { env: { PA_RECORTE: "150" } }),
  la("recorte: no es un runner de tests", bash("ls", { timeout: 300000 }), 0, { env: { PA_RECORTE: "150" } }),
  la("recorte: en modo leer no corre (y bloquea por no ser git)", bash("npm test", { timeout: 300000 }), 2, { modo: "leer", env: { PA_RECORTE: "150" } }),
  // --- --leer: allowlist de git de lectura ---
  la("leer: git log pasa", bash("git log --oneline -5"), 0, { modo: "leer" }),
  la("leer: git -C x diff con pipe a head", bash("git -C /x diff HEAD | head -50"), 0, { modo: "leer" }),
  la("leer: git --no-pager show", bash("git --no-pager show HEAD"), 0, { modo: "leer" }),
  la("leer: ls se bloquea", bash("ls"), 2, { modo: "leer" }),
  la("leer: dos comandos con ;", bash("git log; git status"), 2, { modo: "leer" }),
  la("leer: redirección", bash("git log > /tmp/x"), 2, { modo: "leer" }),
  la("leer: sustitución", bash("git log $(echo HEAD)"), 2, { modo: "leer" }),
  la("leer: git diff --output", bash("git diff --output=/tmp/x"), 2, { modo: "leer" }),
  la("leer: git grep -O", bash("git grep -Oless x"), 2, { modo: "leer" }),
  la("leer: git branch --list", bash("git branch --list 'f*'"), 0, { modo: "leer" }),
  la("leer: git branch sin argumentos", bash("git branch"), 0, { modo: "leer" }),
  la("leer: git branch nombre suelto crea", bash("git branch nueva"), 2, { modo: "leer" }),
  la("leer: git branch -d", bash("git branch -d vieja"), 2, { modo: "leer" }),
  la("leer: git branch -vv", bash("git branch -vv"), 0, { modo: "leer" }),
  la("leer: git branch --delete --list", bash("git branch --list --delete x"), 2, { modo: "leer" }),
  la("leer: git worktree list", bash("git worktree list"), 0, { modo: "leer" }),
  la("leer: git worktree add", bash("git worktree add x"), 2, { modo: "leer" }),
  la("leer: git stash list", bash("git stash list"), 0, { modo: "leer" }),
  la("leer: git stash pop", bash("git stash pop"), 2, { modo: "leer" }),
  la("leer: git commit", bash("git commit -m x"), 2, { modo: "leer" }),
  la("leer: pipe a un filtro prohibido", bash("git log | sort -o x"), 2, { modo: "leer" }),
  la("leer: pipe final vacío", bash("git log |"), 0, { modo: "leer" }),
  la("leer: Read no se mira", J({ tool_name: "Read", tool_input: { file_path: "/x" } }), 0, { modo: "leer" }),
  la("leer: la guardia sólo corre en pre", bash("ls"), 0, { modo: "leer", fase: "post" }),
  // --- turnos y avisos (post) ---
  {
    herramienta: "latido",
    nombre: "latido: turnos: el aviso aparece cuando quedan 5 o menos",
    pasos: [
      pasoLatido(bash("ls"), 0, "post", { PA_MAX_TURNS: "7" }),
      pasoLatido(bash("ls"), 0, "post", { PA_MAX_TURNS: "7" }),
      pasoLatido(bash("ls"), 0, "post", { PA_MAX_TURNS: "7" }),
      pasoLatido(bash("ls"), 0, "post", { PA_MAX_TURNS: "7" }),
      pasoLatido(bash("ls"), 0, "post", { PA_MAX_TURNS: "7" }),
      pasoLatido(bash("ls"), 0, "post", { PA_MAX_TURNS: "7" }),
      pasoLatido(bash("ls"), 0, "post", { PA_MAX_TURNS: "7" }),
      pasoLatido(bash("ls"), 0, "post", { PA_MAX_TURNS: "7" }),
    ],
  },
  {
    herramienta: "latido",
    nombre: "latido: turnos: contador que ya existía (con basura)",
    preparar: (c) => escribir(hbDe(c) + ".turnos", "abc"),
    pasos: [pasoLatido(bash("ls"), 0, "post", { PA_MAX_TURNS: "3" }), pasoLatido(bash("ls"), 0, "post", { PA_MAX_TURNS: "3" })],
  },
  la("turnos: PA_MAX_TURNS no numérico no cuenta", bash("ls"), 0, { fase: "post", env: { PA_MAX_TURNS: "diez" } }),
  la("turnos: en pre no cuenta", bash("ls"), 0, { fase: "pre", env: { PA_MAX_TURNS: "3" } }),
  la("background: respuesta del harness manda aviso", J({ tool_name: "Bash", tool_input: { command: "cargo test" }, tool_response: "Command did not complete within its 120000ms timeout and was moved to the background" }), 0, { fase: "post" }),
  la("background: tool_response como objeto", J({ tool_name: "Bash", tool_input: { command: "x" }, tool_response: { stdout: "Command did not complete within its 2m timeout and was moved to the background", stderr: "" } }), 0, { fase: "post" }),
  la("background: la frase más allá de los 300 bytes no cuenta", J({ tool_name: "Bash", tool_input: { command: "cat BUGS.md" }, tool_response: `${"x".repeat(320)} did not complete within its timeout and was moved to the background` }), 0, { fase: "post" }),
  la("background: aviso y turnos juntos en un solo JSON", J({ tool_name: "Bash", tool_input: { command: "x" }, tool_response: "did not complete within its 120000ms timeout and was moved to the background" }), 0, { fase: "post", env: { PA_MAX_TURNS: "1" } }),
  la("background: sólo para Bash", J({ tool_name: "Read", tool_input: {}, tool_response: "did not complete within its timeout and was moved to the background" }), 0, { fase: "post" }),
];

// ============================================================================ destructive-guard

const dg = (nombre: string, stdin: string, rc: number, env?: Caso["env"], preparar?: Caso["preparar"]): Caso => ({ herramienta: "destructive-guard", nombre: `destructive-guard: ${nombre}`, stdin, rc, env, preparar, args: [] });
const cmdGuard = (nombre: string, comando: string, rc: number, env?: Caso["env"], preparar?: Caso["preparar"]) => dg(nombre, bash(comando, {}, { cwd: "/tmp" }), rc, env, preparar);

const guardJson = (c: Contexto, cfg: unknown) => escribir(path.join(c.aux, "guard.json"), J(cfg));
const conGuard = (c: Contexto) => ({ TRAMA_GUARD_CONFIG: path.join(c.aux, "guard.json") });

const casosGuard: Caso[] = [
  dg("no es Bash", J({ tool_name: "Read", tool_input: { file_path: "/etc/passwd" } }), 0),
  dg("JSON roto", "{no", 0),
  dg("entrada vacía", "", 0),
  dg("Bash sin comando", J({ tool_name: "Bash", tool_input: {} }), 0),
  cmdGuard("comando inocente", "ls -la && git status", 0),
  cmdGuard("rm -rf /", "rm -rf /", 2),
  cmdGuard("rm -rf ~/algo", "rm -rf ~/algo", 2),
  cmdGuard("rm -rf $HOME", "rm -fr $HOME", 2),
  cmdGuard("rm de un archivo suelto", "rm foo.txt", 0),
  cmdGuard("rm -f ./a (sin -r)", "rm -f ./a", 0),
  cmdGuard("rm -r .config", "rm -r -f .config/x", 2),
  cmdGuard("palabra terminada en rm", "farm -rf /", 0),
  cmdGuard("dd sobre un disco", "dd if=/dev/zero of=/dev/sda bs=1M", 2),
  cmdGuard("mkfs", "sudo mkfs.ext4 /dev/sdb1", 2),
  cmdGuard("redirección a un disco", "echo x > /dev/nvme0n1", 2),
  cmdGuard("shred", "shred -u secreto", 2),
  cmdGuard("truncate -s 0", "truncate -s 0 /var/log/x", 2),
  cmdGuard("pacman -R", "sudo pacman -Rns foo", 2),
  cmdGuard("git push --force", "git push --force origin main", 2),
  cmdGuard("git push -f", "git push -f", 2),
  cmdGuard("git push común", "git push origin main", 0),
  cmdGuard("chmod -R 777 /", "chmod -R 777 /", 2),
  cmdGuard("chown -R en la raíz", "chown -R root /", 2),
  cmdGuard("fork bomb", ":(){ :|:& };:", 2),
  cmdGuard("backup: rm en /run/media", "rm -r /run/media/u/BACKUP/viejo", 2),
  cmdGuard("backup: ls en /run/media pasa", "ls /run/media/u/BACKUP", 0),
  cmdGuard("backup: leer y copiar afuera pasa", "cat /run/media/u/BACKUP/x > /tmp/y", 0),
  cmdGuard("backup: redirección que pisa", "echo x > /run/media/u/USB/f", 2),
  cmdGuard("backup: mv a ~/backups", "mv a ~/backups/b", 2),
  cmdGuard("backup: find -delete", "find /media/x -name '*.old' -delete", 2),
  cmdGuard("backup: rsync --delete", "rsync -a --delete src/ /run/media/u/L/", 2),
  cmdGuard("backup: .papelera", "rm -rf .papelera", 2),
  cmdGuard("backup: montaje de la config", "rm -r /mnt/viejo/x", 2, conGuard, (c) => guardJson(c, { montajes: ["/mnt/viejo"] })),
  cmdGuard("backup: etiqueta de la config", "rm /dev/disk/by-label/MI-USB/x", 2, conGuard, (c) => guardJson(c, { etiquetas_usb: ["MI-USB"] })),
  cmdGuard("backup: desmontar el USB de la config", "udisksctl unmount -b /dev/disk/by-label/MI-USB", 2, conGuard, (c) => guardJson(c, { etiquetas_usb: ["MI-USB"] })),
  cmdGuard("backup: config que no es objeto", "ls", 0, conGuard, (c) => guardJson(c, [1, 2])),
  cmdGuard("congelado: montar con el marcador puesto", "udisksctl mount -b /dev/disk/by-label/CONGE", 2, conGuard, (c) => {
    escribir(path.join(c.aux, "CONGELADO"), "x");
    guardJson(c, { congelado: { etiqueta: "CONGE", marcador: path.join(c.aux, "CONGELADO"), patrones: ["recuperar-todo"] } });
  }),
  cmdGuard("congelado: patrón propio", "recuperar-todo ahora", 2, conGuard, (c) => {
    escribir(path.join(c.aux, "CONGELADO"), "x");
    guardJson(c, { congelado: { etiqueta: "CONGE", marcador: path.join(c.aux, "CONGELADO"), patrones: ["recuperar-todo"] } });
  }),
  cmdGuard("congelado: sin marcador pasa", "udisksctl mount -b /dev/disk/by-label/CONGE", 0, conGuard, (c) => guardJson(c, { congelado: { etiqueta: "CONGE", marcador: path.join(c.aux, "no-esta") } })),
  cmdGuard("congelado: forzado por entorno", "mount LABEL=CONGE /mnt", 2, (c) => ({ ...conGuard(c), TRAMA_GUARD_FORZAR_CONGELADO: "1" }), (c) => guardJson(c, { congelado: { etiqueta: "CONGE" } })),
  cmdGuard("congelado: bash -n queda exento", "bash -n ~/script.sh", 0, (c) => ({ ...conGuard(c), TRAMA_GUARD_FORZAR_CONGELADO: "1" }), (c) => guardJson(c, { congelado: { etiqueta: "CONGE", patrones: ["script"] } })),
  cmdGuard("congelado: bash -n encadenado no", "bash -n x.sh; script", 2, (c) => ({ ...conGuard(c), TRAMA_GUARD_FORZAR_CONGELADO: "1" }), (c) => guardJson(c, { congelado: { etiqueta: "CONGE", patrones: ["script"] } })),
  cmdGuard("RAM: CARGO_TARGET_DIR en /tmp", "CARGO_TARGET_DIR=/tmp/verif cargo test", 2),
  cmdGuard("RAM: --target-dir en /dev/shm", "cargo build --target-dir /dev/shm/x", 2),
  cmdGuard("RAM: --target-dir= con comillas", `cargo build --target-dir="/tmp/x"`, 2),
  cmdGuard("RAM: target en disco pasa", "CARGO_TARGET_DIR=$HOME/.cache/x cargo test", 0),
  cmdGuard("sesión: pkill sway", "pkill -f sway", 2),
  cmdGuard("sesión: killall Hyprland (mayúsculas)", "killall Hyprland", 2),
  cmdGuard("sesión: pgrep a xargs kill", "pgrep -a sway | xargs kill", 2),
  cmdGuard("sesión: kill con $(...)", "kill $(pgrep Hyprland)", 2),
  cmdGuard("sesión: hyprctl dispatch exit", "hyprctl dispatch exit", 2),
  cmdGuard("sesión: systemctl restart sddm", "sudo systemctl restart sddm.service", 2),
  cmdGuard("sesión: systemctl status gdm pasa", "systemctl status gdm", 0),
  cmdGuard("sesión: pkill de una app pasa", "pkill -f '^mpv foo'", 0),
  cmdGuard("sesión: kill de un pid pasa", "kill 12345", 0),
  cmdGuard("docker: --privileged", "docker run --privileged debian", 2, { TRAMA_DUENO: "Ana" }),
  cmdGuard("docker: -v /dev", "docker run -v /dev:/dev x", 2),
  cmdGuard("docker: -v / (ancestro)", "docker run -v /:/host:ro x", 2),
  cmdGuard("docker: -v de un volumen con nombre pasa", "docker run -v datos:/data x", 0),
  cmdGuard("docker: --mount source=/sys", "podman run --mount type=bind,source=/sys,target=/s x", 2),
  cmdGuard("docker: --cap-add CAP_SYS_ADMIN", "docker run --cap-add=CAP_SYS_ADMIN x", 2),
  cmdGuard("docker: --cap-add NET_ADMIN pasa", "docker run --cap-add NET_ADMIN x", 0),
  cmdGuard("docker: --pid=host", "docker run --pid=host x", 2),
  cmdGuard("docker: --security-opt unconfined", "docker run --security-opt seccomp=unconfined x", 2),
  cmdGuard("docker: --device /dev/kvm", "docker run --device /dev/kvm x", 2),
  cmdGuard("docker: --device /dev/net/tun pasa", "docker run --device /dev/net/tun x", 0),
  cmdGuard("docker: --init con un comando normal pasa", "docker run --init --rm debian sleep 1", 0),
  cmdGuard("docker: systemd como comando", "docker run debian /lib/systemd/systemd", 2),
  cmdGuard("docker: --entrypoint systemd", "docker run --entrypoint systemd debian", 2),
  cmdGuard("docker: exec systemd en un sh -c", "docker run debian sh -c 'exec systemd --system'", 2),
  cmdGuard("docker: detrás de sudo y env", "sudo env X=1 docker run --privileged x", 2),
  cmdGuard("docker: dentro de bash -c", `bash -c "docker run --privileged x"`, 2),
  cmdGuard("docker: en un $(...) entre comillas", `echo "$(docker run --privileged x)"`, 2),
  cmdGuard("docker: heredoc a un shell", "cat <<EOF | bash\ndocker run --privileged x\nEOF", 2),
  cmdGuard("docker: heredoc a cat con $(…) sin comillas", "cat <<EOF\n$(docker run --privileged x)\nEOF", 2),
  cmdGuard("docker: heredoc a cat con comillas pasa", "cat <<'EOF'\n$(docker run --privileged x)\nEOF", 0),
  cmdGuard("docker: eval", "eval docker run --privileged x", 2),
  cmdGuard("docker: --privileged=false pasa", "docker run --privileged=false x", 0),
  cmdGuard("docker: ps pasa", "docker ps -a", 0),
  cmdGuard("docker: build pasa", "docker build -t x .", 0),
  cmdGuard("docker: compose run con -v /sys", "docker-compose run -v /sys:/s x", 2),
  cmdGuard("docker: compose up sin archivo pasa", "docker compose -f /no/hay.yaml up", 0),
  cmdGuard("docker: la palabra en otro lado", "echo docker es lindo", 0),
  cmdGuard("docker: sin docker la guarda ni se carga", "echo hola", 0),
  cmdGuard("docker: cd literal no cambia el análisis", "cd /tmp && docker run --device=/dev/dri x", 2),
];

// ============================================================================ statusline-espejo

const SESION = "abc-123_XYZ";
const estadoLinea = (o: Record<string, unknown> = {}) =>
  J({
    session_id: SESION,
    cwd: "/home/u/proy",
    workspace: { current_dir: "/home/u/proy/sub" },
    model: { id: "claude-sonnet-5-5", display_name: "Sonnet" },
    prompt_cache: { ttl: 300 },
    rate_limits: { five_hour: { used_percentage: 12.5, resets_at: 1790000000 }, seven_day: { used_percentage: 40, resets_at: 1790500000 } },
    ...o,
  });
const ee = (nombre: string, stdin: string, args: string[] = [], rc = 0, env?: Caso["env"], preparar?: Caso["preparar"]): Caso => ({ herramienta: "statusline-espejo", nombre: `statusline-espejo: ${nombre}`, stdin, args, rc, env, preparar });

const casosEspejo: Caso[] = [
  ee("escribe la sesión y el historial", estadoLinea()),
  ee("workspace.current_dir gana a cwd", estadoLinea()),
  ee("sin workspace usa cwd", estadoLinea({ workspace: undefined })),
  ee("sin cwd ni workspace: null", estadoLinea({ workspace: undefined, cwd: undefined })),
  ee("sin modelo ni prompt_cache", estadoLinea({ model: undefined, prompt_cache: undefined })),
  ee("sin rate_limits: sólo la sesión", estadoLinea({ rate_limits: undefined })),
  ee("sólo la ventana de 5 h", estadoLinea({ rate_limits: { five_hour: { used_percentage: 3, resets_at: 1790000000 } } })),
  ee("rate_limits con porcentaje 0", estadoLinea({ rate_limits: { five_hour: { used_percentage: 0, resets_at: 1790000000 } } })),
  ee("con CLAUDE_CONFIG_DIR", estadoLinea(), [], 0, (c) => ({ CLAUDE_CONFIG_DIR: path.join(c.home, ".claude-2") })),
  ee("CLAUDE_CONFIG_DIR vacío es null", estadoLinea(), [], 0, { CLAUDE_CONFIG_DIR: "" }),
  ee("session_id con barras no se escribe", estadoLinea({ session_id: "../x" })),
  ee("session_id vacío", estadoLinea({ session_id: "" })),
  ee("sin session_id", estadoLinea({ session_id: undefined })),
  ee("session_id numérico", estadoLinea({ session_id: 42 })),
  ee("JSON roto", "{roto"),
  ee("entrada vacía", ""),
  ee("un JSON que no es objeto", "[1,2]"),
  ee("workspace que no es objeto: jq falla y no escribe", estadoLinea({ workspace: "x" })),
  {
    herramienta: "statusline-espejo",
    nombre: "statusline-espejo: el historial sólo suma cuando cambia algo",
    args: [],
    pasos: [
      { args: [], stdin: estadoLinea() },
      { args: [], stdin: estadoLinea() },
      { args: [], stdin: estadoLinea({ rate_limits: { five_hour: { used_percentage: 13, resets_at: 1790000000 }, seven_day: { used_percentage: 40, resets_at: 1790500000 } } }) },
      { args: [], stdin: estadoLinea({ session_id: "otra-sesion" }) },
    ],
  },
  {
    herramienta: "statusline-espejo",
    nombre: "statusline-espejo: la última línea del historial no es JSON",
    args: [],
    preparar: (c) => escribir(path.join(c.estado, "statusline", "historial.jsonl"), "basura\n"),
    pasos: [{ args: [], stdin: estadoLinea() }],
  },
  ee("el original recibe la entrada y su salida pasa", estadoLinea(), ["sh", "-c", "cat; echo; echo fin"]),
  ee("el código del original es el del hook", estadoLinea(), ["sh", "-c", "cat >/dev/null; exit 7"], 7),
  ee("bash -c con el statusline de la persona", estadoLinea(), ["bash", "-c", "jq -r '.model.display_name'"]),
];

// ============================================================================ agy-pa

/** El stdin de un caso: texto tal cual, o un objeto (o una función de él) pasado a JSON. */
const stdinDe = (s: unknown): Caso["stdin"] => {
  if (typeof s === "function") return (c: Contexto) => stdinDe((s as (c: Contexto) => unknown)(c)) as string;
  return typeof s === "string" ? s : J(s);
};
const agy = (nombre: string, fase: string, stdin: unknown, rc: number, env?: Caso["env"], preparar?: Caso["preparar"]): Caso => ({
  herramienta: "agy-pa",
  nombre: `agy-pa: ${nombre}`,
  args: [fase],
  stdin: stdinDe(stdin),
  rc,
  env,
  preparar,
});
const llamada = (name: string, args: Record<string, unknown> = {}) => ({ toolCall: { name, args } });
const ejecutar = (CommandLine: string, extra: Record<string, unknown> = {}) => llamada("run_command", { CommandLine, ...extra });
/** El entorno de un worker Gemini: heartbeat propio, worktree = el proyecto del sandbox. HOME fuera de /tmp para que las rutas de «casa» cuenten como prohibidas (sólo se miran como texto). */
const worker = (extra: Record<string, string> = {}) => (c: Contexto) => ({ PA_AGY_HB: hbDe(c, "agy"), PA_AGY_RAIZ: c.proyecto, PA_AGY_PPAL: path.join(c.aux, "principal"), PA_AGY_RAMA: "rama-x", HOME: "/home/trama-falso", ...extra });

const casosAgy: Caso[] = [
  agy("pre: sin worker y sin opinión no imprime nada", "pre", ejecutar("ls -la"), 0),
  agy("pre: sin worker, destructive-guard niega", "pre", ejecutar("rm -rf /"), 0),
  agy("pre: sin worker, una herramienta que no es run_command", "pre", llamada("view_file", { AbsolutePath: "/etc/passwd" }), 0),
  agy("post: sin worker", "post", ejecutar("ls"), 0),
  agy("post: con worker escribe el latido", "post", ejecutar("ls"), 0, worker()),
  agy("inv: sin worker", "inv", { invocationNum: 3 }, 0),
  agy("inv: con worker lejos del tope", "inv", { invocationNum: 3 }, 0, worker({ PA_MAX_TURNS: "30" })),
  agy("inv: cerca del tope inyecta el aviso", "inv", { invocationNum: 27 }, 0, worker({ PA_MAX_TURNS: "30" })),
  agy("inv: pasado el tope termina", "inv", { invocationNum: 31 }, 0, worker({ PA_MAX_TURNS: "30" })),
  agy("inv: sin PA_MAX_TURNS", "inv", { invocationNum: 31 }, 0, worker()),
  agy("worker: run_command inocuo escribe el latido y no opina", "pre", ejecutar("git status"), 0, worker()),
  agy("worker: herramienta fuera de la allowlist", "pre", llamada("browser_subagent", { Task: "x" }), 0, worker()),
  agy("worker: herramienta de lectura en modo leer", "pre", llamada("write_to_file", { TargetFile: "/tmp/x", CodeContent: "x" }), 0, worker({ PA_AGY_MODO: "leer" })),
  agy("worker: git de lectura en modo leer pasa", "pre", ejecutar("git log --oneline"), 0, worker({ PA_AGY_MODO: "leer" })),
  agy("worker: ls en modo leer lo bloquea latido", "pre", ejecutar("ls"), 0, worker({ PA_AGY_MODO: "leer" })),
  agy("worker: view_file fuera del worktree", "pre", llamada("view_file", { AbsolutePath: "/etc/passwd" }), 0, worker()),
  agy("worker: view_file en ~/.ssh", "pre", llamada("view_file", { AbsolutePath: "~/.ssh/id_rsa" }), 0, worker()),
  agy("worker: view_file con ../ saliendo", "pre", llamada("view_file", { AbsolutePath: "../../../etc/hosts" }), 0, worker()),
  agy("worker: view_file dentro del worktree pasa", "pre", llamada("view_file", { AbsolutePath: "src/a.ts" }), 0, worker()),
  agy("worker: list_dir en /tmp pasa", "pre", llamada("list_dir", { DirectoryPath: "/tmp/x" }), 0, worker()),
  agy("worker: grep_search con SearchPath fuera", "pre", llamada("grep_search", { SearchPath: "/home/otro", Query: "x" }), 0, worker()),
  agy("worker: find_by_name con glob", "pre", llamada("find_by_name", { SearchDirectory: "/etc/*", Pattern: "*.conf" }), 0, worker()),
  agy("worker: Cwd fuera del worktree", "pre", ejecutar("ls", { Cwd: "/etc" }), 0, worker()),
  agy("worker: Cwd con comillas y relativo", "pre", ejecutar("ls", { Cwd: '"sub"' }), 0, worker()),
  agy("worker: escribir dentro del worktree", "pre", (c: Contexto) => llamada("write_to_file", { TargetFile: path.join(c.proyecto, "a.txt"), CodeContent: "x" }), 0, worker()),
  agy("worker: escribir fuera del worktree", "pre", llamada("write_to_file", { TargetFile: "/home/otro/a.txt", CodeContent: "x" }), 0, worker()),
  agy("worker: escribir en /tmp pasa", "pre", llamada("replace_file_content", { TargetFile: "/tmp/a.txt" }), 0, worker()),
  agy("worker: escribir el mapa", "pre", llamada("write_to_file", { TargetFile: "/var/mapa/mapa.md" }), 0, worker({ PA_AGY_MAPA: "/var/mapa/mapa.md" })),
  agy("worker: escribir sin archivo", "pre", llamada("sed_file", {}), 0, worker()),
  agy("worker: send_command_input con una ruta fuera", "pre", llamada("send_command_input", { CommandId: "1", Input: "cat /etc/shadow\n" }), 0, worker()),
  agy("worker: run_command que lee ~/.config", "pre", ejecutar("cat ~/.config/trama/claves.env"), 0, worker()),
  agy("worker: run_command con $HOME", "pre", ejecutar("ls $HOME/.ssh"), 0, worker()),
  agy("worker: run_command con ../", "pre", ejecutar("cat ../../../../../../etc/secreto"), 0, worker()),
  agy("worker: run_command con $PWD/../", "pre", ejecutar("cat $PWD/../../../../../../etc/x"), 0, worker()),
  agy("worker: run_command con una variable rara", "pre", ejecutar("cat $FOO/x"), 0, worker()),
  agy("worker: run_command con glob en /etc", "pre", ejecutar("cat /etc/pas*"), 0, worker()),
  agy("worker: run_command con /tmp pasa", "pre", ejecutar("cat /tmp/x.log | head"), 0, worker()),
  agy("worker: el mensaje de un commit puede nombrar rutas", "pre", ejecutar(`git commit -m "arregla /etc/hosts y ~/.ssh"`), 0, worker()),
  agy("worker: cd sin argumento", "pre", ejecutar("cd && ls"), 0, worker()),
  agy("worker: cd a -", "pre", ejecutar("cd -"), 0, worker()),
  agy("worker: eval", "pre", ejecutar("eval ls"), 0, worker()),
  agy("worker: red con curl", "pre", ejecutar("curl https://ejemplo.com"), 0, worker()),
  agy("worker: red detrás de sudo", "pre", ejecutar("sudo ssh host"), 0, worker()),
  agy("worker: red con /dev/tcp", "pre", ejecutar("exec 3<>/dev/tcp/1.2.3.4/80"), 0, worker()),
  agy("worker: git clone", "pre", ejecutar("git clone https://x/y.git"), 0, worker()),
  agy("worker: npm publish", "pre", ejecutar("npm publish"), 0, worker()),
  agy("worker: git push", "pre", ejecutar("git push origin HEAD"), 0, worker()),
  agy("worker: git checkout de rama", "pre", ejecutar("git checkout otra"), 0, worker()),
  agy("worker: git checkout -- archivo pasa", "pre", ejecutar("git checkout -- a.ts"), 0, worker()),
  agy("worker: git reset --hard", "pre", ejecutar("git reset --hard HEAD~1"), 0, worker()),
  agy("worker: git branch -D", "pre", ejecutar("git branch -D x"), 0, worker()),
  agy("worker: git worktree add", "pre", ejecutar("git worktree add ../x"), 0, worker()),
  agy("worker: git rebase", "pre", ejecutar("git rebase main"), 0, worker()),
  agy("worker: git rebase permitido por entorno", "pre", ejecutar("git rebase main"), 0, worker({ PA_AGY_REBASE: "1" })),
  agy("worker: tocar el tree principal", "pre", (c: Contexto) => ejecutar(`cd ${path.join(c.aux, "principal")} && ls`), 0, worker()),
  agy("worker: latido bloquea git add -A", "pre", ejecutar("git add -A"), 0, worker()),
  agy("worker: latido bloquea cargo build --release", "pre", ejecutar("cargo build --release"), 0, worker()),
  agy("worker: latido reescribe los tests (PA_RECORTE)", "pre", ejecutar("npm test"), 0, worker({ PA_RECORTE: "100" })),
  agy("worker: entrada que no es JSON", "pre", "no-json", 0, worker()),
  agy("worker: herramienta desconocida con nombre raro", "pre", llamada("wait", { Seconds: 5 }), 0, worker()),
];

export const casosHooks: Caso[] = [...casosLatido, ...casosGuard, ...casosEspejo, ...casosAgy];

