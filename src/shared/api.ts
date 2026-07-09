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
  ownerPhone: string | null;
  plate: string | null;
  hasDebt: boolean;
}

export interface SpotOwnerView {
  ownerId: number;
  fullName: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  comment: string | null;
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

export type PaymentStatus = "unpaid" | "paid" | "overpaid" | "underpaid";

export interface SpotProjectView {
  projectId: number;
  title: string;
  status: ProjectStatus;
  shareKop: number;
  paidKop: number;
  paidAt: string | null;
  paymentStatus: PaymentStatus;
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
  projects: SpotProjectView[];
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

// ─── Проєкти (етап 4) ───

export type ProjectStatus = "draft" | "active" | "completed" | "archived";
export type PaymentMethod = "cash" | "transfer" | "other";

export interface ProjectListItem {
  id: number;
  title: string;
  status: ProjectStatus;
  cancelled: boolean;
  totalKop: number;
  spotCount: number;
  paidCount: number;
  collectedKop: number;
}

export interface ProjectParticipant {
  spotId: number;
  number: number;
  section: Section;
  ownerName: string | null;
  shareKop: number;
  paidKop: number;
  paidAt: string | null;
  paymentMethod: PaymentMethod | null;
  paymentNote: string | null;
  status: PaymentStatus;
  delta: number;
}

export interface ProjectDetail {
  id: number;
  title: string;
  description: string | null;
  status: ProjectStatus;
  cancelled: boolean;
  totalKop: number;
  createdAt: string;
  activatedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  collectedKop: number;
  participants: ProjectParticipant[];
}

export interface ProjectCreateBody {
  title: string;
  description?: string | null;
  totalKop: number;
}
export interface ProjectUpdateBody {
  title?: string;
  description?: string | null;
  totalKop?: number;
}
export interface SetSpotsBody {
  numbers: number[]; // номери місць-учасників (повний набір)
}
export interface MarkPaidBody {
  numbers: number[]; // номери місць, які позначаємо сплаченими
  paymentMethod?: PaymentMethod;
  paymentNote?: string | null;
  paidAt?: string;
}
export interface CancelPaymentBody {
  number: number; // номер місця
  reason: string;
}
export type ProjectTransition = "activate" | "complete" | "uncomplete" | "to_draft" | "cancel" | "archive" | "unarchive";

// ─── Пошук (етап 5) ───
export interface SearchSpot {
  number: number;
  section: Section;
  ownerName: string | null;
  plate: string | null;
}
export interface SearchOwner {
  id: number;
  fullName: string;
  phone: string | null;
}
export interface SearchProject {
  id: number;
  title: string;
  status: ProjectStatus;
}
export interface SearchResults {
  spots: SearchSpot[];
  owners: SearchOwner[];
  projects: SearchProject[];
}

// ─── Сервіс: користувачі, аудит, безпека (етап 6) ───

export interface UserView {
  id: number;
  email: string;
  role: Role;
  isActive: boolean;
  totpEnabled: boolean;
  mustChangePw: boolean;
  createdAt: string;
}
export interface CreateUserBody {
  email: string;
}
export interface TempPasswordResult {
  email: string;
  tempPassword: string;
}

export interface AuditEntryView {
  id: number;
  at: string;
  userEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  payload: string | null;
  ip: string | null;
}
export interface AuditQuery {
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}
export interface Reenroll2faConfirmBody {
  password: string;
  code: string;
}
export interface BackupCodesBody {
  password: string;
}
