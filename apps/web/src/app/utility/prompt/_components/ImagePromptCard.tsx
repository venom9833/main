'use client';
/**
 * ImagePromptCard.tsx
 *
 * 역할: 이미지 프롬프트 1개를 썸네일 카드 형태로 표시.
 *
 * props:
 *   item        -- 프롬프트 데이터
 *   catLabels   -- 카테고리 ID -> {label, emoji} 매핑 (배지에 한국어 라벨 표시용)
 *   onClick     -- 카드 클릭 시 모달 열기 콜백
 *   hearts      -- 현재 하트 평점 (0=없음, 1~5)
 *   onSetHearts -- 하트 설정 콜백 (0이면 평점 취소)
 */

import { memo } from 'react';
import HeartRating from './HeartRating';

/**
 * 프롬프트 데이터 타입 (경량 메타 -- content/args 없음)
 * 상세 데이터(content+args+image_url)는 모달 열 때 별도 fetch.
 */
export type ImgPromptItem = {
  id: string;
  master_no: string;
  title: string;
  description: string;
  thumb_url: string;
  categories: string[];
  featured: boolean;
};

/** 카테고리 라벨 타입 */
export type CatLabelMap = Record<string, { label: string; emoji: string }>;

interface Props {
  item: ImgPromptItem;
  catLabels: CatLabelMap;
  onClick: () => void;
  /** 현재 하트 평점 (0=없음, 1~5) */
  hearts: number;
  /** 하트 설정 콜백 -- 0이면 평점 취소 */
  onSetHearts: (n: number) => void;
}

function ImagePromptCard({ item, catLabels, onClick, hearts, onSetHearts }: Props) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'rgba(255,255,255,0.48)',
        border: '1px solid rgba(15,23,42,0.12)',
        borderRadius: 14,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'transform 0.18s, box-shadow 0.18s, background 0.18s, border-color 0.18s',
        boxShadow: '0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.85)',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = 'translateY(-2px)';
        el.style.background = 'rgba(255,255,255,0.65)';
        el.style.borderColor = 'rgba(15,23,42,0.20)';
        el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.92)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = 'translateY(0)';
        el.style.background = 'rgba(255,255,255,0.48)';
        el.style.borderColor = 'rgba(15,23,42,0.12)';
        el.style.boxShadow = '0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.85)';
      }}
    >
      {/* 썸네일 이미지 */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', overflow: 'hidden', background: 'rgba(15,23,42,0.06)' }}>
        {item.thumb_url ? (
          <img
            src={item.thumb_url}
            alt={item.title}
            loading="lazy"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: '10px 10px 0 0',
              display: 'block',
            }}
          />
        ) : (
          /* 썸네일 없을 때 플레이스홀더 */
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(94,231,223,0.08)',
            borderRadius: '10px 10px 0 0',
            fontSize: '2rem',
          }}>
            🖼️
          </div>
        )}

        {/* featured 뱃지 -- 썸네일 우상단 오버레이 */}
        {item.featured && (
          <span style={{
            position: 'absolute', top: 8, right: 8,
            background: 'rgba(248,184,77,0.92)', backdropFilter: 'blur(8px)',
            borderRadius: 6, padding: '2px 7px',
            fontSize: '0.68rem', fontWeight: 700, color: '#78350f',
          }}>
            ★ 추천
          </span>
        )}

        {/* 하트 평점 -- 썸네일 우하단 오버레이 */}
        <div style={{
          position: 'absolute', bottom: 6, right: 6,
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)',
          borderRadius: 8, padding: '3px 6px',
        }}>
          <HeartRating hearts={hearts} onSet={onSetHearts} overlay />
        </div>
      </div>

      {/* 카드 본문 */}
      <div style={{ padding: '12px 14px 14px' }}>
        {/* master_no 뱃지 */}
        <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '0.65rem', fontWeight: 700, color: '#0891b2',
            background: 'rgba(8,145,178,0.12)', padding: '2px 7px', borderRadius: 5,
            letterSpacing: '0.04em', border: '1px solid rgba(8,145,178,0.25)',
            flexShrink: 0,
          }}>
            #{item.master_no}
          </span>

          {/* 카테고리 배지 -- 최대 2개 */}
          {item.categories.slice(0, 2).map((catId) => {
            const meta = catLabels[catId];
            const label = meta?.label ?? catId;
            const emoji = meta?.emoji ?? '';
            return (
              <span
                key={catId}
                style={{
                  fontSize: '0.62rem', color: 'rgba(15,23,42,0.55)',
                  background: 'rgba(15,23,42,0.06)', padding: '2px 6px', borderRadius: 4,
                  border: '1px solid rgba(15,23,42,0.10)',
                  whiteSpace: 'nowrap',
                }}
              >
                {emoji && `${emoji} `}{label}
              </span>
            );
          })}
        </div>

        {/* 제목 -- 2줄 말줄임 */}
        <div style={{
          fontSize: '0.85rem', fontWeight: 600, color: '#0f172a',
          lineHeight: 1.4, marginBottom: 4,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as const,
          overflow: 'hidden',
        }}>
          {item.title}
        </div>

        {/* 설명 -- 1줄 말줄임 */}
        <div style={{
          fontSize: '0.73rem', color: 'rgba(15,23,42,0.50)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {item.description || ' '}
        </div>

      </div>
    </div>
  );
}

// hearts/onSetHearts 변경 시에도 리렌더 필요 -- memo는 유지하되 얕은 비교로 작동
export default memo(ImagePromptCard);
