import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    const role = session.user.role;
    if (role === "STUDENT") redirect("/student");
    if (role === "TEACHER") redirect("/teacher");
    if (role === "ADMIN") redirect("/admin");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">포산고등학교</CardTitle>
          <p className="text-muted-foreground">SMART-QR 석식 관리 시스템</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <Button type="submit" className="w-full" size="lg">
              Google로 로그인
            </Button>
          </form>
          <div className="text-center">
            <a
              href="/admin/login"
              className="text-sm text-muted-foreground hover:underline"
            >
              관리자 로그인
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
