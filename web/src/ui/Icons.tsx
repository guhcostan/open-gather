import type { ReactNode } from "react";

const I = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const MicIcon = () => (
  <I>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </I>
);
export const MicOffIcon = () => (
  <I>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18" />
  </I>
);
export const CamIcon = () => (
  <I>
    <rect x="3" y="7" width="13" height="10" rx="2" />
    <path d="M16 10l5-3v10l-5-3z" />
  </I>
);
export const CamOffIcon = () => (
  <I>
    <rect x="3" y="7" width="13" height="10" rx="2" />
    <path d="M16 10l5-3v10l-5-3zM3 3l18 18" />
  </I>
);
export const ScreenIcon = () => (
  <I>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 13V8M9.5 10.5L12 8l2.5 2.5" />
  </I>
);
export const LeaveIcon = () => (
  <I>
    <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9" />
  </I>
);
export const UsersIcon = () => (
  <I>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M16 14a5 5 0 0 1 6 5" />
  </I>
);
export const ChatIcon = () => (
  <I>
    <path d="M4 5h16v11H9l-5 4z" />
  </I>
);
export const GearIcon = () => (
  <I>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </I>
);
export const PinIcon = () => (
  <I size={16}>
    <circle cx="12" cy="12" r="6" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </I>
);
export const SendIcon = () => (
  <I size={16}>
    <path d="M4 12l16-8-6 16-2-7z" />
  </I>
);
