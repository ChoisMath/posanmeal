"use client";

import { useState } from "react";
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
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "@/components/BrandMark";
import { QRGenerator } from "@/components/QRGenerator";
import { MonthlyCalendar } from "@/components/MonthlyCalendar";
import { DateCheckboxList } from "@/components/DateCheckboxList";
import { PhotoUpload } from "@/components/PhotoUpload";
import { SignaturePad } from "@/components/SignaturePad";
import { LogOut } from "lucide-react";
import { MealMenu } from "@/components/MealMenu";
import { PageLoadingSkeleton } from "@/components/PageSkeleton";
import { toast } from "sonner";
import { useUser } from "@/hooks/useUser";
import { useApplications } from "@/hooks/useApplications";

interface UserProfile {
  id: number;
  name: string;
  email: string;
  grade: number;
  classNum: number;
  number: number;
  photoUrl: string | null;
  registrations?: Array<{
    id: number;
    createdAt: string;
    application: { id: number; title: string; type: string; mealStart: string | null; mealEnd: string | null };
    selectedDates?: Array<{ date: string }>;
  }>;
}

interface MealApplicationItem {
  id: number;
  title: string;
  description: string | null;
  type: string;
  applyStart: string;
  applyEnd: string;
  mealStart: string | null;
  mealEnd: string | null;
  status: string;
  allowedDates?: Array<{ date: string }>;
  registrations: Array<{
    id: number;
    status: string;
    createdAt: string;
    selectedDates?: Array<{ date: string }>;
  }>;
}

function typeBadge(type: string) {
  switch (type) {
    case "DINNER":
      return (
        <span className="whitespace-nowrap inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          석식
        </span>
      );
    case "BREAKFAST":
      return (
        <span className="whitespace-nowrap inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
          조식
        </span>
      );
    default:
      return (
        <span className="whitespace-nowrap inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-800 dark:text-gray-300">
          기타
        </span>
      );
  }
}

export default function StudentPage() {
  const { user, mutate: mutateUser } = useUser();
  const { applications, mutate: mutateApps } = useApplications();
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<MealApplicationItem | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const [selectedBreakfastDates, setSelectedBreakfastDates] = useState<Set<string>>(new Set());

  if (!user) return <PageLoadingSkeleton />;

  const today = new Date().toISOString().slice(0, 10);
  const activeRegistrations = (user.registrations || []).filter((r) => {
    if (r.application.type === "BREAKFAST") {
      return (r.selectedDates ?? []).some((date) => date.date.slice(0, 10) === today);
    }
    if (!r.application.mealStart || !r.application.mealEnd) return false;
    return today >= r.application.mealStart.slice(0, 10) && today <= r.application.mealEnd.slice(0, 10);
  });
  const hasActiveMeal = activeRegistrations.length > 0;
  const hasApplicationTab = applications.length > 0;
  const pendingCount = applications.filter(
    (a) =>
      a.registrations.length === 0 ||
      a.registrations[0]?.status === "CANCELLED"
  ).length;

  const handleRegister = async () => {
    if (!selectedApp || !signatureData) return;
    setSubmitting(true);
    try {
      const body =
        selectedApp.type === "BREAKFAST"
          ? {
              signature: signatureData,
              selectedDates: Array.from(selectedBreakfastDates).sort(),
            }
          : { signature: signatureData };
      const res = await fetch(
        `/api/applications/${selectedApp.id}/register`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (res.ok) {
        toast.success("신청이 완료되었습니다.");
        setSignDialogOpen(false);
        setSignatureData(null);
        setSelectedApp(null);
        mutateUser();
        mutateApps();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "신청에 실패했습니다.");
      }
    } catch {
      toast.error("신청 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (app: MealApplicationItem) => {
    if (!confirm("신청을 취소하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/applications/${app.id}/register`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("신청이 취소되었습니다.");
        mutateUser();
        mutateApps();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "취소에 실패했습니다.");
      }
    } catch {
      toast.error("취소 중 오류가 발생했습니다.");
    }
  };

  return (
    <div className="min-h-screen bg-warm-subtle">
      <header className="header-gradient px-4 py-3 flex items-center justify-between">
        <BrandMark variant="header" label="PosanMeal" />
        <div className="flex items-center gap-1">
          <ThemeToggle />
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

      <div className="max-w-md mx-auto p-4 page-enter">
        <Tabs defaultValue="meal">
          <TabsList
            className={`grid w-full ${hasApplicationTab ? "grid-cols-5" : "grid-cols-4"} rounded-xl h-11`}
          >
            <TabsTrigger
              value="meal"
              className="rounded-lg text-xs sm:text-sm"
            >
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
            <TabsTrigger
              value="qr"
              className="rounded-lg text-xs sm:text-sm"
            >
              QR
            </TabsTrigger>
            <TabsTrigger
              value="profile"
              className="rounded-lg text-xs sm:text-sm"
            >
              개인정보
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="rounded-lg text-xs sm:text-sm"
            >
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
              <div className="space-y-3">
                {applications.map((app) => {
                  const isRegistered =
                    app.registrations.length > 0 &&
                    app.registrations[0].status === "APPROVED";
                  return (
                    <Card
                      key={app.id}
                      className="card-elevated rounded-2xl border-0"
                    >
                      <CardContent className="pt-5 pb-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {typeBadge(app.type)}
                            <span className="font-semibold text-sm whitespace-nowrap">
                              {app.title}
                            </span>
                          </div>
                          {isRegistered ? (
                            <span className="whitespace-nowrap inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
                              신청 완료
                            </span>
                          ) : (
                            <span className="whitespace-nowrap inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                              신청 가능
                            </span>
                          )}
                        </div>

                        {app.description && (
                          <p className="text-sm text-muted-foreground">
                            {app.description}
                          </p>
                        )}

                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <p className="whitespace-nowrap">
                            신청 기간:{" "}
                            {new Date(app.applyStart).toLocaleDateString(
                              "ko-KR"
                            )}{" "}
                            ~{" "}
                            {new Date(app.applyEnd).toLocaleDateString(
                              "ko-KR"
                            )}
                          </p>
                          <p className="whitespace-nowrap">
                            {app.mealStart && app.mealEnd
                              ? `급식 기간: ${new Date(app.mealStart).toLocaleDateString("ko-KR")} ~ ${new Date(app.mealEnd).toLocaleDateString("ko-KR")}`
                              : "명단 수합용"}
                          </p>
                        </div>

                        <div className="flex justify-end">
                          {isRegistered ? (
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg text-xs"
                                onClick={() => {
                                  setSelectedApp(app);
                                  setSelectedBreakfastDates(
                                    new Set(
                                      app.type === "BREAKFAST"
                                        ? app.registrations[0]?.selectedDates?.map((d) => d.date.slice(0, 10)) ?? []
                                        : [],
                                    ),
                                  );
                                  setSignatureData(null);
                                  setSignDialogOpen(true);
                                }}
                              >
                                수정
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg text-xs"
                                onClick={() => handleCancel(app)}
                              >
                                신청 취소
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              className="rounded-lg text-xs"
                              onClick={() => {
                                setSelectedApp(app);
                                const existingDates = app.registrations[0]?.selectedDates?.map((d) => d.date.slice(0, 10));
                                setSelectedBreakfastDates(
                                  new Set(
                                    app.type === "BREAKFAST"
                                      ? existingDates?.length
                                        ? existingDates
                                        : (app.allowedDates ?? []).map((d) => d.date.slice(0, 10))
                                      : [],
                                  ),
                                );
                                setSignatureData(null);
                                setSignDialogOpen(true);
                              }}
                            >
                              신청하기
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
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
                    {activeRegistrations.map((r) => (
                      <p key={r.id} className="text-xs text-muted-foreground whitespace-nowrap">
                        {r.application.type === "BREAKFAST"
                          ? `${r.application.title}: 오늘 조식`
                          : `${r.application.title}: ${new Date(r.application.mealStart!).toLocaleDateString("ko-KR")} ~ ${new Date(r.application.mealEnd!).toLocaleDateString("ko-KR")}`}
                      </p>
                    ))}
                  </>
                ) : (
                  <p className="text-muted-foreground py-8">
                    현재 석식 신청 기간이 아닙니다.
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

      {/* Signature Dialog */}
      <Dialog open={signDialogOpen} onOpenChange={setSignDialogOpen}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle>석식 신청</DialogTitle>
          </DialogHeader>
          {selectedApp && (
            <div className="space-y-4">
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">이름:</span>{" "}
                  <span className="font-medium">{user.name}</span>
                </p>
                <p className="whitespace-nowrap">
                  <span className="text-muted-foreground">학번:</span>{" "}
                  <span className="font-medium">
                    {user.grade}학년 {user.classNum}반 {user.number}번
                  </span>
                </p>
                {selectedApp.mealStart && selectedApp.mealEnd && (
                  <p className="whitespace-nowrap">
                    <span className="text-muted-foreground">급식 기간:</span>{" "}
                    <span className="font-medium">
                      {new Date(selectedApp.mealStart).toLocaleDateString(
                        "ko-KR"
                      )}{" "}
                      ~{" "}
                      {new Date(selectedApp.mealEnd).toLocaleDateString(
                        "ko-KR"
                      )}
                    </span>
                  </p>
                )}
              </div>

              {selectedApp.type === "BREAKFAST" && (
                <DateCheckboxList
                  dates={(selectedApp.allowedDates ?? []).map((date) => date.date.slice(0, 10))}
                  value={selectedBreakfastDates}
                  onChange={setSelectedBreakfastDates}
                />
              )}

              <div>
                <p className="text-sm font-medium mb-2">서명</p>
                <SignaturePad onSignatureChange={setSignatureData} />
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => {
                    setSignDialogOpen(false);
                    setSignatureData(null);
                    setSelectedApp(null);
                  }}
                >
                  취소
                </Button>
                <Button
                  className="rounded-lg"
                  disabled={!signatureData || submitting || (selectedApp.type === "BREAKFAST" && selectedBreakfastDates.size === 0)}
                  onClick={handleRegister}
                >
                  {submitting ? "처리 중..." : "신청 완료"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
