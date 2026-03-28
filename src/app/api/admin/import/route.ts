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
    const validRows = rows.slice(1).filter(([email, , , , name]) => email && name);

    // Batch upsert students in a single transaction
    const upsertedUsers = await prisma.$transaction(
      validRows.map(([email, grade, classNum, number, name]) =>
        prisma.user.upsert({
          where: { email },
          update: { name, grade: parseInt(grade), classNum: parseInt(classNum), number: parseInt(number) },
          create: { email, name, role: "STUDENT", grade: parseInt(grade), classNum: parseInt(classNum), number: parseInt(number) },
        })
      )
    );

    // Batch upsert meal periods in a single transaction
    const mealPeriodOps = validRows
      .map((row, i) => ({ userId: upsertedUsers[i].id, startDate: row[5], endDate: row[6] }))
      .filter((mp) => mp.startDate && mp.endDate);

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

  if (teacherSheetUrl) {
    const id = extractSpreadsheetId(teacherSheetUrl);
    const gid = extractGid(teacherSheetUrl);
    if (!id) return NextResponse.json({ error: "Invalid teacher sheet URL" }, { status: 400 });

    const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    const res = await fetch(csvUrl);
    if (!res.ok) return NextResponse.json({ error: "교사 스프레드시트를 가져올 수 없습니다. 공개 설정을 확인하세요." }, { status: 400 });

    const csv = await res.text();
    const rows = csvToRows(csv);
    const validRows = rows.slice(1).filter(([email, , , , name]) => email && name);

    // Batch upsert teachers in a single transaction
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

  return NextResponse.json({ message: `학생 ${studentCount}명, 교사 ${teacherCount}명 등록 완료`, studentCount, teacherCount });
}
