from pydantic_settings import BaseSettings
from pathlib import Path

class Settings(BaseSettings):
    GOOGLE_API_KEY: str = ""
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""  # V2 호환 별칭

    @property
    def supabase_service_key(self) -> str:
        return self.SUPABASE_SERVICE_KEY or self.SUPABASE_SERVICE_ROLE_KEY
    R2_ENDPOINT: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET: str = "flux-bg-library"
    R2_PUBLIC_URL: str = ""
    MAX_CONCURRENT_RENDERS: int = 3
    SOURCE_DIR: Path = Path(r"C:\LinkDropV3\source")
    YOUTUBE_CLIENT_ID: str = ""
    YOUTUBE_CLIENT_SECRET: str = ""
    SUPERTONE_API_KEY: str = ""
    SUPERTONE_NARRATOR_MALE_ID: str = "ab7cd18e645b54d7536e0f"
    SUPERTONE_NARRATOR_FEMALE_ID: str = "195e1922033a6168f0c90f"
    SUPERTONE_CHILD_FEMALE_ID: str = "400c24c9a2718734a5b404"
    SUPERTONE_CHILD_MALE_ID: str = "59901b1bf6d0a41d49397f"

    class Config:
        env_file = str(Path(__file__).parent.parent.parent.parent / ".env")
        extra = "ignore"

settings = Settings()
