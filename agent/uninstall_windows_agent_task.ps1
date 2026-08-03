#Requires -RunAsAdministrator
<#
============================================================================
 Bheka Keystroke Agent — Windows Auto-Start Uninstaller
============================================================================

Companion to install_windows_agent_task.ps1. Run this elevated to:
  1. Stop and unregister the "BhekaAgent" Scheduled Task.
  2. Optionally remove the install folder (C:\ProgramData\Bheka\agent\),
     including the agent script, requirements.txt, wrapper script, and
     agent.log.
  3. Optionally clear the 5 User-level environment variables that were
     set by the installer.

USAGE
-----
  Unregister the task only (keeps files + env vars, e.g. for a reinstall):
      .\uninstall_windows_agent_task.ps1

  Also delete the install folder:
      .\uninstall_windows_agent_task.ps1 -RemoveInstallDir

  Also clear the User-level env vars (BHEKA_API_URL, SOURCE_AGENT_ID,
  AGENT_TOKEN, SITE_ID, SUBJECT_USER_ID):
      .\uninstall_windows_agent_task.ps1 -RemoveInstallDir -RemoveEnvVars

============================================================================
#>

[CmdletBinding()]
param(
    [switch]$RemoveInstallDir,
    [switch]$RemoveEnvVars
)

$ErrorActionPreference = "Stop"

$InstallDir = "C:\ProgramData\Bheka\agent"
$TaskName   = "BhekaAgent"

Write-Host "=== Bheka Agent — Windows auto-start uninstaller ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. Stop + unregister the scheduled task.
# ---------------------------------------------------------------------------

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Stopping task '$TaskName' (if running)..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

    Write-Host "Unregistering task '$TaskName'..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task '$TaskName' removed." -ForegroundColor Green
} else {
    Write-Host "No '$TaskName' scheduled task found — nothing to unregister."
}

# ---------------------------------------------------------------------------
# 2. Optionally remove the install folder.
# ---------------------------------------------------------------------------

if ($RemoveInstallDir) {
    if (Test-Path $InstallDir) {
        Write-Host "Removing install directory: $InstallDir"
        Remove-Item -Path $InstallDir -Recurse -Force
        Write-Host "Install directory removed." -ForegroundColor Green
    } else {
        Write-Host "Install directory $InstallDir does not exist — nothing to remove."
    }
} else {
    Write-Host ""
    Write-Host "Install directory left in place: $InstallDir"
    Write-Host "(re-run with -RemoveInstallDir to delete the agent script, requirements.txt, and agent.log)"
}

# ---------------------------------------------------------------------------
# 3. Optionally clear the User-level environment variables.
# ---------------------------------------------------------------------------

if ($RemoveEnvVars) {
    Write-Host ""
    Write-Host "Clearing User-level environment variables..."
    $names = @("BHEKA_API_URL", "SOURCE_AGENT_ID", "AGENT_TOKEN", "SITE_ID", "SUBJECT_USER_ID")
    foreach ($name in $names) {
        [Environment]::SetEnvironmentVariable($name, $null, "User")
        Write-Host "  Cleared $name (User scope)"
    }
} else {
    Write-Host ""
    Write-Host "User-level environment variables left in place (BHEKA_API_URL, SOURCE_AGENT_ID, AGENT_TOKEN, SITE_ID, SUBJECT_USER_ID)."
    Write-Host "(re-run with -RemoveEnvVars to clear them)"
}

Write-Host ""
Write-Host "=== Uninstall complete ===" -ForegroundColor Green
