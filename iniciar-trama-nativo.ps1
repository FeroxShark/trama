# Script para arrancar Trama nativo en segundo plano sin ninguna ventana de consola
$ErrorActionPreference = "SilentlyContinue"

# 1. Asegurar que el motor previo de WSL esté apagado
wsl.exe -e systemctl --user stop trama-motor 2>$null

# 2. Configurar entorno
$env:TRAMA_LOCAL = "1"
$env:TRAMA_PUERTO = "8791"
$env:PATH = "D:\trama\motor\bin;$env:PATH"

# 3. Comprobar si ya hay un motor respondiendo en 8791
$vivo = $false
try {
    $req = [System.Net.WebRequest]::Create("http://127.0.0.1:8791/rpc")
    $req.Timeout = 1000
    $req.Method = "POST"
    $req.ContentType = "application/json"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"metodo":"version","args":[]}')
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $resp = $req.GetResponse()
    $resp.Close()
    $vivo = $true
} catch {
    $vivo = $false
}

# 4. Si no está vivo, arrancar Node 100% oculto
if (-not $vivo) {
    Start-Process -FilePath "node.exe" -ArgumentList "dist-electron\motor.js" -WorkingDirectory "D:\trama\app" -WindowStyle Hidden
    Start-Sleep -Milliseconds 800
}

# 5. Si la ventana de Trama no está abierta, abrirla
$tramaProc = Get-Process -Name "Trama" -ErrorAction SilentlyContinue
if (-not $tramaProc) {
    $tramaExe = "$env:LOCALAPPDATA\Programs\trama-windows\Trama.exe"
    if (Test-Path $tramaExe) {
        Start-Process -FilePath $tramaExe
    }
}
