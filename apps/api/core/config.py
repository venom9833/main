from pydantic_settings import BaseSettings
from pathlib import Path

class Settings(BaseSettings):
    GOOGLE_API_KEY: str = ""
    GOOGLE_API_KEY_2: str = ""
    GOOGLE_API_KEY_3: str = ""
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""  # V2 호환 별칭

    R2_ENDPOINT: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET: str = "flux-bg-library"
    R2_PUBLIC_URL: str = ""
    R2_ASSETS_BUCKET: str = "linkdrop-assets"
    R2_ASSETS_PUBLIC_URL: str = ""
    MAX_CONCURRENT_RENDERS: int = 3
    SOURCE_DIR: Path = Path(r"C:\LinkDropV3\source")
    YOUTUBE_CLIENT_ID: str = ""
    YOUTUBE_CLIENT_SECRET: str = ""
    SUPERTONE_API_KEY: str = ""
    SUPERTONE_NARRATOR_MALE_ID: str = "ab7cd18e645b54d7536e0f"
    SUPERTONE_NARRATOR_FEMALE_ID: str = "195e1922033a6168f0c90f"
    SUPERTONE_CHILD_FEMALE_ID: str = "400c24c9a2718734a5b404"
    SUPERTONE_CHILD_MALE_ID: str = "59901b1bf6d0a41d49397f"
    FAL_KEY: str = ""  # fal.ai API 키 — Kling image-to-video
    OPENROUTER_API_KEY: str = ""  # OpenRouter API 키 — Judge 교차 검증 레이어 (미설정 시 Gemini 단독 폴백)
    CEREBRAS_API_KEY: str = ""   # Cerebras API 키 — 14,400 RPD 주력 Judge 프로바이더
    NVIDIA_API_KEY: str = ""     # NVIDIA NIM API 키 — 40 RPM, Nemotron 직접 호스팅
    GEMINI_FREE_API_KEY: str = ""  # Gemini 무료 티어 — Judge 전용 (생산용 GOOGLE_API_KEY와 분리)
    HF_API_TOKEN: str = ""        # HuggingFace Pro API 토큰 — Gemma 3 27B (무료 서버리스 추론)
    V2_API_SECRET: str = ""       # V2 파트너 API 인증 토큰 — prompts/public-content 라우터

    @property
    def supabase_service_key(self) -> str:
        return self.SUPABASE_SERVICE_KEY or self.SUPABASE_SERVICE_ROLE_KEY

    class Config:
        env_file = str(Path(__file__).parent.parent.parent.parent / ".env")
        extra = "ignore"

settings = Settings()
