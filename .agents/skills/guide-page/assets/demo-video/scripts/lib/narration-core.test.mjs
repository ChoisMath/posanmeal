import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audioEndingFilter, checkEnding, checkSpeech, countChars, estimateSeconds, findUnreadable, isCached, lineKey, mergeStt, parseJsonLines, parseOnly,
  reviewFlag, sha1, spokenText, sttTargets, unknownKeys,
} from "./narration-core.mjs";

const NARRATION = [
  { id: "Intro", lines: ["ChoisNote 안내입니다.", "차례로 봅니다."] },
  { id: "PassWindow", lines: ["지금은 10시 10분입니다."] },
];

test("lineKey 는 장면-0부터 센 번호", () => {
  assert.equal(lineKey("Slug", 4), "Slug-4");
});

test("spokenText 는 SPOKEN 이 있으면 그것을, 없으면 원고를 쓴다", () => {
  const spoken = { "Intro-0": "초이스노트 안내입니다." };
  assert.equal(spokenText(spoken, "Intro", 0, "ChoisNote 안내입니다."), "초이스노트 안내입니다.");
  assert.equal(spokenText(spoken, "Intro", 1, "차례로 봅니다."), "차례로 봅니다.");
});

test("findUnreadable 은 숫자·영문이 남은 키만 돌려준다", () => {
  assert.deepEqual(findUnreadable(NARRATION, { "Intro-0": "초이스노트 안내입니다." }), ["PassWindow-0"]);
  assert.deepEqual(findUnreadable(NARRATION, { "Intro-0": "초이스노트 안내입니다.", "PassWindow-0": "지금은 열 시 십 분입니다." }), []);
});

test("countChars 는 공백을 뺀다", () => {
  assert.equal(countChars("설정 화면에서 탭을 엽니다."), 12);
});

test("checkSpeech 는 끊김·폭주를 거른다", () => {
  const text = "설정 화면에서 학급관리 탭을 엽니다."; // 16자
  assert.equal(checkSpeech(text, 2.6).ok, true);
  assert.equal(checkSpeech(text, 0.5).reason, "too-short");
  assert.equal(checkSpeech(text, 1.2).reason, "too-fast");
  assert.equal(checkSpeech(text, 7.0).reason, "too-slow");
});

test("checkEnding 은 원음 종료 RMS가 -60dB 이하일 때만 채택한다", () => {
  for (const rmsDb of [-60, -75, -100, -Infinity]) {
    assert.equal(checkEnding(rmsDb), true, String(rmsDb));
  }
  for (const rmsDb of [-59.999, -38, 0, 1, NaN, undefined, null, Infinity, "-75"]) {
    assert.equal(checkEnding(rmsDb), false, String(rmsDb));
  }
  assert.equal(checkEnding(-75, { maxRmsDb: -80 }), false);
  assert.equal(checkEnding(-80, { maxRmsDb: -80 }), true);
});

test("checkEnding 은 잘못된 임계값으로 원음을 통과시키지 않는다", () => {
  for (const maxRmsDb of [0, 1, NaN, Infinity, -Infinity, null, "-60"]) {
    assert.equal(checkEnding(-Infinity, { maxRmsDb }), false, String(maxRmsDb));
  }
});

test("isCached 는 문장·참조·모델·무음·페이드·후처리 버전이 같고 mp3가 있을 때만 참", () => {
  const entry = { textHash: sha1("가"), refHash: "r1", model: "m", trailing: 1, fade: 0.35, processing: "ending-v2" };
  const now = { ...entry };
  assert.equal(isCached(entry, now, true), true);
  assert.equal(isCached(entry, now, false), false);
  assert.equal(isCached(entry, { ...now, refHash: "r2" }, true), false);
  assert.equal(isCached(entry, { ...now, textHash: sha1("나") }, true), false);
  assert.equal(isCached(entry, { ...now, model: "m2" }, true), false);
  assert.equal(isCached(undefined, now, true), false);
  assert.equal(isCached(entry, { ...now, trailing: 0.7 }, true), false);
  assert.equal(isCached(entry, { ...now, fade: 0.5 }, true), false);
  assert.equal(isCached(entry, { ...now, processing: "ending-v3" }, true), false);
  for (const field of ["trailing", "fade", "processing"]) {
    const legacy = { ...entry };
    delete legacy[field];
    assert.equal(isCached(legacy, now, true), false, `missing ${field}`);
  }
});

test("estimateSeconds 는 초당 5.8자 + 꼬리 무음 + 페이드", () => {
  assert.equal(estimateSeconds("가".repeat(29), 1), 6.35);
  assert.equal(estimateSeconds("가".repeat(29), 0.5, 0.2), 5.7);
});

const SAMPLE_RATE = 24000;
const ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

const synthPcm = (duration, amplitudeAt) => {
  const pcm = Buffer.alloc(Math.round(duration * SAMPLE_RATE) * 2);
  for (let sample = 0; sample < pcm.length / 2; sample++) {
    const time = sample / SAMPLE_RATE;
    pcm.writeInt16LE(Math.round(amplitudeAt(time) * Math.sin(2 * Math.PI * 220 * time)), sample * 2);
  }
  return pcm;
};

const processPcm = (pcm, filter) => {
  const directory = mkdtempSync(join(tmpdir(), "posanmeal-audio-ending-"));
  try {
    const input = join(directory, "input.pcm");
    const output = join(directory, "output.pcm");
    writeFileSync(input, pcm);
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "1", "-i", input,
      "-af", filter, "-c:a", "pcm_s16le", "-f", "s16le", output,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    return readFileSync(output);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const rms = (pcm, start, end) => {
  const first = Math.round(start * SAMPLE_RATE);
  const last = Math.round(end * SAMPLE_RATE);
  let sum = 0;
  for (let sample = first; sample < last; sample++) sum += pcm.readInt16LE(sample * 2) ** 2;
  return Math.sqrt(sum / (last - first));
};

test("원음 마지막 20ms 검사는 소리 중 급종료와 자연 감쇠를 구분한다", {
  skip: ffmpegAvailable ? false : "ffmpeg 미설치: 실제 PCM 종료 검사 생략",
}, () => {
  const abrupt = processPcm(synthPcm(1, () => 12000), "anull");
  const natural = processPcm(synthPcm(1, (time) =>
    time < 0.4 ? 12000 : 12000 * Math.exp(-12 * (time - 0.4))), "anull");
  const abruptDb = 20 * Math.log10(rms(abrupt, 0.98, 1) / 32768);
  const naturalDb = 20 * Math.log10(rms(natural, 0.98, 1) / 32768);

  assert.ok(abruptDb > -20, String(abruptDb));
  assert.ok(naturalDb < -60, String(naturalDb));
  assert.equal(checkEnding(abruptDb), false);
  assert.equal(checkEnding(naturalDb), true);
});

test("오디오 후처리는 발화·1초 여유를 보존하고 이후 잔향을 점진적으로 줄인다", {
  skip: ffmpegAvailable ? false : "ffmpeg 미설치: 실제 PCM 후처리 검증 생략",
}, () => {
  const speech = 0.8;
  const fadeStart = speech + 1;
  const expectedDuration = fadeStart + 0.35;
  const original = synthPcm(expectedDuration + 0.4, (time) => time < speech ? 12000 : 200);
  const output = processPcm(original, audioEndingFilter(speech));
  assert.ok(Math.abs(output.length / 2 / SAMPLE_RATE - expectedDuration) <= 1 / SAMPLE_RATE);
  const unchangedBytes = Math.round(fadeStart * SAMPLE_RATE) * 2;
  assert.deepEqual(output.subarray(0, unchangedBytes), original.subarray(0, unchangedBytes));
  const earlyFadeRms = rms(output, fadeStart + 0.025, fadeStart + 0.075);
  const lateFadeRms = rms(output, fadeStart + 0.275, fadeStart + 0.325);
  assert.ok(lateFadeRms < earlyFadeRms * 0.2, `fade RMS ${earlyFadeRms} → ${lateFadeRms}`);
  assert.ok(rms(output, expectedDuration - 0.01, expectedDuration) <= 1);
});

test("원본에 꼬리가 없으면 발화 뒤 1초와 페이드 길이만큼 무음을 채운다", {
  skip: ffmpegAvailable ? false : "ffmpeg 미설치: 실제 PCM 후처리 검증 생략",
}, () => {
  const speech = 0.8;
  const original = synthPcm(speech, () => 12000);
  const output = processPcm(original, audioEndingFilter(speech));
  assert.ok(Math.abs(output.length / 2 / SAMPLE_RATE - (speech + 1.35)) <= 1 / SAMPLE_RATE);
  assert.deepEqual(output.subarray(0, original.length), original);
  assert.ok(output.subarray(original.length).every((byte) => byte === 0));
});

test("parseOnly 는 쉼표 목록을 Set 으로", () => {
  assert.deepEqual([...parseOnly("Slug-4, Seats-2")], ["Slug-4", "Seats-2"]);
  assert.equal(parseOnly(null), null);
});

test("sttTargets 는 similarity 가 없고 wav 가 있는 문장만 고른다", () => {
  const lines = [{ key: "A-0" }, { key: "A-1" }, { key: "A-2" }, { key: "A-3" }];
  const manifest = { "A-0": { similarity: 0.9 }, "A-1": {}, "A-2": { speech: 1 } };
  const hasWav = (key) => key !== "A-2";
  assert.deepEqual(sttTargets(lines, manifest, hasWav).map((l) => l.key), ["A-1"]);
});

test("reviewFlag 는 전사 없음 NOCHECK, 0.8 미만 CHECK", () => {
  assert.equal(reviewFlag({}), "NOCHECK");
  assert.equal(reviewFlag(undefined), "NOCHECK");
  assert.equal(reviewFlag({ similarity: 0.79 }), "CHECK");
  assert.equal(reviewFlag({ similarity: 0.8 }), "");
  assert.equal(reviewFlag({ similarity: 0 }), "CHECK");
});

test("unknownKeys 는 NARRATION 에 없는 --only 키를 돌려준다", () => {
  assert.deepEqual(unknownKeys(new Set(["Intro-1", "Intro-2", "Nope-0"]), NARRATION), ["Intro-2", "Nope-0"]);
  assert.deepEqual(unknownKeys(new Set(["PassWindow-0"]), NARRATION), []);
  assert.deepEqual(unknownKeys(null, NARRATION), []);
});

test("parseJsonLines 는 JSON 이 아닌 줄을 건너뛴다", () => {
  const stdout = 'Loading model...\n{"key":"A-0","similarity":0.9}\n{broken progress\n\n  {"refHash":"x"}  \n[1,2]\n';
  assert.deepEqual(parseJsonLines(stdout), [{ key: "A-0", similarity: 0.9 }, { refHash: "x" }]);
});

test("mergeStt 는 manifest 에 있는 key 행만 합친다", () => {
  const manifest = { "A-0": { speech: 1 } };
  mergeStt(manifest, [
    { key: "A-0", transcript: "가", similarity: 0.9 },
    { key: "Z-9", transcript: "나", similarity: 0.1 },
    { transcript: "다", similarity: 0.2 },
  ]);
  assert.deepEqual(manifest, { "A-0": { speech: 1, transcript: "가", similarity: 0.9 } });
});
