"""HTML 템플릿 라우터 — 템플릿 목록 조회 + AI HTML 생성"""
import json
import pathlib
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.gemini_helper import call_gemini, call_gemini_json
from services.html_renderer import render_skeleton

router = APIRouter(prefix="/api/v1/html-templates", tags=["html-templates"])

_TEMPLATES_DIR = pathlib.Path(__file__).parent.parent / "data" / "html-templates"


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _load_spec(template_id: str) -> dict:
    path = _TEMPLATES_DIR / f"{template_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"템플릿 '{template_id}' 없음")
    return json.loads(path.read_text(encoding="utf-8"))


def _load_spec_v2(template_id: str) -> dict | None:
    """새 디렉토리 기반 spec.json 로드 (없으면 None)"""
    path = _TEMPLATES_DIR / template_id / "spec.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _build_content_prompt(topic: str, spec: dict) -> str:
    label = spec.get("label", "문서")
    schema = spec.get("content_schema", {})
    required = schema.get("required", [])
    props = schema.get("properties", {})
    field_hints = "\n".join(
        f"  - {k}: {v.get('description', '')}" for k, v in props.items() if k in required
    )
    return f"""주제: {topic}

위 주제로 [{label}]에 맞는 실제 콘텐츠를 생성하세요.
모든 내용은 주제에 맞는 실제적이고 구체적인 내용으로 채워주세요.
숫자·날짜·수치는 현실적인 값을 사용하세요.

필수 필드:
{field_hints}

한국어 주제는 한국어로, 영어 주제는 영어로 작성하세요.
"""


def _build_system_prompt(spec: dict) -> str:
    """템플릿 JSON 명세 → Gemini system instruction 변환"""

    # design_spec_raw가 있으면 전용 프롬프트 사용
    design_spec_raw = spec.get("design_spec_raw", "")
    if design_spec_raw:
        label = spec.get("label", "랜딩페이지")
        return f"""당신은 최고 수준의 HTML 랜딩페이지 생성 AI입니다.
아래 【디자인 스펙】을 정확히 구현하는 완성된 독립 실행 HTML 파일을 생성하세요.

【템플릿】{label}

【디자인 스펙】
{design_spec_raw}

【HTML 생성 규칙 — 반드시 준수】
1. 완전한 HTML 파일 반환 — <!DOCTYPE html>부터 </html>까지
2. Google Fonts (@import) 허용 — 그 외 외부 CDN 라이브러리 사용 금지
3. 스타일은 <style> 태그에만 작성 (inline style 최소화)
4. <meta charset="UTF-8"> 반드시 포함
5. <meta name="viewport" content="width=device-width, initial-scale=1.0"> 반드시 포함
6. 주제에 맞는 실제 한국어 콘텐츠 생성 — placeholder 텍스트 절대 금지
7. 각 편집 가능 텍스트 영역에 <!-- ✏️ 필드명 --> 주석 삽입
8. 코드 블록 없이 HTML만 반환 (```html 마크다운 감싸기 절대 금지)
9. 모든 이미지는 CSS gradient 또는 CSS pattern으로 대체 (외부 이미지 URL 사용 금지)
10. 섹션 구분은 <section> 태그 사용
"""

    label   = spec.get("label", "")
    desc    = spec.get("description", "")
    layout  = spec.get("layout", {})
    palette = spec.get("palette", {})
    typo    = spec.get("typography", {})
    blocks  = spec.get("blocks", {})
    tone    = spec.get("tone", {})
    flow    = spec.get("chapter_internal_flow", [])

    # 색상 팔레트 → 간결한 문자열
    palette_lines = "\n".join(f"  {k}: {v}" for k, v in palette.items())

    # 블록 명세 → 간결 요약
    block_summary = ""
    for block_name, block_spec in blocks.items():
        if isinstance(block_spec, dict):
            keys = list(block_spec.keys())[:4]
            block_summary += f"  - {block_name}: {', '.join(keys)}\n"

    # 섹션 흐름
    flow_text = " → ".join(flow) if flow else ""

    # 템플릿별 규칙 섹션 (JSON 키 → 라벨 자동 매핑, 확장 가능)
    _RULE_LABELS: dict[str, str] = {
        "email_rules":      "이메일 호환 필수 규칙",
        "conversion_rules": "전환 최적화 규칙",
        "visual_rules":     "시각 디자인 규칙",
        "project_card_rules": "프로젝트 카드 규칙",
    }
    generic_rules_section = ""
    for key, lbl in _RULE_LABELS.items():
        rules = spec.get(key, [])
        if rules:
            rules_text = "\n".join(f"  - {r}" for r in rules)
            generic_rules_section += f"\n【{lbl}】\n{rules_text}\n"

    # AI 자율 지침 (blank 전용)
    ai_instructions = spec.get("ai_instructions", {})
    ai_section = ""
    if ai_instructions:
        constraints = "\n".join(f"  - {c}" for c in ai_instructions.get("constraints", []))
        ai_section = f"""
【AI 자율 설계 지침】
  구조 자유도: {ai_instructions.get("freedom", "최대")}
  구조 결정 원칙: {ai_instructions.get("structure_rule", "")}
  기술 제약:
{constraints}
"""

    return f"""당신은 전문 HTML 문서 생성 AI입니다.
아래 명세에 따라 완성된 독립 실행 HTML 파일을 생성하세요.

【템플릿】{label}
{desc}

【레이아웃】
  타입: {layout.get("type", "")}
  최대폭: {layout.get("maxWidth") or (layout.get("main") or {}).get("maxWidth", "")}
  사이드바: {"있음 — " + str(layout.get("sidebar", {}).get("position", "")) if layout.get("sidebar") and layout.get("sidebar") is not False else "없음"}

【색상 팔레트】
{palette_lines}

【타이포그래피】
  폰트: {typo.get("font_primary", "")}
  기본 크기: {typo.get("base_size", "1rem")}
  행간: {typo.get("line_height", 1.7)}

【사용 가능한 블록】
{block_summary}
【문서 흐름】
{flow_text}

【문체·어조】
  {tone.get("voice", "")}
  {tone.get("length", "")}
{generic_rules_section}{ai_section}
【HTML 생성 규칙 — 반드시 준수】
1. 완전한 HTML 파일 반환 — <!DOCTYPE html>부터 </html>까지
2. 외부 CDN 라이브러리 사용 금지 (Google Fonts는 허용)
3. 스타일은 <style> 태그 또는 inline style로만 작성
4. 한국어 콘텐츠는 meta charset="UTF-8" 포함
5. 모바일 반응형: <meta name="viewport" content="width=device-width, initial-scale=1.0">
6. 실제 콘텐츠 채워 넣기 — placeholder 텍스트 사용 금지
7. 색상은 위 팔레트에서만 사용
8. 코드 블록 없이 HTML만 반환 (```html 마크다운 감싸기 금지)
"""


def _build_user_prompt(topic: str, spec: dict) -> str:
    label = spec.get("label", "문서")
    sections = spec.get("sections", {}).get("order", [])
    sections_text = ", ".join(sections) if sections else ""

    return f"""주제: {topic}

위 주제로 [{label}] 템플릿에 맞는 완성된 HTML 문서를 생성하세요.
{"포함할 섹션 순서: " + sections_text if sections_text else ""}

주제에 맞는 실제 내용을 풍부하게 채워주세요.
"""


def _build_placeholder_content(schema: dict, depth: int = 0, idx: int = 0):
    """content_schema → placeholder 콘텐츠 자동 생성 (Gemini 없이)"""
    if depth > 6:
        return ""
    schema_type = schema.get("type", "string")
    if schema_type == "object":
        result = {}
        for key, prop in schema.get("properties", {}).items():
            result[key] = _build_placeholder_content(prop, depth + 1, idx)
        return result
    elif schema_type == "array":
        items_schema = schema.get("items", {"type": "string"})
        count = 2 if depth < 2 else 1
        return [_build_placeholder_content(items_schema, depth + 1, i) for i in range(count)]
    elif schema_type in ("number", "integer"):
        return [3, 5, 7, 10][idx % 4]
    elif schema_type == "boolean":
        return True
    else:  # string
        desc = schema.get("description", "").lower()
        if any(k in desc for k in ["이름", "name", "성명"]):
            return ["홍길동", "이영희"][idx % 2]
        elif any(k in desc for k in ["이메일", "email"]):
            return "hello@example.com"
        elif any(k in desc for k in ["전화", "phone", "연락처"]):
            return "010-1234-5678"
        elif any(k in desc for k in ["url", "링크", "website", "홈페이지"]):
            return "https://example.com"
        elif any(k in desc for k in ["날짜", "date", "기간", "period", "연도"]):
            return ["2022.03 – 현재", "2020.06 – 2022.02"][idx % 2]
        elif any(k in desc for k in ["위치", "location", "주소", "지역"]):
            return "서울특별시"
        elif any(k in desc for k in ["직함", "직책", "position", "role", "title"]):
            return ["시니어 개발자", "프로젝트 매니저"][idx % 2]
        elif any(k in desc for k in ["회사", "company", "기업"]):
            return ["테크스타트업 A", "IT기업 B"][idx % 2]
        elif any(k in desc for k in ["학교", "university", "대학"]):
            return "○○대학교"
        elif any(k in desc for k in ["전공", "major", "학과"]):
            return "컴퓨터공학과"
        elif any(k in desc for k in ["요약", "summary", "소개", "bio", "about", "intro"]):
            return "간략한 소개를 여기에 입력하세요."
        elif any(k in desc for k in ["설명", "description", "내용", "detail"]):
            return ["주요 내용을 입력하세요.", "추가 내용을 입력하세요."][idx % 2]
        elif any(k in desc for k in ["카테고리", "category", "분야"]):
            return ["기술", "도구"][idx % 2]
        elif any(k in desc for k in ["항목", "item", "bullet", "성과"]):
            return ["주요 업무 또는 성과를 입력하세요.", "추가 내용을 입력하세요."][idx % 2]
        elif any(k in desc for k in ["태그", "tag", "keyword"]):
            return ["태그1", "태그2"][idx % 2]
        else:
            return ["내용을 입력하세요", "추가 내용을 입력하세요"][idx % 2]


def _build_empty_html(topic: str) -> str:
    """ai_freeform + use_ai=False 시 반환하는 기본 HTML shell"""
    safe = topic.replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{safe}</title>
<style>
  body {{
    font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
    max-width: 800px; margin: 0 auto; padding: 3rem 2rem;
    color: #111; line-height: 1.7; background: #fff;
  }}
  h1 {{ font-size: 2rem; font-weight: 700; margin-bottom: 1rem; color: #111; }}
  p {{ color: #6b7280; font-size: 1rem; }}
</style>
</head>
<body>
<h1>{safe}</h1>
<p>코드 탭에서 직접 HTML을 작성하거나, 툴바의 <strong>AI로 채우기</strong> 버튼으로 내용을 생성하세요.</p>
</body>
</html>"""


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.get("")
def list_templates():
    """등록된 템플릿 목록 반환 (id, label, description만)"""
    result = []
    seen: set[str] = set()

    # 레거시 플랫 JSON (e.g. landing.json, resume.json)
    for path in sorted(_TEMPLATES_DIR.glob("*.json")):
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
            tid = spec.get("id", path.stem)
            if tid in seen:
                continue
            seen.add(tid)
            result.append({
                "id":          tid,
                "label":       spec.get("label", path.stem),
                "description": spec.get("description", ""),
                "version":     spec.get("version", "1.0.0"),
            })
        except Exception:
            continue

    # 디렉토리 기반 spec.json (e.g. landing/glassmorphism/spec.json)
    for path in sorted(_TEMPLATES_DIR.glob("*/*/spec.json")):
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
            tid = spec.get("id") or f"{path.parent.parent.name}/{path.parent.name}"
            if tid in seen:
                continue
            seen.add(tid)
            result.append({
                "id":          tid,
                "label":       spec.get("label", path.parent.name),
                "description": spec.get("description", ""),
                "version":     spec.get("version", "1.0.0"),
            })
        except Exception:
            continue

    return result


@router.get("/{template_type}/{variant}")
def get_template_variant(template_type: str, variant: str):
    """variant 템플릿 명세 반환 (type/variant 구조)"""
    spec = _load_spec_v2(f"{template_type}/{variant}")
    if spec is None:
        raise HTTPException(status_code=404, detail=f"템플릿 '{template_type}/{variant}' 없음")
    return spec


@router.get("/{template_id}")
def get_template(template_id: str):
    """레거시 flat 템플릿 명세 반환"""
    return _load_spec(template_id)


class GenerateRequest(BaseModel):
    topic: str
    options: dict = {}
    use_ai: bool = False


@router.post("/{template_type}/{variant}/generate")
async def generate_html_variant(template_type: str, variant: str, req: GenerateRequest):
    """type/variant 구조 템플릿 HTML 생성"""
    return await generate_html(f"{template_type}/{variant}", req)


@router.post("/{template_id}/generate")
async def generate_html(template_id: str, req: GenerateRequest):
    """템플릿 명세 + 주제 → HTML 생성
    - mode=skeleton: Gemini JSON → 서버 렌더
    - mode=ai_freeform (또는 구 spec): Gemini HTML 직접 생성
    """
    if not req.topic.strip():
        raise HTTPException(status_code=400, detail="topic은 필수입니다")

    # 신규 spec.json 확인
    spec_v2 = _load_spec_v2(template_id)

    if spec_v2 and spec_v2.get("mode") == "skeleton":
        # --- Skeleton 모드 ---
        if req.use_ai:
            # AI 경로: Gemini로 콘텐츠 생성
            content_prompt = _build_content_prompt(req.topic.strip(), spec_v2)
            system_prompt = (
                f"당신은 전문 {spec_v2.get('label', '문서')} 콘텐츠 생성 AI입니다. "
                "주어진 주제에 맞는 실제적이고 구체적인 콘텐츠를 JSON으로 생성하세요. "
                "placeholder 텍스트 사용 금지. 모든 내용을 풍부하게 채워주세요."
            )
            content_json = await call_gemini_json(
                prompt=content_prompt,
                system_instruction=system_prompt,
                response_schema=spec_v2.get("content_schema"),
                max_tokens=4096,
                temperature=0.7,
            )
        else:
            # 기본 경로: sample.json 우선, 없으면 placeholder 자동 생성
            sample_path = _TEMPLATES_DIR / template_id / "sample.json"
            if sample_path.exists():
                content_json = json.loads(sample_path.read_text(encoding="utf-8"))
            else:
                content_json = _build_placeholder_content(
                    spec_v2.get("content_schema", {"type": "object", "properties": {}})
                )
        html = render_skeleton(template_id, spec_v2, content_json)

    else:
        # --- ai_freeform 모드 ---
        spec = spec_v2 if spec_v2 else _load_spec(template_id)
        if req.use_ai:
            system_prompt = _build_system_prompt(spec)
            user_prompt   = _build_user_prompt(req.topic.strip(), spec)
            html = await call_gemini(
                prompt=user_prompt,
                system_instruction=system_prompt,
                max_tokens=8192,
                temperature=0.7,
            )
            html = html.strip()
            if html.startswith("```"):
                html = html.split("\n", 1)[-1]
                html = html.rsplit("```", 1)[0]
            html = html.strip()
        else:
            html = _build_empty_html(req.topic.strip())

    return {
        "template_id": template_id,
        "topic":       req.topic,
        "html":        html,
        "mode":        spec_v2.get("mode", "ai_freeform") if spec_v2 else "ai_freeform",
    }
