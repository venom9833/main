# 55. LinkDrop V3 — TTS 성우 배정 정책

**최초 작성: 2026년 4월 11일**
**최종 수정: 2026년 4월 11일**
**설계자: 공동감독 김감독 (AI)**
**승인자: 이감독 (사용자)**

---

## 핵심 원칙

> **1 캐릭터 = 1 성우 (Supertone 기준)**
> **모든 캐릭터는 두 개의 성우 필드를 모두 보유해야 한다**

| 필드 | 엔진 | 역할 | 원칙 |
|------|------|------|------|
| `supertone_voice_id` | Supertone API | **주 성우** | 캐릭터당 고유 배정 필수 |
| `voice_id` | edge-tts (무료) | **폴백 성우** | 같은 씬 미등장 캐릭터끼리 공유 허용 |

**동시 등장 충돌 규칙:**
- 같은 씬에 동시 등장하는 캐릭터는 Supertone/edge-tts 모두 다른 성우 사용
- 같은 씬에 등장하지 않는 캐릭터끼리는 edge-tts 성우 공유 허용

---

## TTS 엔진 라우팅 순서

```
1. supertone_voice_id 존재 → Supertone API 호출  (st:{id}:{style})
2. voice_id 존재         → edge-tts 폴백
3. 둘 다 없음            → 성별/나이대 EXTRA_VOICE_MAP 자동 배정
```

---

## edge-tts 한국어 목소리 9개

| 별칭 | 실제 ID | 성별 | 배정 나이대 |
|------|---------|------|-------------|
| bongjin | ko-KR-BongJinNeural | 남 | 청소년 |
| gookmin | ko-KR-GookMinNeural | 남 | 청년 |
| injoon | ko-KR-InJoonNeural | 남 | 중년(낮음) |
| hyunsu | ko-KR-HyunsuNeural | 남 | 중년+·시니어 |
| sunhi | ko-KR-SunHiNeural | 여 | 청소년 |
| jimin | ko-KR-JiMinNeural | 여 | 청년(낮음) |
| yujin | ko-KR-YuJinNeural | 여 | 청년(중간) |
| seohyeon | ko-KR-SeoHyeonNeural | 여 | 중년 |
| soonbok | ko-KR-SoonBokNeural | 여 | 시니어 |

---

## 캐릭터 전체 성우 배정표

> `supertone_voice_id` = ⏳ 대기 : 사용자가 수동 입력 예정
> `voice_id` = edge-tts 폴백 (나이대 기반 자동 배정, 동시 등장 충돌 시 교체)

### 주연 6명

| ID | 이름 | 성별/나이 | supertone_voice_id | supertone_style | voice_id (폴백) |
|----|------|----------|--------------------|-----------------|-----------------|
| park_jh | 박준혁 | 남·44 | 42b52760fe9ecf701f8ed3 | neutral | injoon |
| lee_sj | 이수진 | 여·42 | bacc385ac094a4e0c187a0 | neutral | seohyeon |
| kim_th | 김태호 | 남·53 | 5132bd591a11bdce62753a | neutral | hyunsu |
| han_ej | 한은정 | 여·51 | fa1880d5d3846077811a76 | neutral | seohyeon |
| choi_ms | 최민성 | 남·47 | 7f8873011eeba6f11b750f | neutral | injoon |
| yang_sy | 양서연 | 여·39 | ff5d65cc3b62ed51a7d3ae | neutral | seohyeon |

### 조연 21명

| ID | 이름 | 성별/나이 | supertone_voice_id | supertone_style | voice_id (폴백) |
|----|------|----------|--------------------|-----------------|-----------------|
| cha_mh | 차민혁 | 남·27 | 0f4f3a51a5e0ba62cfee2d | neutral | gookmin |
| choi_eb | 최은비 | 여·14 | 7e65acfbccf3cce87240ca | neutral | sunhi |
| choi_jh | 최재현 | 남·22 | 8590d2b8884926372c6b4f | neutral | gookmin |
| han_jy | 한지영 | 여·35 | 32c38cb38d994a6c6d3d04 | neutral | yujin |
| hwang_jb | 황재복 | 남·71 | c3c0898fd41489a8e8919c | neutral | hyunsu |
| jeong_ms | 정만술 | 남·75 | db26b7e1720e0812dd8979 | neutral | hyunsu |
| kang_os | 강옥순 | 여·74 | 5f91e0cb18c95641a1af2b | neutral | soonbok |
| kang_sja | 강순자 | 여·72 | 67e1039beb489d8a8bd133 | neutral | soonbok |
| kim_ne | 김나은 | 여·25 | fd15ad31caa16bd021f01d | neutral | jimin |
| kim_ys | 김영수 | 남·83 | d9411052b13cba9cb4c313 | neutral | hyunsu |
| kwon_so | 권순옥 | 여·72 | 24a159c68844e17d4f73cd | neutral | soonbok |
| lee_je | 이지은 | 여·34 | d39f0ea3c259e885e69a3c | neutral | yujin |
| lee_mj | 이민준 | 남·38 | 763d5f200a9f5808056733 | neutral | injoon |
| lim_dj | 임도준 | 남·45 | 12bab70236ce079bb0e4ea | neutral | injoon |
| na_yh | 나윤희 | 여·52 | 6488703b585fedfb9f0b1c | neutral | seohyeon |
| oh_bs | 오봉수 | 남·68 | a1a8c25b18309e96472109 | neutral | hyunsu |
| park_bs | 박복순 | 여·69 | 39f27eaab088024ff6f9ac | neutral | soonbok |
| park_sw | 박시우 | 남·17 | 56e1a6c42fc4968d15a394 | neutral | bongjin |
| seo_ja | 서지안 | 여·33 | 0205edb0eae637832e04c2 | neutral | jimin |
| yang_sj | 양서진 | 여·36 | c27cdf3fdb77d6402f7655 | neutral | yujin |
| yoon_ms | 윤말순 | 여·66 | 427bbfa89704dfba8feed4 | neutral | soonbok |

---

## 특수 성우 (나래이션 + 아이) — config.py 저장

| 역할 | config 변수 | supertone_voice_id |
|------|-------------|-------------------|
| 나래이션 남 | SUPERTONE_NARRATOR_MALE_ID | ab7cd18e645b54d7536e0f |
| 나래이션 여 | SUPERTONE_NARRATOR_FEMALE_ID | 195e1922033a6168f0c90f |
| 아이 여 | SUPERTONE_CHILD_FEMALE_ID | 400c24c9a2718734a5b404 |
| 아이 남 | SUPERTONE_CHILD_MALE_ID | 59901b1bf6d0a41d49397f |

---

## ⚠️ edge-tts 폴백 공유 주의 목록

같은 폴백 voice_id를 가진 캐릭터 중 동일 씬 등장 가능성 있는 쌍은 대본 작성 시 확인 필요:

| voice_id | 공유 캐릭터 | 동시 등장 위험도 |
|----------|------------|-----------------|
| injoon | park_jh, choi_ms, lee_mj, lim_dj | ⚠️ 높음 (주연 + 빌런) |
| seohyeon | lee_sj, han_ej, yang_sy, na_yh | ⚠️ 중간 (주연 여러 명) |
| hyunsu | kim_th, hwang_jb, jeong_ms, oh_bs, kim_ys | 낮음 (시니어 별도 동선) |
| yujin | han_jy, lee_je, yang_sj | 낮음 (조연 별도 동선) |
| jimin | kim_ne, seo_ja | 낮음 |
| soonbok | kang_os, kang_sja, kwon_so, park_bs, yoon_ms | 낮음 (시니어 별도 동선) |
| gookmin | cha_mh, choi_jh | 낮음 |

> Supertone이 배정되면 위 공유 충돌은 자동 해소됨

---

## Supertone voice_id 입력 방법

### UI (캐릭터 페이지)
캐릭터 카드 → Supertone 섹션 → voice_id 입력 + 저장

### API
```
PATCH /api/v1/characters/{char_id}/supertone-voice
{ "supertone_voice_id": "...", "supertone_style": "neutral" }
```

### 직접 JSON 편집
`apps/api/data/characters/{id}.json`
```json
{
  "supertone_voice_id": "...",
  "supertone_style": "neutral"
}
```
