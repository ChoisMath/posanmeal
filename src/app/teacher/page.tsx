"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";
import { QRGenerator } from "@/components/QRGenerator";
import { MonthlyCalendar } from "@/components/MonthlyCalendar";
import { PhotoUpload } from "@/components/PhotoUpload";
import { StudentTable } from "@/components/StudentTable";
import { LogOut } from "lucide-react";

interface TeacherProfile {
  id: number;
  name: string;
  email: string;
  subject: string | null;
  homeroom: string | null;
  position: string | null;
  photoUrl: string | null;
}

export default function TeacherPage() {
  const [user, setUser] = useState<TeacherProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", subject: "", homeroom: "", position: "" });

  useEffect(() => {
    fetch("/api/users/me").then((res) => res.json()).then((data) => {
      setUser(data.user);
      if (data.user) {
        setForm({
          name: data.user.name || "",
          subject: data.user.subject || "",
          homeroom: data.user.homeroom || "",
          position: data.user.position || "",
        });
      }
    });
  }, []);

  async function handleSave() {
    const res = await fetch("/api/users/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (res.ok) { setUser(data.user); setEditing(false); }
  }

  if (!user) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>;

  const isHomeroom = !!user.homeroom;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b p-4 flex items-center justify-between">
        <h1 className="font-bold text-lg">PosanDinner</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>
      <div className="max-w-4xl mx-auto p-4">
        <Tabs defaultValue="personal">
          <TabsList className={`grid w-full max-w-md mx-auto ${isHomeroom ? "grid-cols-5" : "grid-cols-4"}`}>
            <TabsTrigger value="personal">개인석식</TabsTrigger>
            <TabsTrigger value="work">근무</TabsTrigger>
            <TabsTrigger value="history">확인</TabsTrigger>
            {isHomeroom && <TabsTrigger value="students">학생관리</TabsTrigger>}
            <TabsTrigger value="profile">개인정보</TabsTrigger>
          </TabsList>

          <TabsContent value="personal">
            <Card className="max-w-md mx-auto">
              <CardContent className="pt-6 text-center">
                <QRGenerator type="PERSONAL" />
                <p className="mt-4 font-semibold">{user.name} 선생님</p>
                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium mt-1">개인 석식용 QR</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="work">
            <Card className="max-w-md mx-auto">
              <CardContent className="pt-6 text-center">
                <QRGenerator type="WORK" />
                <p className="mt-4 font-semibold">{user.name} 선생님</p>
                <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mt-1">근무 석식용 QR</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card className="max-w-md mx-auto">
              <CardContent className="pt-6">
                <h3 className="font-semibold mb-4">석식 이력</h3>
                <MonthlyCalendar showType />
              </CardContent>
            </Card>
          </TabsContent>

          {isHomeroom && (
            <TabsContent value="students">
              <Card><CardContent className="pt-6"><StudentTable /></CardContent></Card>
            </TabsContent>
          )}

          <TabsContent value="profile">
            <Card className="max-w-md mx-auto">
              <CardContent className="pt-6 space-y-4">
                <PhotoUpload currentPhotoUrl={user.photoUrl} onPhotoChange={(url) => setUser({ ...user, photoUrl: url })} />
                {editing ? (
                  <div className="space-y-3">
                    <div><Label>이름</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                    <div><Label>교과명</Label><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
                    <div><Label>담임 (예: 2-6)</Label><Input value={form.homeroom} onChange={(e) => setForm({ ...form, homeroom: e.target.value })} /></div>
                    <div><Label>직책</Label><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></div>
                    <div className="flex gap-2">
                      <Button onClick={handleSave} className="flex-1">저장</Button>
                      <Button variant="outline" onClick={() => setEditing(false)} className="flex-1">취소</Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">이메일</span><span>{user.email}</span></div>
                    <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">이름</span><span>{user.name}</span></div>
                    <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">교과명</span><span>{user.subject || "-"}</span></div>
                    <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">담임</span><span>{user.homeroom || "해당없음"}</span></div>
                    <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">직책</span><span>{user.position || "-"}</span></div>
                    <Button variant="outline" className="w-full mt-4" onClick={() => setEditing(true)}>정보 수정</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
