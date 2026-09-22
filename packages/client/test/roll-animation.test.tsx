import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { useRollAnimation, ROLL_MS } from '../src/ui/rollAnimation.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Probe({ rollKey }: { rollKey: string | null }) {
  const { rolling } = useRollAnimation(rollKey);
  return <Text>{rolling ? 'rolling' : 'settled'}</Text>;
}

describe('useRollAnimation', () => {
  it('처음 그릴 때는 굴리지 않는다(재접속·화면 진입 시 결과를 바로 보여준다)', async () => {
    const { lastFrame, unmount } = render(<Probe rollKey="a" />);
    await wait(30);
    expect(lastFrame()).toBe('settled');
    unmount();
  });

  it('key가 바뀌면 잠시 굴리다가 멈춘다', async () => {
    const { lastFrame, rerender, unmount } = render(<Probe rollKey="a" />);
    await wait(30);
    rerender(<Probe rollKey="b" />);
    await wait(30);
    expect(lastFrame()).toBe('rolling');
    await wait(ROLL_MS + 150);
    expect(lastFrame()).toBe('settled');
    unmount();
  });

  it('key가 null이 되거나 그대로면 굴리지 않는다', async () => {
    const { lastFrame, rerender, unmount } = render(<Probe rollKey="a" />);
    await wait(30);
    rerender(<Probe rollKey="a" />);
    await wait(30);
    expect(lastFrame()).toBe('settled');
    rerender(<Probe rollKey={null} />);
    await wait(30);
    expect(lastFrame()).toBe('settled');
    unmount();
  });
});
