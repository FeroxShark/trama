# Pruebas de Trama nativo en un Windows real (Etapa W)

Lista corta y numerada de lo que tiene que probar una persona en un Windows real (sin WSL ni Git Bash):

1. **Instalar el .exe de la CI (artefacto `trama-nativo-windows`):**
   - Descargar el artefacto `trama-nativo-windows` generado por el flujo de CI en GitHub Actions (`.github/workflows/windows-exe.yml`), descomprimirlo y ejecutar el instalador `Trama-Nativo-Setup-<versión>.exe`.
   - **Qué debería ver:** El instalador (NSIS) se ejecuta como instalación por usuario en `%LOCALAPPDATA%` (sin solicitar permisos de administrador ni elevación UAC). Copia el payload nativo (con su `node.exe` empaquetado) a `%LOCALAPPDATA%\trama`, agrega `bin` al PATH de usuario, registra la clave Run en HKCU (`Software\Microsoft\Windows\CurrentVersion\Run`) para arrancar con la sesión en segundo plano, y abre Trama con el asistente de primer arranque.

2. **Defender y SmartScreen:**
   - Observar el comportamiento del sistema de seguridad al abrir el instalador descargado.
   - **Qué debería ver:** Al no contar con certificado comercial de pago, Windows SmartScreen puede mostrar la advertencia azul habitual («Windows protegió su PC»). Al hacer clic en «Más información» aparece el botón «Ejecutar de todas formas» y permite continuar. Windows Defender no debe bloquear, poner en cuarentena ni arrojar falsos positivos sobre el instalador, el ejecutable `node.exe` empaquetado ni los hooks `.mjs`.

3. **Login de Claude:**
   - En el asistente inicial o desde Ajustes > Cuentas, conectar la cuenta de Claude.
   - **Qué debería ver:** Si Claude Code ya inició sesión en la terminal de Windows (`%USERPROFILE%\.claude.json`), Trama detecta la sesión activa automáticamente. Si no, al pulsar «Conectar» abre la consola o el navegador para iniciar sesión; una vez autenticado, Trama muestra la cuenta conectada con su estado activo y cupos disponibles.

4. **Carpeta ~/.claude/projects:**
   - Acceder al listado de proyectos en Trama habiendo utilizado proyectos previos en Claude Code (`%USERPROFILE%\.claude\projects`).
   - **Qué debería ver:** Trama lista los proyectos existentes resolviendo adecuadamente las rutas nativas de Windows (como `C:\Users\...\Proyectos`), sin fallos por barras invertidas, rutas truncadas ni errores de codificación de caracteres.

5. **Detección de agy y dsh:**
   - Revisar en Ajustes > Modelos y Motores la disponibilidad y detección de Antigravity CLI (`agy`) y DeepSeek Harness (`dsh`).
   - **Qué debería ver:** Si `agy` o `dsh` están instalados en el PATH (como ejecutables o scripts `.cmd`), Trama los reconoce como disponibles y muestra sus modelos y opciones correspondientes. Si no están instalados, aparecen deshabilitados o con el aviso pertinente para instalarlos, sin romper la interfaz ni lanzar excepciones no controladas.

6. **Lanzar un worker:**
   - Ejecutar una tarea en un proyecto desde la terminal de Windows (`pa <proyecto> "<tarea>"`) o desde la interfaz de usuario.
   - **Qué debería ver:** Se crea el worktree correspondiente en la carpeta de estado, el motor en TypeScript corre el worker mediante `node.exe` de forma totalmente nativa (sin invocar bash, WSL ni jq), el tablero refleja el latido y estado de avance en tiempo real, y al concluir entrega el resultado de la tarea por stdout o en la interfaz, limpiando el entorno de trabajo.

7. **Actualizar:**
   - Buscar actualizaciones desde Ajustes > General o el menú de la aplicación.
   - **Qué debería ver:** El actualizador consulta el canal `nativo` (usando `nativo.yml` en los releases de GitHub y nunca el canal `latest.yml` de la versión de WSL). Si no hay versiones superiores, indica que Trama está al día; si se publica una versión nativa más nueva, la descarga en segundo plano y ofrece reiniciar para aplicarla.
