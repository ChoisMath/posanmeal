import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Human, Result } from "@vladmandic/human";

const { createHuman } = vi.hoisted(() => ({ createHuman: vi.fn() }));
vi.mock("client-only", () => ({}));
vi.mock("@vladmandic/human", () => ({
  Human: class {
    constructor(config: unknown) { return createHuman(config); }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function video() {
  return { readyState: 4, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
}

function result(id = 0): Result {
  return { face: id ? [{ embedding: [id], box: [0, 0, 100, 100], score: 1 }] : [] } as unknown as Result;
}

function mockHuman(detect: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(result())) {
  return {
    detect,
    load: vi.fn().mockResolvedValue(undefined),
    warmup: vi.fn().mockResolvedValue(undefined),
    models: { loaded: () => ["blazeface", "facemesh", "insightface", "antispoof", "liveness"] },
    tf: { getBackend: () => "webgl" },
  } as unknown as Human;
}

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); createHuman.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function flush() { await vi.advanceTimersByTimeAsync(0); }

describe("global Human operation ownership", () => {
  it("keeps the raw detect lock after timeout and drops expired queued frames", async () => {
    const { detectFaces } = await import("@/lib/human-client");
    const raw = deferred<Result>();
    const human = mockHuman(vi.fn().mockReturnValueOnce(raw.promise).mockResolvedValue(result(2)));
    const first = detectFaces(human, video()).catch((error: Error) => error);
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await first).toBeInstanceOf(Error);
    const staleVideo = video();
    const expired = detectFaces(human, staleVideo).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await expired).toBeInstanceOf(Error);
    expect(human.detect).toHaveBeenCalledTimes(1);
    const newVideo = video();
    const current = detectFaces(human, newVideo);
    raw.resolve(result(1));
    expect(await current).toMatchObject({ kind: "face", face: { embedding: [2] } });
    expect(human.detect).toHaveBeenCalledTimes(2);
    expect(human.detect).toHaveBeenLastCalledWith(newVideo);
  });

  it("aborts callers promptly without releasing an in-flight raw detect", async () => {
    const { detectFaces } = await import("@/lib/human-client");
    const raw = deferred<Result>();
    const human = mockHuman(vi.fn().mockReturnValueOnce(raw.promise).mockResolvedValue(result(2)));
    const firstAbort = new AbortController();
    const first = detectFaces(human, video(), firstAbort.signal).catch((error: Error) => error);
    await flush();
    firstAbort.abort();
    expect(await first).toMatchObject({ name: "AbortError" });
    const secondAbort = new AbortController();
    const second = detectFaces(human, video(), secondAbort.signal).catch((error: Error) => error);
    secondAbort.abort();
    expect(await second).toMatchObject({ name: "AbortError" });
    const newVideo = video();
    const third = detectFaces(human, newVideo);
    await flush();
    expect(human.detect).toHaveBeenCalledTimes(1);
    raw.resolve(result(1));
    expect(await third).toMatchObject({ kind: "face", face: { embedding: [2] } });
    expect(human.detect).toHaveBeenCalledTimes(2);
    expect(human.detect).toHaveBeenLastCalledWith(newVideo);
  });

  it("rejects a pre-aborted request without analyzing its video", async () => {
    const { detectFaces } = await import("@/lib/human-client");
    const human = mockHuman();
    const controller = new AbortController();
    controller.abort();
    await expect(detectFaces(human, video(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(human.detect).not.toHaveBeenCalled();
  });

  it("checks video readiness again when its queued turn begins", async () => {
    const { detectFaces } = await import("@/lib/human-client");
    const raw = deferred<Result>();
    const human = mockHuman(vi.fn().mockReturnValueOnce(raw.promise).mockResolvedValue(result(2)));
    const first = detectFaces(human, video());
    const stoppedVideo = video();
    const queued = detectFaces(human, stoppedVideo);
    await flush();
    Object.assign(stoppedVideo, { readyState: 0, videoWidth: 0, videoHeight: 0 });
    raw.resolve(result());
    await first;
    expect(await queued).toEqual({ kind: "none" });
    expect(human.detect).toHaveBeenCalledTimes(1);
  });

  it("does not construct or load a backend while raw detect is running", async () => {
    const { detectFaces, loadHuman } = await import("@/lib/human-client");
    const raw = deferred<Result>();
    const human = mockHuman(vi.fn().mockReturnValue(raw.promise));
    const detection = detectFaces(human, video()).catch((error: Error) => error);
    await flush();
    const next = mockHuman();
    createHuman.mockReturnValue(next);
    const loading = loadHuman(["webgl"]);
    await flush();
    expect(createHuman).not.toHaveBeenCalled();
    raw.resolve(result());
    await detection;
    expect(await loading).toBe(next);
    expect(next.warmup).toHaveBeenCalledTimes(1);
  });

  it("keeps fallback load behind the timed-out backend until load and warmup settle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { loadHuman } = await import("@/lib/human-client");
    const rawLoad = deferred<void>();
    const rawWarmup = deferred<void>();
    const first = mockHuman();
    vi.mocked(first.load).mockReturnValue(rawLoad.promise as ReturnType<Human["load"]>);
    vi.mocked(first.warmup).mockReturnValue(rawWarmup.promise as ReturnType<Human["warmup"]>);
    const second = mockHuman();
    createHuman.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const loading = loadHuman(["webgpu", "webgl"]);
    await flush();
    await vi.advanceTimersByTimeAsync(90000);
    expect(createHuman).toHaveBeenCalledTimes(1);
    rawLoad.resolve();
    await flush();
    expect(first.warmup).toHaveBeenCalledTimes(1);
    expect(createHuman).toHaveBeenCalledTimes(1);
    rawWarmup.resolve();
    expect(await loading).toBe(second);
    expect(createHuman).toHaveBeenCalledTimes(2);
  });
});
