// Спільні типи API (worker ↔ client).
import type { Section } from "./spots";

export type Role = "admin" | "viewer";

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
}

// ── Вхід (крок 1: пароль) ──
export interface LoginBody {
  email: string;
  password: string;
}
/** Наступний крок після коректного пароля. */
export interface LoginResult {
  next: "totp" | "enroll";
}

// ── Крок 2: TOTP або резервний код ──
export interface TotpBody {
  code?: string;
  backupCode?: string;
}
export interface AuthOkResult {
  user: SessionUser;
}

// ── Enrollment (перший вхід): зміна пароля → QR → підтвердження → резервні коди ──
export interface EnrollStatus {
  mustChangePassword: boolean;
  email: string;
}
export interface EnrollPasswordBody {
  newPassword: string;
}
export interface EnrollTotpStartResult {
  secret: string; // base32 (показати текстом під QR)
  otpauthUri: string; // для QR
}
export interface EnrollConfirmBody {
  code: string;
}
export interface EnrollConfirmResult {
  backupCodes: string[];
  user: SessionUser;
}

// ── Сесія користувача ──
export interface MeResult {
  user: SessionUser;
}
export interface SessionInfo {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

export const PASSWORD_MIN_LENGTH = 12;

// ─── Місця / власники / нотатки (етап 3) ───

export interface SpotSummary {
  number: number;
  section: Section;
  sheet: number;
  occupied: boolean;
  ownerName: string | null;
}

export interface SpotOwnerView {
  ownerId: number;
  fullName: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  isPrimary: boolean;
  startedAt: string;
}

export interface OwnerHistoryEntry {
  fullName: string;
  isPrimary: boolean;
  startedAt: string;
  endedAt: string | null;
}

export interface NoteView {
  id: number;
  kind: "manual" | "project_auto";
  body: string;
  createdAt: string;
  createdByEmail: string | null;
  projectId: number | null;
}

export interface SpotDetail {
  number: number;
  section: Section;
  sheet: number;
  plate: string | null;
  carMake: string | null;
  carModel: string | null;
  owners: SpotOwnerView[];
  history: OwnerHistoryEntry[];
  notes: NoteView[];
}

export interface SpotUpdateBody {
  plate?: string | null;
  carMake?: string | null;
  carModel?: string | null;
}

export interface SetOwnerBody {
  fullName: string;
  phone?: string | null;
  phone2?: string | null;
  email?: string | null;
  comment?: string | null;
}

export interface OwnerUpdateBody {
  fullName?: string;
  phone?: string | null;
  phone2?: string | null;
  email?: string | null;
  comment?: string | null;
}

export interface OwnerListItem {
  id: number;
  fullName: string;
  phone: string | null;
  spots: number[];
}

export interface OwnerDetail {
  id: number;
  fullName: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  comment: string | null;
  spots: { number: number; section: Section }[];
}

export interface NoteCreateBody {
  body: string;
}
