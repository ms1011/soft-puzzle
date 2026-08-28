import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ClientConfig {
  nickname?: string;
}

/**
 * 설정 파일 경로. 환경변수 SOFT_PUZZLE_CONFIG가 있으면 그 값을, 없으면
 * ~/.soft-puzzle.json을 매 호출마다 다시 계산해서 돌려준다 — 상수로 한 번만 계산해 캐싱하면
 * 테스트가 임시 경로로 리다이렉트할 방법이 없어진다(모듈은 프로세스당 한 번만 로드된다).
 */
export function configPath(): string {
  return process.env.SOFT_PUZZLE_CONFIG ?? path.join(os.homedir(), '.soft-puzzle.json');
}

/**
 * 설정 파일을 읽는다. 파일이 없거나, 비어 있거나, 읽을 수 없거나(권한 등), JSON이 깨졌거나,
 * 최상위 값이 객체가 아니거나(배열/문자열/null 등), nickname 필드가 문자열이 아니면 그냥 빈
 * 객체를 돌려준다 — 홈 디렉터리의 깨진 설정 파일 때문에 시작조차 못 하는 사고를 막는다.
 */
export function loadConfig(): ClientConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath(), 'utf8');
  } catch {
    return {};
  }
  if (raw.trim().length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const nickname = (parsed as Record<string, unknown>).nickname;
  if (typeof nickname !== 'string') return {};
  return { nickname };
}

/**
 * 설정 파일을 저장한다. 임시 파일에 쓴 뒤 원자적으로 rename해서, 쓰는 도중 프로세스가 죽어도
 * 기존 파일이 반쯤 잘린 상태로 남지 않게 한다(rename은 같은 파일시스템 안에서 원자적이다).
 * 부모 디렉터리가 없으면 만든다.
 */
export function saveConfig(cfg: { nickname: string }): void {
  const target = configPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg));
  fs.renameSync(tmp, target);
}
