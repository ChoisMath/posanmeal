"use client";

import { useState, useEffect, useMemo } from "react";
import { clearClientStateAndSignOut } from "@/lib/clearClientState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "@/components/BrandMark";
import { Badge } from "@/components/ui/badge";
import { LogOut, Plus, Download, Trash2, FileSpreadsheet, ArrowLeftRight, RefreshCw, Camera, Settings, ChevronLeft, ChevronRight, AlertTriangle, Database, ExternalLink } from "lucide-react";
import Link from "next/link";
import { AdminMealTable } from "@/components/AdminMealTable";
import { toast } from "sonner";
import { useAdminPermission } from "@/hooks/useAdminPermission";
import { todayKST, formatDateTimeKST } from "@/lib/timezone";
import { sourceLabel, type CheckInSourceLabel } from "@/lib/checkin-source";
import { LocalCheckInsTable, buildUserLabel, type LocalCheckInRow } from "@/components/LocalCheckInsTable";
import { EditableTextCell, EditableSelectCell, type SaveResult } from "@/components/EditableCell";
import { MEAL_LABEL, METHOD_LABEL } from "@/lib/meal-plan";
import { MEAL_THEME } from "@/components/meal/meal-ui";
import {
  validateMealWindows,
  mapServerError,
  type MealWindowsForm,
} from "@/lib/meal-windows-validation";

interface User {
  id: number; email: string; name: string; role: string;
  grade?: number; classNum?: number; number?: number;
  subject?: string; homeroom?: string; position?: string;
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
  gender?: "MALE" | "FEMALE" | null;
}

interface MealAppMealItem {
  mealKind: string;
  price: number;
  exemptionSelectable: boolean;
  method: string;
  openDateCount: number;
}

interface MealAppItem {
  id: number;
  title: string;
  description: string | null;
  status: string;
  startYear: number | null;
  startMonth: number | null;
  monthCount: number | null;
  applyStartAt: string | null;
  applyEndAt: string | null;
  meals: MealAppMealItem[];
  registrationCount: number;
  cancelledCount: number;
}

interface DashboardRecord {
  id: number; userName: string; role: string; type: string;
  mealKind?: "BREAKFAST" | "LUNCH" | "DINNER" | null;
  source: CheckInSourceLabel;
  checkedAt: string; grade?: number; classNum?: number; number?: number;
}

interface DashboardData {
  date: string;
  hasBreakfast: boolean;
  hasLunch?: boolean;
  studentCount: number;
  breakfastStudentCount: number;
  lunchStudentCount?: number;
  dinnerStudentCount: number;
  teacherWorkCount: number;
  teacherPersonalCount: number;
  records: DashboardRecord[];
}

const emptyForm = {
  role: "STUDENT" as "STUDENT" | "TEACHER",
  email: "", name: "", grade: "", classNum: "", number: "",
  subject: "", homeroom: "", position: "",
  gender: "" as "" | "MALE" | "FEMALE",
};

const sheetImportGuides = [
  { label: "학생", columns: ["email", "grade", "classNum", "number", "name", "gender"] },
  { label: "교사", columns: ["email", "subject", "homeroom", "position", "name"] },
] as const;

export default function AdminPage() {
  const adminPerm = useAdminPermission();
  const [users, setUsers] = useState<User[]>([]);
  const [userFilter, setUserFilter] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardDate, setDashboardDate] = useState<string>(() => todayKST());

  // Add dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({ ...emptyForm });

  // Sheet import dialog
  const [sheetDialogOpen, setSheetDialogOpen] = useState(false);
  const [studentSheetUrl, setStudentSheetUrl] = useState("");
  const [teacherSheetUrl, setTeacherSheetUrl] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);

  // Applications (신청관리)
  const [apps, setApps] = useState<MealAppItem[]>([]);

  // 진입 시 ?tab= 쿼리 반영 (공고 저장 후 /admin?tab=applications 복귀 등)
  // SSR과 첫 클라이언트 렌더를 "users"로 일치시키고 마운트 후 전환 (hydration mismatch 방지)
  const [activeTab, setActiveTab] = useState("users");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    const valid = ["users", "applications", "meals", "dashboard", "settings"];
    if (t && valid.includes(t)) setActiveTab(t);
  }, []);

  // System settings
  const [sysMode, setSysMode] = useState<"online" | "local">("online");
  const [sysGeneration, setSysGeneration] = useState(1);
  const [sysLoading, setSysLoading] = useState(false);
  const [sysWindows, setSysWindows] = useState<MealWindowsForm | null>(null);
  const [windowsForm, setWindowsForm] = useState<MealWindowsForm | null>(null);
  const [windowsError, setWindowsError] = useState<string | null>(null);
  const [windowsLoadFailed, setWindowsLoadFailed] = useState(false);
  const [localDataDialogOpen, setLocalDataDialogOpen] = useState(false);
  const [localRows, setLocalRows] = useState<LocalCheckInRow[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [unsyncedBadgeCount, setUnsyncedBadgeCount] = useState(0);
  const [exportingExcel, setExportingExcel] = useState(false);

  async function fetchSystemSettings(): Promise<boolean> {
    try {
      const res = await fetch("/api/system/settings");
      if (!res.ok) {
        setWindowsLoadFailed(true);
        return false;
      }
      const data = await res.json();
      setSysMode(data.operationMode);
      setSysGeneration(data.qrGeneration);
      if (data.mealWindows) {
        const windows: MealWindowsForm = {
          breakfast: {
            start: data.mealWindows.breakfast.start,
            end: data.mealWindows.breakfast.end,
          },
          lunch: {
            start: data.mealWindows.lunch?.start ?? "10:30",
            end: data.mealWindows.lunch?.end ?? "14:00",
          },
          dinner: {
            start: data.mealWindows.dinner.start,
            end: data.mealWindows.dinner.end,
          },
        };
        setSysWindows(windows);
        setWindowsForm(windows);
        setWindowsError(null);
        setWindowsLoadFailed(false);
      } else {
        setWindowsLoadFailed(true);
        return false;
      }
      return true;
    } catch {
      setWindowsLoadFailed(true);
      return false;
    }
  }

  async function handleModeToggle() {
    const newMode = sysMode === "online" ? "local" : "online";
    const msg = newMode === "local"
      ? "로컬 모드로 전환하시겠습니까?\n학생/교사에게 고유 QR이 표시됩니다."
      : "온라인 모드로 전환하시겠습니까?\n기존 JWT 토큰 QR 방식으로 돌아갑니다.";
    if (!confirm(msg)) return;

    setSysLoading(true);
    await fetch("/api/system/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationMode: newMode }),
    });
    await fetchSystemSettings();
    setSysLoading(false);
  }

  async function handleRefreshQR() {
    if (!confirm("전체 QR을 새로고침하시겠습니까?\n기존 QR코드는 모두 무효화됩니다.\n태블릿 동기화 후 적용됩니다.")) return;
    setSysLoading(true);
    await fetch("/api/system/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshQR: true }),
    });
    await fetchSystemSettings();
    setSysLoading(false);
  }

  function handleWindowsChange(
    meal: "breakfast" | "lunch" | "dinner",
    edge: "start" | "end",
    value: string,
  ) {
    if (!windowsForm) return;
    const next: MealWindowsForm = {
      breakfast: { ...windowsForm.breakfast },
      lunch: { ...windowsForm.lunch },
      dinner: { ...windowsForm.dinner },
    };
    next[meal][edge] = value;
    setWindowsForm(next);
    setWindowsError(validateMealWindows(next));
  }

  async function handleSaveWindows() {
    if (!windowsForm) return;
    const validationError = validateMealWindows(windowsForm);
    if (validationError) {
      setWindowsError(validationError);
      return;
    }
    setSysLoading(true);
    try {
      const res = await fetch("/api/system/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealWindows: windowsForm }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setWindowsError(mapServerError(data?.error) ?? "저장에 실패했습니다");
        toast.error("식사 시간 저장 실패");
        return;
      }
      const refreshed = await fetchSystemSettings();
      if (refreshed) {
        toast.success("식사 시간이 저장되었습니다 · 새 QR부터 적용");
      } else {
        toast.warning("저장되었으나 설정을 다시 불러오지 못했습니다. 새로고침 해주세요");
      }
    } finally {
      setSysLoading(false);
    }
  }

  async function refreshUnsyncedBadge() {
    try {
      const { getUnsyncedCount } = await import("@/lib/local-db");
      setUnsyncedBadgeCount(await getUnsyncedCount());
    } catch {
      setUnsyncedBadgeCount(0);
    }
  }

  async function handleOpenLocalData() {
    setLocalDataDialogOpen(true);
    setLocalLoading(true);
    setLocalError(null);
    setLocalRows([]);
    try {
      const { getUnsyncedCheckIns, getUser } = await import("@/lib/local-db");
      const checkins = await getUnsyncedCheckIns();
      const userIds = Array.from(new Set(checkins.map((c) => c.userId)));
      const userMap = new Map<number, Awaited<ReturnType<typeof getUser>>>();
      await Promise.all(
        userIds.map(async (id) => {
          const u = await getUser(id);
          if (u) userMap.set(id, u);
        }),
      );
      const rows: LocalCheckInRow[] = checkins.map((c) => ({
        id: c.id!,
        userId: c.userId,
        userLabel: buildUserLabel(userMap.get(c.userId), c.userId),
        name: userMap.get(c.userId)?.name ?? "-",
        date: c.date,
        mealKind: c.mealKind,
        type: c.type,
        checkedAt: c.checkedAt,
      }));
      setLocalRows(rows);
    } catch (err) {
      setLocalError("로컬 데이터를 불러오지 못했습니다");
      toast.error("로컬 데이터를 불러오지 못했습니다");
      console.error(err);
    } finally {
      setLocalLoading(false);
    }
  }

  function handleCloseLocalData(open: boolean) {
    setLocalDataDialogOpen(open);
    if (!open) {
      setLocalRows([]);
      setLocalError(null);
      refreshUnsyncedBadge();
    }
  }

  async function handleExportLocalDataExcel() {
    if (localRows.length === 0) return;
    setExportingExcel(true);
    try {
      const { exportLocalCheckInsXlsx } = await import("@/lib/local-checkins-export");
      const blob = await exportLocalCheckInsXlsx(localRows);
      const filename = `local-checkins-${todayKST()}.xlsx`;
      triggerDownload(blob, filename);
    } catch (err) {
      toast.error("엑셀 다운로드 실패");
      console.error(err);
    } finally {
      setExportingExcel(false);
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  async function handleAdminSync() {
    setIsSyncing(true);
    setSyncStatus(null);
    try {
      const {
        setSetting,
        replaceAllUsers,
        replaceAllEligibleUsers,
        replaceAllEligibleEntries,
        getUnsyncedCheckIns,
        markCheckInsSynced,
      } = await import("@/lib/local-db");
      const messages: string[] = [];

      // 1. Upload unsynced check-ins first (data loss prevention)
      const unsynced = await getUnsyncedCheckIns();
      if (unsynced.length > 0) {
        const payload = unsynced.map((ci) => ({
          clientId: ci.id!,
          userId: ci.userId,
          date: ci.date,
          mealKind: ci.mealKind,
          checkedAt: ci.checkedAt,
          type: ci.type,
        }));
        const upRes = await fetch("/api/sync/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkins: payload }),
        });
        if (upRes.ok) {
          const upData = await upRes.json();
          const syncedIds: number[] = Array.isArray(upData.syncedClientIds)
            ? upData.syncedClientIds.filter((id: unknown): id is number => typeof id === "number")
            : [];
          if (syncedIds.length > 0) {
            await markCheckInsSynced(syncedIds);
          }
          const accepted = upData.acceptedCount ?? 0;
          const duplicates = upData.duplicatesCount ?? 0;
          const rejected = upData.rejectedCount ?? 0;
          messages.push(`업로드: ${accepted}건 전송, ${duplicates}건 중복, ${rejected}건 미반영`);
        } else {
          messages.push("체크인 업로드 실패");
        }
      }

      // 2. Download latest data
      const res = await fetch("/api/sync/download");
      if (!res.ok) {
        setSyncStatus("다운로드 실패. 서버 상태를 확인하세요.");
        return;
      }
      const data = await res.json();

      await setSetting("operationMode", data.operationMode);
      await setSetting("qrGeneration", data.qrGeneration.toString());
      if (data.mealWindows) {
        await setSetting("mealWindows", JSON.stringify(data.mealWindows));
      }
      await replaceAllUsers(data.users);
      if (Array.isArray(data.eligibleEntries)) {
        await replaceAllEligibleEntries(data.eligibleEntries);
      } else {
        await replaceAllEligibleUsers(data.eligibleUserIds);
      }
      await setSetting("lastSyncAt", new Date().toISOString());

      messages.push(`다운로드: 사용자 ${data.users.length}명, 자격자 ${data.eligibleUserIds.length}명`);
      setSyncStatus(`동기화 완료 — ${messages.join(" | ")}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Admin sync error:", err);
      setSyncStatus(`동기화 오류: ${msg}`);
    } finally {
      await refreshUnsyncedBadge();
      setIsSyncing(false);
    }
  }

  async function fetchUsers() {
    const res = await fetch(`/api/admin/users?role=${userFilter}`);
    const data = await res.json();
    setUsers(data.users || []);
  }

  async function fetchDashboard(date: string = dashboardDate) {
    const res = await fetch(`/api/admin/dashboard?date=${date}`);
    const data = await res.json();
    setDashboard(data);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchUsers(); fetchSystemSettings(); fetchApps(); }, [userFilter]);
  useEffect(() => { refreshUnsyncedBadge(); }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchDashboard(dashboardDate); }, [dashboardDate]);

  function shiftDashboardDate(deltaDays: number) {
    const d = new Date(`${dashboardDate}T00:00:00`);
    d.setDate(d.getDate() + deltaDays);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    setDashboardDate(`${yyyy}-${mm}-${dd}`);
  }

  const [importError, setImportError] = useState("");

  async function handleImport() {
    if (!studentSheetUrl && !teacherSheetUrl) {
      setImportError("학생 또는 교사 시트 URL을 하나 이상 입력하세요.");
      return;
    }
    setImporting(true); setImportMessage(""); setImportError("");
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentSheetUrl, teacherSheetUrl }),
      });
      let data: { message?: string; error?: string; warnings?: string };
      try {
        data = await res.json();
      } catch {
        setImportError("서버 응답을 처리할 수 없습니다. 잠시 후 다시 시도하세요.");
        setImporting(false);
        return;
      }
      if (data.error) {
        setImportError(data.error);
      }
      if (data.message) {
        setImportMessage(data.message);
      }
      if (data.warnings) {
        setImportError((prev) => prev ? prev + "\n\n" + data.warnings : data.warnings!);
      }
      fetchUsers();
    } catch {
      setImportError("네트워크 오류가 발생했습니다. 인터넷 연결을 확인하세요.");
    }
    setImporting(false);
  }

  async function handleAddUser() {
    if (addForm.role === "STUDENT" && addForm.gender !== "MALE" && addForm.gender !== "FEMALE") {
      toast.error("학생은 성별을 선택해야 합니다.");
      return;
    }

    const body: Record<string, unknown> = { role: addForm.role, email: addForm.email, name: addForm.name };
    if (addForm.role === "STUDENT") {
      body.grade = parseInt(addForm.grade); body.classNum = parseInt(addForm.classNum);
      body.number = parseInt(addForm.number);
    } else {
      body.subject = addForm.subject; body.homeroom = addForm.homeroom; body.position = addForm.position;
    }
    body.gender = addForm.gender === "" ? null : addForm.gender;

    const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data?.reason ?? "사용자 추가에 실패했습니다.");
      return;
    }
    setAddDialogOpen(false);
    setAddForm({ ...emptyForm });
    fetchUsers();
  }

  type EditableUserField =
    | "name" | "email"
    | "grade" | "classNum" | "number"
    | "subject" | "homeroom" | "position"
    | "gender";

  async function saveUserField(
    id: number,
    field: EditableUserField,
    next: string,
  ): Promise<SaveResult> {
    const body: Record<string, unknown> = { id };
    let normalizedNext: unknown = next;

    if (field === "grade" || field === "classNum" || field === "number") {
      const trimmed = next.trim();
      const n = parseInt(trimmed, 10);
      const label = field === "grade" ? "학년" : field === "classNum" ? "반" : "번호";
      if (isNaN(n) || n < 1 || !/^\d+$/.test(trimmed)) {
        return { ok: false, message: `${label}은(는) 1 이상 정수여야 합니다.` };
      }
      body[field] = n;
      normalizedNext = n;
    } else if (field === "gender") {
      const g = next === "" ? null : next;
      body.gender = g;
      normalizedNext = g;
    } else {
      body[field] = next;
    }

    let res: Response;
    try {
      res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, message: "네트워크 오류입니다." };
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: data?.reason ?? "수정에 실패했습니다." };
    }
    setUsers((prev) =>
      prev.map((u) =>
        u.id === id ? { ...u, [field]: normalizedNext as User[typeof field] } : u,
      ),
    );
    return { ok: true };
  }

  async function saveAdminLevel(
    id: number,
    next: "NONE" | "SUBADMIN" | "ADMIN",
  ): Promise<SaveResult> {
    const target = users.find((u) => u.id === id);
    if (!target) return { ok: false, message: "사용자를 찾을 수 없습니다." };
    if (target.adminLevel === next) return { ok: true };

    const labelMap = { NONE: "일반", SUBADMIN: "서브관리자", ADMIN: "관리자" } as const;
    if (!confirm(`${target.name} 의 권한을 ${labelMap[next]}(으)로 변경할까요?`)) {
      return { ok: false, message: "" };
    }

    let res: Response;
    try {
      res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, adminLevel: next }),
      });
    } catch {
      return { ok: false, message: "네트워크 오류입니다." };
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: data?.reason ?? "권한 변경에 실패했습니다." };
    }
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, adminLevel: next } : u)));
    return { ok: true };
  }

  async function handleDeleteUser(id: number) {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
    fetchUsers();
  }

  async function handleToggleCheckinType(record: DashboardRecord) {
    const newType = record.type === "WORK" ? "PERSONAL" : "WORK";
    const res = await fetch("/api/admin/checkins", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: record.id, type: newType }),
    });
    if (res.ok) fetchDashboard();
  }

  async function handleExport() {
    const res = await fetch(`/api/admin/export?date=${dashboardDate}`);
    if (!res.ok) { toast.error("Excel 다운로드 실패"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `석식현황_${dashboardDate}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
  }

  // --- 신청관리 functions ---
  async function fetchApps() {
    const res = await fetch("/api/admin/applications");
    if (res.ok) { const data = await res.json(); setApps(data.applications); }
  }

  async function handleDeleteApp(app: MealAppItem) {
    if (!confirm(`"${app.title}" 공고를 삭제하시겠습니까? 모든 신청 데이터가 삭제됩니다.`)) return;
    const res = await fetch(`/api/admin/applications/${app.id}`, { method: "DELETE" });
    if (res.ok) { toast.success("공고가 삭제되었습니다."); fetchApps(); }
    else { const d = await res.json(); toast.error(d.error || "삭제 실패"); }
  }

  const {
    grade1Count, grade2Count, grade3Count,
    grade1Breakfast, grade2Breakfast, grade3Breakfast,
    grade1Lunch, grade2Lunch, grade3Lunch,
    grade1Dinner, grade2Dinner, grade3Dinner,
    sortedRecords,
  } = useMemo(() => {
    const records = dashboard?.records || [];
    const isStudent = (r: DashboardRecord, g: number) => r.role === "STUDENT" && r.grade === g;
    const byGrade = (g: number) => records.filter((r) => isStudent(r, g));
    const breakfast = (rs: DashboardRecord[]) => rs.filter((r) => r.mealKind === "BREAKFAST").length;
    const lunchCount = (rs: DashboardRecord[]) => rs.filter((r) => r.mealKind === "LUNCH").length;
    const dinner = (rs: DashboardRecord[]) => rs.filter((r) => r.mealKind === "DINNER" || !r.mealKind).length;
    const g1 = byGrade(1), g2 = byGrade(2), g3 = byGrade(3);
    return {
      grade1Count: g1.length,
      grade2Count: g2.length,
      grade3Count: g3.length,
      grade1Breakfast: breakfast(g1),
      grade2Breakfast: breakfast(g2),
      grade3Breakfast: breakfast(g3),
      grade1Lunch: lunchCount(g1),
      grade2Lunch: lunchCount(g2),
      grade3Lunch: lunchCount(g3),
      grade1Dinner: dinner(g1),
      grade2Dinner: dinner(g2),
      grade3Dinner: dinner(g3),
      sortedRecords: [...records].sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()),
    };
  }, [dashboard]);

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-warm-subtle">
      <header className="header-gradient px-4 py-3 flex items-center justify-between shrink-0">
        <BrandMark variant="header" label="PosanMeal Admin" />
        <div className="flex items-center gap-2">
          {adminPerm.badgeLabel && (
            <span className="hidden sm:inline text-sm text-white/90 whitespace-nowrap">
              {adminPerm.displayName} · <span className="font-medium">{adminPerm.badgeLabel}</span>
            </span>
          )}
          {adminPerm.isTeacher && (
            <Link href="/teacher">
              <Button variant="outline" size="sm" className="rounded-xl bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white">
                교사 페이지로
              </Button>
            </Link>
          )}
          <ThemeToggle />
          <Link href="/check" className="inline-flex items-center justify-center h-9 w-9 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors" aria-label="체크인 페이지" title="체크인 페이지">
            <Camera className="h-4 w-4" />
          </Link>
          <Button variant="ghost" size="icon" className="text-white/80 hover:text-white hover:bg-white/10" onClick={() => clearClientStateAndSignOut("/")}><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>
      <div className="flex-1 min-h-0 w-full max-w-5xl mx-auto p-1.5 sm:p-3 md:p-4 flex flex-col overflow-hidden page-enter">
        <Tabs
          value={activeTab}
          className="flex flex-col flex-1 min-h-0"
          onValueChange={(v) => {
            setActiveTab(v);
            if (v === "dashboard") fetchDashboard(dashboardDate);
            if (v === "applications") fetchApps();
          }}
        >
          <TabsList
            className={`grid w-full ${adminPerm.isSubadmin ? "grid-cols-3" : "grid-cols-5"} rounded-xl h-11 max-w-2xl shrink-0`}
          >
            <TabsTrigger value="users" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">사용자 관리</TabsTrigger>
            {!adminPerm.isSubadmin && (
              <TabsTrigger value="applications" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">신청관리</TabsTrigger>
            )}
            <TabsTrigger value="meals" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">급식 확인</TabsTrigger>
            <TabsTrigger value="dashboard" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">당일 현황</TabsTrigger>
            {!adminPerm.isSubadmin && (
              <TabsTrigger value="settings" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">설정</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="users" className="flex-1 min-h-0 mt-1 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0 h-full flex flex-col">
              <CardContent className="pt-2 flex-1 min-h-0 overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex gap-2">
                    <Button variant={userFilter === "STUDENT" ? "default" : "outline"} size="sm" onClick={() => setUserFilter("STUDENT")}>학생</Button>
                    <Button variant={userFilter === "TEACHER" ? "default" : "outline"} size="sm" onClick={() => setUserFilter("TEACHER")}>교사</Button>
                  </div>
                  {adminPerm.canWrite && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setImportMessage(""); setSheetDialogOpen(true); }}>
                        <FileSpreadsheet className="h-4 w-4 mr-1" /> Sheet연결
                      </Button>
                      <Button size="sm" onClick={() => { setAddForm({ ...emptyForm, role: userFilter }); setAddDialogOpen(true); }}>
                        <Plus className="h-4 w-4 mr-1" /> 추가
                      </Button>
                    </div>
                  )}
                </div>
                <div className="border rounded-lg overflow-auto max-h-[70dvh]">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead className="sticky top-0 z-20">
                      <tr>
                        <th className="p-2 text-left bg-muted whitespace-nowrap">이름</th>
                        {userFilter === "STUDENT" ? (
                          <>
                            <th className="p-2 text-left bg-muted whitespace-nowrap w-12">학년</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap w-12">반</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap w-12">번호</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">이메일</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap w-14">성별</th>
                          </>
                        ) : (
                          <>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">교과명</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">담임</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">이메일</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">직책</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap w-14">성별</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">권한</th>
                          </>
                        )}
                        <th className="p-2 text-center w-24 bg-muted whitespace-nowrap">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-t">
                          <td className="p-1 align-middle">
                            <EditableTextCell
                              value={u.name}
                              ariaLabel={`${u.name} 이름`}
                              disabled={!adminPerm.canWrite}
                              validate={(v) => (v.trim() === "" ? "이름은 비울 수 없습니다." : null)}
                              onSave={(next) => saveUserField(u.id, "name", next)}
                            />
                          </td>
                          {u.role === "STUDENT" ? (
                            <>
                              <td className="p-1 align-middle w-12">
                                <EditableTextCell
                                  value={u.grade?.toString() ?? ""}
                                  inputType="number"
                                  ariaLabel={`${u.name} 학년`}
                                  disabled={!adminPerm.canWrite}
                                  validate={(v) => {
                                    const trimmed = v.trim();
                                    const n = parseInt(trimmed, 10);
                                    return isNaN(n) || n < 1 || !/^\d+$/.test(trimmed)
                                      ? "학년은 1 이상 정수여야 합니다."
                                      : null;
                                  }}
                                  onSave={(next) => saveUserField(u.id, "grade", next)}
                                />
                              </td>
                              <td className="p-1 align-middle w-12">
                                <EditableTextCell
                                  value={u.classNum?.toString() ?? ""}
                                  inputType="number"
                                  ariaLabel={`${u.name} 반`}
                                  disabled={!adminPerm.canWrite}
                                  validate={(v) => {
                                    const trimmed = v.trim();
                                    const n = parseInt(trimmed, 10);
                                    return isNaN(n) || n < 1 || !/^\d+$/.test(trimmed)
                                      ? "반은 1 이상 정수여야 합니다."
                                      : null;
                                  }}
                                  onSave={(next) => saveUserField(u.id, "classNum", next)}
                                />
                              </td>
                              <td className="p-1 align-middle w-12">
                                <EditableTextCell
                                  value={u.number?.toString() ?? ""}
                                  inputType="number"
                                  ariaLabel={`${u.name} 번호`}
                                  disabled={!adminPerm.canWrite}
                                  validate={(v) => {
                                    const trimmed = v.trim();
                                    const n = parseInt(trimmed, 10);
                                    return isNaN(n) || n < 1 || !/^\d+$/.test(trimmed)
                                      ? "번호는 1 이상 정수여야 합니다."
                                      : null;
                                  }}
                                  onSave={(next) => saveUserField(u.id, "number", next)}
                                />
                              </td>
                              <td className="p-1 align-middle">
                                <EditableTextCell
                                  value={u.email}
                                  ariaLabel={`${u.name} 이메일`}
                                  disabled={!adminPerm.canWrite}
                                  className="max-w-[16rem] overflow-hidden text-ellipsis whitespace-nowrap"
                                  validate={(v) => {
                                    const t = v.trim();
                                    if (t === "" || !t.includes("@")) return "이메일 형식이 올바르지 않습니다.";
                                    return null;
                                  }}
                                  onSave={(next) => saveUserField(u.id, "email", next)}
                                />
                              </td>
                              <td className="p-1 align-middle w-14">
                                <EditableSelectCell
                                  value={u.gender ?? ""}
                                  ariaLabel={`${u.name} 성별`}
                                  disabled={!adminPerm.canWrite}
                                  options={[
                                    { value: "MALE", label: "남" },
                                    { value: "FEMALE", label: "여" },
                                  ]}
                                  onSave={(next) => saveUserField(u.id, "gender", next)}
                                />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-1 align-middle">
                                <EditableTextCell
                                  value={u.subject ?? ""}
                                  ariaLabel={`${u.name} 교과명`}
                                  disabled={!adminPerm.canWrite}
                                  placeholder="교과명 없음"
                                  onSave={(next) => saveUserField(u.id, "subject", next)}
                                />
                              </td>
                              <td className="p-1 align-middle">
                                <EditableTextCell
                                  value={u.homeroom ?? ""}
                                  ariaLabel={`${u.name} 담임`}
                                  disabled={!adminPerm.canWrite}
                                  placeholder="비담임"
                                  onSave={(next) => saveUserField(u.id, "homeroom", next)}
                                />
                              </td>
                              <td className="p-1 align-middle">
                                <EditableTextCell
                                  value={u.email}
                                  ariaLabel={`${u.name} 이메일`}
                                  disabled={!adminPerm.canWrite}
                                  className="max-w-[16rem] overflow-hidden text-ellipsis whitespace-nowrap"
                                  validate={(v) => {
                                    const t = v.trim();
                                    if (t === "" || !t.includes("@")) return "이메일 형식이 올바르지 않습니다.";
                                    return null;
                                  }}
                                  onSave={(next) => saveUserField(u.id, "email", next)}
                                />
                              </td>
                              <td className="p-1 align-middle">
                                <EditableTextCell
                                  value={u.position ?? ""}
                                  ariaLabel={`${u.name} 직책`}
                                  disabled={!adminPerm.canWrite}
                                  placeholder="직책 없음"
                                  onSave={(next) => saveUserField(u.id, "position", next)}
                                />
                              </td>
                              <td className="p-1 align-middle w-14">
                                <EditableSelectCell
                                  value={u.gender ?? ""}
                                  ariaLabel={`${u.name} 성별`}
                                  disabled={!adminPerm.canWrite}
                                  emptyLabel="—"
                                  options={[
                                    { value: "MALE", label: "남" },
                                    { value: "FEMALE", label: "여" },
                                  ]}
                                  onSave={(next) => saveUserField(u.id, "gender", next)}
                                />
                              </td>
                              <td className="p-1 align-middle">
                                <EditableSelectCell
                                  value={u.adminLevel}
                                  ariaLabel={`${u.name} 권한`}
                                  disabled={
                                    !adminPerm.canWrite ||
                                    (adminPerm.dbUserId === u.id && u.adminLevel === "ADMIN")
                                  }
                                  options={[
                                    { value: "NONE", label: "일반" },
                                    { value: "SUBADMIN", label: "서브관리자" },
                                    { value: "ADMIN", label: "관리자" },
                                  ]}
                                  onSave={(next) =>
                                    saveAdminLevel(u.id, next as "NONE" | "SUBADMIN" | "ADMIN")
                                  }
                                />
                              </td>
                            </>
                          )}
                          <td className="p-2 text-center align-middle">
                            {adminPerm.canWrite && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteUser(u.id)}
                                aria-label={`${u.name} 삭제`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {!adminPerm.isSubadmin && (
          <TabsContent value="applications" className="flex-1 min-h-0 mt-1 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0 h-full flex flex-col">
              <CardContent className="pt-2 flex-1 min-h-0 overflow-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">신청 공고</h3>
                  <Link href="/admin/applications/new">
                    <Button size="sm" className="min-h-11 whitespace-nowrap">
                      <Plus className="h-4 w-4 mr-1" /> 새 공고 작성
                    </Button>
                  </Link>
                </div>
                {apps.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">등록된 공고가 없습니다.</p>
                ) : (
                  <div className="space-y-3">
                    {apps.map((app) => {
                      const nowKst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
                      const applyStart = app.applyStartAt ? new Date(app.applyStartAt) : null;
                      const applyEnd = app.applyEndAt ? new Date(app.applyEndAt) : null;

                      let statusBadge: React.ReactNode;
                      if (app.status === "CLOSED") {
                        statusBadge = <Badge className="text-xs bg-red-500 hover:bg-red-600 whitespace-nowrap">마감</Badge>;
                      } else if (applyStart && applyEnd && nowKst >= applyStart && nowKst <= applyEnd) {
                        statusBadge = <Badge className="text-xs bg-green-600 hover:bg-green-700 whitespace-nowrap">신청중</Badge>;
                      } else if (applyStart && nowKst < applyStart) {
                        statusBadge = <Badge variant="secondary" className="text-xs whitespace-nowrap">대기</Badge>;
                      } else {
                        statusBadge = <Badge className="text-xs bg-orange-500 hover:bg-orange-600 whitespace-nowrap">기간종료</Badge>;
                      }

                      const totalOpenDateCount = app.meals.reduce((s, m) => s + m.openDateCount, 0);

                      return (
                        <div key={app.id} className="card-elevated rounded-2xl border-0 p-4 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {statusBadge}
                            <span className="font-semibold">{app.title}</span>
                          </div>
                          {(applyStart || applyEnd) && (
                            <p className="text-xs text-muted-foreground whitespace-nowrap">
                              {applyStart ? formatDateTimeKST(applyStart) : "—"} ~ {applyEnd ? formatDateTimeKST(applyEnd) : "—"}
                            </p>
                          )}
                          {app.meals.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {app.meals.map((m) => {
                                const kind = m.mealKind as "BREAKFAST" | "LUNCH" | "DINNER";
                                if (m.method === "NONE") {
                                  return (
                                    <span key={kind} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground whitespace-nowrap">
                                      {MEAL_LABEL[kind]} 신청불가
                                    </span>
                                  );
                                }
                                return (
                                  <span
                                    key={kind}
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${MEAL_THEME[kind].side} ${MEAL_THEME[kind].text}`}
                                  >
                                    {MEAL_LABEL[kind]} {m.price.toLocaleString()}원·{METHOD_LABEL[m.method as keyof typeof METHOD_LABEL] ?? m.method}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground whitespace-nowrap">
                            신청 {app.registrationCount}명 · 취소 {app.cancelledCount}명 · 식수일 합계 {totalOpenDateCount}일
                          </p>
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Link href={`/admin/applications/${app.id}/stats`}>
                              <Button variant="outline" size="sm" className="min-h-9 whitespace-nowrap">
                                <ExternalLink className="h-3.5 w-3.5 mr-1" /> 통계·명단
                              </Button>
                            </Link>
                            <Link href={`/admin/applications/${app.id}/edit`}>
                              <Button variant="outline" size="sm" className="min-h-9 whitespace-nowrap">
                                수정
                              </Button>
                            </Link>
                            {app.status === "OPEN" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="min-h-9 whitespace-nowrap"
                                onClick={async () => {
                                  if (!confirm(`"${app.title}" 공고를 마감하시겠습니까?`)) return;
                                  const res = await fetch(`/api/admin/applications/${app.id}/close`, { method: "POST" });
                                  if (res.ok) { toast.success("공고가 마감되었습니다."); fetchApps(); }
                                  else { const d = await res.json(); toast.error(d.error || "마감 실패"); }
                                }}
                              >
                                마감
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-h-9 whitespace-nowrap text-destructive hover:text-destructive"
                              onClick={() => handleDeleteApp(app)}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-1" /> 삭제
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}

          <TabsContent value="meals" className="flex-1 min-h-0 mt-1 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0 h-full flex flex-col">
              <CardContent className="pt-2 flex-1 min-h-0 overflow-hidden">
                <AdminMealTable readonly={adminPerm.isSubadmin} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dashboard" className="flex-1 min-h-0 mt-1 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0 h-full flex flex-col">
              <CardContent className="pt-2 flex-1 min-h-0 overflow-hidden">
                <div className="flex justify-between items-center gap-2 flex-wrap mb-4">
                  <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => shiftDashboardDate(-1)}
                      aria-label="이전 날짜"
                      title="이전 날짜"
                      className="min-h-11 min-w-11"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Input
                      type="date"
                      value={dashboardDate}
                      onChange={(e) => { if (e.target.value) setDashboardDate(e.target.value); }}
                      className="w-auto min-w-[10rem] min-h-11 rounded-xl whitespace-nowrap"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => shiftDashboardDate(1)}
                      aria-label="다음 날짜"
                      title="다음 날짜"
                      className="min-h-11 min-w-11"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDashboardDate(todayKST())}
                      disabled={dashboardDate === todayKST()}
                      className="min-h-11 whitespace-nowrap"
                    >
                      오늘
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={() => fetchDashboard(dashboardDate)} aria-label="새로고침" title="새로고침" className="min-h-11 min-w-11">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExport} className="min-h-11 whitespace-nowrap"><Download className="h-4 w-4 mr-1" /> Excel 다운로드</Button>
                  </div>
                </div>
                {dashboard && (
                  <>
                    <div className="grid grid-cols-5 gap-2 sm:gap-3 mb-5">
                      {[
                        { count: grade1Count, breakfast: grade1Breakfast, lunch: grade1Lunch, dinner: grade1Dinner, label: "1학년", color: "from-amber-500/10 to-amber-500/5 dark:from-amber-500/20 dark:to-amber-500/10" },
                        { count: grade2Count, breakfast: grade2Breakfast, lunch: grade2Lunch, dinner: grade2Dinner, label: "2학년", color: "from-orange-500/10 to-orange-500/5 dark:from-orange-500/20 dark:to-orange-500/10" },
                        { count: grade3Count, breakfast: grade3Breakfast, lunch: grade3Lunch, dinner: grade3Dinner, label: "3학년", color: "from-rose-500/10 to-rose-500/5 dark:from-rose-500/20 dark:to-rose-500/10" },
                        { count: dashboard.teacherWorkCount, breakfast: 0, lunch: 0, dinner: 0, label: "교사(근무)", color: "from-blue-500/10 to-blue-500/5 dark:from-blue-500/20 dark:to-blue-500/10" },
                        { count: dashboard.teacherPersonalCount, breakfast: 0, lunch: 0, dinner: 0, label: "교사(개인)", color: "from-emerald-500/10 to-emerald-500/5 dark:from-emerald-500/20 dark:to-emerald-500/10" },
                      ].map(({ count, breakfast, lunch, dinner, label, color }) => (
                        <div key={label} className={`bg-gradient-to-b ${color} rounded-xl p-3 text-center`}>
                          <p className="text-2xl font-bold">{count}</p>
                          {label.endsWith("학년") && (dashboard.hasBreakfast || dashboard.hasLunch) && (
                            <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {dashboard.hasBreakfast && <>조 {breakfast} · </>}
                              {dashboard.hasLunch && <>중 {lunch} · </>}
                              석 {dinner}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="border rounded-lg overflow-auto max-h-[50dvh]">
                      <table className="w-full text-sm whitespace-nowrap">
                        <thead className="sticky top-0 z-20">
                          <tr>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">이름</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">구분</th>
                            {(dashboard.hasBreakfast || dashboard.hasLunch) && (
                              <th className="p-2 text-left bg-muted whitespace-nowrap">식사</th>
                            )}
                            <th className="p-2 text-left bg-muted whitespace-nowrap">체크인 시각</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">출처</th>
                            <th className="p-2 text-center w-16 bg-muted whitespace-nowrap">수정</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedRecords.map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="p-2 whitespace-nowrap">{r.role === "STUDENT" ? `${r.grade}-${r.classNum} ${r.number}번 ${r.userName}` : `${r.userName} 선생님`}</td>
                              <td className="p-2 whitespace-nowrap">
                                <Badge variant="outline" className={`text-xs ${
                                  r.type === "WORK" ? "border-blue-300 text-blue-600 dark:text-blue-400" :
                                  r.type === "PERSONAL" ? "border-green-300 text-green-600 dark:text-green-400" : ""
                                }`}>
                                  {r.type === "STUDENT" ? `${r.grade}학년` : r.type === "WORK" ? "근무" : "개인"}
                                </Badge>
                              </td>
                              {(dashboard.hasBreakfast || dashboard.hasLunch) && (
                                <td className="p-2 whitespace-nowrap">
                                  <Badge variant="outline" className={`text-xs ${
                                    r.mealKind === "BREAKFAST"
                                      ? "border-amber-300 text-amber-600 dark:text-amber-400"
                                      : r.mealKind === "LUNCH"
                                        ? "border-orange-300 text-orange-600 dark:text-orange-400"
                                        : "border-slate-300 text-slate-600 dark:text-slate-400"
                                  }`}>
                                    {r.mealKind ? MEAL_LABEL[r.mealKind] : "석식"}
                                  </Badge>
                                </td>
                              )}
                              <td className="p-2 whitespace-nowrap">{formatDateTimeKST(new Date(r.checkedAt))}</td>
                              <td className="p-2 whitespace-nowrap">
                                {r.source ? (
                                  <Badge variant="outline" className={`text-xs ${
                                    r.source === "ADMIN_MANUAL" ? "border-amber-300 text-amber-600 dark:text-amber-400" :
                                    r.source === "LOCAL_SYNC" ? "border-sky-300 text-sky-600 dark:text-sky-400" :
                                    "border-muted-foreground/40 text-muted-foreground"
                                  }`}>
                                    {sourceLabel(r.source)}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </td>
                              <td className="p-2 text-center whitespace-nowrap">
                                {r.role === "TEACHER" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 disabled:opacity-60 disabled:cursor-not-allowed"
                                    disabled={adminPerm.isSubadmin}
                                    onClick={() => {
                                      if (adminPerm.isSubadmin) return;
                                      handleToggleCheckinType(r);
                                    }}
                                    title={adminPerm.isSubadmin ? "권한 없음" : `${r.type === "WORK" ? "개인" : "근무"}으로 변경`}
                                  >
                                    <ArrowLeftRight className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {!adminPerm.isSubadmin && (
          <TabsContent value="settings" className="flex-1 min-h-0 mt-1 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0 h-full flex flex-col">
              <CardContent className="pt-2 space-y-6 flex-1 min-h-0 overflow-y-auto">
                <div>
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Settings className="h-4 w-4" /> 시스템 설정
                  </h3>

                  {/* Operation Mode */}
                  <div className="flex items-center justify-between p-4 border rounded-xl">
                    <div>
                      <p className="font-medium">운영 모드</p>
                      <p className="text-sm text-muted-foreground">
                        {sysMode === "online"
                          ? "온라인 — JWT 토큰 QR (3분 갱신)"
                          : "로컬 — 고유 QR코드 (오프라인 체크인)"}
                      </p>
                    </div>
                    <Button
                      variant={sysMode === "local" ? "default" : "outline"}
                      size="sm"
                      onClick={handleModeToggle}
                      disabled={sysLoading}
                    >
                      {sysMode === "online" ? "로컬 모드로 전환" : "온라인 모드로 전환"}
                    </Button>
                  </div>

                  {/* QR Generation */}
                  <div className="flex items-center justify-between p-4 border rounded-xl mt-3">
                    <div>
                      <p className="font-medium">QR 세대</p>
                      <p className="text-sm text-muted-foreground">
                        현재: {sysGeneration}세대 — 새로고침 시 기존 QR 모두 무효화
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefreshQR}
                      disabled={sysLoading}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" /> QR 새로고침
                    </Button>
                  </div>

                  {/* Data Sync for Tablets */}
                  <div className="flex items-center justify-between p-4 border rounded-xl mt-3">
                    <div>
                      <p className="font-medium">태블릿 데이터 동기화</p>
                      <p className="text-sm text-muted-foreground">
                        사용자·석식기간·설정을 이 기기에 저장합니다
                      </p>
                      {syncStatus && (
                        <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">{syncStatus}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleOpenLocalData}
                        className="relative"
                      >
                        <Database className="h-4 w-4 mr-1" />
                        로컬 데이터
                        {unsyncedBadgeCount > 0 && (
                          <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-xs font-medium rounded-full bg-red-500 text-white">
                            {unsyncedBadgeCount}
                          </span>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAdminSync}
                        disabled={isSyncing}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        {isSyncing ? "동기화 중..." : "데이터 동기화"}
                      </Button>
                    </div>
                  </div>

                  {/* Meal Time Windows */}
                  <div className="p-4 border rounded-xl mt-3">
                    <p className="font-medium">식사 시간 윈도우</p>
                    <p className="text-sm text-muted-foreground">
                      QR 체크인이 가능한 시간대입니다. 시간 외 스캔은 거부됩니다.
                    </p>

                    {windowsLoadFailed && (
                      <p className="text-sm text-red-600 dark:text-red-400 mt-3">
                        설정을 불러올 수 없습니다. 새로고침 해주세요.
                      </p>
                    )}

                    {windowsForm && (
                      <>
                        <div className="mt-3 space-y-2">
                          {(["breakfast", "lunch", "dinner"] as const).map((meal) => (
                            <div
                              key={meal}
                              className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
                            >
                              <span className="font-medium text-sm whitespace-nowrap w-12">
                                {meal === "breakfast" ? "조식" : meal === "lunch" ? "중식" : "석식"}
                              </span>
                              <div className="flex items-center gap-2">
                                <Label htmlFor={`${meal}-start`} className="text-sm whitespace-nowrap">
                                  시작
                                </Label>
                                <Input
                                  id={`${meal}-start`}
                                  type="time"
                                  value={windowsForm[meal].start}
                                  onChange={(e) =>
                                    handleWindowsChange(meal, "start", e.target.value)
                                  }
                                  disabled={sysLoading}
                                  className="w-32"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <Label htmlFor={`${meal}-end`} className="text-sm whitespace-nowrap">
                                  종료
                                </Label>
                                <Input
                                  id={`${meal}-end`}
                                  type="time"
                                  value={windowsForm[meal].end}
                                  onChange={(e) =>
                                    handleWindowsChange(meal, "end", e.target.value)
                                  }
                                  disabled={sysLoading}
                                  className="w-32"
                                />
                              </div>
                            </div>
                          ))}
                        </div>

                        {windowsError && (
                          <p className="text-sm text-red-600 dark:text-red-400 mt-3 flex items-center gap-1">
                            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                            {windowsError}
                          </p>
                        )}

                        <div className="flex justify-end mt-3">
                          <Button
                            size="sm"
                            onClick={handleSaveWindows}
                            disabled={
                              sysLoading ||
                              !sysWindows ||
                              !!windowsError ||
                              JSON.stringify(windowsForm) === JSON.stringify(sysWindows)
                            }
                          >
                            저장
                          </Button>
                        </div>
                      </>
                    )}
                  </div>

                  {sysMode === "local" && (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mt-3">
                      태블릿에서 동기화를 실행해야 설정이 반영됩니다.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          )}
        </Tabs>
      </div>

      <Dialog open={localDataDialogOpen} onOpenChange={handleCloseLocalData}>
        <DialogContent className="max-w-3xl max-h-[calc(100dvh-1rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>로컬 저장 데이터 (서버 미전송)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <LocalCheckInsTable
              rows={localRows}
              loading={localLoading}
              errorMessage={localError}
            />
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportLocalDataExcel}
                disabled={exportingExcel || localRows.length === 0}
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                {exportingExcel ? "다운로드 중..." : "Excel 다운로드"}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => handleCloseLocalData(false)}
              >
                닫기
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sheet Import Dialog */}
      <Dialog open={sheetDialogOpen} onOpenChange={setSheetDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Google Spreadsheet 가져오기</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border bg-muted/40 p-3 text-sm">
              <p className="font-medium text-foreground">시트 헤더 안내</p>
              <p className="mt-1 text-xs text-muted-foreground">첫 번째 행(head)에 아래 항목을 순서대로 입력해 주세요.</p>
              <div className="mt-3 space-y-2">
                {sheetImportGuides.map((guide) => (
                  <div key={guide.label} className="flex items-center gap-2 overflow-x-auto">
                    <p className="shrink-0 whitespace-nowrap text-xs font-medium text-muted-foreground">{guide.label}</p>
                    <div className="flex gap-1.5">
                      {guide.columns.map((column) => (
                        <code key={column} className="whitespace-nowrap rounded-md bg-background px-2 py-1 text-xs text-foreground">
                          {column}
                        </code>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                <code>gender</code> 열은 학생만 필수입니다. &quot;남&quot; 또는 &quot;여&quot;로 입력하세요. (M/F·male/female 도 허용)
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                ⚠️ 기존 시트를 사용 중이라면 가장 오른쪽에 <code>gender</code> 열을 추가하고 학생별 값을 채운 뒤 가져오기 해주세요.
              </p>
            </div>
            <div><Label>학생 시트 URL</Label><Input placeholder="https://docs.google.com/spreadsheets/d/..." value={studentSheetUrl} onChange={(e) => setStudentSheetUrl(e.target.value)} className="rounded-xl" /></div>
            <div><Label>교사 시트 URL</Label><Input placeholder="https://docs.google.com/spreadsheets/d/..." value={teacherSheetUrl} onChange={(e) => setTeacherSheetUrl(e.target.value)} className="rounded-xl" /></div>
            <Button onClick={handleImport} disabled={importing} className="w-full">{importing ? "가져오는 중..." : "Data 호출"}</Button>
            {importMessage && <p className="text-sm text-green-600 dark:text-green-400">{importMessage}</p>}
            {importError && <p className="text-sm text-red-600 dark:text-red-400 whitespace-pre-line">{importError}</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto">
          <DialogHeader><DialogTitle>사용자 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>역할</Label>
              <Select value={addForm.role} onValueChange={(v) => setAddForm({ ...addForm, role: v as "STUDENT" | "TEACHER", gender: "" })}>
                <SelectTrigger><SelectValue>{(v: string) => (v === "STUDENT" ? "학생" : "교사")}</SelectValue></SelectTrigger>
                <SelectContent><SelectItem value="STUDENT">학생</SelectItem><SelectItem value="TEACHER">교사</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>이메일</Label><Input value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} /></div>
            <div><Label>이름</Label><Input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} /></div>
            {addForm.role === "STUDENT" && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>학년</Label><Input type="number" value={addForm.grade} onChange={(e) => setAddForm({ ...addForm, grade: e.target.value })} /></div>
                  <div><Label>반</Label><Input type="number" value={addForm.classNum} onChange={(e) => setAddForm({ ...addForm, classNum: e.target.value })} /></div>
                  <div><Label>번호</Label><Input type="number" value={addForm.number} onChange={(e) => setAddForm({ ...addForm, number: e.target.value })} /></div>
                </div>
                <div>
                  <Label>성별 *</Label>
                  <div className="flex gap-4 mt-1">
                    <label className="flex items-center gap-2 min-h-11 min-w-11 px-2 cursor-pointer">
                      <input
                        type="radio"
                        name="add-gender"
                        value="MALE"
                        checked={addForm.gender === "MALE"}
                        onChange={() => setAddForm({ ...addForm, gender: "MALE" })}
                      />
                      <span>남</span>
                    </label>
                    <label className="flex items-center gap-2 min-h-11 min-w-11 px-2 cursor-pointer">
                      <input
                        type="radio"
                        name="add-gender"
                        value="FEMALE"
                        checked={addForm.gender === "FEMALE"}
                        onChange={() => setAddForm({ ...addForm, gender: "FEMALE" })}
                      />
                      <span>여</span>
                    </label>
                  </div>
                </div>
              </>
            )}
            {addForm.role === "TEACHER" && (
              <>
                <div><Label>교과명</Label><Input value={addForm.subject} onChange={(e) => setAddForm({ ...addForm, subject: e.target.value })} /></div>
                <div><Label>담임 (예: 2-6)</Label><Input value={addForm.homeroom} onChange={(e) => setAddForm({ ...addForm, homeroom: e.target.value })} /></div>
                <div><Label>직책</Label><Input value={addForm.position} onChange={(e) => setAddForm({ ...addForm, position: e.target.value })} /></div>
                <div>
                  <Label>성별 (선택)</Label>
                  <div className="flex items-center gap-4 mt-1">
                    <label className="flex items-center gap-2 min-h-11 min-w-11 px-2 cursor-pointer">
                      <input
                        type="radio"
                        name="add-gender"
                        value="MALE"
                        checked={addForm.gender === "MALE"}
                        onChange={() => setAddForm({ ...addForm, gender: "MALE" })}
                      />
                      <span>남</span>
                    </label>
                    <label className="flex items-center gap-2 min-h-11 min-w-11 px-2 cursor-pointer">
                      <input
                        type="radio"
                        name="add-gender"
                        value="FEMALE"
                        checked={addForm.gender === "FEMALE"}
                        onChange={() => setAddForm({ ...addForm, gender: "FEMALE" })}
                      />
                      <span>여</span>
                    </label>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline min-h-11 px-2"
                      onClick={() => setAddForm({ ...addForm, gender: "" })}
                    >
                      선택 해제
                    </button>
                  </div>
                </div>
              </>
            )}
            <Button onClick={handleAddUser} className="w-full">추가</Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
