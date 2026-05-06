// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';
import { useState, useEffect } from 'react';

const API = 'http://localhost:8001/api/v1';

const CHAPTER_LABELS: Record<string, string> = {
  ch01: '1화 — 도입',
  ch02: '2화 — 전개',
  ch03: '3화 — 균열',
  ch04: '4화 — 클라이맥스',
  ch05: '5화 — 절정',
  ch06: '6화 — 결말',
};

interface DramaFormula {
  id: string;
  type: string;
  hook: string;
  coreConflict: string;
  tone: string;
  chapterArc: string[];
  tropeKey: string;
}

const DRAMA_FORMULAS: DramaFormula[] = [
  { id: 'dt_01', type: '불륜·배신', hook: '사랑이라 믿었던 것이 착각이었음을 알게 되는 순간', coreConflict: '배신자와 피해자가 같은 공간에 계속 묶여 있어야 하는 상황', tone: '분노·슬픔·배신감이 교차하는 감정 롤러코스터', chapterArc: ['균열의 첫 신호', '의심의 시작', '증거 발견', '대면 전 마지막 선택', '폭발·충돌', '파국 또는 용서'], tropeKey: 'affair' },
  { id: 'dt_02', type: '복수', hook: '가해자는 피해자를 기억하지 못하지만, 피해자는 가해자를 잊은 적이 없다', coreConflict: '복수를 실행할수록 자신도 무너진다는 것을 알면서 멈출 수 없음', tone: '냉정과 감정 사이를 오가는 긴장감', chapterArc: ['현재의 두 사람 — 과거가 암시됨', '과거 사건 단편 공개', '복수 계획 본격화', '가해자에게 감정이 생기기 시작', '복수 vs 감정 충돌', '선택 — 복수의 완성 또는 포기'], tropeKey: 'power_abuse' },
  { id: 'dt_03', type: '비밀 자녀·혈연', hook: '두 사람 사이의 아이가 존재한다 — 한 명은 알고, 한 명은 모른다', coreConflict: '비밀을 유지하는 것과 진실을 밝히는 것 모두 누군가를 파괴한다', tone: '죄책감·애정·두려움이 뒤섞인 무게감', chapterArc: ['현재의 두 사람 — 아이 존재 암시', '비밀 유지 이유 공개', '위기 상황으로 비밀 노출 위기', '아이가 진실에 가까워짐', '진실 폭로 또는 은폐 시도', '세 사람의 선택'], tropeKey: 'affair' },
  { id: 'dt_04', type: '계약·위장 관계', hook: '거짓으로 시작한 관계에서 진심이 자라난다', coreConflict: '진심을 드러내는 순간 계약이 무너진다 — 그래서 더 연기해야 한다', tone: '설렘과 불안이 공존하는 로맨틱 긴장감', chapterArc: ['계약 제안 — 각자의 이유', '계약 이행 중 균열', '의도치 않은 감정 발생', '계약 종료 압박', '진심 고백 전 오해·갈등', '계약 해제 또는 진심 선택'], tropeKey: 'office_romance' },
  { id: 'dt_05', type: '신분 역전', hook: '권력 관계가 뒤집힌다 — 가장 낮았던 사람이 가장 높은 자리에 선다', coreConflict: '위치가 바뀌어도 과거의 관계와 감정은 바뀌지 않는다', tone: '통쾌함과 아이러니, 씁쓸한 성찰', chapterArc: ['현재의 낮은 위치', '역전의 계기 발생', '역전 과정 중 두 사람 재회', '과거 관계로 인한 갈등', '역전 완성 — 감정 충돌 피크', '용서 또는 새로운 균형'], tropeKey: 'inheritance' },
  { id: 'dt_06', type: '오해·누명', hook: '진실을 알고 있지만 말할 수 없다 — 말하는 순간 더 큰 것을 잃는다', coreConflict: '침묵이 관계를 파괴하고, 진실이 다른 관계를 파괴한다', tone: '답답함과 안타까움, 마지막의 카타르시스', chapterArc: ['오해 발생 — 진짜 이유 암시', '오해가 쌓이며 관계 악화', '해명 시도 — 실패', '제3자가 진실의 열쇠를 쥐다', '진실 공개 직전 위기', '진실 공개 — 용서 또는 늦음'], tropeKey: 'office_romance' },
  { id: 'dt_07', type: '집착·의존', hook: '한 사람이 다른 사람의 전부가 되었을 때 — 그 무게를 감당할 수 없다', coreConflict: '사랑과 집착의 경계는 언제 무너지는가', tone: '불안·연민·공포가 교차하는 심리적 긴장감', chapterArc: ['현재의 관계 — 이상함 암시', '집착의 구체적 형태 공개', '피집착자의 탈출 시도', '집착자의 과거 트라우마 공개', '관계의 파국 직전', '분리 또는 공멸'], tropeKey: 'affair' },
  { id: 'dt_08', type: '재혼·혼합 가족', hook: '새로운 가족을 만들려 할수록 과거 가족이 더 강하게 존재감을 드러낸다', coreConflict: '전처·전남편·의붓자녀·시어머니 — 모두가 새 출발을 막는 힘으로 작용한다', tone: '억울함·외로움·포기 직전의 감정', chapterArc: ['재혼 가정의 표면 — 균열 암시', '갈등 본격화 (의붓자녀 또는 시어머니)', '전 배우자의 개입', '새 배우자의 의심 폭발', '과거와 현재 중 선택 요구', '재혼 유지 또는 해체'], tropeKey: 'remarriage' },
  { id: 'dt_09', type: '금지된 감정', hook: '선을 알면서도 선이 어딘지 모르는 상태', coreConflict: '감정 자체는 죄가 아니지만 실행은 모든 것을 파괴한다', tone: '설렘·죄책감·두려움이 동시에 존재하는 감정 밀도', chapterArc: ['첫 만남 또는 재회 — 감정의 씨앗', '접촉 빈도 증가 — 감정 성장', '주변 인물이 눈치채기 시작', '선을 넘을 뻔한 순간', '감정 고백 또는 회피', '선택 — 감정 포기 또는 관계 파괴 감수'], tropeKey: 'affair' },
  { id: 'dt_10', type: '경제 위기·파산', hook: '돈이 사라지는 순간, 관계의 진짜 얼굴이 드러난다', coreConflict: '경제적 붕괴가 신뢰·사랑·자존심을 하나씩 무너뜨린다', tone: '현실감·절박함·배신감', chapterArc: ['겉으로 평범한 일상 — 재정 균열 암시', '위기 본격화 — 숨겨진 부채 공개', '원인 추적 — 배신 가능성', '경제 + 감정 동시 붕괴', '책임 소재 충돌', '재건 또는 관계 해체'], tropeKey: 'redevelopment' },
  { id: 'dt_11', type: '타임슬립', hook: '눈을 떴더니 과거였다 — 그 사람이 아직 살아있다', coreConflict: '과거를 바꾸면 현재의 사랑도 사라진다. 무엇을 선택할 것인가', tone: '그리움·설렘·선택의 무게감', chapterArc: ['현재 — 상실 또는 비극 직후', '과거로 이동 — 혼란과 적응', '과거의 그 사람과 재회 — 감정 충돌', '과거를 바꾸려 시도 — 예상치 못한 부작용', '타임슬립의 진짜 이유 공개', '현재로 귀환 — 달라진 세계 또는 달라진 감정'], tropeKey: 'midlife_crisis' },
  { id: 'dt_12', type: '과거 회귀', hook: '죽기 직전, 모든 것을 알게 된 채로 다시 시작점에 섰다', coreConflict: '이미 결말을 아는 사람이 과정을 살아야 할 때 — 복수인가, 구원인가', tone: '냉철함과 감정 사이의 팽팽한 긴장, 통쾌함', chapterArc: ['죽음 또는 절정의 비극 — 회귀 트리거', '과거로 돌아온 첫날 — 지식과 감정의 충돌', '회귀 지식으로 첫 개입 — 의도치 않은 변수 발생', '배신자를 알면서 함께해야 하는 상황', '복수 계획 vs 구원 감정의 충돌 — 선택 기로', '과거 변경 완료 — 새로운 결말 또는 또 다른 비극'], tropeKey: 'power_abuse' },
  { id: 'dt_13', type: '환생·전생', hook: '처음 만나는 얼굴인데 — 왜 이렇게 익숙한가', coreConflict: '전생의 감정과 현생의 이성이 충돌한다. 전생의 비극이 현생에서 반복될 것인가', tone: '숙명적 설렘·전생의 슬픔·현생의 희망', chapterArc: ['현생에서 운명적 첫 만남 — 이유 모를 친숙함', '꿈과 플래시백 — 전생 단편 공개', '전생의 관계와 비극이 드러나기 시작', '전생 비극의 원인이 현생에도 존재함을 인식', '전생의 실수를 반복하지 않으려는 선택', '전생의 저주 해소 또는 현생에서의 새로운 결말'], tropeKey: 'youth' },
  { id: 'dt_14', type: '빙의·다른 몸으로 교체', hook: '눈을 떴더니 내가 아닌 누군가의 몸 안에 있었다', coreConflict: '남의 삶을 살수록 그 사람의 감정에 빠져든다. 원래 몸으로 돌아가고 싶지 않아진다', tone: '혼란·성장·예상치 못한 감정', chapterArc: ['갑작스러운 빙의 — 혼란과 적응', '원래 인물의 삶을 살며 관계 파악', '원래 인물의 비밀 발견 — 감당해야 할 짐', '원래 인물의 연인·가족과 감정이 생기기 시작', '원래 몸으로 돌아갈 방법 발견 — 하지만 망설임', '선택 — 귀환 또는 이 삶을 선택'], tropeKey: 'youth' },
  { id: 'dt_15', type: '죽음 후 귀신·미련', hook: '죽었는데 — 아직 떠나지 못했다. 그 사람 곁에 머물고 있다', coreConflict: '살아있는 사람을 지켜보는 것은 사랑인가, 집착인가. 떠나야 한다는 것을 알면서도 못 간다', tone: '애틋함·그리움·이별의 무게', chapterArc: ['죽음 — 귀신 상태로 각성', '살아있는 사람 곁에서 현실 파악', '자신의 죽음에 관한 진실 발견', '살아있는 사람과 소통 시도 — 한계와 좌절', '미련의 진짜 이유 공개 — 감정 최고조', '미련 해소 — 이별 또는 기적'], tropeKey: 'isolation' },
  { id: 'dt_16', type: '소설 속 주인공으로 빙의', hook: '읽던 소설 속으로 들어왔다 — 그리고 나는 이 이야기의 결말을 알고 있다', coreConflict: '정해진 결말을 바꾸려 할수록 세계가 저항한다. 원작의 흐름을 거스를 수 있는가', tone: '메타적 재미·긴장·감정이입', chapterArc: ['소설 속으로 빙의 — 원작 지식으로 상황 파악', '원작 흐름대로 진행되는 것들 — 안도와 불안', '원작과 다른 선택을 시도 — 예상치 못한 반응', '원작의 악역 또는 운명적 인물과 감정이 생김', '원작 결말을 막을 수 있는 마지막 기회', '변경된 결말 또는 새로운 이야기의 시작'], tropeKey: 'youth' },
  { id: 'dt_17', type: '루프물 (시간 반복)', hook: '오늘이 끝나면 또 오늘이다 — 이 하루에서 당신을 구해야 한다', coreConflict: '반복할수록 감각이 무뎌진다. 그런데 그 사람을 만나는 순간만은 매번 새롭다', tone: '긴박함·반복 속 성장·벅찬 감정', chapterArc: ['첫 번째 하루 — 예상치 못한 사건으로 리셋', '반복 인식 — 규칙 파악 시도', '루프를 이용해 상대방과 관계 쌓기 시작', '상대방이 루프를 눈치채거나 — 기억의 단서 발견', '루프 탈출 조건 파악 — 감정과 연결됨', '조건 충족 — 루프 해소 또는 선택으로 마감'], tropeKey: 'midlife_crisis' },
  { id: 'dt_18', type: '이계 전이', hook: '현실에서 눈을 떴더니 — 내가 알던 세계가 아니었다', coreConflict: '이 세계의 규칙을 모르는 이방인이 살아남으려면 — 가장 강한 자와 손잡아야 한다', tone: '모험·긴장·이방인의 성장', chapterArc: ['이계로 전이 — 혼란과 생존 위기', '이계의 규칙과 세력 파악 — 조력자 등장', '이계의 핵심 갈등에 휘말림', '현실로 돌아갈 방법 발견 — 하지만 남겨야 할 것이 생김', '이계의 적대 세력과 최종 충돌', '귀환 선택 또는 이계에 머물기 선택'], tropeKey: 'youth' },
  { id: 'dt_19', type: '출생의 비밀', hook: '내 부모가 내 부모가 아니었다 — 그리고 진짜 가족은 내가 가장 증오하는 사람들이었다', coreConflict: '혈연을 알게 된 순간 — 사랑했던 관계가 불가능해지거나, 증오했던 관계가 재정립된다', tone: '충격·배신·정체성 혼란 끝의 수용', chapterArc: ['현재의 삶 — 정체성의 균열 첫 신호', '출생에 관한 단서 발견 — 조사 시작', '생부모 또는 혈연의 실체 접촉', '진실 공개 — 관계 재편의 충격', '진실로 인한 감정·관계 붕괴 최고조', '혈연보다 강한 유대 확인 또는 완전한 결별'], tropeKey: 'inheritance' },
  { id: 'dt_20', type: '기억상실', hook: '당신을 사랑했다는 걸 기억 못 하는 사람 곁에 — 여전히 머물고 있다', coreConflict: '기억을 잃은 사람에게 과거를 강요하면 현재를 잃는다. 처음부터 다시 사랑받을 수 있는가', tone: '애틋함·안타까움·희망과 절망 교차', chapterArc: ['사고 또는 충격 — 기억 소실', '기억 없는 상태로 상대방과 재접촉', '과거 감정의 흔적이 몸과 반응으로 남아있음', '기억상실의 진짜 원인 접근 — 저항하는 무의식', '기억 회복 직전 — 모든 것이 걸린 선택', '기억 회복 또는 새로운 기억으로 재출발'], tropeKey: 'midlife_crisis' },
  { id: 'dt_21', type: '재벌·계층 갈등 로맨스', hook: '다른 세계의 두 사람 — 계층이 사랑을 가로막는다', coreConflict: '사랑은 진심이지만 세계가 허락하지 않는다. 계층을 넘으려 할수록 더 높은 벽이 나타난다', tone: '설렘·박탈감·반항심·로맨틱 긴장감', chapterArc: ['우연한 만남 — 계층 차이 인식', '접근 불가능한 상대에게 감정 발생', '주변의 반대와 방해 — 계층 권력 개입', '두 사람 사이의 숨겨진 과거 연결 발견', '계층을 선택할 것인가 사랑을 선택할 것인가', '계층 극복 또는 현실의 벽 앞에서 선택'], tropeKey: 'inheritance' },
  { id: 'dt_22', type: '직장 갑질·내부고발', hook: '가해자가 내 상사였다 — 그리고 나는 증거를 갖고 있다', coreConflict: '진실을 밝히면 내 삶도 무너진다. 침묵하면 계속 무너진다. 어느 쪽도 안전하지 않다', tone: '분노·공포·정의감·씁쓸한 현실', chapterArc: ['일상적 직장 — 갑질 구조 암시', '결정적 사건 — 증거 확보 또는 목격', '고발 시도 — 조직의 은폐 시스템과 충돌', '조력자 등장 — 의도 불명확', '가해자의 역공 — 생존 위기', '진실 공개 또는 타협·은폐로 마감'], tropeKey: 'power_abuse' },
  { id: 'dt_23', type: '보호자 로맨스', hook: '당신을 지키는 것이 임무였는데 — 감정이 임무를 방해한다', coreConflict: '감정이 생기는 순간 보호자로서 실패할 수 있다. 하지만 감정 없이는 진짜 지킬 수 없다', tone: '긴장감·신뢰·금지된 설렘', chapterArc: ['보호 관계 시작 — 거리 유지 원칙 확인', '접촉 반복으로 감정 발생 — 직업 윤리와 충돌', '위협 상황에서 본능적 보호 — 감정 노출', '보호자의 과거와 현재 위협의 연결 발견', '감정 고백 또는 억제 — 위협 최고조', '위협 해소 + 감정 선택'], tropeKey: 'office_romance' },
  { id: 'dt_24', type: '공동 피해자·사기 복수', hook: '같은 사기꾼에게 당한 두 사람이 손을 잡았다 — 그런데 서로를 의심하고 있다', coreConflict: '복수를 위해 협력하면서 신뢰가 쌓인다. 그런데 상대방도 피해자가 아닐 수 있다', tone: '의심·긴장·연대감·예상 못 한 감정', chapterArc: ['두 사람의 피해 상황 교차 — 같은 가해자 암시', '우연한 만남 — 공통 적 확인', '협력 합의 — 서로를 의심하면서도 손잡음', '복수 계획 실행 중 상대방의 숨겨진 면 발견', '상대방이 피해자인지 공범인지 혼란 최고조', '진실 공개 — 복수 완성 또는 서로를 선택'], tropeKey: 'power_abuse' },
  { id: 'dt_25', type: '사망 예고', hook: '당신이 언제 죽을지 알게 됐다 — 막을 수 있는가', coreConflict: '운명을 바꾸려 할수록 다른 비극이 생긴다. 그 사람의 죽음을 막으면 내가 죽는다', tone: '절박함·애틋함·운명과의 대결', chapterArc: ['사망 예고 인식 — 충격과 부정', '예고된 죽음을 막으려는 첫 시도 — 실패 또는 변수', '사망 예고 대상과 감정적으로 가까워짐', '막으려 할수록 다가오는 죽음 — 절박함 최고조', '예고의 진짜 의미 또는 조건 발견', '운명에 저항 또는 수용 — 대가를 치른 결말'], tropeKey: 'isolation' },
  { id: 'dt_26', type: '계약 존재 (악마·신·요괴)', hook: '소원을 이뤄주겠다 — 대신 나와 계약해라', coreConflict: '소원을 이루는 과정에서 정말 원하는 것이 무엇인지 바뀐다. 계약 상대에게 감정이 생긴다', tone: '묘한 긴장감·비인간적 존재의 인간화·설렘', chapterArc: ['절박한 상황 — 계약 존재와 첫 접촉', '계약 체결 — 조건과 대가 확인', '소원 이행 과정에서 계약 존재와 동행', '계약 존재가 인간 감정 학습 — 혼란 시작', '계약 만료 또는 대가 지불 시점 — 선택 기로', '계약 너머의 감정 선택 또는 이별'], tropeKey: 'youth' },
  { id: 'dt_27', type: '꿈 속 만남', hook: '꿈에서만 만나는 사람이 현실에 나타났다 — 그는 나를 모른다', coreConflict: '꿈 속에서는 모든 것을 알고 현실에서는 아무것도 모른다. 꿈과 현실 중 어느 쪽이 진짜인가', tone: '몽환적 설렘·현실과 비현실의 경계·그리움', chapterArc: ['반복되는 꿈 — 같은 사람과의 친밀한 장면', '현실에서 꿈 속 인물 발견 — 충격', '꿈과 현실의 간극 — 현실의 그는 모른다', '꿈이 예고인지 기억인지 파악 시도', '꿈의 마지막 장면 — 비극 또는 선택', '꿈의 진실 공개 — 현실에서의 선택'], tropeKey: 'affair' },
  { id: 'dt_28', type: '평행 우주·거울 세계', hook: '내가 선택하지 않은 삶을 살고 있는 또 다른 나 — 그 세계의 내가 더 행복해 보인다', coreConflict: '다른 선택을 한 나의 삶이 부럽지만 — 그 삶에도 내가 모르는 대가가 있었다', tone: '후회·호기심·선택의 무게·자기 수용', chapterArc: ['현재 세계의 후회 — 평행 세계 문 열림', '다른 삶을 살고 있는 또 다른 자신 관찰', '평행 세계에 개입 시도 — 두 세계 충돌 시작', '평행 세계의 숨겨진 대가 발견', '어느 세계를 선택할 것인가 — 돌아올 수 없는 선택 기로', '선택 완료 — 하나의 세계에서 새로운 시작'], tropeKey: 'midlife_crisis' },
];

const cardBase: React.CSSProperties = {
  borderRadius: '10px',
  padding: '0.85rem 1rem',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

interface WorldData {
  title?: string;
  topic?: string;
  genre?: string;
  style?: string;
  relationship?: string;
  conflictTypes?: string[];      // tropeKey 배열 (casting_service 소비용)
  conflictFormulas?: string[];   // formula ID 배열 (UI 복원용)
  coreTheme?: string;
  coreWound?: string;
  openingHook?: string;
  socialBackground?: string;
  seriesDirection?: string;
  charARole?: string;
  charBRole?: string;
  storyArc?: Record<string, string>;
  [key: string]: unknown;
}

interface WorldOption {
  id: string;
  label: string;
  tension: string;
  scene: string;
  category?: string;
}

interface WorldOptionsData {
  backgrounds: WorldOption[];
  relationships: WorldOption[];
  social_fractures: WorldOption[];
  conflict_structures: WorldOption[];
  resolution_methods: WorldOption[];
  narrative_povs: WorldOption[];
}

interface SelectedOptions {
  background?: string;
  relationship?: string;
  social_fracture?: string;
  conflict_structure?: string;
  resolution_method?: string;
  narrative_pov?: string;
}

interface Props {
  seriesId: string;
  worldData: WorldData;
  onConfirm: () => void;
}

/** conflictFormulas(ID) 우선, 없으면 conflictTypes(텍스트)→ID 매핑, 그마저 없으면 기본값 dt_01 */
function resolveInitialConflicts(data: WorldData): string[] {
  const formulas = data.conflictFormulas as string[] | undefined;
  if (formulas && formulas.length > 0) return formulas;

  // world_service가 tropeKey(affair 등)를 넣은 경우 — formula ID와 무관하므로 텍스트 매핑 불가
  // raw_conflict_types (한국어 텍스트)가 있으면 formula.type과 비교
  const types = (data.conflictTypes as string[] | undefined) || [];
  const matched: string[] = [];
  for (const t of types) {
    const found = DRAMA_FORMULAS.find(
      f => f.type === t || f.type.includes(t) || t.includes(f.type)
    );
    if (found && !matched.includes(found.id)) matched.push(found.id);
  }
  return matched.length > 0 ? matched : ['dt_01']; // 기본값: 불륜·배신
}

export default function WorldEditor({ seriesId, worldData, onConfirm }: Props) {
  const [form, setForm] = useState<WorldData>({ ...worldData });
  // conflictFormulas = formula ID 배열 (UI 선택 상태); conflictTypes = tropeKey 배열 (API용)
  const [conflicts, setConflicts] = useState<string[]>(() => resolveInitialConflicts(worldData));
  const [storyArc, setStoryArc] = useState<Record<string, string>>(worldData.storyArc || {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [worldOptions, setWorldOptions] = useState<WorldOptionsData | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<SelectedOptions>(
    (worldData.selectedOptions as SelectedOptions) || {}
  );
  // 선택된 옵션이 있으면 기본으로 펼쳐서 사용자가 즉시 확인할 수 있게
  const [optionsOpen, setOptionsOpen] = useState(() =>
    Object.values((worldData.selectedOptions as SelectedOptions) || {}).some(Boolean)
  );

  useEffect(() => {
    fetch('http://localhost:8001/api/v1/world-options')
      .then(r => r.ok ? r.json() : null)
      .then(data => data && setWorldOptions(data))
      .catch(() => {});
  }, []);

  const handleChange = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const toggleConflict = (id: string) => {
    const formula = DRAMA_FORMULAS.find(f => f.id === id);
    setConflicts(prev => {
      // 최대 2개 제한 — 이미 2개 선택됐고 새 항목 추가 시도면 무시
      if (!prev.includes(id) && prev.length >= 2) return prev;
      const next = prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id];
      // 첫 번째 선택이고 storyArc가 비어있을 때만 자동 채우기
      if (!prev.includes(id) && prev.length === 0 && formula && Object.keys(storyArc).length === 0) {
        const arcKeys = ['ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06'];
        const newArc: Record<string, string> = {};
        formula.chapterArc.forEach((text, i) => {
          if (arcKeys[i]) newArc[arcKeys[i]] = text;
        });
        setStoryArc(newArc);
      }
      return next;
    });
    setSaved(false);
  };

  const handleArcChange = (key: string, value: string) => {
    setStoryArc(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await fetch(`${API}/series/${seriesId}/world`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        world_data: {
          ...form,
          conflictFormulas: conflicts,
          conflictTypes: conflicts.map(id => DRAMA_FORMULAS.find(f => f.id === id)?.tropeKey ?? id),
          storyArc,
          selectedOptions,
        }
      }),
    });
    setSaving(false);
    setSaved(true);
  };

  const handleConfirm = async () => {
    await handleSave();
    await fetch(`${API}/series/${seriesId}/approve/world`, { method: 'POST' });
    onConfirm();
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    // 선택된 옵션 먼저 저장
    await fetch(`${API}/series/${seriesId}/world`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ world_data: { selectedOptions } }),
    });
    // 세계관 단계 재실행
    await fetch(`${API}/series/${seriesId}/retry/world`, { method: 'POST' });
    setRegenerating(false);
    onConfirm();
  };

  const toggleOption = (dimension: keyof SelectedOptions, id: string) => {
    setSelectedOptions(prev => ({
      ...prev,
      [dimension]: prev[dimension] === id ? undefined : id,
    }));
    setSaved(false);
  };

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: 'rgba(255,255,255,0.38)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: '0.75rem',
  };

  const textareaStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px',
    color: 'rgba(255,255,255,0.92)',
    padding: '0.6rem 0.85rem',
    fontSize: '0.88rem',
    resize: 'vertical',
    fontFamily: 'inherit',
    lineHeight: 1.7,
    width: '100%',
    boxSizing: 'border-box',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    outline: 'none',
    transition: 'border-color 0.15s',
  };

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px',
    color: 'rgba(255,255,255,0.92)',
    padding: '0.6rem 0.85rem',
    fontSize: '0.88rem',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    outline: 'none',
    transition: 'border-color 0.15s',
  };

  const renderTextarea = (key: string, label: string, rows: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <label style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
        {label}
      </label>
      <textarea
        value={String(form[key] || '')}
        onChange={e => handleChange(key, e.target.value)}
        rows={rows}
        style={textareaStyle}
      />
    </div>
  );

  const renderOptionDimension = (
    title: string,
    dimension: keyof SelectedOptions,
    options: WorldOption[]
  ) => {
    const selected = selectedOptions[dimension];
    return (
      <div>
        <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
          {title}
          {selected && <span style={{ marginLeft: '0.5rem', color: '#a5b4fc', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            ✓ {options.find(o => o.id === selected)?.label}
          </span>}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.45rem' }}>
          {options.map(opt => {
            const isSelected = selected === opt.id;
            return (
              <div
                key={opt.id}
                onClick={() => toggleOption(dimension, opt.id)}
                className="glass glass-card"
                style={{
                  padding: '0.6rem 0.75rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  ...(isSelected ? {
                    border: '2px solid var(--accent-violet)',
                    background: 'rgba(180,144,245,0.15)',
                    boxShadow: '0 0 20px rgba(180,144,245,0.2)',
                  } : {}),
                }}
              >
                <div style={{ position: 'relative', zIndex: 2 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem', color: isSelected ? 'var(--accent-violet)' : '#fff', marginBottom: '0.2rem' }}>
                    {isSelected && '✓ '}{opt.label}
                  </div>
                  <div style={{
                    fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', lineHeight: 1.4,
                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}>
                    {opt.scene}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const hasStoryArc = Object.keys(storyArc).length > 0;

  return (
    <div className="glass-dark" style={{ borderRadius: '16px', border: '1px solid rgba(180,144,245,0.3)', padding: '1.75rem' }}>

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.2rem', color: '#fff' }}>
            세계관 확인 & 편집
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)' }}>
            이 세계관 위에 캐릭터와 대본이 만들어집니다
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`glass-btn glass-btn--sm glass-btn--ghost${saved ? ' glass-btn--success' : ''}`}
          style={{ borderRadius: '8px' }}
        >
          {saving ? '저장 중…' : saved ? '저장됨 ✓' : '임시 저장'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

        {/* 섹션0 — 세계관 옵션 설정 */}
        <div style={{
          borderRadius: '12px',
          border: '1px solid rgba(180,144,245,0.2)',
          background: 'rgba(99,102,241,0.07)',
          overflow: 'hidden',
        }}>
          {/* 헤더 — 클릭으로 열기/닫기 */}
          <div
            onClick={() => setOptionsOpen(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.85rem 1.1rem', cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-violet)', letterSpacing: '0.05em' }}>
                  ★ 세계관 초기 설정
                </span>
                {Object.values(selectedOptions).filter(Boolean).length > 0 && (
                  <span style={{
                    fontSize: '0.68rem', padding: '0.1rem 0.5rem', borderRadius: '999px',
                    background: 'rgba(99,102,241,0.2)', color: '#a5b4fc',
                  }}>
                    {Object.values(selectedOptions).filter(Boolean).length}개 선택됨
                  </span>
                )}
              </div>
              {/* 접힌 상태에서도 선택된 옵션 라벨 요약 */}
              {!optionsOpen && worldOptions && Object.values(selectedOptions).some(Boolean) && (
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {selectedOptions.narrative_pov && worldOptions.narrative_povs.find(o => o.id === selectedOptions.narrative_pov) && (
                    <span style={{ fontSize: '0.65rem', color: '#c4b5fd', background: 'rgba(99,102,241,0.15)', padding: '0.1rem 0.45rem', borderRadius: '4px' }}>
                      {worldOptions.narrative_povs.find(o => o.id === selectedOptions.narrative_pov)!.label}
                    </span>
                  )}
                  {selectedOptions.resolution_method && worldOptions.resolution_methods.find(o => o.id === selectedOptions.resolution_method) && (
                    <span style={{ fontSize: '0.65rem', color: '#c4b5fd', background: 'rgba(99,102,241,0.15)', padding: '0.1rem 0.45rem', borderRadius: '4px' }}>
                      {worldOptions.resolution_methods.find(o => o.id === selectedOptions.resolution_method)!.label}
                    </span>
                  )}
                  {selectedOptions.background && worldOptions.backgrounds.find(o => o.id === selectedOptions.background) && (
                    <span style={{ fontSize: '0.65rem', color: '#c4b5fd', background: 'rgba(99,102,241,0.15)', padding: '0.1rem 0.45rem', borderRadius: '4px' }}>
                      {worldOptions.backgrounds.find(o => o.id === selectedOptions.background)!.label}
                    </span>
                  )}
                  {selectedOptions.relationship && worldOptions.relationships.find(o => o.id === selectedOptions.relationship) && (
                    <span style={{ fontSize: '0.65rem', color: '#c4b5fd', background: 'rgba(99,102,241,0.15)', padding: '0.1rem 0.45rem', borderRadius: '4px' }}>
                      {worldOptions.relationships.find(o => o.id === selectedOptions.relationship)!.label}
                    </span>
                  )}
                </div>
              )}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
              {optionsOpen ? '▲ 접기' : '▼ 펼치기'}
            </span>
          </div>

          {/* 펼쳐진 내용 */}
          {optionsOpen && (
            <div style={{ padding: '0 1.1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {worldOptions ? (
                <>
                  {renderOptionDimension('배경 / 장소', 'background', worldOptions.backgrounds)}
                  {renderOptionDimension('두 주인공의 관계', 'relationship', worldOptions.relationships)}
                  {renderOptionDimension('사회적 균열', 'social_fracture', worldOptions.social_fractures)}
                  {renderOptionDimension('갈등 구조', 'conflict_structure', worldOptions.conflict_structures)}

                  {/* 갈등 해소 방식 — 현실/비현실 그룹 분리 */}
                  <div>
                    <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                      갈등 해소 방식
                      {selectedOptions.resolution_method && (
                        <span style={{ marginLeft: '0.5rem', color: '#a5b4fc', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                          ✓ {worldOptions.resolution_methods.find(o => o.id === selectedOptions.resolution_method)?.label}
                        </span>
                      )}
                    </p>
                    {(['현실적', '비현실적'] as const).map(cat => (
                      <div key={cat} style={{ marginBottom: '0.6rem' }}>
                        <p style={{ fontSize: '0.68rem', color: cat === '현실적' ? '#34d399' : '#c084fc', fontWeight: 600, marginBottom: '0.35rem', letterSpacing: '0.05em' }}>
                          {cat === '현실적' ? '● 현실적' : '◆ 비현실적'}
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.45rem' }}>
                          {worldOptions.resolution_methods.filter(o => o.category === cat).map(opt => {
                            const isSelected = selectedOptions.resolution_method === opt.id;
                            const accent = cat === '현실적' ? '#10b981' : '#a855f7';
                            return (
                              <div
                                key={opt.id}
                                onClick={() => toggleOption('resolution_method', opt.id)}
                                className="glass glass-card"
                                style={{
                                  padding: '0.6rem 0.75rem', borderRadius: '8px', cursor: 'pointer',
                                  ...(isSelected ? {
                                    border: `2px solid ${accent}`,
                                    background: `${accent}28`,
                                    boxShadow: `0 0 20px ${accent}33`,
                                  } : {}),
                                }}
                              >
                                <div style={{ position: 'relative', zIndex: 2 }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.82rem', color: isSelected ? accent : '#fff', marginBottom: '0.2rem' }}>
                                    {isSelected && '✓ '}{opt.label}
                                  </div>
                                  <div style={{
                                    fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', lineHeight: 1.4,
                                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                  }}>
                                    {opt.scene}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 서술 시점 — 4개, 2열 */}
                  <div>
                    <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                      서술 시점
                      {selectedOptions.narrative_pov && (
                        <span style={{ marginLeft: '0.5rem', color: '#a5b4fc', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                          ✓ {worldOptions.narrative_povs.find(o => o.id === selectedOptions.narrative_pov)?.label}
                        </span>
                      )}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
                      {worldOptions.narrative_povs.map(opt => {
                        const isSelected = selectedOptions.narrative_pov === opt.id;
                        return (
                          <div
                            key={opt.id}
                            onClick={() => toggleOption('narrative_pov', opt.id)}
                            className="glass glass-card"
                            style={{
                              padding: '0.7rem 0.85rem', borderRadius: '8px', cursor: 'pointer',
                              ...(isSelected ? {
                                border: '2px solid var(--accent-violet)',
                                background: 'rgba(180,144,245,0.15)',
                                boxShadow: '0 0 20px rgba(180,144,245,0.2)',
                              } : {}),
                            }}
                          >
                            <div style={{ position: 'relative', zIndex: 2 }}>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: isSelected ? 'var(--accent-violet)' : '#fff', marginBottom: '0.3rem' }}>
                                {isSelected && '✓ '}{opt.label}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.25rem' }}>
                                {opt.tension}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>
                                "{opt.scene}"
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 다시 생성 버튼 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <button
                      onClick={handleRegenerate}
                      disabled={regenerating}
                      className="glass-btn glass-btn--amber"
                      style={{ borderRadius: '8px' }}
                    >
                      {regenerating ? '생성 중…' : '이 설정으로 다시 생성'}
                    </button>
                    <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>
                      선택한 옵션을 제약 조건으로 Gemini가 세계관을 다시 만듭니다
                    </span>
                  </div>
                </>
              ) : (
                <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.3)' }}>옵션 로딩 중…</p>
              )}
            </div>
          )}
        </div>

        {/* 섹션1 — 시리즈 제목 */}
        <div>
          <p style={sectionLabelStyle}>시리즈 제목</p>
          <input
            value={String(form.title || '')}
            onChange={e => handleChange('title', e.target.value)}
            placeholder="시리즈 제목을 입력하세요"
            style={inputStyle}
          />
        </div>

        {/* 섹션2 — 기본 설정 */}
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* 장르 · 문체 — 읽기 전용 (Gemini 도출값, 편집 불가) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {(['genre', 'style'] as const).map(key => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <label style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {key === 'genre' ? '장르' : '문체'}
                    </label>
                    <span style={{
                      fontSize: '0.6rem', padding: '0.1rem 0.4rem', borderRadius: '4px',
                      background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.25)',
                      letterSpacing: '0.04em',
                    }}>
                      AI 도출값
                    </span>
                  </div>
                  <div style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '8px',
                    color: 'rgba(255,255,255,0.55)',
                    padding: '0.55rem 0.75rem',
                    fontSize: '0.88rem',
                    fontFamily: 'inherit',
                    lineHeight: 1.6,
                    userSelect: 'text',
                    cursor: 'default',
                  }}>
                    {String(form[key] || '—')}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
                두 사람의 관계
              </label>
              <input
                value={String(form.relationship || '')}
                onChange={e => handleChange('relationship', e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
        </div>

        {/* 섹션3 — 갈등 유형 (트롭 카드 선택기) */}
        <div>
          <p style={sectionLabelStyle}>갈등 유형</p>
          <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.3)', marginBottom: '0.75rem' }}>
            갈등 유형은 캐스팅 AI가 인물을 선발하는 기준입니다 — <span className={conflicts.length >= 2 ? 'glass-badge glass-badge--error' : 'glass-badge glass-badge--violet'}>최대 2개 {conflicts.length}/2</span>
          </p>

          {/* 드라마 공식 카드 그리드 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem', marginBottom: '1rem' }}>
            {DRAMA_FORMULAS.map(formula => {
              const selected = conflicts.includes(formula.id);
              return (
                <div
                  key={formula.id}
                  onClick={() => toggleConflict(formula.id)}
                  className="glass glass-card"
                  style={
                    selected
                      ? { ...cardBase, border: '2px solid var(--accent-violet)', background: 'rgba(180,144,245,0.15)', boxShadow: '0 0 20px rgba(180,144,245,0.2)' }
                      : cardBase
                  }
                >
                  <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* 상단: type명 + 선택 표시 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.92rem', color: selected ? 'var(--accent-violet)' : '#fff' }}>
                      {formula.type}
                    </span>
                    {selected && (
                      <span style={{ color: 'var(--accent-violet)', fontSize: '0.85rem' }}>✓</span>
                    )}
                  </div>
                  {/* 중간: hook 텍스트 */}
                  <span style={{
                    fontSize: '0.75rem',
                    fontStyle: 'italic',
                    color: 'rgba(255,255,255,0.45)',
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}>
                    {formula.hook}
                  </span>
                  {/* 구분선 */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
                    {/* 하단: tone pill */}
                    <span style={{
                      fontSize: '0.68rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '999px',
                      display: 'inline-block',
                      background: selected ? 'rgba(180,144,245,0.2)' : 'rgba(255,255,255,0.06)',
                      color: selected ? 'var(--accent-violet)' : 'rgba(255,255,255,0.4)',
                    }}>
                      {formula.tone}
                    </span>
                  </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 일대일 구조 시각화 또는 경고 */}
          {conflicts.length > 0 ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '0.85rem 1.1rem',
              borderRadius: '10px',
              background: 'rgba(180,144,245,0.06)',
              border: '1px solid rgba(180,144,245,0.18)',
            }}>
              {/* 주인공 A */}
              <div style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                fontSize: '0.82rem',
                color: 'rgba(255,255,255,0.55)',
              }}>
                {String(form.charARole || '주인공 A')}
              </div>

              {/* 중앙: 선택된 공식 */}
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                {conflicts.map(id => {
                  const formula = DRAMA_FORMULAS.find(f => f.id === id);
                  if (!formula) return null;
                  return (
                    <div key={id} style={{ lineHeight: 1.4, marginBottom: '0.3rem' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--accent-violet)', fontWeight: 600 }}>
                        ⚡ {formula.type}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', display: 'block', fontStyle: 'italic' }}>
                        {formula.coreConflict}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 주인공 B */}
              <div style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                fontSize: '0.82rem',
                color: 'rgba(255,255,255,0.55)',
                textAlign: 'right',
              }}>
                {String(form.charBRole || '주인공 B')}
              </div>
            </div>
          ) : (
            <p style={{ fontSize: '0.78rem', color: 'rgba(239,180,68,0.75)' }}>
              ⚠ 갈등 유형이 비어있으면 기본 트롭으로 캐스팅됩니다
            </p>
          )}
        </div>

        {/* 섹션4 — 서사 뼈대 (2열 그리드) */}
        <div>
          <p style={sectionLabelStyle}>서사 뼈대</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {renderTextarea('coreTheme', '핵심 주제의식', 2)}
            {renderTextarea('coreWound', '두 주인공의 감정 공명', 2)}
          </div>
        </div>

        {/* 섹션5 — 1화 훅 */}
        <div>
          <p style={sectionLabelStyle}>1화 훅</p>
          {renderTextarea('openingHook', '1화 훅 — 첫 장면', 3)}
        </div>

        {/* 섹션6 — 배경 & 방향 (2열 그리드) */}
        <div>
          <p style={sectionLabelStyle}>배경 & 방향</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {renderTextarea('socialBackground', '사회적 배경', 3)}
            {renderTextarea('seriesDirection', '시리즈 방향', 3)}
          </div>
        </div>

        {/* 섹션7 — 주인공 서사 역할 (2열 그리드) */}
        <div>
          <p style={sectionLabelStyle}>주인공 서사 역할</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {renderTextarea('charARole', '주인공 A 서사 역할', 2)}
            {renderTextarea('charBRole', '주인공 B 서사 역할', 2)}
          </div>
        </div>

        {/* 섹션8 — 챕터 가이드라인 */}
        {hasStoryArc && (
          <div>
            <p style={sectionLabelStyle}>챕터 가이드라인 (대본 AI의 기준으로 활용됩니다)</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {Object.keys(CHAPTER_LABELS).map(key => (
                storyArc[key] !== undefined || form.storyArc?.[key] !== undefined ? (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <label style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
                      {CHAPTER_LABELS[key]}
                    </label>
                    <textarea
                      value={storyArc[key] || ''}
                      onChange={e => handleArcChange(key, e.target.value)}
                      rows={2}
                      style={textareaStyle}
                    />
                  </div>
                ) : null
              ))}
            </div>
          </div>
        )}

        {/* 안내 박스 */}
        <div style={{
          padding: '1rem 1.25rem',
          borderRadius: '10px',
          background: 'rgba(180,144,245,0.07)',
          border: '1px solid rgba(180,144,245,0.2)',
          fontSize: '0.85rem',
          color: 'rgba(255,255,255,0.55)',
          lineHeight: 1.6,
        }}>
          ✓  세계관을 확정하면 갈등 유형에 맞는 캐릭터가 자동 배정됩니다. 다음 단계에서 캐릭터를 확인한 뒤 대본이 생성됩니다.
        </div>

      </div>

      {/* 확정 버튼 */}
      <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleConfirm}
          disabled={saving}
          className="glass-btn glass-btn--accent glass-btn--lg"
          style={{ borderRadius: '12px', minWidth: '220px', justifyContent: 'center' }}
        >
          다음 — 캐릭터 확인 →
        </button>
      </div>

    </div>
  );
}
