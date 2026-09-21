# FlashPush tray icon. Static script: it is started by server/src/tray.js with fixed arguments and
# talks to Node over newline-delimited JSON (stdin: menu / notify / exit, stdout: ready / click /
# notification-click). Every message field is display text or a fixed id; nothing received is ever
# executed or turned into a command. It exits when told to, or when stdin closes (Node has gone).
param(
    [Parameter(Mandatory = $true)][string]$IconDir
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Read stdin on a background thread; the UI timer below drains the queue.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Threading;

public static class FlashPushStdin
{
    public static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
    public static volatile bool Closed;

    public static void Start()
    {
        Thread reader = new Thread(delegate ()
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null) { Lines.Enqueue(line); }
            }
            catch (Exception) { }
            Closed = true;
        });
        reader.IsBackground = true;
        reader.Start();
    }
}
'@

try {
    [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch { }

function Send-Message([hashtable]$Message) {
    [Console]::Out.WriteLine(($Message | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}

$icons = @{}
foreach ($name in 'running', 'degraded', 'stopped') {
    $icons[$name] = New-Object System.Drawing.Icon (Join-Path $IconDir "flashpush-$name.ico")
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icons['stopped']
$tray.Text = 'FlashPush'
$tray.ContextMenuStrip = $menu
$tray.Visible = $true
$tray.add_BalloonTipClicked({ Send-Message @{ type = 'notification-click' } })

function Set-Menu($Message) {
    if ($Message.icon -and $icons.ContainsKey([string]$Message.icon)) { $tray.Icon = $icons[[string]$Message.icon] }
    if ($Message.tooltip) { $tray.Text = ([string]$Message.tooltip).Substring(0, [Math]::Min(63, ([string]$Message.tooltip).Length)) }
    if ($null -eq $Message.items) { return }
    $menu.Items.Clear()
    foreach ($item in $Message.items) {
        if ($item.separator) {
            [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
            continue
        }
        $entry = New-Object System.Windows.Forms.ToolStripMenuItem
        $entry.Text = [string]$item.label
        $entry.Tag = [string]$item.id
        if ($null -ne $item.enabled) { $entry.Enabled = [bool]$item.enabled }
        if ($null -ne $item.checked) { $entry.Checked = [bool]$item.checked }
        $entry.add_Click({ param($sender, $e) Send-Message @{ type = 'click'; id = [string]$sender.Tag } })
        [void]$menu.Items.Add($entry)
    }
}

function Stop-Tray {
    $timer.Stop()
    $tray.Visible = $false
    $tray.Dispose()
    [System.Windows.Forms.Application]::Exit()
}

function Receive-Line([string]$Line) {
    try { $message = $Line | ConvertFrom-Json } catch { return }
    switch ([string]$message.type) {
        'menu' { Set-Menu $message }
        'notify' {
            $tray.ShowBalloonTip(5000, [string]$message.title, [string]$message.body, [System.Windows.Forms.ToolTipIcon]::Info)
        }
        'exit' { Stop-Tray }
    }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.add_Tick({
    $line = $null
    while ([FlashPushStdin]::Lines.TryDequeue([ref]$line)) { Receive-Line $line }
    if ([FlashPushStdin]::Closed -and [FlashPushStdin]::Lines.IsEmpty) { Stop-Tray }
})

[FlashPushStdin]::Start()
$timer.Start()
Send-Message @{ type = 'ready' }
[System.Windows.Forms.Application]::Run()
