export interface Task {
  id: string;
  content: string;
  isCompleted: boolean;
  isPinned: boolean;
  createdAt: number;
  order?: number;
  completedAt?: number;
  reminderAt?: number;
  remindedAt?: number;
}

export type AppMode = 'input' | 'list';
