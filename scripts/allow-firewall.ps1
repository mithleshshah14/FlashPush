#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Lets phones on your local network and on Tailscale reach FlashPush. Run once, as administrator.

.DESCRIPTION
  Adds two inbound Windows Firewall rules in the group "FlashPush":
    - TCP 8765  (phones connect to the laptop over HTTPS)
    - UDP 8766  (phones find the laptop on the Wi-Fi)
  Both only accept connections from:
    - LocalSubnet      (your current Wi-Fi / LAN)
    - 100.64.0.0/10    (Tailscale addresses)
  Nothing else is opened: no other ports, no other remote addresses, no program or service wildcard.
  Running it again replaces the rules (it never creates duplicates). Undo with remove-firewall.ps1.

.PARAMETER DevicePort
  TCP port of the phone API (default 8765; change it only if you changed "ports.device" in config.json).

.PARAMETER DiscoveryPort
  UDP port of discovery (default 8766; "ports.discovery" in config.json).
#>
param(
    [ValidateRange(1024, 65535)][int]$DevicePort = 8765,
    [ValidateRange(1024, 65535)][int]$DiscoveryPort = 8766
)

$ErrorActionPreference = 'Stop'
$Group = 'FlashPush'
$Remote = @('LocalSubnet', '100.64.0.0/10')

Remove-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue

New-NetFirewallRule -DisplayName "FlashPush (TCP $DevicePort)" -Group $Group -Direction Inbound -Action Allow -Protocol TCP -LocalPort $DevicePort -RemoteAddress $Remote -Profile Any | Out-Null
New-NetFirewallRule -DisplayName "FlashPush (UDP $DiscoveryPort)" -Group $Group -Direction Inbound -Action Allow -Protocol UDP -LocalPort $DiscoveryPort -RemoteAddress $Remote -Profile Any | Out-Null

Write-Output "FlashPush firewall rules added: TCP $DevicePort and UDP $DiscoveryPort, from LocalSubnet and 100.64.0.0/10 only."
Write-Output 'Remove them any time with scripts\remove-firewall.ps1.'
