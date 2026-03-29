"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { LogOut, Plus, Download, Trash2, Pencil } from "lucide-react";
import { AdminMealTable } from "@/components/AdminMealTable";

interface User {
  id: number; email: string; name: string; role: string;
  grade?: number; classNum?: number; number?: number;
  subject?: string; homeroom?: string; position?: string;
  mealPeriod?: { startDate: string; endDate: string } | null;
}

interface DashboardData {
  date: string; studentCount: number; teacherWorkCount: number; teacherPersonalCount: number;
  records: { userName: string; role: string; type: string; checkedAt: string; grade?: number; classNum?: number; number?: number; }[];
}

const emptyForm = {
  role: "STUDENT" as "STUDENT" | "TEACHER",
  email: "", name: "", grade: "", classNum: "", number: "",
  subject: "", homeroom: "", position: "", startDate: "", endDate: "",
};

export default function AdminPage() {
  const [studentSheetUrl, setStudentSheetUrl] = useState("");
  const [teacherSheetUrl, setTeacherSheetUrl] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
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
  useEffect(() => { fetchUsers(); fetchDashboard(); }, [userFilter]);

  async function handleImport() {
    setImporting(true); setImportMessage("");
    const res = await fetch("/api/admin/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentSheetUrl, teacherSheetUrl }),
    });
    const data = await res.json();
    setImportMessage(data.message || data.error);
    setImporting(false); fetchUsers();
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

    // Update meal period if student
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

  async function handleExport() {
    const res = await fetch("/api/admin/export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `석식현황_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b p-4 flex items-center justify-between">
        <h1 className="font-bold text-lg">PosanDinner Admin</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => signOut({ callbackUrl: "/" })}><LogOut className="h-5 w-5" /></Button>
        </div>
      </header>
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Spreadsheet Import */}
        <Card>
          <CardHeader><CardTitle className="text-base">Google Spreadsheet 가져오기</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>학생 시트 URL</Label><Input placeholder="https://docs.google.com/spreadsheets/d/..." value={studentSheetUrl} onChange={(e) => setStudentSheetUrl(e.target.value)} /></div>
            <div><Label>교사 시트 URL</Label><Input placeholder="https://docs.google.com/spreadsheets/d/..." value={teacherSheetUrl} onChange={(e) => setTeacherSheetUrl(e.target.value)} /></div>
            <Button onClick={handleImport} disabled={importing}>{importing ? "가져오는 중..." : "Data 호출"}</Button>
            {importMessage && <p className="text-sm text-muted-foreground">{importMessage}</p>}
          </CardContent>
        </Card>

        <Tabs defaultValue="users">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="users">사용자 관리</TabsTrigger>
            <TabsTrigger value="meals">석식 확인</TabsTrigger>
            <TabsTrigger value="dashboard">당일 현황</TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex gap-2">
                    <Button variant={userFilter === "STUDENT" ? "default" : "outline"} size="sm" onClick={() => setUserFilter("STUDENT")}>학생</Button>
                    <Button variant={userFilter === "TEACHER" ? "default" : "outline"} size="sm" onClick={() => setUserFilter("TEACHER")}>교사</Button>
                  </div>
                  <Button size="sm" onClick={() => { setAddForm({ ...emptyForm, role: userFilter }); setAddDialogOpen(true); }}>
                    <Plus className="h-4 w-4 mr-1" /> 추가
                  </Button>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="p-2 text-left">이름</th>
                        <th className="p-2 text-left">{userFilter === "STUDENT" ? "학년-반-번호" : "교과/담임"}</th>
                        <th className="p-2 text-left">{userFilter === "STUDENT" ? "신청기간" : "직책"}</th>
                        <th className="p-2 text-center w-24">관리</th>
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

          <TabsContent value="meals">
            <Card>
              <CardContent className="pt-6">
                <AdminMealTable />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dashboard">
            <Card>
              <CardContent className="pt-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">오늘의 석식 현황</h3>
                  <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" /> Excel 다운로드</Button>
                </div>
                {dashboard && (
                  <>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="border rounded-lg p-3 text-center"><p className="text-2xl font-bold">{dashboard.studentCount}</p><p className="text-xs text-muted-foreground">학생</p></div>
                      <div className="border rounded-lg p-3 text-center"><p className="text-2xl font-bold">{dashboard.teacherWorkCount}</p><p className="text-xs text-muted-foreground">교사(근무)</p></div>
                      <div className="border rounded-lg p-3 text-center"><p className="text-2xl font-bold">{dashboard.teacherPersonalCount}</p><p className="text-xs text-muted-foreground">교사(개인)</p></div>
                    </div>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted"><tr><th className="p-2 text-left">이름</th><th className="p-2 text-left">구분</th><th className="p-2 text-left">체크인 시각</th></tr></thead>
                        <tbody>
                          {dashboard.records.map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="p-2">{r.role === "STUDENT" ? `${r.grade}-${r.classNum} ${r.number}번 ${r.userName}` : `${r.userName} 선생님`}</td>
                              <td className="p-2"><Badge variant="outline" className="text-xs">{r.type === "STUDENT" ? "학생" : r.type === "WORK" ? "근무" : "개인"}</Badge></td>
                              <td className="p-2">{new Date(r.checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</td>
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
        </Tabs>
      </div>

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
