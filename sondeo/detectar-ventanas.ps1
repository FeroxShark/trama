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
  // Los procesos que arrancan (sondeo cada 30 ms): con Windows Terminal la ventana es de WindowsTerminal/OpenConsole, no del programa
  // que la pidió; el culpable es el que arrancó justo antes.
  class Nuevo { public DateTime Cuando; public string Texto; }
  static readonly List<Nuevo> Nuevos = new List<Nuevo>();
  static void Vigilar() {
    var vistos = new HashSet<int>(); foreach (var p in Process.GetProcesses()) vistos.Add(p.Id);
    while (true) {
      foreach (var p in Process.GetProcesses()) {
        if (!vistos.Add(p.Id)) continue;
        uint padre; string t = Proc((uint)p.Id, out padre); uint abuelo; string tp = padre > 4 ? Proc(padre, out abuelo) : "";
        lock (Nuevos) Nuevos.Add(new Nuevo { Cuando = DateTime.Now, Texto = t + (tp != "" ? "\n        padre: " + tp : "") });
      }
      System.Threading.Thread.Sleep(30);
    }
  }
  public static void Mirar(int segundos, string salida) {
    var vistas = Ver(); var sw = Stopwatch.StartNew();
    var hilo = new System.Threading.Thread(Vigilar); hilo.IsBackground = true; hilo.Start();
    Console.WriteLine("Mirando " + segundos + " s. Usa Trama hasta que aparezca la ventana. Ctrl+C corta.");
    while (sw.Elapsed.TotalSeconds < segundos) {
      foreach (var kv in Ver()) {
        if (vistas.ContainsKey(kv.Key)) continue;
        vistas[kv.Key] = kv.Value;
        var t = new StringBuilder(512); GetWindowText(kv.Key, t, 512);
        var l = new List<string>(); var ahora = DateTime.Now;
        uint padre; l.Add(ahora.ToString("HH:mm:ss.fff") + "  VENTANA '" + t + "' (de " + Proc(kv.Value, out padre) + ")");
        l.Add("   procesos que arrancaron en los 3 s anteriores:");
        lock (Nuevos) foreach (var n in Nuevos) if ((ahora - n.Cuando).TotalSeconds <= 3) l.Add("     " + n.Cuando.ToString("HH:mm:ss.fff") + "  " + n.Texto);
        foreach (var x in l) Console.WriteLine(x);
        System.IO.File.AppendAllLines(salida, l);
      }
      System.Threading.Thread.Sleep(5);
    }
  }
}
'@
[Det]::Mirar($Segundos, $Salida)
Write-Host "Listo. Lo que vio quedo en: $Salida"
