// scripts/e2e/step-dialog-type.cjs — types a full folder path into the
// studio's NATIVE directory picker (`packs:pickSourceDir` → Electron's
// showOpenDialog). The dialog is an OS window CDP cannot reach.
//
// HOW (live-probed 2026-08-19): the dialog reliably OPENS ~750ms after the
// pick click, but does NOT reliably TAKE foreground — the orchestrator's
// CDP-synthetic click grants the app no Windows foreground rights, so the
// dialog can open behind whatever the user is doing (attempt-5: dialog
// opened, typer waited 10s for a foreground it never got, dialog went
// zombie). So this driver FINDS the dialog by enumerating our electron's
// visible top-level windows, FORCES it to the foreground (the canonical
// ALT-tap + SetForegroundWindow lock bypass), verifies, and only then
// types. The orchestrator spawns this FIRST and clicks pick SECOND.
//
// SAFETY: SendKeys types into whatever holds foreground — typing starts
// only after GetForegroundWindow() is verified to be the dialog HWND (a
// window owned by OUR pet2d-spike electron AND titled like a folder
// dialog). Otherwise ABORT: a path typed into the user's foreground app is
// worse than a failed leg.
//
// MECHANICS: PowerShell runs via `-File` (script written to %TEMP% as UTF-8
// WITH BOM — PS 5.1 reads no-BOM as ANSI/GBK and CJK literals then eat
// their quotes), never `-Command` (argv re-joining strips double quotes).
// The dialog title marker 选择文件夹 is built from char codes so no
// encoding path can corrupt it.
//
// SendKeys special chars are + ^ % ~ ( ) { } [ ] — the path is rejected if
// it uses any (letters, digits, :, ., \, /, -, _ are all safe raw).
const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const os = require('node:os');

const PS1 = join(os.tmpdir(), 'pet2d-spike', 'type-into-dialog.ps1');

const SCRIPT = [
  'param([string]$Path)',
  '$ErrorActionPreference = "Stop"',
  'Add-Type -TypeDefinition @"',
  'using System;',
  'using System.Text;',
  'using System.Collections.Generic;',
  'using System.Runtime.InteropServices;',
  'public static class DT {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
  '  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);',
  '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);',
  '  public delegate bool EnumProc(IntPtr h, IntPtr l);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
  '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);',
  '  public static List<string> Found = new List<string>();',
  '  public static void Scan() {',
  '    EnumWindows(delegate(IntPtr h, IntPtr l) {',
  '      uint pid; GetWindowThreadProcessId(h, out pid);',
  '      if (IsWindowVisible(h)) {',
  '        var sb = new StringBuilder(256); GetWindowText(h, sb, 256);',
  '        if (sb.Length > 0) Found.Add(pid + "|" + h + "|" + sb.ToString());',
  '      }',
  '      return true;',
  '    }, IntPtr.Zero);',
  '  }',
  '}',
  '"@',
  // 选择文件夹 (zh-CN "Select Folder") from char codes — encoding-proof.
  '$dlgMark = [string][char]0x9009 + [char]0x62E9 + [char]0x6587 + [char]0x4EF6 + [char]0x5939',
  '$enMark = "folder"',
  '$ours = (Get-CimInstance Win32_Process -Filter "Name=\'electron.exe\'" | Where-Object { $_.CommandLine -like "*pet2d-spike*" }).ProcessId',
  'if (-not $ours) { throw "no pet2d-spike electron process found" }',
  '$deadline = (Get-Date).AddSeconds(12)',
  '$hwnd = [IntPtr]::Zero',
  'while ((Get-Date) -lt $deadline -and $hwnd -eq [IntPtr]::Zero) {',
  '  [DT]::Found.Clear()',
  '  [DT]::Scan()',
  '  foreach ($line in [DT]::Found) {',
  '    $parts = $line.Split("|")',
  '    $title = $parts[2]',
  '    if (($ours -contains [uint32]$parts[0]) -and ($title.ToLowerInvariant().Contains($enMark) -or $title.Contains($dlgMark))) {',
  '      $hwnd = [IntPtr][int64]$parts[1]',
  '      break',
  '    }',
  '  }',
  '  if ($hwnd -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 200 }',
  '}',
  'if ($hwnd -eq [IntPtr]::Zero) { throw "directory dialog never appeared (12s)" }',
  '# Force foreground: ALT tap satisfies the Windows foreground lock.',
  '$focused = $false',
  'for ($i = 0; $i -lt 6; $i++) {',
  '  [DT]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)',
  '  [DT]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)',
  '  [DT]::SetForegroundWindow($hwnd) | Out-Null',
  '  Start-Sleep -Milliseconds 120',
  '  if ([DT]::GetForegroundWindow() -eq $hwnd) { $focused = $true; break }',
  '}',
  'if (-not $focused) { throw "could not bring dialog to foreground - refusing to type" }',
  'Add-Type -AssemblyName System.Windows.Forms',
  '# Focus the filename edit via UIA: a forced-foreground dialog can leave the folder tree focused - typed chars then vanish (2026-08-19).',
  'Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes',
  '$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)',
  '$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)',
  '$edit = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)',
  'if ($edit) { Start-Sleep -Milliseconds 150; $vp = $null; try { $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch {} ; if ($vp) { $vp.SetValue($Path); Write-Output "UIA_SET" } else { $edit.SetFocus(); Start-Sleep -Milliseconds 200 } } else { Write-Output "UIA_NOEDIT" }',
  'Start-Sleep -Milliseconds 400',
  'if (-not $vp) { [System.Windows.Forms.SendKeys]::SendWait($Path) }',
  'Start-Sleep -Milliseconds 250',
  "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
  'Start-Sleep -Milliseconds 400',
  '$stillOpen = $false',
  '[DT]::Found.Clear()',
  '[DT]::Scan()',
  'foreach ($l2 in [DT]::Found) { $p2 = $l2.Split("|"); if (($ours -contains [uint32]$p2[0]) -and $p2[2].Contains($dlgMark)) { $stillOpen = $true } }',
  "if ($stillOpen) { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }",
  "Write-Output ('DIALOG_TYPED stillOpenAfterEnter1=' + $stillOpen)",
].join('\r\n');

function main() {
  const path = process.argv[2];
  if (path === undefined || path === '') {
    throw new Error('usage: node step-dialog-type.cjs <absolute-folder-path>');
  }
  if (/[+^%~()[\]{}]/.test(path)) {
    throw new Error(`path carries SendKeys special chars — needs escaping: ${path}`);
  }
  mkdirSync(join(os.tmpdir(), 'pet2d-spike'), { recursive: true });
  // UTF-8 WITH BOM: PS 5.1 reads no-BOM files as ANSI (GBK here) and CJK
  // literals then eat their closing quote -> parse error.
  writeFileSync(PS1, '﻿' + SCRIPT, 'utf8');
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Path', path],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  console.log(out.trim());
}

try {
  main();
} catch (error) {
  const detail = String(error.stderr || error.message).split(String.fromCharCode(10))[0];
  console.error(`DIALOG_TYPE_FAILED: ${detail}`);
  process.exit(1);
}
