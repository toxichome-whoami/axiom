/*
 * Date & Time popover picker components:
 * - InlineDateTimePickerPopover: Compact inline calendar & time picker popover for table cells
 * - DateTimePickerInput: Inspector single-line input field with popover calendar
 * Owned by: ui/pages/table
 * Key deps: react, lucide-react, @daypicker/react
 * Invariants: Correct timezone handling, bounds checking, 24-hour time controls.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Calendar, ChevronUp, ChevronDown } from 'lucide-react';
import { DayPicker } from '@daypicker/react';
import { ColumnInfoApi } from '../../types';

export interface InlineDateTimePickerPopoverProps {
  editingCell: {
    rowIndex: number;
    colName: string;
    column?: ColumnInfoApi;
    initialValue: unknown;
    currentValue: string;
    rect: { top: number; left: number; width: number; height: number };
  };
  onSave: (val: unknown) => void;
  onCancel: () => void;
}

export function InlineDateTimePickerPopover({
  editingCell,
  onSave,
  onCancel,
}: InlineDateTimePickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const calendarModalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const normType = editingCell.column?.type?.toLowerCase() || '';
  const isDateOnly = normType === 'date';

  const [inputVal, setInputVal] = useState<string>(() => {
    return editingCell.currentValue === null || editingCell.currentValue === undefined
      ? ''
      : String(editingCell.currentValue);
  });

  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const parseVal = useCallback((val: string) => {
    if (!val.trim()) {
      return { date: undefined, hours: '12', minutes: '00', seconds: '00', tz: '' };
    }
    const parts = val.trim().split(/[T ]/);
    const dateStr = parts[0] || '';
    const timeFull = parts[1] || '';

    let d: Date | undefined;
    const dateParts = dateStr.split('-').map(Number);
    if (dateParts.length === 3 && dateParts.every((n) => !isNaN(n))) {
      const parsedDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      if (!isNaN(parsedDate.getTime())) {
        d = parsedDate;
      }
    }

    let hours = '12';
    let minutes = '00';
    let seconds = '00';
    let tz = '';

    if (timeFull) {
      const tzMatch = timeFull.match(/([+-]\d{2}(?::?\d{2})?|Z|[A-Z]{2,4})$/i);
      if (tzMatch) {
        tz = tzMatch[0];
      }
      const timeWithoutTz = tz ? timeFull.slice(0, -tz.length) : timeFull;
      const tParts = timeWithoutTz.split(':');
      if (tParts[0] !== undefined) hours = tParts[0].padStart(2, '0');
      if (tParts[1] !== undefined) minutes = tParts[1].padStart(2, '0');
      if (tParts[2] !== undefined) seconds = tParts[2].split('.')[0].padStart(2, '0');
    }

    return { date: d, hours, minutes, seconds, tz };
  }, []);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => parseVal(inputVal).date);
  const [month, setMonth] = useState<Date>(() => parseVal(inputVal).date || new Date());
  const [timeState, setTimeState] = useState(() => {
    const p = parseVal(inputVal);
    return {
      hours: p.hours,
      minutes: p.minutes,
      seconds: p.seconds,
      tz: p.tz,
    };
  });

  const formatOutput = useCallback((
    dateObj: Date | undefined,
    timeObj: { hours: string; minutes: string; seconds: string; tz: string }
  ): string => {
    if (!dateObj) return '';
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const datePart = `${y}-${m}-${d}`;

    if (isDateOnly) {
      return datePart;
    }
    const h = String(timeObj.hours).padStart(2, '0');
    const min = String(timeObj.minutes).padStart(2, '0');
    const s = String(timeObj.seconds).padStart(2, '0');
    const tzSuffix = timeObj.tz ? ` ${timeObj.tz}` : '';
    return `${datePart} ${h}:${min}:${s}${tzSuffix}`;
  }, [isDateOnly]);

  const handleSelectDate = (date: Date | undefined) => {
    setSelectedDate(date);
    const formatted = formatOutput(date, timeState);
    setInputVal(formatted);
  };

  const handleSetNow = () => {
    const now = new Date();
    setSelectedDate(now);
    const newTime = {
      hours: String(now.getHours()).padStart(2, '0'),
      minutes: String(now.getMinutes()).padStart(2, '0'),
      seconds: String(now.getSeconds()).padStart(2, '0'),
      tz: timeState.tz,
    };
    setTimeState(newTime);
    setInputVal(formatOutput(now, newTime));
  };

  const handleSetNull = () => {
    setSelectedDate(undefined);
    setInputVal('');
  };

  const localTz = useMemo(() => {
    try {
      const d = new Date();
      const match = d.toTimeString().match(/\((.+)\)$/);
      if (match) return match[1];
      const offset = -d.getTimezoneOffset() / 60;
      return offset >= 0 ? `UTC+${offset}` : `UTC${offset}`;
    } catch {
      return 'UTC';
    }
  }, []);

  const activeTz = timeState.tz || localTz;

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inPopover = popoverRef.current && popoverRef.current.contains(target);
      const inCalendar = calendarModalRef.current && calendarModalRef.current.contains(target);
      if (!inPopover && !inCalendar) {
        onSave(inputVal);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [inputVal, onSave]);

  useEffect(() => {
    const handleScroll = (e: Event) => {
      const target = e.target as Node;
      if (
        (popoverRef.current && popoverRef.current.contains(target)) ||
        (calendarModalRef.current && calendarModalRef.current.contains(target))
      ) {
        return;
      }
      onSave(inputVal);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [inputVal, onSave]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSave(inputVal);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (isCalendarOpen) {
        setIsCalendarOpen(false);
      } else {
        onCancel();
      }
    }
  };

  const toggleCalendar = () => {
    if (!isCalendarOpen) {
      const parsed = parseVal(inputVal);
      if (parsed.date) {
        setSelectedDate(parsed.date);
        setMonth(parsed.date);
      }
      setTimeState({
        hours: parsed.hours,
        minutes: parsed.minutes,
        seconds: parsed.seconds,
        tz: parsed.tz,
      });
    }
    setIsCalendarOpen((prev) => !prev);
  };

  const minWidth = Math.max(editingCell.rect.width, 240);
  const left = Math.max(8, Math.min(window.innerWidth - minWidth - 16, editingCell.rect.left));
  const top = Math.max(8, Math.min(window.innerHeight - 44, editingCell.rect.top));

  const calWidth = 340;
  const calHeight = isDateOnly ? 360 : 455;
  const calLeft = Math.max(8, Math.min(window.innerWidth - calWidth - 16, left));
  const showAbove = top + 42 + calHeight > window.innerHeight && top - calHeight > 8;
  const calTop = showAbove ? top - calHeight - 6 : top + editingCell.rect.height + 4;

  return (
    <>
      {/* Compact One-Line Edit Container */}
      <div
        ref={popoverRef}
        style={{
          top: `${top}px`,
          left: `${left}px`,
          width: `${minWidth}px`,
          height: `${Math.max(editingCell.rect.height, 36)}px`,
        }}
        className="fixed z-50 flex items-center rounded-[6px] border border-[#2a2a2a] bg-[#121212] shadow-[0_12px_32px_rgba(0,0,0,0.85)] font-sans overflow-hidden animate-in fade-in zoom-in-95 duration-100"
      >
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleInputKeyDown}
          spellCheck={false}
          className="h-full flex-1 min-w-0 bg-transparent px-3 text-[13px] font-mono text-white outline-none placeholder-[#555555]"
          placeholder={isDateOnly ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:MM:SS'}
        />

        {/* Right side Calendar picker button */}
        <button
          type="button"
          tabIndex={-1}
          onClick={toggleCalendar}
          title={isCalendarOpen ? 'Close calendar' : 'Open date & time picker'}
          className={`h-full px-2.5 flex items-center justify-center border-l border-[#262626] transition-colors cursor-pointer shrink-0 ${
            isCalendarOpen
              ? 'bg-[#222222] text-[#38bdf8]'
              : 'bg-[#161616] hover:bg-[#202020] text-[#8c8c8c] hover:text-white'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Extended Date/Time Picker Dropdown Panel */}
      {isCalendarOpen && (
        <div
          ref={calendarModalRef}
          style={{
            top: `${calTop}px`,
            left: `${calLeft}px`,
            width: `${calWidth}px`,
          }}
          className="fixed z-[55] rounded-[8px] border border-[#262626] bg-[#0c0c0c] shadow-[0_20px_45px_rgba(0,0,0,0.95)] p-3.5 font-sans animate-in fade-in zoom-in-95 duration-100 select-none"
        >
          {/* Header Bar */}
          <div className="pb-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-white flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#8c8c8c]" />
                <span>{isDateOnly ? 'Select Date' : 'Select Date & Time'}</span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleSetNow}
                  className="px-2 py-0.5 rounded-[4px] text-[11.5px] font-medium bg-[#161616] hover:bg-[#222222] text-[#cccccc] hover:text-white border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
                >
                  Now
                </button>
                <button
                  type="button"
                  onClick={handleSetNull}
                  className="px-2 py-0.5 rounded-[4px] text-[11.5px] font-medium bg-[#161616] hover:bg-[#222222] text-[#8c8c8c] hover:text-white border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
                >
                  NULL
                </button>
              </div>
            </div>
          </div>

          <div className="-mx-3.5 border-t border-[#222222] mb-2" />

          {/* Calendar Grid */}
          <div className="axiom-datepicker-wrapper w-full py-1">
            <DayPicker
              mode="single"
              selected={selectedDate}
              month={month}
              onMonthChange={setMonth}
              onSelect={handleSelectDate}
              className="m-0 text-white font-sans text-[12px] w-full"
            />
          </div>

          {/* Detailed Time Selector */}
          {!isDateOnly && (
            <>
              <div className="-mx-3.5 border-t border-[#222222] my-2" />

              <div className="pt-0.5">
                <div className="flex items-center justify-between text-[12px] text-[#8c8c8c] mb-2">
                  <span className="font-medium text-[#cccccc]">Time of Day</span>
                  <div className="flex items-center gap-1.5 font-mono text-[11px]">
                    <span className="text-[#cccccc] bg-[#141414] px-1.5 py-0.5 rounded border border-[#262626] font-medium">
                      {activeTz}
                    </span>
                    <span className="text-[#777777] bg-[#141414] px-1.5 py-0.5 rounded border border-[#222222]">
                      24h
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono">
                  {/* Hours */}
                  <div className="flex flex-col">
                    <div className="relative flex items-center rounded-[6px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={timeState.hours}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          const num = Math.min(23, Number(val) || 0);
                          const h = val === '' ? '' : String(num).padStart(2, '0');
                          const newT = { ...timeState, hours: h || '00' };
                          setTimeState(newT);
                          setInputVal(formatOutput(selectedDate || new Date(), newT));
                        }}
                        onBlur={() => {
                          const h = String(Math.max(0, Math.min(23, Number(timeState.hours) || 0))).padStart(2, '0');
                          const newT = { ...timeState, hours: h };
                          setTimeState(newT);
                          setInputVal(formatOutput(selectedDate || new Date(), newT));
                        }}
                        className="h-8 w-full bg-transparent pl-2.5 pr-5 text-center text-[13px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.hours) || 0;
                            const next = cur >= 23 ? 0 : cur + 1;
                            const h = String(next).padStart(2, '0');
                            const newT = { ...timeState, hours: h };
                            setTimeState(newT);
                            setInputVal(formatOutput(selectedDate || new Date(), newT));
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.hours) || 0;
                            const next = cur <= 0 ? 23 : cur - 1;
                            const h = String(next).padStart(2, '0');
                            const newT = { ...timeState, hours: h };
                            setTimeState(newT);
                            setInputVal(formatOutput(selectedDate || new Date(), newT));
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Hours (0-23)</span>
                  </div>

                  {/* Minutes */}
                  <div className="flex flex-col">
                    <div className="relative flex items-center rounded-[6px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={timeState.minutes}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          const num = Math.min(59, Number(val) || 0);
                          const m = val === '' ? '' : String(num).padStart(2, '0');
                          const newT = { ...timeState, minutes: m || '00' };
                          setTimeState(newT);
                          setInputVal(formatOutput(selectedDate || new Date(), newT));
                        }}
                        onBlur={() => {
                          const m = String(Math.max(0, Math.min(59, Number(timeState.minutes) || 0))).padStart(2, '0');
                          const newT = { ...timeState, minutes: m };
                          setTimeState(newT);
                          setInputVal(formatOutput(selectedDate || new Date(), newT));
                        }}
                        className="h-8 w-full bg-transparent pl-2.5 pr-5 text-center text-[13px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.minutes) || 0;
                            const next = cur >= 59 ? 0 : cur + 1;
                            const m = String(next).padStart(2, '0');
                            const newT = { ...timeState, minutes: m };
                            setTimeState(newT);
                            setInputVal(formatOutput(selectedDate || new Date(), newT));
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.minutes) || 0;
                            const next = cur <= 0 ? 59 : cur - 1;
                            const m = String(next).padStart(2, '0');
                            const newT = { ...timeState, minutes: m };
                            setTimeState(newT);
                            setInputVal(formatOutput(selectedDate || new Date(), newT));
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Min (0-59)</span>
                  </div>

                  {/* Seconds */}
                  <div className="flex flex-col">
                    <div className="relative flex items-center rounded-[6px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={timeState.seconds}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          const num = Math.min(59, Number(val) || 0);
                          const s = val === '' ? '' : String(num).padStart(2, '0');
                          const newT = { ...timeState, seconds: s || '00' };
                          setTimeState(newT);
                          setInputVal(formatOutput(selectedDate || new Date(), newT));
                        }}
                        onBlur={() => {
                          const s = String(Math.max(0, Math.min(59, Number(timeState.seconds) || 0))).padStart(2, '0');
                          const newT = { ...timeState, seconds: s };
                          setTimeState(newT);
                          setInputVal(formatOutput(selectedDate || new Date(), newT));
                        }}
                        className="h-8 w-full bg-transparent pl-2.5 pr-5 text-center text-[13px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.seconds) || 0;
                            const next = cur >= 59 ? 0 : cur + 1;
                            const s = String(next).padStart(2, '0');
                            const newT = { ...timeState, seconds: s };
                            setTimeState(newT);
                            setInputVal(formatOutput(selectedDate || new Date(), newT));
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.seconds) || 0;
                            const next = cur <= 0 ? 59 : cur - 1;
                            const s = String(next).padStart(2, '0');
                            const newT = { ...timeState, seconds: s };
                            setTimeState(newT);
                            setInputVal(formatOutput(selectedDate || new Date(), newT));
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Sec (0-59)</span>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="-mx-3.5 border-t border-[#222222] my-2.5" />

          {/* Confirmation footer */}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[12px] text-[#8c8c8c] font-mono truncate max-w-[170px]" title={inputVal || 'NULL'}>
              {inputVal || 'NULL'}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsCalendarOpen(false)}
                className="px-2.5 py-1 rounded-[6px] text-[12px] font-sans text-[#8c8c8c] hover:text-white bg-[#141414] hover:bg-[#202020] border border-[#262626] transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => onSave(inputVal)}
                className="group relative flex shrink-0 items-center justify-center h-7 px-3.5 rounded-[6px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] text-[12.5px] font-sans"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)]"
                />
                <span className="relative">Apply</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export interface DateTimePickerInputProps {
  value: unknown;
  onChange: (val: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  isDateOnly?: boolean;
}

export function DateTimePickerInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  isDateOnly = false,
}: DateTimePickerInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const strVal = value === null || value === undefined ? '' : String(value);

  const parseVal = useCallback((val: string) => {
    if (!val.trim()) {
      return { date: undefined, hours: '12', minutes: '00', seconds: '00', tz: '' };
    }
    const parts = val.trim().split(/[T ]/);
    const dateStr = parts[0] || '';
    const timeFull = parts[1] || '';

    let d: Date | undefined;
    const dateParts = dateStr.split('-').map(Number);
    if (dateParts.length === 3 && dateParts.every((n) => !isNaN(n))) {
      const parsedDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      if (!isNaN(parsedDate.getTime())) {
        d = parsedDate;
      }
    }

    let hours = '12';
    let minutes = '00';
    let seconds = '00';
    let tz = '';

    if (timeFull) {
      const tzMatch = timeFull.match(/([+-]\d{2}(?::?\d{2})?|Z|[A-Z]{2,4})$/i);
      if (tzMatch) {
        tz = tzMatch[0];
      }
      const timeWithoutTz = tz ? timeFull.slice(0, -tz.length) : timeFull;
      const tParts = timeWithoutTz.split(':');
      if (tParts[0] !== undefined) hours = tParts[0].padStart(2, '0');
      if (tParts[1] !== undefined) minutes = tParts[1].padStart(2, '0');
      if (tParts[2] !== undefined) seconds = tParts[2].split('.')[0].padStart(2, '0');
    }

    return { date: d, hours, minutes, seconds, tz };
  }, []);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => parseVal(strVal).date);
  const [month, setMonth] = useState<Date>(() => parseVal(strVal).date || new Date());
  const [timeState, setTimeState] = useState(() => {
    const p = parseVal(strVal);
    return {
      hours: p.hours,
      minutes: p.minutes,
      seconds: p.seconds,
      tz: p.tz,
    };
  });

  useEffect(() => {
    const p = parseVal(strVal);
    setSelectedDate(p.date);
    if (p.date) setMonth(p.date);
    setTimeState({
      hours: p.hours,
      minutes: p.minutes,
      seconds: p.seconds,
      tz: p.tz,
    });
  }, [strVal, parseVal]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const commitValue = useCallback(
    (
      dateObj: Date | undefined,
      timeObj: { hours: string; minutes: string; seconds: string; tz: string }
    ) => {
      if (!dateObj) {
        onChange(null);
        return;
      }
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      const datePart = `${y}-${m}-${d}`;

      if (isDateOnly) {
        onChange(datePart);
        return;
      }

      const h = String(timeObj.hours).padStart(2, '0');
      const min = String(timeObj.minutes).padStart(2, '0');
      const s = String(timeObj.seconds).padStart(2, '0');
      const tzSuffix = timeObj.tz ? ` ${timeObj.tz}` : '';
      onChange(`${datePart} ${h}:${min}:${s}${tzSuffix}`);
    },
    [isDateOnly, onChange]
  );

  const handleSelectDate = (date: Date | undefined) => {
    setSelectedDate(date);
    commitValue(date, timeState);
  };

  const handleSetNow = () => {
    const now = new Date();
    setSelectedDate(now);
    const newTime = {
      hours: String(now.getHours()).padStart(2, '0'),
      minutes: String(now.getMinutes()).padStart(2, '0'),
      seconds: String(now.getSeconds()).padStart(2, '0'),
      tz: timeState.tz,
    };
    setTimeState(newTime);
    commitValue(now, newTime);
  };

  const handleSetNull = () => {
    setSelectedDate(undefined);
    onChange(null);
  };

  const localTz = useMemo(() => {
    try {
      const d = new Date();
      const match = d.toTimeString().match(/\((.+)\)$/);
      if (match) return match[1];
      const offset = -d.getTimezoneOffset() / 60;
      return offset >= 0 ? `UTC+${offset}` : `UTC${offset}`;
    } catch {
      return 'UTC';
    }
  }, []);

  const activeTz = timeState.tz || localTz;

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="relative flex items-center">
        <input
          type="text"
          disabled={disabled}
          value={strVal}
          placeholder={placeholder || (isDateOnly ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:MM:SS')}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? null : v);
          }}
          className={`h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white font-mono focus:outline-none focus:border-[#3b82f6] transition-colors placeholder-[#555555] ${
            disabled ? 'opacity-60 cursor-not-allowed bg-[#0d0d0d]' : ''
          }`}
        />
        {!disabled && (
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="absolute right-1.5 flex items-center justify-center w-7 h-7 rounded-[4px] text-[#8c8c8c] hover:text-white hover:bg-[#1f1f1f] transition-colors cursor-pointer"
            title="Pick date & time"
          >
            <Calendar className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1.5 w-[320px] rounded-[8px] border border-[#262626] bg-[#0c0c0c] shadow-[0_16px_40px_rgba(0,0,0,0.9)] p-3 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans select-none"
        >
          {/* Header Bar */}
          <div className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-white flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#8c8c8c]" />
                <span>{isDateOnly ? 'Select Date' : 'Select Date & Time'}</span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleSetNow}
                  className="px-2 py-0.5 rounded-[4px] text-[11px] font-medium bg-[#161616] hover:bg-[#222222] text-[#cccccc] hover:text-white border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
                >
                  Now
                </button>
                <button
                  type="button"
                  onClick={handleSetNull}
                  className="px-2 py-0.5 rounded-[4px] text-[11px] font-medium bg-[#161616] hover:bg-[#222222] text-[#8c8c8c] hover:text-white border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
                >
                  NULL
                </button>
              </div>
            </div>
          </div>

          <div className="-mx-3 border-t border-[#222222] mb-1.5" />

          {/* Calendar DayPicker */}
          <div className="axiom-datepicker-wrapper w-full">
            <DayPicker
              mode="single"
              selected={selectedDate}
              month={month}
              onMonthChange={setMonth}
              onSelect={handleSelectDate}
              className="m-0 text-white font-sans text-[12px] w-full"
            />
          </div>

          {!isDateOnly && (
            <>
              <div className="-mx-3 border-t border-[#222222] my-2" />
              <div className="pt-0.5">
                <div className="flex items-center justify-between text-[11.5px] text-[#8c8c8c] mb-1.5">
                  <span className="font-medium text-[#cccccc]">Time of Day</span>
                  <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
                    <span className="text-[#cccccc] bg-[#141414] px-1.5 py-0.5 rounded border border-[#262626] font-medium">
                      {activeTz}
                    </span>
                    <span className="text-[#777777] bg-[#141414] px-1.5 py-0.5 rounded border border-[#222222]">
                      24h
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 font-mono">
                  {/* Hours */}
                  <div className="flex flex-col">
                    <div className="relative flex items-center rounded-[5px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={timeState.hours}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          const num = Math.min(23, Number(val) || 0);
                          const h = val === '' ? '' : String(num).padStart(2, '0');
                          const newT = { ...timeState, hours: h || '00' };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        onBlur={() => {
                          const h = String(Math.max(0, Math.min(23, Number(timeState.hours) || 0))).padStart(2, '0');
                          const newT = { ...timeState, hours: h };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        className="h-7 w-full bg-transparent pl-2 pr-4 text-center text-[12px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.hours) || 0;
                            const next = cur >= 23 ? 0 : cur + 1;
                            const h = String(next).padStart(2, '0');
                            const newT = { ...timeState, hours: h };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.hours) || 0;
                            const next = cur <= 0 ? 23 : cur - 1;
                            const h = String(next).padStart(2, '0');
                            const newT = { ...timeState, hours: h };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Hours (0-23)</span>
                  </div>

                  {/* Minutes */}
                  <div className="flex flex-col">
                    <div className="relative flex items-center rounded-[5px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={timeState.minutes}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          const num = Math.min(59, Number(val) || 0);
                          const m = val === '' ? '' : String(num).padStart(2, '0');
                          const newT = { ...timeState, minutes: m || '00' };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        onBlur={() => {
                          const m = String(Math.max(0, Math.min(59, Number(timeState.minutes) || 0))).padStart(2, '0');
                          const newT = { ...timeState, minutes: m };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        className="h-7 w-full bg-transparent pl-2 pr-4 text-center text-[12px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.minutes) || 0;
                            const next = cur >= 59 ? 0 : cur + 1;
                            const m = String(next).padStart(2, '0');
                            const newT = { ...timeState, minutes: m };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.minutes) || 0;
                            const next = cur <= 0 ? 59 : cur - 1;
                            const m = String(next).padStart(2, '0');
                            const newT = { ...timeState, minutes: m };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Min (0-59)</span>
                  </div>

                  {/* Seconds */}
                  <div className="flex flex-col">
                    <div className="relative flex items-center rounded-[5px] border border-[#262626] bg-[#121212] overflow-hidden focus-within:border-[#444444] transition-colors">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={timeState.seconds}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          const num = Math.min(59, Number(val) || 0);
                          const s = val === '' ? '' : String(num).padStart(2, '0');
                          const newT = { ...timeState, seconds: s || '00' };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        onBlur={() => {
                          const s = String(Math.max(0, Math.min(59, Number(timeState.seconds) || 0))).padStart(2, '0');
                          const newT = { ...timeState, seconds: s };
                          setTimeState(newT);
                          commitValue(selectedDate || new Date(), newT);
                        }}
                        className="h-7 w-full bg-transparent pl-2 pr-4 text-center text-[12px] text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <div className="absolute right-0.5 top-0.5 bottom-0.5 flex flex-col justify-center border-l border-[#222222] pl-0.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.seconds) || 0;
                            const next = cur >= 59 ? 0 : cur + 1;
                            const s = String(next).padStart(2, '0');
                            const newT = { ...timeState, seconds: s };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            const cur = Number(timeState.seconds) || 0;
                            const next = cur <= 0 ? 59 : cur - 1;
                            const s = String(next).padStart(2, '0');
                            const newT = { ...timeState, seconds: s };
                            setTimeState(newT);
                            commitValue(selectedDate || new Date(), newT);
                          }}
                          className="h-3.5 w-4 flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#202020] rounded-[2px] transition-colors"
                        >
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    <span className="text-[10px] text-center text-[#777777] mt-1 font-sans">Sec (0-59)</span>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="-mx-3 border-t border-[#222222] my-2.5" />

          {/* Footer */}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[12px] text-[#8c8c8c] font-mono truncate max-w-[190px]">
              {strVal || 'NULL'}
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="group relative flex shrink-0 items-center justify-center h-7 px-3.5 rounded-[6px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] text-[12.5px] font-sans"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative">Done</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
