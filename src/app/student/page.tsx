"use client";

import { useState } from "react";
import { toast } from "sonner";
import { clearClientStateAndSignOut } from "@/lib/clearClientState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BrandMark } from "@/components/BrandMark";
import { QRGenerator } from "@/components/QRGenerator";
import { MonthlyCalendar } from "@/components/MonthlyCalendar";
import { PhotoUpload } from "@/components/PhotoUpload";
import { LogOut } from "lucide-react";
import { MealMenu } from "@/components/MealMenu";
import { PageLoadingSkeleton } from "@/components/PageSkeleton";
import { useUser } from "@/hooks/useUser";
import { useApplications } from "@/hooks/useApplications";
import { StudentApplicationView } from "@/components/meal/StudentApplicationView";
import { MEAL_LABEL, type MealKind } from "@/lib/meal-plan";

export default function StudentPage() {
  const { user, mutate: mutateUser } = useUser();
  const { applications, mutate: mutateApps } = useApplications();
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [myHistoryOpen, setMyHistoryOpen] = useState(false);
  const [myRegistrations, setMyRegistrations] = useState<MyRegistrationItem[]>([]);
  const [myLoading, setMyLoading] = useState(false);

  if (!user) return <PageLoadingSkeleton />;

  // QR 탭: 오늘 식사 자격(승인된 신청의 확정 날짜)이 있는 식사 목록
  const todayMeals = user.todayMeals ?? [];
  const hasActiveMeal = todayMeals.length > 0;

  const hasApplicationTab = applications.length > 0;
  const pendingCount = applications.filter((a) => a.myStatus !== "APPLIED").length;

  async function openMyHistory() {
    setMyLoading(true);
    setMyHistoryOpen(true);
    try {
      const res = await fetch("/api/applications/my");
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      setMyRegistrations(json.registrations ?? []);
    } catch {
      toast.error("신청 내역을 불러오지 못했습니다.");
    } finally {
      setMyLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-warm-subtle">
      <header className="header-gradient px-4 py-3 flex items-center justify-between">
        <BrandMark variant="header" label="PosanMeal" />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-white/80 hover:text-white hover:bg-white/10"
            onClick={() => clearClientStateAndSignOut("/")}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="max-w-md mx-auto p-2 sm:p-4 page-enter">
        <Tabs defaultValue="meal">
          <TabsList
            className={`grid w-full ${hasApplicationTab ? "grid-cols-5" : "grid-cols-4"} rounded-xl h-11`}
          >
            <TabsTrigger value="meal" className="rounded-lg text-xs sm:text-sm">
              식단
            </TabsTrigger>
            {hasApplicationTab && (
              <TabsTrigger
                value="apply"
                className="rounded-lg text-xs sm:text-sm relative"
              >
                신청
                {pendingCount > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                    {pendingCount}
                  </span>
                )}
              </TabsTrigger>
            )}
            <TabsTrigger value="qr" className="rounded-lg text-xs sm:text-sm">
              QR
            </TabsTrigger>
            <TabsTrigger value="profile" className="rounded-lg text-xs sm:text-sm">
              개인정보
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg text-xs sm:text-sm">
              확인
            </TabsTrigger>
          </TabsList>

          <TabsContent value="meal">
            <Card className="card-elevated rounded-2xl border-0">
              <CardContent className="pt-6">
                <MealMenu />
              </CardContent>
            </Card>
          </TabsContent>

          {hasApplicationTab && (
            <TabsContent value="apply">
              {selectedAppId !== null ? (
                <StudentApplicationView
                  applicationId={selectedAppId}
                  onBack={() => setSelectedAppId(null)}
                  onSubmitted={() => {
                    mutateUser();
                    mutateApps();
                  }}
                />
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg text-xs min-h-11 whitespace-nowrap"
                      onClick={openMyHistory}
                    >
                      신청내역
                    </Button>
                  </div>
                  {applications.map((app) => {
                    const isApplied = app.myStatus === "APPLIED";
                    const isCancelled = app.myStatus === "CANCELLED";
                    return (
                      <Card
                        key={app.id}
                        className="card-elevated rounded-2xl border-0 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => setSelectedAppId(app.id)}
                      >
                        <CardContent className="pt-5 pb-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-sm line-clamp-2">{app.title}</span>
                            {isApplied ? (
                              <span className="whitespace-nowrap shrink-0 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
                                신청완료
                              </span>
                            ) : isCancelled ? (
                              <span className="whitespace-nowrap shrink-0 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                취소됨
                              </span>
                            ) : (
                              <span className="whitespace-nowrap shrink-0 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                미신청
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(app.applyStartAt).toLocaleDateString("ko-KR")} ~{" "}
                            {new Date(app.applyEndAt).toLocaleDateString("ko-KR")}
                          </div>

                          <div className="flex flex-wrap gap-1">
                            {app.meals.map((m) => (
                              <span
                                key={m.mealKind}
                                className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 whitespace-nowrap"
                              >
                                {MEAL_LABEL[m.mealKind]} {m.price.toLocaleString()}원
                              </span>
                            ))}
                          </div>

                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant={isApplied ? "outline" : "default"}
                              className="rounded-lg text-xs min-h-11 whitespace-nowrap"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedAppId(app.id);
                              }}
                            >
                              {isApplied ? "수정/취소" : "신청하기"}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          )}

          <TabsContent value="qr">
            <Card className="card-elevated rounded-2xl border-0">
              <CardContent className="pt-6 text-center">
                {hasActiveMeal ? (
                  <>
                    <QRGenerator type="STUDENT" />
                    <p className="mt-4 font-semibold whitespace-nowrap">
                      {user.grade}학년 {user.classNum}반 {user.number}번{" "}
                      {user.name}
                    </p>
                    <p className="text-xs text-muted-foreground whitespace-nowrap">
                      오늘 식사: {todayMeals.map((k) => MEAL_LABEL[k]).join(" · ")}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground py-8">
                    오늘 신청된 식사가 없습니다.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profile">
            <Card className="card-elevated rounded-2xl border-0">
              <CardContent className="pt-6 space-y-4">
                <PhotoUpload
                  currentPhotoUrl={user.photoUrl}
                  onPhotoChange={() => mutateUser()}
                />
                <div className="space-y-1">
                  {[
                    ["학년", `${user.grade}학년`],
                    ["반", `${user.classNum}반`],
                    ["번호", `${user.number}번`],
                    ["이름", user.name],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex justify-between py-2.5 border-b border-border/50 text-sm"
                    >
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
              <CardContent className="pt-6">
                <MonthlyCalendar />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* 신청내역 Dialog */}
      <Dialog open={myHistoryOpen} onOpenChange={setMyHistoryOpen}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle>신청내역</DialogTitle>
          </DialogHeader>
          {myLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">불러오는 중...</p>
          ) : myRegistrations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">신청 내역이 없습니다.</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {myRegistrations.map((reg) => (
                <div key={reg.id} className="border border-border/50 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm line-clamp-1">{reg.application.title}</span>
                    <span className={`whitespace-nowrap text-xs px-2 py-0.5 rounded-full font-medium ${
                      reg.status === "APPROVED"
                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    }`}>
                      {reg.status === "APPROVED" ? "승인" : "취소"}
                    </span>
                  </div>
                  {reg.meals.map((m) => (
                    <div key={m.mealKind} className="flex justify-between text-xs text-muted-foreground">
                      <span className="whitespace-nowrap">
                        {MEAL_LABEL[m.mealKind as MealKind]} {m.dayCount}일
                      </span>
                      <span className="whitespace-nowrap font-medium text-foreground">
                        {m.fee.toLocaleString()}원
                      </span>
                    </div>
                  ))}
                  {reg.meals.length > 0 && (
                    <div className="flex justify-between text-sm font-semibold border-t border-border/50 pt-2">
                      <span className="whitespace-nowrap">합계</span>
                      <span className="whitespace-nowrap">
                        {reg.meals.reduce((s, m) => s + m.fee, 0).toLocaleString()}원
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface MyRegistrationItem {
  id: number;
  status: string;
  createdAt: string;
  application: {
    id: number;
    title: string;
    applyStartAt: string;
    applyEndAt: string;
  };
  meals: Array<{
    mealKind: string;
    applied: boolean;
    exempt: boolean;
    dayCount: number;
    price: number;
    fee: number;
  }>;
}
