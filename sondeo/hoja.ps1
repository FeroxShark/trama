param([string]$out, [int]$espera = 0, [string]$nombre)
Start-Sleep -Seconds $espera
$nombre = "$env:SONDEO_NOMBRE$nombre"
Add-Type -Namespace S -Name K -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();
[DllImport("kernel32.dll")] public static extern uint GetConsoleCP();
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
'@
$h = [S.K]::GetConsoleWindow()
$linea = "$nombre  pid=$PID  consola(cp)=$([S.K]::GetConsoleCP())  ventana=$h  visible=$([S.K]::IsWindowVisible($h))"
for ($i = 0; $i -lt 20; $i++) { try { Add-Content -Path $out -Value $linea -Encoding ascii -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 100 } }
