import {forwardRef} from 'react';
import {
  Activity as ActivityGlyph, ArrowDown as ArrowDownGlyph, ArrowLeft as ArrowLeftGlyph, ArrowRight as ArrowRightGlyph,
  ArrowUp as ArrowUpGlyph, ArrowUpRight as ArrowUpRightGlyph, Box, Calendar as CalendarGlyph,
  Check, ChevronDown as ChevronDownGlyph, ChevronLeft as ChevronLeftGlyph, ChevronRight as ChevronRightGlyph,
  ChevronUp as ChevronUpGlyph, ChevronsUpDown, CircleAlert, CircleStop, CircleX, Clock,
  Code as CodeGlyph, Copy as CopyGlyph, Cpu, Database, Download as DownloadGlyph, Ellipsis, ExternalLink, Eye, EyeOff,
  FileText, FoldVertical, Folder as FolderGlyph, Funnel, Gauge, GitBranch, Info, Lock, Minus, Moon as MoonGlyph,
  MoveHorizontal, Pause as PauseGlyph, Pencil, Play as PlayGlyph, Plus, RefreshCw, Search as SearchGlyph, Server,
  Settings as SettingsGlyph, SquareTerminal, Sun as SunGlyph, Table, TextWrap as TextWrapGlyph, Trash, TriangleAlert,
  Undo2, UnfoldVertical, Upload as UploadGlyph, Workflow, X, Zap,
  type LucideIcon, type LucideProps,
} from 'lucide-react';
import * as L from 'lucide-react';
import {cn} from '@/lib/sodium/utils';

// The one place Sodium imports icons from. Components import from here, never from the icon package, so the set
// can be swapped in one file.
//
// Lucide (lucide-react, ISC), drawn squared off. Every glyph here renders with square line ends, mitred joins and a
// 1.25px line at every size. Lucide's own round caps would be the only curve in a system of zero radius and 1px rules.
// Squared, its lines end the way Sodium's borders do, and 1.25px sits just heavier than a rule, so a glyph reads as a
// mark and not as another edge. Its vocabulary covers infrastructure: database, workflow, cpu, server, terminal,
// gauge, branch. One weight, so there is nothing to pick: pass a size. 16 in every control, 14 inside a small field
// (the field sets it, --icon-sm), 20 on its own, 24 and 32 for an empty state. Lucide scales to any size, but those
// five are the steps; there is no 12.
//
// `squared` wraps each glyph once, so it comes out styled whether a component draws it through Icon or renders it
// directly. The export names are Sodium's own, kept from the set before; the Lucide glyph is the first argument. To
// use another glyph, import it above and name it here.

// nonScalingStroke holds the line at 1.25 screen px whatever the size (Lucide 1.x deprecates absoluteStrokeWidth for it).
const SQUARED = {strokeWidth: 1.25, nonScalingStroke: true, strokeLinecap: 'square', strokeLinejoin: 'miter'} as const;

/** A Lucide glyph with Sodium's line: square ends, mitred joins, 1.25px at any size. A call site cannot round it. */
function squared(Glyph: LucideIcon, name: string): LucideIcon {
  const Squared = forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>((props, ref) => <Glyph ref={ref} {...props} {...SQUARED}/>);
  Squared.displayName = name;
  return Squared;
}

export const Activity = squared(ActivityGlyph, 'Activity');
export const Add = squared(Plus, 'Add');
export const ArrowDown = squared(ArrowDownGlyph, 'ArrowDown');
export const ArrowLeft = squared(ArrowLeftGlyph, 'ArrowLeft');
export const ArrowRight = squared(ArrowRightGlyph, 'ArrowRight');
export const ArrowUp = squared(ArrowUpGlyph, 'ArrowUp');
export const ArrowUpRight = squared(ArrowUpRightGlyph, 'ArrowUpRight');
export const Branch = squared(GitBranch, 'Branch');
export const Calendar = squared(CalendarGlyph, 'Calendar');
export const Checkmark = squared(Check, 'Checkmark');
export const ChevronDown = squared(ChevronDownGlyph, 'ChevronDown');
export const ChevronLeft = squared(ChevronLeftGlyph, 'ChevronLeft');
export const ChevronRight = squared(ChevronRightGlyph, 'ChevronRight');
export const ChevronSort = squared(ChevronsUpDown, 'ChevronSort');
export const ChevronUp = squared(ChevronUpGlyph, 'ChevronUp');
export const Chip = squared(Cpu, 'Chip');
export const Close = squared(X, 'Close');
export const Code = squared(CodeGlyph, 'Code');
export const Copy = squared(CopyGlyph, 'Copy');
export const Cube = squared(Box, 'Cube');
export const DataBase = squared(Database, 'DataBase');
export const DataTable = squared(Table, 'DataTable');
export const Document = squared(FileText, 'Document');
export const Download = squared(DownloadGlyph, 'Download');
export const Edit = squared(Pencil, 'Edit');
export const ErrorOutline = squared(CircleAlert, 'ErrorOutline');
export const Filter = squared(Funnel, 'Filter');
export const Flow = squared(Workflow, 'Flow');
export const Folder = squared(FolderGlyph, 'Folder');
export const Information = squared(Info, 'Information');
export const Launch = squared(ExternalLink, 'Launch');
export const Lightning = squared(Zap, 'Lightning');
export const Locked = squared(Lock, 'Locked');
export const Meter = squared(Gauge, 'Meter');
export const Moon = squared(MoonGlyph, 'Moon');
export const OverflowMenuHorizontal = squared(Ellipsis, 'OverflowMenuHorizontal');
export const Pause = squared(PauseGlyph, 'Pause');
export const Play = squared(PlayGlyph, 'Play');
export const Renew = squared(RefreshCw, 'Renew');
export const Search = squared(SearchGlyph, 'Search');
export const ServerDns = squared(Server, 'ServerDns');
export const Settings = squared(SettingsGlyph, 'Settings');
export const StopOutline = squared(CircleStop, 'StopOutline');
export const Subtract = squared(Minus, 'Subtract');
export const Sun = squared(SunGlyph, 'Sun');
export const Terminal = squared(SquareTerminal, 'Terminal');
export const Time = squared(Clock, 'Time');
export const TrashCan = squared(Trash, 'TrashCan');
export const Undo = squared(Undo2, 'Undo');
export const Upload = squared(UploadGlyph, 'Upload');
export const View = squared(Eye, 'View');
export const ViewOff = squared(EyeOff, 'ViewOff');
export const WarningAlt = squared(TriangleAlert, 'WarningAlt');
// The data and code batch's glyphs: wrap on and off, open and close all, the failure jump.
export const ArrowsHorizontal = squared(MoveHorizontal, 'ArrowsHorizontal');
export const CollapseAll = squared(FoldVertical, 'CollapseAll');
export const ExpandAll = squared(UnfoldVertical, 'ExpandAll');
export const Misuse = squared(CircleX, 'Misuse');
export const TextWrap = squared(TextWrapGlyph, 'TextWrap');

// Glyphs the console needs beyond Sodium's own set, under the lucide names the screens already use.
export const AlertCircle = squared(L.AlertCircle, 'AlertCircle');
export const AlertTriangle = squared(L.AlertTriangle, 'AlertTriangle');
export const Boxes = squared(L.Boxes, 'Boxes');
export const Braces = squared(L.Braces, 'Braces');
export const Brain = squared(L.Brain, 'Brain');
export const CheckSquared = squared(L.Check, 'CheckSquared');
export const CheckCircle2 = squared(L.CheckCircle2, 'CheckCircle2');
export const Circle = squared(L.Circle, 'Circle');
export const ClockSquared = squared(L.Clock, 'ClockSquared');
export const Cloud = squared(L.Cloud, 'Cloud');
export const Code2 = squared(L.Code2, 'Code2');
export const Container = squared(L.Container, 'Container');
export const DatabaseSquared = squared(L.Database, 'DatabaseSquared');
export const EyeSquared = squared(L.Eye, 'EyeSquared');
export const EyeOffSquared = squared(L.EyeOff, 'EyeOffSquared');
export const File = squared(L.File, 'File');
export const FileAudio = squared(L.FileAudio, 'FileAudio');
export const FileSpreadsheet = squared(L.FileSpreadsheet, 'FileSpreadsheet');
export const FileTextSquared = squared(L.FileText, 'FileTextSquared');
export const FileType = squared(L.FileType, 'FileType');
export const FileVideo = squared(L.FileVideo, 'FileVideo');
export const Globe = squared(L.Globe, 'Globe');
export const HardDrive = squared(L.HardDrive, 'HardDrive');
export const History = squared(L.History, 'History');
export const Image = squared(L.Image, 'Image');
export const InfoSquared = squared(L.Info, 'InfoSquared');
export const Key = squared(L.Key, 'Key');
export const KeyRound = squared(L.KeyRound, 'KeyRound');
export const Layers = squared(L.Layers, 'Layers');
export const Loader2 = squared(L.Loader2, 'Loader2');
export const LockSquared = squared(L.Lock, 'LockSquared');
export const Maximize2 = squared(L.Maximize2, 'Maximize2');
export const MessageSquare = squared(L.MessageSquare, 'MessageSquare');
export const Minimize2 = squared(L.Minimize2, 'Minimize2');
export const Monitor = squared(L.Monitor, 'Monitor');
export const Network = squared(L.Network, 'Network');
export const Package = squared(L.Package, 'Package');
export const PencilSquared = squared(L.Pencil, 'PencilSquared');
export const PlusSquared = squared(L.Plus, 'PlusSquared');
export const Power = squared(L.Power, 'Power');
export const Radio = squared(L.Radio, 'Radio');
export const RefreshCwSquared = squared(L.RefreshCw, 'RefreshCwSquared');
export const Rocket = squared(L.Rocket, 'Rocket');
export const RotateCcw = squared(L.RotateCcw, 'RotateCcw');
export const Router = squared(L.Router, 'Router');
export const Save = squared(L.Save, 'Save');
export const Scale = squared(L.Scale, 'Scale');
export const ScrollText = squared(L.ScrollText, 'ScrollText');
export const ServerSquared = squared(L.Server, 'ServerSquared');
export const Shield = squared(L.Shield, 'Shield');
export const ShieldCheck = squared(L.ShieldCheck, 'ShieldCheck');
export const SlidersHorizontal = squared(L.SlidersHorizontal, 'SlidersHorizontal');
export const Table2 = squared(L.Table2, 'Table2');
export const TableProperties = squared(L.TableProperties, 'TableProperties');
export const Trash2 = squared(L.Trash2, 'Trash2');
export const Undo2Squared = squared(L.Undo2, 'Undo2Squared');
export const Waypoints = squared(L.Waypoints, 'Waypoints');
export const WorkflowSquared = squared(L.Workflow, 'WorkflowSquared');
export const XSquared = squared(L.X, 'XSquared');
export const ZapSquared = squared(L.Zap, 'ZapSquared');

export const Plug = squared(L.Plug, 'Plug');
export const Unplug = squared(L.Unplug, 'Unplug');
export const Camera = squared(L.Camera, 'Camera');
export const LockKeyhole = squared(L.LockKeyhole, 'LockKeyhole');
export const UnlockKeyhole = squared(L.UnlockKeyhole, 'UnlockKeyhole');
export const Wand2 = squared(L.Wand2, 'Wand2');
export const Inbox = squared(L.Inbox, 'Inbox');
export const Send = squared(L.Send, 'Send');
export const Tags = squared(L.Tags, 'Tags');

export type SodiumIcon = LucideIcon;

type IconProps = Omit<LucideProps, 'size' | 'ref'> & {
  /** The glyph, imported from this file. */
  icon: SodiumIcon;
  /** px. 16 in a control (the default), 14 inside a small field, 20 on its own, 24 and 32 only for an empty state. */
  size?: 14 | 16 | 20 | 24 | 32;
  /** Accessible name. Without one the icon is decorative and hidden from assistive tech. */
  label?: string;
};

export function Icon({icon: Glyph, size = 16, label, className, ...props}: IconProps) {
  return <Glyph
    size={size}
    aria-hidden={label ? undefined : true}
    aria-label={label}
    role={label ? 'img' : undefined}
    className={cn('shrink-0', className)}
    {...props}
  />;
}
