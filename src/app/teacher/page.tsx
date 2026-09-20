"use client";

import { useState } from "react";
import Link from "next/link";
import { clearClientStateAndSignOut } from "@/lib/clearClientState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpButton } from "@/components/guide/HelpButton";
import { BrandMark } from "@/components/BrandMark";
import { QRGenerator } from "@/components/QRGenerator";
import { MonthlyCalendar } from "@/components/MonthlyCalendar";
import { PhotoUpload } from "@/components/PhotoUpload";
import { FaceEnroll } from "@/components/FaceEnroll";
import { StudentTable } from "@/components/StudentTable";
import { TeacherApplications } from "@/components/TeacherApplications";
import { LogOut } from "lucide-react";
import { MealMenu } from "@/components/MealMenu";
import { PageLoadingSkeleton } from "@/components/PageSkeleton";
import { useUser } from "@/hooks/useUser";
import { useAdminPermission } from "@/hooks/useAdminPermission";

export default function TeacherPage() {
  const { user, mutate: mutateUser } = useUser();
  const { canRead, isTeacher } = useAdminPermission();
  const [qrType, setQrType] = useState<"PERSONAL" | "WORK">("PERSONAL");

  if (!user) return <PageLoadingSkeleton />;

  const isHomeroom = !!user.homeroom;

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-warm-subtle">
      <header className="header-gradient shrink-0 px-2 py-2 sm:px-4 sm:py-3 flex flex-wrap items-center justify-between gap-2">
        <BrandMark variant="header" label="PosanMeal" />
        <div className="ml-auto flex items-center gap-2">
          <HelpButton role="teacher" className="text-white/80 hover:text-white hover:bg-white/10" />
          {canRead && isTeacher && (
            <Link href="/admin">
              <Button variant="outline" size="sm" className="min-h-11 whitespace-nowrap rounded-xl bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white">
                관리자 페이지
              </Button>
            </Link>
          )}
          <Button variant="ghost" size="icon" className="min-h-11 min-w-11 text-white/80 hover:text-white hover:bg-white/10" aria-label="로그아웃" onClick={() => clearClientStateAndSignOut("/")}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0 w-full flex-col p-1.5 sm:p-2 md:p-3 page-enter">
        <Tabs defaultValue="meal" className="flex-1 min-h-0 gap-0">
          <div className="relative z-10 shrink-0 overflow-x-auto pb-px -mb-px">
            <TabsList variant="bookmark" className="min-w-max">
              <TabsTrigger value="meal" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">식단</TabsTrigger>
              <TabsTrigger value="qr" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">QR</TabsTrigger>
              <TabsTrigger value="history" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">확인</TabsTrigger>
              {isHomeroom && <TabsTrigger value="students" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">학생관리</TabsTrigger>}
              {isHomeroom && <TabsTrigger value="applications" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">신청현황</TabsTrigger>}
              <TabsTrigger value="profile" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">개인정보</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="meal" className="min-h-0 overflow-y-auto rounded-b-xl border bg-card">
            <Card className="w-full max-w-md mx-auto rounded-none border-0 shadow-none ring-0 py-3">
              <CardContent className="pt-0">
                <MealMenu />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="qr" className="min-h-0 overflow-y-auto rounded-b-xl border bg-card">
            <Card className="w-full max-w-md mx-auto rounded-none border-0 shadow-none ring-0 py-3">
              <CardContent className="pt-0 text-center">
                {/* 세그먼트 컨트롤: 개인정산 / 근무 */}
                <div className="flex rounded-xl bg-muted p-1 mb-4 max-w-xs mx-auto">
                  <button
                    onClick={() => setQrType("PERSONAL")}
                    className={`flex-1 min-h-11 whitespace-nowrap py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      qrType === "PERSONAL"
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    개인정산
                  </button>
                  <button
                    onClick={() => setQrType("WORK")}
                    className={`flex-1 min-h-11 whitespace-nowrap py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      qrType === "WORK"
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    근무
                  </button>
                </div>
                {qrType === "PERSONAL" ? (
                  <>
                    <QRGenerator type="PERSONAL" />
                    <p className="mt-4 font-semibold">{user.name} 선생님</p>
                    <p className="text-sm text-amber-600 dark:text-amber-400 font-medium mt-1">개인 석식용 QR</p>
                  </>
                ) : (
                  <>
                    <QRGenerator type="WORK" />
                    <p className="mt-4 font-semibold">{user.name} 선생님</p>
                    <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mt-1">근무 석식용 QR</p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="min-h-0 overflow-y-auto rounded-b-xl border bg-card">
            <Card className="w-full max-w-md mx-auto rounded-none border-0 shadow-none ring-0 py-3">
              <CardContent className="pt-0">
                <h3 className="font-semibold mb-4">석식 이력</h3>
                <MonthlyCalendar showType />
              </CardContent>
            </Card>
          </TabsContent>

          {isHomeroom && (
            <TabsContent value="students" className="min-h-0 overflow-hidden rounded-b-xl border bg-card">
              <Card className="h-full min-h-0 rounded-none border-0 shadow-none ring-0 py-2">
                <CardContent className="flex flex-1 min-h-0 flex-col px-2 pt-0"><StudentTable /></CardContent>
              </Card>
            </TabsContent>
          )}

          {isHomeroom && (
            <TabsContent value="applications" className="min-h-0 overflow-y-auto rounded-b-xl border bg-card">
              <Card className="rounded-none border-0 shadow-none ring-0 py-2">
                <CardContent className="pt-0"><TeacherApplications /></CardContent>
              </Card>
            </TabsContent>
          )}

          <TabsContent value="profile" className="min-h-0 overflow-y-auto rounded-b-xl border bg-card">
            <Card className="w-full max-w-md mx-auto rounded-none border-0 shadow-none ring-0 py-3">
              <CardContent className="pt-0 space-y-4">
                <PhotoUpload currentPhotoUrl={user.photoUrl} onPhotoChange={() => mutateUser()} />
                <FaceEnroll />
                <div className="space-y-1">
                  {[
                    ["이메일", user.email],
                    ["이름", user.name],
                    ["교과명", user.subject || "-"],
                    ["담임", user.homeroom || "해당없음"],
                    ["직책", user.position || "-"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3 py-2.5 border-b border-border/50 text-sm">
                      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
                      <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={value}>{value}</span>
                    </div>
                  ))}
                  <p className="pt-3 text-xs text-muted-foreground break-keep">
                    담임·담당교과·직위는 관리자가 학년도 명부에서 관리합니다.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
