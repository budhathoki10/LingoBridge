import {
  MAX_TRANSLATION_CODE_POINTS,
  MAX_TRANSLATION_UTF8_BYTES,
  translationTextSchema,
} from "@lingobridge/contracts";

export const SELECTION_MAGIC_CONTENT_SCRIPT_ID = "lingobridge-selection-magic";
export const SELECTION_MAGIC_STORAGE_KEY = "lingobridgeSelectionMagic";
export const SELECTION_MAGIC_EXPIRY_MS = 5 * 60 * 1_000;
export const SELECTION_MAGIC_STABILITY_MS = 180;
export const ALL_SITE_PATTERNS = ["http://*/*", "https://*/*"] as const;

export interface SelectionMagicSettings {
  disabledOrigins: string[];
  enabled: boolean;
}

export const DEFAULT_SELECTION_MAGIC_SETTINGS: SelectionMagicSettings = {
  disabledOrigins: [],
  enabled: false,
};

export type SelectionRejectionReason =
  | "collapsed"
  | "duplicate"
  | "extension-owned"
  | "hidden"
  | "oversized"
  | "password"
  | "unsupported"
  | "whitespace";

export interface SelectionEligibilityInput {
  collapsed: boolean;
  duplicate: boolean;
  extensionOwned: boolean;
  hidden: boolean;
  password: boolean;
  supportedPage: boolean;
  text: string;
}

export type SelectionEligibility =
  | { eligible: true; text: string }
  | { eligible: false; reason: SelectionRejectionReason };

export type SensitiveSelectionKind =
  | "health"
  | "identity"
  | "one-time-code"
  | "password"
  | "payment-card"
  | "secret";

export interface AnchoredPositionInput {
  anchor: Pick<DOMRect, "bottom" | "left" | "right" | "top">;
  gap?: number;
  height: number;
  margin?: number;
  viewportHeight: number;
  viewportWidth: number;
  width: number;
}

export interface AnchoredPosition {
  left: number;
  top: number;
}

export type SelectionMagicMessage =
  | { type: "lingobridge:selection-magic:disable" }
  | { type: "lingobridge:selection-magic:ping" }
  | { type: "lingobridge:selection-magic:reconcile" }
  | { text?: string; type: "lingobridge:selection-magic:translate" };

export interface SelectionMagicStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function isOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === value;
  } catch {
    return false;
  }
}

export function normalizeSelectionMagicSettings(value: unknown): SelectionMagicSettings {
  if (!value || typeof value !== "object") return DEFAULT_SELECTION_MAGIC_SETTINGS;
  const candidate = value as Partial<SelectionMagicSettings>;
  return {
    disabledOrigins: Array.isArray(candidate.disabledOrigins)
      ? [...new Set(candidate.disabledOrigins.filter(isOrigin))].slice(0, 500)
      : [],
    enabled: candidate.enabled === true,
  };
}

function extensionStorage(): SelectionMagicStorage {
  const runtime = globalThis as typeof globalThis & {
    chrome?: { storage?: { local?: SelectionMagicStorage } };
  };
  const storage = runtime.chrome?.storage?.local;
  if (!storage) throw new Error("Extension storage is unavailable.");
  return storage;
}

export function createSelectionMagicRepository(storage: SelectionMagicStorage) {
  return {
    async load(): Promise<SelectionMagicSettings> {
      const stored = await storage.get(SELECTION_MAGIC_STORAGE_KEY);
      return normalizeSelectionMagicSettings(stored[SELECTION_MAGIC_STORAGE_KEY]);
    },
    async save(settings: SelectionMagicSettings): Promise<SelectionMagicSettings> {
      const normalized = normalizeSelectionMagicSettings(settings);
      await storage.set({ [SELECTION_MAGIC_STORAGE_KEY]: normalized });
      return normalized;
    },
  };
}

export function loadSelectionMagicSettings(): Promise<SelectionMagicSettings> {
  return createSelectionMagicRepository(extensionStorage()).load();
}

export function saveSelectionMagicSettings(
  settings: SelectionMagicSettings,
): Promise<SelectionMagicSettings> {
  return createSelectionMagicRepository(extensionStorage()).save(settings);
}

export function pageOriginFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function originToMatchPattern(origin: string): string | null {
  const normalized = pageOriginFromUrl(origin);
  return normalized ? `${normalized}/*` : null;
}

export function isPageMatchPattern(pattern: string): boolean {
  return /^https?:\/\/(?:\*|\*\.[^/]+|[^/*]+)(?::\d+)?\/\*$/u.test(pattern);
}

/**
 * True when the granted origins include at least one ordinary webpage, ignoring the gateway
 * origin the extension always holds. Granting webpage access is the user's explicit act of
 * turning Selection Magic on, wherever it happens.
 */
export function grantsWebpageAccess(origins: readonly string[], gatewayOrigin: string): boolean {
  const gatewayPattern = originToMatchPattern(gatewayOrigin);
  return origins.some((pattern) => isPageMatchPattern(pattern) && pattern !== gatewayPattern);
}

export function buildSelectionRegistration(
  settings: SelectionMagicSettings,
  grantedOrigins: readonly string[],
): { excludeMatches: string[]; matches: string[] } | null {
  if (!settings.enabled) return null;
  const matches = [...new Set(grantedOrigins.filter(isPageMatchPattern))];
  if (matches.length === 0) return null;
  const disabledPatterns = settings.disabledOrigins.flatMap((origin) => {
    const pattern = originToMatchPattern(origin);
    return pattern ? [pattern] : [];
  });
  const exactDisabled = new Set(disabledPatterns);
  const activeMatches = matches.filter((pattern) => !exactDisabled.has(pattern));
  if (activeMatches.length === 0) return null;
  const hasBroadAccess = activeMatches.some((pattern) =>
    ALL_SITE_PATTERNS.includes(pattern as never),
  );
  return {
    excludeMatches: hasBroadAccess ? disabledPatterns : [],
    matches: activeMatches,
  };
}

function samePatterns(left: readonly string[] = [], right: readonly string[] = []): boolean {
  if (left.length !== right.length) return false;
  const known = new Set(left);
  return right.every((pattern) => known.has(pattern));
}

/**
 * True when an existing registration already covers exactly what is wanted. Re-registering tears
 * down every running content script, so the caller needs to know when it can leave one alone.
 */
export function selectionRegistrationMatches(
  registered: { excludeMatches?: readonly string[]; matches?: readonly string[] },
  desired: { excludeMatches: readonly string[]; matches: readonly string[] },
): boolean {
  return (
    samePatterns(registered.matches, desired.matches) &&
    samePatterns(registered.excludeMatches, desired.excludeMatches)
  );
}

export function evaluateSelection(input: SelectionEligibilityInput): SelectionEligibility {
  if (!input.supportedPage) return { eligible: false, reason: "unsupported" };
  if (input.extensionOwned) return { eligible: false, reason: "extension-owned" };
  if (input.password) return { eligible: false, reason: "password" };
  if (input.hidden) return { eligible: false, reason: "hidden" };
  if (input.collapsed) return { eligible: false, reason: "collapsed" };
  if (input.text.trim().length === 0) return { eligible: false, reason: "whitespace" };
  if (!translationTextSchema.safeParse(input.text).success) {
    return { eligible: false, reason: "oversized" };
  }
  if (input.duplicate) return { eligible: false, reason: "duplicate" };
  return { eligible: true, text: input.text };
}

export function selectionFingerprint(text: string, rect: Pick<DOMRect, "left" | "top">): string {
  return `${Array.from(text).length}:${text}:${Math.round(rect.left)}:${Math.round(rect.top)}`;
}

function passesLuhn(value: string): boolean {
  const digits = value.replaceAll(/[^0-9]/gu, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let total = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
    doubleDigit = !doubleDigit;
  }
  return total % 10 === 0;
}

export function detectSensitiveSelection(text: string): SensitiveSelectionKind | null {
  const normalized = text.trim();
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu.test(normalized)) return "secret";
  if (
    /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[opusr]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})\b/u.test(
      normalized,
    )
  ) {
    return "secret";
  }
  if (/\b(?:password|passcode|pin)\s*[:=-]\s*\S+/iu.test(normalized)) return "password";
  if (
    /\b(?:otp|one[- ]time(?: password| code)?|verification code)\b[^\n\r]{0,30}\b\d{4,8}\b/iu.test(
      normalized,
    )
  ) {
    return "one-time-code";
  }
  const cardCandidates = normalized.match(/(?:\d[ -]?){13,19}/gu) ?? [];
  if (cardCandidates.some(passesLuhn)) return "payment-card";
  if (
    /\b(?:passport|citizenship|national id|social security|ssn)\b[^\n\r]{0,40}\d{4,}/iu.test(
      normalized,
    )
  ) {
    return "identity";
  }
  if (/\b(?:patient id|medical record|mrn|diagnosis|prescription)\b/iu.test(normalized)) {
    return "health";
  }
  return null;
}

export function computeAnchoredPosition(input: AnchoredPositionInput): AnchoredPosition {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 8;
  const maxLeft = Math.max(margin, input.viewportWidth - input.width - margin);
  const left = Math.min(Math.max(input.anchor.right - input.width, margin), maxLeft);
  const fitsBelow = input.anchor.bottom + gap + input.height <= input.viewportHeight - margin;
  const preferredTop = fitsBelow
    ? input.anchor.bottom + gap
    : input.anchor.top - input.height - gap;
  const maxTop = Math.max(margin, input.viewportHeight - input.height - margin);
  return {
    left: Math.min(Math.max(left, margin), maxLeft),
    top: Math.min(Math.max(preferredTop, margin), maxTop),
  };
}

export function parseSelectionMagicMessage(value: unknown): SelectionMagicMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { text?: unknown; type?: unknown };
  if (
    candidate.type === "lingobridge:selection-magic:disable" ||
    candidate.type === "lingobridge:selection-magic:ping" ||
    candidate.type === "lingobridge:selection-magic:reconcile"
  ) {
    return Object.keys(candidate).every((key) => key === "type") ? { type: candidate.type } : null;
  }
  if (candidate.type !== "lingobridge:selection-magic:translate") return null;
  if (candidate.text === undefined) return { type: candidate.type };
  if (typeof candidate.text !== "string") return null;
  if (
    Array.from(candidate.text).length > MAX_TRANSLATION_CODE_POINTS ||
    new TextEncoder().encode(candidate.text).byteLength > MAX_TRANSLATION_UTF8_BYTES
  ) {
    return null;
  }
  return { text: candidate.text, type: candidate.type };
}
