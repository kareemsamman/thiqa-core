import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BUNNY_CDN_URL = 'https://cdn.thiqacrm.com';

/**
 * Ensures a storage URL has the full CDN prefix.
 * Handles both relative paths and already-complete URLs.
 */
export function getFullCdnUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  
  // Already a full URL
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  return `${BUNNY_CDN_URL}/${cleanPath}`;
}

/**
 * Format currency with Western numerals (0-9) and ₪ symbol
 * Negative amounts are prefixed with minus sign
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '₪0';
  const sign = amount < 0 ? "-" : "";
  return `${sign}₪${Math.abs(amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * Format date with Western numerals in DD/MM/YYYY format
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-GB');
}

/**
 * Format number with Western numerals (no currency symbol)
 */
export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return '0';
  return num.toLocaleString('en-US');
}
