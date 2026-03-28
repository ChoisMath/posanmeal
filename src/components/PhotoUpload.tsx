"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Trash2 } from "lucide-react";

interface PhotoUploadProps {
  currentPhotoUrl?: string | null;
  onPhotoChange: (url: string | null) => void;
}

export function PhotoUpload({ currentPhotoUrl, onPhotoChange }: PhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("photo", file);
    const res = await fetch("/api/users/me/photo", { method: "POST", body: formData });
    const data = await res.json();
    setUploading(false);
    if (res.ok) onPhotoChange(data.photoUrl);
  }

  async function handleDelete() {
    setUploading(true);
    await fetch("/api/users/me/photo", { method: "DELETE" });
    setUploading(false);
    onPhotoChange(null);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {currentPhotoUrl ? (
        <img src={currentPhotoUrl} alt="Profile" className="w-24 h-24 rounded-full object-cover border" />
      ) : (
        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center">
          <Camera className="h-8 w-8 text-muted-foreground" />
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? "업로드 중..." : "사진 변경"}
        </Button>
        {currentPhotoUrl && (
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={uploading}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
    </div>
  );
}
