import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Check, ListRestart, Maximize2, Minus, Minimize2, Plus, RefreshCw, Save, X } from 'lucide-react';
import { Task, AppMode } from '../types';
import { TaskItem } from './TaskItem';
import { loadTasks, saveTasks } from '../services/storage';
import { reorderTasksByDisplayOrder, sortTasksForDisplay, togglePinnedTask } from '../taskRules';

type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CollapseIpcResponse = {
  ok: boolean;
  collapsed: boolean;
};

type BoundsIpcResponse = {
  ok: boolean;
  bounds?: WindowBounds;
};

type MaximizeIpcResponse = {
  ok: boolean;
  maximized: boolean;
};

type IpcRendererLike = {
  invoke(channel: 'window:set-collapsed', payload: { collapsed: boolean }): Promise<CollapseIpcResponse>;
  invoke(channel: 'window:get-bounds'): Promise<BoundsIpcResponse>;
  invoke(channel: 'window:set-position', payload: { x: number; y: number }): Promise<BoundsIpcResponse>;
  invoke(channel: 'window:toggle-maximized'): Promise<MaximizeIpcResponse>;
};

type ElectronRendererWindow = Window & {
  require?: (module: 'electron') => {
    ipcRenderer?: IpcRendererLike;
  };
};

type DotDragState = {
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  startWindowX: number;
  startWindowY: number;
  didMove: boolean;
  ipcRenderer: IpcRendererLike | null;
};

type TaskDragState = {
  pointerId: number;
  taskId: string;
  startClientX: number;
  startClientY: number;
  didMove: boolean;
  sourceElement: HTMLDivElement;
};

export const Widget: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [mode, setMode] = useState<AppMode>('input');
  const [inputValue, setInputValue] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [completionFeedbackTaskId, setCompletionFeedbackTaskId] = useState<string | null>(null);
  const [deferredCompletedTaskIds, setDeferredCompletedTaskIds] = useState<Set<string>>(() => new Set());
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const lastSwapTargetIdRef = useRef<string | null>(null);
  const dotDragRef = useRef<DotDragState | null>(null);
  const taskDragRef = useRef<TaskDragState | null>(null);
  const taskDragCleanupRef = useRef<(() => void) | null>(null);
  const taskNodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingLayoutRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const suppressRestoreClickUntilRef = useRef(0);
  const suppressTaskClickUntilRef = useRef(0);
  const tasksRef = useRef<Task[]>([]);
  const deferredCompletedTaskIdsRef = useRef<Set<string>>(new Set());

  tasksRef.current = tasks;
  deferredCompletedTaskIdsRef.current = deferredCompletedTaskIds;

  // Initialize
  useEffect(() => {
    const stored = loadTasks();
    setTasks(stored);
    
    // Auto-detect mode
    const hasActiveTasks = stored.some(t => !t.isCompleted);
    if (hasActiveTasks || stored.length > 0) {
      setMode('list');
    } else {
      setMode('input');
    }
    
    setIsLoaded(true);
  }, []);

  // Persistence
  useEffect(() => {
    if (isLoaded) {
      saveTasks(tasks);
    }
  }, [tasks, isLoaded]);

  useEffect(() => {
    return () => {
      taskDragCleanupRef.current?.();
    };
  }, []);

  useLayoutEffect(() => {
    const previousRects = pendingLayoutRectsRef.current;
    if (!previousRects) {
      return;
    }

    pendingLayoutRectsRef.current = null;
    Object.entries(taskNodeRefs.current).forEach(([id, node]) => {
      const previousRect = previousRects.get(id);
      if (!node || !previousRect) {
        return;
      }

      const nextRect = node.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        return;
      }

      node.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: 'translate(0, 0)' },
        ],
        {
          duration: 220,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        }
      );
    });
  });

  useEffect(() => {
    if (!statusMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => setStatusMessage(''), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [statusMessage]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    const showTaskReminder = async (task: Task) => {
      if (!('Notification' in window)) {
        setStatusMessage(`提醒：${task.content}`);
        return;
      }

      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }

      if (Notification.permission === 'granted') {
        new Notification('DotDo', {
          body: task.content,
          silent: false,
        });
      } else {
        setStatusMessage(`提醒：${task.content}`);
      }
    };

    const checkReminders = () => {
      const now = Date.now();
      const dueTasks = tasks.filter((task) =>
        task.reminderAt &&
        !task.remindedAt &&
        task.reminderAt <= now
      );

      if (dueTasks.length === 0) {
        return;
      }

      dueTasks.forEach((task) => {
        if (!task.isCompleted) {
          void showTaskReminder(task);
        }
      });

      setTasks((prev) =>
        prev.map((task) =>
          dueTasks.some((dueTask) => dueTask.id === task.id)
            ? { ...task, remindedAt: now }
            : task
        )
      );
    };

    checkReminders();
    const intervalId = window.setInterval(checkReminders, 15_000);
    return () => window.clearInterval(intervalId);
  }, [tasks, isLoaded]);

  // Handlers
  const handleBulkSubmit = () => {
    if (!inputValue.trim()) return;

    const lines = inputValue.split('\n').filter(line => line.trim() !== '');
    const baseOrder = tasks.reduce((maxOrder, task) => Math.max(maxOrder, task.order ?? task.createdAt), 0);
    const newTasks: Task[] = lines.map((line, index) => ({
      id: crypto.randomUUID(),
      content: line.trim(),
      isCompleted: false,
      isPinned: false,
      createdAt: Date.now() + index,
      order: baseOrder + index + 1,
    }));

    setTasks(prev => [...prev, ...newTasks]);
    setInputValue('');
    setMode('list');
  };

  const handleKeyDownInput = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      handleBulkSubmit();
    }
  };

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== id) {
        return t;
      }

      const nextCompleted = !t.isCompleted;
      const completedAt = Date.now();
      if (nextCompleted) {
        setCompletionFeedbackTaskId(id);
        setDeferredCompletedTaskIds(current => new Set(current).add(id));
        window.setTimeout(() => {
          setCompletionFeedbackTaskId(current => current === id ? null : current);
        }, 950);
        window.setTimeout(() => {
          pendingLayoutRectsRef.current = new Map(
            Object.entries(taskNodeRefs.current)
              .filter(([, node]) => Boolean(node))
              .map(([taskId, node]) => [taskId, node!.getBoundingClientRect()])
          );
          setDeferredCompletedTaskIds(current => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }, 1000);
      } else {
        setDeferredCompletedTaskIds(current => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }

      return {
        ...t,
        isCompleted: nextCompleted,
        completedAt: nextCompleted ? completedAt : undefined,
      };
    }));
  };

  const updateTask = (id: string, newContent: string) => {
    setTasks(prev => prev.map(t => 
      t.id === id ? { ...t, content: newContent } : t
    ));
  };

  const deleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const addNewTask = () => {
    const nextOrder = tasks.reduce((maxOrder, task) => Math.max(maxOrder, task.order ?? task.createdAt), 0) + 1;
    const newTask: Task = {
      id: crypto.randomUUID(),
      content: "New task",
      isCompleted: false,
      isPinned: false,
      createdAt: Date.now(),
      order: nextOrder,
    };
    setTasks(prev => [...prev, newTask]);
  };

  const resetDay = () => {
      setTasks([]);
      setMode('input');
  };

  const clearCompletedTasks = () => {
    const remainingTasks = tasks.filter(task => !task.isCompleted);
    if (remainingTasks.length === tasks.length) {
      setStatusMessage('暂无已完成任务');
      return;
    }

    setCompletionFeedbackTaskId(null);
    setDeferredCompletedTaskIds(new Set());
    setTasks(remainingTasks);
    setMode('list');
  };

  const handleTogglePin = (id: string) => {
    setTasks(prev => {
      const result = togglePinnedTask(prev, id);
      if (result.reason === 'max-pinned') {
        setStatusMessage('最多 3 件重点任务');
      }
      return result.tasks;
    });
  };

  const setTaskReminder = (id: string, reminderAt: number) => {
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, reminderAt, remindedAt: undefined } : t
    ));
    setStatusMessage('提醒已设置');
  };

  const clearTaskReminder = (id: string) => {
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, reminderAt: undefined, remindedAt: undefined } : t
    ));
    setStatusMessage('提醒已清除');
  };

  const getDragGroup = (
    sortedTasks: Task[],
    taskId: string,
    deferredTaskIds: ReadonlySet<string> = deferredCompletedTaskIdsRef.current
  ) => {
    const topTasks = sortedTasks
      .filter(task => task.isPinned && (!task.isCompleted || deferredTaskIds.has(task.id)))
      .slice(0, 3);
    if (topTasks.some(task => task.id === taskId)) {
      return { key: 'top', tasks: topTasks, strategy: 'order' as const };
    }

    const activeRegularTasks = sortedTasks.filter(
      (task) => !topTasks.some((topTask) => topTask.id === task.id) && (!task.isCompleted || deferredTaskIds.has(task.id))
    );
    if (activeRegularTasks.some(task => task.id === taskId)) {
      return { key: 'active', tasks: activeRegularTasks, strategy: 'order' as const };
    }

    const completedTasks = sortedTasks.filter(
      (task) => task.isCompleted && !deferredTaskIds.has(task.id)
    );
    if (completedTasks.some(task => task.id === taskId)) {
      return { key: 'completed', tasks: completedTasks, strategy: 'completedAt' as const };
    }

    return null;
  };

  const prepareTaskSwap = (sourceTaskId: string, targetTaskId: string): boolean => {
    const deferredTaskIds = deferredCompletedTaskIdsRef.current;
    const currentSortedTasks = sortTasksForDisplay(tasksRef.current, { deferredCompletedTaskIds: deferredTaskIds });
    const sourceGroup = getDragGroup(currentSortedTasks, sourceTaskId, deferredTaskIds);
    const targetGroup = getDragGroup(currentSortedTasks, targetTaskId, deferredTaskIds);

    if (!sourceGroup || !targetGroup || sourceGroup.key !== targetGroup.key) {
      return false;
    }

    pendingLayoutRectsRef.current = new Map(
      Object.entries(taskNodeRefs.current)
        .filter(([, node]) => Boolean(node))
        .map(([taskId, node]) => [taskId, node!.getBoundingClientRect()])
    );

    setTasks(prev => {
      const deferredTaskIds = deferredCompletedTaskIdsRef.current;
      const currentSortedTasks = sortTasksForDisplay(prev, { deferredCompletedTaskIds: deferredTaskIds });
      const sourceGroup = getDragGroup(currentSortedTasks, sourceTaskId, deferredTaskIds);
      const targetGroup = getDragGroup(currentSortedTasks, targetTaskId, deferredTaskIds);

      if (!sourceGroup || !targetGroup || sourceGroup.key !== targetGroup.key) {
        pendingLayoutRectsRef.current = null;
        return prev;
      }

      return reorderTasksByDisplayOrder(
        prev,
        sourceTaskId,
        targetTaskId,
        sourceGroup.tasks,
        sourceGroup.strategy
      );
    });

    return true;
  };

  const clearTaskDragListeners = () => {
    taskDragCleanupRef.current?.();
    taskDragCleanupRef.current = null;
  };

  const finishTaskDrag = (pointerId?: number) => {
    const dragState = taskDragRef.current;
    if (dragState && (pointerId === undefined || dragState.pointerId === pointerId)) {
      if (dragState.didMove) {
        suppressTaskClickUntilRef.current = Date.now() + 220;
      }
      try {
        if (dragState.sourceElement.hasPointerCapture(dragState.pointerId)) {
          dragState.sourceElement.releasePointerCapture(dragState.pointerId);
        }
      } catch {
        // The task node can be replaced during reordering; cleanup should stay idempotent.
      }
    }

    clearTaskDragListeners();
    taskDragRef.current = null;
    setDraggedTaskId(null);
    setDragOverTaskId(null);
    lastSwapTargetIdRef.current = null;
  };

  const moveTaskDrag = (
    pointerId: number,
    clientX: number,
    clientY: number,
    preventDefault: () => void
  ) => {
    const dragState = taskDragRef.current;
    if (!dragState || dragState.pointerId !== pointerId) {
      return;
    }

    const deltaX = clientX - dragState.startClientX;
    const deltaY = clientY - dragState.startClientY;
    if (!dragState.didMove && Math.hypot(deltaX, deltaY) < 6) {
      return;
    }

    preventDefault();
    dragState.didMove = true;
    setDraggedTaskId(dragState.taskId);

    const hoveredTaskElement = document
      .elementsFromPoint(clientX, clientY)
      .map((element) => element.closest<HTMLElement>('[data-task-id]'))
      .find((element): element is HTMLElement => Boolean(element));
    const targetTaskId = hoveredTaskElement?.dataset.taskId;

    if (!targetTaskId || targetTaskId === dragState.taskId) {
      setDragOverTaskId(null);
      lastSwapTargetIdRef.current = null;
      return;
    }

    if (lastSwapTargetIdRef.current === targetTaskId) {
      return;
    }

    const didSwap = prepareTaskSwap(dragState.taskId, targetTaskId);
    if (!didSwap) {
      setDragOverTaskId(null);
      lastSwapTargetIdRef.current = targetTaskId;
      return;
    }

    setDragOverTaskId(targetTaskId);
    lastSwapTargetIdRef.current = targetTaskId;
  };

  const handleTaskPointerDown = (e: React.PointerEvent<HTMLDivElement>, taskId: string) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input') || (e.pointerType === 'mouse' && e.button !== 0)) {
      return;
    }

    taskDragRef.current = {
      pointerId: e.pointerId,
      taskId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      didMove: false,
      sourceElement: e.currentTarget,
    };
    lastSwapTargetIdRef.current = null;
    clearTaskDragListeners();

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.buttons === 0) {
        finishTaskDrag(event.pointerId);
        return;
      }
      moveTaskDrag(event.pointerId, event.clientX, event.clientY, () => event.preventDefault());
    };
    const handleWindowPointerUp = (event: PointerEvent) => finishTaskDrag(event.pointerId);
    const handleWindowPointerCancel = (event: PointerEvent) => finishTaskDrag(event.pointerId);
    const handleWindowMouseUp = () => finishTaskDrag();
    const handleWindowBlur = () => finishTaskDrag();
    const moveListenerOptions: AddEventListenerOptions = { capture: true, passive: false };
    const listenerOptions: AddEventListenerOptions = { capture: true };

    window.addEventListener('pointermove', handleWindowPointerMove, moveListenerOptions);
    window.addEventListener('pointerup', handleWindowPointerUp, listenerOptions);
    window.addEventListener('pointercancel', handleWindowPointerCancel, listenerOptions);
    document.addEventListener('pointerup', handleWindowPointerUp, listenerOptions);
    document.addEventListener('pointercancel', handleWindowPointerCancel, listenerOptions);
    window.addEventListener('mouseup', handleWindowMouseUp, listenerOptions);
    document.addEventListener('mouseup', handleWindowMouseUp, listenerOptions);
    window.addEventListener('blur', handleWindowBlur);

    taskDragCleanupRef.current = () => {
      window.removeEventListener('pointermove', handleWindowPointerMove, moveListenerOptions);
      window.removeEventListener('pointerup', handleWindowPointerUp, listenerOptions);
      window.removeEventListener('pointercancel', handleWindowPointerCancel, listenerOptions);
      document.removeEventListener('pointerup', handleWindowPointerUp, listenerOptions);
      document.removeEventListener('pointercancel', handleWindowPointerCancel, listenerOptions);
      window.removeEventListener('mouseup', handleWindowMouseUp, listenerOptions);
      document.removeEventListener('mouseup', handleWindowMouseUp, listenerOptions);
      window.removeEventListener('blur', handleWindowBlur);
    };
  };

  // Close handler for Electron
  const handleClose = () => {
    // In Electron, window.close() usually works if nodeIntegration is enabled,
    // otherwise we rely on ipcRenderer. For this template, standard close works 
    // because we didn't block it.
    window.close();
  };

  const getIpcRenderer = (): IpcRendererLike | null => {
    const electronRequire = (window as ElectronRendererWindow).require;
    if (typeof electronRequire !== 'function') {
      return null;
    }

    try {
      const electronModule = electronRequire('electron');
      return electronModule.ipcRenderer ?? null;
    } catch (error) {
      console.warn('Electron ipcRenderer is unavailable.', error);
      return null;
    }
  };

  const setCollapsedWindowState = async (collapsed: boolean) => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
      console.warn('window:set-collapsed skipped: ipcRenderer unavailable.');
      setIsCollapsed(collapsed);
      return;
    }

    try {
      const response = await ipcRenderer.invoke('window:set-collapsed', { collapsed });
      if (!response?.ok) {
        console.warn('window:set-collapsed returned a failure response.');
        return;
      }
      setIsCollapsed(response.collapsed);
    } catch (error) {
      console.warn('window:set-collapsed failed.', error);
    }
  };

  const handleCollapse = () => {
    void setCollapsedWindowState(true);
  };

  const handleRestore = () => {
    void setCollapsedWindowState(false);
  };

  const handleToggleMaximized = async () => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
      console.warn('window:toggle-maximized skipped: ipcRenderer unavailable.');
      return;
    }

    try {
      const response = await ipcRenderer.invoke('window:toggle-maximized');
      if (!response?.ok) {
        console.warn('window:toggle-maximized returned a failure response.');
      }
    } catch (error) {
      console.warn('window:toggle-maximized failed.', error);
    }
  };

  const handleDotPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const ipcRenderer = getIpcRenderer();
    dotDragRef.current = {
      pointerId: e.pointerId,
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      startWindowX: window.screenX,
      startWindowY: window.screenY,
      didMove: false,
      ipcRenderer,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some environments may not support pointer capture for tiny transparent windows.
    }
  };

  const handleDotPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dotDragRef.current;
    if (!dragState || dragState.pointerId !== e.pointerId) {
      return;
    }

    const deltaX = e.screenX - dragState.startScreenX;
    const deltaY = e.screenY - dragState.startScreenY;

    if (!dragState.didMove && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
      dragState.didMove = true;
    }

    if (!dragState.didMove) {
      return;
    }

    if (!dragState.ipcRenderer) {
      return;
    }

    void dragState.ipcRenderer.invoke('window:set-position', {
      x: dragState.startWindowX + deltaX,
      y: dragState.startWindowY + deltaY,
    });
  };

  const clearDotDragState = (markAsDragged: boolean) => {
    const dragState = dotDragRef.current;
    if (dragState && (dragState.didMove || markAsDragged)) {
      suppressRestoreClickUntilRef.current = Date.now() + 220;
    }
    dotDragRef.current = null;
  };

  const handleDotPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dotDragRef.current;
    if (!dragState || dragState.pointerId !== e.pointerId) {
      return;
    }

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    clearDotDragState(false);
  };

  const handleDotPointerCancel = () => {
    clearDotDragState(true);
  };

  const handleDotClick = () => {
    if (Date.now() < suppressRestoreClickUntilRef.current) {
      return;
    }
    handleRestore();
  };

  if (!isLoaded) return null;

  const completedTaskCount = tasks.filter((task) => task.isCompleted).length;
  const totalTaskCount = tasks.length;

  if (isCollapsed) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-transparent">
        <button
          onPointerDown={handleDotPointerDown}
          onPointerMove={handleDotPointerMove}
          onPointerUp={handleDotPointerUp}
          onPointerCancel={handleDotPointerCancel}
          onLostPointerCapture={handleDotPointerCancel}
          onClick={handleDotClick}
          title="Restore widget"
          className="relative flex h-7 w-[76px] cursor-grab select-none items-center gap-1.5 overflow-hidden rounded-full border bg-white/20 px-1.5 text-gray-800 shadow-none outline-none backdrop-blur-2xl transition-transform active:scale-[0.98] active:cursor-grabbing focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
          aria-label="Restore widget"
          style={{
            borderColor: 'rgba(60,60,67,0.18)',
            background:
              'linear-gradient(145deg, rgba(255,255,255,0.52) 0%, rgba(232,233,237,0.34) 52%, rgba(134,133,144,0.22) 100%)',
            boxShadow:
              'inset 0 1px 1px rgba(255,255,255,0.72), inset 0 -1px 1px rgba(60,60,67,0.16)',
          }}
        >
          <span className="pointer-events-none absolute inset-x-1.5 top-[2px] h-2 rounded-full bg-white/35 blur-[1px]" />
          <span className="pointer-events-none absolute -left-5 top-0 h-8 w-12 rotate-[-22deg] bg-white/15 blur-md" />
          <span
            className="pointer-events-none relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-white/55 bg-white/45 shadow-none backdrop-blur-xl"
            style={{
              boxShadow:
                'inset 0 1px 1px rgba(255,255,255,0.76), inset 0 -1px 1px rgba(15,23,42,0.06)',
            }}
          >
            <Check size={12} strokeWidth={4.1} className="text-green-500" />
          </span>
          <span className="pointer-events-none relative min-w-0 flex-1 text-center text-[15px] font-semibold leading-none tracking-normal text-[#2f3740] tabular-nums">
            {completedTaskCount}/{totalTaskCount}
          </span>
        </button>
      </div>
    );
  }

  const sortedTasks = sortTasksForDisplay(tasks, { deferredCompletedTaskIds });
  const topTasks = sortedTasks.filter(task => task.isPinned && (!task.isCompleted || deferredCompletedTaskIds.has(task.id))).slice(0, 3);
  const topTaskIds = new Set(topTasks.map(task => task.id));
  const regularTasks = sortedTasks.filter(task => !topTaskIds.has(task.id));
  const canClearCompleted = tasks.some(task => task.isCompleted);
  const renderTaskItem = (task: Task) => (
    <div
      key={task.id}
      data-task-id={task.id}
      onPointerDown={(e) => handleTaskPointerDown(e, task.id)}
      onLostPointerCapture={(e) => finishTaskDrag(e.pointerId)}
      onClickCapture={(e) => {
        if (Date.now() < suppressTaskClickUntilRef.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      ref={(node) => {
        taskNodeRefs.current[task.id] = node;
      }}
      className={`relative rounded-xl touch-none select-none transition-[background,box-shadow,opacity,transform] duration-150 ${
        draggedTaskId === task.id ? 'pointer-events-none z-30 scale-[1.015] bg-white/90 opacity-95 shadow-[0_12px_30px_rgba(15,23,42,0.16)]' : ''
      } ${
        dragOverTaskId === task.id ? 'bg-white/75 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.10)]' : ''
      } cursor-grab active:cursor-grabbing`}
    >
      <TaskItem
        task={task}
        onToggle={toggleTask}
        onUpdate={updateTask}
        onDelete={deleteTask}
        onTogglePin={handleTogglePin}
        onSetReminder={setTaskReminder}
        onClearReminder={clearTaskReminder}
        onInvalidReminder={setStatusMessage}
        showCompletionFeedback={completionFeedbackTaskId === task.id}
      />
    </div>
  );

  return (
    // CHANGE HERE: Modified bg-white/80 to bg-slate-50/95 for a more solid, slightly off-white look
    // You can change 'bg-slate-50/95' to 'bg-white' or 'bg-gray-900' (for dark mode)
    <div className="w-full h-full flex flex-col bg-slate-50/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/50 overflow-hidden animate-slide-up transition-all duration-500">
      
      {/* Header / Draggable Area */}
      {/* The style WebkitAppRegion: 'drag' is CRITICAL for Electron frameless windows */}
      <div 
        className="h-10 flex items-center justify-between px-4 bg-white/40 border-b border-black/5 select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="group/window-controls flex space-x-2 no-drag" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
           <button 
             onClick={handleClose}
             title="关闭"
             className="flex h-3 w-3 items-center justify-center rounded-full border border-black/10 bg-[#ff5f57] text-black/55 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.25)] transition-colors hover:bg-[#ff5f57] cursor-default" 
           >
             <X size={7.5} strokeWidth={3} className="opacity-0 transition-opacity group-hover/window-controls:opacity-100" />
           </button>
           <button
             onClick={handleCollapse}
             title="收起为小图标"
             className="flex h-3 w-3 items-center justify-center rounded-full border border-black/10 bg-[#ffbd2e] text-black/55 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.22)] transition-colors hover:bg-[#ffbd2e] cursor-default"
           >
             <Minus size={7.5} strokeWidth={3.2} className="opacity-0 transition-opacity group-hover/window-controls:opacity-100" />
           </button>
           <button
             onClick={handleToggleMaximized}
             title="放大窗口"
             className="flex h-3 w-3 items-center justify-center rounded-full border border-black/10 bg-[#28c840] text-black/55 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.22)] transition-colors hover:bg-[#28c840] cursor-default"
           >
             <Maximize2 size={6.8} strokeWidth={3.2} className="opacity-0 transition-opacity group-hover/window-controls:opacity-100" />
           </button>
        </div>
        <div className="text-xs font-semibold text-gray-500 tracking-wide opacity-50">
           DotDo
        </div>
        <button
          onClick={handleCollapse}
          title="Collapse to floating dot"
          className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-black/5 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Minimize2 size={16} />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-4 overflow-hidden relative">
        {statusMessage && (
          <div className="absolute right-4 top-3 z-30 rounded-full bg-gray-900/85 px-3 py-1 text-xs font-medium text-white shadow-lg animate-fade-in">
            {statusMessage}
          </div>
        )}
        
        {mode === 'input' ? (
          <div className="flex-1 flex flex-col animate-fade-in h-full">
            <h2 className="text-xl font-bold text-gray-800 mb-2">What's your focus today?</h2>
            <p className="text-sm text-gray-500 mb-4">Enter your tasks below. One per line.</p>
            
            <textarea
              className="flex-1 w-full bg-transparent resize-none outline-none text-lg text-gray-700 placeholder-gray-400/70 font-medium leading-relaxed"
              placeholder="- Design new landing page&#10;- Call mom&#10;- Review PRs"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDownInput}
              autoFocus
            />
            
            <button 
              onClick={handleBulkSubmit}
              disabled={!inputValue.trim()}
              className="mt-4 w-full py-3 bg-gray-900 hover:bg-black text-white rounded-xl font-semibold transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              Start My Day <Save size={16} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col h-full animate-fade-in">
            {/* Task List */}
            <div className="flex-1 overflow-y-auto no-scrollbar -mx-2 px-2 pb-2">
              {tasks.length === 0 ? (
                 <div className="h-full flex flex-col items-center justify-center text-gray-400">
                    <p className="text-sm">All cleared. Enjoy your day!</p>
                    <button onClick={resetDay} className="mt-2 text-xs underline hover:text-gray-600">Start new list</button>
                 </div>
              ) : (
                <div className="space-y-3">
                  {topTasks.length > 0 && (
                    <section>
                      <div className="mb-1 flex items-center justify-between px-2">
                        <h3 className="text-[11px] font-bold uppercase tracking-wide text-amber-600/80">
                          Today&apos;s Top 3
                        </h3>
                        <span className="text-[11px] text-gray-400">{topTasks.length}/3</span>
                      </div>
                      <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-1">
                        {topTasks.map(renderTaskItem)}
                      </div>
                    </section>
                  )}

                  <section className="space-y-1">
                    {topTasks.length > 0 && regularTasks.length > 0 && (
                      <h3 className="px-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                        Other Tasks
                      </h3>
                    )}
                    {regularTasks.map(renderTaskItem)}
                  </section>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="mt-4 pt-4 border-t border-gray-200/50 flex items-center justify-between">
              <button 
                onClick={addNewTask}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100/50 transition-colors"
              >
                <Plus size={16} /> Add Task
              </button>
              
              <div className="flex items-center gap-1">
                <button 
                  onClick={clearCompletedTasks}
                  disabled={!canClearCompleted}
                  className="p-2 rounded-lg text-gray-400 transition-colors hover:text-gray-600 hover:bg-gray-100/50 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                  title="清除已完成任务"
                >
                  <RefreshCw size={16} />
                </button>
                <button 
                  onClick={resetDay}
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100/50 transition-colors"
                  title="新开一轮任务"
                >
                  <ListRestart size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
