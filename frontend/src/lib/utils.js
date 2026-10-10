import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes safely (ChaiUI-style `cn`). */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
