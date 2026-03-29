import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

function extractGid(url: string): string {
  const match = url.match(/gid=(\d+)/);
  return match ? match[1] : "0";
}

function csvToRows(csv: string): string[][] {
  const rows: string[][] = [];
  const lines = csv.split("\n");
  for (const line of lines) {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          cells.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    cells.push(current.trim());
    if (cells.some((c) => c.length > 0)) {
      rows.push(cells);
    }
  }
  return rows;
}

async function fetchSheet(url: string, label: string): Promise<{ rows: string[][]; error?: string }> {
  const id = extractSpreadsheetId(url);
  const gid = extractGid(url);
  if (!id) return { rows: [], error: `${label} URL이 올바르지 않습니다. Google Spreadsheet URL을 확인하세요.` };

  const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  let res: Response;
  try {
    res = await fetch(csvUrl);
  } catch {
    return { rows: [], error: `${label} 스프레드시트에 연결할 수 없습니다. 네트워크를 확인하세요.` };
  }

  if (!res.ok) {
    return { rows: [], error: `${label} 스프레드시트를 가져올 수 없습니다 (HTTP ${res.status}). 공개 설정을 확인하세요.` };
  }

  const csv = await res.text();
  if (!csv.trim()) {
    return { rows: [], error: `${label} 스프레드시트가 비어 있습니다.` };
  }

  const rows = csvToRows(csv);
  if (rows.length < 2) {
    return { rows: [], error: `${label} 스프레드시트에 데이터 행이 없습니다. 헤더 아래에 데이터를 입력하세요.` };
  }

  return { rows };
}

export async function POST(request: Request) {
  let body: { studentSheetUrl?: string; teacherSheetUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 데이터를 읽을 수 없습니다." }, { status: 400 });
  }

  const { studentSheetUrl, teacherSheetUrl } = body;

  if (!studentSheetUrl && !teacherSheetUrl) {
    return NextResponse.json({ error: "학생 또는 교사 시트 URL을 하나 이상 입력하세요." }, { status: 400 });
  }

  const errors: string[] = [];
  let studentCount = 0;
  let teacherCount = 0;

  try {
    if (studentSheetUrl) {
      const { rows, error } = await fetchSheet(studentSheetUrl, "학생");
      if (error) {
        errors.push(error);
      } else {
        const validRows = rows.slice(1).filter(([email, , , , name]) => email && name);

        if (validRows.length === 0) {
          errors.push("학생 시트에서 유효한 데이터를 찾을 수 없습니다. email과 name 열을 확인하세요.");
        } else {
          // 데이터 유효성 사전 검사
          const rowErrors: string[] = [];
          for (let i = 0; i < validRows.length; i++) {
            const [email, grade, classNum, number] = validRows[i];
            const rowNum = i + 2; // 헤더 + 0-index 보정
            if (isNaN(parseInt(grade)) || isNaN(parseInt(classNum)) || isNaN(parseInt(number))) {
              rowErrors.push(`${rowNum}행: ${email} — 학년/반/번호가 숫자가 아닙니다`);
            }
          }

          if (rowErrors.length > 0) {
            errors.push("학생 데이터 오류:\n" + rowErrors.slice(0, 5).join("\n") +
              (rowErrors.length > 5 ? `\n...외 ${rowErrors.length - 5}건` : ""));
          } else {
            const upsertedUsers = await prisma.$transaction(
              validRows.map(([email, grade, classNum, number, name]) =>
                prisma.user.upsert({
                  where: { email },
                  update: { name, grade: parseInt(grade), classNum: parseInt(classNum), number: parseInt(number) },
                  create: { email, name, role: "STUDENT", grade: parseInt(grade), classNum: parseInt(classNum), number: parseInt(number) },
                })
              )
            );

            const mealPeriodOps = validRows
              .map((row, i) => ({ userId: upsertedUsers[i].id, startDate: row[5], endDate: row[6] }))
              .filter((mp) => mp.startDate && mp.endDate && !isNaN(new Date(mp.startDate).getTime()) && !isNaN(new Date(mp.endDate).getTime()));

            if (mealPeriodOps.length > 0) {
              await prisma.$transaction(
                mealPeriodOps.map((mp) =>
                  prisma.mealPeriod.upsert({
                    where: { userId: mp.userId },
                    update: { startDate: new Date(mp.startDate), endDate: new Date(mp.endDate) },
                    create: { userId: mp.userId, startDate: new Date(mp.startDate), endDate: new Date(mp.endDate) },
                  })
                )
              );
            }

            studentCount = validRows.length;
          }
        }
      }
    }

    if (teacherSheetUrl) {
      const { rows, error } = await fetchSheet(teacherSheetUrl, "교사");
      if (error) {
        errors.push(error);
      } else {
        const validRows = rows.slice(1).filter(([email, , , , name]) => email && name);

        if (validRows.length === 0) {
          errors.push("교사 시트에서 유효한 데이터를 찾을 수 없습니다. email과 name 열을 확인하세요.");
        } else {
          await prisma.$transaction(
            validRows.map(([email, subject, homeroom, position, name]) =>
              prisma.user.upsert({
                where: { email },
                update: { name, subject, homeroom: homeroom || null, position },
                create: { email, name, role: "TEACHER", subject, homeroom: homeroom || null, position },
              })
            )
          );

          teacherCount = validRows.length;
        }
      }
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({
      error: `데이터 저장 중 오류가 발생했습니다: ${errMsg}`,
      studentCount,
      teacherCount,
    }, { status: 500 });
  }

  if (errors.length > 0 && studentCount === 0 && teacherCount === 0) {
    return NextResponse.json({ error: errors.join("\n\n") }, { status: 400 });
  }

  const parts: string[] = [];
  if (studentCount > 0) parts.push(`학생 ${studentCount}명`);
  if (teacherCount > 0) parts.push(`교사 ${teacherCount}명`);

  const message = parts.length > 0 ? `${parts.join(", ")} 등록 완료` : "";
  const warnings = errors.length > 0 ? errors.join("\n\n") : undefined;

  return NextResponse.json({ message, warnings, studentCount, teacherCount });
}
