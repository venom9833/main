---
name: v3_scenes production/animation_type 미구현 (62번 최우선)
description: v3_scenes 테이블에 production, animation_type 컬럼이 없음 — 62번 §1 요구사항
type: project
---

v3_scenes에 `production` (split/composite/bg_only)과 `animation_type` (parallax/ken_burns/lipsync) 컬럼 없음.

**Why:** 62번(패럴랙스 렌더링) §1 요구사항. 이 필드 없이는 compose-prompt API 분기 및 Remotion 렌더링 불가.

**How to apply:** 구현 세션에서 최우선 처리. ALTER TABLE로 두 컬럼 추가 후 `_parse_scenes_json()`에 채우기 로직 추가.
