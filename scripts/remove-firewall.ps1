#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Removes the FlashPush firewall rules added by allow-firewall.ps1. Run as administrator.
#>
$ErrorActionPreference = 'Stop'
$Group = 'FlashPush'

Remove-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue
Write-Output 'FlashPush firewall rules removed (if there were any).'
