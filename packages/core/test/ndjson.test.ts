import { it, expect } from 'vitest';
import { encodeMsg, NdjsonDecoder } from '../src/ndjson.js';
it('쪼개진 청크를 이어붙여 메시지 단위로 파싱한다', () => {
  const d = new NdjsonDecoder();
  expect(d.push('{"type":"jo')).toEqual([]);
  expect(d.push('in","nickname":"철수"}\n{"type":"chat"')).toEqual([
    { type: 'join', nickname: '철수' },
  ]);
  expect(d.push(',"text":"ㄱㄱ"}\n')).toEqual([{ type: 'chat', text: 'ㄱㄱ' }]);
});
it('깨진 JSON 줄은 무시한다', () => {
  const d = new NdjsonDecoder();
  expect(d.push('not-json\n{"type":"chat","text":"hi"}\n'))
    .toEqual([{ type: 'chat', text: 'hi' }]);
});
it('encodeMsg는 개행으로 끝난다', () => {
  expect(encodeMsg({ a: 1 })).toBe('{"a":1}\n');
});
