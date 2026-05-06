"""
source_classifier.py — LLM 보조 소스 분류기
classify() (Python 결정 트리)에서 "ambiguous"가 나왔을 때만 호출한다.
"""


async def classify_with_llm(text: str, analysis: dict) -> dict:
    """
    Gemini structured output으로 소스 유형을 분류한다.
    ambiguous 판정 시에만 호출. 실패 시 ambiguous 폴백 반환.

    Args:
        text:     소스 원문 (최대 500자 슬라이스 권장)
        analysis: source_analyzer.analyze() 반환값

    Returns:
        {
            "source_type": "novel" | "keyword" | "news" | "script",
            "confidence": float,
            "reason": str,
        }
    """
    from services.gemini_helper import call_gemini_json

    response_schema = {
        "type": "object",
        "properties": {
            "source_type": {
                "type": "string",
                "enum": ["novel", "keyword", "news", "script"],
            },
            "confidence": {"type": "number"},
            "reason": {"type": "string"},
        },
        "required": ["source_type", "confidence", "reason"],
    }

    entities_preview = ", ".join(analysis.get("entities", [])[:5])
    key_sents_preview = " / ".join(analysis.get("key_sentences", [])[:2])
    char_count = analysis.get("char_count", 0)

    prompt = (
        "다음 텍스트의 소스 유형을 분류하라.\n\n"
        "유형 정의:\n"
        "- novel: 서사가 있는 소설·웹소설 (등장인물, 대화, 장면 묘사 포함)\n"
        "- script: 영상·연극 시나리오 (씬 번호, 지문, 대사 형식)\n"
        "- keyword: 단순 키워드·소재 나열, 짧은 메모, 주제어 목록\n"
        "- news: 뉴스 기사·보도문 (기자 서술 형식, 인용문, 날짜·출처 포함)\n\n"
        f"텍스트 길이: {char_count}자\n"
        f"핵심어: {entities_preview}\n"
        f"핵심 문장 예시: {key_sents_preview}\n\n"
        "소스 텍스트 (최대 500자):\n"
        f"{text[:500]}\n\n"
        "source_type, confidence(0.0~1.0), reason(한국어 1~2문장)을 JSON으로 반환하라."
    )

    try:
        result = await call_gemini_json(
            prompt=prompt,
            system_instruction="당신은 텍스트 유형 분류 전문가다. 주어진 소스를 정확히 분류한다.",
            response_schema=response_schema,
            max_tokens=256,
            temperature=0.2,
        )
        return result
    except Exception:
        return {
            "source_type": "ambiguous",
            "confidence": 0.5,
            "reason": "분류 실패",
        }
