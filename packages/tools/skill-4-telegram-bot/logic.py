import os
import asyncio
from typing import Optional
from openai import OpenAI
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters
from core.config import settings
from services.orchestrator import orchestrator

class TelegramBotAgent:
    def __init__(self):
        self.token = os.getenv("TELEGRAM_BOT_TOKEN")
        self.openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
        self.app = None

    async def start(self):
        """텔레그램 봇 가동 (백그라운드 실행용)"""
        if not self.token:
            print("⚠️ TELEGRAM_BOT_TOKEN is missing. Telegram agent disabled.")
            return

        self.app = ApplicationBuilder().token(self.token).build()
        
        # 핸들러 등록
        self.app.add_handler(CommandHandler("start", self._handle_start))
        self.app.add_handler(CommandHandler("collect", self._handle_collect))
        self.app.add_handler(CommandHandler("status", self._handle_status))
        self.app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), self._handle_message))

        print("🤖 Telegram Bot Agent is starting...")
        await self.app.initialize()
        await self.app.start()
        await self.app.updater.start_polling()

    async def _handle_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text(
            "반갑습니다! LinkDrop AI 총괄 매니저입니다. 🤖\n"
            "무엇을 도와드릴까요?\n\n"
            "• /collect : 데이터 수집 및 자동화 시작\n"
            "• /status : 시스템 가동 현황 확인"
        )

    async def _handle_collect(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text("🚀 전체 데이터 수집 및 정제 파이프라인을 가동합니다.")
        # 오케스트레이터 실행
        asyncio.create_task(orchestrator.run_full_pipeline("자동화 수집"))

    async def _handle_status(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        status = orchestrator.state
        await update.message.reply_text(f"📊 현재 시스템 상태: {status}")

    async def _handle_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        user_text = update.message.text
        
        # OpenAI를 통한 의도 분석 및 응답 생성
        prompt = f"""
        당신은 'LinkDrop AI' 시스템의 총괄 매니저입니다. 
        사용자의 메시지를 분석하여 대화에 응답하고, 필요 시 시스템 명령을 수행하도록 안내하세요.
        
        [시스템 능력]
        1. 소스 수집 (/collect): 10대 주제의 최신 뉴스를 수집, AI 정제하여 구글 드라이브에 저장함.
        2. 상태 확인 (/status): 시스템 가동 현황 확인.
        
        [사용자 메시지]
        "{user_text}"
        """

        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}]
            )
            ai_reply = response.choices[0].message.content
            
            # 특정 의도 감지 시 자동 실행
            if any(k in user_text for k in ["수집", "시작", "가져와"]):
                asyncio.create_task(orchestrator.run_full_pipeline("대화형 요청"))
                ai_reply += "\n\n(알림: 요청하신 수집 작업을 백그라운드에서 즉시 시작했습니다! 🚀)"

            await update.message.reply_text(ai_reply)
        except Exception as e:
            await update.message.reply_text(f"죄송합니다. 메시지 처리 중 오류가 발생했습니다: {str(e)}")

telegram_bot_agent = TelegramBotAgent()
