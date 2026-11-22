# Detector de ventanas de consola (CMD, PowerShell, Windows Terminal) para encontrar qué programa las abre.
# Uso: powershell -ExecutionPolicy Bypass -File detectar-ventanas.ps1 [-Segundos 600]
# Dejalo corriendo, usá Trama hasta que aparezca la ventana y después mandá el archivo que dice al final
# (queda en el Escritorio: trama-ventanas.txt). No cambia nada del sistema; sólo mira.
param([int]$Segundos = 600, [string]$Salida = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'trama-ventanas.txt'))
Add-Type -ReferencedAssemblies System.Management -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text; using System.Diagnostics; using System.Management;
public static class Det {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  static readonly string[] Clases = { "ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS", "PseudoConsoleWindow" };
  static Dictionary<IntPtr, uint> Ver() {
    var d = new Dictionary<IntPtr, uint>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      if (Array.IndexOf(Clases, c.ToString()) < 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid); d[h] = pid; return true;
    }, IntPtr.Zero);
    return d;
  }
  static string Proc(uint pid, out uint padre) {
    padre = 0;
    try {
      using (var s = new ManagementObjectSearcher("SELECT Name, CommandLine, ParentProcessId FROM Win32_Process WHERE ProcessId=" + pid))
        foreach (ManagementObject o in s.Get()) { padre = (uint)o["ParentProcessId"]; return pid + " " + o["Name"] + "  " + o["CommandLine"]; }
    } catch {}
    return pid + " (ya terminó)";
  }
  public static void Mirar(int segundos, string salida) {
    var vistas = Ver(); var sw = Stopwatch.StartNew();
    Console.WriteLine("Mirando " + segundos + " s. Usá Trama hasta que aparezca la ventana. Ctrl+C corta.");
    while (sw.Elapsed.TotalSeconds < segundos) {
      foreach (var kv in Ver()) {
        if (vistas.ContainsKey(kv.Key)) continue;
        vistas[kv.Key] = kv.Value;
        var t = new StringBuilder(512); GetWindowText(kv.Key, t, 512);
        var l = new List<string>(); l.Add(DateTime.Now.ToString("HH:mm:ss.fff") + "  VENTANA '" + t + "' de:");
        uint pid = kv.Value;
        for (int i = 0; i < 8 && pid > 4; i++) { uint padre; l.Add("   " + (i == 0 ? "" : "<- ") + Proc(pid, out padre)); pid = padre; }
        foreach (var x in l) Console.WriteLine(x);
        System.IO.File.AppendAllLines(salida, l);
      }
      System.Threading.Thread.Sleep(5);
    }
  }
}
'@
[Det]::Mirar($Segundos, $Salida)
Write-Host "Listo. Lo que vio quedó en: $Salida"
