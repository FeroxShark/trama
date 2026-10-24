; Lo que electron-builder agrega al instalador/desinstalador NSIS de Trama.
;
; Al desinstalar (Aplicaciones de Windows), antes de borrar la carpeta de la app se llama a la propia Trama con
; --desinstalar: ella (src/limpieza.js + src/manifiesto.js) quita lo que dejó fuera de su carpeta, mostrando la lista
; y preguntando por los datos y por Ubuntu. El desinstalador de NSIS no puede hacer eso solo: no sabe de WSL.
; No corre en una actualización (isUpdated): ahí el instalador nuevo reemplaza al viejo y no se quita nada.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 +2
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --desinstalar'
  ${endIf}
!macroend
