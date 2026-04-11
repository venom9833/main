---
description: Windows bat/cmd/PowerShell 파일 작성 규칙
globs: "**/*.bat,**/*.cmd,**/*.ps1"
---

# Windows 스크립트 작성 규칙

## bat/cmd 파일 필수사항

- **줄 바꿈은 반드시 CRLF** — Write 도구 사용 후 `sed -i 's/$/\r/' <file>` 로 CRLF 변환 확인
- **`%~dp0`** 사용 — 절대 경로 하드코딩 금지 (bat 파일 자기 위치 기준)
- **`setlocal`** — 환경 변수 오염 방지
- **`chcp 65001 >nul`** — UTF-8 한글 출력
- **`start "Title"`** — start 첫 인자는 반드시 따옴표로 감싼 타이틀

## bat 파일 생성/수정 후 검증 체크리스트

1. `xxd <file> | head -3` 로 CRLF(0d 0a) 확인
2. `%~dp0` 사용 여부 확인
3. `for /f` 구문 내 파이프는 `^|` 로 이스케이프

## PowerShell 호출 시

- bash에서 `powershell -Command "..."` 사용
- 변수는 `\$` 로 이스케이프 (bash 해석 방지)
- `cmd /c` 는 출력 캡처가 불안정 → `powershell` 우선 사용
