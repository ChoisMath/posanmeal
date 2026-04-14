"use client";

import { useState, useEffect, useMemo } from "react";
import { signOut } from "next-auth/react";
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
import { LogOut, Plus, Download, Trash2, Pencil, FileSpreadsheet, ArrowLeftRight, RefreshCw, Camera, Settings, X, Users, Search } from "lucide-react";
import Link from "next/link";
import { AdminMealTable } from "@/components/AdminMealTable";
import { toast } from "sonner";
import { useAdminPermission } from "@/hooks/useAdminPermission";

interface User {
  id: number; email: string; name: string; role: string;
  grade?: number; classNum?: number; number?: number;
  subject?: string; homeroom?: string; position?: string;
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
}

interface MealAppItem {
  id: number;
  title: string;
  description: string | null;
  type: string;
  applyStart: string;
  applyEnd: string;
  mealStart: string | null;
  mealEnd: string | null;
  status: string;
  _count: { registrations: number };
  cancelledCount: number;
}

interface RegistrationItem {
  id: number;
  userId: number;
  status: string;
  createdAt: string;
  addedBy: string | null;
  cancelledBy: string | null;
  user: { id: number; name: string; grade: number; classNum: number; number: number };
}

interface DashboardRecord {
  id: number; userName: string; role: string; type: string; checkedAt: string; grade?: number; classNum?: number; number?: number;
}

interface DashboardData {
  date: string; studentCount: number; teacherWorkCount: number; teacherPersonalCount: number;
  records: DashboardRecord[];
}

const emptyForm = {
  role: "STUDENT" as "STUDENT" | "TEACHER",
  email: "", name: "", grade: "", classNum: "", number: "",
  subject: "", homeroom: "", position: "",
};

const emptyAppForm = { title: "", description: "", type: "DINNER", applyStart: "", applyEnd: "", mealStart: "", mealEnd: "" };

export default function AdminPage() {
  const adminPerm = useAdminPermission();
  const [users, setUsers] = useState<User[]>([]);
  const [userFilter, setUserFilter] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  // Add dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({ ...emptyForm });

  // Edit dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ ...emptyForm });

  // Sheet import dialog
  const [sheetDialogOpen, setSheetDialogOpen] = useState(false);
  const [studentSheetUrl, setStudentSheetUrl] = useState("");
  const [teacherSheetUrl, setTeacherSheetUrl] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);

  // Applications (신청관리)
  const [apps, setApps] = useState<MealAppItem[]>([]);
  const [appDialogOpen, setAppDialogOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<MealAppItem | null>(null);
  const [regDialogOpen, setRegDialogOpen] = useState(false);
  const [selectedAppForReg, setSelectedAppForReg] = useState<MealAppItem | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationItem[]>([]);
  const [addStudentDialogOpen, setAddStudentDialogOpen] = useState(false);
  const [regGradeFilter, setRegGradeFilter] = useState<number | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [appForm, setAppForm] = useState(emptyAppForm);

  // Excel import/export dialog
  const [excelDialogOpen, setExcelDialogOpen] = useState(false);
  const [excelApp, setExcelApp] = useState<MealAppItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ added: number; skippedExisting: number; skippedNotFound: number } | null>(null);

  // System settings
  const [sysMode, setSysMode] = useState<"online" | "local">("online");
  const [sysGeneration, setSysGeneration] = useState(1);
  const [sysLoading, setSysLoading] = useState(false);

  async function fetchSystemSettings() {
    const res = await fetch("/api/system/settings");
    const data = await res.json();
    setSysMode(data.operationMode);
    setSysGeneration(data.qrGeneration);
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

  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  async function handleAdminSync() {
    setIsSyncing(true);
    setSyncStatus(null);
    try {
      const { setSetting, replaceAllUsers, replaceAllEligibleUsers, getUnsyncedCheckIns, markCheckInsSynced } = await import("@/lib/local-db");
      const messages: string[] = [];

      // 1. Upload unsynced check-ins first (data loss prevention)
      const unsynced = await getUnsyncedCheckIns();
      if (unsynced.length > 0) {
        const payload = unsynced.map((ci) => ({
          userId: ci.userId,
          date: ci.date,
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
          const ids = unsynced.map((ci) => ci.id!);
          await markCheckInsSynced(ids);
          messages.push(`업로드: ${upData.accepted}건 전송, ${upData.duplicates}건 중복`);
        } else {
          messages.push("체크인 업로드 실패");
        }
      }

      // 2. Download latest data
      const res = await fetch("/api/sync/download");
      if (!res.ok) {
        setSyncStatus("다운로드 실패. 서버 상태를 확인하세요.");
        setIsSyncing(false);
        return;
      }
      const data = await res.json();

      await setSetting("operationMode", data.operationMode);
      await setSetting("qrGeneration", data.qrGeneration.toString());
      await replaceAllUsers(data.users);
      await replaceAllEligibleUsers(data.eligibleUserIds);
      await setSetting("lastSyncAt", new Date().toISOString());

      messages.push(`다운로드: 사용자 ${data.users.length}명, 자격자 ${data.eligibleUserIds.length}명`);
      setSyncStatus(`동기화 완료 — ${messages.join(" | ")}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Admin sync error:", err);
      setSyncStatus(`동기화 오류: ${msg}`);
    }
    setIsSyncing(false);
  }

  async function fetchUsers() {
    const res = await fetch(`/api/admin/users?role=${userFilter}`);
    const data = await res.json();
    setUsers(data.users || []);
  }

  async function fetchDashboard() {
    const res = await fetch("/api/admin/dashboard");
    const data = await res.json();
    setDashboard(data);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchUsers(); fetchDashboard(); fetchSystemSettings(); fetchApps(); }, [userFilter]);

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
    const body: Record<string, unknown> = { role: addForm.role, email: addForm.email, name: addForm.name };
    if (addForm.role === "STUDENT") {
      body.grade = parseInt(addForm.grade); body.classNum = parseInt(addForm.classNum);
      body.number = parseInt(addForm.number);
    } else {
      body.subject = addForm.subject; body.homeroom = addForm.homeroom; body.position = addForm.position;
    }
    await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setAddDialogOpen(false);
    setAddForm({ ...emptyForm });
    fetchUsers();
  }

  function openEditDialog(user: User) {
    setEditUser(user);
    setEditForm({
      role: user.role as "STUDENT" | "TEACHER",
      email: user.email,
      name: user.name,
      grade: user.grade?.toString() || "",
      classNum: user.classNum?.toString() || "",
      number: user.number?.toString() || "",
      subject: user.subject || "",
      homeroom: user.homeroom || "",
      position: user.position || "",
    });
    setEditDialogOpen(true);
  }

  async function handleEditUser() {
    if (!editUser) return;
    const body: Record<string, unknown> = { id: editUser.id, name: editForm.name, email: editForm.email };
    if (editUser.role === "STUDENT") {
      body.grade = parseInt(editForm.grade); body.classNum = parseInt(editForm.classNum);
      body.number = parseInt(editForm.number);
    } else {
      body.subject = editForm.subject; body.homeroom = editForm.homeroom; body.position = editForm.position;
    }
    await fetch("/api/admin/users", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    setEditDialogOpen(false);
    setEditUser(null);
    fetchUsers();
  }

  async function handleDeleteUser(id: number) {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
    fetchUsers();
  }

  const labelOfAdminLevel = (lvl: "NONE" | "SUBADMIN" | "ADMIN") =>
    lvl === "ADMIN" ? "관리자" : lvl === "SUBADMIN" ? "서브관리자" : "일반";

  async function handleAdminLevelChange(
    user: User,
    newLevel: "NONE" | "SUBADMIN" | "ADMIN"
  ) {
    if (newLevel === user.adminLevel) return;
    const ok = window.confirm(
      `"${user.name}"의 권한을 "${labelOfAdminLevel(newLevel)}"(으)로 변경하시겠습니까?`
    );
    if (!ok) return;

    const res = await fetch("/api/admin/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        name: user.name,
        grade: user.grade ?? null,
        classNum: user.classNum ?? null,
        number: user.number ?? null,
        subject: user.subject ?? null,
        homeroom: user.homeroom ?? null,
        position: user.position ?? null,
        adminLevel: newLevel,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data?.reason ?? "권한 변경에 실패했습니다.");
      return;
    }
    toast.success("권한 변경 완료. 대상자가 다음 로그인 시 적용됩니다.");
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
    const res = await fetch("/api/admin/export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `석식현황_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
  }

  // --- 신청관리 functions ---
  async function fetchApps() {
    const res = await fetch("/api/admin/applications");
    if (res.ok) { const data = await res.json(); setApps(data.applications); }
  }

  async function fetchRegistrations(appId: number) {
    const res = await fetch(`/api/admin/applications/${appId}/registrations`);
    if (res.ok) { const data = await res.json(); setRegistrations(data.registrations); }
  }

  async function handleCreateApp() {
    const res = await fetch("/api/admin/applications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(appForm),
    });
    if (res.ok) { toast.success("공고가 생성되었습니다."); setAppDialogOpen(false); setAppForm(emptyAppForm); fetchApps(); }
    else { const d = await res.json(); toast.error(d.error || "생성 실패"); }
  }

  async function handleUpdateApp() {
    if (!editingApp) return;
    const res = await fetch(`/api/admin/applications/${editingApp.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(appForm),
    });
    if (res.ok) { toast.success("공고가 수정되었습니다."); setAppDialogOpen(false); setEditingApp(null); setAppForm(emptyAppForm); fetchApps(); }
    else { const d = await res.json(); toast.error(d.error || "수정 실패"); }
  }

  async function handleDeleteApp(app: MealAppItem) {
    if (!confirm(`"${app.title}" 공고를 삭제하시겠습니까? 모든 신청 데이터가 삭제됩니다.`)) return;
    const res = await fetch(`/api/admin/applications/${app.id}`, { method: "DELETE" });
    if (res.ok) { toast.success("공고가 삭제되었습니다."); fetchApps(); }
    else { const d = await res.json(); toast.error(d.error || "삭제 실패"); }
  }

  async function handleCancelReg(regId: number) {
    if (!selectedAppForReg) return;
    const res = await fetch(`/api/admin/applications/${selectedAppForReg.id}/registrations/${regId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });
    if (res.ok) { toast.success("신청이 취소되었습니다."); fetchRegistrations(selectedAppForReg.id); fetchApps(); }
    else { toast.error("취소 실패"); }
  }

  async function handleRestoreReg(regId: number) {
    if (!selectedAppForReg) return;
    const res = await fetch(`/api/admin/applications/${selectedAppForReg.id}/registrations/${regId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    if (res.ok) { toast.success("신청이 복원되었습니다."); fetchRegistrations(selectedAppForReg.id); fetchApps(); }
    else { toast.error("복원 실패"); }
  }

  async function handleAdminAddStudent(userId: number) {
    if (!selectedAppForReg) return;
    const res = await fetch(`/api/admin/applications/${selectedAppForReg.id}/registrations`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) { toast.success("학생이 추가되었습니다."); setAddStudentDialogOpen(false); fetchRegistrations(selectedAppForReg.id); fetchApps(); }
    else { const d = await res.json(); toast.error(d.error || "추가 실패"); }
  }

  function openExcelDialog(app: MealAppItem) {
    setExcelApp(app);
    setUploadResult(null);
    setExcelDialogOpen(true);
  }

  async function handleDownloadExcel(appId: number, title: string, template: boolean) {
    const url = template
      ? `/api/admin/applications/${appId}/export?template=true`
      : `/api/admin/applications/${appId}/export`;
    const res = await fetch(url);
    if (!res.ok) { toast.error("다운로드 실패"); return; }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = blobUrl;
    a.download = template ? `${title}_양식.xlsx` : `${title}_신청명단.xlsx`;
    a.click(); URL.revokeObjectURL(blobUrl);
  }

  async function handleUploadExcel(appId: number, file: File) {
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/admin/applications/${appId}/import`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setUploadResult(data);
        toast.success(`${data.added}명 등록 완료`);
        fetchApps();
        if (selectedAppForReg && selectedAppForReg.id === appId) {
          fetchRegistrations(appId);
        }
      } else {
        const data = await res.json();
        toast.error(data.error || "업로드 실패");
      }
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    }
    setUploading(false);
  }

  // Filtered students for add-student dialog
  const filteredStudentsForAdd = useMemo(() => {
    if (!addStudentDialogOpen) return [];
    const registeredIds = new Set(registrations.map((r) => r.userId));
    return users
      .filter((u) => u.role === "STUDENT" && !registeredIds.has(u.id))
      .filter((u) => {
        if (!studentSearch) return true;
        const s = studentSearch.toLowerCase();
        return u.name.toLowerCase().includes(s) || `${u.grade}-${u.classNum}-${u.number}`.includes(s);
      })
      .sort((a, b) => {
        if ((a.grade || 0) !== (b.grade || 0)) return (a.grade || 0) - (b.grade || 0);
        if ((a.classNum || 0) !== (b.classNum || 0)) return (a.classNum || 0) - (b.classNum || 0);
        return (a.number || 0) - (b.number || 0);
      });
  }, [addStudentDialogOpen, users, registrations, studentSearch]);

  // 당일현황: 학년별 카운트 + 정렬 (memoized)
  const { grade1Count, grade2Count, grade3Count, sortedRecords } = useMemo(() => {
    const records = dashboard?.records || [];
    return {
      grade1Count: records.filter((r) => r.role === "STUDENT" && r.grade === 1).length,
      grade2Count: records.filter((r) => r.role === "STUDENT" && r.grade === 2).length,
      grade3Count: records.filter((r) => r.role === "STUDENT" && r.grade === 3).length,
      sortedRecords: [...records].sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()),
    };
  }, [dashboard]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-warm-subtle">
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
          <Button variant="ghost" size="icon" className="text-white/80 hover:text-white hover:bg-white/10" onClick={() => signOut({ callbackUrl: "/" })}><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>
      <div className="flex-1 min-h-0 w-full max-w-5xl mx-auto p-4 md:p-6 flex flex-col overflow-hidden page-enter">
        <Tabs
          defaultValue="users"
          className="flex flex-col flex-1 min-h-0"
          onValueChange={(v) => {
            if (v === "dashboard") fetchDashboard();
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
            <TabsTrigger value="meals" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">석식 확인</TabsTrigger>
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
                <div className="border rounded-lg overflow-auto max-h-[70vh]">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead className="sticky top-0 z-20">
                      <tr>
                        <th className="p-2 text-left bg-muted">이름</th>
                        <th className="p-2 text-left bg-muted">{userFilter === "STUDENT" ? "학년-반-번호" : "교과/담임"}</th>
                        <th className="p-2 text-left bg-muted">{userFilter === "STUDENT" ? "이메일" : "직책"}</th>
                        <th className="p-2 text-left bg-muted whitespace-nowrap">권한</th>
                        <th className="p-2 text-center w-24 bg-muted">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-t">
                          <td className="p-2">{u.name}</td>
                          <td className="p-2">{u.role === "STUDENT" ? `${u.grade}-${u.classNum}-${u.number}` : `${u.subject || "-"} / ${u.homeroom || "비담임"}`}</td>
                          <td className="p-2">{u.role === "STUDENT" ? u.email : u.position || "-"}</td>
                          <td className="p-2 whitespace-nowrap">
                            {u.role === "STUDENT" ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <select
                                value={u.adminLevel}
                                disabled={
                                  !adminPerm.canWrite ||
                                  (adminPerm.dbUserId === u.id && u.adminLevel === "ADMIN")
                                }
                                onChange={(e) => handleAdminLevelChange(u, e.target.value as "NONE" | "SUBADMIN" | "ADMIN")}
                                className="rounded-md border px-2 py-1 text-sm bg-background disabled:opacity-60"
                              >
                                <option value="NONE">일반</option>
                                <option value="SUBADMIN">서브관리자</option>
                                <option value="ADMIN">관리자</option>
                              </select>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            {adminPerm.canWrite && (
                              <div className="flex justify-center gap-1">
                                <Button variant="ghost" size="icon" onClick={() => openEditDialog(u)}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteUser(u.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                              </div>
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
                  <h3 className="font-semibold">석식 신청 공고</h3>
                  <Button size="sm" onClick={() => { setEditingApp(null); setAppForm(emptyAppForm); setAppDialogOpen(true); }}>
                    <Plus className="h-4 w-4 mr-1" /> 공고
                  </Button>
                </div>
                {apps.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">등록된 공고가 없습니다.</p>
                ) : (
                  <div className="space-y-3">
                    {apps.map((app) => (
                      <div key={app.id} className="border rounded-xl p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant="outline" className="text-xs">
                                {app.type === "DINNER" ? "석식" : app.type === "BREAKFAST" ? "조식" : "기타"}
                              </Badge>
                              {(() => {
                                const today = new Date().toISOString().slice(0, 10);
                                const applyEnd = app.applyEnd.slice(0, 10);
                                const mealEnd = app.mealEnd ? app.mealEnd.slice(0, 10) : null;
                                const applyStart = app.applyStart.slice(0, 10);
                                if (today >= applyStart && today <= applyEnd) {
                                  return <Badge variant="default" className="text-xs">신청중</Badge>;
                                } else if (mealEnd && today <= mealEnd) {
                                  return <Badge className="text-xs bg-green-600 hover:bg-green-700">급식중</Badge>;
                                } else {
                                  return <Badge variant="secondary" className="text-xs">마감</Badge>;
                                }
                              })()}
                              <span className="font-medium">{app.title}</span>
                            </div>
                            <p className="text-xs text-muted-foreground whitespace-nowrap">
                              신청: {new Date(app.applyStart).toLocaleDateString("ko-KR")} ~ {new Date(app.applyEnd).toLocaleDateString("ko-KR")}
                            </p>
                            {app.mealStart && app.mealEnd && (
                              <p className="text-xs text-muted-foreground whitespace-nowrap">
                                급식: {new Date(app.mealStart).toLocaleDateString("ko-KR")} ~ {new Date(app.mealEnd).toLocaleDateString("ko-KR")}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              신청 {app._count.registrations}명 (취소 {app.cancelledCount}명)
                            </p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="명단" onClick={() => {
                              setSelectedAppForReg(app);
                              fetchRegistrations(app.id);
                              setRegGradeFilter(null);
                              setRegDialogOpen(true);
                            }}>
                              <Users className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Excel" onClick={() => openExcelDialog(app)}>
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="수정" onClick={() => {
                              setEditingApp(app);
                              setAppForm({
                                title: app.title,
                                description: app.description || "",
                                type: app.type,
                                applyStart: app.applyStart.slice(0, 10),
                                applyEnd: app.applyEnd.slice(0, 10),
                                mealStart: app.mealStart ? app.mealStart.slice(0, 10) : "",
                                mealEnd: app.mealEnd ? app.mealEnd.slice(0, 10) : "",
                              });
                              setAppDialogOpen(true);
                            }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="삭제" onClick={() => handleDeleteApp(app)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}

          <TabsContent value="meals" className="flex-1 min-h-0 mt-1 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0 h-full flex flex-col">
              <CardContent className="pt-2 flex-1 min-h-0 overflow-hidden">
                <AdminMealTable />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dashboard" className="flex-1 min-h-0 mt-1 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0 h-full flex flex-col">
              <CardContent className="pt-2 flex-1 min-h-0 overflow-hidden">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">오늘의 석식 현황</h3>
                  <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={fetchDashboard} aria-label="새로고침" title="새로고침">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" /> Excel 다운로드</Button>
                  </div>
                </div>
                {dashboard && (
                  <>
                    <div className="grid grid-cols-5 gap-2 sm:gap-3 mb-5">
                      {[
                        { count: grade1Count, label: "1학년", color: "from-amber-500/10 to-amber-500/5 dark:from-amber-500/20 dark:to-amber-500/10" },
                        { count: grade2Count, label: "2학년", color: "from-orange-500/10 to-orange-500/5 dark:from-orange-500/20 dark:to-orange-500/10" },
                        { count: grade3Count, label: "3학년", color: "from-rose-500/10 to-rose-500/5 dark:from-rose-500/20 dark:to-rose-500/10" },
                        { count: dashboard.teacherWorkCount, label: "교사(근무)", color: "from-blue-500/10 to-blue-500/5 dark:from-blue-500/20 dark:to-blue-500/10" },
                        { count: dashboard.teacherPersonalCount, label: "교사(개인)", color: "from-emerald-500/10 to-emerald-500/5 dark:from-emerald-500/20 dark:to-emerald-500/10" },
                      ].map(({ count, label, color }) => (
                        <div key={label} className={`bg-gradient-to-b ${color} rounded-xl p-3 text-center`}>
                          <p className="text-2xl font-bold">{count}</p>
                          <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="border rounded-lg overflow-auto max-h-[50vh]">
                      <table className="w-full text-sm whitespace-nowrap">
                        <thead className="sticky top-0 z-20">
                          <tr>
                            <th className="p-2 text-left bg-muted">이름</th>
                            <th className="p-2 text-left bg-muted">구분</th>
                            <th className="p-2 text-left bg-muted">체크인 시각</th>
                            <th className="p-2 text-center w-16 bg-muted">수정</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedRecords.map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="p-2 whitespace-nowrap">{r.role === "STUDENT" ? `${r.grade}-${r.classNum} ${r.number}번 ${r.userName}` : `${r.userName} 선생님`}</td>
                              <td className="p-2">
                                <Badge variant="outline" className={`text-xs ${
                                  r.type === "WORK" ? "border-blue-300 text-blue-600 dark:text-blue-400" :
                                  r.type === "PERSONAL" ? "border-green-300 text-green-600 dark:text-green-400" : ""
                                }`}>
                                  {r.type === "STUDENT" ? `${r.grade}학년` : r.type === "WORK" ? "근무" : "개인"}
                                </Badge>
                              </td>
                              <td className="p-2">{new Date(r.checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</td>
                              <td className="p-2 text-center">
                                {r.role === "TEACHER" && (
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleToggleCheckinType(r)} title={`${r.type === "WORK" ? "개인" : "근무"}으로 변경`}>
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
            <Card className="card-elevated rounded-2xl border-0">
              <CardContent className="pt-2 space-y-6">
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

      {/* Sheet Import Dialog */}
      <Dialog open={sheetDialogOpen} onOpenChange={setSheetDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Google Spreadsheet 가져오기</DialogTitle></DialogHeader>
          <div className="space-y-3">
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
        <DialogContent>
          <DialogHeader><DialogTitle>사용자 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>역할</Label>
              <Select value={addForm.role} onValueChange={(v) => setAddForm({ ...addForm, role: v as "STUDENT" | "TEACHER" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
              </>
            )}
            {addForm.role === "TEACHER" && (
              <>
                <div><Label>교과명</Label><Input value={addForm.subject} onChange={(e) => setAddForm({ ...addForm, subject: e.target.value })} /></div>
                <div><Label>담임 (예: 2-6)</Label><Input value={addForm.homeroom} onChange={(e) => setAddForm({ ...addForm, homeroom: e.target.value })} /></div>
                <div><Label>직책</Label><Input value={addForm.position} onChange={(e) => setAddForm({ ...addForm, position: e.target.value })} /></div>
              </>
            )}
            <Button onClick={handleAddUser} className="w-full">추가</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>사용자 편집</DialogTitle></DialogHeader>
          {editUser && (
            <div className="space-y-3">
              <div><Label>이메일</Label><Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div>
              <div><Label>이름</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              {editUser.role === "STUDENT" && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label>학년</Label><Input type="number" value={editForm.grade} onChange={(e) => setEditForm({ ...editForm, grade: e.target.value })} /></div>
                    <div><Label>반</Label><Input type="number" value={editForm.classNum} onChange={(e) => setEditForm({ ...editForm, classNum: e.target.value })} /></div>
                    <div><Label>번호</Label><Input type="number" value={editForm.number} onChange={(e) => setEditForm({ ...editForm, number: e.target.value })} /></div>
                  </div>
                </>
              )}
              {editUser.role === "TEACHER" && (
                <>
                  <div><Label>교과명</Label><Input value={editForm.subject} onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })} /></div>
                  <div><Label>담임 (예: 2-6)</Label><Input value={editForm.homeroom} onChange={(e) => setEditForm({ ...editForm, homeroom: e.target.value })} /></div>
                  <div><Label>직책</Label><Input value={editForm.position} onChange={(e) => setEditForm({ ...editForm, position: e.target.value })} /></div>
                </>
              )}
              <Button onClick={handleEditUser} className="w-full">저장</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Application Create/Edit Dialog */}
      <Dialog open={appDialogOpen} onOpenChange={(open) => { setAppDialogOpen(open); if (!open) { setEditingApp(null); setAppForm(emptyAppForm); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingApp ? "공고 수정" : "새 공고"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>유형</Label>
              <div className="flex gap-2 mt-1">
                {[{ value: "DINNER", label: "석식" }, { value: "BREAKFAST", label: "조식" }, { value: "OTHER", label: "기타" }].map(({ value, label }) => (
                  <Button key={value} variant={appForm.type === value ? "default" : "outline"} size="sm" onClick={() => setAppForm({ ...appForm, type: value })}>{label}</Button>
                ))}
              </div>
            </div>
            <div><Label>제목</Label><Input value={appForm.title} onChange={(e) => setAppForm({ ...appForm, title: e.target.value })} className="rounded-xl" placeholder="예: 4월 석식 신청" /></div>
            <div><Label>설명 (선택)</Label><textarea className="flex w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" rows={2} value={appForm.description} onChange={(e) => setAppForm({ ...appForm, description: e.target.value })} placeholder="공고 설명..." /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>신청 시작일</Label><Input type="date" value={appForm.applyStart} onChange={(e) => setAppForm({ ...appForm, applyStart: e.target.value })} className="rounded-xl" /></div>
              <div><Label>신청 마감일</Label><Input type="date" value={appForm.applyEnd} onChange={(e) => setAppForm({ ...appForm, applyEnd: e.target.value })} className="rounded-xl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>급식 시작일</Label><Input type="date" value={appForm.mealStart} onChange={(e) => setAppForm({ ...appForm, mealStart: e.target.value })} className="rounded-xl" /></div>
              <div><Label>급식 종료일</Label><Input type="date" value={appForm.mealEnd} onChange={(e) => setAppForm({ ...appForm, mealEnd: e.target.value })} className="rounded-xl" /></div>
            </div>
            <p className="text-xs text-muted-foreground">급식 기간을 비워두면 명단 수합용 공고로 사용됩니다.</p>
            <Button onClick={editingApp ? handleUpdateApp : handleCreateApp} className="w-full">{editingApp ? "수정" : "생성"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Registration List Dialog */}
      <Dialog open={regDialogOpen} onOpenChange={(open) => { setRegDialogOpen(open); if (!open) { setSelectedAppForReg(null); setRegistrations([]); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 flex-wrap">
              <span>{selectedAppForReg?.title} — 명단 ({registrations.filter((r) => r.status !== "CANCELLED").length}명)</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => { setStudentSearch(""); setAddStudentDialogOpen(true); fetchUsers(); }}>
                  <Plus className="h-4 w-4 mr-1" /> 학생 추가
                </Button>
                {selectedAppForReg && (
                  <Button size="sm" variant="outline" onClick={() => openExcelDialog(selectedAppForReg)}>
                    <Download className="h-4 w-4 mr-1" /> Excel
                  </Button>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 mb-3">
            {[{ value: null, label: "전체" }, { value: 1, label: "1학년" }, { value: 2, label: "2학년" }, { value: 3, label: "3학년" }].map(({ value, label }) => (
              <Button key={label} variant={regGradeFilter === value ? "default" : "outline"} size="sm" onClick={() => setRegGradeFilter(value)}>{label}</Button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="p-2 text-left bg-muted whitespace-nowrap">학년</th>
                  <th className="p-2 text-left bg-muted whitespace-nowrap">반</th>
                  <th className="p-2 text-left bg-muted whitespace-nowrap">번호</th>
                  <th className="p-2 text-left bg-muted whitespace-nowrap">이름</th>
                  <th className="p-2 text-left bg-muted whitespace-nowrap">신청일</th>
                  <th className="p-2 text-center bg-muted whitespace-nowrap">상태</th>
                  <th className="p-2 text-center bg-muted whitespace-nowrap">관리</th>
                </tr>
              </thead>
              <tbody>
                {registrations
                  .filter((r) => regGradeFilter === null || r.user.grade === regGradeFilter)
                  .sort((a, b) => {
                    if (a.user.grade !== b.user.grade) return a.user.grade - b.user.grade;
                    if (a.user.classNum !== b.user.classNum) return a.user.classNum - b.user.classNum;
                    return a.user.number - b.user.number;
                  })
                  .map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2 whitespace-nowrap">{r.user.grade}</td>
                      <td className="p-2 whitespace-nowrap">{r.user.classNum}</td>
                      <td className="p-2 whitespace-nowrap">{r.user.number}</td>
                      <td className="p-2 whitespace-nowrap">{r.user.name}</td>
                      <td className="p-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString("ko-KR")}</td>
                      <td className="p-2 text-center whitespace-nowrap">
                        <Badge variant={r.status === "CANCELLED" ? "secondary" : "default"} className="text-xs">
                          {r.status === "CANCELLED" ? "취소" : r.addedBy === "ADMIN" ? "관리자추가" : "승인"}
                        </Badge>
                      </td>
                      <td className="p-2 text-center whitespace-nowrap">
                        {r.status === "CANCELLED" ? (
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleRestoreReg(r.id)}>복원</Button>
                        ) : (
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => handleCancelReg(r.id)}>취소</Button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Student Dialog */}
      <Dialog open={addStudentDialogOpen} onOpenChange={setAddStudentDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>학생 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="이름 또는 학번으로 검색..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="pl-9 rounded-xl"
              />
            </div>
            <div className="max-h-64 overflow-y-auto border rounded-lg">
              {filteredStudentsForAdd.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">검색 결과가 없습니다.</p>
              ) : (
                filteredStudentsForAdd.map((u) => (
                  <button
                    key={u.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted border-b last:border-b-0 flex justify-between items-center"
                    onClick={() => handleAdminAddStudent(u.id)}
                  >
                    <span>{u.grade}-{u.classNum}-{u.number} {u.name}</span>
                    <Plus className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Excel Import/Export Dialog */}
      <Dialog open={excelDialogOpen} onOpenChange={(open) => { setExcelDialogOpen(open); if (!open) { setExcelApp(null); setUploadResult(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{excelApp?.title} — Excel</DialogTitle>
          </DialogHeader>
          {excelApp && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">다운로드</h4>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => handleDownloadExcel(excelApp.id, excelApp.title, false)}>
                    <Download className="h-4 w-4 mr-1" /> 신청명단
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => handleDownloadExcel(excelApp.id, excelApp.title, true)}>
                    <FileSpreadsheet className="h-4 w-4 mr-1" /> 양식 다운로드
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">양식: 전체 학생 목록 + 신청 여부(O) 포함</p>
              </div>

              <div className="border-t pt-4 space-y-2">
                <h4 className="text-sm font-semibold">일괄 업로드</h4>
                <p className="text-xs text-muted-foreground">양식의 &quot;신청&quot; 열에 O 표시된 학생을 일괄 등록합니다. 기존 신청자는 자동 제외됩니다.</p>
                <Input
                  type="file"
                  accept=".xlsx,.xls"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) await handleUploadExcel(excelApp.id, file);
                    e.target.value = "";
                  }}
                />
                {uploading && <p className="text-sm text-amber-600">업로드 중...</p>}
                {uploadResult && (
                  <div className="text-sm space-y-0.5 p-3 bg-muted rounded-lg">
                    <p className="font-medium">업로드 결과</p>
                    <p>신규 등록: <span className="font-bold text-green-600">{uploadResult.added}명</span></p>
                    <p>기존 신청자 (제외): <span className="text-muted-foreground">{uploadResult.skippedExisting}명</span></p>
                    {uploadResult.skippedNotFound > 0 && (
                      <p>미등록 학생 (제외): <span className="text-red-500">{uploadResult.skippedNotFound}명</span></p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
