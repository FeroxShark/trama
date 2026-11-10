# Reglas: fondo

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Salida en vivo de una tarea de fondo

- **Salida en vivo de una tarea de fondo (`app/electron/tarea-salida.ts`, canal `tarea:salida`, se ve al desplegar una tarea en `app/src/hilo/Fondo.tsx`):** lee sólo el
final (16 KB, 200 líneas) de `<tmp>/claude[-<uid>]/<cwd>/<sid>/tasks/<id>.output` (la ruta sale de "Output is being written to:" del resultado), con la ruta
resuelta (`realpath.native`) antes de validar: un enlace o un `../` fuera de eso es `null`. El canal también lo llama el celular, así que NUNCA se le agrega lectura de
rutas libres. La salida de un Agent es un enlace al transcript (fuera del temporal): queda "sin salida todavía" a propósito. Sin polling en reposo: el `setTimeout`
(2 s) vive sólo mientras la fila está desplegada y la ventana visible. Variantes de captura: `HILOS_VARIANTE=fondo` / `fondo-abierto` en `lider-imagenes`.
