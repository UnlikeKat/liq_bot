# launch_gui.ps1
# Script to launch the Aave Liquidation Bot GUI as a standalone window

Write-Host "🚀 INITIALIZING NATIVE TRADING COMMAND CENTER..." -ForegroundColor Cyan

# 1. Kill any existing UI processes to prevent port conflicts
Write-Host "🧹 Cleaning up old sessions..."
try {
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*ui*" } | Stop-Process -Force
}
catch {}

# 2. Start the UI Dev Server in a hidden way
Write-Host "⚡ Starting Frontend High-Frequency Stream..."
Start-Process "cmd.exe" -ArgumentList "/c cd ui && npm run dev" -WindowStyle Minimized

# 3. Wait for the server to be strictly reachable
Write-Host "⏳ Establishing Blockchain Bridge..."
$retries = 0
$maxRetries = 10
while ($retries -lt $maxRetries) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5173" -Method Head -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) { break }
    }
    catch {}
    $retries++
    Start-Sleep -Seconds 1
}

# 4. Launch Chrome in App Mode
$browserPath = ""
if (Test-Path "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe") {
    $browserPath = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
}
elseif (Test-Path "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe") {
    $browserPath = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
}
elseif (Test-Path "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") {
    $browserPath = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
}

if ($browserPath) {
    Write-Host "🖥️ LAUNCHING INTERACTIVE WINDOW..." -ForegroundColor Green
    Start-Process -FilePath $browserPath -ArgumentList "--app=http://localhost:5173", "--window-size=1600,900"
}
else {
    Write-Host "⚠️ Browser Path not automatic. Please open http://localhost:5173 manually." -ForegroundColor Yellow
}

Write-Host "`n✅ DASHBOARD READY." -ForegroundColor White
Write-Host "👉 RUN THIS IN A NEW TERMINAL TO START THE HUNT:" -ForegroundColor Cyan
Write-Host "npm run bot-gui" -ForegroundColor Green
