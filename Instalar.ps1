$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'Programs\DiaADia'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($name in @('public', 'server', 'drizzle')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $destination -Recurse -Force
}
foreach ($name in @('package.json', 'Abrir.ps1', 'Abrir Dia a dia.vbs', 'LEIA-ME.md')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $destination -Force
}
$runtimeDir = Join-Path $destination 'runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source
Copy-Item -LiteralPath $node -Destination (Join-Path $runtimeDir 'node.exe') -Force
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Dia a dia'
New-Item -ItemType Directory -Path $menu -Force | Out-Null
foreach ($folder in @($desktop, $menu)) {
  $shortcut = $shell.CreateShortcut((Join-Path $folder 'Dia a dia.lnk'))
  $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $shortcut.Arguments = '"' + (Join-Path $destination 'Abrir Dia a dia.vbs') + '"'
  $shortcut.WorkingDirectory = $destination
  $shortcut.Description = 'Dailys e referencias locais'
  $shortcut.Save()
}
$stop = $shell.CreateShortcut((Join-Path $menu 'Encerrar Dia a dia.lnk'))
$stop.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$stop.Arguments = '-NoProfile -WindowStyle Hidden -File "' + (Join-Path $destination 'Abrir.ps1') + '" -Stop'
$stop.WindowStyle = 7
$stop.Save()
Write-Output "Instalado em $destination"
Write-Output "Atalho criado em $desktop"
