import React from 'react';

interface NotarySealSvgProps {
  notaryName: string;
  commissionNumber: string;
  jurisdiction: string;
  expires: string;
  certificateCode?: string;
  customStampDataUrl?: string;
  size?: number;
}

export const NotarySealSvg: React.FC<NotarySealSvgProps> = ({
  notaryName,
  commissionNumber,
  jurisdiction,
  expires,
  certificateCode,
  customStampDataUrl,
  size = 164,
}) => {
  if (customStampDataUrl) {
    return (
      <div className="inline-flex flex-col items-center gap-1.5 select-none">
        <div
          className="relative flex items-center justify-center"
          style={{ width: size, height: size }}
        >
          <img
            src={customStampDataUrl}
            alt={`Official transparent notary stamp for ${notaryName}`}
            draggable={false}
            referrerPolicy="no-referrer"
            className="max-w-full max-h-full object-contain pointer-events-none select-none"
          />
        </div>
        {certificateCode && (
          <span className="font-mono text-[10px] text-slate-600 tracking-tight tabular-nums">
            {certificateCode} · Comm. #{commissionNumber}
          </span>
        )}
      </div>
    );
  }

  const cleanName = (notaryName || 'ELENA VANCE').toUpperCase().slice(0, 26);
  const cleanJurisdiction = (jurisdiction || 'STATE OF CALIFORNIA')
    .toUpperCase()
    .slice(0, 26);
  const cleanComm = (commissionNumber || 'CA-2491804').toUpperCase();
  const cleanExp = (expires || '2028-09-30').toUpperCase();

  return (
    <div className="inline-flex flex-col items-center gap-1 select-none">
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={`Electronic Notary Seal for ${cleanName}, Commission ${cleanComm}`}
        className="pointer-events-none select-none"
      >
        <defs>
          <path
            id="sealTopArc"
            d="M 28,100 A 72,72 0 1,1 172,100"
          />
          <path
            id="sealBottomArc"
            d="M 176,100 A 76,76 0 1,1 24,100"
          />
        </defs>

        <circle
          cx="100"
          cy="100"
          r="92"
          stroke="#1E3A5F"
          strokeWidth="3.5"
          fill="transparent"
        />
        <circle
          cx="100"
          cy="100"
          r="86"
          stroke="#1E3A5F"
          strokeWidth="1"
          strokeDasharray="3 2"
          fill="transparent"
        />
        <circle
          cx="100"
          cy="100"
          r="58"
          stroke="#1E3A5F"
          strokeWidth="1.5"
          fill="transparent"
        />

        <text
          fill="#1E3A5F"
          fontSize="10.5"
          fontWeight="700"
          letterSpacing="1.8"
          fontFamily="Plus Jakarta Sans, sans-serif"
        >
          <textPath href="#sealTopArc" startOffset="50%" textAnchor="middle">
            NOTARY PUBLIC · {cleanJurisdiction}
          </textPath>
        </text>

        <text
          fill="#1E3A5F"
          fontSize="9.5"
          fontWeight="600"
          letterSpacing="1.4"
          fontFamily="JetBrains Mono, monospace"
        >
          <textPath href="#sealBottomArc" startOffset="50%" textAnchor="middle">
            COMM #{cleanComm} · EXP {cleanExp}
          </textPath>
        </text>

        <line
          x1="54"
          y1="82"
          x2="146"
          y2="82"
          stroke="#1E3A5F"
          strokeWidth="0.9"
          opacity="0.55"
        />
        <text
          x="100"
          y="75"
          textAnchor="middle"
          fill="#1E3A5F"
          fontSize="8.5"
          fontWeight="700"
          letterSpacing="1.5"
          fontFamily="JetBrains Mono, monospace"
        >
          ELECTRONIC SEAL
        </text>
        <text
          x="100"
          y="102"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="11.5"
          fontWeight="700"
          fontFamily="Plus Jakarta Sans, sans-serif"
        >
          {cleanName}
        </text>
        <text
          x="100"
          y="119"
          textAnchor="middle"
          fill="#1E3A5F"
          fontSize="8"
          fontWeight="600"
          letterSpacing="1"
          fontFamily="JetBrains Mono, monospace"
        >
          {certificateCode || 'VERISEAL VERIFIED'}
        </text>
        <line
          x1="54"
          y1="127"
          x2="146"
          y2="127"
          stroke="#1E3A5F"
          strokeWidth="0.9"
          opacity="0.55"
        />
      </svg>
    </div>
  );
};
