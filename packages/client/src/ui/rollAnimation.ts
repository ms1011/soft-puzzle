import { useEffect, useRef, useState } from 'react';

/** 굴리는 연출 길이. */
export const ROLL_MS = 600;
/** 굴리는 동안 면을 바꾸는 간격. */
export const ROLL_TICK_MS = 80;

/**
 * 윷·주사위를 던졌을 때의 짧은 연출. key는 "던지기 한 번"을 구분하는 값이다 — 바뀌면 ROLL_MS 동안
 * rolling=true로 두고 ROLL_TICK_MS마다 tick을 올려 화면이 무작위 면을 다시 그리게 한다.
 *
 * 처음 그릴 때는 굴리지 않는다: 재접속하거나 화면에 막 들어온 사람에게 이미 끝난 던지기를 다시
 * 보여줄 이유가 없다. key가 null(아직 던진 적 없음)로 바뀌는 것도 던지기가 아니다. 순전히 화면
 * 연출이라 서버·결과와는 무관하다.
 */
export function useRollAnimation(key: string | null): { rolling: boolean; tick: number } {
  const [rolling, setRolling] = useState(false);
  const [tick, setTick] = useState(0);
  const prevKey = useRef(key);

  useEffect(() => {
    if (key === prevKey.current) return;
    prevKey.current = key;
    if (key === null) return;
    setRolling(true);
    const interval = setInterval(() => setTick((t) => t + 1), ROLL_TICK_MS);
    const done = setTimeout(() => {
      clearInterval(interval);
      setRolling(false);
    }, ROLL_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(done);
      // 굴리는 도중 다음 던지기가 오면 새 연출이 바로 이어진다(아래 effect가 다시 rolling을 켠다).
      setRolling(false);
    };
  }, [key]);

  return { rolling, tick };
}

/** 굴리는 동안 보여줄 무작위 주사위 눈. */
export function randomFace(): number {
  return Math.floor(Math.random() * 6) + 1;
}
