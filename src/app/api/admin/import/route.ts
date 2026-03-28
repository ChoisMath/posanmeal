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
  return csv
    .split("\n")
    .map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")))
    .filter((row) => row.some((cell) => cell.length > 0));
}

export async function POST(request: Request) {
  const { studentSheetUrl, teacherSheetUrl } = await request.json();
  let studentCount = 0;
  let teacherCount = 0;

  if (studentSheetUrl) {
    const id = extractSpreadsheetId(studentSheetUrl);
    const gid = extractGid(studentSheetUrl);
    if (!id) return NextResponse.json({ error: "Invalid student sheet URL" }, { status: 400 });

    const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    const res = await fetch(csvUrl);
    if (!res.ok) return NextResponse.json({ error: "학생 스프레드시트를 가져올 수 없습니다. 공개 설정을 확인하세요." }, { status: 400 });

    const csv = await res.text();
    const rows = csvToRows(csv);
    for (let i = 1; i < rows.length; i++) {
      const [email, grade, classNum, number, name, startDate, endDate] = rows[i];
      if (!email || !name) continue;

      const user = await prisma.user.upsert({
        where: { email },
        update: { name, grade: parseInt(grade), classNum: parseInt(classNum), number: parseInt(number) },
        create: { email, name, role: "STUDENT", grade: parseInt(grade), classNum: parseInt(classNum), number: parseInt(number) },
      });

      if (startDate && endDate) {
        await prisma.mealPeriod.upsert({
          where: { userId: user.id },
          update: { startDate: new Date(startDate), endDate: new Date(endDate) },
          create: { userId: user.id, startDate: new Date(startDate), endDate: new Date(endDate) },
        });
      }
      studentCount++;
    }
  }

  if (teacherSheetUrl) {
    const id = extractSpreadsheetId(teacherSheetUrl);
    const gid = extractGid(teacherSheetUrl);
    if (!id) return NextResponse.json({ error: "Invalid teacher sheet URL" }, { status: 400 });

    const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    const res = await fetch(csvUrl);
    if (!res.ok) return NextResponse.json({ error: "교사 스프레드시트를 가져올 수 없습니다. 공개 설정을 확인하세요." }, { status: 400 });

    const csv = await res.text();
    const rows = csvToRows(csv);
    for (let i = 1; i < rows.length; i++) {
      const [email, subject, homeroom, position, name] = rows[i];
      if (!email || !name) continue;

      await prisma.user.upsert({
        where: { email },
        update: { name, subject, homeroom: homeroom || null, position },
        create: { email, name, role: "TEACHER", subject, homeroom: homeroom || null, position },
      });
      teacherCount++;
    }
  }

  return NextResponse.json({ message: `학생 ${studentCount}명, 교사 ${teacherCount}명 등록 완료`, studentCount, teacherCount });
}
