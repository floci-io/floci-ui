'use client';

import {memo, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';
import {Icon, Misuse} from '@/components/sodium/icon';
import {findAll} from '@/lib/sodium/scroll';
import {cn} from '@/lib/sodium/utils';
import {Button} from '@/components/sodium/ui/button';
import {CopyButton} from '@/components/sodium/ui/copy-button';
import {TokenLine, WrapToggle, tokenize} from '@/components/sodium/ui/code-block';
import {Input} from '@/components/sodium/ui/input';
import {SegmentedControl, SegmentedControlItem} from '@/components/sodium/ui/segmented-control';

// Sodium's log viewer: a job's, a pipeline's or a worker's output as it streams. One frame: a 38px head row on the
// panel, the region header every Sodium region opens with (whose log it is as written, run_8f2a90, or "Logs" when
// nothing names it, then the line count and Streaming or "2 failed" as meta, then Wrap, Next failure and Copy lines),
// an optional toolbar, then the lines on --code-surface, the well, run edge to edge. Header, toolbar and lines all
// start 12px in (--inset), the region's one inset.
//
// One row per line in type-code, 13px on a 20px line, as written: the time in text-3, the level as the log prints it
// (INFO, WARN), the source in text-2 and the message in text-1. Only warn and fail take colour, in their level word,
// so the colour always has a word. A fail line also takes the failure wash across the whole row, as Code window's
// failing line does, so a failure reads in a scroll of thousands; its message stays ink, so it still reads.
//
// The toolbar's controls are one height and one line weight: a 26px search field and the levels as a 26px multiple
// segmented control with their counts, both edged in the same 1px --line. None pressed shows every level;
// pressing narrows to those. Wrap lives in the head row as a ghost icon cell beside the other actions, so the toolbar
// stays one row at 480px, and its glyph says which way lines run. The head row's actions are 26px icon cells 8px
// apart, in the order every header uses: wrap, next failure, copy. Next failure carries no count; "2 failed" is the meta.
//
// It sticks to the bottom while lines arrive. Scrolling up stops following and shows a "38 new" button back to the
// latest; reaching the bottom resumes. Rows are windowed, so 100,000 lines render only what is on screen. Next
// failure walks the fail lines, and the one it lands on takes the selection wash. Logs stay left to right in a
// right-to-left page.

type LogLevel = 'debug' | 'info' | 'warn' | 'fail';
type LogLine = {
  id: string | number;
  /** A Date, epoch ms or a preformatted string. Shown as HH:MM:SS, in UTC unless preformatted. */
  time?: Date | number | string;
  level?: LogLevel;
  /** Where the line came from: a step, a worker, a table. */
  source?: string;
  message: string;
};

const levels: LogLevel[] = ['debug', 'info', 'warn', 'fail'];
const levelNames: Record<LogLevel, string> = {debug: 'Debug', info: 'Info', warn: 'Warn', fail: 'Fail'};
const pad = (n: number) => String(n).padStart(2, '0');
const formatTime = (t: LogLine['time']) => {
  if (t === undefined) return '';
  if (typeof t === 'string') return t;
  const d = typeof t === 'number' ? new Date(t) : t;
  // UTC, like the logs, so the server and the browser print the same time.
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

/** The level as a log prints it, in its own capitals: a value, written as-is. */
const levelWord = (level: LogLevel) => level.toUpperCase();
const lineText = (l: LogLine) => [formatTime(l.time), levelWord(l.level ?? 'info'), l.source, l.message].filter(Boolean).join(' ');

const levelText: Record<LogLevel, string> = {debug: 'text-text-3', info: 'text-text-3', warn: 'text-warn-text', fail: 'text-fail-text'};
const fmt = (n: number) => n.toLocaleString('en-US');

/** One row, memoised, so a scroll renders only the rows that came into view. */
const LogRow = memo(function LogRow({line, index, start, q, hit, timestamps, wrap, measure}: {
  line: LogLine; index: number; start: number; q: string; hit: boolean; timestamps: boolean; wrap: boolean; measure: (el: Element | null) => void;
}) {
  const level = line.level ?? 'info';
  return <div
    data-index={index}
    ref={measure}
    data-slot="log-line"
    data-level={level}
    data-hit={hit || undefined}
    className={cn(
      // A row's layout never reaches outside it, so measuring one row does not lay out the rest.
      'absolute start-0 top-0 flex min-w-full items-start gap-3 px-inset type-code [contain:layout_style]',
      level === 'debug' ? 'text-text-2' : 'text-text-1',
      level === 'fail' && 'bg-fail-tint',
      // A search hit or the Next failure target: the selection wash, a place you are.
      'data-hit:bg-selected forced-colors:data-hit:outline forced-colors:data-hit:outline-1',
    )}
    // value-ok: a windowed row's offset comes from the virtualizer in px, so it can only live inline.
    style={{transform: `translateY(${start}px)`}}
  >
    {timestamps && <span className="shrink-0 text-text-3 max-sm:hidden">{formatTime(line.time)}</span>}
    <span className={cn('w-10 shrink-0', levelText[level])}>{levelWord(level)}</span>
    <span className={cn('min-w-0 flex-1', wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre')}>
      {line.source && <span className="text-text-2">{line.source} </span>}
      <TokenLine tokens={tokenize(line.message, 'text')[0] ?? []} marks={findAll(line.message, q)}/>
    </span>
  </div>;
});

type LogViewerProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  lines: LogLine[];
  /** Stick to the bottom as lines arrive. Scrolling up pauses it; the jump button resumes it. */
  follow?: boolean;
  /** Lines are still arriving: "Streaming" with the pending mark in the head row. */
  streaming?: boolean;
  /** The search, level and wrap strip. Off by default; a long log a person searches turns it on. */
  toolbar?: boolean;
  /** The head row: the name (or label), count, status, Next failure, Copy lines. */
  header?: boolean;
  /** The time column; hidden under 640px. */
  timestamps?: boolean;
  /** Start with long messages wrapped. Off, they run on and the log scrolls sideways. */
  wrap?: boolean;
  /** px. The log's height; it scrolls inside. */
  height?: number;
  /** The kind of log: "Logs". With name, it names the log region for assistive tech; without one, it is the head row's title. */
  label?: string;
  /** Whose log it is, the head row's title as written: "run_8f2a90". */
  name?: string;
};

function LogViewer({lines, follow = true, streaming = false, toolbar = false, header = true, timestamps = true, wrap: defaultWrap = true, height = 320, label = 'Logs', name, className, ...props}: LogViewerProps) {
  const title = name ? `${label} ${name}` : label;
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState<string[]>([]);
  const [wrap, setWrap] = useState(defaultWrap);
  const [following, setFollowing] = useState(follow);
  const [seenAt, setSeenAt] = useState(lines.length);
  const [hit, setHit] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  const counts = useMemo(() => {
    const c: Record<LogLevel, number> = {debug: 0, info: 0, warn: 0, fail: 0};
    for (const line of lines) c[line.level ?? 'info'] += 1;
    return c;
  }, [lines]);
  const filtered = useMemo(
    () => lines.filter(l => (!shown.length || shown.includes(l.level ?? 'info')) && (!q || l.message.toLowerCase().includes(q) || l.source?.toLowerCase().includes(q))),
    [lines, shown, q],
  );

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 12,
    getItemKey: i => filtered[i].id,
    useFlushSync: false,
  });

  const total = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    if (!following || !filtered.length) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length, following, total]);
  useEffect(() => { if (following) setSeenAt(lines.length); }, [following, lines.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !follow) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    if (atBottom !== following) setFollowing(atBottom);
  };
  // The button leaves once following resumes, so focus moves to the log body first.
  const jump = () => { scrollRef.current?.focus({preventScroll: true}); setFollowing(true); virtualizer.scrollToIndex(filtered.length - 1, {align: 'end'}); };
  const unseen = Math.max(0, lines.length - seenAt);
  const failures = counts.fail;
  const failIndexes = useMemo(() => filtered.flatMap((l, i) => (l.level === 'fail' ? [i] : [])), [filtered]);
  const nextFailure = () => {
    if (!failIndexes.length) return;
    const to = failIndexes.find(i => i > hit) ?? failIndexes[0];
    if (follow) setFollowing(false);
    setHit(to);
    virtualizer.scrollToIndex(to, {align: 'center'});
  };

  const empty = <p data-slot="log-viewer-empty" className="px-inset py-1 type-body-sm text-text-2">
    {lines.length === 0 ? (streaming ? 'Waiting for the first line.' : 'No output.') : q ? <>No lines match <code className="mono text-text-1">{query.trim()}</code>.</> : 'No lines at these levels.'}
  </p>;

  return <div
    data-slot="log-viewer"
    data-status={failures ? 'fail' : undefined}
    className={cn('@container/log frame flex flex-col overflow-hidden text-text-1', className)}
    {...props}
  >
    {header && <div data-slot="log-viewer-header" className="panel-head shrink-0">
      {/* The log's name outlasts its counts: on a phone the line count goes, a log under 320px leaves the failed count to Next failure's name, and the name keeps at least 80px. */}
      <span data-slot="log-viewer-title" className="me-auto min-w-20 truncate text-text-1">{name ?? label}</span>
      <span className="shrink-0 type-code-sm text-text-2 max-sm:hidden">{fmt(lines.length)} {lines.length === 1 ? 'line' : 'lines'}</span>
      {streaming
        ? <span data-slot="log-viewer-streaming" className="flex shrink-0 items-center gap-2 type-code-sm text-text-2"><span aria-hidden className="pending"/>Streaming</span>
        : failures > 0 && <span data-slot="log-viewer-failed" className={cn('shrink-0 type-code-sm text-fail-text', failIndexes.length > 0 && 'hidden @xs/log:block')}>{fmt(failures)} failed</span>}
      <span data-slot="log-viewer-actions" className="panel-head-actions">
        <WrapToggle wrap={wrap} onWrap={setWrap}/>
        {failIndexes.length > 0 && <Button data-slot="log-viewer-next-fail" variant="ghost" size="icon-sm" onClick={nextFailure} aria-label={`Next failure, ${failIndexes.length} in this log`}>
          <Icon icon={Misuse}/>
        </Button>}
        {/* Built on press: joining 100,000 lines on every render made each scroll frame a long task. */}
        <CopyButton value={() => filtered.map(lineText).join('\n')} label="lines"/>
      </span>
    </div>}
    {toolbar && <div data-slot="log-viewer-toolbar" className="flex min-h-(--row) min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-page px-inset py-1.5">
      <Input mode="search" size="sm" aria-label={`Filter ${title}`} placeholder="Filter lines" value={query} onValueChange={setQuery} clearLabel="Clear filter" className="min-w-32 flex-1"/>
      <SegmentedControl multiple size="sm" aria-label="Levels" value={shown} onValueChange={setShown}>
        {levels.map(level => <SegmentedControlItem key={level} value={level} count={counts[level]}>{levelNames[level]}</SegmentedControlItem>)}
      </SegmentedControl>
    </div>}
    <div className="relative flex min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        dir="ltr"
        data-slot="log-viewer-body"
        role="log"
        aria-live="off"
        aria-label={title}
        tabIndex={0}
        // Rows are flex rows, so a hand selection would copy one cell per line; join each row's cells with spaces.
        onCopy={event => {
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed || !selection.rangeCount) return;
          const rows = [...selection.getRangeAt(0).cloneContents().querySelectorAll('[data-slot=log-line]')];
          if (!rows.length) return;
          event.clipboardData.setData('text/plain', rows.map(row => [...row.children].map(cell => cell.textContent?.trim()).filter(Boolean).join(' ')).join('\n'));
          event.preventDefault();
        }}
        className="min-h-0 overflow-auto overscroll-contain bg-code-surface py-inset focus-visible:focus-ring-inset"
        // value-ok: the log's height is the caller's, in px, so it can only live inline. With no lines yet the body is
        // as tall as its one-line message, not a tall empty box; it takes the height when the first line arrives.
        style={{height: lines.length === 0 ? undefined : height}}
      >
        {filtered.length === 0
          ? empty
          : <div className={cn('relative', !wrap && 'w-max min-w-full')} style={{height: virtualizer.getTotalSize()}}>
              {virtualizer.getVirtualItems().map(item => <LogRow
                key={item.key}
                line={filtered[item.index]}
                index={item.index}
                start={item.start}
                q={q}
                hit={item.index === hit}
                timestamps={timestamps}
                wrap={wrap}
                measure={virtualizer.measureElement}
              />)}
            </div>}
      </div>
      {!following && follow && filtered.length > 0 && <Button size="sm" variant="secondary" onClick={jump} data-slot="log-viewer-jump" className="absolute end-inset bottom-inset bg-page">
        {unseen ? `${fmt(unseen)} new` : 'Latest'}
      </Button>}
    </div>
    <span role="status" className="sr-only">{failures ? `${failures} failed ${failures === 1 ? 'line' : 'lines'}` : ''}</span>
  </div>;
}

export {LogViewer, type LogLevel, type LogLine, type LogViewerProps};
