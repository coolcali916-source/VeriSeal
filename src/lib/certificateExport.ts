import type { CustodyEvent, NotarizationCase } from '../types/notary';
import { formatFileSize } from './documentParser';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function downloadSigningCertificateHtml(
  item: NotarizationCase,
  custodyEvents: CustodyEvent[],
  emblemOptions?: {
    includeCertifiedLogo?: boolean;
    includeNotarizedMark?: boolean;
  }
): void {
  const showCertifiedLogo =
    emblemOptions?.includeCertifiedLogo ?? item.includeCertifiedLogo ?? true;
  const showNotarizedMark =
    emblemOptions?.includeNotarizedMark ?? item.includeNotarizedMark ?? true;

  const isInPerson = item.notarizationMode === 'in_person';
  const modeLabel = isInPerson
    ? `In-Person Appearance (${item.meetingLocation || 'Notary Office'})`
    : 'Remote Online Notarization (Two-Way Audiovisual Communication)';

  const signerSigHtml =
    item.signatureType === 'drawn' && item.signerSignatureData
      ? `<img src="${item.signerSignatureData}" alt="Signer signature" style="max-height:64px;max-width:240px;object-fit:contain;" />`
      : `<div style="font-family:Georgia,serif;font-style:italic;font-size:24px;color:#0f172a;">${escapeHtml(
          item.signerSignatureData || item.signerName
        )}</div>`;

  const notarySealHtml = item.notaryStampDataUrl
    ? `<img src="${item.notaryStampDataUrl}" alt="Notary stamp" style="max-height:120px;max-width:140px;object-fit:contain;" />`
    : `<div style="display:inline-flex;align-items:center;justify-content:center;width:128px;height:128px;border:3px solid #1e3a5f;border-radius:999px;text-align:center;padding:10px;color:#1e3a5f;font-size:10px;font-weight:700;line-height:1.3;">
        NOTARY PUBLIC<br/>${escapeHtml(item.notaryJurisdiction)}<br/>${escapeHtml(
        item.notaryName
      )}<br/>COMM #${escapeHtml(item.notaryCommission)}<br/>EXP ${escapeHtml(
        item.notaryExpires
      )}
      </div>`;

  const certifiedLogoSvg = showCertifiedLogo
    ? `<svg width="206" height="56" viewBox="0 0 206 56" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="VeriSeal Certified Official Logo">
        <rect x="1" y="1" width="204" height="54" rx="4" fill="#FFFFFF" stroke="#1E3A5F" stroke-width="1.5"/>
        <rect x="4.5" y="4.5" width="197" height="47" rx="2" stroke="#CBD5E1" stroke-width="0.75"/>
        <path d="M28 11L42 16.4V27.2C42 35.5 36 42.4 28 45C20 42.4 14 35.5 14 27.2V16.4L28 11Z" fill="#1E3A5F"/>
        <path d="M28 14.5L38.5 18.6V27C38.5 33.6 33.9 39.2 28 41.3C22.1 39.2 17.5 33.6 17.5 27V18.6L28 14.5Z" stroke="#BFDBFE" stroke-width="1"/>
        <path d="M22.5 27.4L26.2 31.1L34 23" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="53" y="25" fill="#0F172A" font-size="14.5" font-weight="700" letter-spacing="0.6" font-family="sans-serif">VERISEAL</text>
        <text x="53" y="39.5" fill="#1E3A5F" font-size="9.5" font-weight="700" letter-spacing="2.2" font-family="monospace">CERTIFIED</text>
        <line x1="138" y1="14" x2="138" y2="42" stroke="#E2E8F0" stroke-width="1"/>
        <circle cx="168" cy="28" r="14" stroke="#1E3A5F" stroke-width="1.2" stroke-dasharray="2 1.5"/>
        <circle cx="168" cy="28" r="9.5" stroke="#1E3A5F" stroke-width="1"/>
        <text x="168" y="30.5" text-anchor="middle" fill="#1E3A5F" font-size="6.5" font-weight="700" font-family="monospace">ECDSA</text>
      </svg>`
    : '';

  const notarizedMarkSvg = showNotarizedMark
    ? `<svg width="172" height="52" viewBox="0 0 172 52" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Notarized Official Mark">
        <rect x="1.5" y="1.5" width="169" height="49" rx="3" fill="#F8FAFC" stroke="#15803D" stroke-width="1.8"/>
        <rect x="5" y="5" width="162" height="42" rx="1.5" stroke="#86EFAC" stroke-width="1"/>
        <text x="86" y="23" text-anchor="middle" fill="#15803D" font-size="13.5" font-weight="700" letter-spacing="2.6" font-family="sans-serif">NOTARIZED</text>
        <text x="86" y="37" text-anchor="middle" fill="#0F172A" font-size="8.5" font-weight="600" letter-spacing="0.8" font-family="monospace">${escapeHtml(
          item.certificateCode || 'VERISEAL RECORD'
        )}</text>
      </svg>`
    : '';

  const emblemsBarHtml =
    certifiedLogoSvg || notarizedMarkSvg
      ? `<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;margin-bottom:24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px;">
            ${certifiedLogoSvg}
            ${notarizedMarkSvg}
          </div>
          <div style="font-family:monospace;font-size:11px;color:#475569;">Official Emblems Attached</div>
        </div>`
      : '';

  const custodyRows = custodyEvents
    .map(
      (ev, idx) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${idx + 1}. ${escapeHtml(
        ev.step
      )}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${escapeHtml(
          ev.actor
        )}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${escapeHtml(
          ev.details
        )}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:11px;">${escapeHtml(
          ev.recordedAtIso
        )}</td>
      </tr>`
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>VeriSeal Signing Certificate — ${escapeHtml(item.certificateCode)}</title>
</head>
<body style="margin:0;padding:36px;background:#f8fafc;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:820px;margin:0 auto;background:#ffffff;border:1px solid #cbd5e1;padding:40px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:20px;margin-bottom:24px;">
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#1e3a5f;">VeriSeal Official Issuance</div>
        <h1 style="margin:6px 0 4px;font-size:24px;font-weight:700;">Certificate of Electronic Signing &amp; Notarial Act</h1>
        <div style="font-size:13px;color:#475569;">${escapeHtml(item.actType)} · ${escapeHtml(
    modeLabel
  )}</div>
      </div>
      <div style="text-align:right;font-family:monospace;">
        <div style="font-size:11px;color:#15803d;font-weight:700;">ISSUED &amp; SEALED</div>
        <div style="font-size:15px;font-weight:700;margin-top:2px;">${escapeHtml(
          item.certificateCode
        )}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(
          item.timestampIso
        )}</div>
      </div>
    </div>

    ${emblemsBarHtml}

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
      <tr>
        <td style="padding:8px 0;color:#64748b;width:210px;">Document Title</td>
        <td style="padding:8px 0;font-weight:600;">${escapeHtml(item.title)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#64748b;">Source File</td>
        <td style="padding:8px 0;">${escapeHtml(item.fileName)} (${escapeHtml(
    formatFileSize(item.fileSize)
  )})</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#64748b;">Principal Signer</td>
        <td style="padding:8px 0;">${escapeHtml(item.signerName)} (${escapeHtml(
    item.signerEmail
  )})</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#64748b;">Identity Verification</td>
        <td style="padding:8px 0;">${escapeHtml(item.idMethod)} · Score ${item.idScore}%</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#64748b;">Commissioned Notary</td>
        <td style="padding:8px 0;">${escapeHtml(item.notaryName)} · Comm #${escapeHtml(
    item.notaryCommission
  )} (${escapeHtml(item.notaryJurisdiction)}, Exp ${escapeHtml(
    item.notaryExpires
  )})</td>
      </tr>
    </table>

    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:24px 0;margin-bottom:24px;">
      <div style="flex:1;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;margin-bottom:8px;">Principal Signer Signature</div>
        <div style="min-height:68px;border-bottom:1px solid #94a3b8;display:flex;align-items:flex-end;padding-bottom:6px;">
          ${signerSigHtml}
        </div>
        <div style="font-size:12px;color:#475569;margin-top:6px;">Signed by ${escapeHtml(
          item.signerName
        )}</div>
      </div>
      <div style="text-align:right;">
        ${notarySealHtml}
      </div>
    </div>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:16px;margin-bottom:24px;font-family:monospace;font-size:11px;line-height:1.6;">
      <div style="font-weight:700;color:#0f172a;margin-bottom:6px;">CRYPTOGRAPHIC VERIFICATION PROOF</div>
      <div>Document SHA-256: ${escapeHtml(item.documentHash)}</div>
      <div>Sealed SHA-256:   ${escapeHtml(item.sealedHash)}</div>
      <div>Algorithm:        ${escapeHtml(item.signatureAlgorithm)}</div>
      <div>Timestamp (UTC):  ${escapeHtml(item.timestampIso)}</div>
      <div style="word-break:break-all;">Signature (B64):  ${escapeHtml(
        item.digitalSignature
      )}</div>
    </div>

    ${
      custodyRows
        ? `<div>
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#475569;margin-bottom:8px;">Chain of Custody Record</div>
            <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e2e8f0;">
              <thead>
                <tr style="background:#f1f5f9;text-align:left;">
                  <th style="padding:8px 10px;">Event</th>
                  <th style="padding:8px 10px;">Actor</th>
                  <th style="padding:8px 10px;">Details</th>
                  <th style="padding:8px 10px;">Timestamp</th>
                </tr>
              </thead>
              <tbody>${custodyRows}</tbody>
            </table>
          </div>`
        : ''
    }
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${item.certificateCode || item.id}-signing-certificate.html`;
  a.click();
  URL.revokeObjectURL(url);
}
