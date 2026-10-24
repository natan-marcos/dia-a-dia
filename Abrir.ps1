param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$appDir = $PSScriptRoot
$dataDir = Join-Path $env:LOCALAPPDATA 'DiaADia'
$address = 'http://127.0.0.1:43127'
function Get-AppHealth {
  try { return (Invoke-RestMethod -Uri "$address/api/local/health" -TimeoutSec 2).app -eq 'dia-a-dia-local' }
  catch { return $false }
}
try {
  if ($Stop) {
    if (Get-AppHealth) {
      $token = [IO.File]::ReadAllText((Join-Path $dataDir 'controle-local.txt'))
      Invoke-RestMethod -Uri "$address/api/local/stop" -Method Post -Headers @{ 'X-Local-Control' = $token } -TimeoutSec 5 | Out-Null
    }
    exit
  }
  if (-not (Get-AppHealth)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    $runtime = Join-Path $appDir 'runtime\node.exe'
    if (-not (Test-Path -LiteralPath $runtime)) { $runtime = (Get-Command node -ErrorAction Stop).Source }
    $entry = Join-Path $appDir 'server\local.mjs'
    $env:DIA_A_DIA_DATA_DIR = $dataDir
    Start-Process -FilePath $runtime -ArgumentList ('"{0}"' -f $entry) -WorkingDirectory $appDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataDir 'aplicativo.log') -RedirectStandardError (Join-Path $dataDir 'erros.log') | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
      Start-Sleep -Milliseconds 200
      if (Get-AppHealth) { $ready = $true; break }
    }
    if (-not $ready) { throw "Nao foi possivel abrir o aplicativo. Confira $dataDir\erros.log. A porta 43127 pode estar ocupada." }
  }
  Start-Process $address
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Dia a dia') | Out-Null
  exit 1
}
