import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a v4 UUID safely across all Node.js environments and versions.
 * Falls back to the 'uuid' package if crypto.randomUUID is not available.
 */
export function safeRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return uuidv4();
}
