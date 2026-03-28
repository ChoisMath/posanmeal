"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { QRGenerator } from "@/components/QRGenerator";
import { MonthlyCalendar } from "@/components/MonthlyCalendar";
import { PhotoUpload } from "@/components/PhotoUpload";
import { LogOut } from "lucide-react";

interface UserProfile {
  id: number;
  name: string;
  email: string;
  grade: number;
  classNum: number;
  number: number;
  photoUrl: string | null;
  mealPeriod?: { startDate: string; endDate: string };
}

export default function StudentPage() {
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    fetch("/api/users/me").then((res) => res.json()).then((data) => setUser(data.user));
  }, []);

  if (!user) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>;

  const hasMealPeriod = !!user.mealPeriod;

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
      <div className="max-w-md mx-auto p-4">
        <Tabs defaultValue="qr">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="qr">QR</TabsTrigger>
            <TabsTrigger value="profile">개인정보</TabsTrigger>
            <TabsTrigger value="history">확인</TabsTrigger>
          </TabsList>
          <TabsContent value="qr">
            <Card>
              <CardContent className="pt-6 text-center">
                {hasMealPeriod ? (
                  <>
                    <QRGenerator type="STUDENT" />
                    <p className="mt-4 font-semibold">{user.grade}학년 {user.classNum}반 {user.number}번 {user.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      석식 신청 기간: {new Date(user.mealPeriod!.startDate).toLocaleDateString("ko-KR")} ~ {new Date(user.mealPeriod!.endDate).toLocaleDateString("ko-KR")}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground py-8">현재 석식 신청 기간이 아닙니다.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="profile">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <PhotoUpload currentPhotoUrl={user.photoUrl} onPhotoChange={(url) => setUser({ ...user, photoUrl: url })} />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">학년</span><span>{user.grade}학년</span></div>
                  <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">반</span><span>{user.classNum}반</span></div>
                  <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">번호</span><span>{user.number}번</span></div>
                  <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">이름</span><span>{user.name}</span></div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="history">
            <Card><CardContent className="pt-6"><MonthlyCalendar /></CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
