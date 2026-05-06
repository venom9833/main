---
name: V3 독립성 원칙
description: V3는 V2와 독립된 프로젝트 — 사용자가 명시하지 않는 한 V2 파일/문서를 읽거나 참조하지 않는다
type: feedback
---

V3 작업 중 V2 파일(코드, 문서, 메모리)을 읽거나 참조하지 않는다. 사용자가 명시적으로 "V2의 ~를 참고해" 라고 지정한 경우에만 허용한다.

**Why:** V3는 V2와 독립된 프로젝트다. V2 코드·설계에 의존하는 성향이 생기면 V3 고유의 설계 결정이 V2 패턴에 오염된다.

**How to apply:** V3 컨텍스트(`C:\LinkDropV3`)에서 작업할 때, `C:\LinkDropV2` 경로의 파일을 Read/Grep/Glob하지 않는다. V2 MEMORY.md, V2 CLAUDE.md도 동일하게 참조 금지. 공통 인프라(Supabase, .env 키)를 언급할 때도 V2 코드가 아닌 V3 코드베이스에서 직접 확인한다.
