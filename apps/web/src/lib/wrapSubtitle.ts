/**
 * wrapSubtitle.ts — 자막 줄바꿈 유틸리티
 *
 * Python srt_service.py의 _wrap_text() / wrap_srt()와 동일한 알고리즘.
 * subtitle_style.json의 wrapMaxChars 값을 받아 SRT 텍스트를 처리한다.
 * 번인 미리보기 모드에서 프리뷰 자막이 실제 FFmpeg 번인과 동일하게 보이도록 보장한다.
 */

/**
 * 공백 기준 단어 분리 후 maxChars 이하 줄로 묶기.
 * Python _wrap_text()와 동일 로직.
 *
 * @param text     줄바꿈 처리할 원본 텍스트
 * @param maxChars 한 줄 최대 글자 수 (16:9 = 30, 9:16 = 25)
 * @returns        '\n'으로 구분된 멀티라인 문자열
 */
export function wrapText(text: string, maxChars: number, maxLines: number = 2): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    if (!cur) {
      cur = word;
    } else if (cur.length + 1 + word.length <= maxChars) {
      cur += ' ' + word;
    } else {
      lines.push(cur);
      cur = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines).join('\n');
}

/**
 * SRT 각 항목의 텍스트를 maxChars 기준으로 줄바꿈.
 * Python wrap_srt()와 동일 로직.
 *
 * @param srtContent 원본 SRT 문자열
 * @param maxChars   한 줄 최대 글자 수
 * @returns          줄바꿈 적용된 SRT 문자열
 */
export function wrapSrt(srtContent: string, maxChars: number): string {
  // SRT 블록은 빈 줄 2개 이상으로 구분됨
  const blocks = srtContent.trim().split(/\n\n+/);
  const wrapped = blocks.map((block) => {
    const lines = block.trim().split('\n');
    // SRT 블록: [인덱스 번호] [타임스탬프] [텍스트 1줄 이상]
    if (lines.length < 3) return block;
    const tsLine = lines[1];
    if (!tsLine.includes('-->')) return block;
    // 텍스트 부분(3번째 줄 이후)만 줄바꿈 처리
    const textLines = lines.slice(2).join('\n');
    const wrappedText = wrapText(textLines, maxChars);
    return [lines[0], tsLine, wrappedText].join('\n');
  });
  return wrapped.join('\n\n') + '\n';
}
