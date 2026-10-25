Set WshShell = CreateObject("WScript.Shell")
' 0 = Oculto, False = No esperar a que termine
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""D:\trama\iniciar-trama-nativo.ps1""", 0, False
