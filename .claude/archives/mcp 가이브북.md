Claude를 생산성 머신으로 바꿔줄 40가지 MCP 서버
원문 보기 : 40 MCP Servers That Turn Claude Into a Productivity Machine
MCP는 현재 아무도 이야기하고 있지 않지만, 가장 중요한 AI 인프라입니다.
'기술(Skills)'은 Claude에게 무언가를 하는 방법을 가르치지만, MCP는 Claude에게 외부 세계로 나가는
접속 권한(ACCESS)을 부여합니다.
MCP가 없다면 Claude는 '항아리 속의 뇌'와 같습니다. 생각하고 추론하며 텍스트를 생성할 수는 있지만,
여러분의 파일에 접근하거나, 웹을 검색하거나, 데이터베이스를 조회하거나, 이메일을 확인하거나,
캘린더를 읽거나, 외부 시스템과 상호작용할 수 없습니다.
MCP와 함께라면 Claude는 '오퍼레이터(Operator)'가 됩니다. 어디서든 데이터를 가져오고, 결과를
전송하며, 실제 시스템에서 직접 작업을 수행할 수 있습니다.
MCP는 Model Context Protocol의 약자로, AI가 외부 도구 및 데이터 소스에 연결되는 단일 범용
방식을 만드는 개방형 표준입니다. 한 번만 연결을 구축하면 MCP를 지원하는 모든 AI 모델에서 사용할
수 있습니다.
검색 및 웹 접근 (Search & Web Access)
01. Tavily MCP AI 에이전트를 위해 특별히 제작된 검색 엔진입니다. 단순한 링크 목록 대신 정제되고
구조화된, LLM이 바로 사용할 수 있는 데이터를 반환합니다. 검색, 추출, 크롤링, 사이트맵의 네 가지
도구를 제공하며, 1분 안에 원격 MCP로 연결 가능합니다. 모든 에이전트를 위한 최고의 범용 검색
도구입니다. 🔗 https://github.com/tavily-ai/tavily-mcp
02. Brave Search MCP Brave의 독립적인 인덱스를 사용하는 대안 검색 도구입니다. 구글 검색 결과에
치우치지 않은 결과를 원할 때 좋습니다. 무료 티어가 제공되며, 스니펫(Snippet)이 포함된 구조화된
결과를 반환합니다. 🔗 https://github.com/nicobailon/brave-search-mcp
03. Firecrawl MCP 모든 웹사이트를 LLM용 데이터로 변환합니다. 페이지를 크롤링하고 콘텐츠를
추출하며, 자바스크립트로 렌더링된 사이트도 처리합니다. 웹 콘텐츠 처리가 필요한 모든 워크플로우에
필수적입니다. 🔗 https://github.com/mendableai/firecrawl-mcp-server
04. Fetch MCP (Anthropic 공식) 웹 콘텐츠를 가져오기 위한 공식 서버입니다. 심플하고 신뢰할 수
있으며 가볍습니다. 전체 크롤링 프레임워크의 부담 없이 특정 URL의 내용만 가져와야 할 때
사용하세요. 🔗 https://github.com/modelcontextprotocol/servers/tree/main/src/fetch
파일 시스템 및 로컬 데이터 (File System & Local Data)
05. Filesystem MCP (Anthropic 공식) 로컬 컴퓨터의 파일을 읽고, 쓰고, 생성하고, 이동하고,
검색합니다. 가장 기본적인 MCP 서버입니다. 딱 하나만 설치해야 한다면 이것을 설치하세요. 보안을
위해 특정 디렉토리로 범위를 제한할 수 있습니다. 🔗
https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem
06. SQLite MCP (Anthropic 공식) 자연어로 SQLite 데이터베이스를 쿼리하고 관리합니다. Claude가
SQL을 작성하면 서버가 이를 실행하고 구조화된 결과를 반환합니다. 로컬 데이터 분석에 완벽합니다.
🔗 https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite
07. PostgreSQL MCP Claude를 실제 운영 환경의 PostgreSQL 데이터베이스에 연결합니다.
기본적으로 읽기 전용이며 선택적으로 쓰기 권한을 줄 수 있습니다. 비즈니스 데이터를 조회해야 하는
워크플로우에 필수적입니다. 🔗
https://github.com/modelcontextprotocol/servers/tree/main/src/postgres
08. Excel MCP Server Microsoft Excel이 설치되어 있지 않아도 엑셀 파일을 조작할 수 있습니다. 읽기,
쓰기, 서식 지정, 계산이 가능하여 자동 보고서 생성 및 데이터 처리 파이프라인에 최적입니다. 🔗
https://github.com/haris-musa/excel-mcp-server
09. markdownify-mcp PDF, 이미지, 오디오 파일 등을 깨끗한 마크다운(Markdown)으로 변환합니다.
원본 형식에 상관없이 모든 문서 유형을 AI 워크플로우에 입력할 수 있습니다. 🔗
https://github.com/zcaceres/markdownify-mcp
개발자 도구 (Developer Tools)
10. GitHub MCP (Anthropic 공식) 완벽한 GitHub 연동을 지원합니다. 레포지토리 읽기, 이슈 생성, PR
관리, 코드 검색, 커밋 리뷰가 가능합니다. AI 지원 개발 워크플로우의 핵심입니다. 🔗
https://github.com/modelcontextprotocol/servers/tree/main/src/github
11. Git MCP GitHub API를 거치지 않고 직접 Git 작업을 수행합니다. 복제(Clone), 커밋, 브랜치 생성,
머지, diff 확인이 가능하며 GitHub뿐만 아니라 모든 Git 레포지토리에서 작동합니다. 🔗
https://github.com/modelcontextprotocol/servers/tree/main/src/git
12. Context7 최신 라이브러리 문서를 Claude의 컨텍스트에 주입합니다. 더 이상 환각(Hallucination)에
의한 잘못된 API나 지원 중단된 메서드 때문에 고생할 필요가 없습니다. 프롬프트에 "use context7"을
추가하면 Next.js, React, Supabase, MongoDB 등 수천 개의 최신 문서를 가져옵니다. 🔗
https://github.com/upstash/context7
13. MCP Playwright AI 에이전트를 위한 브라우저 자동화 도구입니다. 자연어로 실제 브라우저를
제어하세요. 페이지 이동, 버튼 클릭, 폼 작성, 스크린샷 캡처, 데이터 추출이 가능합니다. 테스트와 웹
스크래핑에 필수입니다. 🔗 https://github.com/executeautomation/mcp-playwright
14. Docker MCP Claude를 통해 Docker 컨테이너를 관리합니다. 컨테이너 시작, 중지, 검사 및 관리가
가능하여 배포 워크플로우와 환경 관리에 유용합니다. 🔗
https://github.com/modelcontextprotocol/servers/tree/main/src/docker
15. Sentry MCP Claude를 Sentry 에러 모니터링에 연결합니다. 에러 보고서를 가져오고 스택 추적을
분석하며 운영 환경의 에러 패턴을 식별합니다. 대화하는 속도로 디버깅을 할 수 있습니다. 🔗
https://github.com/getsentry/sentry-mcp
16. Codebase Memory MCP 코드베이스를 영구적인 지식 그래프로 변환합니다. Claude가 세션 간에도
프로젝트 구조, 패턴, 아키텍처를 기억합니다. 대규모 코드베이스 작업에 필수적입니다. 🔗
https://github.com/DeusData/codebase-memory-mcp
생산성 및 커뮤니케이션 (Productivity & Communication)
17. Google Drive MCP 구글 드라이브의 파일을 읽고 씁니다. 문서를 검색하고, 새 파일을 만들고,
폴더를 정리합니다. Claude와 클라우드 문서 사이의 간극을 메워줍니다. 🔗
https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive
18. Slack MCP 메시지 읽기, 대화 검색, 채널 포스팅, DM 발송이 가능합니다. Claude를 팀
커뮤니케이션 워크플로우에 통합하고 슬랙 기반 자동화를 구축하는 데 필수적입니다. 🔗
https://github.com/modelcontextprotocol/servers/tree/main/src/slack
19. Google Calendar MCP 캘린더 일정을 읽고, 생성하고, 업데이트하고, 삭제합니다. 일정 예약
자동화, 일일 브리핑 생성, 자연어를 통한 시간 관리가 가능해집니다. 🔗
https://github.com/nspady/google-calendar-mcp
20. Gmail MCP 이메일을 읽고, 보내고, 검색하고, 정리합니다. 이메일 분류 시스템, 초안 자동 작성,
인박스 관리 자동화를 구축하여 AI로 이메일을 처리하세요. 🔗 https://github.com/nicobailon/gmail-mcp
21. Notion MCP 노션 페이지와 데이터베이스를 읽고 씁니다. 워크스페이스 전체를 검색하고, 노션을
다른 도구들과 동기화하는 자동화를 구축할 수 있습니다. 🔗
https://github.com/modelcontextprotocol/servers/tree/main/src/notion
22. Linear MCP Linear의 이슈, 프로젝트, 워크플로우를 관리합니다. Claude를 통해 티켓 생성, 상태
업데이트, 이슈 검색, 프로젝트 진행 상황 추적을 수행하세요. 🔗
https://github.com/jerhadf/linear-mcp-server
23. Obsidian MCP Claude를 옵시디언 볼트(Vault)에 직접 연결합니다. 노트를 읽고, 지식 베이스를
검색하고, 새 노트를 생성하며 기존의 생각을 확장할 수 있습니다. 🔗
https://github.com/smithery-ai/obsidian-mcp
데이터 및 분석 (Data & Analytics)
24. Snowflake MCP 자연어로 Snowflake 데이터 웨어하우스를 쿼리합니다. Claude가 SQL을 작성하면
서버가 이를 실제 Snowflake 인스턴스에서 실행합니다. 엔터프라이즈급 데이터 접근을 지원합니다. 🔗
https://github.com/datawiz168/mcp-snowflake-service
25. BigQuery MCP 대규모 데이터 분석을 위해 Google BigQuery에 연결합니다. 대화형 인터페이스를
통해 거대한 데이터셋에 대한 쿼리를 실행할 수 있습니다. 🔗
https://github.com/LucasHild/mcp-server-bigquery
26. Supabase MCP 완벽한 Supabase 통합을 지원합니다. 데이터베이스 쿼리, 인증 관리, 스토리지
처리가 가능합니다. 애플리케이션 백엔드가 Supabase라면 필수 도구입니다. 🔗
https://github.com/supabase-community/supabase-mcp
27. MongoDB MCP MongoDB 데이터베이스에 연결합니다. 컬렉션 쿼리, 데이터 집계(Aggregation),
문서 관리가 가능하여 MongoDB를 데이터 레이어로 사용하는 모든 분께 유용합니다. 🔗
https://github.com/kiliczsh/mcp-mongo-server
AI 및 모델 (AI & Models)
28. ElevenLabs MCP ElevenLabs의 목소리를 사용하여 텍스트로부터 음성을 생성합니다. 음성
워크플로우를 구축하거나 오디오 콘텐츠 제작, AI 파이프라인에 음성 출력을 추가할 수 있습니다. 🔗
https://github.com/elevenlabs/elevenlabs-mcp
29. Hugging Face MCP Hugging Face의 모델과 데이터셋에 접근합니다. 모델 허브 검색, 모델
다운로드, 추론 실행이 가능하며, Claude와 오픈소스 AI 생태계를 이어줍니다. 🔗
https://github.com/huggingface/mcp-course
30. Replicate MCP Replicate API를 통해 오픈소스 AI 모델을 실행합니다. 이미지 생성, 비디오 처리,
오디오 전사 등 수백 개의 모델을 하나의 MCP 서버로 이용할 수 있습니다. 🔗
https://github.com/deepfates/mcp-replicate
인프라 및 데브옵스 (Infrastructure & DevOps)
31. AWS MCP Claude를 통해 EC2, S3, Lambda, CloudWatch 등 AWS 리소스를 관리합니다. 자연어로
배포 및 모니터링 워크플로우를 구축하세요. 🔗 https://github.com/aws-samples/sample-mcp-server
32. Cloudflare MCP Cloudflare Workers, KV 스토리지, R2 버킷, DNS를 관리합니다. Claude를 통해
엣지 함수를 배포하고 인프라를 관리할 수 있습니다. 🔗
https://github.com/cloudflare/mcp-server-cloudflare
33. Kubernetes MCP 쿠버네티스 클러스터를 관리합니다. 파드(Pod) 목록 확인, 로그 체크, 배포
스케일링, 서비스 검사 등을 대화하는 속도로 처리할 수 있습니다. 🔗 https://github.com/strowk/mcp-k8s
34. Vercel MCP Vercel 배포, 도메인, 환경 변수를 관리합니다. Claude를 통해 애플리케이션을 배포하고
모니터링하세요. 🔗 https://github.com/vercel/mcp
특수 목적 및 유틸리티 (Specialized & Utility)
35. Puppeteer MCP (Anthropic 공식) 헤드리스 브라우저 자동화 도구입니다. 웹 페이지 이동, 스크린샷
캡처, 상호작용이 가능합니다. 간단한 자동화 작업에는 Playwright보다 가볍습니다. 🔗
https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer
36. Time MCP 현재 시간 및 시간대 관련 작업을 수행합니다. 단순해 보이지만 일정 예약 자동화나
시간에 민감한 워크플로우에는 필수적입니다. 🔗
https://github.com/modelcontextprotocol/servers/tree/main/src/time
37. Memory MCP (Anthropic 공식) 대화 간의 영구적인 키-값(Key-Value) 메모리입니다. 세션이
바뀌어도 유지되어야 하는 정보를 저장하고 검색할 수 있습니다. Claude에게 장기 기억을 부여하는 가장
간단한 방법입니다. 🔗 https://github.com/modelcontextprotocol/servers/tree/main/src/memory
38. Task Master AI 여러분의 AI 프로젝트 매니저입니다. PRD(제품 요구사항 문서)를 입력하면
의존성이 포함된 구조화된 작업을 생성하고, Claude가 이를 하나씩 실행합니다. 혼란스러운 상황을
제대로 된 파이프라인으로 바꿔줍니다. 🔗 https://github.com/eyaltoledano/claude-task-master
39. fastmcp 최소한의 파이썬 코드로 나만의 MCP 서버를 구축합니다. 맞춤형 도구 통합을 만드는 가장
빠른 방법입니다. 기존 서버 중에 원하는 기능이 없다면, 오후 한나절 만에 직접 만들어 보세요. 🔗
https://github.com/jlowin/fastmcp
40. MCPHub 하나의 대시보드에서 모든 MCP 서버를 관리합니다. 여러 서버를 HTTP를 통해 시작, 중지,
설정 및 모니터링할 수 있습니다. 5개 이상의 서버를 운영하기 시작하면 필수적인 도구입니다. 🔗
https://github.com/samanhappy/mcphub
스타터 팩: 어떤 서버를 먼저 설치해야 할까?
40개를 한꺼번에 설치하지 마세요. 여러분의 역할에 맞춰 아래 스타터 팩을 선택해 보세요.
● 개발자라면: Filesystem(05) + GitHub(10) + Context7(12) + Codebase Memory(16) +
Sentry(15)
○ 파일 접근, 코드 관리, 최신 문서, 프로젝트 기억, 에러 모니터링이 가능해집니다.
● 지식 노동자라면: Filesystem(05) + Google Drive(17) + Gmail(20) + Google Calendar(19) +
Notion(21)
○ 파일 접근과 더불어 모든 핵심 생산성 도구가 Claude와 연결됩니다.
● 데이터 분석가라면: Filesystem(05) + SQLite(06) + PostgreSQL(07) + Excel(08) + Tavily(01)
○ 파일 접근, DB 쿼리, 스프레드시트 조작, 웹 리서치가 가능해집니다.
● 콘텐츠 크리에이터라면: Filesystem(05) + Tavily(01) + Obsidian(23) + markdownify(09) +
Slack(18)
○ 파일 접근, 웹 리서치, 지식 베이스 활용, 문서 변환, 팀 커뮤니케이션을 지원합니다.
● 데브옵스 및 인프라 담당자라면: Filesystem(05) + Docker(14) + GitHub(10) + AWS(31) +
Kubernetes(33)
○ 파일 접근, 컨테이너 관리, 코드 관리, 클라우드 인프라 및 오케스트레이션이
가능해집니다.
MCP 서버 설치 방법
거의 모든 서버의 설치 과정은 동일합니다:
1. 서버를 클론하거나 설치합니다 (보통 npm install 또는 pip install).
2. Claude 설정 파일에 서버 구성을 추가합니다.
3. 필요한 API 키를 환경 변수로 제공합니다.
4. Claude를 재시작합니다.
대부분 5분 이내에 설정이 끝납니다. Anthropic의 공식 서버들은 대개 명령어 하나로 끝날 정도로 가장
간단합니다.
요약 (TL;DR)
● 기술(Skills) = Claude에게 무언가를 하는 방법을 가르치는 것.
● MCP = Claude에게 일을 할 수 있는 권한을 주는 것.
MCP가 없다면 Claude는 단순한 대화형 AI일 뿐입니다. MCP와 함께라면 Claude는 여러분의 모든
워크플로우 시스템과 상호작용할 수 있는 자율형 오퍼레이터가 됩니다.
여러분의 역할에 맞는 스타터 팩으로 시작해 보세요. 필요에 따라 서버를 늘려가고, 기존 도구가 없다면
fastmcp로 직접 만드세요.
그게 전부입니다. 이제 40개의 서버로 Claude를 여러분의 세상에 연결해 보세요.