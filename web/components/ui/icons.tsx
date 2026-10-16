// Small original line-icon set (24px grid, 1.75 stroke). Decorative by default.
import type { SVGProps } from "react";
type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20, rest: SVGProps<SVGSVGElement>) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false, ...rest,
});
const mk = (d: React.ReactNode) => function Icon({ size, ...rest }: P) { return <svg {...base(size, rest)}>{d}</svg>; };

export const IconCheck = mk(<path d="M5 12.5l4.2 4.2L19 7" />);
export const IconX = mk(<path d="M6 6l12 12M18 6L6 18" />);
export const IconPlus = mk(<path d="M12 5v14M5 12h14" />);
export const IconMinus = mk(<path d="M5 12h14" />);
export const IconArrowRight = mk(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconArrowLeft = mk(<path d="M19 12H5M11 6l-6 6 6 6" />);
export const IconChevronDown = mk(<path d="M6 9l6 6 6-6" />);
export const IconCopy = mk(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></>);
export const IconDownload = mk(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />);
export const IconUpload = mk(<path d="M12 20V9M7 14l5-5 5 5M5 4h14" />);
export const IconSearch = mk(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>);
export const IconUsers = mk(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><path d="M16 4.5a3.5 3.5 0 010 7M18 14.5a6.5 6.5 0 013.5 5.5" /></>);
export const IconCalendar = mk(<><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>);
export const IconMap = mk(<><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>);
export const IconClock = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const IconMusic = mk(<><path d="M9 18V5.5l11-2V16" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>);
export const IconMusicOff = mk(<><path d="M9 18V9M9 5.5l11-2V16" /><circle cx="6.5" cy="18" r="2.5" /><path d="M3 3l18 18" /></>);
export const IconGift = mk(<><rect x="3.5" y="8.5" width="17" height="4" rx="1" /><path d="M5 12.5V20h14v-7.5M12 8.5V20M12 8.5S10.5 4 8 4.5 7 8.5 12 8.5zM12 8.5s1.5-4.5 4-4 1 4-4 4z" /></>);
export const IconShirt = mk(<path d="M8 3.5L3.5 6.5l2 4 2-1V20h9V9.5l2 1 2-4L16 3.5a4 4 0 01-8 0z" />);
export const IconBed = mk(<><path d="M3 18V7M3 14h18v4M21 14v-2.5A3.5 3.5 0 0017.5 8H11v6" /><circle cx="7" cy="11" r="1.8" /></>);
export const IconHelp = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.3a2.5 2.5 0 014.8.9c0 1.7-2.4 2.2-2.4 3.8M12 17h.01" /></>);
export const IconHeart = mk(<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7.3 4.3 4.3 0 0119.5 10c0 5.4-7.5 10-7.5 10z" />);
export const IconSparkle = mk(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />);
export const IconShare = mk(<><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" /></>);
export const IconQr = mk(<><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" /></>);
export const IconLink = mk(<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>);
export const IconEdit = mk(<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />);
export const IconTrash = mk(<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />);
export const IconRestore = mk(<><path d="M4 12a8 8 0 108-8 8 8 0 00-6.3 3" /><path d="M4 4v4h4" /></>);
export const IconEye = mk(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconHome = mk(<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />);
export const IconLayout = mk(<><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /><path d="M3.5 9h17M9 9v11.5" /></>);
export const IconTable = mk(<><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="3.8" r="1.4" /><circle cx="12" cy="20.2" r="1.4" /><circle cx="3.8" cy="12" r="1.4" /><circle cx="20.2" cy="12" r="1.4" /></>);
export const IconInbox = mk(<path d="M3.5 13l2.5-8h12l2.5 8v6h-17zM3.5 13H9l1 2h4l1-2h5.5" />);
export const IconSettings = mk(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>);
export const IconLogout = mk(<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />);
export const IconMenu = mk(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconGrip = mk(<><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>);
export const IconRefresh = mk(<><path d="M20 11a8 8 0 00-14.3-4.3L4 8.5" /><path d="M4 4v4.5h4.5M4 13a8 8 0 0014.3 4.3L20 15.5" /><path d="M20 20v-4.5h-4.5" /></>);
export const IconWand = mk(<><path d="M4 20L15 9M13 7l4 4" /><path d="M18 3v3M16.5 4.5h3M20 8v2M19 9h2" /></>);
export const IconMail = mk(<><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" /></>);
export const IconPhone = mk(<path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 006.5 6.5L16 14l4 1.5V19a1.5 1.5 0 01-1.6 1.5A16 16 0 013.5 5.6 1.5 1.5 0 015 4z" />);
export const IconLock = mk(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 018 0v2.5" /></>);
export const IconAlert = mk(<><path d="M12 3.5L2.5 20h19z" /><path d="M12 10v4.5M12 17.5h.01" /></>);
export const IconLantern = mk(<><path d="M9.5 4.5a2.5 2.5 0 015 0" /><rect x="7.5" y="6" width="9" height="2" rx="1" /><rect x="7" y="8" width="10" height="11" rx="4.5" /><circle cx="12" cy="13.5" r="2" /></>);
export const IconEyeOff = mk(<><path d="M3 3l18 18" /><path d="M10.6 6.1A9.6 9.6 0 0112 6c6 0 9.5 6 9.5 6a16 16 0 01-3 3.6M6.6 6.6A16.4 16.4 0 002.5 12S6 18.5 12 18.5a9 9 0 004.3-1.1" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></>);

/* additions for the Lanternly design system (drawn on the same 24px / 1.75 grid) */
export const IconNote = mk(<><circle cx="8" cy="18" r="3" /><path d="M11 18V4l7 3" /></>);
export const IconExternal = mk(<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />);
export const IconSend = mk(<path d="M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z" />);
export const IconCloudCheck = mk(<><path d="M7 18a4.5 4.5 0 01-.6-8.96A6 6 0 0118 10a4 4 0 01-1 7.9" /><path d="M9.5 15l2 2 4-4" /></>);
export const IconDots = mk(<><circle cx="5.5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" /></>);
export const IconBell = mk(<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15L6 16zM10 20.5a2.2 2.2 0 004 0" />);
export const IconTag = mk(<><path d="M3.5 12.5V4.5a1 1 0 011-1h8l8 8-9 9-8-8z" /><circle cx="8" cy="8" r="1.4" /></>);
export const IconUtensils = mk(<path d="M6 3v8a2 2 0 002 2v8M10 3v8a2 2 0 01-2 2M17 21V3c-2 1.5-3 4-3 7s1 3 3 3" />);
export const IconPrinter = mk(<><path d="M7 8V3.5h10V8M7 17H4.5V10a2 2 0 012-2h11a2 2 0 012 2v7H17" /><rect x="7" y="14" width="10" height="6.5" rx="1" /></>);
export const IconSmartphone = mk(<><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></>);
export const IconMonitor = mk(<><rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8.5 21h7M12 17v4" /></>);
export const IconSun = mk(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" /></>);
export const IconCloud = mk(<path d="M7 18a4.5 4.5 0 01-.6-8.96A6 6 0 0118 10a4 4 0 01-.5 8H7z" />);
