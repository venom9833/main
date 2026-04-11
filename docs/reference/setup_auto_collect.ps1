# LinkDropV2 자동 수집 스케줄러 등록 스크립트 (수정본)

$TaskName = "LinkDrop_AutoScout"
# Deno의 전체 경로를 파악합니다.
$DenoPath = (Get-Command deno.exe).Source

# 트리거 설정: 지금부터 시작하여 1시간마다 무한 반복 (RepetitionDuration은 무제한)
$Time = Get-Date
$Trigger = New-ScheduledTaskTrigger -Daily -At $Time.AddMinutes(1)
$Trigger.Repetition = (New-Object -TypeName Microsoft.Management.Infrastructure.CimInstance -ArgumentList (Get-CimClass -ClassName MSFT_TaskRepetitionPattern -Namespace Root/Microsoft/Windows/TaskScheduler))
$Trigger.Repetition.Interval = "PT1H" # 1시간 간격

$ActionExecutable = $DenoPath
$ActionArguments = "run -A C:\LinkDropV2\packages\agents\4_content-system\4_index.ts --auto-pilot"

# 이미 등록된 작업이 있다면 삭제
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# 새 작업 등록
Register-ScheduledTask -TaskName $TaskName -Action (New-ScheduledTaskAction -Execute $ActionExecutable -Argument $ActionArguments) -Trigger $Trigger -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances Parallel) -Description "LinkDropV2 1시간마다 자동 데이터 수집"

Write-Host "--------------------------------------------------"
Write-Host "✅ 성공: '$TaskName' 작업이 등록되었습니다."
Write-Host "📍 실행 도구: $DenoPath"
Write-Host "⏱️ 주기: 1시간마다 백그라운드 실행"
Write-Host "--------------------------------------------------"
