# Reglas: procesos

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Build nuevo con motor

- **Build nuevo con motor:** la ventana cliente compara la huella del build (`selloDe`) al arrancar; un `resinc` sin `saliendo` con build cambiado relanza la ventana (`vueltaDelMotor`, `electron/relanzar.ts`), y si no se puede saber, sólo recarga la página. Un canal nuevo del main que la ventana vieja no tiene hace rechazar el pedido: `resultadoCarpeta` lo distingue de «no es una carpeta» y dice que hay que reiniciar Trama.

## El `.pid` de una corrida

- **`<id>.pid` de una corrida:** nunca preguntes `kill0`/`vivo` sobre ese número a secas: pasa por `pidDeCorrida` (`app/electron/cli/base/proc.ts`;
atajos `pidCorridaVivo` y `corridaEnCola` en `cli/pa/corridas.ts`; respaldo bash: `pid_de_corrida` en `motor/bin/pa`). Un pid viejo puede ser el TID de un hilo
ajeno o un pid reciclado, y `--parar` mataría a otro programa. Es de la corrida si es proceso (Linux: Tgid == Pid), no zombie y arrancó a más tardar 2 s
después del mtime del `.pid` (el padre lo escribe después de lanzar al hijo). Fin de una corrida: `.listo` / `.entregado` (el `.json` NO: existe desde que arranca).

## El `.running` de un worker

- **`<proyecto>.running` de un worker:** mismo criterio que el `.pid`, y sólo por `pidDeRunning` / `pidDeCampoRunning` (`cli/base/proc.ts`; atajo `runningVivo` en
`cli/pa/corridas.ts`; respaldo bash: `vivo` en `motor/bin/pa`). Nunca `kill0`/`vivo` sobre el `pid=` o `pa_pid=` a secas: un `.running` huérfano (pa o Trama
muertos a lo bruto, en Windows `taskkill /F` no corre el trap) lleva un número que otro programa recicló. Sin proceso real la fila dice `murio`, `pa --parar` cierra el
rastro (anota `fin=`, borra el `.running`) y `--matar` nunca señala un pid no validado. El límite de sesión (76) NO deja zombis: `pa` sale limpio (el trap borra el
`.running`, deja `.listo` y `fin`), escribe `limite-<cuenta>` y nada reanuda solo cuando vuelve la cuota; sólo `-m a,b,c` pasa al siguiente modelo en esa misma corrida.

## Dónde está el motor para `pa`

- **Dónde está el motor para `pa`:** `resolverMotor` (`app/electron/cli/pa/entorno.ts`) lo busca en este orden: `TRAMA_MOTOR_DIR`, `<raíz>/motor` (checkout, worktree),
el payload de Windows (`<raíz>\bin` + `app\hooks`, sin carpeta `motor`), `<raíz>/fuente/motor` (instalación de escritorio de Linux: la app compilada vive en
`~/.local/share/trama/app`), el checkout anotado en `~/.config/trama/checkout` y el enlace de `~/.local/bin/pa`. Todo lo que `pa` lanza del motor (`reparto`,
`tablero`, `cuentas`, `repos-empujar`, hooks de latido y guardia) cuelga de `pa.bin`/`pa.hooks`; si falta, `avisarFalta` lo dice por stderr (nunca callado).
Nada de `path.join(…, "..", "motor")` suelto. Si un worker sale siempre con el modelo por defecto, mirá primero el aviso «pa: no encuentro …».
