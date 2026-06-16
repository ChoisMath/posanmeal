"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MEAL_SHORT, type MealKind } from "@/lib/meal-plan";
import { MEAL_THEME } from "@/components/meal/meal-ui";
import { formatDateTimeKST } from "@/lib/timezone";

interface AppMeal {
  mealKind: MealKind;
  method: string;
}
interface AppListItem {
  id: number;
  title: string;
  status: string;
  startYear: number | null;
  startMonth: number | null;
  monthCount: number | null;
  applyStartAt: string | null;
  applyEndAt: string | null;
  meals: AppMeal[];
}

interface RegMeal {
  mealKind: MealKind;
  applied: boolean;
  exempt: boolean;
  dayCount: number;
}
interface Registration {
  id: number;
  createdAt: string;
  addedBy: string | null;
  signature: string;
  user: { number: number | null; name: string };
  meals: RegMeal[];
}
interface DetailData {
  application: {
    id: number;
    title: string;
    meals: { mealKind: MealKind; method: string; exemptionSelectable: boolean }[];
  };
  registrations: Registration[];
}

function targetMonthLabel(app: AppListItem): string {
  if (app.startYear == null || app.startMonth == null) return "대상월 미설정";
  const count = app.monthCount ?? 1;
  if (count <= 1) return `${app.startYear}년 ${app.startMonth}월`;
  return `${app.startYear}년 ${app.startMonth}월부터 ${count}개월`;
}

function isImageSignature(sig: string): boolean {
  return sig.startsWith("data:image");
}

export function TeacherApplications() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  if (selectedId == null) {
    return <ApplicationList onSelect={setSelectedId} />;
  }
  return <ApplicationDetail applicationId={selectedId} onBack={() => setSelectedId(null)} />;
}

function ApplicationList({ onSelect }: { onSelect: (id: number) => void }) {
  const { data, error } = useSWR<{ applications: AppListItem[] }>(
    "/api/teacher/applications",
    fetcher,
    { revalidateOnFocus: false },
  );
  if (error) {
    return <p className="text-center text-muted-foreground py-8 text-sm">데이터를 불러올 수 없습니다.</p>;
  }
  const applications = data?.applications ?? [];
  if (applications.length === 0) {
    return <p className="text-center text-muted-foreground py-8 text-sm">공고가 없습니다.</p>;
  }
  return (
    <div className="space-y-2">
      {applications.map((app) => (
        <button
          key={app.id}
          onClick={() => onSelect(app.id)}
          className="w-full text-left card-elevated rounded-xl border-0 p-3 hover:bg-muted/40 transition-colors min-h-11"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm truncate whitespace-nowrap">{app.title}</span>
            <Badge variant={app.status === "OPEN" ? "default" : "secondary"} className="shrink-0">
              {app.status === "OPEN" ? "진행중" : "마감"}
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
            <span>{targetMonthLabel(app)}</span>
            <span className="flex gap-1">
              {app.meals
                .filter((m) => m.method !== "NONE")
                .map((m) => (
                  <span
                    key={m.mealKind}
                    className={`px-1 rounded ${MEAL_THEME[m.mealKind].cell} ${MEAL_THEME[m.mealKind].text}`}
                  >
                    {MEAL_SHORT[m.mealKind]}
                  </span>
                ))}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function ApplicationDetail({
  applicationId,
  onBack,
}: {
  applicationId: number;
  onBack: () => void;
}) {
  const { data, error, isLoading } = useSWR<DetailData>(
    `/api/teacher/applications/${applicationId}/registrations`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const [zoomSig, setZoomSig] = useState<string | null>(null);

  const application = data?.application;
  const registrations = data?.registrations ?? [];
  const activeMeals = application?.meals.filter((m) => m.method !== "NONE") ?? [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="min-h-11 px-2">
          <ChevronLeft className="h-4 w-4 mr-1" /> 목록
        </Button>
        <h3 className="font-semibold text-sm truncate whitespace-nowrap">
          {application?.title ?? "신청 현황"}
        </h3>
      </div>

      {error ? (
        <p className="text-center text-muted-foreground py-8 text-sm">데이터를 불러올 수 없습니다.</p>
      ) : isLoading ? (
        <p className="text-center text-muted-foreground py-8 text-sm">불러오는 중...</p>
      ) : registrations.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">우리 반 신청자가 없습니다.</p>
      ) : (
        <div className="overflow-auto max-h-[70vh] border rounded-lg">
          <table className="text-xs border-collapse w-full whitespace-nowrap">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 bg-muted px-2 py-2 text-left font-medium text-muted-foreground border-b border-r">
                  번호 이름
                </th>
                <th className="bg-muted px-2 py-2 text-left font-medium text-muted-foreground border-b">신청시간</th>
                {activeMeals.map((m) => (
                  <th
                    key={m.mealKind}
                    className={`px-2 py-2 text-center font-medium border-b ${MEAL_THEME[m.mealKind].head} ${MEAL_THEME[m.mealKind].text}`}
                  >
                    {MEAL_SHORT[m.mealKind]}
                  </th>
                ))}
                <th className="bg-muted px-2 py-2 text-center font-medium text-muted-foreground border-b">서명</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((reg) => (
                <tr key={reg.id} className="hover:bg-muted/50">
                  <td className="sticky left-0 z-10 bg-background px-2 py-1.5 border-b border-r">
                    <span className="font-semibold">{reg.user.number}</span> <span>{reg.user.name}</span>
                    {reg.addedBy === "ADMIN" && (
                      <span className="ml-1 inline-flex items-center px-1 text-[10px] rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                        관리자
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 border-b text-muted-foreground tabular-nums">
                    {formatDateTimeKST(new Date(reg.createdAt))}
                  </td>
                  {activeMeals.map((m) => {
                    const rm = reg.meals.find((x) => x.mealKind === m.mealKind);
                    const theme = MEAL_THEME[m.mealKind];
                    return (
                      <td key={m.mealKind} className={`px-2 py-1.5 text-center border-b ${theme.cell}`}>
                        {rm?.applied ? (rm.exempt ? "면제" : `${rm.dayCount}일`) : "—"}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center border-b">
                    {isImageSignature(reg.signature) ? (
                      <button type="button" onClick={() => setZoomSig(reg.signature)} className="inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={reg.signature} alt="서명" className="h-9 w-auto bg-white rounded border" />
                      </button>
                    ) : (
                      <span className="text-muted-foreground">{reg.signature || "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={zoomSig != null} onOpenChange={(open) => { if (!open) setZoomSig(null); }}>
        <DialogContent className="sm:max-w-md">
          {zoomSig && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={zoomSig} alt="서명 확대" className="w-full bg-white rounded" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
