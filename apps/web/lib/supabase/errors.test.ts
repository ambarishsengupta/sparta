import { describe, expect, it, vi } from 'vitest';
import { SIGN_IN_FAILURE, messageOf, showRejection } from './errors';

// WO-0152: the one rejection path of the forms.
describe('showRejection', () => {
  it('resets busy first, then shows the sentence for the error; a write says the change was not saved', () => {
    const calls: string[] = [];
    showRejection((b) => calls.push(`busy:${b}`), (m) => calls.push(m))(new Error('internal detail'));
    expect(calls).toEqual(['busy:false', messageOf(new Error('x'))]);
    expect(calls[1]).toMatch(/your change was not saved/);
    expect(calls[1]).not.toContain('internal detail');
  });
  it('with write = false (sign-in, export) the sentence never says a change was not saved', () => {
    for (const err of [new Error('x'), new TypeError('x')]) {
      const setFailure = vi.fn();
      showRejection(() => undefined, setFailure, false)(err);
      expect(setFailure).toHaveBeenCalledTimes(1);
      expect(setFailure.mock.calls[0]![0]).not.toMatch(/not saved/);
      expect(setFailure.mock.calls[0]![0]).toBe(messageOf(err, false));
    }
  });
  it('with a sentence of its own (export, sign-in) it shows that sentence for any error, a TypeError included, after resetting busy', () => {
    const calls: string[] = [];
    showRejection((b) => calls.push(`busy:${b}`), (m) => calls.push(m), SIGN_IN_FAILURE)(new TypeError('x'));
    expect(calls).toEqual(['busy:false', SIGN_IN_FAILURE]);
    expect(SIGN_IN_FAILURE).not.toMatch(/not saved|network|reach the server/i);
  });
});
