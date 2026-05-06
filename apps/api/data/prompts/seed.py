"""index.json → Supabase prompts + prompt_categories 시드 스크립트"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))

from core.config import settings
from supabase import create_client

INDEX = pathlib.Path(__file__).parent / "index.json"


def main():
    data = json.loads(INDEX.read_text(encoding="utf-8"))
    db = create_client(settings.SUPABASE_URL, settings.supabase_service_key)

    # categories (sort_order = index.json 배열 순서)
    cats = [
        {"id": c["id"], "letter": c["letter"], "icon": c["icon"], "label": c["label"], "sort_order": i}
        for i, c in enumerate(data["categories"])
    ]
    res = db.table("prompt_categories").upsert(cats, on_conflict="id").execute()
    print(f"categories: {len(cats)}개 upsert")

    # prompts (배치 50개씩)
    prompts = [
        {
            "code": p["code"],
            "cat": p["cat"],
            "title": p["title"],
            "description": p["desc"],
            "body": p["body"],
            "is_premium": p.get("is_premium", False),
        }
        for p in data["prompts"]
    ]
    batch = 50
    for i in range(0, len(prompts), batch):
        chunk = prompts[i:i + batch]
        db.table("prompts").upsert(chunk, on_conflict="code").execute()
        print(f"  prompts {i+1}~{i+len(chunk)} upsert 완료")

    total = db.table("prompts").select("code", count="exact").execute()
    print(f"\n✅ 완료 — DB 총 {total.count}개 프롬프트")


if __name__ == "__main__":
    main()
