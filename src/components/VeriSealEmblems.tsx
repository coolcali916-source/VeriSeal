import React from 'react';

export const VeriSealBrandIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M16 2.5L27 6.8V15.4C27 22.1 22.3 27.6 16 29.5C9.7 27.6 5 22.1 5 15.4V6.8L16 2.5Z"
      fill="#0F172A"
    />
    <path
      d="M16 5.4L24.2 8.6V15.3C24.2 20.5 20.7 24.9 16 26.5C11.3 24.9 7.8 20.5 7.8 15.3V8.6L16 5.4Z"
      stroke="#93C5FD"
      strokeWidth="1.2"
    />
    <path
      d="M11.6 15.6L14.5 18.6L20.7 12.2"
      stroke="#FFFFFF"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const VeriSealCertifiedLogo: React.FC<{
  compact?: boolean;
}> = ({ compact = false }) => {
  if (compact) {
    return (
      <div
        className="inline-flex items-center gap-2 px-2.5 py-1.5 border border-slate-300 bg-white rounded-sm select-none"
        aria-label="VeriSeal Certified"
      >
        <VeriSealBrandIcon size={20} />
        <div className="leading-none">
          <div className="font-display text-[11px] font-bold tracking-wider text-slate-900 uppercase">
            VeriSeal
          </div>
          <div className="font-mono text-[9px] font-semibold tracking-widest text-blue-900 uppercase mt-0.5">
            Certified
          </div>
        </div>
      </div>
    );
  }

  return (
    <svg
      width="206"
      height="56"
      viewBox="0 0 206 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="VeriSeal Certified Official Logo"
    >
      <rect
        x="1"
        y="1"
        width="204"
        height="54"
        rx="4"
        fill="#FFFFFF"
        stroke="#1E3A5F"
        strokeWidth="1.5"
      />
      <rect
        x="4.5"
        y="4.5"
        width="197"
        height="47"
        rx="2"
        stroke="#CBD5E1"
        strokeWidth="0.75"
      />
      <path
        d="M28 11L42 16.4V27.2C42 35.5 36 42.4 28 45C20 42.4 14 35.5 14 27.2V16.4L28 11Z"
        fill="#1E3A5F"
      />
      <path
        d="M28 14.5L38.5 18.6V27C38.5 33.6 33.9 39.2 28 41.3C22.1 39.2 17.5 33.6 17.5 27V18.6L28 14.5Z"
        stroke="#BFDBFE"
        strokeWidth="1"
      />
      <path
        d="M22.5 27.4L26.2 31.1L34 23"
        stroke="#FFFFFF"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="53"
        y="25"
        fill="#0F172A"
        fontSize="14.5"
        fontWeight="700"
        letterSpacing="0.6"
        fontFamily="Plus Jakarta Sans, sans-serif"
      >
        VERISEAL
      </text>
      <text
        x="53"
        y="39.5"
        fill="#1E3A5F"
        fontSize="9.5"
        fontWeight="700"
        letterSpacing="2.2"
        fontFamily="JetBrains Mono, monospace"
      >
        CERTIFIED
      </text>
      <line
        x1="138"
        y1="14"
        x2="138"
        y2="42"
        stroke="#E2E8F0"
        strokeWidth="1"
      />
      <circle
        cx="168"
        cy="28"
        r="14"
        stroke="#1E3A5F"
        strokeWidth="1.2"
        strokeDasharray="2 1.5"
      />
      <circle cx="168" cy="28" r="9.5" stroke="#1E3A5F" strokeWidth="1" />
      <text
        x="168"
        y="30.5"
        textAnchor="middle"
        fill="#1E3A5F"
        fontSize="6.5"
        fontWeight="700"
        fontFamily="JetBrains Mono, monospace"
      >
        ECDSA
      </text>
    </svg>
  );
};

export const VeriSealNotarizedMark: React.FC<{
  certificateCode?: string;
}> = ({ certificateCode }) => (
  <svg
    width="172"
    height="52"
    viewBox="0 0 172 52"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Notarized Official Mark"
  >
    <rect
      x="1.5"
      y="1.5"
      width="169"
      height="49"
      rx="3"
      fill="#F8FAFC"
      stroke="#15803D"
      strokeWidth="1.8"
    />
    <rect
      x="5"
      y="5"
      width="162"
      height="42"
      rx="1.5"
      stroke="#86EFAC"
      strokeWidth="1"
    />
    <text
      x="86"
      y="23"
      textAnchor="middle"
      fill="#15803D"
      fontSize="13.5"
      fontWeight="700"
      letterSpacing="2.6"
      fontFamily="Plus Jakarta Sans, sans-serif"
    >
      NOTARIZED
    </text>
    <text
      x="86"
      y="37"
      textAnchor="middle"
      fill="#0F172A"
      fontSize="8.5"
      fontWeight="600"
      letterSpacing="0.8"
      fontFamily="JetBrains Mono, monospace"
    >
      {certificateCode || 'VERISEAL RECORD'}
    </text>
  </svg>
);
