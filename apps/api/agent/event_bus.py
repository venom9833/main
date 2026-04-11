"""
파이프라인 이벤트 버스 — SSE 브로드캐스트용 싱글톤
"""
import asyncio
import json
from typing import AsyncGenerator


class EventBus:
    def __init__(self):
        self._queues: dict[str, list[asyncio.Queue]] = {}

    def subscribe(self, series_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._queues.setdefault(series_id, []).append(q)
        return q

    def unsubscribe(self, series_id: str, q: asyncio.Queue):
        if series_id in self._queues:
            try:
                self._queues[series_id].remove(q)
            except ValueError:
                pass

    async def publish(self, series_id: str, event: dict):
        for q in list(self._queues.get(series_id, [])):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass

    async def stream(self, series_id: str) -> AsyncGenerator[str, None]:
        q = self.subscribe(series_id)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30.0)
                    if event.get("type") == "done":
                        yield f"data: {json.dumps(event)}\n\n"
                        break
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield "data: {\"type\":\"ping\"}\n\n"
        finally:
            self.unsubscribe(series_id, q)


event_bus = EventBus()
