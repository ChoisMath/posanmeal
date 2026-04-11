"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "@/components/BrandMark";
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

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center bg-warm-subtle">
      <div className="animate-pulse text-muted-foreground">로딩 중...</div>
    </div>
  );

  const isHomeroom = !!user.homeroom;

  return (
    <div className="min-h-screen bg-warm-subtle">
      <header className="header-gradient px-4 py-3 flex items-center justify-between">
        <BrandMark variant="header" label="PosanDinner" />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" className="text-white/80 hover:text-white hover:bg-white/10" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <div className="max-w-4xl mx-auto p-4 page-enter">
        <Tabs defaultValue="personal">
          <TabsList className={`grid w-full max-w-md mx-auto rounded-xl h-11 ${isHomeroom ? "grid-cols-5" : "grid-cols-4"}`}>
            <TabsTrigger value="personal" className="rounded-lg text-xs sm:text-sm">개인석식</TabsTrigger>
            <TabsTrigger value="work" className="rounded-lg text-xs sm:text-sm">근무</TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg text-xs sm:text-sm">확인</TabsTrigger>
            {isHomeroom && <TabsTrigger value="students" className="rounded-lg text-xs sm:text-sm">학생관리</TabsTrigger>}
            <TabsTrigger value="profile" className="rounded-lg text-xs sm:text-sm">개인정보</TabsTrigger>
          </TabsList>

          <TabsContent value="personal">
            <Card className="max-w-md mx-auto card-elevated rounded-2xl border-0">
              <CardContent className="pt-6 text-center">
                <QRGenerator type="PERSONAL" />
                <p className="mt-4 font-semibold">{user.name} 선생님</p>
                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium mt-1">개인 석식용 QR</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="work">
            <Card className="max-w-md mx-auto card-elevated rounded-2xl border-0">
              <CardContent className="pt-6 text-center">
                <QRGenerator type="WORK" />
                <p className="mt-4 font-semibold">{user.name} 선생님</p>
                <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mt-1">근무 석식용 QR</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card className="max-w-md mx-auto card-elevated rounded-2xl border-0">
              <CardContent className="pt-6">
                <h3 className="font-semibold mb-4">석식 이력</h3>
                <MonthlyCalendar showType />
              </CardContent>
            </Card>
          </TabsContent>

          {isHomeroom && (
            <TabsContent value="students">
              <Card className="card-elevated rounded-2xl border-0">
                <CardContent className="pt-6"><StudentTable /></CardContent>
              </Card>
            </TabsContent>
          )}

          <TabsContent value="profile">
            <Card className="max-w-md mx-auto card-elevated rounded-2xl border-0">
              <CardContent className="pt-6 space-y-4">
                <PhotoUpload currentPhotoUrl={user.photoUrl} onPhotoChange={(url) => setUser({ ...user, photoUrl: url })} />
                {editing ? (
                  <div className="space-y-3">
                    <div><Label>이름</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl" /></div>
                    <div><Label>교과명</Label><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="rounded-xl" /></div>
                    <div><Label>담임 (예: 2-6)</Label><Input value={form.homeroom} onChange={(e) => setForm({ ...form, homeroom: e.target.value })} className="rounded-xl" /></div>
                    <div><Label>직책</Label><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="rounded-xl" /></div>
                    <div className="flex gap-2">
                      <Button onClick={handleSave} className="flex-1 rounded-xl">저장</Button>
                      <Button variant="outline" onClick={() => setEditing(false)} className="flex-1 rounded-xl">취소</Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {[
                      ["이메일", user.email],
                      ["이름", user.name],
                      ["교과명", user.subject || "-"],
                      ["담임", user.homeroom || "해당없음"],
                      ["직책", user.position || "-"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between py-2.5 border-b border-border/50 text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium">{value}</span>
                      </div>
                    ))}
                    <Button variant="outline" className="w-full mt-4 rounded-xl" onClick={() => setEditing(true)}>정보 수정</Button>
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
