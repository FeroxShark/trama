# Humo de la Trama nativa de Windows (instalación per-user, %LOCALAPPDATA%\Programs\trama-windows).
# Lo corre el dueño por SSH en la PC con Trama instalada:
#   powershell -NoProfile -ExecutionPolicy Bypass -File humo-gonza.ps1
# PowerShell 5.1, sin módulos. Corre cada herramienta con 60 s de tope y anota el código y si la salida trae
# "ENOENT" o "todavía no está". Después lanza un worker de prueba en un repo git temporal (sólo si hay claude
# en el PATH), revisa las últimas 200 líneas de trama.log y cierra con una tabla OK/FALLA. Exit 0 sólo si todo OK.
# No lee el archivo de credenciales de Claude ni imprime tokens: lo que muestra de una salida pasa por Redactar().

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$segundosHerramienta = 60
$segundosWorker = 300
$raizTrama = Join-Path $env:LOCALAPPDATA 'trama'
$bin = Join-Path $raizTrama 'bin'
# El log de la app sale de estadoHilos() en app/electron/rutas.ts: %LOCALAPPDATA%\trama\estado\hilos.
$logTrama = Join-Path $raizTrama 'estado\hilos\trama.log'
$tabla = New-Object System.Collections.ArrayList
# Marcas que delatan un fallo aunque el código sea 0. La de "todavía no está" va escapada para regex.
$marcas = [ordered]@{
    'ENOENT'          = 'ENOENT'
    'todavía no está' = [regex]::Escape('todavía no está')
}

function Anotar([string]$chequeo, [string]$estado, [string]$detalle) {
    [void]$script:tabla.Add([pscustomobject]@{ Chequeo = $chequeo; Estado = $estado })
    Write-Host ("  {0,-20} {1,-8} {2}" -f $chequeo, $estado, $detalle)
}

function Redactar([string]$texto) {
    $t = [regex]::Replace($texto, 'sk-[A-Za-z0-9_\-]{8,}|eyJ[A-Za-z0-9_\-\.]{10,}|Bearer\s+\S+', '[redactado]')
    if ($t.Length -gt 160) { $t = $t.Substring(0, 160) + '...' }
    return $t
}

# Las primeras `max` líneas del texto que calzan con alguna de las regex, redactadas.
function Lineas([string]$texto, [string[]]$patrones, [int]$max = 3) {
    $out = @()
    foreach ($l in ($texto -split '\r?\n')) {
        foreach ($p in $patrones) {
            if ($l -match $p) { $out += (Redactar $l); break }
        }
        if ($out.Count -ge $max) { break }
    }
    return $out
}

# Corre un .cmd de bin\ con cmd.exe (así anda el shim), con tope de segundos. stdin cerrado para que nada espere.
function Correr([string]$ruta, [string[]]$argumentos, [int]$segundos, [hashtable]$entorno = @{}) {
    $r = [pscustomobject]@{ Codigo = $null; Timeout = $false; Texto = '' }
    if (-not (Test-Path -LiteralPath $ruta)) { $r.Texto = "no existe $ruta"; return $r }
    $lineaArgs = ($argumentos | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = '/d /s /c ""' + $ruta + '" ' + $lineaArgs + '"'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
    $psi.WorkingDirectory = $env:TEMP
    foreach ($k in $entorno.Keys) { $psi.EnvironmentVariables[$k] = [string]$entorno[$k] }
    $p = [System.Diagnostics.Process]::Start($psi)
    $p.StandardInput.Close()
    $tOut = $p.StandardOutput.ReadToEndAsync()
    $tErr = $p.StandardError.ReadToEndAsync()
    if ($p.WaitForExit($segundos * 1000)) {
        $r.Codigo = $p.ExitCode
    }
    else {
        $r.Timeout = $true
        & taskkill.exe /PID $p.Id /T /F *> $null
        [void]$p.WaitForExit(5000)
    }
    $partes = @()
    if ($tOut.Wait(5000)) { $partes += $tOut.Result }
    if ($tErr.Wait(5000)) { $partes += $tErr.Result }
    $r.Texto = $partes -join "`n"
    $p.Dispose()
    return $r
}

Write-Host ("Humo de la Trama nativa: " + (Get-Date -Format 's') + "  (PowerShell " + $PSVersionTable.PSVersion + ")")

# 1. Versión instalada: el package.json del payload (el mismo que app.getVersion()).
Write-Host ''
Write-Host 'Versión:'
$version = $null
$origenVersion = $null
foreach ($c in @((Join-Path $raizTrama 'app\package.json'), (Join-Path $env:LOCALAPPDATA 'Programs\trama-windows\resources\payload-nativo\app\package.json'))) {
    if (Test-Path -LiteralPath $c) {
        try {
            $version = (Get-Content -LiteralPath $c -Raw -Encoding UTF8 | ConvertFrom-Json).version
            $origenVersion = $c
            break
        }
        catch { }
    }
}
if ($version) { Anotar 'version' 'OK' "Trama $version ($origenVersion)" }
else { Anotar 'version' 'FALLA' 'no encontré app\package.json de la instalación' }

# 2. Herramientas de la línea de comandos, cada una con su tope.
$herramientas = @(
    @{ Nombre = 'pa --estado';       Exe = 'pa';      Argumentos = @('--estado') },
    @{ Nombre = 'pa --hilos';        Exe = 'pa';      Argumentos = @('--hilos') },
    @{ Nombre = 'pa --proyectos';    Exe = 'pa';      Argumentos = @('--proyectos') },
    @{ Nombre = 'pa --rinde';        Exe = 'pa';      Argumentos = @('--rinde') },
    @{ Nombre = 'pa --modelos';      Exe = 'pa';      Argumentos = @('--modelos') },
    @{ Nombre = 'pa --cupo-gemini';  Exe = 'pa';      Argumentos = @('--cupo-gemini') },
    @{ Nombre = 'reparto --resumen'; Exe = 'reparto'; Argumentos = @('--resumen') },
    @{ Nombre = 'reparto --cupos';   Exe = 'reparto'; Argumentos = @('--cupos') },
    @{ Nombre = 'cuentas --json';    Exe = 'cuentas'; Argumentos = @('--json') },
    @{ Nombre = 'tablero resumen';   Exe = 'tablero'; Argumentos = @('resumen') }
)
Write-Host ''
Write-Host "Herramientas (tope $segundosHerramienta s cada una):"
foreach ($h in $herramientas) {
    $ruta = Join-Path $bin ($h.Exe + '.cmd')
    $r = Correr -ruta $ruta -argumentos $h.Argumentos -segundos $segundosHerramienta
    $enoent = $r.Texto -match 'ENOENT'
    $todavia = $r.Texto -match $marcas['todavía no está']
    $ok = (-not $r.Timeout) -and ($r.Codigo -eq 0) -and (-not $enoent) -and (-not $todavia)
    if ($r.Timeout) { $codigo = "timeout $segundosHerramienta s" }
    elseif ($null -eq $r.Codigo) { $codigo = 'sin código' }
    else { $codigo = "código $($r.Codigo)" }
    $detalle = "$codigo; ENOENT: $(if ($enoent) { 'sí' } else { 'no' }); todavía no está: $(if ($todavia) { 'sí' } else { 'no' })"
    if (-not $ok -and -not $r.Timeout) {
        $ex = @(Lineas -texto $r.Texto -patrones @('ENOENT', $marcas['todavía no está']) -max 2)
        if ($ex.Count -eq 0) { $ex = @($r.Texto -split '\r?\n' | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 2 | ForEach-Object { Redactar $_ }) }
        $detalle += ' | ' + ($ex -join ' / ')
    }
    $estado = if ($ok) { 'OK' } else { 'FALLA' }
    Anotar $h.Nombre $estado $detalle
}

# 3. Worker de prueba en un repo git temporal, sólo si hay claude en el PATH. Espera la respuesta.
Write-Host ''
Write-Host 'Worker de prueba:'
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Anotar 'worker de prueba' 'OMITIDO' 'no hay claude en el PATH: no lanzo el worker'
}
elseif (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Anotar 'worker de prueba' 'FALLA' 'no hay git en el PATH: no armo el repo temporal'
}
else {
    $sufijo = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $tmp = Join-Path $env:TEMP ('trama-humo-' + $sufijo)
    $repo = Join-Path $tmp 'repo'
    $registro = Join-Path $tmp 'registry.json'
    $proyecto = 'humo-tmp-' + $sufijo
    try {
        New-Item -ItemType Directory -Path $repo -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $repo 'README.md') -Value 'repo temporal del humo de Trama' -Encoding ASCII
        & git -C $repo init -q *> $null
        & git -C $repo add README.md *> $null
        & git -C $repo -c user.name=humo -c user.email=humo@localhost commit -q -m inicial *> $null
        if ($LASTEXITCODE -ne 0) { throw "git no pudo hacer el commit inicial (código $LASTEXITCODE)" }
        # Registry propio por PROYECTOS_REGISTRY: el de la PC no se toca.
        $json = '{"projects":[{"name":"' + $proyecto + '","path":"' + $repo.Replace('\', '\\') + '"}]}'
        [IO.File]::WriteAllText($registro, $json, (New-Object -TypeName Text.UTF8Encoding -ArgumentList $false))
        $r = Correr -ruta (Join-Path $bin 'pa.cmd') -argumentos @($proyecto, '--leer', 'decí OK') -segundos $segundosWorker -entorno @{ PROYECTOS_REGISTRY = $registro }
        $lineas = @($r.Texto -split '\r?\n' | Where-Object { $_.Trim() -ne '' })
        $primera = ''
        if ($lineas.Count -gt 0) { $primera = Redactar $lineas[0] }
        $respondio = $r.Texto -match '(?i)\bok\b'
        $sinMarcas = (-not ($r.Texto -match 'ENOENT')) -and (-not ($r.Texto -match $marcas['todavía no está']))
        $ok = (-not $r.Timeout) -and ($r.Codigo -eq 0) -and $respondio -and $sinMarcas
        if ($r.Timeout) { $codigo = "timeout $segundosWorker s" } else { $codigo = "código $($r.Codigo)" }
        $estado = if ($ok) { 'OK' } else { 'FALLA' }
        Anotar 'worker de prueba' $estado "$codigo; respondió OK: $(if ($respondio) { 'sí' } else { 'no' }); primera línea: $primera"
    }
    catch {
        Anotar 'worker de prueba' 'FALLA' (Redactar $_.Exception.Message)
    }
    finally {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 4. Log propio de la app: las últimas 200 líneas, sin marcas de fallo.
Write-Host ''
Write-Host 'Log de Trama:'
if (-not (Test-Path -LiteralPath $logTrama)) {
    Anotar 'trama.log' 'OK' "no existe $logTrama: no se escribió ningún error"
}
else {
    $ultimas = @(Get-Content -LiteralPath $logTrama -Tail 200 -Encoding UTF8)
    $hits = @($ultimas | Where-Object { $_ -match 'ENOENT|canal desconocido|todavía no está' })
    if ($hits.Count -eq 0) {
        Anotar 'trama.log' 'OK' 'últimas 200 líneas sin ENOENT, canal desconocido ni todavía no está'
    }
    else {
        $muestra = @($hits | Select-Object -First 2 | ForEach-Object { Redactar $_ })
        Anotar 'trama.log' 'FALLA' ("$($hits.Count) línea(s) con marca: " + ($muestra -join ' / '))
    }
}

# 5. Tabla final. Exit 0 sólo si todo está OK (OMITIDO cuenta como no OK).
Write-Host ''
$ancho = 0
foreach ($t in $tabla) { if ($t.Chequeo.Length -gt $ancho) { $ancho = $t.Chequeo.Length } }
Write-Host ("{0,-$ancho}  {1}" -f 'CHEQUEO', 'ESTADO')
foreach ($t in $tabla) { Write-Host ("{0,-$ancho}  {1}" -f $t.Chequeo, $t.Estado) }
$noOk = @($tabla | Where-Object { $_.Estado -ne 'OK' }).Count
if ($noOk -eq 0) {
    Write-Host 'Todo OK.'
    exit 0
}
Write-Host "$noOk chequeo(s) no OK."
exit 1
