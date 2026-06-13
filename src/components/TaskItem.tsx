import React, { useState, useRef, useEffect } from 'react';
import { Bell, Check, ChevronDown, Pin, X } from 'lucide-react';
import { Task } from '../types';
import {
  buildCustomReminderPickerOptions,
  formatReminderLabel,
  getCustomReminderTime,
  getInitialCustomReminderParts,
  getReminderPresetTime,
  ReminderPreset,
} from '../taskRules';

interface TaskItemProps {
  task: Task;
  onToggle: (id: string) => void;
  onUpdate: (id: string, newContent: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onSetReminder: (id: string, reminderAt: number) => void;
  onClearReminder: (id: string) => void;
  onInvalidReminder: (message: string) => void;
  showCompletionFeedback: boolean;
}

const reminderPresets: Array<{ label: string; preset: ReminderPreset }> = [
  { label: '15 分钟后', preset: '15m' },
  { label: '30 分钟后', preset: '30m' },
  { label: '1 小时后', preset: '1h' },
];

const formatPickerTitle = (dateKey: string): string => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()];
  return `${year}年${month}月${day}日${weekday}`;
};

type ReminderMenuView = 'presets' | 'custom';
type WheelColumnId = 'date' | 'hour' | 'minute';
type WheelOption<T extends string | number> = { value: T; label: string };

export const shouldCommitTaskEdit = (key: string, isComposing: boolean, keyCode?: number): boolean =>
  key === 'Enter' && !isComposing && keyCode !== 229;

const wheelOffsets = [-2, -1, 0, 1, 2] as const;
const wheelRowHeight = 38;
const wheelInputThreshold = 22;

const getNextWheelValue = <T extends string | number>(
  options: Array<WheelOption<T>>,
  currentValue: T,
  direction: number
): T => {
  const currentIndex = Math.max(0, options.findIndex((option) => option.value === currentValue));
  const nextIndex = Math.min(options.length - 1, Math.max(0, currentIndex + direction));
  return options[nextIndex]?.value ?? currentValue;
};

interface WheelColumnProps<T extends string | number> {
  columnId: WheelColumnId;
  options: Array<WheelOption<T>>;
  value: T;
  onChange: (value: T) => void;
  dragStartYRef: React.MutableRefObject<Record<WheelColumnId, number | null>>;
  wheelDeltaRef: React.MutableRefObject<Record<WheelColumnId, number>>;
  textClassName: string;
}

const WheelColumn = <T extends string | number>({
  columnId,
  options,
  value,
  onChange,
  dragStartYRef,
  wheelDeltaRef,
  textClassName,
}: WheelColumnProps<T>) => {
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const moveSelection = (direction: number) => {
    const nextValue = getNextWheelValue(options, value, direction);
    if (nextValue !== value) {
      onChange(nextValue);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextDelta = wheelDeltaRef.current[columnId] + event.deltaY;

    if (Math.abs(nextDelta) < wheelInputThreshold) {
      wheelDeltaRef.current[columnId] = nextDelta;
      return;
    }

    wheelDeltaRef.current[columnId] = 0;
    moveSelection(nextDelta > 0 ? 1 : -1);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragStartYRef.current[columnId] = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const startY = dragStartYRef.current[columnId];
    if (startY === null) {
      return;
    }

    const deltaY = event.clientY - startY;
    if (Math.abs(deltaY) < wheelInputThreshold) {
      return;
    }

    dragStartYRef.current[columnId] = event.clientY;
    moveSelection(deltaY > 0 ? -1 : 1);
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    dragStartYRef.current[columnId] = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className="relative h-36 touch-none select-none overflow-hidden"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {wheelOffsets.map((offset) => {
        const option = options[selectedIndex + offset];
        if (!option) {
          return null;
        }

        const isSelected = offset === 0;

        return (
          <button
            key={offset}
            type="button"
            onClick={() => onChange(option.value)}
            data-picker-selected={isSelected}
            className={`absolute left-0 top-1/2 z-10 flex h-9 w-full items-center justify-center rounded-md text-center leading-none transition-[color,opacity,transform] duration-150 ${textClassName} ${
              isSelected
                ? 'font-semibold text-gray-950 opacity-100'
                : 'font-medium text-gray-300 opacity-75 hover:opacity-100'
            }`}
            style={{
              transform: `translateY(calc(-50% + ${offset * wheelRowHeight}px)) scale(${isSelected ? 1 : 0.96})`,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

export const TaskItem: React.FC<TaskItemProps> = ({
  task,
  onToggle,
  onUpdate,
  onDelete,
  onTogglePin,
  onSetReminder,
  onClearReminder,
  onInvalidReminder,
  showCompletionFeedback,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.content);
  const [isReminderMenuOpen, setIsReminderMenuOpen] = useState(false);
  const [reminderMenuView, setReminderMenuView] = useState<ReminderMenuView>('presets');
  const [pickerNow, setPickerNow] = useState(() => Date.now());
  const [customReminderDate, setCustomReminderDate] = useState(() => getInitialCustomReminderParts().date);
  const [customReminderHour, setCustomReminderHour] = useState(() => getInitialCustomReminderParts().hour);
  const [customReminderMinute, setCustomReminderMinute] = useState(() => getInitialCustomReminderParts().minute);
  const [isNiceVisible, setIsNiceVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reminderMenuRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const dragStartYRef = useRef<Record<WheelColumnId, number | null>>({ date: null, hour: null, minute: null });
  const wheelDeltaRef = useRef<Record<WheelColumnId, number>>({ date: 0, hour: 0, minute: 0 });
  const pickerOptions = buildCustomReminderPickerOptions(pickerNow, customReminderDate, customReminderHour);
  const hourWheelOptions = pickerOptions.hourOptions.map((hour) => ({
    value: hour,
    label: String(hour).padStart(2, '0'),
  }));
  const minuteWheelOptions = pickerOptions.minuteOptions.map((minute) => ({
    value: minute,
    label: String(minute).padStart(2, '0'),
  }));

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!showCompletionFeedback) {
      return;
    }

    setIsNiceVisible(true);
    const timeoutId = window.setTimeout(() => setIsNiceVisible(false), 900);
    return () => window.clearTimeout(timeoutId);
  }, [showCompletionFeedback]);

  useEffect(() => {
    if (!pickerOptions.hourOptions.includes(customReminderHour)) {
      setCustomReminderHour(pickerOptions.hourOptions[0]);
    }
  }, [customReminderDate, customReminderHour, pickerOptions.hourOptions]);

  useEffect(() => {
    if (!pickerOptions.minuteOptions.includes(customReminderMinute)) {
      setCustomReminderMinute(pickerOptions.minuteOptions[0]);
    }
  }, [customReminderMinute, pickerOptions.minuteOptions]);

  const handleBlur = () => {
    setIsEditing(false);
    if (editValue.trim() === '') {
      onDelete(task.id);
    } else {
      onUpdate(task.id, editValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (shouldCommitTaskEdit(e.key, e.nativeEvent.isComposing || isComposingRef.current, e.nativeEvent.keyCode)) {
      handleBlur();
    }
  };

  const handleTaskClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isEditing) {
      return;
    }

    const target = e.target as HTMLElement;
    if (target.closest('button, input')) {
      return;
    }

    setIsEditing(true);
  };

  const handleReminderPreset = (preset: ReminderPreset) => {
    onSetReminder(task.id, getReminderPresetTime(preset));
    setIsReminderMenuOpen(false);
  };

  const toggleReminderMenu = () => {
    setIsReminderMenuOpen((isOpen) => {
      if (!isOpen) {
        setReminderMenuView('presets');
      }
      return !isOpen;
    });
  };

  const openCustomReminder = () => {
    const now = Date.now();
    const parts = getInitialCustomReminderParts(now);
    setPickerNow(now);
    setCustomReminderDate(parts.date);
    setCustomReminderHour(parts.hour);
    setCustomReminderMinute(parts.minute);
    setReminderMenuView('custom');
  };

  const handleCustomReminder = () => {
    const reminderAt = getCustomReminderTime(customReminderDate, customReminderHour, customReminderMinute);
    if (!reminderAt) {
      onInvalidReminder('请选择未来时间');
      return;
    }

    onSetReminder(task.id, reminderAt);
    setIsReminderMenuOpen(false);
  };

  return (
    <div
      onClick={handleTaskClick}
      className={`group relative flex items-start gap-3 py-2 px-2 rounded-lg transition-all duration-200 ${isEditing ? 'bg-white/10' : 'hover:bg-black/5'}`}
    >
      <button
        onClick={() => onToggle(task.id)}
        title={task.isCompleted ? 'Mark as active' : 'Mark as completed'}
        className={`flex-shrink-0 mt-0 w-5 h-5 rounded-full border-2 transition-all duration-300 ease-out flex items-center justify-center
          ${task.isCompleted 
            ? 'bg-green-500 border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)] scale-110' 
            : 'border-gray-400 hover:border-gray-500 bg-transparent'
          }`}
      >
        <Check 
          size={12} 
          className={`text-white transition-transform duration-300 ${task.isCompleted ? 'scale-100' : 'scale-0'}`} 
          strokeWidth={4}
        />
      </button>

      <div className="flex-grow min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            className="w-full bg-transparent border-none outline-none text-[14px] leading-snug text-gray-800 placeholder-gray-400 font-medium font-sans"
            placeholder="Empty task..."
          />
        ) : (
          <span
            className={`block cursor-text select-none text-[14px] leading-snug text-gray-800 font-medium font-sans transition-all duration-300 break-words
              ${task.isCompleted ? 'line-through text-gray-400' : ''}`}
          >
            {task.content}
          </span>
        )}
        {task.reminderAt && !task.remindedAt && (
          <div className="mt-1 text-[11px] text-gray-400">
            提醒：{formatReminderLabel(task.reminderAt)}
          </div>
        )}
      </div>

      {isNiceVisible && (
        <span className="absolute right-20 top-2 text-[11px] font-semibold text-green-600 animate-nice-pop pointer-events-none">
          Nice
        </span>
      )}

      <div className="relative flex flex-shrink-0 items-center gap-0.5">
        <button
          onClick={() => onTogglePin(task.id)}
          className={`p-1 rounded-md transition-colors ${
            task.isPinned
              ? 'text-amber-500 bg-amber-100/70 hover:bg-amber-100'
              : 'text-gray-300 hover:text-amber-500 hover:bg-gray-100/50'
          }`}
          title={task.isPinned ? '取消重点' : '设为重点'}
        >
          <Pin size={14} />
        </button>

        <button
          onClick={toggleReminderMenu}
          className={`p-1 rounded-md transition-colors ${
            task.reminderAt && !task.remindedAt
              ? 'text-blue-500 bg-blue-100/70 hover:bg-blue-100'
              : 'text-gray-300 hover:text-blue-500 hover:bg-gray-100/50'
          }`}
          title="稍后提醒"
        >
          <Bell size={14} />
        </button>

        {isReminderMenuOpen && (
          <div
            ref={reminderMenuRef}
            className="fixed right-4 top-12 z-50 w-80 max-w-[calc(100vw-32px)] rounded-[24px] border border-gray-200/70 bg-white/95 p-3 text-xs shadow-[0_20px_50px_rgba(15,23,42,0.16)] backdrop-blur-xl"
          >
            {reminderMenuView === 'presets' ? (
              <div className="space-y-1">
                {reminderPresets.map(({ label, preset }) => {
                  return (
                    <button
                      key={preset}
                      onClick={() => handleReminderPreset(preset)}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-gray-600 hover:bg-gray-100"
                    >
                      {label}
                    </button>
                  );
                })}
                <button
                  onClick={openCustomReminder}
                  className="block w-full rounded-md border-t border-gray-100 px-2 py-2 text-left font-medium text-gray-700 hover:bg-gray-100"
                >
                  自定义时间
                </button>
              </div>
            ) : (
            <div>
              <div className="mb-2 flex items-center justify-center gap-1 text-[12px] font-semibold text-gray-950">
                {formatPickerTitle(customReminderDate)}
                <ChevronDown size={13} className="text-gray-500" />
              </div>

              <div className="relative grid grid-cols-[1.35fr_0.8fr_0.8fr] gap-1 overflow-hidden rounded-[18px] bg-white px-1 py-1">
                <div data-picker-highlight="true" className="pointer-events-none absolute inset-x-1 top-1/2 h-9 -translate-y-1/2 rounded-xl bg-gray-100/95" />
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-14 bg-gradient-to-b from-white via-white/85 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-14 bg-gradient-to-t from-white via-white/85 to-transparent" />
                <WheelColumn
                  columnId="date"
                  options={pickerOptions.dateOptions}
                  value={customReminderDate}
                  onChange={setCustomReminderDate}
                  dragStartYRef={dragStartYRef}
                  wheelDeltaRef={wheelDeltaRef}
                  textClassName="text-[13px]"
                />
                <WheelColumn
                  columnId="hour"
                  options={hourWheelOptions}
                  value={customReminderHour}
                  onChange={setCustomReminderHour}
                  dragStartYRef={dragStartYRef}
                  wheelDeltaRef={wheelDeltaRef}
                  textClassName="text-[15px] tabular-nums"
                />
                <WheelColumn
                  columnId="minute"
                  options={minuteWheelOptions}
                  value={customReminderMinute}
                  onChange={setCustomReminderMinute}
                  dragStartYRef={dragStartYRef}
                  wheelDeltaRef={wheelDeltaRef}
                  textClassName="text-[15px] tabular-nums"
                />
              </div>

              <div className="mt-2 grid grid-cols-2 divide-x divide-gray-200 border-t border-gray-100 pt-2">
                <button
                  onClick={() => {
                    setReminderMenuView('presets');
                    setIsReminderMenuOpen(false);
                  }}
                  className="py-2 text-sm font-semibold text-gray-950 hover:text-black"
                >
                  取消
                </button>
                <button
                  onClick={handleCustomReminder}
                  className="py-2 text-sm font-semibold text-gray-950 hover:text-black"
                >
                  确定
                </button>
              </div>
            </div>
            )}
            {task.reminderAt && (
              <button
                onClick={() => {
                  onClearReminder(task.id);
                  setIsReminderMenuOpen(false);
                }}
                className="mt-1 block w-full rounded-md border-t border-gray-100 px-2 py-1.5 text-left text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                清除提醒
              </button>
            )}
          </div>
        )}

        <button
          onClick={() => onDelete(task.id)}
          className="p-1 text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
          title="Delete task"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
