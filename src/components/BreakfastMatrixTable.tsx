"use client";

import { Button } from "@/components/ui/button";

interface Student {
  id: number;
  name: string;
  grade?: number | null;
  classNum?: number | null;
  number?: number | null;
}

interface Registration {
  id: number;
  userId: number;
  status: string;
  selectedDates?: Array<{ date: string }>;
}

interface BreakfastMatrixTableProps {
  allowedDates: string[];
  students: Student[];
  registrations: Registration[];
  onCellClick: (registrationId: number, date: string, selected: boolean) => void | Promise<void>;
  showCancelled?: boolean;
}

function shortDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

export function BreakfastMatrixTable({
  allowedDates,
  students,
  registrations,
  onCellClick,
  showCancelled = false,
}: BreakfastMatrixTableProps) {
  const regByUser = new Map(registrations.map((registration) => [registration.userId, registration]));

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-max border-collapse text-xs whitespace-nowrap">
        <thead>
          <tr>
            <th className="sticky left-0 z-30 bg-muted px-2 py-2 text-left">학생</th>
            {allowedDates.map((date) => (
              <th key={date} className="sticky top-0 z-20 bg-muted px-2 py-2 text-center">
                {shortDate(date)}
              </th>
            ))}
            <th className="sticky right-0 z-30 bg-muted px-2 py-2 text-center">합계</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => {
            const registration = regByUser.get(student.id);
            if (!showCancelled && registration?.status === "CANCELLED") return null;
            const selected = new Set(
              (registration?.selectedDates ?? []).map((item) => item.date.slice(0, 10)),
            );
            return (
              <tr key={student.id} className="border-t">
                <td className="sticky left-0 z-10 bg-background px-2 py-1.5">
                  {student.grade}-{student.classNum}-{student.number} {student.name}
                </td>
                {allowedDates.map((date) => {
                  const checked = selected.has(date);
                  return (
                    <td key={date} className="px-1 py-1 text-center">
                      {registration ? (
                        <Button
                          type="button"
                          variant={checked ? "default" : "outline"}
                          size="sm"
                          className="h-7 w-8 px-0 text-xs"
                          onClick={() => onCellClick(registration.id, date, checked)}
                        >
                          {checked ? "O" : ""}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  );
                })}
                <td className="sticky right-0 z-10 bg-background px-2 py-1.5 text-center font-semibold">
                  {selected.size}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
