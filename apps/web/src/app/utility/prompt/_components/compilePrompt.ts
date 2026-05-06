/**
 * compilePrompt.ts
 *
 * 역할: 이미지 프롬프트 content 문자열에서
 *   {argument name="변수명" default="기본값"} 패턴을 실제 값으로 치환.
 *
 * 사용 예:
 *   const values = extractDefaults(item.args);
 *   const compiled = compilePrompt(item.content, values);
 */

/** Args 배열에서 기본값 맵(name → default) 생성 */
export function extractDefaults(
  args: { name: string; default: string }[]
): Record<string, string> {
  // args 배열을 {name: default} 형태의 객체로 변환
  return Object.fromEntries(args.map((a) => [a.name, a.default]));
}

/**
 * content 문자열을 두 단계로 컴파일한다.
 *
 * Step 1 — {argument name="..." default="..."} 선언 줄을 제거한다.
 * Step 2 — 본문의 {변수명} 참조를 values 맵 값으로 치환한다.
 *           values에 없으면 원본 {변수명} 그대로 유지.
 */
export function compilePrompt(
  content: string,
  values: Record<string, string>
): string {
  // Step 1: 선언 줄 제거 (줄바꿈까지 포함해 통째로 삭제)
  const withoutDecls = content.replace(
    /\{argument\s+name="[^"]+"\s+default="[^"]*"\}\n?/g,
    ''
  );

  // Step 2: {변수명} 참조 치환
  const compiled = withoutDecls.replace(
    /\{([^{}]+)\}/g,
    (_full, name: string) => {
      const v = values[name.trim()];
      return v !== undefined && v !== '' ? v : _full;
    }
  );

  return compiled.replace(/^\s*\n/, '');
}
