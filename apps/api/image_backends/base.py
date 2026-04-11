from abc import ABC, abstractmethod


class ImageBackend(ABC):
    @abstractmethod
    async def generate(self, hint: str, width: int = 1920, height: int = 1080, **kwargs) -> bytes:
        """이미지 생성 → PNG bytes 반환"""
        ...
