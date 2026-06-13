import { describe, expect, it } from 'vitest';
import { shouldCommitTaskEdit } from './TaskItem';

describe('TaskItem input handling', () => {
  it('does not commit editing while an IME composition is active', () => {
    expect(shouldCommitTaskEdit('Enter', true)).toBe(false);
  });

  it('commits editing on plain Enter', () => {
    expect(shouldCommitTaskEdit('Enter', false)).toBe(true);
  });

  it('does not commit editing for IME process key events', () => {
    const shouldCommit = shouldCommitTaskEdit as (key: string, isComposing: boolean, keyCode?: number) => boolean;

    expect(shouldCommit('Enter', false, 229)).toBe(false);
  });
});
