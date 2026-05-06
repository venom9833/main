# 55. LinkDrop V3 — TTS 성우 배정 정책

**최초 작성: 2026년 4월 11일**
**최종 수정: 2026년 4월 19일**

---

## ★ 핵심 원칙 (2026-04-19 개정)

> **나레이션 = edge-tts (시리즈 ttsGender 설정 기준 여/남)**
> **캐릭터 대사 = Supertone (캐릭터별 고유 성우 — `supertone_voice_id`)**

---

## TTS 엔진 정책

| 컷 타입 | 처리 주체 | 엔진 | 음성 결정 기준 |
|---------|-----------|------|---------------|
| `narration` | 파이프라인 자동 | **edge-tts** | 시리즈 `settings.ttsGender` (female/male) |
| `dialogue` | 파이프라인 자동 | **Supertone** | 캐릭터 JSON `supertone_voice_id` |

---

## 나레이션 — edge-tts 음성

시리즈 `settings.ttsGender` 값에 따라 결정. UI 상단 "나레이션 여/남" 토글로 변경하면 즉시 settings에 저장됨.

| ttsGender | 음성 ID | 비고 |
|-----------|---------|------|
| `female` (기본) | `ko-KR-SunHiNeural` | 여성 나레이터 |
| `male` | `ko-KR-HyunsuMultilingualNeural` | 남성 나레이터 |

> **주의**: `ko-KR-InJoonNeural` 등 구버전 음성은 Microsoft 서비스 종료 (2026-04). 호출 시 `NoAudioReceived` 오류.

---

## 캐릭터 대사 — Supertone

캐릭터 JSON (`{char_id}.json`)의 `supertone_voice_id` 필드에 Supertone play.supertone.ai 성우 ID를 등록.
`tts_voice` DB 컬럼에 `st:{voice_id}:{style}` 형식으로 저장됨.

```json
// 캐릭터 JSON 예시
{
  "supertone_voice_id": "7f8873011eeba6f11b750f",
  "supertone_style": "neutral"
}
```

파이프라인 처리 시:
- `tts_voice` 값이 `st:`로 시작 → Supertone API 호출
- `st:`가 아닌 값(edge-tts 잔존값) → 나레이션으로 간주 → `ttsGender` 기준 edge-tts 적용

---

## edge-tts 하위 호환 VOICE_MAP

구버전 캐릭터 `voice_id` 값 → 성별 기준 edge-tts 폴백 (Supertone 미등록 캐릭터용).

| voice_id 값 | 실제 적용 음성 |
|-------------|---------------|
| hyunsu, bongjin, gookmin, injoon, andrew, dohyun, gwangsu, harrison | `HyunsuMultilingualNeural` (남성) |
| sunhi, angelina, chiki, dayun, grace, jihu, jimin, misook, seohyeon, soonbok, tilly, yujin | `SunHiNeural` (여성) |

---

## 캐릭터 전체 성우 배정표

| ID | 이름 | 성별/나이 | Supertone ID | 비고 |
|----|------|----------|-------------|------|
| choi_ms | 최민성 | 남·47 | 7f8873011eeba6f11b750f | |
| yang_sy | 양서연 | 여·39 | ff5d65cc3b62ed51a7d3ae | |
| park_jh | 박준혁 | 남·44 | — | 미등록 시 edge-tts 폴백 |
| (기타) | | | — | supertone_voice_id 없으면 edge-tts 폴백 |

---

## EXTRA_VOICE_MAP (엑스트라 — edge-tts 자동 배정)

캐스팅 외 화자 → 성별만으로 자동 배정.

| 키 | 음성 |
|----|------|
| male / teen_male / young_male / adult_male / elder_male / child_male | `HyunsuMultilingualNeural` |
| female / teen_female / young_female / adult_female / elder_female / child_female | `SunHiNeural` |

---

## 폐기 항목

| 항목 | 상태 | 사유 |
|------|------|------|
| `ko-KR-InJoonNeural` | ⛔ 폐기 | Microsoft 서비스 종료 |
| "Supertone은 파이프라인에서 사용하지 않는다" | ⛔ 폐기 | 2026-04-19 캐릭터 대사에 Supertone 도입 |
