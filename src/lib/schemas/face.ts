import { z } from "zod";
import {
  FACE_EMBEDDING_DIM,
  FACE_MAX_EMBEDDINGS,
  FACE_MIN_EMBEDDINGS,
} from "@/lib/face-constants";

const embeddingSchema = z
  .array(z.number().finite())
  .length(FACE_EMBEDDING_DIM);

export const faceEnrollSchema = z.object({
  embeddings: z.array(embeddingSchema).min(FACE_MIN_EMBEDDINGS).max(FACE_MAX_EMBEDDINGS),
  consentVersion: z.string().min(1),
});

export const faceConfirmationSchema = z.object({
  userId: z.number().int().positive(),
  mealKind: z.enum(["BREAKFAST", "LUNCH", "DINNER"]),
  date: z.iso.date(),
});

export type FaceConfirmation = z.infer<typeof faceConfirmationSchema>;

export const faceCheckSchema = z.object({
  embedding: embeddingSchema,
  type: z.enum(["WORK", "PERSONAL"]).optional(),
  confirmation: faceConfirmationSchema.optional(),
});
