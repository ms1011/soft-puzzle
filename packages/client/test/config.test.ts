import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { configPath, loadConfig, saveConfig } from '../src/config.js';

describe('config', () => {
  let dir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-puzzle-config-'));
    originalEnv = process.env.SOFT_PUZZLE_CONFIG;
    // 부모 디렉터리가 아직 없는 경로를 일부러 골라 자동 생성 여부도 함께 검증한다.
    process.env.SOFT_PUZZLE_CONFIG = path.join(dir, 'nested', '.soft-puzzle.json');
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SOFT_PUZZLE_CONFIG;
    else process.env.SOFT_PUZZLE_CONFIG = originalEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('configPath()는 SOFT_PUZZLE_CONFIG 환경변수를 매 호출마다 반영한다', () => {
    expect(configPath()).toBe(process.env.SOFT_PUZZLE_CONFIG);
    const other = path.join(dir, 'other.json');
    process.env.SOFT_PUZZLE_CONFIG = other;
    expect(configPath()).toBe(other);
  });

  it('환경변수가 없으면 홈 디렉터리의 .soft-puzzle.json을 가리킨다', () => {
    delete process.env.SOFT_PUZZLE_CONFIG;
    expect(configPath()).toBe(path.join(os.homedir(), '.soft-puzzle.json'));
  });

  it('파일이 없으면 loadConfig()는 빈 객체를 돌려준다', () => {
    expect(loadConfig()).toEqual({});
  });

  it('saveConfig 후 loadConfig로 닉네임을 복원한다(부모 디렉터리 자동 생성 포함)', () => {
    expect(fs.existsSync(path.dirname(configPath()))).toBe(false);
    saveConfig({ nickname: '테스트유저' });
    expect(loadConfig()).toEqual({ nickname: '테스트유저' });
  });

  it('saveConfig는 임시 파일을 남기지 않는다', () => {
    saveConfig({ nickname: '홍길동' });
    const files = fs.readdirSync(path.dirname(configPath()));
    expect(files).toEqual(['.soft-puzzle.json']);
  });

  it('빈 파일이면 {}를 돌려준다', () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), '');
    expect(loadConfig()).toEqual({});
  });

  it('잘못된 JSON이면 {}를 돌려준다', () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), '{ 이건 JSON이 아님');
    expect(loadConfig()).toEqual({});
  });

  it('최상위 값이 배열이면 {}를 돌려준다', () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), '[1,2,3]');
    expect(loadConfig()).toEqual({});
  });

  it('최상위 값이 문자열이면 {}를 돌려준다', () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), '"그냥 문자열"');
    expect(loadConfig()).toEqual({});
  });

  it('최상위 값이 null이면 {}를 돌려준다', () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), 'null');
    expect(loadConfig()).toEqual({});
  });

  it('nickname 필드가 문자열이 아니면 {}를 돌려준다', () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ nickname: 123 }));
    expect(loadConfig()).toEqual({});
  });

  it('읽기 권한이 없는 파일이면 {}를 돌려준다', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return; // root는 파일 권한을 무시하므로 이 환경에서는 검증 불가
    }
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ nickname: '안읽힘' }));
    fs.chmodSync(configPath(), 0o000);
    try {
      expect(loadConfig()).toEqual({});
    } finally {
      fs.chmodSync(configPath(), 0o644);
    }
  });
});
