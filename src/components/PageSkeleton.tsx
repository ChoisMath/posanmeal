"use client";

export function QRCardSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-[280px] h-[280px] rounded-xl bg-muted/50 animate-pulse" />
      <div className="h-4 w-24 rounded bg-muted/50 animate-pulse" />
    </div>
  );
}

export function ProfileCardSkeleton() {
  return (
    <div className="space-y-3">
      <div className="w-20 h-20 rounded-full bg-muted/50 animate-pulse mx-auto" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex justify-between py-2.5 border-b border-border/50">
          <div className="h-4 w-16 rounded bg-muted/50 animate-pulse" />
          <div className="h-4 w-24 rounded bg-muted/50 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function CalendarSkeleton() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="h-8 w-8 rounded bg-muted/50 animate-pulse" />
        <div className="h-5 w-32 rounded bg-muted/50 animate-pulse" />
        <div className="h-8 w-8 rounded bg-muted/50 animate-pulse" />
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }, (_, i) => (
          <div key={i} className="h-12 rounded-md bg-muted/50 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="h-10 bg-muted animate-pulse" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 border-t bg-muted/20 animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-muted/50 animate-pulse" />
        ))}
      </div>
      <TableSkeleton rows={5} />
    </div>
  );
}

export function PageLoadingSkeleton() {
  return (
    <div className="min-h-screen bg-warm-subtle">
      <div className="h-14 header-gradient animate-pulse" />
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <div className="h-11 w-full max-w-md mx-auto rounded-xl bg-muted/50 animate-pulse" />
        <div className="max-w-md mx-auto rounded-2xl bg-background/80 p-6 space-y-4">
          <div className="h-6 w-32 rounded bg-muted/50 animate-pulse" />
          <div className="h-40 rounded-xl bg-muted/50 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
