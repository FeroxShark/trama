# Trama en la laptop: local y la PC desde la misma app

Instalada el 2026-11-15 en `ferox-laptop-cachy` (CachyOS + Hyprland, Tailscale 100.77.225.62). Una sola app en la laptop muestra las
dos máquinas: sus filas (las de la laptop y las de la PC) en la misma barra, y el selector de máquina del chat nuevo
(`maquina.elegir`, `src/hilo/Lider.tsx`) deja elegir dónde arranca cada chat. No hay una segunda app: es el mecanismo de
`maquinas.json` (`electron/maquinas*.ts`, contrato en `electron/maquinas-contrato.ts`) más el acceso por la tailnet de `app/docs/remoto.md`.

- **Uso A (Trama local):** el motor de la laptop corre los líderes y workers de la laptop (dotfiles, config).
- **Uso B (la PC desde la laptop):** al elegir «PC» en el selector, el chat corre en la PC con sus proyectos, workers y tablero.
- La confianza va en un solo sentido: la laptop maneja la PC. La PC **no** tiene `maquinas.json` ni se conecta a la laptop.

## Instalación (sin sudo, el mismo camino que la PC)

Igual que la PC: clon fuente + `instalar-producto.sh`, así la app de la laptop se actualiza sola desde el cartel de versión nueva
(`~/.config/trama/checkout` apunta al clon, `electron/actualizacion-trama.ts`).

```bash
git clone https://github.com/FeroxShark/trama.git ~/.local/share/trama/fuente
cd ~/.local/share/trama/fuente && git checkout v0.2.95
# node con npm en ~/.local (el node de CachyOS no trae npm): tarball oficial LTS, enlazado en ~/.local/bin
bash motor/scripts/instalar-producto.sh --escritorio
```

Deja `claude`, `agy` y `dsh` (sin sudo), los enlaces `pa`, `tablero`, `reparto`… en `~/.local/bin`, los hooks en `~/.claude`,
la app compilada en `~/.local/share/trama/app`, `trama-motor.service` (habilitada, con `TRAMA_LOCAL=1`: interfaz sólo en
`127.0.0.1:8791`) y el lanzador `trama` + entrada del menú. Con `linger` activo el motor arranca con la máquina.
Para actualizar: la app (cartel «Actualizar») o `cd ~/.local/share/trama/fuente && git fetch --tags && git checkout <tag> && bash motor/scripts/instalar-producto.sh`.

## El camino hacia la PC

En la **laptop**, `~/.local/state/hilos/maquinas.json` (el motor lo lee al arrancar: `systemctl --user restart trama-motor`):

```json
{ "version": 1, "esta": "laptop", "nombre": "Laptop", "color": "#d9a441",
  "maquinas": [ { "id": "pc", "nombre": "PC", "url": "http://100.120.178.61:8791" } ] }
```

En la **PC**, `~/.local/state/hilos/remoto.json` lleva `ferox-laptop-cachy` en `dispositivos` (el motor de la PC lo relee solo,
sin reiniciar; la identidad la da `tailscale whois`: mismo usuario, sin etiquetas). Las dos tienen que hablar el mismo contrato
(`huella` igual; si no, la PC se ve en sólo lectura): comprobado igual en ambas (`8e8413e1a5f1`).

Comprobación por red desde la laptop (`maquina:saludo` por el `/rpc` de la PC, con un cliente hexadecimal de 8–64 caracteres):

```bash
curl -s -X POST http://100.120.178.61:8791/rpc -H 'Origin: http://100.120.178.61:8791' -H 'Content-Type: application/json' \
  -H 'x-trama-cliente: aaaaaaaaaaaaaaaaaaaaaaaa' -d '{"canal":"maquina:saludo","args":[]}'
```

y el estado visto por el motor de la laptop (`maquinas:leer`): `otras: [{id: "pc", fase: "conectada", acceso: "si"}]`.

## Límites conocidos

- En el chat nuevo, al elegir «PC» desde la laptop la lista de proyectos queda vacía (`proyectos:lista` es local): la carpeta se
  escribe a mano (`/home/ferox/Proyectos/…`, es la misma ruta en la PC). Ver DECISION de la corrida.
- Ajustes, programados, límites de cuenta y modelos son de cada máquina (`RUTAS` en `maquinas-contrato.ts`, «local»).
- Hay que iniciar sesión en `claude` en cada máquina (OAuth): nunca `ANTHROPIC_API_KEY`.
- Un `agy`/`dsh` sin sesión o sin claves en la laptop sólo afecta a workers que corran ahí.
