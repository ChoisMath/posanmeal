"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAcademicYears } from "@/hooks/useAcademicRoster";
import { AdminMealTable } from "@/components/AdminMealTable";
import { RosterManager } from "./RosterManager";
import { CheckInReviewPanel } from "./CheckInReviewPanel";

export function AdminSettingsPanels({ canWrite, isMain, onPendingChange }: {
  canWrite: boolean;
  isMain: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const years = useAcademicYears();
  const [rosterOpen, setRosterOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTab, setReviewTab] = useState("offline");
  const [pending, setPending] = useState(false);

  function changePending(value: boolean) {
    setPending(value);
    onPendingChange(value);
  }

  return <>
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border p-2">
        <div className="flex min-w-max items-center gap-3">
          <h3 className="whitespace-nowrap text-sm font-semibold">학년도 관리</h3>
          <span className="whitespace-nowrap text-xs text-muted-foreground">{years.activeYear?.year ?? "—"}</span>
          <Button variant="outline" size="sm" className="ml-auto h-8 py-1" onClick={() => setRosterOpen(true)}>학년도 관리</Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border p-2">
        <div className="flex min-w-max items-center gap-3">
          <h3 className="whitespace-nowrap text-sm font-semibold">체크인 검토</h3>
          <span className="whitespace-nowrap text-xs text-muted-foreground">오프라인 기록 · 소속 확인필요</span>
          <Button variant="outline" size="sm" className="ml-auto h-8 py-1" onClick={() => setReviewOpen(true)}>체크인 검토</Button>
        </div>
      </div>
    </div>
    <Dialog open={rosterOpen} onOpenChange={setRosterOpen}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-w-[calc(100%-1rem)] flex-col gap-2 overflow-hidden p-2 sm:max-w-6xl sm:p-3">
        <DialogHeader><DialogTitle>학년도 관리</DialogTitle></DialogHeader>
        <div className="min-h-0 flex-1">
          <RosterManager management canWrite={canWrite} isMain={isMain} legacyFallback={<p className="text-sm">학년도 기능 준비 중입니다.</p>} />
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={reviewOpen} onOpenChange={(open) => { if (!pending) setReviewOpen(open); }}>
      <DialogContent showCloseButton={!pending} className="flex h-[calc(100dvh-2rem)] max-w-[calc(100%-1rem)] flex-col gap-2 overflow-hidden p-2 sm:max-w-6xl sm:p-3">
        <DialogHeader><DialogTitle>체크인 검토</DialogTitle></DialogHeader>
        <Tabs value={reviewTab} onValueChange={(value) => { if (!pending) setReviewTab(value); }} className="min-h-0 flex-1">
          <TabsList className="shrink-0">
            <TabsTrigger value="offline">오프라인 기록</TabsTrigger>
            <TabsTrigger value="profile" disabled={pending}>확인필요</TabsTrigger>
          </TabsList>
          <TabsContent value="offline" className="min-h-0 overflow-hidden"><CheckInReviewPanel canWrite={canWrite} onPendingChange={changePending} /></TabsContent>
          <TabsContent value="profile" className="min-h-0 overflow-hidden"><AdminMealTable readonly reviewOnly /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  </>;
}
