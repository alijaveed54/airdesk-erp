@echo off
title Quick Edit Search Fix v2

set ROOT=C:\airdesk-erp
set FILE=%ROOT%\app\api\orders\quick-edit\route.ts
set PS=%ROOT%\quick_edit_fix.ps1

if not exist "%FILE%" (
 echo ERROR: route.ts not found
 pause
 exit /b 1
)

echo Creating backup...
copy "%FILE%" "%FILE%.backup-before-search-v2" >nul

echo Creating PowerShell patch...

(
echo $file = "%FILE%"
echo $c = Get-Content $file -Raw
echo $old = @'
      if ^(fieldMap.status^) {
        params.set^(
          "filterByFormula",
          `{${fieldMap.status.name}}="Order Received"`
        ^);
      }
'@
echo $new = @'
      if ^(fieldMap.status^) {
        if ^($q -and $fieldMap.orderNo^) {
          params.set^(
            "filterByFormula",
            `AND({${fieldMap.status.name}}="Order Received", FIND("${q}", LOWER({${fieldMap.orderNo.name}}^&""))^>0)`
          ^);
        } else {
          params.set^(
            "filterByFormula",
            `{${fieldMap.status.name}}="Order Received"`
          ^);
        }
      }
'@
echo if ^(-not $c.Contains^($old^)^) { Write-Host "BLOCK NOT FOUND"; exit 2 }
echo $c = $c.Replace^($old,$new^)
echo Set-Content $file $c
echo Write-Host "SUCCESS: Quick Edit search updated"
) > "%PS%"

powershell -ExecutionPolicy Bypass -File "%PS%"

del "%PS%"

echo.
echo Done. Restart:
echo npm run dev
pause
