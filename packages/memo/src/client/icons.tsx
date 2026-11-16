import type { JSX, ReactNode } from 'react';

interface IconProps { className?: string }
interface SvgProps extends IconProps { children: ReactNode }

function Svg({ className = 'h-4 w-4 shrink-0', children }: SvgProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconPanel = (p: IconProps): JSX.Element => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></Svg>;
export const IconPlus = (p: IconProps): JSX.Element => <Svg {...p}><path d="M5 12h14M12 5v14" /></Svg>;
export const IconSearch = (p: IconProps): JSX.Element => <Svg {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Svg>;
export const IconX = (p: IconProps): JSX.Element => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const IconPin = (p: IconProps): JSX.Element => <Svg {...p}><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></Svg>;
export const IconShieldOff = (p: IconProps): JSX.Element => <Svg {...p}><path d="m2 2 20 20" /><path d="M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71" /><path d="M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264" /></Svg>;
export const IconPaperclip = (p: IconProps): JSX.Element => <Svg {...p}><path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" /></Svg>;
export const IconHistory = (p: IconProps): JSX.Element => <Svg {...p}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></Svg>;
export const IconTrash = (p: IconProps): JSX.Element => <Svg {...p}><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><path d="M10 11v6M14 11v6" /></Svg>;
export const IconRestore = (p: IconProps): JSX.Element => <Svg {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" /></Svg>;
export const IconSparkles = (p: IconProps): JSX.Element => <Svg {...p}><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /><path d="M20 3v4M22 5h-4M4 17v2M5 18H3" /></Svg>;
export const IconSettings = (p: IconProps): JSX.Element => <Svg {...p}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></Svg>;
export const IconDownload = (p: IconProps): JSX.Element => <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></Svg>;
export const IconCopy = (p: IconProps): JSX.Element => <Svg {...p}><rect x="8" y="8" width="14" height="14" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></Svg>;
export const IconDuplicate = (p: IconProps): JSX.Element => <Svg {...p}><path d="M15 12v6M12 15h6" /><rect x="8" y="8" width="14" height="14" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></Svg>;
export const IconCheck = (p: IconProps): JSX.Element => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
export const IconCalendar = (p: IconProps): JSX.Element => <Svg {...p}><path d="M8 2v4M16 2v4" /><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18" /></Svg>;
export const IconLink = (p: IconProps): JSX.Element => <Svg {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Svg>;
export const IconFile = (p: IconProps): JSX.Element => <Svg {...p}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></Svg>;
export const IconBold = (p: IconProps): JSX.Element => <Svg {...p}><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" /></Svg>;
export const IconItalic = (p: IconProps): JSX.Element => <Svg {...p}><path d="M19 4h-9M14 20H5M15 4 9 20" /></Svg>;
export const IconHeading = (p: IconProps): JSX.Element => <Svg {...p}><path d="M6 12h12M6 20V4M18 20V4" /></Svg>;
export const IconList = (p: IconProps): JSX.Element => <Svg {...p}><path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13" /></Svg>;
export const IconListChecks = (p: IconProps): JSX.Element => <Svg {...p}><path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8" /></Svg>;
export const IconPencil = (p: IconProps): JSX.Element => <Svg {...p}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></Svg>;
export const IconLock = (p: IconProps): JSX.Element => <Svg {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Svg>;
export const IconAlert = (p: IconProps): JSX.Element => <Svg {...p}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4M12 17h.01" /></Svg>;
export const IconChevronDown = (p: IconProps): JSX.Element => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconPlay = (p: IconProps): JSX.Element => <Svg {...p}><polygon points="6 3 20 12 6 21 6 3" /></Svg>;
export const IconFilm = (p: IconProps): JSX.Element => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M3 7.5h4M3 12h18M3 16.5h4M17 3v18M17 7.5h4M17 16.5h4" /></Svg>;
export const IconMusic = (p: IconProps): JSX.Element => <Svg {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Svg>;
export const IconChevronLeft = (p: IconProps): JSX.Element => <Svg {...p}><path d="m15 18-6-6 6-6" /></Svg>;
export const IconChevronRight = (p: IconProps): JSX.Element => <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>;
export const IconRetry = (p: IconProps): JSX.Element => <Svg {...p}><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></Svg>;
export const IconStrike = (p: IconProps): JSX.Element => <Svg {...p}><path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16" /></Svg>;
export const IconListOrdered = (p: IconProps): JSX.Element => <Svg {...p}><path d="M10 12h11M10 18h11M10 6h11M4 10h2M4 6h1v4M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /></Svg>;
export const IconTable = (p: IconProps): JSX.Element => <Svg {...p}><path d="M12 3v18" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18" /></Svg>;
export const IconGrid = (p: IconProps): JSX.Element => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></Svg>;
export const IconQuote = (p: IconProps): JSX.Element => <Svg {...p}><path d="M17 6H3M21 12H8M21 18H8M3 12v6" /></Svg>;
export const IconCode = (p: IconProps): JSX.Element => <Svg {...p}><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></Svg>;
export const IconMinus = (p: IconProps): JSX.Element => <Svg {...p}><path d="M5 12h14" /></Svg>;
export const IconClock = (p: IconProps): JSX.Element => <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></Svg>;
export const IconRowPlus = (p: IconProps): JSX.Element => <Svg {...p}><rect x="3" y="3" width="18" height="7" rx="1.5" /><path d="M12 14v7M8.5 17.5h7" /></Svg>;
export const IconRowMinus = (p: IconProps): JSX.Element => <Svg {...p}><rect x="3" y="3" width="18" height="7" rx="1.5" /><path d="M8.5 17.5h7" /></Svg>;
export const IconColPlus = (p: IconProps): JSX.Element => <Svg {...p}><rect x="3" y="3" width="7" height="18" rx="1.5" /><path d="M14 12h7M17.5 8.5v7" /></Svg>;
export const IconColMinus = (p: IconProps): JSX.Element => <Svg {...p}><rect x="3" y="3" width="7" height="18" rx="1.5" /><path d="M14 12h7" /></Svg>;
export const IconAlignLeft = (p: IconProps): JSX.Element => <Svg {...p}><path d="M15 12H3M17 18H3M21 6H3" /></Svg>;
export const IconAlignCenter = (p: IconProps): JSX.Element => <Svg {...p}><path d="M17 12H7M19 18H5M21 6H3" /></Svg>;
export const IconAlignRight = (p: IconProps): JSX.Element => <Svg {...p}><path d="M21 12H9M21 18H7M21 6H3" /></Svg>;
