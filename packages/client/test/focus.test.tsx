import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { reduceFocus, useFocusBroadcast, FOCUS_INTERVAL_MS } from '../src/ui/focus.js';

describe('reduceFocus', () => {
  it('focus는 보낸 사람별로 저장하고, target null이면 지운다', () => {
    const a = reduceFocus({}, { type: 'focus', from: '영희', target: { index: 1 } });
    expect(a).toEqual({ 영희: { index: 1 } });
    expect(reduceFocus(a, { type: 'focus', from: '영희', target: null })).toEqual({});
  });

  it('state를 받으면 전부 지운다', () => {
    const map = { 영희: { index: 1 } };
    expect(reduceFocus(map, { type: 'state', phase: 'lobby', room: { name: 'r', game: 'onecard', host: 'a', players: [] } })).toEqual({});
  });

  it('다른 메시지는 그대로 둔다', () => {
    const map = { 영희: { index: 1 } };
    expect(reduceFocus(map, { type: 'event', text: 'x' })).toBe(map);
  });
});

function Probe({ send, target, view }: { send: (t: unknown) => void; target: unknown; view: unknown }) {
  useFocusBroadcast(send, target, view);
  return <Text>probe</Text>;
}

// 실제 타이머로 검증한다 — 가짜 타이머로는 Ink/React의 passive effect가 다음 렌더까지 실행되지 않아
// 훅이 실제로 하는 일을 볼 수 없다.
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const AFTER_INTERVAL = FOCUS_INTERVAL_MS + 50;

describe('useFocusBroadcast', () => {
  it('처음 값은 바로 보내고, 간격 안의 연속 변경은 마지막 값 하나로 합친다', async () => {
    const send = vi.fn();
    const view = {};
    const { rerender, unmount } = render(<Probe send={send} target={{ index: 0 }} view={view} />);
    await wait(20);
    expect(send.mock.calls).toEqual([[{ index: 0 }]]);
    // 대기 없이 연달아 바꾼다 — 사이에 기다리면 부하가 걸린 CI에서 간격(100ms)을 넘겨 버린다.
    rerender(<Probe send={send} target={{ index: 1 }} view={view} />);
    rerender(<Probe send={send} target={{ index: 2 }} view={view} />);
    expect(send).toHaveBeenCalledTimes(1);
    await wait(AFTER_INTERVAL);
    expect(send.mock.calls).toEqual([[{ index: 0 }], [{ index: 2 }]]);
    unmount();
  });

  it('새 view가 오면 같은 값이라도 다시 보낸다', async () => {
    const send = vi.fn();
    const { rerender, unmount } = render(<Probe send={send} target={{ index: 0 }} view={{ n: 1 }} />);
    await wait(AFTER_INTERVAL);
    rerender(<Probe send={send} target={{ index: 0 }} view={{ n: 2 }} />);
    await wait(AFTER_INTERVAL);
    expect(send.mock.calls).toEqual([[{ index: 0 }], [{ index: 0 }]]);
    unmount();
  });

  it('null로 바뀌면 null을 보내고, null인 채로는 새 view가 와도 보내지 않는다', async () => {
    const send = vi.fn();
    const { rerender, unmount } = render(<Probe send={send} target={{ index: 0 }} view={{ n: 1 }} />);
    await wait(AFTER_INTERVAL);
    rerender(<Probe send={send} target={null} view={{ n: 1 }} />);
    await wait(AFTER_INTERVAL);
    rerender(<Probe send={send} target={null} view={{ n: 2 }} />);
    await wait(AFTER_INTERVAL);
    expect(send.mock.calls).toEqual([[{ index: 0 }], [null]]);
    unmount();
  });

  it('보낸 적 있으면 화면이 닫힐 때 null을 보낸다', async () => {
    const send = vi.fn();
    const { unmount } = render(<Probe send={send} target={{ index: 0 }} view={{}} />);
    await wait(20);
    unmount();
    await wait(20); // Ink는 unmount 정리(effect cleanup)를 비동기로 실행한다.
    expect(send.mock.calls.at(-1)).toEqual([null]);
  });
});
