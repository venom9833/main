"""단계별 재시도 정책"""
from agent.state_machine import PipelineStep

RETRY_POLICY: dict[PipelineStep, dict] = {
    PipelineStep.WORLD:         {"max_attempts": 3, "backoff": [3, 6, 12]},
    PipelineStep.CASTING:       {"max_attempts": 3, "backoff": [3, 6, 12]},
    PipelineStep.ARCHITECT:     {"max_attempts": 3, "backoff": [3, 6, 12]},
    PipelineStep.SCRIPT:        {"max_attempts": 3, "backoff": [3, 6, 12]},
    PipelineStep.KEYFRAME:      {"max_attempts": 1, "backoff": [0]},  # Pillow 폴백 보장
    PipelineStep.TTS:           {"max_attempts": 3, "backoff": [2, 4, 8]},
    PipelineStep.RENDER:        {"max_attempts": 2, "backoff": [0, 0]},
    PipelineStep.UPLOAD:        {"max_attempts": 2, "backoff": [30, 30]},
    PipelineStep.YOUTUBE_MANAGE: {"max_attempts": 3, "backoff": [5, 10, 20]},
    PipelineStep.NAVER_UPLOAD:  {"max_attempts": 3, "backoff": [5, 10, 20]},
}

def get_policy(step: PipelineStep) -> dict:
    return RETRY_POLICY.get(step, {"max_attempts": 1, "backoff": [0]})
