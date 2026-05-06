'use client';
/**
 * HeartRating.tsx
 *
 * 역할: 1~5개 하트(♥)로 프롬프트 평점을 설정하는 인라인 컴포넌트.
 *
 * 동작:
 *   - 채워진 하트(빨간색) = 현재 평점 이하
 *   - 빈 하트(연한 회색) = 현재 평점 초과
 *   - 현재 평점과 동일한 하트 클릭 → 평점 0으로 초기화 (토글)
 *   - e.stopPropagation() 으로 부모 카드 클릭(모달 열기)과 충돌 방지
 */

interface Props {
  hearts: number;
  onSet: (n: number) => void;
  /** true면 어두운 배경 오버레이 위 — 빈 하트를 흰색 반투명으로 표시 */
  overlay?: boolean;
}

export default function HeartRating({ hearts, onSet, overlay = false }: Props) {
  const emptyColor = overlay ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.20)';
  const emptyHover = overlay ? 'rgba(225,29,72,0.70)' : 'rgba(225,29,72,0.45)';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', gap: 1, alignItems: 'center' }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onSet(hearts === n ? 0 : n)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '2px 2px', fontSize: '1.1rem', lineHeight: 1,
            color: n <= hearts ? '#e11d48' : emptyColor,
            transition: 'color 0.12s, transform 0.1s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1.25)';
            if (n > hearts) (e.currentTarget as HTMLElement).style.color = emptyHover;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
            (e.currentTarget as HTMLElement).style.color = n <= hearts ? '#e11d48' : emptyColor;
          }}
          aria-label={`하트 ${n}개`}
        >
          ♥
        </button>
      ))}
    </div>
  );
}
