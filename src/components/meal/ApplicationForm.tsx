"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import AdminMealCalendar from "@/components/meal/AdminMealCalendar";
import { MEAL_THEME } from "@/components/meal/meal-ui";
import {
  MEAL_KINDS,
  MEAL_LABEL,
  METHOD_LABEL,
  monthsOf,
  monthKeyOf,
  type MealKind,
  type MealApplyMethod,
} from "@/lib/meal-plan";
import { todayKST } from "@/lib/timezone";
import { errorTextOf } from "@/lib/fetcher";
import { useAcademicYears } from "@/hooks/useAcademicRoster";
import { useAdminPermission } from "@/hooks/useAdminPermission";
import { isWithinAcademicYear, YEAR_SPAN_MESSAGE } from "@/lib/schemas/meal-plan";

interface ApplicationFormProps {
  applicationId?: number;
}

interface MealFormState {
  price: string;
  exemptionSelectable: boolean;
  method: MealApplyMethod;
  checked: Set<string>;
}

interface DateTimeState {
  date: string;
  hour: string;
  minute: string;
}

type MealsState = Record<MealKind, MealFormState>;

function buildDefaultMeals(): MealsState {
  return Object.fromEntries(
    MEAL_KINDS.map((k) => [
      k,
      { price: "0", exemptionSelectable: false, method: "NONE" as MealApplyMethod, checked: new Set<string>() },
    ]),
  ) as MealsState;
}

function isoToKstDateTime(iso: string): DateTimeState {
  // ISO string을 KST 날짜/시/분으로 분해
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  // Select 옵션이 5분 단위이므로 비 5분 단위 데이터는 내림 처리
  const roundedMinute = Math.floor(parseInt(get("minute"), 10) / 5) * 5;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: get("hour").padStart(2, "0"),
    minute: String(roundedMinute).padStart(2, "0"),
  };
}

/** checked Set에서 현재 monthsOf 범위 밖 키 제거 */
function pruneOutOfRange(
  checked: Set<string>,
  startYear: number,
  startMonth: number,
  monthCount: number,
): Set<string> {
  const validMonthKeys = new Set(
    monthsOf(startYear, startMonth, monthCount).map(
      ({ year, month }) =>
        `${year}-${String(month).padStart(2, "0")}`,
    ),
  );
  const next = new Set<string>();
  for (const key of checked) {
    // key 형태: `${grade}:${YYYY-MM-DD}`
    const dateStr = key.split(":")[1];
    if (dateStr && validMonthKeys.has(monthKeyOf(dateStr))) {
      next.add(key);
    }
  }
  return next;
}

const CURRENT_YEAR = new Date().getFullYear();

export default function ApplicationForm({ applicationId }: ApplicationFormProps) {
  const router = useRouter();
  const isEdit = applicationId != null;
  const { canWrite } = useAdminPermission();
  const yearState = useAcademicYears();

  const today = todayKST();

  const [subject, setSubject] = useState("급식신청");
  const [academicYear, setAcademicYear] = useState<number | null>(null);
  const [storedYear, setStoredYear] = useState<number | null>(null);
  const [storedYearState, setStoredYearState] = useState<string | null>(null);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [description, setDescription] = useState("");
  const [startYear, setStartYear] = useState(CURRENT_YEAR);
  const [startMonth, setStartMonth] = useState(new Date().getMonth() + 1);
  const [monthCount, setMonthCount] = useState(1);
  const [applyStart, setApplyStart] = useState<DateTimeState>({
    date: today,
    hour: "00",
    minute: "00",
  });
  const [applyEnd, setApplyEnd] = useState<DateTimeState>({
    date: today,
    hour: "23",
    minute: "55",
  });
  const [meals, setMeals] = useState<MealsState>(buildDefaultMeals());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  // 수정 모드: 기존 데이터 로드
  useEffect(() => {
    if (!isEdit) return;

    async function load() {
      try {
        const res = await fetch(`/api/admin/applications/${applicationId}`);
        if (!res.ok) {
          setLoadFailed(true);
          toast.error("공고를 불러오지 못했습니다.");
          return;
        }
        const { application } = await res.json();
        setStoredYear(application.academicYear);
        setAcademicYear(application.resolvedAcademicYear);
        setStoredYearState(application.academicYearState);
        setRegistrationCount(application.registrationCount);

        // subject: "YYYY년 MM월 " 접두사 제거
        const rawSubject: string = application.title ?? "";
        const stripped = rawSubject.replace(/^\d{4}년 \d{2}월 /, "");
        setSubject(stripped);
        setDescription(application.description ?? "");
        setStartYear(application.startYear ?? CURRENT_YEAR);
        setStartMonth(application.startMonth ?? 1);
        setMonthCount(application.monthCount ?? 1);

        if (application.applyStartAt) {
          setApplyStart(isoToKstDateTime(application.applyStartAt));
        }
        if (application.applyEndAt) {
          setApplyEnd(isoToKstDateTime(application.applyEndAt));
        }

        // meals 복원
        const nextMeals = buildDefaultMeals();
        for (const m of application.meals ?? []) {
          const kind = m.mealKind as MealKind;
          if (!MEAL_KINDS.includes(kind)) continue;
          const checkedSet = new Set<string>(
            (m.dates ?? []).map(
              (d: { grade: number; date: string }) => `${d.grade}:${d.date}`,
            ),
          );
          nextMeals[kind] = {
            price: String(m.price ?? 0),
            exemptionSelectable: m.exemptionSelectable ?? false,
            method: (m.method ?? "NONE") as MealApplyMethod,
            checked: checkedSet,
          };
        }
        setMeals(nextMeals);
      } catch {
        setLoadFailed(true);
        toast.error("공고를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [applicationId, isEdit]);

  // startYear/startMonth/monthCount 변경 시 범위 밖 checked 키 정리
  const handleRangeChange = useCallback(
    (year: number, month: number, count: number) => {
      setStartYear(year);
      setStartMonth(month);
      setMonthCount(count);
      setMeals((prev) => {
        const next = { ...prev };
        for (const kind of MEAL_KINDS) {
          const pruned = pruneOutOfRange(prev[kind].checked, year, month, count);
          if (pruned.size !== prev[kind].checked.size) {
            next[kind] = { ...prev[kind], checked: pruned };
          }
        }
        return next;
      });
    },
    [],
  );

  function updateMeal<K extends keyof MealFormState>(
    kind: MealKind,
    field: K,
    value: MealFormState[K],
  ) {
    setMeals((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], [field]: value },
    }));
  }

  const selectedYear = academicYear;
  const usesPreparingDefault = !isEdit && yearState.notReady;
  const selectedYearState = yearState.years.find((row) => row.year === selectedYear)?.state
    ?? (isEdit && (selectedYear === storedYear || storedYear === null) ? storedYearState : undefined);
  const academicYearOptions = yearState.years.filter((row) => row.state !== "ARCHIVED" || row.year === storedYear);
  const yearLocked = isEdit && registrationCount > 0;

  async function handleSave() {
    if (!canWrite || loadFailed || saving) return;
    if (!usesPreparingDefault && (selectedYear === null || !Number.isInteger(selectedYear) || selectedYear < 2000 || selectedYear > 2100)) {
      toast.error("학년도를 입력해주세요.");
      return;
    }
    if (!isEdit && selectedYearState === "ARCHIVED") {
      toast.error("지난 학년도에는 새 공고를 만들 수 없습니다.");
      return;
    }
    // 클라 검증
    if (!applyStart.date || !applyEnd.date) {
      toast.error("신청 기간 날짜를 입력해주세요.");
      return;
    }
    const startIso = `${applyStart.date}T${applyStart.hour}:${applyStart.minute}:00+09:00`;
    const endIso = `${applyEnd.date}T${applyEnd.hour}:${applyEnd.minute}:00+09:00`;

    if (new Date(endIso) <= new Date(startIso)) {
      toast.error("신청 마감일시는 시작일시 이후여야 합니다.");
      return;
    }

    for (const kind of MEAL_KINDS) {
      const m = meals[kind];
      if (m.method !== "NONE" && m.checked.size === 0) {
        toast.error(`${MEAL_LABEL[kind]}: 신청 가능한 식사는 개설일이 1개 이상이어야 합니다.`);
        return;
      }
      if (Number(m.price) < 0) {
        toast.error(`${MEAL_LABEL[kind]}: 단가는 0 이상이어야 합니다.`);
        return;
      }
    }

    const body = {
      academicYear: usesPreparingDefault ? undefined : selectedYear,
      subject,
      description,
      startYear,
      startMonth,
      monthCount,
      applyStartAt: startIso,
      applyEndAt: endIso,
      meals: MEAL_KINDS.map((kind) => ({
        mealKind: kind,
        price: Number(meals[kind].price || 0),
        exemptionSelectable: meals[kind].exemptionSelectable,
        method: meals[kind].method,
        dates:
          meals[kind].method === "NONE"
            ? []
            : [...meals[kind].checked].map((key) => {
                const [gradeStr, date] = key.split(":");
                return { grade: Number(gradeStr), date };
              }),
      })),
    };

    if (selectedYear !== null && !isWithinAcademicYear(selectedYear, body)) {
      toast.error(YEAR_SPAN_MESSAGE);
      return;
    }

    setSaving(true);
    try {
      const res = isEdit
        ? await fetch(`/api/admin/applications/${applicationId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/applications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const json = await res.json();
      if (!res.ok) {
        toast.error(errorTextOf(json, "저장에 실패했습니다."));
        return;
      }
      toast.success(isEdit ? "공고가 수정되었습니다." : "공고가 생성되었습니다.");
      router.push("/admin?tab=applications");
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const months = monthsOf(startYear, startMonth, monthCount);

  const yearOptions = [...new Set([CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1, startYear,
    ...(selectedYear === null ? [] : [selectedYear, selectedYear + 1])])].sort((a, b) => a - b);
  const hourOptions = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minuteOptions = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

  if (loading) {
    return (
      <div className="h-dvh flex items-center justify-center">
        <p className="text-muted-foreground text-sm">불러오는 중...</p>
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
          급식신청 공고 {isEdit ? "수정" : "작성"}
        </h1>
      </header>

      {/* 본문 스크롤 영역 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">

        <div className="card-elevated rounded-2xl border-0 p-2 sm:p-3 space-y-2">
          <Label htmlFor="application-academic-year" className="text-sm font-semibold whitespace-nowrap">공고 학년도</Label>
          {yearState.notReady ? (
            <p id="application-academic-year" className="flex min-h-11 items-center text-sm whitespace-nowrap">
              {selectedYear === null ? "현재 운영 학년도 (서버에서 적용)" : `${selectedYear}학년도`}
            </p>
          ) : (
            <Select value={selectedYear === null ? null : String(selectedYear)} disabled={yearLocked || !canWrite || yearState.isLoading || Boolean(yearState.error)}
              onValueChange={(value) => {
                if (!value) return;
                const year = Number(value);
                setAcademicYear(year);
                handleRangeChange(year + (startMonth < 3 ? 1 : 0), startMonth, monthCount);
              }}>
              <SelectTrigger id="application-academic-year" aria-label="공고 학년도" className="min-h-11 w-full sm:w-64">
                <SelectValue placeholder="학년도를 선택하세요">{selectedYear === null ? undefined : `${selectedYear}학년도`}</SelectValue>
              </SelectTrigger>
              <SelectContent>{academicYearOptions.map((row) => (
                <SelectItem key={row.year} value={String(row.year)}>{row.year}학년도 · {row.state === "DRAFT" ? "준비 중 · 접수 전" : row.state === "ACTIVE" ? "운영 중" : "지난 학년도"}</SelectItem>
              ))}</SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground break-keep">학년도는 3월부터 다음 해 2월까지입니다. 공고 기간과 개설일을 같은 학년도 안에서 설정하세요.</p>
          {selectedYearState === "DRAFT" && <p role="status" className="text-sm font-medium text-amber-700 break-keep">준비 중인 학년도 공고입니다. 접수 전 상태로 준비하며, 학년도 전환이 끝난 뒤 신청을 받을 수 있습니다.</p>}
          {yearLocked && <p className="text-xs text-muted-foreground break-keep">취소를 포함한 신청 {registrationCount}건이 있어 학년도를 바꿀 수 없습니다.</p>}
          {yearState.notReady && <p className="text-xs text-muted-foreground break-keep">명부 전환 준비 중에는 기존 운영 학년도를 사용합니다. 학년도 선택은 준비가 끝나면 열립니다.</p>}
          {yearState.error && <p role="alert" className="text-sm text-destructive break-keep">학년도 목록을 불러오지 못했습니다.</p>}
          {loadFailed && <p role="alert" className="text-sm text-destructive break-keep">기존 공고를 불러오지 못해 저장할 수 없습니다.</p>}
          {!canWrite && <p className="text-sm text-muted-foreground whitespace-nowrap">조회 전용</p>}
        </div>

        {/* 1. 제목줄: 년도 + 월 + N개월간 + 제목 */}
        <div className="card-elevated rounded-2xl border-0 p-3 space-y-2">
          <Label className="text-sm font-semibold">공고 기간 및 제목</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={String(startYear)}
              onValueChange={(v) => handleRangeChange(Number(v), startMonth, monthCount)}
            >
              <SelectTrigger className="min-h-11 w-24">
                <SelectValue>{(v: string) => `${v}년`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}년
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={String(startMonth)}
              onValueChange={(v) => handleRangeChange(startYear, Number(v), monthCount)}
            >
              <SelectTrigger className="min-h-11 w-20">
                <SelectValue>{(v: string) => `${v}월`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m}월
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-sm text-muted-foreground whitespace-nowrap">부터</span>

            <Select
              value={String(monthCount)}
              onValueChange={(v) => handleRangeChange(startYear, startMonth, Number(v))}
            >
              <SelectTrigger className="min-h-11 w-24">
                <SelectValue>{(v: string) => `${v}개월간`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}개월간
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              className="min-h-11 flex-1 min-w-32"
              placeholder="제목 (예: 급식신청)"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground break-keep">
            저장 시 제목: <span className="font-medium">{startYear}년 {String(startMonth).padStart(2, "0")}월 {subject}</span>
          </p>
        </div>

        {/* 2. 내용 */}
        <div className="card-elevated rounded-2xl border-0 p-3 space-y-2">
          <Label className="text-sm font-semibold">공고 내용</Label>
          <textarea
            rows={6}
            className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
            placeholder="공고 내용을 입력하세요..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* 3. 신청 기간 */}
        <div className="card-elevated rounded-2xl border-0 p-3 space-y-2">
          <Label className="text-sm font-semibold">신청 기간</Label>
          <div className="space-y-2">
            {(
              [
                { label: "시작", state: applyStart, setter: setApplyStart },
                { label: "마감", state: applyEnd, setter: setApplyEnd },
              ] as const
            ).map(({ label, state, setter }) => (
              <div key={label} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground whitespace-nowrap w-8">{label}</span>
                <Input
                  type="date"
                  className="min-h-11 w-36"
                  value={state.date}
                  onChange={(e) => setter((prev) => ({ ...prev, date: e.target.value }))}
                />
                <Select
                  value={state.hour}
                  onValueChange={(v) => { if (v) setter((prev) => ({ ...prev, hour: v })); }}
                >
                  <SelectTrigger className="min-h-11 w-16">
                    <SelectValue>{(v: string) => `${v}시`}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {hourOptions.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}시
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={state.minute}
                  onValueChange={(v) => { if (v) setter((prev) => ({ ...prev, minute: v })); }}
                >
                  <SelectTrigger className="min-h-11 w-16">
                    <SelectValue>{(v: string) => `${v}분`}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {minuteOptions.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}분
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {label === "시작" ? "부터" : "까지"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 4. 식사별 설정 */}
        {MEAL_KINDS.map((kind) => {
          const theme = MEAL_THEME[kind];
          const m = meals[kind];
          return (
            <div key={kind} className="card-elevated rounded-2xl border-0 overflow-hidden">
              {/* 섹션 헤더 */}
              <div className={`px-3 py-2 flex flex-wrap items-center gap-2 ${theme.head}`}>
                <span className={`text-sm font-semibold whitespace-nowrap ${theme.text}`}>
                  {MEAL_LABEL[kind]}
                </span>

                {/* 단가 */}
                <div className="flex items-center gap-1 flex-1 min-w-36">
                  <Input
                    inputMode="numeric"
                    className="min-h-11 w-28 text-right"
                    value={m.price}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d]/g, "");
                      updateMeal(kind, "price", v);
                    }}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">원 / 1식</span>
                </div>

                {/* 면제 */}
                <Select
                  value={m.exemptionSelectable ? "true" : "false"}
                  onValueChange={(v) =>
                    updateMeal(kind, "exemptionSelectable", v === "true")
                  }
                >
                  <SelectTrigger className="min-h-11 w-28">
                    <SelectValue>{(v: string) => (v === "true" ? "선택가능" : "선택불가")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">선택불가</SelectItem>
                    <SelectItem value="true">선택가능</SelectItem>
                  </SelectContent>
                </Select>

                {/* 신청 방법 */}
                <Select
                  value={m.method}
                  onValueChange={(v) => updateMeal(kind, "method", v as MealApplyMethod)}
                >
                  <SelectTrigger className="min-h-11 w-28">
                    <SelectValue>{(v: string) => METHOD_LABEL[v as MealApplyMethod]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(METHOD_LABEL) as [MealApplyMethod, string][]).map(
                      ([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* 달력 (method !== NONE 일 때만) */}
              {m.method !== "NONE" && (
                <div className="p-2 space-y-3">
                  {months.map(({ year, month }) => (
                    <AdminMealCalendar
                      key={`${year}-${month}`}
                      year={year}
                      month={month}
                      mealKind={kind}
                      checked={m.checked}
                      onChange={(next) => updateMeal(kind, "checked", next)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* 5. 하단 버튼 */}
        <div className="flex justify-end gap-2 pb-4">
          <Link
            href="/admin?tab=applications"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11 whitespace-nowrap")}
          >
            취소
          </Link>
          <Button
            onClick={handleSave}
            disabled={saving || !canWrite || loadFailed || (!usesPreparingDefault && selectedYear === null) || (!isEdit && Boolean(yearState.error))}
            className="min-h-11 whitespace-nowrap"
          >
            {saving ? "저장 중..." : "저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}
