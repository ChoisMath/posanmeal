"use client";

import type { ReactNode } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AcademicYearRow } from "@/hooks/useAcademicRoster";
import { YEAR_STATE_LABEL } from "@/lib/admin-roster/labels";

export type RosterToolbarProps = {
  years: AcademicYearRow[];
  selectedYear: number | null;
  selectedState: AcademicYearRow["state"] | null;
  activeYear: number | null;
  role: "STUDENT" | "TEACHER";
  canWrite: boolean;
  includeData: boolean;
  includeCurrent: boolean;
  onSelectYear: (year: number) => void;
  onSelectRole: (role: "STUDENT" | "TEACHER") => void;
  onToggleIncludeData: (next: boolean) => void;
  onToggleIncludeCurrent: (next: boolean) => void;
  onDownload: () => void;
  onOpenImport: () => void;
  onAddUser?: () => void;
  /** 14b가 붙일 자리. 넘기지 않으면 아무것도 그리지 않는다. */
  rolloverAction?: ReactNode;
  archivedAction?: ReactNode;
};

const CHECKBOX = "size-5 shrink-0";

export function RosterToolbar({
  years,
  selectedYear,
  selectedState,
  activeYear,
  role,
  canWrite,
  includeData,
  includeCurrent,
  onSelectYear,
  onSelectRole,
  onToggleIncludeData,
  onToggleIncludeCurrent,
  onDownload,
  onOpenImport,
  onAddUser,
  rolloverAction,
  archivedAction,
}: RosterToolbarProps) {
  const isPastYear = selectedState === "ARCHIVED";

  return (
    <div className="flex flex-col gap-2 mb-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selectedYear === null ? "" : String(selectedYear)}
          onValueChange={(value) => {
            if (typeof value === "string") onSelectYear(Number.parseInt(value, 10));
          }}
        >
          <SelectTrigger className="min-h-11 w-36 rounded-xl whitespace-nowrap" aria-label="학년도 선택">
            <SelectValue placeholder="학년도" />
          </SelectTrigger>
          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year.year} value={String(year.year)} className="whitespace-nowrap">
                {year.year}학년도
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedState && (
          <Badge variant="outline" className="whitespace-nowrap">
            {YEAR_STATE_LABEL[selectedState]}
          </Badge>
        )}

        {activeYear !== null && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            현재 운영 학년도 {activeYear}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2">
          <Button
            variant={role === "STUDENT" ? "default" : "outline"}
            size="sm"
            className="min-h-11 whitespace-nowrap"
            onClick={() => onSelectRole("STUDENT")}
          >
            학생
          </Button>
          <Button
            variant={role === "TEACHER" ? "default" : "outline"}
            size="sm"
            className="min-h-11 whitespace-nowrap"
            onClick={() => onSelectRole("TEACHER")}
          >
            교사
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 whitespace-nowrap"
            onClick={onDownload}
            disabled={selectedYear === null}
          >
            <Download className="h-4 w-4 mr-1" /> 양식 내려받기
          </Button>
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 whitespace-nowrap"
              onClick={onOpenImport}
              disabled={selectedYear === null}
            >
              <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel 올리기
            </Button>
          )}
          {canWrite && onAddUser && (
            <Button size="sm" className="min-h-11 whitespace-nowrap" onClick={onAddUser}>
              추가
            </Button>
          )}
          {rolloverAction}
          {archivedAction}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2 whitespace-nowrap">
          <input
            type="checkbox"
            className={CHECKBOX}
            checked={includeData}
            onChange={(event) => onToggleIncludeData(event.target.checked)}
          />
          기존 데이터 포함
        </label>
        {isPastYear && (
          <label className="flex items-center gap-2 whitespace-nowrap">
            <input
              type="checkbox"
              className={CHECKBOX}
              checked={includeCurrent}
              onChange={(event) => onToggleIncludeCurrent(event.target.checked)}
            />
            현재 학급도 함께 표시
          </label>
        )}
      </div>
    </div>
  );
}
