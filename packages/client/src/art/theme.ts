/**
 * 렌더링 테마. unicode:true면 박스 문자·무늬 기호·● 등을 쓰고, false면 구형 콘솔
 * (Windows conhost 등)에서도 안전한 순수 ASCII 문자만 쓴다. 두 모드 모두 카드는
 * 7칸×5줄, 주사위는 9칸×5줄로 폭이 동일해서 레이아웃이 절대 흔들리지 않는다.
 */
export interface Theme {
  unicode: boolean;
}

/**
 * argv/env로부터 테마를 결정하는 순수 함수. process.argv/process.env를 직접 읽지
 * 않아야 테스트가 가능하다 — 실제 값 전달은 진입점(Task 16)의 책임이다.
 *
 * 규칙:
 *   1. argv 어디든 '--ascii'가 있으면 무조건 unicode:false.
 *   2. 그 외: platform이 'win32'이고, Windows Terminal(WT_SESSION)도
 *      ConEmu(ConEmuANSI)도 아니면 unicode:false (구형 conhost로 간주).
 *   3. 그 외에는 unicode:true.
 *
 * platform은 두 필수 인자(argv, env)에 포함되지 않으므로 세 번째 선택 인자로 받는다.
 * 기본값은 process.platform이라 실제 실행 시에는 인자 없이 그대로 동작하고,
 * 테스트는 'win32'/'darwin' 등을 직접 주입해 분기를 검증할 수 있다.
 */
export function detectTheme(
  argv: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Theme {
  if (argv.includes('--ascii')) {
    return { unicode: false };
  }
  const isModernWindowsTerminal = Boolean(env.WT_SESSION) || Boolean(env.ConEmuANSI);
  if (platform === 'win32' && !isModernWindowsTerminal) {
    return { unicode: false };
  }
  return { unicode: true };
}
