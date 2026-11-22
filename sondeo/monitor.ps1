param([string]$out, [string]$listo, [int]$segundos)
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text; using System.Diagnostics;
public static class Mon {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  static readonly string[] Clases = { "ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS", "PseudoConsoleWindow" };
  static Dictionary<IntPtr, string> Ver() {
    var d = new Dictionary<IntPtr, string>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      if (Array.IndexOf(Clases, c.ToString()) < 0) return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512); uint pid; GetWindowThreadProcessId(h, out pid);
      string nom = ""; try { nom = Process.GetProcessById((int)pid).ProcessName; } catch {}
      d[h] = c + " pid=" + pid + " (" + nom + ") titulo='" + t + "'";
      return true;
    }, IntPtr.Zero);
    return d;
  }
  public static Dictionary<IntPtr, string> Base;
  public static void Empezar() { Base = Ver(); }
  public static List<string> Mirar(int segundos) {
    var nuevas = new Dictionary<IntPtr, string>(); var sw = Stopwatch.StartNew();
    while (sw.Elapsed.TotalSeconds < segundos) {
      foreach (var kv in Ver()) if (!Base.ContainsKey(kv.Key) && !nuevas.ContainsKey(kv.Key)) nuevas[kv.Key] = string.Format("{0,6:0.00}s ", sw.Elapsed.TotalSeconds) + kv.Value;
      System.Threading.Thread.Sleep(5);
    }
    var l = new List<string>(); l.Add("(ya habia al empezar: " + Base.Count + ")"); foreach (var v in nuevas.Values) l.Add("NUEVA VISIBLE: " + v); return l;
  }
}
'@
[Mon]::Empezar()
Set-Content -Path $listo -Value 1
$l = [Mon]::Mirar($segundos)
Set-Content -Path $out -Value $l -Encoding ascii
