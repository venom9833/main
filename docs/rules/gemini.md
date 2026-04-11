# LinkDropV3 AI Operating Guidelines

이 파일은 Gemini CLI 에이전트가 세션을 시작할 때 가장 먼저 읽고 준수해야 하는 핵심 지침을 담고 있습니다.

## 1. 세션 초기화 (Startup Protocol)
- **필수 준수**: 모든 세션 시작 시, `docs/rules/` 디렉토리 내의 모든 문서를 우선적으로 스캔하여 프로젝트의 최신 규칙, 에이전트 설계 원칙, 코딩 컨벤션을 파악할 것.
- **백로그 확인**: `docs/BACKLOG.md`를 읽고 현재 집중 항목(🔴)과 미완료 이슈를 파악할 것. 새 이슈 발견 시 즉시 백로그에 추가, 완료 시 ✅ 섹션으로 이동할 것.
- **선택적 참조**: 비즈니스 로직 구현, 데이터베이스 설계, UI/UX 관련 작업 시에는 `docs/product/` 및 `docs/reference/` 내의 관련 문서를 필요에 따라(On-demand) 읽고 참조할 것.

## 2. 보안 및 프로젝트 관리
- **민감 정보 보호**: `.env`, `.gitignore` 설정을 엄격히 준수하며, API 키나 개인정보를 절대 로그에 출력하거나 커밋하지 말 것.
- **문서 동기화**: 프로젝트 구조나 규칙에 변경이 생길 경우, 즉시 `docs/rules/` 내의 관련 문서를 업데이트하여 지식의 무결성을 유지할 것.

## 3. 기술 스택 원칙
- **프론트엔드**: Next.js 14 + React 18 + TypeScript (App Router)
- **백엔드**: FastAPI + Python 3.10+ (Pydantic 기반 검증)
- **인프라**: Supabase (DB, Auth, Edge Functions)
- **AI**: NotebookLM Studio 중심의 Zero-API 지향
- **단일 런타임**: 모든 비즈니스 로직은 Python(백엔드)과 Node.js(프론트엔드) 내에서만 수행한다. (Deno 사용 금지)

---

## 4. AI 에이전트 역할 분담 (AI Agent Role Assignment)

- **코드 실행**: 코드 실행은 Claude 에이전트의 역할이다.
- **코드 리뷰**: Gemini Code Assist는 Claude 에이전트가 실행한 코드에 대한 리뷰를 담당한다.
- **직접 실행 금지**: Gemini Code Assist는 어떠한 경우에도 코드를 직접 실행하지 않는다.

---
*에이전트는 위 지침을 바탕으로 사용자의 의도를 정확히 파악하고, 일관된 고품질의 결과물을 생산해야 합니다.*