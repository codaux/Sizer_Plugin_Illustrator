param(
  [string]$ExtensionId = "com.sizer.ai.illustrator"
)

$sourcePath = Join-Path $PSScriptRoot "extension"
$targetRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
$targetPath = Join-Path $targetRoot $ExtensionId

if (-not (Test-Path $sourcePath)) {
  throw "Source folder not found: $sourcePath"
}

New-Item -Path $targetRoot -ItemType Directory -Force | Out-Null

if (Test-Path $targetPath) {
  Remove-Item -Path $targetPath -Recurse -Force
}

Copy-Item -Path $sourcePath -Destination $targetPath -Recurse -Force

foreach ($version in 8..13) {
  $keyPath = "HKCU:\Software\Adobe\CSXS.$version"
  New-Item -Path $keyPath -Force | Out-Null
  New-ItemProperty -Path $keyPath -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
}

Write-Host "Installed/Updated CEP extension at: $targetPath"
Write-Host "PlayerDebugMode=1 set for CSXS.8 to CSXS.13"
Write-Host "Restart Illustrator, then open: Window > Extensions (Legacy) > Sizer Illustrator 2026"
