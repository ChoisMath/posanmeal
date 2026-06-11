"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignaturePad } from "@/components/SignaturePad";
import {
  ApplicationApplyForm,
  type ApplyFormMeal,
  type InitialRegistrationMeal,
  type RegistrationMealBody,
} from "./ApplicationApplyForm";
import { studentNumberOf } from "@/lib/meal-plan";
import { formatDateTimeKST } from "@/lib/timezone";
import { useUser } from "@/hooks/useUser";

interface ApplicationDetail {
  id: number;
  title: string;
  description: string | null;
  startYear: number;
  startMonth: number;
  monthCount: number;
  applyStartAt: string;
  applyEndAt: string;
  status: string;
  meals: ApplyFormMeal[];
}

interface MyRegistration {
  status: string;
  addedBy: string | null;
  updatedAt: string;
  meals: InitialRegistrationMeal[];
}

interface StudentApplicationViewProps {
  applicationId: number;
  onBack: () => void;
  onSubmitted: () => void;
}

function formatApplyDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}시${min}분`;
}

export function StudentApplicationView({
  applicationId,
  onBack,
  onSubmitted,
}: StudentApplicationViewProps) {
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [myReg, setMyReg] = useState<MyRegistration | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/applications/${applicationId}`);
        if (!res.ok) {
          toast.error("공고를 불러오지 못했습니다.");
          onBack();
          return;
        }
        const json = await res.json();
        setApplication(json.application);
        setRegistrationCount(json.registrationCount ?? 0);
        setMyReg(json.myRegistration ?? null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [applicationId, onBack]);

  const hasExisting = myReg?.status === "APPROVED";

  const handleCancel = async () => {
    if (!confirm("신청을 취소하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/applications/${applicationId}/register`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("신청이 취소되었습니다.");
        onSubmitted();
        onBack();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "취소에 실패했습니다.");
      }
    } catch {
      toast.error("취소 중 오류가 발생했습니다.");
    }
  };

  const handleSubmit = async (mealsBody: RegistrationMealBody[]) => {
    if (!signature) {
      toast.error("서명을 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature, meals: mealsBody }),
      });

      if (res.ok) {
        toast.success(
          hasExisting ? "신청이 수정되었습니다." : "신청이 완료되었습니다.",
        );
        onSubmitted();
        onBack();
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

  if (loading || !application) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground text-sm">불러오는 중...</p>
      </div>
    );
  }

  const now = new Date();
  const isApplyOpen =
    application.status === "OPEN" &&
    now >= new Date(application.applyStartAt) &&
    now <= new Date(application.applyEndAt);

  const studentNumber =
    user?.grade && user?.classNum && user?.number
      ? studentNumberOf(user.grade, user.classNum, user.number)
      : null;

  return (
    <div className="space-y-3">
      {/* 뒤로가기 버튼 */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-sm min-h-11"
      >
        <ChevronLeft className="size-4" />
        <span>목록으로</span>
      </button>

      {/* 상단 정보 표 */}
      <div className="card-elevated rounded-2xl border-0 p-4 space-y-3">
        <h2 className="font-bold text-base whitespace-nowrap overflow-hidden text-ellipsis" title={application.title}>{application.title}</h2>
        {application.description && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {application.description}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-border/50">
                <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap w-24">신청 기간</td>
                <td className="py-2 font-medium whitespace-nowrap">
                  {formatApplyDateTime(application.applyStartAt)} ~ {formatApplyDateTime(application.applyEndAt)}
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">신청 인원</td>
                <td className="py-2 font-medium whitespace-nowrap">{registrationCount}명</td>
              </tr>
              {user && (
                <>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">이름</td>
                    <td className="py-2 font-medium whitespace-nowrap">{user.name}</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">학번</td>
                    <td className="py-2 font-medium whitespace-nowrap">
                      {studentNumber != null ? studentNumber : `${user.grade}학년 ${user.classNum}반 ${user.number}번`}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        {hasExisting && myReg?.addedBy === "ADMIN" && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            이 신청은 관리자가 대리 신청했습니다 ({formatDateTimeKST(new Date(myReg.updatedAt))})
          </div>
        )}
        {!isApplyOpen && (
          <p className="text-sm text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap">
            {application.status !== "OPEN"
              ? "마감된 공고입니다."
              : "신청 기간이 아닙니다."}
          </p>
        )}
      </div>

      {/* 식사별 신청 폼 (공용 컴포넌트) */}
      <ApplicationApplyForm
        key={applicationId}
        application={application}
        initialMeals={myReg?.meals}
        disabled={!isApplyOpen}
        footer={({ buildMealsBody }) =>
          isApplyOpen ? (
            <>
              <div>
                <p className="text-sm font-medium mb-2">서명</p>
                <SignaturePad onSignatureChange={setSignature} />
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  variant="outline"
                  className="rounded-lg min-h-11 whitespace-nowrap"
                  onClick={onBack}
                >
                  목록으로
                </Button>
                {hasExisting && (
                  <Button
                    variant="outline"
                    className="rounded-lg min-h-11 whitespace-nowrap text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={handleCancel}
                  >
                    신청 취소
                  </Button>
                )}
                <Button
                  className="rounded-lg min-h-11 whitespace-nowrap"
                  disabled={!signature || submitting}
                  onClick={() => handleSubmit(buildMealsBody())}
                >
                  {submitting ? "처리 중..." : hasExisting ? "신청 수정" : "신청하기"}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex justify-end">
              <Button
                variant="outline"
                className="rounded-lg min-h-11 whitespace-nowrap"
                onClick={onBack}
              >
                목록으로
              </Button>
            </div>
          )
        }
      />
    </div>
  );
}
