<#
.SYNOPSIS
  proyecto-ruta <nombre> — resuelve el nombre de un proyecto a su RUTA REAL canónica en Windows.
#>
[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [string]$Nombre,
    [switch]$Listar
)

$registry = if ($env:PROYECTOS_REGISTRY) {
    $env:PROYECTOS_REGISTRY
} else {
    $base = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
    Join-Path $base ".config\proyectos\registry.json"
}

if (-not (Test-Path $registry)) {
    [Console]::Error.WriteLine("no existe el registry: $registry")
    exit 1
}

try {
    $raw = Get-Content $registry -Raw -ErrorAction Stop
    $json = $raw | ConvertFrom-Json -ErrorAction Stop
} catch {
    [Console]::Error.WriteLine("error al leer el registry: $_")
    exit 1
}

if ($Listar -or $Nombre -eq "--listar") {
    if ($json.projects) {
        $json.projects | ForEach-Object { $_.name } | Sort-Object -Unique
    }
    exit 0
}

if (-not $Nombre) {
    [Console]::Error.WriteLine("uso: proyecto-ruta <nombre> | --listar")
    exit 2
}

# 1. Match exacto
$proj = $json.projects | Where-Object { $_.name -ceq $Nombre } | Select-Object -First 1

# 2. Match exacto sin distinguir mayúsculas
if (-not $proj) {
    $proj = $json.projects | Where-Object { $_.name -ieq $Nombre } | Select-Object -First 1
}

# 3. Match por subcadena
if (-not $proj) {
    $cands = @($json.projects | Where-Object { $_.name.ToLower().Contains($Nombre.ToLower()) })
    if ($cands.Count -gt 1) {
        $rutasUnicas = @($cands | Select-Object -ExpandProperty path -Unique)
        if ($rutasUnicas.Count -gt 1) {
            [Console]::Error.WriteLine("proyecto-ruta: '$Nombre' es ambiguo, hay $($cands.Count) candidatos:")
            foreach ($c in $cands) {
                [Console]::Error.WriteLine("  $($c.name)`t$($c.path)")
            }
            [Console]::Error.WriteLine("usá el nombre exacto.")
            exit 1
        }
    }
    if ($cands.Count -ge 1) {
        $proj = $cands[0]
    }
}

if (-not $proj) {
    [Console]::Error.WriteLine("no encontré '$Nombre'. Proyectos:")
    if ($json.projects) {
        $json.projects | ForEach-Object { $_.name } | Sort-Object -Unique | ForEach-Object { [Console]::Error.WriteLine("  $_") }
    }
    exit 1
}

$ruta = $proj.path
if ($ruta.StartsWith("~")) {
    $homeDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
    $ruta = Join-Path $homeDir $ruta.Substring(1).TrimStart('\', '/')
}

if (Test-Path $ruta -PathType Leaf) {
    $ruta = Split-Path $ruta -Parent
}

if (-not (Test-Path $ruta)) {
    [Console]::Error.WriteLine("la ruta no existe: $ruta")
    exit 1
}

(Resolve-Path $ruta).Path
