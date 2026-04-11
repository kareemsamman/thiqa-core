// Disposable/temporary email domains to block
const DISPOSABLE_DOMAINS = new Set([
  "temp-mail.org", "tempmail.com", "throwaway.email", "guerrillamail.com",
  "guerrillamail.net", "guerrillamail.org", "sharklasers.com", "grr.la",
  "guerrillamailblock.com", "pokemail.net", "spam4.me", "bccto.me",
  "chacuo.net", "discard.email", "discardmail.com", "discardmail.de",
  "emailondeck.com", "fakeinbox.com", "fakemail.net", "getnada.com",
  "harakirimail.com", "jetable.org", "mailcatch.com", "maildrop.cc",
  "mailinator.com", "mailnesia.com", "mailsac.com", "minutemail.com",
  "mohmal.com", "mytemp.email", "nada.email", "one-time.email",
  "tempmailaddress.com", "tempail.com", "trash-mail.com", "trashmail.com",
  "trashmail.me", "trashmail.net", "yopmail.com", "yopmail.fr",
  "10minutemail.com", "20minutemail.com", "mailtemp.info", "tempinbox.com",
  "tmpmail.net", "tmpmail.org", "tempr.email", "dispostable.com",
  "mailforspam.com", "safetymail.info", "inboxkitten.com", "burnermail.io",
  "crazymailing.com", "emailfake.com", "emkei.cz", "mailnator.com",
  "mailtothis.com", "throwam.com", "wegwerfmail.de", "wegwerfmail.net",
]);

export interface PasswordStrength {
  score: number; // 0-4
  label: string;
  color: string;
  checks: {
    minLength: boolean;
    hasUpper: boolean;
    hasNumber: boolean;
    hasSymbol: boolean;
  };
}

export function checkPasswordStrength(password: string): PasswordStrength {
  const checks = {
    minLength: password.length >= 8,
    hasUpper: /[A-Z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSymbol: /[^A-Za-z0-9]/.test(password),
  };

  const score = Object.values(checks).filter(Boolean).length;

  const labels: Record<number, { label: string; color: string }> = {
    0: { label: "ضعيفة جداً", color: "bg-destructive" },
    1: { label: "ضعيفة", color: "bg-destructive" },
    2: { label: "متوسطة", color: "bg-amber-500" },
    3: { label: "جيدة", color: "bg-amber-400" },
    4: { label: "قوية", color: "bg-green-500" },
  };

  return { score, ...labels[score], checks };
}

export function isPasswordValid(password: string): boolean {
  const { checks } = checkPasswordStrength(password);
  return checks.minLength && checks.hasUpper && checks.hasNumber && checks.hasSymbol;
}

export function validateEmailFormat(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return "البريد الإلكتروني مطلوب";

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRegex.test(trimmed)) return "صيغة البريد الإلكتروني غير صحيحة";

  // Check for common typos
  const domain = trimmed.split("@")[1];
  const typos: Record<string, string> = {
    "gmail.con": "gmail.com", "gamil.com": "gmail.com", "gmai.com": "gmail.com",
    "gmial.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
    "hotmail.con": "hotmail.com", "hotmal.com": "hotmail.com",
    "yahoo.con": "yahoo.com", "yahooo.com": "yahoo.com",
    "outlook.con": "outlook.com", "outlok.com": "outlook.com",
  };
  if (typos[domain]) {
    return `هل تقصد @${typos[domain]}؟`;
  }

  // Block disposable/temp email domains
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return "لا يمكن استخدام بريد إلكتروني مؤقت. استخدم بريداً حقيقياً.";
  }

  return null;
}

// Rate limiting for login attempts
const LOGIN_ATTEMPTS_KEY = "thiqa_login_attempts";
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface LoginAttempts {
  count: number;
  lockedUntil: number | null;
}

function getLoginAttempts(): LoginAttempts {
  try {
    const stored = localStorage.getItem(LOGIN_ATTEMPTS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { count: 0, lockedUntil: null };
}

function saveLoginAttempts(attempts: LoginAttempts) {
  localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(attempts));
}

export function isLoginLocked(): { locked: boolean; remainingMinutes: number } {
  const attempts = getLoginAttempts();
  if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
    const remaining = Math.ceil((attempts.lockedUntil - Date.now()) / 60000);
    return { locked: true, remainingMinutes: remaining };
  }
  // Reset if lockout expired
  if (attempts.lockedUntil && Date.now() >= attempts.lockedUntil) {
    saveLoginAttempts({ count: 0, lockedUntil: null });
  }
  return { locked: false, remainingMinutes: 0 };
}

export function recordFailedLogin(): { locked: boolean; attemptsLeft: number } {
  const attempts = getLoginAttempts();
  attempts.count += 1;

  if (attempts.count >= MAX_ATTEMPTS) {
    attempts.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    saveLoginAttempts(attempts);
    return { locked: true, attemptsLeft: 0 };
  }

  saveLoginAttempts(attempts);
  return { locked: false, attemptsLeft: MAX_ATTEMPTS - attempts.count };
}

export function resetLoginAttempts() {
  localStorage.removeItem(LOGIN_ATTEMPTS_KEY);
}
