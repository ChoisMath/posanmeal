"use client";

import { Fragment, useState, useRef } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
  DialogFooter,
} from "@/components/ui/dialog";
import { MEAL_LABEL, MEAL_SHORT, METHOD_LABEL, studentNumberOf, type MealKind } from "@/lib/meal-plan";
import { MEAL_THEME } from "@/components/meal/meal-ui";
import { genderLabel } from "@/lib/gender";
import { formatDateTimeKST } from "@/lib/timezone";
import { fetcher } from "@/lib/fetcher";

// ---------- Types ----------

type MealApplyMethod = "NONE" | "YN" | "WEEKDAY" | "DATE";

interface AppMealConfig {
  mealKind: MealKind;
  price: number;
  exemptionSelectable: boolean;
  method: MealApplyMethod;
}

interface ApplicationInfo {
  id: number;
  title: string;
  startYear: number;
  startMonth: number;
  monthCount: number;
  applyStartAt: string | null;
  applyEndAt: string | null;
  meals: AppMealConfig[];
}

interface RegMeal {
  mealKind: MealKind;
  applied: boolean;
  exempt: boolean;
  dayCount: number;
}

interface RegUser {
  id: number;
  name: string;
  email: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  gender: "MALE" | "FEMALE" | null;
}

interface Registration {
  id: number;
  createdAt: string;
  status: "APPROVED" | "CANCELLED";
  addedBy: string | null;
  user: RegUser;
  meals: RegMeal[];
}

interface StatsData {
  application: ApplicationInfo;
  registrations: Registration[];
}

// For the add dialog: application detail with dates
interface AppDetail {
  meals: {
    mealKind: MealKind;
    method: MealApplyMethod;
    dates: { grade: number; date: string }[];
  }[];
}

interface AdminUser {
  id: number;
  name: string;
  email: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  gender: "MALE" | "FEMALE" | null;
}

// ---------- Helpers ----------

function emailIdOf(email: string): string {
  return email.split("@")[0] ?? email;
}

function studentNo(u: RegUser): string {
  if (u.grade != null && u.classNum != null && u.number != null) {
    return String(studentNumberOf(u.grade, u.classNum, u.number));
  }
  return "—";
}

function formatApplyRange(start: string | null, end: string | null): string {
  if (!start && !end) return "기간 미설정";
  const s = start ? formatDateTimeKST(new Date(start)) : "?";
  const e = end ? formatDateTimeKST(new Date(end)) : "?";
  return `${s} ~ ${e}`;
}

// ---------- AddDialog ----------

interface AddDialogProps {
  applicationId: number;
  appMeals: AppMealConfig[];
  existingUserIds: Set<number>;
  onAdded: () => void;
}

function AddDialog({ applicationId, appMeals, existingUserIds, onAdded }: AddDialogProps) {
  const [open, setOpen] = useState(false);
  const [filterGrade, setFilterGrade] = useState("all");
  const [filterClass, setFilterClass] = useState("all");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedMealKinds, setSelectedMealKinds] = useState<Set<MealKind>>(new Set());
  const [saving, setSaving] = useState(false);

  const { data: usersData } = useSWR<{ users: AdminUser[] }>(
    open ? `/api/admin/users?role=STUDENT` : null,
    fetcher,
  );

  // Fetch app detail for DATE/WEEKDAY meal dates
  const { data: appDetail } = useSWR<{ application: AppDetail }>(
    open ? `/api/admin/applications/${applicationId}` : null,
    fetcher,
  );

  const allStudents = usersData?.users ?? [];

  // Filter out already-registered (non-cancelled) users is handled at display level
  // We show all students but note if already registered
  const gradeOptions = [...new Set(allStudents.map((u) => u.grade).filter((g): g is number => g != null))].sort();
  const classOptions = filterGrade === "all"
    ? []
    : [...new Set(allStudents.filter((u) => u.grade === Number(filterGrade)).map((u) => u.classNum).filter((c): c is number => c != null))].sort();

  const filteredStudents = allStudents.filter((u) => {
    if (filterGrade !== "all" && u.grade !== Number(filterGrade)) return false;
    if (filterClass !== "all" && u.classNum !== Number(filterClass)) return false;
    return true;
  });

  const activeMeals = appMeals.filter((m) => m.method !== "NONE");

  function toggleMeal(kind: MealKind) {
    setSelectedMealKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }

  async function handleAdd() {
    if (selectedUserId == null) {
      toast.error("학생을 선택해주세요.");
      return;
    }
    if (selectedMealKinds.size === 0) {
      toast.error("신청할 식사를 선택해주세요.");
      return;
    }
    // DATE/WEEKDAY 식사는 개설일 데이터가 있어야 전체 적용 payload를 만들 수 있다
    if (!appDetail?.application) {
      toast.error("개설일 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    const appMealMap = new Map<MealKind, AppMealConfig>(appMeals.map((m) => [m.mealKind, m]));
    const appDetailMeals = appDetail?.application?.meals ?? [];
    const appDetailMealMap = new Map<MealKind, AppDetail["meals"][number]>(
      appDetailMeals.map((m) => [m.mealKind, m]),
    );

    // Find selected user's grade for date filtering
    const selectedUser = allStudents.find((u) => u.id === selectedUserId);
    const userGrade = selectedUser?.grade ?? null;

    const mealsPayload = [...selectedMealKinds].map((kind) => {
      const config = appMealMap.get(kind);
      const detail = appDetailMealMap.get(kind);
      const method = config?.method ?? "YN";

      if (method === "DATE" && detail) {
        // Send all open dates for this user's grade
        const gradeDates = detail.dates
          .filter((d) => userGrade == null || d.grade === userGrade)
          .map((d) => d.date);
        return {
          mealKind: kind,
          applied: true,
          exempt: false,
          selectedDates: gradeDates,
        };
      }

      if (method === "WEEKDAY" && detail) {
        // Send all weekdays (0-6) for all months as weekdaysByMonth
        // Build months list from app dates
        const allMonths = [...new Set(
          detail.dates
            .filter((d) => userGrade == null || d.grade === userGrade)
            .map((d) => d.date.slice(0, 7)),
        )];
        const weekdaysByMonth: Record<string, number[]> = {};
        for (const monthKey of allMonths) {
          weekdaysByMonth[monthKey] = [0, 1, 2, 3, 4, 5, 6];
        }
        return {
          mealKind: kind,
          applied: true,
          exempt: false,
          weekdaysByMonth,
        };
      }

      // YN: just applied=true
      return {
        mealKind: kind,
        applied: true,
        exempt: false,
      };
    });

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/applications/${applicationId}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, meals: mealsPayload }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "등록에 실패했습니다.");
        return;
      }
      toast.success("신청이 등록되었습니다.");
      setOpen(false);
      setSelectedUserId(null);
      setSelectedMealKinds(new Set());
      onAdded();
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="default" size="sm" className="min-h-11 whitespace-nowrap" />
        }
      >
        신청 추가
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>신청 추가</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* 학년/반 필터 */}
          <div className="flex gap-2">
            <Select value={filterGrade} onValueChange={(v) => { setFilterGrade(v ?? "all"); setFilterClass("all"); setSelectedUserId(null); }}>
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
              <Select value={filterClass} onValueChange={(v) => { setFilterClass(v ?? "all"); setSelectedUserId(null); }}>
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
          <div className="border rounded-xl overflow-y-auto max-h-48">
            {filteredStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground p-3 text-center">학생 없음</p>
            ) : (
              <ul>
                {filteredStudents.map((u) => {
                  const alreadyRegistered = existingUserIds.has(u.id);
                  const isSelected = selectedUserId === u.id;
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => !alreadyRegistered && setSelectedUserId(u.id)}
                        className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors min-h-11 ${
                          isSelected
                            ? "bg-primary/10 font-medium"
                            : alreadyRegistered
                              ? "opacity-40 cursor-not-allowed"
                              : "hover:bg-muted"
                        }`}
                        disabled={alreadyRegistered}
                      >
                        <span className="text-muted-foreground min-w-12 whitespace-nowrap">
                          {u.grade}{u.classNum?.toString().padStart(2, "0")}{u.number?.toString().padStart(2, "0")}
                        </span>
                        <span className="whitespace-nowrap">{u.name}</span>
                        {alreadyRegistered && (
                          <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">이미 신청</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 식사 선택 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">신청 식사</Label>
            <div className="flex flex-wrap gap-2">
              {activeMeals.map((m) => {
                const theme = MEAL_THEME[m.mealKind];
                const checked = selectedMealKinds.has(m.mealKind);
                const isComplexMethod = m.method === "DATE" || m.method === "WEEKDAY";
                return (
                  <button
                    key={m.mealKind}
                    type="button"
                    onClick={() => toggleMeal(m.mealKind)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors min-h-11 ${
                      checked
                        ? `${theme.side} ${theme.text} border-current`
                        : "bg-muted border-transparent"
                    }`}
                  >
                    {MEAL_LABEL[m.mealKind]}
                    {isComplexMethod && (
                      <span className="ml-1 text-xs opacity-70">({METHOD_LABEL[m.method]}→전체)</span>
                    )}
                  </button>
                );
              })}
              {activeMeals.length === 0 && (
                <p className="text-sm text-muted-foreground">개설된 식사 없음</p>
              )}
            </div>
            {[...selectedMealKinds].some((k) => {
              const config = appMeals.find((m) => m.mealKind === k);
              return config?.method === "DATE" || config?.method === "WEEKDAY";
            }) && (
              <p className="text-xs text-muted-foreground">
                날짜선택/요일선택 식사는 해당 학년 개설일 전체로 등록됩니다.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" className="whitespace-nowrap" />}>
            취소
          </DialogClose>
          <Button onClick={handleAdd} disabled={saving} className="whitespace-nowrap">
            {saving ? "등록 중..." : "등록"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Main Component ----------

interface ApplicationStatsProps {
  applicationId: number;
}

export default function ApplicationStats({ applicationId }: ApplicationStatsProps) {
  const { data, mutate, isLoading } = useSWR<StatsData>(
    `/api/admin/applications/${applicationId}/registrations`,
    fetcher,
  );

  const [filterGrade, setFilterGrade] = useState("all");
  const [filterClass, setFilterClass] = useState("all");
  const [filterName, setFilterName] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const application = data?.application;
  const registrations = data?.registrations ?? [];

  // Active meals (method !== NONE)
  const activeMeals = application?.meals.filter((m) => m.method !== "NONE") ?? [];

  // Columns: for each active meal: maybe "면제" column + "신청일수" column
  // We show: {mealKind} 면제 (if exemptionSelectable) and {mealKind} 신청일수
  const mealColumns: { kind: MealKind; type: "exempt" | "dayCount" }[] = activeMeals.flatMap((m) => {
    const cols: { kind: MealKind; type: "exempt" | "dayCount" }[] = [];
    if (m.exemptionSelectable) {
      cols.push({ kind: m.mealKind, type: "exempt" });
    }
    cols.push({ kind: m.mealKind, type: "dayCount" });
    return cols;
  });

  // Filtering
  const availableClasses = filterGrade === "all"
    ? []
    : [...new Set(
        registrations
          .filter((r) => r.user.grade === Number(filterGrade))
          .map((r) => r.user.classNum)
          .filter((c): c is number => c != null),
      )].sort();

  const filtered = registrations.filter((r) => {
    if (!showCancelled && r.status === "CANCELLED") return false;
    if (filterGrade !== "all" && r.user.grade !== Number(filterGrade)) return false;
    if (filterClass !== "all" && r.user.classNum !== Number(filterClass)) return false;
    if (filterName && !r.user.name.includes(filterName)) return false;
    return true;
  });

  // Summary: APPROVED only, per grade
  const approvedRegs = registrations.filter((r) => r.status === "APPROVED");

  function gradeSummary(grade: number | "all") {
    const subset = grade === "all" ? approvedRegs : approvedRegs.filter((r) => r.user.grade === grade);
    const maleCount = subset.filter((r) => r.user.gender === "MALE").length;
    const femaleCount = subset.filter((r) => r.user.gender === "FEMALE").length;
    const mealStats = activeMeals.map((m) => {
      const exemptCount = m.exemptionSelectable
        ? subset.filter((r) => r.meals.find((rm) => rm.mealKind === m.mealKind)?.exempt).length
        : null;
      const dayTotal = subset.reduce((sum, r) => {
        const rm = r.meals.find((rm) => rm.mealKind === m.mealKind);
        return sum + (rm?.applied ? (rm.dayCount ?? 0) : 0);
      }, 0);
      return { kind: m.mealKind, exemptCount, dayTotal, exemptionSelectable: m.exemptionSelectable };
    });
    return { count: subset.length, maleCount, femaleCount, mealStats };
  }

  const grades = [1, 2, 3].filter((g) => approvedRegs.some((r) => r.user.grade === g));

  async function handleImport(file: File) {
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/admin/applications/${applicationId}/import`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "업로드에 실패했습니다.");
        return;
      }
      toast.success(
        `추가 ${json.added ?? 0} · 갱신 ${json.updated ?? 0} · 미발견 ${json.skippedNotFound ?? 0} · 오류 ${json.skippedInvalid ?? 0} · 무시된 표시 ${json.ignoredMarks ?? 0}`,
      );
      mutate();
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleStatusToggle(reg: Registration) {
    const nextStatus = reg.status === "APPROVED" ? "CANCELLED" : "APPROVED";
    try {
      const res = await fetch(
        `/api/admin/applications/${applicationId}/registrations/${reg.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "상태 변경에 실패했습니다.");
        return;
      }
      toast.success(nextStatus === "CANCELLED" ? "신청이 취소되었습니다." : "신청이 복원되었습니다.");
      mutate();
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    }
  }

  async function handleDelete(reg: Registration) {
    if (!confirm(`${reg.user.name} 학생의 신청을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      const res = await fetch(
        `/api/admin/applications/${applicationId}/registrations/${reg.id}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "삭제에 실패했습니다.");
        return;
      }
      toast.success("신청이 삭제되었습니다.");
      mutate();
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    }
  }

  const existingUserIds = new Set(
    registrations.filter((r) => r.status === "APPROVED").map((r) => r.user.id),
  );

  if (isLoading) {
    return (
      <div className="h-dvh flex items-center justify-center">
        <p className="text-muted-foreground text-sm">불러오는 중...</p>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="h-dvh flex items-center justify-center">
        <p className="text-muted-foreground text-sm">공고를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-warm-subtle">
      {/* 헤더 */}
      <header className="header-gradient px-3 py-3 flex items-center gap-3 shrink-0">
        <Link
          href="/admin?tab=applications"
          className="inline-flex items-center gap-1 text-white/90 hover:text-white transition-colors whitespace-nowrap min-h-11 px-1"
        >
          <ChevronLeft className="size-5" />
          <span className="text-sm font-medium">목록</span>
        </Link>
        <h1 className="flex-1 text-white font-bold text-base truncate whitespace-nowrap">
          신청 통계
        </h1>
      </header>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">

        {/* 상단 바: 공고 정보 + 액션 버튼 */}
        <div className="card-elevated rounded-2xl border-0 p-3 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{application.title}</p>
              <p className="text-xs text-muted-foreground whitespace-nowrap">
                신청기간: {formatApplyRange(application.applyStartAt, application.applyEndAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 shrink-0">
              <a
                href={`/api/admin/applications/${applicationId}/export?template=true`}
                download
                className="inline-flex items-center justify-center min-h-11 px-3 py-1.5 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors whitespace-nowrap"
              >
                양식 다운로드
              </a>

              {/* 일괄 업로드 */}
              <label className="inline-flex items-center justify-center min-h-11 px-3 py-1.5 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors whitespace-nowrap cursor-pointer">
                {importing ? "업로드 중..." : "일괄 업로드"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImport(file);
                  }}
                />
              </label>

              <a
                href={`/api/admin/applications/${applicationId}/export`}
                download
                className="inline-flex items-center justify-center min-h-11 px-3 py-1.5 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors whitespace-nowrap"
              >
                엑셀저장
              </a>

              <AddDialog
                applicationId={applicationId}
                appMeals={application.meals}
                existingUserIds={existingUserIds}
                onAdded={() => mutate()}
              />
            </div>
          </div>
        </div>

        {/* 필터 행 */}
        <div className="card-elevated rounded-2xl border-0 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={filterGrade}
              onValueChange={(v) => {
                setFilterGrade(v ?? "all");
                setFilterClass("all");
              }}
            >
              <SelectTrigger className="w-24">
                <SelectValue placeholder="학년">{(v: string) => (v === "all" ? "전체학년" : `${v}학년`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체학년</SelectItem>
                {[1, 2, 3].map((g) => (
                  <SelectItem key={g} value={String(g)}>{g}학년</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filterClass}
              onValueChange={(v) => setFilterClass(v ?? "all")}
              disabled={filterGrade === "all"}
            >
              <SelectTrigger className="w-20">
                <SelectValue placeholder="반">{(v: string) => (v === "all" ? "전체반" : `${v}반`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체반</SelectItem>
                {availableClasses.map((c) => (
                  <SelectItem key={c} value={String(c)}>{c}반</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              placeholder="이름 검색"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              className="w-32"
            />

            <label className="flex items-center gap-1.5 text-sm cursor-pointer whitespace-nowrap min-h-11 px-1">
              <input
                type="checkbox"
                checked={showCancelled}
                onChange={(e) => setShowCancelled(e.target.checked)}
                className="size-4 rounded"
              />
              취소 포함
            </label>

            <span className="text-xs text-muted-foreground whitespace-nowrap ml-auto">
              {filtered.length}명 표시 / 전체 {registrations.length}명
            </span>
          </div>
        </div>

        {/* 표 */}
        <div className="card-elevated rounded-2xl border-0 overflow-hidden">
          <div className="overflow-auto max-h-[70dvh]">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/80 border-b">
                  <th className="sticky top-0 z-20 bg-muted px-2 py-2 text-left font-semibold whitespace-nowrap text-xs">#</th>
                  <th className="sticky top-0 z-20 bg-muted px-2 py-2 text-left font-semibold whitespace-nowrap text-xs">입력시간</th>
                  <th className="sticky top-0 z-20 bg-muted px-2 py-2 text-left font-semibold whitespace-nowrap text-xs">아이디</th>
                  <th className="sticky top-0 z-20 bg-muted px-2 py-2 text-left font-semibold whitespace-nowrap text-xs">학번</th>
                  <th className="sticky top-0 left-0 z-40 bg-muted px-2 py-2 text-left font-semibold whitespace-nowrap text-xs">이름</th>
                  <th className="sticky top-0 z-20 bg-muted px-2 py-2 text-left font-semibold whitespace-nowrap text-xs">성별</th>
                  {mealColumns.map(({ kind, type }) => {
                    const theme = MEAL_THEME[kind];
                    return (
                      <th
                        key={`${kind}-${type}`}
                        className={`sticky top-0 z-20 px-2 py-2 text-center font-semibold whitespace-nowrap text-xs ${theme.head} ${theme.text}`}
                      >
                        {MEAL_SHORT[kind]}{type === "exempt" ? " 면제" : " 신청일수"}
                      </th>
                    );
                  })}
                  <th className="sticky top-0 z-20 bg-muted px-2 py-2 text-center font-semibold whitespace-nowrap text-xs">관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6 + mealColumns.length + 1}
                      className="px-3 py-6 text-center text-sm text-muted-foreground"
                    >
                      신청 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  filtered.map((reg, idx) => {
                    const isCancelled = reg.status === "CANCELLED";
                    const rowCls = isCancelled
                      ? "bg-muted/40 text-muted-foreground"
                      : "bg-background hover:bg-muted/30 transition-colors";
                    return (
                      <tr key={reg.id} className={`border-b last:border-0 ${rowCls}`}>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                          {idx + 1}
                          {isCancelled && (
                            <span className="ml-1 inline-flex items-center px-1 py-0 text-[10px] rounded bg-muted-foreground/20 text-muted-foreground font-medium whitespace-nowrap">취소</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                          {formatDateTimeKST(new Date(reg.createdAt))}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                          {emailIdOf(reg.user.email)}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                          {studentNo(reg.user)}
                        </td>
                        <td className={`sticky left-0 z-30 px-2 py-1.5 whitespace-nowrap font-medium ${isCancelled ? "bg-muted/40" : "bg-background"}`}>
                          {reg.user.name}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {genderLabel(reg.user.gender)}
                        </td>
                        {mealColumns.map(({ kind, type }) => {
                          const rm = reg.meals.find((m) => m.mealKind === kind);
                          const theme = MEAL_THEME[kind];
                          let content: React.ReactNode = "—";
                          if (rm) {
                            if (type === "exempt") {
                              content = rm.exempt ? "✓" : "—";
                            } else {
                              content = rm.applied ? `${rm.dayCount}일` : "—";
                            }
                          }
                          return (
                            <td
                              key={`${kind}-${type}`}
                              className={`px-2 py-1.5 text-center whitespace-nowrap ${isCancelled ? "" : theme.cell}`}
                            >
                              {content}
                            </td>
                          );
                        })}
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <div className="flex items-center gap-1 justify-center">
                            <button
                              type="button"
                              onClick={() => handleStatusToggle(reg)}
                              className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap min-h-9 transition-colors ${
                                isCancelled
                                  ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300"
                                  : "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300"
                              }`}
                            >
                              {isCancelled ? "복원" : "취소"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(reg)}
                              className="px-2 py-1 rounded text-xs font-medium whitespace-nowrap min-h-9 bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 transition-colors"
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 하단 합계 */}
        {approvedRegs.length > 0 && (
          <div className="card-elevated rounded-2xl border-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/80 border-b">
                    <th className="px-3 py-2 text-left font-semibold whitespace-nowrap text-xs">구분</th>
                    <th className="px-3 py-2 text-right font-semibold whitespace-nowrap text-xs">신청자</th>
                    {activeMeals.map((m) => {
                      const theme = MEAL_THEME[m.mealKind];
                      return (
                        <th
                          key={m.mealKind}
                          colSpan={m.exemptionSelectable ? 2 : 1}
                          className={`px-3 py-2 text-center font-semibold whitespace-nowrap text-xs ${theme.head} ${theme.text}`}
                        >
                          {MEAL_LABEL[m.mealKind]}
                        </th>
                      );
                    })}
                  </tr>
                  {activeMeals.some((m) => m.exemptionSelectable) && (
                    <tr className="bg-muted/60 border-b">
                      <th className="px-3 py-1" />
                      <th className="px-3 py-1" />
                      {activeMeals.map((m) => {
                        const theme = MEAL_THEME[m.mealKind];
                        if (m.exemptionSelectable) {
                          return (
                            <Fragment key={m.mealKind}>
                              <th className={`px-3 py-1 text-center text-xs whitespace-nowrap ${theme.text}`}>면제</th>
                              <th className={`px-3 py-1 text-center text-xs whitespace-nowrap ${theme.text}`}>일수</th>
                            </Fragment>
                          );
                        }
                        return <th key={`${m.mealKind}-days`} className={`px-3 py-1 text-center text-xs whitespace-nowrap ${theme.text}`}>일수</th>;
                      })}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {grades.map((g) => {
                    const s = gradeSummary(g);
                    return (
                      <tr key={g} className="border-b bg-background">
                        <td className="px-3 py-1.5 font-medium whitespace-nowrap text-xs">{g}학년</td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums text-xs">
                          {s.count}명 <span className="text-muted-foreground">(남 {s.maleCount}/여 {s.femaleCount})</span>
                        </td>
                        {s.mealStats.map((ms) => {
                          const theme = MEAL_THEME[ms.kind];
                          if (ms.exemptionSelectable) {
                            return (
                              <Fragment key={ms.kind}>
                                <td className={`px-3 py-1.5 text-center whitespace-nowrap tabular-nums text-xs ${theme.cell}`}>{ms.exemptCount}</td>
                                <td className={`px-3 py-1.5 text-center whitespace-nowrap tabular-nums text-xs ${theme.cell}`}>{ms.dayTotal}일</td>
                              </Fragment>
                            );
                          }
                          return (
                            <td key={`${ms.kind}-days`} className={`px-3 py-1.5 text-center whitespace-nowrap tabular-nums text-xs ${theme.cell}`}>{ms.dayTotal}일</td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {/* 전체 합계 */}
                  {(() => {
                    const s = gradeSummary("all");
                    return (
                      <tr className="bg-muted/40 font-semibold">
                        <td className="px-3 py-1.5 whitespace-nowrap text-xs">전체</td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums text-xs">
                          {s.count}명 <span className="font-normal text-muted-foreground">(남 {s.maleCount}/여 {s.femaleCount})</span>
                        </td>
                        {s.mealStats.map((ms) => {
                          const theme = MEAL_THEME[ms.kind];
                          if (ms.exemptionSelectable) {
                            return (
                              <Fragment key={ms.kind}>
                                <td className={`px-3 py-1.5 text-center whitespace-nowrap tabular-nums text-xs ${theme.cell}`}>{ms.exemptCount}</td>
                                <td className={`px-3 py-1.5 text-center whitespace-nowrap tabular-nums text-xs ${theme.cell}`}>{ms.dayTotal}일</td>
                              </Fragment>
                            );
                          }
                          return (
                            <td key={`${ms.kind}-days`} className={`px-3 py-1.5 text-center whitespace-nowrap tabular-nums text-xs ${theme.cell}`}>{ms.dayTotal}일</td>
                          );
                        })}
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
