"""V3 파이프라인 상태 머신 정의"""
from enum import Enum

class PipelineStep(str, Enum):
    IDLE = "idle"

    # ── 시리즈 초기화 (1회) ─────────────────────────────
    AWAITING_SOURCE_UPLOAD = "awaiting_source_upload"
    WORLD = "world"
    AWAITING_WORLD_APPROVAL = "awaiting_world_approval"
    CASTING = "casting"
    AWAITING_CASTING_APPROVAL = "awaiting_casting_approval"  # 캐릭터 확인 게이트
    ARCHITECT = "architect"   # 시리즈 전체 구조 설계 (1회, 캐스팅 확정 직후)

    # ── 챕터별 반복 (1일 1챕터, 무제한) ────────────────
    SCRIPT = "script"
    AWAITING_SCRIPT_APPROVAL = "awaiting_script_approval"
    AWAITING_KEYFRAME_SETUP = "awaiting_keyframe_setup"
    KEYFRAME = "keyframe"
    AWAITING_TTS = "awaiting_tts"   # 키프레임 검토 후 사용자가 TTS 시작 버튼 클릭
    TTS = "tts"
    RENDER = "render"
    AWAITING_UPLOAD_APPROVAL = "awaiting_upload_approval"
    UPLOAD = "upload"             # YouTube MP4 업로드
    YOUTUBE_MANAGE = "youtube_manage"  # YouTube 메타데이터/설명 관리
    NAVER_UPLOAD = "naver_upload" # 네이버 웹소설 텍스트 업로드
    CHAPTER_DONE = "chapter_done" # 1챕터 완료 — 독자 반응 확인 후 계속/종결 결정

    # ── 종료 ────────────────────────────────────────────
    DONE = "done"     # 사용자가 명시적으로 시리즈 종결
    FAILED = "failed"

# 자동 전이 맵 (승인 불필요)
AUTO_TRANSITIONS: dict[PipelineStep, PipelineStep] = {
    # 초기화 구간
    PipelineStep.WORLD:         PipelineStep.AWAITING_WORLD_APPROVAL,
    PipelineStep.CASTING:       PipelineStep.AWAITING_CASTING_APPROVAL,
    PipelineStep.ARCHITECT:     PipelineStep.SCRIPT,
    # 챕터 구간
    PipelineStep.SCRIPT:        PipelineStep.AWAITING_SCRIPT_APPROVAL,
    PipelineStep.KEYFRAME:      PipelineStep.AWAITING_TTS,
    PipelineStep.TTS:           PipelineStep.RENDER,
    PipelineStep.RENDER:        PipelineStep.AWAITING_UPLOAD_APPROVAL,
    PipelineStep.UPLOAD:        PipelineStep.YOUTUBE_MANAGE,
    PipelineStep.YOUTUBE_MANAGE: PipelineStep.NAVER_UPLOAD,
    PipelineStep.NAVER_UPLOAD:  PipelineStep.CHAPTER_DONE,  # 챕터 완료 → 독자 반응 대기
}

# 승인 후 전이 맵
APPROVAL_TRANSITIONS: dict[str, PipelineStep] = {
    "source_upload":  PipelineStep.WORLD,
    "world":          PipelineStep.CASTING,
    "casting":        PipelineStep.ARCHITECT,
    "script":         PipelineStep.AWAITING_KEYFRAME_SETUP,
    "keyframe_setup": PipelineStep.KEYFRAME,
    "tts":            PipelineStep.TTS,
    "upload":         PipelineStep.UPLOAD,
}

# 재시도 가능한 단계
RETRYABLE_STEPS = {
    PipelineStep.WORLD,
    PipelineStep.CASTING,
    PipelineStep.ARCHITECT,
    PipelineStep.SCRIPT,
    PipelineStep.KEYFRAME,
    PipelineStep.TTS,
    PipelineStep.RENDER,
    PipelineStep.UPLOAD,
    PipelineStep.YOUTUBE_MANAGE,
    PipelineStep.NAVER_UPLOAD,
}
