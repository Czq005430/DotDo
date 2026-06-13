import { Task } from '../types';
import { normalizeTasks } from '../taskRules';

const STORAGE_KEY = 'dotdo_task_data';
const LEGACY_STORAGE_KEY = 'zen_task_data';

export const loadTasks = (): Task[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    return data ? normalizeTasks(JSON.parse(data)) : [];
  } catch (error) {
    console.error("Failed to load tasks", error);
    return [];
  }
};

export const saveTasks = (tasks: Task[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (error) {
    console.error("Failed to save tasks", error);
  }
};
