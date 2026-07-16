#Requires -Version 5.1
<#
.SYNOPSIS
    Validates every RODSchema build dependency in order, then compiles
    main.dll -- logging each step so a failure points at exactly what's
    missing rather than a generic CMake error.

    Encodes every real failure mode hit while getting this build working:
    missing CMake / not on PATH, wrong Visual Studio version, missing
    Windows SDK, wrong architecture (x86 vs x64), git submodules using
    SSH URLs with no key configured. Each is checked BEFORE attempting a
    build, not discovered halfway through a cryptic CMake error.

.NOTES
    Run from a PLAIN PowerShell window -- this script finds and loads the
    correct Visual Studio x64 environment itself, so you do NOT need to
    open "x64 Native Tools Command Prompt" manually first.
#>

$ErrorActionPreference = "Stop"
$RepoRoot     = $PSScriptRoot
$Timestamp    = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$LogFile      = Join-Path $RepoRoot "build_log_$Timestamp.txt"
$BuildDir     = Join-Path $RepoRoot "build"
$TimingFile   = Join-Path $RepoRoot "build_timing.json"
$StepResults  = [ordered]@{}
$StepTimings  = [ordered]@{}   # populated as steps complete this run

# Load timing history from the previous run, if any, so we can warn how
# long a step took last time before starting it again.
$PrevTimings = @{}
if (Test-Path $TimingFile) {
    try {
        $loaded = Get-Content $TimingFile -Raw | ConvertFrom-Json
        $loaded.PSObject.Properties | ForEach-Object { $PrevTimings[$_.Name] = $_.Value }
    }
    catch {
        # Corrupt/old timing file -- ignore it rather than fail the build over it.
    }
}

function Format-Duration {
    param([double]$Seconds)
    if ($Seconds -lt 90) { return "{0:N0}s" -f $Seconds }
    return "{0:N1} min" -f ($Seconds / 60)
}

function Write-TimingWarning {
    # Cyan, stands out from the plain [INFO]/[STEP] log lines above/below it.
    param([string]$StepName, [string]$FallbackEstimate)

    $msg = if ($PrevTimings.ContainsKey($StepName)) {
        $prev = Format-Duration -Seconds ([double]$PrevTimings[$StepName])
        "Last run, '$StepName' took about $prev. Expect something similar this time -- this is normal, not a hang."
    }
    else {
        "No timing history yet for '$StepName'. $FallbackEstimate"
    }

    Write-Host ""
    Write-Host "  ⏱  $msg" -ForegroundColor Cyan
    Write-Host ""
    Add-Content -Path $LogFile -Value "[TIMING] $msg"
}

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "HH:mm:ss"), $Level, $Message
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

function Invoke-LoggedCommand {
    # Runs a command, streams its output into the log file AND console,
    # and returns the real exit code -- so failures aren't silently lost.
    #
    # IMPORTANT: stdout and stderr are read ASYNCHRONOUSLY here, not one
    # after the other. Reading them sequentially (ReadToEnd() on stdout,
    # THEN ReadToEnd() on stderr) is a classic .NET deadlock: if the child
    # process writes enough to stderr while we're blocked reading stdout,
    # its stderr OS pipe buffer fills up, the child blocks trying to write
    # more to it, and we're stuck waiting for stdout to finish -- which
    # never happens, because the child itself is now stuck too. Both sides
    # wait on each other forever. Reading both concurrently avoids this.
    param([string]$Exe, [string[]]$CommandArgs, [string]$WorkingDir = $RepoRoot)

    Write-Log "Running: $Exe $($CommandArgs -join ' ')" "CMD"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = ($CommandArgs -join ' ')
    $psi.WorkingDirectory = $WorkingDir
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false

    $proc = [System.Diagnostics.Process]::Start($psi)

    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()

    # Wait on both concurrently, with a generous timeout (30 minutes) so a
    # GENUINE hang still eventually surfaces as a clear failure instead of
    # blocking this script forever.
    $completed = [System.Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask), [TimeSpan]::FromMinutes(30))
    if (-not $completed) {
        try { $proc.Kill() } catch {}
        throw "Command timed out after 30 minutes and was killed: $Exe $($CommandArgs -join ' ')"
    }

    $proc.WaitForExit()

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result

    if ($stdout) { Add-Content -Path $LogFile -Value $stdout; Write-Host $stdout }
    if ($stderr) { Add-Content -Path $LogFile -Value $stderr; Write-Host $stderr -ForegroundColor Yellow }

    return $proc.ExitCode
}

function Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Log "=== STEP: $Name ===" "STEP"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $result = & $Action
        $sw.Stop()
        $StepResults[$Name] = "PASS"
        $StepTimings[$Name] = [math]::Round($sw.Elapsed.TotalSeconds, 1)
        Write-Log "PASS: $Name (took $(Format-Duration -Seconds $sw.Elapsed.TotalSeconds))" "PASS"
        return $result
    }
    catch {
        $sw.Stop()
        $StepResults[$Name] = "FAIL"
        $StepTimings[$Name] = [math]::Round($sw.Elapsed.TotalSeconds, 1)
        Write-Log "FAIL: $Name -- $($_.Exception.Message)" "FAIL"
        throw
    }
}

Write-Log "RODSchema build started. Log: $LogFile"
Write-Log "Repo root: $RepoRoot"

try {
    # ---------------------------------------------------------------
    # STEP 1: git
    # ---------------------------------------------------------------
    Step "Git available" {
        $gitCmd = Get-Command git -ErrorAction SilentlyContinue
        if (-not $gitCmd) { throw "git not found on PATH. Install from https://git-scm.com/downloads and re-open PowerShell." }
        Write-Log "Found: $(& git --version)"
    }

    # ---------------------------------------------------------------
    # STEP 2: CMake
    # ---------------------------------------------------------------
    Step "CMake available" {
        $cmakeCmd = Get-Command cmake -ErrorAction SilentlyContinue
        if (-not $cmakeCmd) {
            throw "cmake not found on PATH. Install from https://cmake.org/download/ and ensure 'Add CMake to system PATH' was checked during install, then re-open PowerShell."
        }
        Write-Log "Found: $((& cmake --version)[0])"
    }

    # ---------------------------------------------------------------
    # STEP 3: Visual Studio 2022 with MSVC v143 x64 toolset
    # ---------------------------------------------------------------
    $VsInstallPath = Step "Visual Studio 2022 + MSVC x64 toolset" {
        $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
        if (-not (Test-Path $vswhere)) {
            throw "vswhere.exe not found -- Visual Studio doesn't appear to be installed at all. Install VS2022 Community with the 'Desktop development with C++' workload: https://visualstudio.microsoft.com/downloads/"
        }

        $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if (-not $vsPath) {
            throw "No Visual Studio installation found with the MSVC v143 x64/x86 build tools component. Open 'Visual Studio Installer' -> Modify your VS2022 install -> Individual Components -> check 'MSVC v143 - VS 2022 C++ x64/x86 build tools'."
        }
        Write-Log "Found VS install: $vsPath"
        return $vsPath
    }

    # ---------------------------------------------------------------
    # STEP 4: Windows SDK (specifically rc.exe, which the build needs)
    # ---------------------------------------------------------------
    $SdkInfo = Step "Windows SDK (rc.exe present)" {
        $sdkRoot = "${env:ProgramFiles(x86)}\Windows Kits\10"
        if (-not (Test-Path "$sdkRoot\bin")) {
            throw "Windows Kits folder not found at '$sdkRoot\bin'. Open 'Visual Studio Installer' -> Modify -> Individual Components -> search 'SDK' -> check a Windows 10 or Windows 11 SDK entry -> Modify to install."
        }

        $rcPath = Get-ChildItem -Path "$sdkRoot\bin" -Filter "rc.exe" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "\\x64\\" } |
            Select-Object -First 1

        if (-not $rcPath) {
            throw "Windows Kits folder exists but no x64 rc.exe found under it. The Windows SDK may be partially installed -- reinstall/repair it via Visual Studio Installer."
        }

        # Extract the SDK version folder name (e.g. "10.0.26100.0") from
        # the rc.exe path: .../bin/10.0.26100.0/x64/rc.exe -- two levels
        # up from rc.exe itself (past the architecture folder), not one.
        $x64Dir     = Split-Path $rcPath.FullName -Parent   # .../bin/<version>/x64
        $versionDir = Split-Path $x64Dir -Parent            # .../bin/<version>
        $sdkVersion = Split-Path $versionDir -Leaf           # <version>
        Write-Log "Found rc.exe: $($rcPath.FullName)"
        Write-Log "Windows SDK version: $sdkVersion"

        return @{ Root = $sdkRoot; Version = $sdkVersion; RcDir = (Split-Path $rcPath.FullName -Parent) }
    }

    # ---------------------------------------------------------------
    # STEP 5: Load the VS x64 developer environment INTO THIS PROCESS,
    # WITHOUT going through cmd.exe/vcvars64.bat.
    #
    # Why: vcvars64.bat internally runs via `cmd /c "... && set"`, and on
    # a machine with an already-large PATH, appending VS's own directories
    # can push a single batch-file line past cmd.exe's hard ~8191-character
    # line limit -- producing "The input line is too long." This is a
    # real cmd.exe limitation, not something wrong with your setup
    # specifically; it just depends on how much is already in PATH.
    #
    # The fix: compute the handful of directories the compiler actually
    # needs (MSVC bin/include/lib, Windows SDK include/lib/bin) ourselves
    # and set PATH/INCLUDE/LIB directly in this PowerShell process --
    # PowerShell's own environment variable handling has no equivalent
    # line-length limit, so this sidesteps the problem entirely rather
    # than working around cmd.exe's limit.
    # ---------------------------------------------------------------
    Step "Load VS x64 developer environment" {
        $msvcToolsRoot = Join-Path $VsInstallPath "VC\Tools\MSVC"
        if (-not (Test-Path $msvcToolsRoot)) {
            throw "MSVC tools folder not found at expected path: $msvcToolsRoot"
        }

        # Pick the highest-versioned MSVC toolset folder present (there
        # can be more than one installed side by side).
        $msvcVersionDir = Get-ChildItem -Path $msvcToolsRoot -Directory |
            Sort-Object { [version]($_.Name -replace '^(\d+\.\d+\.\d+).*', '$1') } -Descending |
            Select-Object -First 1

        if (-not $msvcVersionDir) {
            throw "No MSVC toolset version folder found under $msvcToolsRoot"
        }

        $msvcRoot = $msvcVersionDir.FullName
        Write-Log "Using MSVC toolset: $($msvcVersionDir.Name)"

        $msvcBin     = Join-Path $msvcRoot "bin\Hostx64\x64"
        $msvcInclude = Join-Path $msvcRoot "include"
        $msvcLib     = Join-Path $msvcRoot "lib\x64"

        foreach ($p in @($msvcBin, $msvcInclude, $msvcLib)) {
            if (-not (Test-Path $p)) { throw "Expected MSVC path not found: $p" }
        }

        $sdkRoot = $SdkInfo.Root
        $sdkVer  = $SdkInfo.Version

        $sdkIncludeUcrt   = Join-Path $sdkRoot "Include\$sdkVer\ucrt"
        $sdkIncludeUm     = Join-Path $sdkRoot "Include\$sdkVer\um"
        $sdkIncludeShared  = Join-Path $sdkRoot "Include\$sdkVer\shared"
        $sdkIncludeWinrt  = Join-Path $sdkRoot "Include\$sdkVer\winrt"
        $sdkLibUcrt       = Join-Path $sdkRoot "Lib\$sdkVer\ucrt\x64"
        $sdkLibUm         = Join-Path $sdkRoot "Lib\$sdkVer\um\x64"
        $sdkBin           = $SdkInfo.RcDir

        foreach ($p in @($sdkIncludeUcrt, $sdkIncludeUm, $sdkIncludeShared, $sdkLibUcrt, $sdkLibUm)) {
            if (-not (Test-Path $p)) { throw "Expected Windows SDK path not found: $p (SDK version mismatch?)" }
        }

        # Prepend (not replace) so the rest of the user's PATH/tools still work.
        $env:PATH    = "$msvcBin;$sdkBin;$env:PATH"
        $env:INCLUDE = "$msvcInclude;$sdkIncludeUcrt;$sdkIncludeUm;$sdkIncludeShared;$sdkIncludeWinrt"
        $env:LIB     = "$msvcLib;$sdkLibUcrt;$sdkLibUm"

        # Sanity-check: cl.exe and rc.exe should now resolve on PATH
        $cl = Get-Command cl.exe -ErrorAction SilentlyContinue
        $rc = Get-Command rc.exe -ErrorAction SilentlyContinue
        if (-not $cl) { throw "cl.exe still not on PATH after setting it directly -- check that $msvcBin actually contains cl.exe." }
        if (-not $rc) { throw "rc.exe still not on PATH after setting it directly -- check that $sdkBin actually contains rc.exe." }

        Write-Log "cl.exe: $($cl.Source)"
        Write-Log "rc.exe: $($rc.Source)"
    }

    # ---------------------------------------------------------------
    # STEP 6: Rust toolchain (RE-UE4SS bundles a Rust component,
    # "patternsleuth", used for its pattern-scanning subsystem)
    # ---------------------------------------------------------------
    Step "Rust toolchain (required by RE-UE4SS)" {
        $rustcCmd = Get-Command rustc -ErrorAction SilentlyContinue
        if (-not $rustcCmd) {
            throw "rustc not found on PATH. RE-UE4SS's CMake build requires Rust (used by its bundled 'patternsleuth' component). Install via 'winget install Rustlang.Rustup' or https://www.rust-lang.org/tools/install. IMPORTANT: after installing, you must CLOSE THIS POWERSHELL WINDOW COMPLETELY and open a brand new one before re-running this script -- rustup adds itself to PATH, but only NEW terminal sessions see that change. If you just installed it and are still seeing this, that's almost always why."
        }
        Write-Log "Found: $(& rustc --version)"
    }

    # ---------------------------------------------------------------
    # STEP 7: git submodules (RE-UE4SS, json, safetyhook)
    # ---------------------------------------------------------------
    Step "Git submodules present" {
        Push-Location $RepoRoot
        try {
            if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
                Write-Log "No .git folder yet -- running 'git init'."
                git init | Out-Null
            }

            # Fixes the SSH-URL/host-key failure some of RE-UE4SS's own
            # nested submodules hit (git@github.com:... URLs with no SSH
            # key configured) -- rewrites them to HTTPS transparently.
            git config --global url."https://github.com/".insteadOf "git@github.com:" | Out-Null

            $requiredSubmodules = @(
                @{ Path = "deps/RE-UE4SS"; Url = "https://github.com/UE4SS-RE/RE-UE4SS.git" },
                @{ Path = "deps/json";     Url = "https://github.com/nlohmann/json.git" },
                @{ Path = "deps/safetyhook"; Url = "https://github.com/cursey/safetyhook.git" }
            )

            foreach ($sub in $requiredSubmodules) {
                $fullPath = Join-Path $RepoRoot $sub.Path
                $isEmpty = (-not (Test-Path $fullPath)) -or ((Get-ChildItem $fullPath -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0)

                if ($isEmpty) {
                    Write-Log "Submodule '$($sub.Path)' missing or empty -- adding/cloning it."
                    if (Test-Path $fullPath) { Remove-Item $fullPath -Recurse -Force }
                    $exitCode = Invoke-LoggedCommand -Exe "git" -CommandArgs @("submodule", "add", "--force", $sub.Url, $sub.Path)
                    if ($exitCode -ne 0) { throw "Failed to add submodule '$($sub.Path)'. Check the log above for the git error." }
                }
                else {
                    Write-Log "Submodule '$($sub.Path)' already present."
                }
            }

            Write-Log "Running 'git submodule update --init --recursive' (may take several minutes)..."
            $exitCode = Invoke-LoggedCommand -Exe "git" -CommandArgs @("submodule", "update", "--init", "--recursive")
            if ($exitCode -ne 0) { throw "'git submodule update --init --recursive' failed. Check the log above -- often an SSH/network issue on a NESTED sub-submodule (e.g. RE-UE4SS's own dependencies)." }
        }
        finally {
            Pop-Location
        }
    }

    # ---------------------------------------------------------------
    # STEP 8: CMake configure
    # ---------------------------------------------------------------
    Write-TimingWarning -StepName "CMake configure" -FallbackEstimate "First-time configure typically takes 1-3 minutes -- it clones several dependencies (glaze, glfw, imgui, zydis, polyhook2, fmt, the Rust patternsleuth crates, etc.) and compiles Rust's Cargo index. A quiet stretch with no new log lines is normal here, not a hang."
    Step "CMake configure" {
        if (Test-Path $BuildDir) {
            Write-Log "Removing stale build/ directory from a previous attempt."
            Remove-Item $BuildDir -Recurse -Force
        }

        $exitCode = Invoke-LoggedCommand -Exe "cmake" -CommandArgs @("-B", "build", "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Game__Shipping__Win64")
        if ($exitCode -ne 0) {
            throw "CMake configure failed. Common causes at this stage: a submodule's CMakeLists.txt itself failing (check the log above for WHICH dependency's configure step errored), or a missing Epic Games/GitHub account link required by RE-UE4SS. See the log for the exact CMake error."
        }
    }

    # ---------------------------------------------------------------
    # STEP 9: Build
    # ---------------------------------------------------------------
    Write-TimingWarning -StepName "Build (cmake --build)" -FallbackEstimate "This compiles ~535 targets from scratch, including ImGui, UE4SS itself, and the Rust patternsleuth component -- first-time builds commonly take 15-40+ minutes depending on CPU/core count. Ninja will print a '[n/535] Building ...' line per file, so as long as that count is climbing, it's working."
    Step "Build (cmake --build)" {
        $exitCode = Invoke-LoggedCommand -Exe "cmake" -CommandArgs @("--build", "build")
        if ($exitCode -ne 0) {
            throw "Build failed -- this is very likely a REAL C++ COMPILE ERROR (e.g. an RE-UE4SS API name/signature that doesn't match what RODSchema's source assumes). Check the log above for the exact file/line and error message -- paste it back for a fix, this is expected to need at least one iteration."
        }
    }

    # ---------------------------------------------------------------
    # STEP 10: Locate output DLL and install it as dlls/main.dll
    # ---------------------------------------------------------------
    Step "Locate and install main.dll" {
        $builtDll = Get-ChildItem -Path $BuildDir -Filter "RODSchema.dll" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $builtDll) {
            throw "Build reported success, but RODSchema.dll wasn't found anywhere under build/. Check the build log to see what filename/location it actually produced."
        }

        $dllsDir = Join-Path $RepoRoot "dlls"
        if (-not (Test-Path $dllsDir)) { New-Item -ItemType Directory -Path $dllsDir | Out-Null }

        $dest = Join-Path $dllsDir "main.dll"
        Copy-Item $builtDll.FullName $dest -Force
        Write-Log "Copied $($builtDll.FullName) -> $dest"
    }

    Write-Log "=== BUILD SUCCEEDED ===" "SUCCESS"
}
catch {
    Write-Log "=== BUILD FAILED: $($_.Exception.Message) ===" "FATAL"
}
finally {
    Write-Log ""
    Write-Log "----- Step summary -----"
    foreach ($key in $StepResults.Keys) {
        $timeStr = if ($StepTimings.Contains($key)) { " ({0})" -f (Format-Duration -Seconds $StepTimings[$key]) } else { "" }
        Write-Log ("{0,-45} {1}{2}" -f $key, $StepResults[$key], $timeStr)
    }
    Write-Log "Full log written to: $LogFile"

    # Merge this run's timings over the previous history (only PASSed
    # steps overwrite -- a failed/aborted step's partial time isn't a
    # meaningful estimate for next time) and save for the next run.
    foreach ($key in $StepTimings.Keys) {
        if ($StepResults[$key] -eq "PASS") {
            $PrevTimings[$key] = $StepTimings[$key]
        }
    }
    try {
        $PrevTimings | ConvertTo-Json | Set-Content -Path $TimingFile
    }
    catch {
        Write-Log "Could not save timing history to $TimingFile (non-fatal)." "WARN"
    }
}
