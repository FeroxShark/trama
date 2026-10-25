<#
.SYNOPSIS
  pa — orquestador y delegador de tareas a workers en proyectos Git para Windows.
#>
[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [string]$ProyectoOComando,
    [Parameter(Position=1, ValueFromRemainingArguments=$true)]
    [string[]]$ArgumentosRestantes
)

$ErrorActionPreference = "Stop"

$BIN = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BASE_STATE = if ($env:PA_STATE) { $env:PA_STATE } else {
    $localApp = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path (if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }) ".local\state" }
    Join-Path $localApp "pa"
}
if (-not (Test-Path $BASE_STATE)) {
    New-Item -ItemType Directory -Path $BASE_STATE -Force | Out-Null
}

function Get-Dueno() {
    if ($env:TRAMA_DUENO) { return $env:TRAMA_DUENO }
    $cfg = if ($env:USERPROFILE) { Join-Path $env:USERPROFILE ".config\trama\perfil.json" } else { Join-Path $HOME ".config\trama\perfil.json" }
    if (Test-Path $cfg) {
        try {
            $j = Get-Content $cfg -Raw | ConvertFrom-Json
            if ($j.dueno) { return $j.dueno }
        } catch {}
    }
    if ($env:USERNAME) { return $env:USERNAME }
    return "el usuario"
}

# --- Subcomandos globales ---
if ($ProyectoOComando -eq "--hilos") {
    $esJson = $ArgumentosRestantes -contains "--json"
    $hilos = @()
    Get-ChildItem -Path $BASE_STATE -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $projDir = $_.FullName
        $projSlug = $_.Name
        if ($projSlug -notin @("worktrees", "lock", "jefe")) {
            Get-ChildItem -Path $projDir -Filter "*.json" -ErrorAction SilentlyContinue | ForEach-Object {
                $id = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
                $jsonFile = $_.FullName
                $hiloFile = Join-Path $projDir "$id.hilo"
                $corridaFile = Join-Path $projDir "$id.corrida"
                try {
                    $j = Get-Content $jsonFile -Raw | ConvertFrom-Json
                } catch { $j = $null }
                
                $h = @{}
                if (Test-Path $hiloFile) {
                    Get-Content $hiloFile | ForEach-Object {
                        $p = $_.Split('=', 2)
                        if ($p.Length -eq 2) { $h[$p[0]] = $p[1] }
                    }
                }
                
                $c = @{}
                if (Test-Path $corridaFile) {
                    Get-Content $corridaFile | ForEach-Object {
                        $p = $_.Split('=', 2)
                        if ($p.Length -eq 2) { $c[$p[0]] = $p[1] }
                    }
                }
                
                $estado = if ($h["estado"]) { $h["estado"] } elseif ($j) { "listo" } else { "murio" }
                $hilos += [pscustomobject]@{
                    id = $id
                    proyecto = $projSlug
                    tarea = if ($h["tarea"]) { $h["tarea"] } else { $j.task }
                    modelo = if ($h["modelo"]) { $h["modelo"] } else { $j.model }
                    effort = $h["effort"]
                    origen = if ($h["lanzo"]) { $h["lanzo"] } else { "jefe" }
                    estado = $estado
                    resultado = $j.result
                    rama = if ($c["rama"]) { $c["rama"] } else { $h["rama"] }
                }
            }
        }
    }
    $res = [pscustomobject]@{
        version = 1
        hilos = $hilos
    }
    if ($esJson) {
        $res | ConvertTo-Json -Depth 5
    } else {
        foreach ($h in $hilos) {
            Write-Host "$($h.id)`t$($h.estado)`t$($h.proyecto)`t$($h.tarea)"
        }
    }
    exit 0
}

if ($ProyectoOComando -eq "--modelos") {
    $esJson = $ArgumentosRestantes -contains "--json"
    $res = [pscustomobject]@{
        lider = "claude-sonnet-5-5"
        workers = [pscustomobject]@{
            default = "claude-sonnet-5-5"
            mecanico = "claude-haiku-5-5"
        }
    }
    if ($esJson) {
        $res | ConvertTo-Json
    } else {
        Write-Host "lider: claude-sonnet-5-5"
        Write-Host "workers (default): claude-sonnet-5-5 (high)"
        Write-Host "workers (mecanico): claude-haiku-5-5 (xhigh)"
    }
    exit 0
}

if ($ProyectoOComando -eq "--estado") {
    Write-Host "pa (Windows Nativo): activo."
    exit 0
}

if ($ProyectoOComando -eq "--parar") {
    $id = $ArgumentosRestantes[0]
    if (-not $id) {
        [Console]::Error.WriteLine("uso: pa --parar <id>")
        exit 2
    }
    $parado = $false
    Get-ChildItem -Path $BASE_STATE -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $projDir = $_.FullName
        $pidFile = Join-Path $projDir "$id.pid"
        $hiloFile = Join-Path $projDir "$id.hilo"
        if (Test-Path $pidFile) {
            try {
                $p = Get-Content $pidFile -Raw
                $targetPid = [int]$p.Trim()
                Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
                $parado = $true
            } catch {}
            Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path $hiloFile) {
            $finEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            Add-Content -Path $hiloFile -Value "fin=$finEpoch" -Encoding utf8
        }
    }
    Write-Host "pa: corrida $id parada."
    exit 0
}

if ($ProyectoOComando -eq "--hilo") {
    $id = $ArgumentosRestantes[0]
    if (-not $id) {
        [Console]::Error.WriteLine("uso: pa --hilo <id> [--json] [-n N] [--antes N]")
        exit 2
    }
    $targetFile = $null
    $projSlug = ""
    Get-ChildItem -Path $BASE_STATE -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $candidate = Join-Path $_.FullName "$id.json"
        if (Test-Path $candidate) {
            $targetFile = $candidate
            $projSlug = $_.Name
        }
    }
    
    $mensajes = @()
    $modelo = $null
    $usage = $null
    if ($targetFile) {
        try {
            $j = Get-Content $targetFile -Raw | ConvertFrom-Json
            if ($j.model) { $modelo = $j.model }
            if ($j.usage) { $usage = $j.usage }
            if ($j.result) {
                $mensajes += [pscustomobject]@{
                    i = 0
                    rol = "assistant"
                    texto = [string]$j.result
                    herramientas = @()
                    herramientas_det = @()
                    imagenes = 0
                    ts = (Get-Date -Format "o")
                    modelo = $modelo
                }
            }
        } catch {}
    }
    
    $res = [pscustomobject]@{
        version = 1
        id = $id
        proyecto = $projSlug
        transcript = $null
        total = $mensajes.Count
        desde = 0
        hasta = $mensajes.Count
        mensajes = $mensajes
        usage = $usage
        modelo = $modelo
    }
    $res | ConvertTo-Json -Depth 6
    exit 0
}

if (-not $ProyectoOComando -or $ProyectoOComando -in @("-h", "--help", "--ayuda")) {
    Write-Host "uso: pa <proyecto> [--tipo <tipo>] [--leer] [--async] [-m <modelo>] <tarea>"
    Write-Host "     pa <proyecto> --integrar <id>"
    Write-Host "     pa <proyecto> --actualizar <id>"
    Write-Host "     pa <proyecto> --ramas"
    Write-Host "     pa <proyecto> --descartar <id>"
    Write-Host "     pa --hilos [--json]"
    Write-Host "     pa --modelos [--json]"
    Write-Host "     pa --estado"
    exit 0
}

# Resolver proyecto con proyecto-ruta.ps1
$proyectoRutaScript = Join-Path $BIN "proyecto-ruta.ps1"
$resolvedRuta = & $proyectoRutaScript $ProyectoOComando
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $resolvedRuta)) {
    [Console]::Error.WriteLine("pa: no se pudo resolver el proyecto '$ProyectoOComando'")
    exit 1
}

$slug = Split-Path $resolvedRuta -Leaf
$projState = Join-Path $BASE_STATE $slug
if (-not (Test-Path $projState)) {
    New-Item -ItemType Directory -Path $projState -Force | Out-Null
}

# Subcomandos de proyecto
if ($ArgumentosRestantes -contains "--ramas") {
    git -C $resolvedRuta branch --list "pa/$slug/*"
    exit 0
}

if ($ArgumentosRestantes -contains "--integrar") {
    $idx = [array]::IndexOf($ArgumentosRestantes, "--integrar")
    $id = $ArgumentosRestantes[$idx + 1]
    $rama = "pa/$slug/$id"
    Write-Host "pa: integrando $rama en $slug..."
    git -C $resolvedRuta merge --ff-only $rama
    if ($LASTEXITCODE -eq 0) {
        Write-Host "pa: $rama integrada con éxito."
    } else {
        [Console]::Error.WriteLine("pa: conflicto o error al integrar $rama.")
        exit 80
    }
    exit 0
}

if ($ArgumentosRestantes -contains "--actualizar") {
    $idx = [array]::IndexOf($ArgumentosRestantes, "--actualizar")
    $id = $ArgumentosRestantes[$idx + 1]
    $rama = "pa/$slug/$id"
    Write-Host "pa: actualizando $rama con los cambios recientes..."
    $baseBranch = (git -C $resolvedRuta rev-parse --abbrev-ref HEAD).Trim()
    git -C $resolvedRuta checkout $rama
    git -C $resolvedRuta rebase $baseBranch
    git -C $resolvedRuta checkout $baseBranch
    exit $LASTEXITCODE
}

if ($ArgumentosRestantes -contains "--descartar") {
    $idx = [array]::IndexOf($ArgumentosRestantes, "--descartar")
    $id = $ArgumentosRestantes[$idx + 1]
    $rama = "pa/$slug/$id"
    Write-Host "pa: descartando rama $rama..."
    git -C $resolvedRuta branch -D $rama
    exit 0
}

# Ejecución de tarea de worker
$tipo = "codigo-acotado"
$modelo = "claude-sonnet-5-5"
$tarea = ""
for ($i = 0; $i -lt $ArgumentosRestantes.Count; $i++) {
    $arg = $ArgumentosRestantes[$i]
    if ($arg -eq "--tipo" -and ($i + 1) -lt $ArgumentosRestantes.Count) {
        $tipo = $ArgumentosRestantes[++$i]
    } elseif ($arg -eq "-m" -and ($i + 1) -lt $ArgumentosRestantes.Count) {
        $modelo = $ArgumentosRestantes[++$i]
    } else {
        $tarea = $arg
    }
}

if (-not $tarea) {
    [Console]::Error.WriteLine("pa: falta la tarea para el proyecto '$slug'")
    exit 2
}

$id = Get-Date -Format "yyyyMMdd-HHmmss"
$rama = "pa/$slug/$id"
$worktreeDir = Join-Path $BASE_STATE "worktrees\$slug-$id"

Write-Host "pa: creando puesto de trabajo en $worktreeDir (rama $rama)..."
git -C $resolvedRuta worktree add -b $rama $worktreeDir HEAD 2>&1 | Out-Null

$contrato = @"
Te delegó una tarea el orquestador de $(Get-Dueno) en el proyecto $slug.
Respondé corto, en este formato exacto:
RESULTADO: 1-3 oraciones de qué hiciste o qué encontraste.
ARCHIVOS: rutas que tocaste, o "ninguno".
DECISION: qué tiene que decidir el usuario, o "nada".
SIGUE: una línea con el próximo paso del proyecto si el trabajo sigue, o "nada" si quedó cerrado.
"@

$prompt = "$contrato`n`nTAREA: $tarea"
$outFile = Join-Path $projState "$id.json"

$inicio = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

$claudeBin = if (Get-Command "claude.cmd" -ErrorAction SilentlyContinue) { "claude.cmd" } elseif (Get-Command "claude.exe" -ErrorAction SilentlyContinue) { "claude.exe" } elseif (Get-Command "claude" -ErrorAction SilentlyContinue) { "claude" } else { "claude" }
$sw = [System.Diagnostics.Stopwatch]::StartNew()

try {
    Push-Location $worktreeDir
    & $claudeBin -p $prompt --output-format json | Out-File -FilePath $outFile -Encoding utf8
    $rc = $LASTEXITCODE
} finally {
    Pop-Location
    $sw.Stop()
}

$duracion = [math]::Floor($sw.Elapsed.TotalSeconds)

@"
id=$id
slug=$slug
inicio=$inicio
duracion_s=$duracion
modelo=$modelo
tipo=$tipo
rama=$rama
"@ | Out-File -FilePath (Join-Path $projState "$id.hilo") -Encoding utf8

@"
rama=$rama
base=HEAD
ruta_trabajo=$resolvedRuta
"@ | Out-File -FilePath (Join-Path $projState "$id.corrida") -Encoding utf8

if (Test-Path $outFile) {
    try {
        $outObj = Get-Content $outFile -Raw | ConvertFrom-Json
        Write-Host $outObj.result
    } catch {
        Get-Content $outFile
    }
}

Write-Host "— rama $rama: 1 commit(s). NO está en main hasta que la integres: pa '$slug' --integrar $id"
exit $rc
