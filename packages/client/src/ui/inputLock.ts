import { createContext, useContext } from 'react';
import { useInput } from 'ink';

/**
 * 채팅 입력창이 열려 있으면 true. Ink의 useInput은 모든 핸들러에 모든 키를 뿌리므로, 채팅에
 * 'h'를 치는 순간 블랙잭의 hit이 나가는 식의 충돌을 이 잠금으로 막는다.
 */
export const InputLockContext = createContext(false);

/** 방 화면(로비·게임·결과)이 쓰는 useInput — 채팅 입력 중에는 키를 받지 않는다. */
export function useScreenInput(handler: Parameters<typeof useInput>[0]): void {
  const locked = useContext(InputLockContext);
  useInput(handler, { isActive: !locked });
}
