import { describe, expect, it } from 'vitest';
import { isMentorPassword } from '../src/mentor';

// The password itself is not written here, as the repository is public
describe('mentor password', () => {
  it('rejects other passwords', () => {
    expect(isMentorPassword('astrofoto')).toBe(false);
    expect(isMentorPassword('')).toBe(false);
  });
});
