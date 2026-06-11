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
import { fetcher } from "@/lib/fetcher";

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
  const [pickedUser, setPickedUser] = useState<TargetUser | null>(null);
  const [filterGrade, setFilterGrade] = useState("all");
  const [filterClass, setFilterClass] = useState("all");
  const [saving, setSaving] = useState(false);

  const open = mode !== null;
  const isEdit = mode?.type === "edit";
  const targetUser = isEdit ? mode.user : pickedUser;

  const { data: appData } = useSWR<AppDetailResponse>(
    open ? `/api/admin/applications/${applicationId}` : null,
    fetcher,
  );

  const { data: usersData } = useSWR<{ users: TargetUser[] }>(
    open && mode?.type === "add" ? `/api/admin/users?role=STUDENT` : null,
    fetcher,
  );

  const { data: regData } = useSWR<RegDetailResponse>(
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
    if (!targetUser) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/applications/${applicationId}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: targetUser.id, meals: mealsBody }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "등록에 실패했습니다.");
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
  const allStudents = usersData?.users ?? [];
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
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="whitespace-nowrap overflow-hidden text-ellipsis">
            {showPicker
              ? "신청 추가 — 학생 선택"
              : `${targetUser?.name ?? ""} 대리 신청`}
          </DialogTitle>
        </DialogHeader>

        {showPicker ? (
          <div className="space-y-3">
            {/* 학년/반 필터 */}
            <div className="flex gap-2">
              <Select value={filterGrade} onValueChange={(v) => { setFilterGrade(v ?? "all"); setFilterClass("all"); }}>
                <SelectTrigger className="w-24">
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
                  <SelectTrigger className="w-20">
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
              {filteredStudents.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3 text-center">학생 없음</p>
              ) : (
                <ul>
                  {filteredStudents.map((u) => {
                    const alreadyRegistered = existingUserIds.has(u.id);
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => !alreadyRegistered && setPickedUser(u)}
                          className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors min-h-11 ${
                            alreadyRegistered ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
                          }`}
                          disabled={alreadyRegistered}
                        >
                          <span className="text-muted-foreground min-w-12 whitespace-nowrap">
                            {u.grade}{u.classNum?.toString().padStart(2, "0")}{u.number?.toString().padStart(2, "0")}
                          </span>
                          <span className="whitespace-nowrap">{u.name}</span>
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
                    disabled={saving}
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
