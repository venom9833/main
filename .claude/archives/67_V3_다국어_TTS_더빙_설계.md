# 67. LinkDrop V3 — 다국어 TTS·더빙 분리 트랙 설계

**최초 작성: 2026-04-20**

---

## ★ 핵심 원칙

> **언어 독립 영상** × **언어 독립 SFX** × **언어 종속 TTS** = 최종 MP4
>
> 한국어 더빙 파일만 교체하면 영어·일본어 버전 완성. 영상과 SFX는 재생성 불필요.

---

## 아키텍처 개요

```
{code}_clean.mp4   ← 영상만 (무음) — 언어 무관
{code}_sfx.mp3     ← SFX + BGM 믹스 — 언어 무관
{code}.mp3         ← TTS 목소리 (한국어 기준) — 언어 종속

──────────────────────────────────────────
_mux_final() →  {code}.mp4  = 최종 합성 (KR)
```

### 다국어 확장 시나리오

```
미래 영어 버전:
  1. en_voice.mp3 생성 (TTS 또는 사람 더빙)
  2. _mux_final({code}_clean.mp4, en_voice.mp3, {code}_sfx.mp3) → {code}_en.mp4
  → 비용: 영상/SFX 재생성 없음 (TTS 비용만 발생)
```

---

## 파일 명명 규칙

| 파일 | 역할 | 재사용 가능 여부 |
|------|------|----------------|
| `{code}_clean.mp4` | 무음 클린 영상 | ✅ 언어 무관 |
| `{code}_sfx.mp3` | SFX + BGM 믹스 | ✅ 언어 무관 |
| `{code}.mp3` | 한국어 TTS 목소리 | ❌ 언어 종속 |
| `{code}.mp4` | 최종 합성 (KR) | ❌ 언어 종속 |

### 코드 예시 (ch01s01nc02)

```
output/series_code/ch01/
  ch01s01nc02_clean.mp4   ← 켄번스 무음 영상
  ch01s01nc02_sfx.mp3     ← SFX+BGM (비 소리, 도심 앰비언스 등)
  ch01s01nc02.mp3         ← 한국어 TTS
  ch01s01nc02.mp4         ← 최종 KR 합성
```

---

## DB 컬럼 (v3_scenes)

| 컬럼 | 타입 | 용도 |
|------|------|------|
| `clean_url` | TEXT | R2 무음 클린 영상 URL — 다국어 재더빙용 |
| `sfx_url` | TEXT | R2 SFX+BGM MP3 URL — 재더빙 시 재사용 |
| `tts_url` | TEXT | R2 한국어 TTS MP3 URL |
| `lipsync_url` | TEXT | 최종 합성 MP4 URL (네이밍 유지 — 기존 호환) |

> **⚠️ `lipsync_url`**: 이름이 lipsync지만 실제로는 최종 합성 MP4 URL. 레거시 네이밍이므로 변경 금지 (58번 참조).

---

## 핵심 함수 (kenburns_service.py)

### `_mix_sfx_only(sfx_plan, out_mp3, total_dur)`

언어와 무관한 SFX+BGM 믹스만 생성. TTS 없음.

```python
# 역할: sfx_plan의 OGG 레이어들 → 단일 MP3 (amix)
# SFX 없으면: anullsrc 무음 MP3 생성
# 출력: {code}_sfx.mp3
```

### `_mux_final(clean_mp4, voice_mp3, sfx_mp3, out_mp4, total_dur)`

클린 영상 + TTS + SFX 3트랙 합성.

```python
# 분기:
# sfx_mp3 존재 → [voice_mp3 + sfx_mp3] amix → out_mp4
# sfx_mp3 없음 → voice_mp3 only → out_mp4
# 내부 tmpdir 사용 (in-place 안전)
```

### `_run_hybrid(..., clean_out=None, sfx_mp3_out=None)`

립싱크 + 켄번스 테일 concat 후 클린 영상 저장.

```python
# clean_out 지정 시 → concat 결과를 clean.mp4로 복사 (무음 아님 — 립싱크 오디오 포함)
# sfx_mp3_out 지정 시 → sfx.mp3 복사
# 이후 _mux_final로 최종 합성
```

---

## 파이프라인 흐름

### PATH G — Ken Burns 전용 (narration)

```
_pillow_kenburns() → {code}_clean.mp4  (무음)
_mix_sfx_only()   → {code}_sfx.mp3
_mux_final()      → {code}.mp4         (최종 KR)
```

### PATH H — Hybrid (dialogue, lipsync 있음)

```
_run_hybrid():
  립싱크 mp4 + 켄번스 테일 concat → concat_mp4
  └─ if clean_out → {code}_clean.mp4 복사 (립싱크 오디오 포함)
  _mix_sfx_only()  → sfx_tmp
  └─ if sfx_mp3_out → {code}_sfx.mp3 복사
  _mux_final(concat_mp4, voice_mp3, sfx_tmp) → {code}.mp4
```

> **⚠️ Hybrid clean.mp4 주의**: dialogue 컷의 `_clean.mp4`는 립싱크 오디오가 내장됨. 순수 무음이 아님. 다국어 교체 시 립싱크 영상을 다시 만들거나 별도 처리 필요.

---

## R2 동기화 엔드포인트 (chapters.py)

### 파일 → DB 필드 매핑

```python
def _resolve_field(stem: str, ext: str) -> str | None:
    if ext == ".png":  return "keyframe_url"
    if ext == ".srt":  return "srt_url"
    if ext == ".ogg":  return None          # SFX 에셋 — DB 저장 안 함
    if ext == ".mp4":
        return "clean_url" if stem.endswith("_clean") else "lipsync_url"
    if ext == ".mp3":
        return "sfx_url" if stem.endswith("_sfx") else "tts_url"
    return None

def _base_stem(stem: str) -> str:
    """_clean / _sfx 접미사 제거 → scene_id 조회용"""
    for suffix in ("_clean", "_sfx"):
        if stem.endswith(suffix):
            return stem[: -len(suffix)]
    return stem
```

### OGG 파일 처리

SFX 소스 OGG는 `linkdrop-assets` R2 버킷에 별도 보관. `flux-bg-library` (시리즈 콘텐츠 버킷)에는 업로드하지 않으며 DB `sfx_url` 에도 저장하지 않는다. `sfx_url`은 믹스 결과물인 `{code}_sfx.mp3` URL을 저장.

---

## render_service.py 정책

`_normalize_clip(src, dst)`: mp3 오버라이드 없음. mp4에 베이크된 오디오(voice+SFX) 그대로 사용.

```python
# 이전 (삭제됨): _normalize_clip(src, dst, mp3_override)
# 현재: mp4 내장 트랙 우선, 없으면 anullsrc 무음
# ← _mux_final이 이미 voice+SFX를 합성해서 mp4에 베이크했으므로 별도 mp3 불필요
```

---

## 절대 하지 말 것

- `_mux_audio_layers()` 부활 — voice+SFX를 분리 불가 형태로 합성 (삭제됨. LD-011 취지 위반)
- `_normalize_clip`에 mp3 오버라이드 재도입 — SFX 손실 버그 재발
- `_clean.mp4`와 `_sfx.mp3` 생성 없이 최종 mp4만 출력하는 코드 복원
- `clean_url` / `sfx_url` 컬럼 삭제 또는 다른 용도로 재사용

---

## 향후 다국어 구현 로드맵 (미구현)

| 단계 | 작업 | 비고 |
|------|------|------|
| EN-1 | `en_voice.mp3` 생성 엔드포인트 | edge-tts EN 또는 외부 더빙 서비스 |
| EN-2 | `_mux_final(clean, en_voice, sfx)` → `{code}_en.mp4` | kenburns_service 파라미터 추가 |
| EN-3 | DB `en_lipsync_url` 컬럼 추가 | v3_scenes 마이그레이션 |
| EN-4 | 프론트 언어 선택 UI | `/series/mp4combine` 언어 탭 |
