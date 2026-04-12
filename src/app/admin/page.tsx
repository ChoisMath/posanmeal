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
import { LogOut, Plus, Download, Trash2, Pencil, FileSpreadsheet, ArrowLeftRight, RefreshCw, Camera, Settings } from "lucide-react";
import Link from "next/link";
import { AdminMealTable } from "@/components/AdminMealTable";

interface User {
  id: number; email: string; name: string; role: string;
  grade?: number; classNum?: number; number?: number;
  subject?: string; homeroom?: string; position?: string;
  mealPeriod?: { startDate: string; endDate: string } | null;
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
  subject: "", homeroom: "", position: "", startDate: "", endDate: "",
};

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [userFilter, setUserFilter] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [mealsRefreshKey, setMealsRefreshKey] = useState(0);

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
      const { setSetting, replaceAllUsers, replaceAllMealPeriods, getUnsyncedCheckIns, markCheckInsSynced } = await import("@/lib/local-db");
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
      await replaceAllMealPeriods(data.mealPeriods);
      await setSetting("lastSyncAt", new Date().toISOString());

      messages.push(`다운로드: 사용자 ${data.users.length}명, 석식기간 ${data.mealPeriods.length}건`);
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
  useEffect(() => { fetchUsers(); fetchDashboard(); fetchSystemSettings(); }, [userFilter]);

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
      body.number = parseInt(addForm.number); body.startDate = addForm.startDate; body.endDate = addForm.endDate;
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
      startDate: user.mealPeriod ? user.mealPeriod.startDate.slice(0, 10) : "",
      endDate: user.mealPeriod ? user.mealPeriod.endDate.slice(0, 10) : "",
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

    if (editUser.role === "STUDENT" && editForm.startDate && editForm.endDate) {
      await fetch("/api/admin/meal-periods", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: editUser.id, startDate: editForm.startDate, endDate: editForm.endDate }),
      });
    }

    setEditDialogOpen(false);
    setEditUser(null);
    fetchUsers();
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
    const res = await fetch("/api/admin/export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `석식현황_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
  }

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
        <div className="flex items-center gap-1">
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
            if (v === "meals") setMealsRefreshKey((k) => k + 1);
          }}
        >
          <TabsList className="grid w-full grid-cols-4 rounded-xl h-11 max-w-lg shrink-0">
            <TabsTrigger value="users" className="rounded-lg">사용자 관리</TabsTrigger>
            <TabsTrigger value="meals" className="rounded-lg">석식 확인</TabsTrigger>
            <TabsTrigger value="dashboard" className="rounded-lg">당일 현황</TabsTrigger>
            <TabsTrigger value="settings" className="rounded-lg">설정</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="flex-1 min-h-0 mt-4 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0 h-full flex flex-col">
              <CardContent className="pt-6 flex-1 min-h-0 overflow-auto">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex gap-2">
                    <Button variant={userFilter === "STUDENT" ? "default" : "outline"} size="sm" onClick={() => setUserFilter("STUDENT")}>학생</Button>
                    <Button variant={userFilter === "TEACHER" ? "default" : "outline"} size="sm" onClick={() => setUserFilter("TEACHER")}>교사</Button>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setImportMessage(""); setSheetDialogOpen(true); }}>
                      <FileSpreadsheet className="h-4 w-4 mr-1" /> Sheet연결
                    </Button>
                    <Button size="sm" onClick={() => { setAddForm({ ...emptyForm, role: userFilter }); setAddDialogOpen(true); }}>
                      <Plus className="h-4 w-4 mr-1" /> 추가
                    </Button>
                  </div>
                </div>
                <div className="border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th className="p-2 text-left bg-muted">이름</th>
                        <th className="p-2 text-left bg-muted">{userFilter === "STUDENT" ? "학년-반-번호" : "교과/담임"}</th>
                        <th className="p-2 text-left bg-muted">{userFilter === "STUDENT" ? "신청기간" : "직책"}</th>
                        <th className="p-2 text-center w-24 bg-muted">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-t">
                          <td className="p-2">{u.name}</td>
                          <td className="p-2">{u.role === "STUDENT" ? `${u.grade}-${u.classNum}-${u.number}` : `${u.subject || "-"} / ${u.homeroom || "비담임"}`}</td>
                          <td className="p-2">{u.role === "STUDENT" ? (u.mealPeriod ? `${new Date(u.mealPeriod.startDate).toLocaleDateString("ko-KR")} ~ ${new Date(u.mealPeriod.endDate).toLocaleDateString("ko-KR")}` : "미신청") : u.position || "-"}</td>
                          <td className="p-2 text-center">
                            <div className="flex justify-center gap-1">
                              <Button variant="ghost" size="icon" onClick={() => openEditDialog(u)}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteUser(u.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="meals" className="flex-1 min-h-0 mt-4 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0 h-full flex flex-col">
              <CardContent className="pt-6 flex-1 min-h-0 overflow-auto">
                <AdminMealTable refreshKey={mealsRefreshKey} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dashboard" className="flex-1 min-h-0 mt-4 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0 h-full flex flex-col">
              <CardContent className="pt-6 flex-1 min-h-0 overflow-auto">
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
                    <div className="border rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10">
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
                              <td className="p-2">{r.role === "STUDENT" ? `${r.grade}-${r.classNum} ${r.number}번 ${r.userName}` : `${r.userName} 선생님`}</td>
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

          <TabsContent value="settings" className="flex-1 min-h-0 mt-4 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0">
              <CardContent className="pt-6 space-y-6">
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
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>석식 시작일</Label><Input type="date" value={addForm.startDate} onChange={(e) => setAddForm({ ...addForm, startDate: e.target.value })} /></div>
                  <div><Label>석식 종료일</Label><Input type="date" value={addForm.endDate} onChange={(e) => setAddForm({ ...addForm, endDate: e.target.value })} /></div>
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
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>석식 시작일</Label><Input type="date" value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} /></div>
                    <div><Label>석식 종료일</Label><Input type="date" value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} /></div>
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
    </div>
  );
}
