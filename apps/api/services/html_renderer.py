"""HTML 렌더러 — 스켈레톤 + CSS + 콘텐츠 JSON → 완성 HTML"""
import pathlib
from jinja2 import Environment, BaseLoader, StrictUndefined

_TEMPLATES_DIR = pathlib.Path(__file__).parent.parent / "data" / "html-templates"
_SHARED_DIR = _TEMPLATES_DIR / "_shared"


def _read(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _palette_to_css_vars(palette: dict) -> str:
    """팔레트 dict → :root { --c-xxx: value; } CSS"""
    if not palette:
        return ""
    lines = ["<style>:root {"]
    for key, val in palette.items():
        css_var = "--c-" + key.replace("_", "-")
        lines.append(f"  {css_var}: {val};")
    lines.append("}</style>")
    return "\n".join(lines)


def render_skeleton(template_id: str, spec: dict, content: dict) -> str:
    """
    Skeleton 모드 렌더러
    - template_id/skeleton.html (Jinja2 템플릿)
    - template_id/styles.css (고정 CSS)
    - _shared/*.css (공통 CSS)
    - spec.palette → CSS 변수
    - content (Gemini 생성 JSON) → 주입
    """
    tpl_dir = _TEMPLATES_DIR / template_id

    skeleton_path = tpl_dir / spec.get("skeleton_file", "skeleton.html")
    styles_path   = tpl_dir / spec.get("styles_file", "styles.css")

    skeleton_src = _read(skeleton_path)
    if not skeleton_src:
        raise ValueError(f"스켈레톤 파일 없음: {skeleton_path}")

    template_css     = _read(styles_path)
    shared_base_css  = _read(_SHARED_DIR / "base.css")
    shared_fonts_css = _read(_SHARED_DIR / "fonts.css")
    shared_print_css = _read(_SHARED_DIR / "print.css")
    shared_cm_css    = _read(_SHARED_DIR / spec["shared_cm_file"]) if spec.get("shared_cm_file") else ""
    shared_sc_css    = _read(_SHARED_DIR / spec["shared_sc_file"]) if spec.get("shared_sc_file") else ""
    palette_vars     = _palette_to_css_vars(spec.get("palette", {}))

    env = Environment(loader=BaseLoader(), undefined=StrictUndefined, autoescape=False)
    tpl = env.from_string(skeleton_src)

    html = tpl.render(
        content=_DotDict(content),
        shared_base_css=shared_base_css,
        shared_fonts_css=shared_fonts_css,
        shared_print_css=shared_print_css,
        shared_cm_css=shared_cm_css,
        shared_sc_css=shared_sc_css,
        template_css=template_css,
        palette_vars=palette_vars,
    )
    return html


class _DotDict(dict):
    """dict를 Jinja2에서 dot notation으로 접근 가능하게.
    dict 내장 메서드(items, keys, values 등)와 동명 키가 충돌하지 않도록
    __getattribute__에서 dict 키를 우선 조회한다.
    """
    def __getattribute__(self, name):
        if not name.startswith('_'):
            try:
                val = dict.__getitem__(self, name)
                if isinstance(val, dict):
                    return _DotDict(val)
                if isinstance(val, list):
                    return [_DotDict(i) if isinstance(i, dict) else i for i in val]
                return val
            except KeyError:
                pass
        return dict.__getattribute__(self, name)

    def __getattr__(self, name):
        return ""

    def __bool__(self):
        return dict.__len__(self) > 0
