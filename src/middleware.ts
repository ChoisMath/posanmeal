import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Public routes (Set for O(1) lookup on exact matches)
  const publicExact = new Set(["/", "/check", "/admin/login"]);
  const publicPrefixes = ["/api/auth", "/api/checkin", "/api/uploads", "/_next", "/uploads"];

  if (publicExact.has(pathname) || publicPrefixes.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }
    return NextResponse.redirect(new URL("/", req.url));
  }

  const role = session.user?.role;

  if (pathname.startsWith("/student") && role !== "STUDENT") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (pathname.startsWith("/teacher") && role !== "TEACHER") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (
    pathname.startsWith("/admin") &&
    !pathname.startsWith("/admin/login") &&
    role !== "ADMIN"
  ) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  if (pathname.startsWith("/api/admin") && role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (pathname.startsWith("/api/teacher") && role !== "TEACHER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.next();
});

export const runtime = "nodejs";

export const config = {
  /*
   * Match every request path EXCEPT:
   *  - Next.js internals: `/_next/*`
   *  - Any path with a file extension (contains a `.`)
   *
   * The file-extension rule keeps the middleware from intercepting every
   * public asset and every app-router file-convention icon for unauthenticated
   * visitors. It covers:
   *   /favicon.ico, /apple-icon.png, /opengraph-image.png, /twitter-image.png,
   *   /manifest.webmanifest, /meal.png, /meal.ico, /icon-192.png,
   *   /icon-512.png, /icon-maskable-512.png, /file.svg, /globe.svg,
   *   /next.svg, /vercel.svg, /window.svg, etc.
   *
   * Without this, unauthenticated hits on / or /check got 302'd to the login
   * page for /meal.png and /manifest.webmanifest, which broke the top-left
   * logo on public pages and blocked PWA installability (the browser received
   * HTML instead of the manifest JSON).
   */
  matcher: ["/((?!_next/|.*\\..*).*)"],
};
