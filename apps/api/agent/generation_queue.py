"""
생성 작업 큐 — RPM 속도제한 + 우선순위 + 싱글톤
"""
import asyncio
import time
from dataclasses import dataclass, field
from typing import Callable, Any


@dataclass(order=True)
class QueueTask:
    priority: int
    created_at: float = field(default_factory=time.time, compare=False)
    task_id: str = field(default="", compare=False)
    fn: Callable = field(default=None, compare=False)
    args: tuple = field(default_factory=tuple, compare=False)
    kwargs: dict = field(default_factory=dict, compare=False)


class GenerationQueue:
    def __init__(self, rpm_limit: int = 60):
        self._queue: asyncio.PriorityQueue = asyncio.PriorityQueue()
        self._rpm_limit = rpm_limit
        self._call_times: list[float] = []
        self._running = False
        self._results: dict[str, asyncio.Future] = {}

    async def enqueue(self, task_id: str, fn: Callable, *args, priority: int = 5, **kwargs) -> Any:
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        self._results[task_id] = fut
        task = QueueTask(priority=priority, task_id=task_id, fn=fn, args=args, kwargs=kwargs)
        await self._queue.put(task)
        if not self._running:
            asyncio.create_task(self._worker())
        return await fut

    async def _worker(self):
        self._running = True
        try:
            while not self._queue.empty():
                task = await self._queue.get()
                await self._rate_limit()
                try:
                    if asyncio.iscoroutinefunction(task.fn):
                        result = await task.fn(*task.args, **task.kwargs)
                    else:
                        result = await asyncio.to_thread(task.fn, *task.args, **task.kwargs)
                    fut = self._results.pop(task.task_id, None)
                    if fut and not fut.done():
                        fut.set_result(result)
                except Exception as e:
                    fut = self._results.pop(task.task_id, None)
                    if fut and not fut.done():
                        fut.set_exception(e)
                finally:
                    self._queue.task_done()
        finally:
            self._running = False

    async def _rate_limit(self):
        now = time.time()
        self._call_times = [t for t in self._call_times if now - t < 60]
        if len(self._call_times) >= self._rpm_limit:
            wait = 60 - (now - self._call_times[0]) + 0.1
            await asyncio.sleep(wait)
        self._call_times.append(time.time())


# 싱글톤
_image_queue = GenerationQueue(rpm_limit=30)   # 이미지: 분당 30회
_tts_queue = GenerationQueue(rpm_limit=60)     # TTS: 분당 60회


def get_image_queue() -> GenerationQueue:
    return _image_queue


def get_tts_queue() -> GenerationQueue:
    return _tts_queue
