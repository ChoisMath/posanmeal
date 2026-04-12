"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "@/components/BrandMark";
import { QRGenerator } from "@/components/QRGenerator";
import { MonthlyCalendar } from "@/components/MonthlyCalendar";
import { PhotoUpload } from "@/components/PhotoUpload";
import { LogOut } from "lucide-react";
import { MealMenu } from "@/components/MealMenu";

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

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center bg-warm-subtle">
      <div className="animate-pulse text-muted-foreground">로딩 중...</div>
    </div>
  );

  const hasMealPeriod = !!user.mealPeriod;

  return (
    <div className="min-h-screen bg-warm-subtle">
      <header className="header-gradient px-4 py-3 flex items-center justify-between">
        <BrandMark variant="header" label="PosanMeal" />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" className="text-white/80 hover:text-white hover:bg-white/10" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="max-w-md mx-auto p-4 page-enter">
        <Tabs defaultValue="meal">
          <TabsList className="grid w-full grid-cols-4 rounded-xl h-11">
            <TabsTrigger value="meal" className="rounded-lg text-xs sm:text-sm">식단</TabsTrigger>
            <TabsTrigger value="qr" className="rounded-lg text-xs sm:text-sm">QR</TabsTrigger>
            <TabsTrigger value="profile" className="rounded-lg text-xs sm:text-sm">개인정보</TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg text-xs sm:text-sm">확인</TabsTrigger>
          </TabsList>
          <TabsContent value="meal">
            <Card className="card-elevated rounded-2xl border-0">
              <CardContent className="pt-6">
                <MealMenu />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="qr">
            <Card className="card-elevated rounded-2xl border-0">
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
            <Card className="card-elevated rounded-2xl border-0">
              <CardContent className="pt-6 space-y-4">
                <PhotoUpload currentPhotoUrl={user.photoUrl} onPhotoChange={(url) => setUser({ ...user, photoUrl: url })} />
                <div className="space-y-1">
                  {[
                    ["학년", `${user.grade}학년`],
                    ["반", `${user.classNum}반`],
                    ["번호", `${user.number}번`],
                    ["이름", user.name],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between py-2.5 border-b border-border/50 text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="history">
            <Card className="card-elevated rounded-2xl border-0">
              <CardContent className="pt-6"><MonthlyCalendar /></CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
