"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ApplicationApplyForm,
  type ApplyFormApplication,
  type InitialRegistrationMeal,
  type RegistrationMealBody,
} from "./ApplicationApplyForm";
import type { MealKind, MealApplyMethod } from "@/lib/meal-plan";
import { formatDateTimeKST } from "@/lib/timezone";
import { fetcher, errorTextOf } from "@/lib/fetcher";
import { useAcademicYears, useRoster } from "@/hooks/useAcademicRoster";
import { useAdminPermission } from "@/hooks/useAdminPermission";

interface TargetUser {
  id: number;
  name: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
}

export type AdminApplyMode =
  | { type: "add" }
  | { type: "edit"; registrationId: number; user: TargetUser };

interface AppDetailResponse {
  application: {
    academicYear: number | null;
    resolvedAcademicYear: number;
    academicYearState: "ACTIVE" | "DRAFT" | "ARCHIVED";
    startYear: number;
    startMonth: number;
    monthCount: number;
    meals: {
      mealKind: MealKind;
      price: number;
      exemptionSelectable: boolean;
      method: MealApplyMethod;
      dates: { grade: number; date: string }[];
    }[];
  };
}

interface RegDetailResponse {
  registration: {
    id: number;
    updatedAt: string;
    addedBy: string | null;
    meals: InitialRegistrationMeal[];
  };
}

interface AdminApplyDialogProps {
  applicationId: number;
  mode: AdminApplyMode | null; // null = 닫힘
  existingUserIds: Set<number>;
  onClose: () => void;
  onSaved: () => void;
}

export function AdminApplyDialog({
  applicationId,
  mode,
  existingUserIds,
  onClose,
  onSaved,
}: AdminApplyDialogProps) {
  const { canWrite } = useAdminPermission();
  const yearState = useAcademicYears();
  const [pickedUser, setPickedUser] = useState<TargetUser | null>(null);
  const [filterGrade, setFilterGrade] = useState("all");
  const [filterClass, setFilterClass] = useState("all");
  const [saving, setSaving] = useState(false);

  const open = mode !== null;
  const isEdit = mode?.type === "edit";
  const targetUser = isEdit ? mode.user : pickedUser;

  const { data: appData, error: appError } = useSWR<AppDetailResponse>(
    open ? `/api/admin/applications/${applicationId}` : null,
    fetcher,
  );

  const academicYear = appData?.application.resolvedAcademicYear ?? null;
  const applicationYearState = appData?.application.academicYearState;
  const registrationAllowed = canWrite && (isEdit
    ? applicationYearState === "ACTIVE" || applicationYearState === "ARCHIVED"
    : applicationYearState === "ACTIVE");
  const roster = useRoster(open && mode?.type === "add" && !yearState.notReady ? academicYear : null,
    "STUDENT", { includeEntryless: true });
  const { data: usersData, error: usersError, isLoading: usersLoading } = useSWR<{ users: TargetUser[] }>(
    open && mode?.type === "add" && yearState.notReady ? `/api/admin/users?role=STUDENT${academicYear === null ? "" : `&academicYear=${academicYear}`}` : null,
    fetcher,
  );

  const { data: regData, error: regError } = useSWR<RegDetailResponse>(
    open && isEdit
      ? `/api/admin/applications/${applicationId}/registrations/${mode.registrationId}`
      : null,
    fetcher,
  );

  function reset() {
    setPickedUser(null);
    setFilterGrade("all");
    setFilterClass("all");
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      if (saving) return; // 저장 중 닫기 방지 (취소 후 성공 토스트 혼란 방지)
      reset();
      onClose();
    }
  }

  // 대상 학생 학년 기준 폼 데이터 구성
  let formApplication: ApplyFormApplication | null = null;
  if (appData?.application && targetUser?.grade != null) {
    const grade = targetUser.grade;
    formApplication = {
      startYear: appData.application.startYear,
      startMonth: appData.application.startMonth,
      monthCount: appData.application.monthCount,
      meals: appData.application.meals
        .filter((m) => m.method !== "NONE")
        .map((m) => ({
          mealKind: m.mealKind,
          price: m.price,
          exemptionSelectable: m.exemptionSelectable,
          method: m.method,
          openDates: m.dates.filter((d) => d.grade === grade).map((d) => d.date),
        })),
    };
  }

  const initialMeals = isEdit ? regData?.registration.meals : undefined;
  const formReady = formApplication !== null && (!isEdit || initialMeals !== undefined);
  const showPicker = mode?.type === "add" && pickedUser === null;

  async function handleSubmit(mealsBody: RegistrationMealBody[]) {
    if (!targetUser || !registrationAllowed || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/applications/${applicationId}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: targetUser.id, meals: mealsBody }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(errorTextOf(json, "등록에 실패했습니다."));
        return;
      }
      toast.success(isEdit ? "신청이 수정되었습니다." : "신청이 등록되었습니다.");
      reset();
      onClose();
      onSaved();
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // ── 학생 선택 단계 (add 모드) ──
  const allStudents: TargetUser[] = yearState.notReady ? usersData?.users ?? [] : roster.rows
    .filter((row) => row.userId !== null && row.memberState === "ENROLLED" && row.accessState === "ACTIVE")
    .map((row) => ({ id: row.userId!, name: row.profile.name, grade: row.profile.grade,
      classNum: row.profile.classNum, number: row.profile.number }));
  const gradeOptions = [...new Set(allStudents.map((u) => u.grade).filter((g): g is number => g != null))].sort();
  const classOptions = filterGrade === "all"
    ? []
    : [...new Set(allStudents.filter((u) => u.grade === Number(filterGrade)).map((u) => u.classNum).filter((c): c is number => c != null))].sort();
  const filteredStudents = allStudents.filter((u) => {
    if (filterGrade !== "all" && u.grade !== Number(filterGrade)) return false;
    if (filterClass !== "all" && u.classNum !== Number(filterClass)) return false;
    return true;
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!saving} className="w-full max-w-[calc(100%-1rem)] p-2 sm:p-3 sm:max-w-2xl max-h-[calc(100svh-1rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="whitespace-nowrap overflow-hidden text-ellipsis">
            {showPicker
              ? "신청 추가 — 학생 선택"
              : `${targetUser?.name ?? ""} 대리 신청`}
          </DialogTitle>
        </DialogHeader>
        {academicYear !== null && <p className="text-sm font-medium whitespace-nowrap">{academicYear}학년도 최종 소속 기준</p>}

        {appError || regError || usersError || roster.error || yearState.error ? (
          <p role="alert" className="text-sm text-destructive break-keep">신청 자료를 불러오지 못했습니다. 창을 닫고 다시 시도해주세요.</p>
        ) : !canWrite ? (
          <p className="text-sm whitespace-nowrap">조회 전용입니다.</p>
        ) : applicationYearState === "DRAFT" ? (
          <p className="text-sm text-amber-700 break-keep">준비 중 · 접수 전입니다. 학년도 전환 후 신청할 수 있습니다.</p>
        ) : !isEdit && applicationYearState === "ARCHIVED" ? (
          <p className="text-sm text-amber-700 break-keep">지난 학년도에는 새로 신청할 수 없습니다. 기존 신청은 명단에서 수정하세요.</p>
        ) : targetUser && targetUser.grade === null ? (
          <p role="alert" className="text-sm text-amber-700 break-keep">학년도 정보 확인 필요: 해당 학년도의 학생 학년을 먼저 확인해주세요.</p>
        ) : showPicker ? (
          <div className="space-y-3">
            {/* 학년/반 필터 */}
            <div className="flex gap-2">
              <Select value={filterGrade} onValueChange={(v) => { setFilterGrade(v ?? "all"); setFilterClass("all"); }}>
                <SelectTrigger className="min-h-11 w-24">
                  <SelectValue placeholder="학년">{(v: string) => (v === "all" ? "전체" : `${v}학년`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {gradeOptions.map((g) => (
                    <SelectItem key={g} value={String(g)}>{g}학년</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filterGrade !== "all" && (
                <Select value={filterClass} onValueChange={(v) => setFilterClass(v ?? "all")}>
                  <SelectTrigger className="min-h-11 w-20">
                    <SelectValue placeholder="반">{(v: string) => (v === "all" ? "전체" : `${v}반`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    {classOptions.map((c) => (
                      <SelectItem key={c} value={String(c)}>{c}반</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* 학생 목록 */}
            <div className="border rounded-xl overflow-y-auto overflow-x-auto max-h-64">
              {!appData || yearState.isLoading || roster.isLoading || usersLoading ? (
                <p className="text-sm text-muted-foreground p-3 text-center">불러오는 중...</p>
              ) : filteredStudents.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3 text-center">학생 없음</p>
              ) : (
                <ul>
                  {filteredStudents.map((u) => {
                    const alreadyRegistered = existingUserIds.has(u.id);
                    const missingGrade = u.grade === null;
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => !alreadyRegistered && setPickedUser(u)}
                          className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors min-h-11 ${
                            alreadyRegistered || missingGrade ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
                          }`}
                          disabled={alreadyRegistered || missingGrade || !registrationAllowed}
                        >
                          <span className="text-muted-foreground min-w-12 whitespace-nowrap">
                            {u.grade}{u.classNum?.toString().padStart(2, "0")}{u.number?.toString().padStart(2, "0")}
                          </span>
                          <span className="whitespace-nowrap">{u.name}</span>
                          {missingGrade && <span className="text-xs text-amber-700 whitespace-nowrap">학년도 정보 확인 필요</span>}
                          {alreadyRegistered && (
                            <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap" title="이미 신청된 학생입니다. 명단에서 행을 클릭해 수정하세요.">이미 신청</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : !formReady ? (
          <p className="text-sm text-muted-foreground py-8 text-center">불러오는 중...</p>
        ) : (
          <ApplicationApplyForm
            key={`${applicationId}:${targetUser!.id}`}
            application={formApplication!}
            initialMeals={initialMeals}
            disabled={!registrationAllowed || saving}
            footer={({ buildMealsBody }) => (
              <>
                {/* 관리자 대리 신청 안내 */}
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 space-y-0.5">
                  <p className="font-medium whitespace-nowrap">관리자 대리 신청으로 등록됩니다.</p>
                  {isEdit && regData && (
                    <p>
                      신청 시각: {formatDateTimeKST(new Date(regData.registration.updatedAt))}
                      {regData.registration.addedBy === "ADMIN" && " (관리자 등록)"}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button
                    variant="outline"
                    className="rounded-lg min-h-11 whitespace-nowrap"
                    disabled={saving}
                    onClick={() => handleOpenChange(false)}
                  >
                    취소
                  </Button>
                  <Button
                    className="rounded-lg min-h-11 whitespace-nowrap"
                    disabled={saving || !registrationAllowed}
                    onClick={() => handleSubmit(buildMealsBody())}
                  >
                    {saving ? "처리 중..." : isEdit ? "신청 수정" : "신청 등록"}
                  </Button>
                </div>
              </>
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
