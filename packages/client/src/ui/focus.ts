import { useEffect, useRef } from 'react';
import type { ServerMsg } from '@soft-puzzle/core';

/** 다른 참가자의 확정 전 커서. 닉네임 → 게임별 target. */
export type FocusMap = Record<string, unknown>;

/** 커서를 보내는 최소 간격. 키를 꾹 눌러도 초당 10개를 넘지 않는다(서버 한도 20개). */
export const FOCUS_INTERVAL_MS = 100;

/**
 * 서버 메시지로 FocusMap을 갱신한다. state가 오면 전부 지운다 — 행동이 확정되거나 차례가 넘어가면
 * 항상 새 state가 오므로 오래된 커서가 남지 않는다(아직 고르는 사람은 다시 보낸다).
 */
export function reduceFocus(map: FocusMap, msg: ServerMsg): FocusMap {
  if (msg.type === 'state') return Object.keys(map).length === 0 ? map : {};
  if (msg.type !== 'focus') return map;
  if (msg.target === null) {
    const { [msg.from]: _removed, ...rest } = map;
    return rest;
  }
  return { ...map, [msg.from]: msg.target };
}

/**
 * 내가 지금 고르고 있는 것(target)을 서버로 보낸다. target이 바뀌면 FOCUS_INTERVAL_MS에 한 번,
 * 마지막 값은 반드시 보낸다. 새 view(state)가 오면 null이 아닌 target을 다시 보낸다 — 새 state를
 * 받은 다른 참가자들이 커서 표시를 지웠기 때문이다. 화면이 닫히면 보낸 적 있을 때 null을 보낸다.
 */
export function useFocusBroadcast(
  sendFocus: ((target: unknown) => void) | undefined,
  target: unknown,
  view: unknown,
): void {
  const key = JSON.stringify(target ?? null);
  const sendRef = useRef(sendFocus);
  sendRef.current = sendFocus;
  const lastSent = useRef('null');
  const lastTime = useRef(-Infinity);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = (): void => {
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    lastSent.current = next;
    lastTime.current = Date.now();
    sendRef.current?.(JSON.parse(next));
  };

  const schedule = (next: string, force: boolean): void => {
    if (!force && next === lastSent.current && pending.current === null) return;
    pending.current = next;
    if (timer.current !== null) return;
    const wait = FOCUS_INTERVAL_MS - (Date.now() - lastTime.current);
    if (wait <= 0) flush();
    else timer.current = setTimeout(flush, wait);
  };

  useEffect(() => schedule(key, false), [key]);
  // key 변화는 위 effect가 맡는다 — 여기서는 view가 "바뀌었을 때만" 다시 보낸다. 첫 마운트에도 이
  // effect가 돌기 때문에, 이전 view와 비교하지 않으면 처음 값을 두 번 보낸다.
  const prevView = useRef(view);
  useEffect(() => {
    if (prevView.current === view) return;
    prevView.current = view;
    if (key !== 'null') schedule(key, true);
  }, [view]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (lastSent.current !== 'null') sendRef.current?.(null);
    },
    [],
  );
}
