"use client";

import type { ReactNode } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AcademicYearRow } from "@/hooks/useAcademicRoster";
import { YEAR_STATE_LABEL } from "@/lib/admin-roster/labels";

export type RosterToolbarProps = {
  years: AcademicYearRow[];
  selectedYear: number | null;
  selectedState: AcademicYearRow["state"] | null;
  activeYear: number | null;
  role: "STUDENT" | "TEACHER";
  grade: number | null;
  management: boolean;
  canWrite: boolean;
  includeExcluded: boolean;
  canAdd: boolean;
  onSelectYear: (year: number) => void;
  onSelectCategory: (role: "STUDENT" | "TEACHER", grade: number | null) => void;
  onToggleIncludeExcluded: (next: boolean) => void;
  onOpenImport: () => void;
  onAddUser?: () => void;
  rolloverAction?: ReactNode;
  archivedAction?: ReactNode;
};

export function RosterToolbar({
  years, selectedYear, selectedState, activeYear, role, grade, management,
  canWrite, includeExcluded, canAdd, onSelectYear, onSelectCategory,
  onToggleIncludeExcluded, onOpenImport, onAddUser, rolloverAction, archivedAction,
}: RosterToolbarProps) {
  return (
    <div className="flex shrink-0 flex-col gap-1">
      {management && <div className="overflow-x-auto">
        <div className="flex min-w-max items-center gap-2 py-1">
          <select value={selectedYear ?? ""} onChange={(event) => onSelectYear(Number(event.target.value))}
            aria-label="학년도 선택" className="h-8 rounded-md border bg-background px-2 text-sm">
            {selectedYear === null && <option value="">학년도 선택</option>}
            {years.map((year) => <option key={year.year} value={year.year}>{year.year}학년도 · {YEAR_STATE_LABEL[year.state]}</option>)}
          </select>
          {rolloverAction}
          {archivedAction}
          {canWrite && selectedState === "DRAFT" && <label className="flex items-center gap-1.5 whitespace-nowrap text-xs">
            <input type="checkbox" checked={includeExcluded} onChange={(event) => onToggleIncludeExcluded(event.target.checked)} /> 제외된 항목
          </label>}
        </div>
      </div>}
      <div className="overflow-x-auto">
        <div className="flex min-w-max items-center gap-2 py-1">
          <span className="whitespace-nowrap text-xs text-muted-foreground">{activeYear ?? "—"}</span>
          <div className="flex items-center gap-1" aria-label="사용자 구분">
            <Button size="sm" variant={role === "TEACHER" ? "default" : "outline"} className="h-8 px-2 py-1" onClick={() => onSelectCategory("TEACHER", null)}>교사</Button>
            {management && <Button size="sm" variant={role === "STUDENT" && grade === null ? "default" : "outline"} className="h-8 px-2 py-1" onClick={() => onSelectCategory("STUDENT", null)}>전체 학생</Button>}
            {[1, 2, 3].map((value) => <Button key={value} size="sm" variant={role === "STUDENT" && grade === value ? "default" : "outline"} className="h-8 px-2 py-1" onClick={() => onSelectCategory("STUDENT", value)}>{value}학년</Button>)}
          </div>
          <div className="ml-auto flex items-center gap-2 pl-2">
            <Button variant="outline" size="sm" className="h-8 py-1" onClick={onOpenImport} disabled={selectedYear === null}><FileSpreadsheet className="size-4" /> Excel</Button>
            {canWrite && onAddUser && <Button size="sm" className="h-8 py-1" onClick={onAddUser} disabled={!canAdd}>추가</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
