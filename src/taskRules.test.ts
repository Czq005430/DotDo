import { describe, expect, it } from 'vitest';
import {
  MAX_PINNED_TASKS,
  buildCustomReminderPickerOptions,
  getCustomReminderTime,
  getInitialCustomReminderParts,
  getReminderPresetTime,
  normalizeTasks,
  reorderTasksByDisplayOrder,
  sortTasksForDisplay,
  togglePinnedTask,
} from './taskRules';
import { Task } from './types';

const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  content: `Task ${id}`,
  isCompleted: false,
  isPinned: false,
  createdAt: Number(id),
  ...overrides,
});

describe('taskRules', () => {
  it('limits pinned tasks to the top three and can unpin an existing task', () => {
    const tasks = [
      makeTask('1', { isPinned: true }),
      makeTask('2', { isPinned: true }),
      makeTask('3', { isPinned: true }),
      makeTask('4'),
    ];

    const blocked = togglePinnedTask(tasks, '4');
    expect(blocked.didChange).toBe(false);
    expect(blocked.reason).toBe('max-pinned');
    expect(blocked.tasks.filter((task) => task.isPinned)).toHaveLength(MAX_PINNED_TASKS);

    const unpinned = togglePinnedTask(tasks, '2');
    expect(unpinned.didChange).toBe(true);
    expect(unpinned.tasks.find((task) => task.id === '2')?.isPinned).toBe(false);
  });

  it('sorts pinned active tasks before regular tasks and completed tasks last', () => {
    const tasks = [
      makeTask('1', { createdAt: 30 }),
      makeTask('2', { createdAt: 10, isCompleted: true, isPinned: true }),
      makeTask('3', { createdAt: 20, isPinned: true }),
      makeTask('4', { createdAt: 5 }),
    ];

    expect(sortTasksForDisplay(tasks).map((task) => task.id)).toEqual(['3', '4', '1', '2']);
  });

  it('keeps newly completed tasks in place while completion feedback is deferred', () => {
    const tasks = [
      makeTask('1', { createdAt: 10 }),
      makeTask('2', { createdAt: 20, isCompleted: true }),
      makeTask('3', { createdAt: 30 }),
    ];

    expect(sortTasksForDisplay(tasks, { deferredCompletedTaskIds: new Set(['2']) }).map((task) => task.id)).toEqual(['1', '2', '3']);
  });

  it('keeps later completed tasks above earlier completed tasks', () => {
    const tasks = [
      makeTask('1', { content: '健身', createdAt: 10, isCompleted: true, completedAt: 100 }),
      makeTask('2', { content: '学习', createdAt: 20, isCompleted: true, completedAt: 200 }),
      makeTask('3', { content: '阅读', createdAt: 30 }),
    ];

    expect(sortTasksForDisplay(tasks).map((task) => task.id)).toEqual(['3', '2', '1']);
  });

  it('uses manual order inside the same display group', () => {
    const tasks = [
      makeTask('1', { createdAt: 10, order: 30 }),
      makeTask('2', { createdAt: 20, order: 10 }),
      makeTask('3', { createdAt: 30, order: 20 }),
    ];

    expect(sortTasksForDisplay(tasks).map((task) => task.id)).toEqual(['2', '3', '1']);
  });

  it('reorders tasks by the current display order', () => {
    const tasks = [
      makeTask('1', { createdAt: 10 }),
      makeTask('2', { createdAt: 20 }),
      makeTask('3', { createdAt: 30 }),
    ];
    const visibleTasks = sortTasksForDisplay(tasks);

    const reordered = reorderTasksByDisplayOrder(tasks, '3', '1', visibleTasks, 'order');

    expect(sortTasksForDisplay(reordered).map((task) => task.id)).toEqual(['3', '2', '1']);
  });

  it('swaps completed tasks by completion order inside the completed group', () => {
    const tasks = [
      makeTask('1', { isCompleted: true, completedAt: 100 }),
      makeTask('2', { isCompleted: true, completedAt: 200 }),
      makeTask('3', { createdAt: 30 }),
    ];
    const visibleTasks = sortTasksForDisplay(tasks).filter((task) => task.isCompleted);

    const reordered = reorderTasksByDisplayOrder(tasks, '1', '2', visibleTasks, 'completedAt');

    expect(sortTasksForDisplay(reordered).map((task) => task.id)).toEqual(['3', '1', '2']);
  });

  it('does not reorder when the target task is outside the current visible group', () => {
    const tasks = [
      makeTask('1', { isPinned: true, order: 1 }),
      makeTask('2', { order: 2 }),
      makeTask('3', { isCompleted: true, completedAt: 100 }),
    ];
    const activeRegularTasks = sortTasksForDisplay(tasks).filter((task) => !task.isPinned && !task.isCompleted);

    const reordered = reorderTasksByDisplayOrder(tasks, '2', '3', activeRegularTasks, 'order');

    expect(sortTasksForDisplay(reordered).map((task) => task.id)).toEqual(['1', '2', '3']);
  });

  it('normalizes legacy tasks with missing pinned and reminder fields', () => {
    const legacyTasks = [
      { id: '1', content: 'Legacy', isCompleted: false, createdAt: 1 },
    ] as Task[];

    expect(normalizeTasks(legacyTasks)).toEqual([
      {
        id: '1',
        content: 'Legacy',
        isCompleted: false,
        isPinned: false,
        createdAt: 1,
      },
    ]);
  });

  it('computes reminder preset timestamps from a fixed clock', () => {
    const base = new Date('2026-06-06T10:00:00+08:00').getTime();

    expect(getReminderPresetTime('15m', base)).toBe(base + 15 * 60 * 1000);
    expect(getReminderPresetTime('30m', base)).toBe(base + 30 * 60 * 1000);
    expect(getReminderPresetTime('1h', base)).toBe(base + 60 * 60 * 1000);
  });

  it('accepts future custom reminder dates and rejects past or invalid date-times', () => {
    const base = new Date('2026-06-06T10:00:00+08:00').getTime();

    expect(getCustomReminderTime('2026-06-06', 18, 0, base)).toBe(new Date('2026-06-06T18:00:00+08:00').getTime());
    expect(getCustomReminderTime('2026-06-07', 9, 0, base)).toBe(new Date('2026-06-07T09:00:00+08:00').getTime());
    expect(getCustomReminderTime('2026-06-06', 9, 0, base)).toBeNull();
    expect(getCustomReminderTime('2026-06-06', 24, 0, base)).toBeNull();
    expect(getCustomReminderTime('2026-02-30', 10, 0, base)).toBeNull();
    expect(getCustomReminderTime('not-a-date', 10, 0, base)).toBeNull();
  });

  it('starts the custom reminder picker from the current time', () => {
    const base = new Date('2026-06-07T17:40:00+08:00').getTime();
    const parts = getInitialCustomReminderParts(base);

    expect(parts).toEqual({ date: '2026-06-07', hour: 17, minute: 40 });

    const currentHourOptions = buildCustomReminderPickerOptions(base, parts.date, parts.hour);
    expect(currentHourOptions.hourOptions[0]).toBe(17);
    expect(currentHourOptions.minuteOptions[0]).toBe(40);

    const laterHourOptions = buildCustomReminderPickerOptions(base, parts.date, 18);
    expect(laterHourOptions.minuteOptions[0]).toBe(0);

    const nextDayOptions = buildCustomReminderPickerOptions(base, '2026-06-08', 0);
    expect(nextDayOptions.hourOptions[0]).toBe(0);
    expect(nextDayOptions.minuteOptions[0]).toBe(0);
  });
});
