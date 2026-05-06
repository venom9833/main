---
name: GStack Browser 기본 브라우저 설정
description: AI는 브라우저 작업 시 GStack Browser를 기본으로 사용한다
type: feedback
---

GStack Browser를 모든 브라우저 작업의 기본 브라우저로 사용한다.

**Why:** 사용자가 명시적으로 지정. GStack Browser는 Claude가 직접 조작 가능하고 Side Panel에서 실시간 확인이 가능하며 `/qa` 등 스킬과 연동된다.

**How to apply:**
- 페이지 확인, QA 테스트, UI 검증이 필요할 때 항상 `browse goto`, `browse snapshot` 등 GStack Browser 명령을 사용한다
- 일반 브라우저(Chrome, Edge 등) 사용을 제안하지 않는다
- `/connect-chrome`으로 headed 모드 실행, 포트 34567
- 익스텐션 경로: `C:\Users\User\.claude\skills\gstack\extension`
