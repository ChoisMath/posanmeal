import * as db from "@/lib/local-db";
import { applyKioskSnapshot, readKioskDownload } from "@/lib/kiosk-sync";
import { runLocalQrCheckIn } from "@/lib/qr-checkin-local";
import { runLocalFaceCheckIn, toFaceCandidates } from "@/lib/facecheck-local";
import { toLocalCheckInRow } from "@/components/LocalCheckInsTable";
import { buildLocalCheckInsCsv } from "@/lib/local-checkins-export";
import { clearClientBrowserState } from "@/lib/clearClientState";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ForceResetDialog } from "@/components/ForceResetDialog";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const checkin = (userId = 1): db.StoredLocalCheckIn => ({ userId, date: "2027-02-28", mealKind: "LUNCH", checkedAt: "2027-02-28T03:20:42Z", type: "STUDENT", synced: 0, rawLegacy: { original: "원본" } });
async function rawRecords() {
  const conn = await db.openDB();
  return new Promise<db.StoredLocalCheckIn[]>((resolve, reject) => {
    const tx = conn.transaction("checkins", "readonly"); const req = tx.objectStore("checkins").getAll();
    tx.oncomplete = () => { resolve(req.result); conn.close(); }; tx.onerror = () => reject(tx.error);
  });
}
async function insert(row: db.StoredLocalCheckIn) {
  const conn = await db.openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = conn.transaction("checkins", "readwrite"); tx.objectStore("checkins").put(row);
    tx.oncomplete = () => { resolve(); conn.close(); }; tx.onerror = () => reject(tx.error);
  });
}
const profiles = [
  { userId: 1, year: 2026, role: "STUDENT", name: "과거이름", grade: 1, classNum: 1, number: 1, memberState: "ENROLLED" },
  { userId: 1, year: 2027, role: "STUDENT", name: "새이름", grade: 2, classNum: 3, number: 4, memberState: "ENROLLED" },
];
const windows = { breakfast: { start: "00:00", end: "00:00" }, lunch: { start: "00:00", end: "23:59" }, dinner: { start: "00:00", end: "00:00" } };
const download = (nextProfiles = profiles) => readKioskDownload({
  operationMode: "local", users: [{ id: 1, name: "현재이름", role: "STUDENT", grade: 3, classNum: 9, number: 9 }],
  eligibleEntries: ["2027-02-28", "2027-03-01"].map((date) => ({ userId: 1, date, mealKind: "LUNCH" })),
  snapshot: { id: "february", version: 1, activeYear: 2027, lastEligibilityEventId: 1, issuedAt: "2027-02-20T00:00:00Z", freshUntil: "2027-02-20T15:00:00Z", coversUntil: "2027-03-05", users: [{ userId: 1, role: "STUDENT", accessState: "ACTIVE", accessEventId: 1 }], eligible: [], profiles: nextProfiles },
});
const repo = { getSetting: db.getSetting, getUser: db.getUser, isEligible: db.isEligible, getCheckIn: db.getCheckIn, addCheckIn: db.addCheckIn, getSnapshotState: db.getLocalSnapshotState, getDeviceId: db.getDeviceId };
export async function run() {
  const results: Array<{ name: string; passed: boolean; error?: string }> = [];
  async function test(name: string, body: () => Promise<void>) {
    try { await db.clearAllData(); await Promise.race([body(), new Promise((_, reject) => setTimeout(() => reject(new Error("Browser assertion timed out")), 5000))]); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); }
  }
  await test("내보내기 뒤 다른 연결의 새 미전송은 초기화와 함께 삭제되지 않는다", async () => {
    await insert(checkin()); const exported = await db.getReviewableCheckIns();
    await insert(checkin(2));
    let blocked = false;
    try { await db.forceClearLocalData({ exported, typed: "초기화" }); } catch { blocked = true; }
    assert(blocked, "재내보내기 요구 없이 초기화됨");
    assert((await rawRecords()).length === 2, "미전송 원본 유실");
  });
  await test("내보낸 동일 PK의 원본 변경도 차단한다", async () => {
    await insert(checkin()); const exported = await db.getReviewableCheckIns();
    await insert({ ...exported[0], checkedAt: "2027-02-28T03:21:42Z" });
    let blocked = false;
    try { await db.forceClearLocalData({ exported, typed: "초기화" }); } catch { blocked = true; }
    assert(blocked, "변경된 원본을 초기화함");
    assert((await rawRecords())[0]?.checkedAt === "2027-02-28T03:21:42Z", "변경 원본 유실");
  });
  await test("다시 내보낸 전체 범위와 문구가 맞으면 전체 초기화한다", async () => {
    await insert(checkin()); await insert(checkin(2)); await db.setSetting("keep", "setting");
    const exported = await db.getReviewableCheckIns();
    await db.forceClearLocalData({ exported, typed: "초기화" });
    assert((await rawRecords()).length === 0 && await db.getSetting("keep") === undefined, "정상 초기화 실패");
  });
  await test("내보내기 뒤 추가된 확정 거절도 다시 내보내기 전에는 보존한다", async () => {
    await insert(checkin()); const exported = await db.getReviewableCheckIns();
    await insert({ ...checkin(2), synced: 1, terminal: "REJECTED", acknowledgedAt: "2027-03-01T00:00:00Z" });
    let blocked = false;
    try { await db.forceClearLocalData({ exported, typed: "초기화" }); } catch { blocked = true; }
    assert(blocked && (await rawRecords()).length === 2, "백업 없는 확정 거절 유실");
  });
  await test("snapshot profiles를 users와 같은 트랜잭션에서 저장한다", async () => {
    const conn = await db.openDB();
    const snapshot = { id: "february", version: 1, activeYear: 2027, lastEligibilityEventId: 1, issuedAt: "2027-02-20T00:00:00Z", freshUntil: "2027-02-20T15:00:00Z", coversUntil: "2027-03-05", users: [{ userId: 1, role: "STUDENT", accessState: "ACTIVE", accessEventId: 1 }], eligible: [], profiles: [{ userId: 1, year: 2026, role: "STUDENT", name: "과거이름", grade: 1, classNum: 1, number: 1, memberState: "ENROLLED" }] };
    await applyKioskSnapshot(conn, readKioskDownload({ operationMode: "local", users: [{ id: 1, name: "현재이름", role: "STUDENT", grade: 2, classNum: 3, number: 4 }], snapshot }));
    const stored = await db.getSetting("snapshotProfiles");
    assert(stored && JSON.parse(stored)[0].name === "과거이름", "학년도 프로필이 저장되지 않음");
    conn.close();
  });
  await test("실제 QR/얼굴 저장 및 CSV는 2월/3월 학년도별 표시를 유지한다", async () => {
    const conn = await db.openDB(); await applyKioskSnapshot(conn, download());
    await db.setServerActiveYear(2027);
    const feb = new Date("2027-02-28T03:20:42Z"), mar = new Date("2027-03-01T03:20:42Z");
    const qr = await runLocalQrCheckIn({ data: "posanmeal:1:3:STUDENT", now: feb, mealWindows: windows }, repo, () => feb);
    assert(qr.success && qr.user?.name === "과거이름" && qr.user.grade === 1, "QR 학년도 표시 오류");
    const face = await runLocalFaceCheckIn({ embedding: [1, 0], candidates: toFaceCandidates([{ userId: 1, embeddings: [[1, 0]] }]), faceMatch: { threshold: 0.55, margin: 0.05 }, now: mar, mealWindows: windows, confirmation: { userId: 1, date: "2027-03-01", mealKind: "LUNCH" } }, repo, () => mar);
    assert(face.success && face.user?.name === "새이름" && face.user.grade === 2, "얼굴 학년도 표시 오류");
    const original = await rawRecords();
    await applyKioskSnapshot(conn, download([{ ...profiles[1], name: "또바뀐이름", grade: 3 }]));
    const after = await db.getReviewableCheckIns();
    assert(after[0].id === original[0].id && after[0].checkedAt === original[0].checkedAt && after[0].snapshotId === original[0].snapshotId && after[0].deviceId === original[0].deviceId, "동기화가 원본 식별자/시각 변경");
    const rows = after.map((row) => toLocalCheckInRow(row, undefined));
    assert(rows[0].userLabel === "1-1-1" && rows[1].userLabel === "2-3-4", "재동기화가 과거 표시 변경");
    const csv = await buildLocalCheckInsCsv(rows).text();
    assert(csv.includes("과거이름") && csv.includes("새이름") && !csv.includes("또바뀐이름"), "CSV 과거 표시 누락");
    conn.close();
  });
  await test("구버전 미전송은 명부 교체 전에 과거 프로필만 고정하고 원본을 보존한다", async () => {
    const conn = await db.openDB(); await applyKioskSnapshot(conn, download());
    await insert({ ...checkin(), id: 88, snapshotId: "february", reviewId: "pending-review" });
    await db.replaceAllFaceProfiles([{ userId: 1, embeddings: [[1, 0]] }]);
    await applyKioskSnapshot(conn, download([profiles[1]]));
    const [after] = await db.getReviewableCheckIns();
    assert(after.id === 88 && after.displayProfile?.grade === 1 && after.displayProfile?.name === "과거이름", "이전 프로필 미보존");
    assert(JSON.stringify(after.rawLegacy) === '{"original":"원본"}' && after.checkedAt === "2027-02-28T03:20:42Z" && after.reviewId === "pending-review", "원본 변경");
    assert((await db.getAllFaceProfiles()).length === 1, "얼굴 미포함 재동기화가 후보 삭제"); conn.close();
  });
  await test("PREPARING 구버전 미전송은 당시 User를 고정하고 READY 결측은 null로 남긴다", async () => {
    await db.replaceAllUsers([{ id: 1, name: "이전호환이름", role: "STUDENT", grade: 1, classNum: 2, number: 3 }]);
    await insert(checkin());
    const conn = await db.openDB(); await applyKioskSnapshot(conn, download([]));
    assert((await db.getReviewableCheckIns())[0].displayProfile?.name === "이전호환이름", "PREPARING 호환명부 변경");
    await insert({ ...checkin(2), snapshotId: "missing", id: 99 });
    await applyKioskSnapshot(conn, download());
    const missing = (await db.getReviewableCheckIns()).find((row) => row.id === 99)!;
    assert(missing.displayProfile === null, "READY 결측을 현재 명부로 대체");
    assert(toLocalCheckInRow(missing, { id: 2, name: "현재", role: "STUDENT", grade: 3 }).name === "-", "null이 현재 이름으로 대체"); conn.close();
  });
  await test("명부 적용 실패는 profiles/users/미전송 표시정보를 함께 rollback한다", async () => {
    const conn = await db.openDB(); await applyKioskSnapshot(conn, download());
    await insert({ ...checkin(), snapshotId: "february" });
    const before = JSON.stringify(await rawRecords());
    const broken = download([profiles[1]]); broken.users = [{ name: "잘못된키" } as db.LocalUser];
    let rejected = false; try { await applyKioskSnapshot(conn, broken); } catch { rejected = true; }
    assert(rejected, "반쪽 명부가 적용됨");
    assert(JSON.stringify(await rawRecords()) === before, "실패한 적용이 체크인 변경");
    assert((await db.getUser(1))?.name === "현재이름" && (await db.getSetting("snapshotProfiles"))?.includes("과거이름"), "실패한 적용이 users/profiles 변경"); conn.close();
  });
  await test("최종 초기화와 동시 삽입은 새 원본 보존 또는 재내보내기로 귀결된다", async () => {
    await insert(checkin()); const exported = await db.getReviewableCheckIns();
    const attempts = await Promise.allSettled([db.forceClearLocalData({ exported, typed: "초기화" }), insert(checkin(2))]);
    assert(attempts[1].status === "fulfilled", "삽입 실패");
    assert((await rawRecords()).some((row) => row.userId === 2), "동시 체크인 원본 유실");
  });
  await test("빈 목록 일반 초기화도 검사 뒤 추가된 기록을 지우지 않는다", async () => {
    await insert(checkin()); let rejected = false;
    try { await db.clearAllData({ exported: [], scope: "PENDING" }); } catch { rejected = true; }
    assert(rejected && (await rawRecords()).length === 1, "빈 목록 확인 뒤 새 기록 유실");
  });
  await test("날짜와 시각이 불명인 legacy 원본도 목록/재동기화/백업을 막지 않는다", async () => {
    const conn = await db.openDB(); await applyKioskSnapshot(conn, download());
    await insert({ ...checkin(), date: "알 수 없음", checkedAt: "시각 불명", mealKind: undefined, snapshotId: "old" });
    const before = await db.getReviewableCheckIns();
    assert(before[0].displayProfile === null, "날짜 불명에 현재 프로필 적용");
    await applyKioskSnapshot(conn, download([profiles[1]]));
    const after = await db.getReviewableCheckIns();
    const csv = await buildLocalCheckInsCsv(after.map((row) => toLocalCheckInRow(row, undefined))).text();
    assert(csv.includes("알 수 없음") && csv.includes("시각 불명") && csv.includes("원본"), "불명 원본 내보내기 누락");
    await db.forceClearLocalData({ exported: after, typed: "초기화" });
    assert((await rawRecords()).length === 0, "백업 후 초기화 실패"); conn.close();
  });
  await test("로그아웃 미전송 0건은 모든 내용만 원자 clear하고 새 연결의 기록은 보존한다", async () => {
    await db.setSetting("marker", "before"); await db.replaceAllUsers([{ id: 1, name: "현재", role: "STUDENT" }]);
    await db.replaceAllFaceProfiles([{ userId: 1, embeddings: [[1, 0]] }]);
    await insert({ ...checkin(), synced: 1, terminal: "REJECTED" });
    assert((await clearClientBrowserState()).keptCheckIns === 0, "완료된 기록이 로그아웃을 막음");
    assert((await rawRecords()).length === 0 && !await db.getSetting("marker") && !await db.getUser(1) && !(await db.getAllFaceProfiles()).length, "0건 로그아웃 내용 미정리");
    await insert(checkin(2)); assert((await rawRecords()).length === 1, "로그아웃 뒤 새 기록이 지연 삭제됨");
  });
  await test("로그아웃 미전송 존재 시 명부/얼굴/설정/원본 전체를 보존한다", async () => {
    await db.setSetting("marker", "before"); await db.replaceAllUsers([{ id: 1, name: "현재", role: "STUDENT" }]);
    await db.replaceAllFaceProfiles([{ userId: 1, embeddings: [[1, 0]] }]); await insert(checkin());
    assert((await clearClientBrowserState()).keptCheckIns === 1, "미전송 건수 유실");
    assert((await rawRecords()).length === 1 && await db.getSetting("marker") === "before" && (await db.getUser(1))?.name === "현재" && (await db.getAllFaceProfiles()).length === 1, "로그아웃 DB 일부 유실");
  });
  return results;
}

export async function renderForceReset() {
  await db.clearAllData(); await insert(checkin());
  const host = document.createElement("div"); document.body.append(host);
  createRoot(host).render(createElement(ForceResetDialog, { counts: { unsynced: 1, review: 0 }, onClose: () => {}, onCleared: () => { host.textContent = "초기화 완료"; } }));
}
export async function otherTabScan() {
  await db.replaceAllUsers([{ id: 2, name: "다른탭학생", role: "STUDENT", grade: 1, classNum: 1, number: 2 }]);
  await db.replaceAllEligibleEntries([{ userId: 2, date: "2027-02-28", mealKind: "LUNCH" }]);
  const now = new Date("2027-02-28T03:21:42Z");
  const result = await runLocalQrCheckIn({ data: "posanmeal:2:3:STUDENT", now, mealWindows: windows }, repo, () => now);
  assert(result.success, "다른 탭 제품 스캔 저장 실패");
}
export async function readRows() { return rawRecords(); }
