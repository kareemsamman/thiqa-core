export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

// Israeli ID (Teudat Zehut) checksum validation
export function isValidIsraeliId(raw: string): boolean {
  const id = digitsOnly(raw);
  if (!/^\d{9}$/.test(id)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(id[i]) * ((i % 2) + 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}

export function isValidPhoneNumber10(raw: string): boolean {
  const phone = digitsOnly(raw);
  return /^\d{10}$/.test(phone);
}
