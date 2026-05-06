# LinkDrop V3 — Claude 프로젝트 지침

## ★★★★★ 대화 시작 즉시 — SESSION_START.md 하나만 읽을 것

```
.claude/SESSION_START.md   ← 현재 작업 + 잠금 결정 요약 + 추가 읽기 안내 (전부 포함)
```

**이 파일을 읽기 전까지 코드 수정 제안을 하지 말 것.**

---

## ★ CLAUDE.md 작성 원칙

> **이 파일은 목차(인덱스)다. 내용을 직접 쓰지 말 것.**

- 새로운 규칙은 `.claude/rules/` 에 별도 문서(번호_제목.md)를 생성, 여기엔 경로·한 줄 설명만 기재
- 번호 체계: 운영 규칙 `102번~` / 설계 문서 `50번~` / 잠금 결정 `LOCKED_DECISIONS.md`

---

## 운영 규칙 문서 (.claude/archives/)

| 문서 | 내용 |
|------|------|
| `.claude/archives/100_V3_시리즈_미구현 목록.md` | 미구현 기능 전체 목록 |
| `.claude/archives/101_기술_검토_목록.md` | 기술 검토 항목 목록 |
| `.claude/archives/102_작업_프로토콜.md` | 5단계 작업 프로토콜 / V3 독립성 / 설계 원칙 / Context7 규칙 |
| `.claude/archives/103_MCP_서버_규칙.md` | MCP 서버 목록 / Supabase DDL 규칙 |
| `.claude/archives/104_개발_환경_설정.md` | 기술 스택 / 코딩 규칙 / 모델 분담 / 프로젝트 구조 |
| `.claude/archives/105_이미지_저장_정책.md` | R2 저장 정책 / 금지 사항 |
| `.claude/archives/106_설계_문서_맵.md` | 50~69번·90~91번·107번 설계 문서 요약 테이블 |
| `.claude/archives/107_익스텐션_키프레임_보조도구_설계.md` | 익스텐션 Drawer 설계 / 그리드 프롬프트(2×2·3×3) / Phase 1 완료 기준 |
| `.claude/archives/108_YouTube_배포_전략.md` | SFX 수동 작업 확정 / YouTube 자동 업로드 / KR→EN→JP 로드맵 |
| `.claude/archives/BACKLOG.md` | 개발 백로그 (긴급·Phase2·이미지·V2 연동) |
| `.claude/archives/mcp 가이브북.md` | MCP 서버 사용 가이드북 |
| `.claude/archives/링크드랍 공통디자인스타일.html` | LinkDrop 공통 디자인 스타일 레퍼런스 HTML |

---

<investigate_before_answering>
코드에 대해 답하기 전에 반드시 해당 파일을 먼저 읽을 것.
확인하지 않은 코드에 대해 추측하지 말고 "확인하겠습니다"로 시작할 것.
</investigate_before_answering>

## Skill routing

When the user's request matches an available skill, invoke it via Skill tool FIRST.

> **★ V3 프론트엔드 기본값**: V3 프론트(`apps/web`) 작업 시 `ui-ux-pro-max`를 **항상 먼저** 실행한다.

- Bugs, errors, "why is this broken" → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site → invoke qa
- Code review → invoke review
- Save progress / checkpoint → invoke checkpoint
- **[기본값] V3 프론트 모든 작업** → invoke ui-ux-pro-max (자동 실행)
- 라이브러리·프레임워크·SDK 최신 문서 조회 → invoke find-docs (자동)
- Gemini API / google-genai SDK 코드 작성 → invoke gemini-api-dev (자동)

추가 스킬 목록: `~/.claude/CLAUDE.md` 참조
