// Спільні типи API (worker ↔ client).

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
