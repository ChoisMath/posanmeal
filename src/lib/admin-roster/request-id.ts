/**
 * 같은 작업의 재시도는 같은 요청키로, 다른 작업은 새 요청키로 보내기 위한 최소
 * 상태. 응답을 못 받은 반영을 다시 누를 때 서버가 "같은 요청"으로 알아보려면
 * 요청키가 그대로여야 하고, 대상이 하나라도 바뀌면 달라져야 한다.
 */
export type RequestIdSlot = { key: string; requestId: string };

export function newRequestId(): string {
  const globalCrypto = globalThis.crypto as Crypto | undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }
  // randomUUID가 없는 브라우저(구형 iPad 키오스크 등)에서도 충돌 확률이 충분히
  // 낮은 값이면 된다 — 서버는 이 값을 신뢰하지 않고 중복만 판정한다.
  const random = Math.random().toString(36).slice(2);
  return `req-${Date.now().toString(36)}-${random}`;
}

/**
 * `key`가 그대로면 이전 요청키를 재사용하고, 달라지면 새로 만든다.
 * 호출자는 돌려받은 슬롯을 그대로 보관했다가 다음 호출에 다시 넘긴다.
 */
export function requestIdFor(
  previous: RequestIdSlot | null,
  key: string,
  generate: () => string = newRequestId,
): RequestIdSlot {
  if (previous && previous.key === key) return previous;
  return { key, requestId: generate() };
}
