import jwt from "jsonwebtoken";

const QR_SECRET = process.env.QR_JWT_SECRET!;
const EXPIRY_SECONDS = parseInt(
  process.env.QR_TOKEN_EXPIRY_SECONDS || "180",
  10
);

export interface QRTokenPayload {
  userId: number;
  role: "STUDENT" | "TEACHER";
  type: "STUDENT" | "WORK" | "PERSONAL";
}

export function signQRToken(payload: QRTokenPayload): string {
  return jwt.sign(payload, QR_SECRET, { expiresIn: EXPIRY_SECONDS });
}

export function verifyQRToken(token: string): QRTokenPayload {
  return jwt.verify(token, QR_SECRET) as QRTokenPayload;
}

export function getQRExpirySeconds(): number {
  return EXPIRY_SECONDS;
}
