import { Task } from './types';

export const MAX_PINNED_TASKS = 3;

export type PinToggleResult = {
  tasks: Task[];
  didChange: boolean;
  reason?: 'max-pinned' | 'not-found';
};

export type ReminderPreset = '15m' | '30m' | '1h';

export type CustomReminderPickerParts = {
  date: string;
  hour: number;
  minute: number;
};

export type CustomReminderPickerOptions = {
  dateOptions: Array<{ value: string; label: string }>;
  hourOptions: number[];
  minuteOptions: number[];
};

const REMINDER_MINUTE_STEP = 5;

type SortTasksOptions = {
  deferredCompletedTaskIds?: ReadonlySet<string>;
};

export const normalizeTasks = (tasks: Task[]): Task[] =>
  tasks.map((task) => ({
    ...task,
    isPinned: Boolean(task.isPinned),
    order: typeof task.order === 'number' ? task.order : undefined,
    completedAt: typeof task.completedAt === 'number' ? task.completedAt : undefined,
    reminderAt: typeof task.reminderAt === 'number' ? task.reminderAt : undefined,
    remindedAt: typeof task.remindedAt === 'number' ? task.remindedAt : undefined,
  }));

const getDisplayOrder = (task: Task): number => task.order ?? task.createdAt;

export const sortTasksForDisplay = (tasks: Task[], options: SortTasksOptions = {}): Task[] =>
  [...tasks].sort((a, b) => {
    const aIsCompleted = a.isCompleted && !options.deferredCompletedTaskIds?.has(a.id);
    const bIsCompleted = b.isCompleted && !options.deferredCompletedTaskIds?.has(b.id);

    if (aIsCompleted !== bIsCompleted) {
      return aIsCompleted ? 1 : -1;
    }

    if (aIsCompleted && bIsCompleted) {
      return (b.completedAt ?? 0) - (a.completedAt ?? 0);
    }

    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }

    return getDisplayOrder(a) - getDisplayOrder(b);
  });

export const reorderTasksByDisplayOrder = (
  tasks: Task[],
  draggedTaskId: string,
  targetTaskId: string,
  visibleTasks: Task[],
  strategy: 'order' | 'completedAt'
): Task[] => {
  const draggedIndex = visibleTasks.findIndex((task) => task.id === draggedTaskId);
  const targetIndex = visibleTasks.findIndex((task) => task.id === targetTaskId);

  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return tasks;
  }

  const draggedTask = visibleTasks[draggedIndex];
  const targetTask = visibleTasks[targetIndex];

  if (strategy === 'completedAt') {
    return tasks.map((task) => {
      if (task.id === draggedTask.id) {
        return { ...task, completedAt: targetTask.completedAt };
      }
      if (task.id === targetTask.id) {
        return { ...task, completedAt: draggedTask.completedAt };
      }
      return task;
    });
  }

  const draggedOrder = getDisplayOrder(draggedTask);
  const targetOrder = getDisplayOrder(targetTask);

  return tasks.map((task) =>
    task.id === draggedTask.id
      ? { ...task, order: targetOrder }
      : task.id === targetTask.id
        ? { ...task, order: draggedOrder }
        : task
  );
};

export const togglePinnedTask = (tasks: Task[], taskId: string): PinToggleResult => {
  const target = tasks.find((task) => task.id === taskId);
  if (!target) {
    return { tasks, didChange: false, reason: 'not-found' };
  }

  if (!target.isPinned && tasks.filter((task) => task.isPinned && !task.isCompleted).length >= MAX_PINNED_TASKS) {
    return { tasks, didChange: false, reason: 'max-pinned' };
  }

  return {
    tasks: tasks.map((task) =>
      task.id === taskId ? { ...task, isPinned: !task.isPinned } : task
    ),
    didChange: true,
  };
};

export const getReminderPresetTime = (preset: ReminderPreset, now = Date.now()): number => {
  if (preset === '15m') {
    return now + 15 * 60 * 1000;
  }

  if (preset === '30m') {
    return now + 30 * 60 * 1000;
  }

  if (preset === '1h') {
    return now + 60 * 60 * 1000;
  }

  return now;
};

export const getTodayReminderTime = (time: string, now = Date.now()): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  const base = new Date(now);
  const reminder = new Date(base);
  reminder.setHours(hours, minutes, 0, 0);

  if (reminder.getTime() <= now) {
    return null;
  }

  return reminder.getTime();
};

export const getCustomReminderTime = (
  date: string,
  hours: number,
  minutes: number,
  now = Date.now()
): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const reminder = new Date(year, month - 1, day, hours, minutes, 0, 0);

  if (
    reminder.getFullYear() !== year ||
    reminder.getMonth() !== month - 1 ||
    reminder.getDate() !== day ||
    reminder.getTime() <= now
  ) {
    return null;
  }

  return reminder.getTime();
};

export const formatDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const roundMinuteUpToStep = (date: Date): Date => {
  const rounded = new Date(date);
  const currentMinute = rounded.getMinutes() + (rounded.getSeconds() > 0 || rounded.getMilliseconds() > 0 ? 1 : 0);
  const nextMinute = Math.ceil(currentMinute / REMINDER_MINUTE_STEP) * REMINDER_MINUTE_STEP;
  rounded.setMinutes(nextMinute, 0, 0);
  return rounded;
};

export const getInitialCustomReminderParts = (now = Date.now()): CustomReminderPickerParts => {
  const date = roundMinuteUpToStep(new Date(now));

  return {
    date: formatDateKey(date),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
};

export const buildCustomReminderPickerOptions = (
  now = Date.now(),
  selectedDate: string,
  selectedHour: number
): CustomReminderPickerOptions => {
  const initial = getInitialCustomReminderParts(now);
  const [startYear, startMonth, startDay] = initial.date.split('-').map(Number);
  const startDate = new Date(startYear, startMonth - 1, startDay);
  const dateOptions = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);

    return {
      value: formatDateKey(date),
      label: index === 0 ? '今天' : `${date.getMonth() + 1}月${date.getDate()}日`,
    };
  });

  const isInitialDate = selectedDate === initial.date;
  const startHour = isInitialDate ? initial.hour : 0;
  const hourOptions = Array.from({ length: 24 - startHour }, (_, index) => startHour + index);
  const startMinute = isInitialDate && selectedHour === initial.hour ? initial.minute : 0;
  const minuteOptions = Array.from(
    { length: Math.ceil((60 - startMinute) / REMINDER_MINUTE_STEP) },
    (_, index) => startMinute + index * REMINDER_MINUTE_STEP
  ).filter((minute) => minute < 60);

  return { dateOptions, hourOptions, minuteOptions };
};

export const formatReminderLabel = (timestamp: number, now = Date.now()): string => {
  const reminder = new Date(timestamp);
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const time = reminder.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  if (reminder.toDateString() === today.toDateString()) {
    return `今天 ${time}`;
  }

  if (reminder.toDateString() === tomorrow.toDateString()) {
    return `明天 ${time}`;
  }

  return reminder.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};
