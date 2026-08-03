#Requires -RunAsAdministrator
<#
============================================================================
 Bheka Keystroke Agent — Windows Auto-Start Setup (recommended)
============================================================================

WHAT THIS DOES
--------------
Run this script ONCE, elevated (right-click PowerShell -> "Run as
Administrator"), with the 5 values you'd otherwise set by hand every
session:

    .\install_windows_agent_task.ps1 `
        -ApiUrl "http://100.x.y.z:8080" `
        -SourceAgentId "..." `
        -AgentToken "..." `
        -SiteId "..." `
        -SubjectUserId "..."

It will:
  1. Install (or reuse) the agent script + requirements.txt under
     C:\ProgramData\Bheka\agent\ (downloading bheka_keystroke_agent.py from
     GitHub if it isn't already sitting next to this installer script).
  2. Persist the 5 values as USER-level environment variables, so they
     survive reboots and never need to be re-typed in a shell again —
     this also means you can manually re-run bheka_keystroke_agent.py by
     hand later (e.g. for debugging) and the env vars will already be set.
  3. Register a Scheduled Task named "BhekaAgent" that:
       - Starts automatically at logon for the current user.
       - Restarts itself automatically if it crashes or is killed
         (up to 999 times, checking every 1 minute).
       - Never times out (a monitoring agent must run indefinitely).
       - Won't start a second copy if one is already running.
       - Keeps running on battery power (important for laptops).
       - Runs interactively as the current user (NOT SYSTEM) because
         keyboard hooks, screen capture, and foreground-window detection
         all require an interactive desktop session.
  4. Starts the task immediately, so you can confirm it's working without
     rebooting.

AFTER INSTALLING
-----------------
  - The task survives reboot, sleep/wake, and crashes of the agent
    process itself — you should never need to open PowerShell and
    manually run the agent again.
  - To change any of the 5 values later (new token, different site,
    etc.), just re-run this installer with the new values — it is safe
    to run repeatedly (idempotent: it replaces the existing task).
  - To view live logs: C:\ProgramData\Bheka\agent\agent.log (all stdout/stderr
    from the agent, redirected via the run_agent.ps1 wrapper this installer
    generates, since scheduled tasks run headless with no visible console).
  - To check task status:
        Get-ScheduledTask -TaskName BhekaAgent | Get-ScheduledTaskInfo
  - To uninstall: run .\uninstall_windows_agent_task.ps1

============================================================================
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ApiUrl,

    [Parameter(Mandatory = $true)]
    [string]$SourceAgentId,

    [Parameter(Mandatory = $true)]
    [string]$AgentToken,

    [Parameter(Mandatory = $true)]
    [string]$SiteId,

    [Parameter(Mandatory = $true)]
    [string]$SubjectUserId
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# 0. Constants
# ---------------------------------------------------------------------------

$InstallDir   = "C:\ProgramData\Bheka\agent"
$AgentScript  = Join-Path $InstallDir "bheka_keystroke_agent.py"
$Requirements = Join-Path $InstallDir "requirements.txt"
$WrapperScript = Join-Path $InstallDir "run_agent.ps1"
$LogFile      = Join-Path $InstallDir "agent.log"
$TaskName     = "BhekaAgent"
$RawBaseUrl   = "https://raw.githubusercontent.com/Christpher1982/bheka-platform/feature/agent-ingest-rules/agent"

Write-Host "=== Bheka Agent — Windows auto-start installer ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. Install location: copy local files if present, else download.
# ---------------------------------------------------------------------------

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Host "Created install directory: $InstallDir"
}

$ScriptDir = $PSScriptRoot
$LocalAgentScript  = Join-Path $ScriptDir "bheka_keystroke_agent.py"
$LocalRequirements = Join-Path $ScriptDir "requirements.txt"

if (Test-Path $LocalAgentScript) {
    Copy-Item -Path $LocalAgentScript -Destination $AgentScript -Force
    Write-Host "Copied bheka_keystroke_agent.py from $ScriptDir into $InstallDir"
} elseif (-not (Test-Path $AgentScript)) {
    Write-Host "bheka_keystroke_agent.py not found next to installer — downloading from GitHub..."
    Invoke-WebRequest -Uri "$RawBaseUrl/bheka_keystroke_agent.py" -OutFile $AgentScript -UseBasicParsing
    Write-Host "Downloaded bheka_keystroke_agent.py to $AgentScript"
} else {
    Write-Host "Using existing agent script already present at $AgentScript"
}

if (Test-Path $LocalRequirements) {
    Copy-Item -Path $LocalRequirements -Destination $Requirements -Force
    Write-Host "Copied requirements.txt from $ScriptDir into $InstallDir"
} elseif (-not (Test-Path $Requirements)) {
    Write-Host "requirements.txt not found next to installer — downloading from GitHub..."
    try {
        Invoke-WebRequest -Uri "$RawBaseUrl/requirements.txt" -OutFile $Requirements -UseBasicParsing
        Write-Host "Downloaded requirements.txt to $Requirements"
    } catch {
        Write-Warning "Could not download requirements.txt automatically. Install dependencies manually with: pip install -r requirements.txt"
    }
} else {
    Write-Host "Using existing requirements.txt already present at $Requirements"
}

# ---------------------------------------------------------------------------
# 2. Persist the 5 required values as User-level environment variables.
#    User scope (not Process/Machine) so they:
#      - survive reboot and future shell sessions without re-setting,
#      - are readable by a task running with -LogonType Interactive as
#        this same user (which inherits the user's environment block),
#      - don't require an elevated/Machine-wide env var change.
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Persisting environment variables at User scope..."

$envValues = @{
    "BHEKA_API_URL"   = $ApiUrl
    "SOURCE_AGENT_ID" = $SourceAgentId
    "AGENT_TOKEN"     = $AgentToken
    "SITE_ID"         = $SiteId
    "SUBJECT_USER_ID" = $SubjectUserId
}

foreach ($name in $envValues.Keys) {
    [Environment]::SetEnvironmentVariable($name, $envValues[$name], "User")
    # Also set for the remainder of this elevated session, purely so any
    # immediate manual testing in this same window works without reopening.
    Set-Item -Path "Env:$name" -Value $envValues[$name]
    Write-Host "  Set $name (User scope)"
}

# ---------------------------------------------------------------------------
# 3. Resolve python.exe at install time (don't hardcode a path).
# ---------------------------------------------------------------------------

$pythonCmd = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
}
if (-not $pythonCmd) {
    throw "Could not find python.exe on PATH. Install Python 3 and ensure it's on PATH, then re-run this installer."
}
$PythonPath = $pythonCmd.Source
Write-Host "Resolved python.exe: $PythonPath"

# ---------------------------------------------------------------------------
# 4. Write the wrapper script that redirects stdout/stderr to a log file.
#
#    Register-ScheduledTask's action model runs a single executable with
#    arguments — it does not natively support shell redirection operators
#    (">>", "2>&1") because there's no shell in between unless we invoke
#    one. The most reliable approach is to point the scheduled task's
#    action at powershell.exe running this small wrapper script, which
#    performs the redirection itself via PowerShell's own redirection
#    operators. This also lets us loop/retry inside the wrapper as a
#    belt-and-suspenders layer on top of the Scheduled Task's own
#    restart-on-failure settings.
# ---------------------------------------------------------------------------

$wrapperContent = @"
# Auto-generated by install_windows_agent_task.ps1 — do not edit by hand.
# Runs the Bheka agent and redirects all stdout/stderr to agent.log so it
# can be inspected even though the Scheduled Task itself runs headless
# (no visible console window).
`$ErrorActionPreference = "Continue"
Set-Location -Path "$InstallDir"
& "$PythonPath" "$AgentScript" *>> "$LogFile"
"@

Set-Content -Path $WrapperScript -Value $wrapperContent -Encoding UTF8
Write-Host "Wrote log-capturing wrapper: $WrapperScript"

# ---------------------------------------------------------------------------
# 5. Register the Scheduled Task (idempotent: unregister first if present).
# ---------------------------------------------------------------------------

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host ""
    Write-Host "Existing '$TaskName' task found — unregistering before re-install..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$currentUser = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WrapperScript`"" `
    -WorkingDirectory $InstallDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser

$settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

Write-Host ""
Write-Host "Registering scheduled task '$TaskName'..."
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Bheka keystroke/screenshot/app-usage monitoring agent. Auto-starts at logon and auto-restarts on crash. Installed by install_windows_agent_task.ps1." `
    | Out-Null

Write-Host "Task '$TaskName' registered." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 6. Start it now so the user doesn't have to reboot to see it working.
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Starting task now..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
Write-Host ""
Write-Host "=== Install complete ===" -ForegroundColor Green
Write-Host "Task state:      $($info.LastTaskResult) (0 = success/still running is normal immediately after start)"
Write-Host "Last run time:   $($info.LastRunTime)"
Write-Host ""
Write-Host "The Bheka agent will now:"
Write-Host "  - Start automatically every time you log on."
Write-Host "  - Restart automatically if it crashes or is killed (up to 999 times, checked every 1 min)."
Write-Host "  - Keep running on battery power."
Write-Host "  - Never time out."
Write-Host ""
Write-Host "Useful commands:"
Write-Host "  Check status:   Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Host "  View live log:  Get-Content `"$LogFile`" -Wait -Tail 50"
Write-Host "  Update values:  re-run this installer with new -ApiUrl/-AgentToken/etc. values"
Write-Host "  Uninstall:      .\uninstall_windows_agent_task.ps1"
Write-Host ""
Write-Host "Note: the scheduled task runs headless (no visible console window)."
Write-Host "All agent output is captured to: $LogFile"
