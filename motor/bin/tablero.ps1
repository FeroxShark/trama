<#
.SYNOPSIS
  tablero — wrapper para ejecutar tablero en Python desde PowerShell en Windows.
#>
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$tableroPy = Join-Path $scriptDir "tablero"

$py = Get-Command py, python, python3 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($py) {
    if ($py.Name -eq "py.exe" -or $py.Name -eq "py") {
        & $py.Source -3 $tableroPy @args
    } else {
        & $py.Source $tableroPy @args
    }
    exit $LASTEXITCODE
} else {
    [Console]::Error.WriteLine("tablero: no se encontró Python en el sistema.")
    exit 1
}
