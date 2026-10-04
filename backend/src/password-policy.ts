export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

/** Validate a new password without trimming it or including its value in errors.
 * @param password Plaintext password to check, used only in memory.
 * @param label Human-readable field name for validation errors.
 * @returns Nothing when valid; throws before any account data is changed.
 */
export function assertPasswordLength(password: string, label = "密码"): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`${label}必须为 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符。`);
  }
}
