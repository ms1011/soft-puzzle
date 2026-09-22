import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { ChatPanel } from '../src/ui/ChatPanel.js';
import type { ChatLine } from '../src/ui/ChatPanel.js';
import { InputLockContext, useScreenInput } from '../src/ui/inputLock.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

const TAB = '\t';
const ESC = '\x1B';

const LINES: ChatLine[] = [
  { from: '철수', text: '안녕', channel: 'all' },
  { from: '영희', text: '누구 죽일까', channel: 'mafia' },
  { from: '민수', text: '억울하다', channel: 'dead' },
];

function Harness({ canSend = true, onSend = () => {} }: { canSend?: boolean; onSend?: (text: string) => void }): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <ChatPanel
      lines={LINES}
      open={open}
      canSend={canSend}
      channel="all"
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onSend={onSend}
    />
  );
}

describe('ChatPanel', () => {
  it('채널별 태그를 붙여 채팅을 보여주고, 닫혀 있으면 Tab 안내를 보인다', () => {
    const { lastFrame, unmount } = render(<Harness />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('철수: 안녕');
    expect(frame).toContain('[마피아] 영희: 누구 죽일까');
    expect(frame).toContain('[탈락자] 민수: 억울하다');
    expect(frame).toContain('[Tab] 채팅');
    unmount();
  });

  it('Tab으로 열고 입력 후 Enter로 보내면 입력창이 비워진 채 열려 있고, Esc로 닫힌다', async () => {
    const onSend = vi.fn();
    const { stdin, lastFrame, unmount } = render(<Harness onSend={onSend} />);
    await tick();
    stdin.write(TAB);
    await tick();
    expect(lastFrame() ?? '').toContain('Enter 전송');

    stdin.write('ㄱㄱ');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSend).toHaveBeenCalledWith('ㄱㄱ');
    expect(lastFrame() ?? '').toContain('Enter 전송');

    stdin.write('\r'); // 빈 입력은 보내지 않는다
    await tick();
    expect(onSend).toHaveBeenCalledTimes(1);

    stdin.write(ESC);
    await tick();
    expect(lastFrame() ?? '').toContain('[Tab] 채팅');
    unmount();
  });

  it('side 배치에서는 "채팅" 제목이 붙은 테두리 패널로 그린다', () => {
    const { lastFrame, unmount } = render(
      <ChatPanel lines={LINES} open={false} canSend channel="all" layout="side" onOpen={() => {}} onClose={() => {}} onSend={() => {}} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('채팅');
    expect(frame).toMatch(/[╭┌+]/);
    expect(frame).toContain('철수: 안녕');
    unmount();
  });

  it('채팅할 수 없는 단계면 안내를 보이고 Tab을 무시한다', async () => {
    const { stdin, lastFrame, unmount } = render(<Harness canSend={false} />);
    expect(lastFrame() ?? '').toContain('지금은 채팅할 수 없습니다');
    await tick();
    stdin.write(TAB);
    await tick();
    expect(lastFrame() ?? '').not.toContain('Enter 전송');
    unmount();
  });
});

describe('useScreenInput', () => {
  function Probe({ onKey }: { onKey: (input: string) => void }): React.JSX.Element {
    useScreenInput((input) => onKey(input));
    return <Text>probe</Text>;
  }

  it('잠금 중에는 화면 키 입력을 받지 않는다', async () => {
    const onKey = vi.fn();
    const { stdin, rerender, unmount } = render(
      <InputLockContext.Provider value={true}>
        <Probe onKey={onKey} />
      </InputLockContext.Provider>,
    );
    await tick();
    stdin.write('h');
    await tick();
    expect(onKey).not.toHaveBeenCalled();

    rerender(
      <InputLockContext.Provider value={false}>
        <Probe onKey={onKey} />
      </InputLockContext.Provider>,
    );
    await tick();
    stdin.write('h');
    await tick();
    expect(onKey).toHaveBeenCalledWith('h');
    unmount();
  });
});
