param([string]$out, [string]$listo, [int]$segundos)
Add-Type -Namespace S -Name U -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr h, System.IntPtr p);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, System.IntPtr p);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
'@
$clases = @('ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS', 'PseudoConsoleWindow')
function Ver {
  $vistas = @{}
  $cb = [S.U+EnumProc] {
    param($h, $p)
    if ([S.U]::IsWindowVisible($h)) {
      $c = New-Object System.Text.StringBuilder 256; [void][S.U]::GetClassName($h, $c, 256)
      if ($clases -contains $c.ToString()) {
        $t = New-Object System.Text.StringBuilder 512; [void][S.U]::GetWindowText($h, $t, 512)
        [uint32]$wp = 0; [void][S.U]::GetWindowThreadProcessId($h, [ref]$wp)
        $vistas["$h"] = "$($c.ToString()) pid=$wp titulo='$($t.ToString())'"
      }
    }
    return $true
  }
  [void][S.U]::EnumWindows($cb, [System.IntPtr]::Zero)
  return $vistas
}
$base = Ver
Set-Content -Path $listo -Value 1
$nuevas = @{}
$fin = (Get-Date).AddSeconds($segundos)
while ((Get-Date) -lt $fin) {
  $v = Ver
  foreach ($k in $v.Keys) { if (-not $base.ContainsKey($k) -and -not $nuevas.ContainsKey($k)) { $nuevas[$k] = $v[$k] } }
  Start-Sleep -Milliseconds 40
}
$lineas = @("(ya había al empezar: $($base.Count))") + ($nuevas.Values | ForEach-Object { "NUEVA VISIBLE: $_" })
Set-Content -Path $out -Value $lineas -Encoding ascii
