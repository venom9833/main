"""
source_analyzer.py — 순수 Python 소스 분석기

Gemini 없이 re + collections.Counter 만으로 소스를 분석해 300자 이내 요약을 만든다.
용도: 사용자 파일 업로드 후 world_data.source_summary에 저장 → Gemini 세계관 생성 시 주입
"""
import re
from collections import Counter


# ── 전처리 ────────────────────────────────────────────────────────────────────

def _normalize_text(text: str) -> str:
    """공백 정규화, HTML 태그 제거"""
    text = re.sub(r'\r\n|\r', '\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    # 한글·영숫자·기본 구두점 이외 제거
    text = re.sub(r'[^\w\s.,!?;:\u201c\u201d\u2018\u2019()\-\u2014\u2026\n]', ' ', text)
    text = re.sub(r' +', ' ', text)
    return text.strip()


def _split_sentences(text: str) -> list[str]:
    """마침표·느낌표·물음표·줄바꿈 기준으로 문장 분리"""
    sents = re.split(r'(?<=[.!?])\s+|\n+', text)
    return [s.strip() for s in sents if 10 <= len(s.strip()) <= 200]


# ── 핵심 어휘 추출 ─────────────────────────────────────────────────────────────

_STOPWORDS = {
    '이', '그', '저', '것', '수', '등', '및', '또는', '그리고', '하지만',
    '그러나', '그런데', '따라서', '때문에', '있다', '없다', '하다', '되다',
    '않다', '못하다', '위해', '통해', '대해', '관해', '대한', '위한',
    '이런', '그런', '저런', '이렇게', '그렇게', '저렇게', '더', '가장',
    '매우', '아주', '정말', '너무', '이미', '아직', '바로', '곧',
    '한', '한번', '또', '다시', '계속', '항상', '때', '곳', '중',
    '하여', '하며', '하면', '했다', '했고', '있는', '없는', '되는',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'can', 'could', 'may', 'might', 'of', 'in', 'to', 'for',
    'on', 'at', 'by', 'from', 'with', 'this', 'that', 'it',
}


def _extract_entity_candidates(text: str) -> Counter:
    """
    2~8글자 한글 어휘 후보 + 영문 대문자 고유명사 + 숫자+단위 추출
    조사로 끝나는 어절은 제외
    """
    counter: Counter = Counter()

    # 한글 2~8글자 (조사 제외 패턴)
    korean_words = re.findall(r'[가-힣]{2,8}', text)
    for w in korean_words:
        if w not in _STOPWORDS and not re.search(r'[이가을를은는에서로의도만]$', w):
            counter[w] += 1

    # 영문 대문자 고유명사
    for w in re.findall(r'\b[A-Z][a-z]{2,15}\b', text):
        counter[w] += 1

    # 숫자+단위 (2025년, 30억, 50% 등)
    for w in re.findall(r'\d+[년월일억만천원%]', text):
        counter[w] += 1

    return counter


# ── 문장 점수화 ───────────────────────────────────────────────────────────────

def _score_sentences(sentences: list[str], entity_counter: Counter) -> list[tuple[float, str]]:
    """핵심 어휘 등장 빈도 × 위치 가중치 × 길이 패널티"""
    scored = []
    n = len(sentences)
    top_words = [w for w, _ in entity_counter.most_common(20)]

    for i, sent in enumerate(sentences):
        score = sum(entity_counter[w] for w in top_words if w in sent)
        # 앞쪽 문장 가중치 (도입부 정보 밀도 반영)
        position_weight = 1.0 - (i / max(n, 1)) * 0.3
        # 길이 패널티: 50~80자 이상적
        length_penalty = max(1.0 - abs(len(sent) - 65) / 200, 0.3)
        scored.append((score * position_weight * length_penalty, sent))

    return scored


# ── 요약 구성 ─────────────────────────────────────────────────────────────────

def _compose_summary(entities: list[str], key_sentences: list[str], max_chars: int = 300) -> str:
    """핵심어 태그 + 핵심 문장 → max_chars 이내 텍스트"""
    parts: list[str] = []

    if entities:
        parts.append(f"[핵심어: {' · '.join(entities[:8])}]")

    for sent in key_sentences:
        candidate = " ".join(parts + [sent])
        if len(candidate) <= max_chars:
            parts.append(sent)
        else:
            break

    return " ".join(parts)[:max_chars]


# ── 퍼블릭 API ────────────────────────────────────────────────────────────────

def analyze(text: str, filename: str = "") -> dict:
    """
    순수 Python 소스 분석. Gemini 호출 없음.

    Returns:
        {
            "entities":      list[str],  # 최대 10개 핵심어
            "key_sentences": list[str],  # 최대 5개 핵심 문장
            "summary":       str,        # 300자 이내 요약
            "char_count":    int,        # 정규화 후 글자 수
            "filename":      str,
        }
    """
    normalized = _normalize_text(text)

    if len(normalized) < 50:
        return {
            "entities": [],
            "key_sentences": [],
            "summary": normalized[:300],
            "char_count": len(normalized),
            "filename": filename,
        }

    sentences = _split_sentences(normalized)
    counter = _extract_entity_candidates(normalized)
    top_entities = [w for w, _ in counter.most_common(10)]

    scored = _score_sentences(sentences, counter)
    scored.sort(key=lambda x: x[0], reverse=True)
    key_sents = [s for _, s in scored[:5]]

    summary = _compose_summary(top_entities, key_sents)

    return {
        "entities": top_entities,
        "key_sentences": key_sents,
        "summary": summary,
        "char_count": len(normalized),
        "filename": filename,
    }


def classify(analysis: dict) -> dict:
    """
    analyze() 결과를 받아 소스 유형을 분류한다. Gemini 호출 없음.

    Returns:
        {
            "type": "novel" | "keyword" | "news" | "ambiguous",
            "confidence": 0.0~1.0,
            "signals": { ... },   # 판별에 사용된 신호
        }
    """
    char_count = analysis.get("char_count", 0)
    entities: list[str] = analysis.get("entities", [])
    key_sentences: list[str] = analysis.get("key_sentences", [])

    # 신호 계산용 전체 텍스트 (key_sentences + entities 합산)
    combined_text = " ".join(key_sentences) + " " + " ".join(entities)

    # 대화 문장 수: 따옴표(" " ' ') 포함 문장
    dialogue_count = sum(
        1 for s in key_sentences
        if re.search(r'[“”‘’"\']', s)
    )

    # 시대 키워드 존재 여부
    has_era_keyword = bool(re.search(
        r'(조선|고려|삼국|신라|고구려|백제|임진|병자|[0-9]{2,4}년\s*전|고대|중세|미래|우주)',
        combined_text
    ))

    # 뉴스 패턴 존재 여부
    has_news_pattern = bool(re.search(
        r'(기자|보도|발표|밝혔다|전했다|뉴스|속보)',
        combined_text
    ))

    # 2~3글자 순수 한글 단어 수 (숫자/조사 제외)
    korean_names_count = sum(
        1 for e in entities
        if re.fullmatch(r'[가-힣]{2,3}', e)
    )

    signals = {
        "char_count": char_count,
        "dialogue_count": dialogue_count,
        "korean_names_count": korean_names_count,
        "has_era_keyword": has_era_keyword,
        "has_news_pattern": has_news_pattern,
    }

    # 확정 분류 (순서 중요)
    if char_count < 50:
        return {"type": "keyword", "confidence": 1.0, "signals": signals}

    if char_count < 200 and korean_names_count < 3:
        return {"type": "keyword", "confidence": 0.95, "signals": signals}

    if has_news_pattern and not has_era_keyword:
        return {"type": "news", "confidence": 0.88, "signals": signals}

    if dialogue_count >= 3 and korean_names_count >= 3 and char_count > 800:
        return {"type": "novel", "confidence": 0.92, "signals": signals}

    if char_count > 1500 and korean_names_count >= 5:
        return {"type": "novel", "confidence": 0.85, "signals": signals}

    # 애매한 경우
    return {"type": "ambiguous", "confidence": 0.5, "signals": signals}
