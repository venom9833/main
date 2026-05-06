---
name: 기본 화풍 = polystyle
description: 특별한 요청 없으면 화풍 기본값은 polystyle — masako/real 사용 금지
type: project
---

기본 화풍 키: **`polystyle`** (2026-04-17 확정)

**Why:** 사용자가 "당분간 특별한 요청이 없으면 기본값을 폴리형으로 화풍을 고정한다"고 명시.
이전 기본값이었던 `masako`와 `real`은 보조/레거시 용도로만 취급.

**How to apply:**
- 화풍 관련 코드·프롬프트·API 파라미터 기본값 → `polystyle`
- 이미지 URL 참조 시 `photo_polystyle_url` 우선
- 사용자가 명시적으로 다른 화풍을 요청할 때만 변경
- `masako` / `real` 코드가 있어도 수정 제안하지 말 것 (호환성 유지)
