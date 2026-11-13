import React, { useState } from 'react';
import { BookOpen, Download, Search } from 'lucide-react';
import type { JournalEntry } from '../types/notary';

interface JournalViewProps {
  entries: JournalEntry[];
  onVerifyCertificate: (certificateCode: string) => void;
  onOpenCase: (caseId: string) => void;
}

export const JournalView: React.FC<JournalViewProps> = ({
  entries,
  onVerifyCertificate,
  onOpenCase,
}) => {
  const [search, setSearch] = useState('');

  const filtered = entries.filter((entry) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      entry.entryNumber.toLowerCase().includes(q) ||
      entry.documentTitle.toLowerCase().includes(q) ||
      entry.signerName.toLowerCase().includes(q) ||
      entry.certificateCode.toLowerCase().includes(q)
    );
  });

  const totalFeesCents = entries.reduce((sum, e) => sum + e.feeCents, 0);

  const handleExportCsv = () => {
    const header = [
      'Entry Number',
      'Timestamp (UTC)',
      'Certificate Code',
      'Document Title',
      'File Name',
      'Act Type',
      'Mode',
      'Venue / Session',
      'Principal Signer',
      'ID Method',
      'Fee (USD)',
      'Sealed SHA-256',
    ];
    const rows = filtered.map((e) => [
      e.entryNumber,
      e.timestampIso,
      e.certificateCode,
      `"${e.documentTitle.replace(/"/g, '""')}"`,
      `"${e.fileName.replace(/"/g, '""')}"`,
      e.actType,
      e.notarizationMode === 'in_person' ? 'In-Person' : 'Online RON',
      `"${(e.meetingLocation || '').replace(/"/g, '""')}"`,
      `"${e.signerName.replace(/"/g, '""')}"`,
      `"${e.idMethod.replace(/"/g, '""')}"`,
      (e.feeCents / 100).toFixed(2),
      e.sealedHash,
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veriseal-notary-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="border border-slate-200 bg-white rounded-lg px-5 py-4">
          <div className="text-xs font-medium text-slate-500">
            Recorded Journal Entries
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
            {entries.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Immutable statutory ledger
          </div>
        </div>
        <div className="border border-slate-200 bg-white rounded-lg px-5 py-4">
          <div className="text-xs font-medium text-slate-500">
            Statutory Notarial Fees
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
            ${(totalFeesCents / 100).toFixed(2)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Cumulative recorded acts
          </div>
        </div>
        <div className="border border-slate-200 bg-white rounded-lg px-5 py-4">
          <div className="text-xs font-medium text-slate-500">
            Cryptographic Standard
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 font-mono">
            ECDSA-P256
          </div>
          <div className="mt-1 text-xs text-slate-500">
            SHA-256 + ISO-8601 timestamping
          </div>
        </div>
      </div>

      <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by entry #, signer, certificate..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
            />
          </div>
          <button
            type="button"
            disabled={filtered.length === 0}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Journal CSV
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <BookOpen className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-slate-900">
              No Electronic Journal Entries Yet
            </h3>
            <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
              Completed notarizations automatically append an immutable statutory entry here with timestamp and sealed hash.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Entry #</th>
                  <th className="py-3 px-3">Timestamp (UTC)</th>
                  <th className="py-3 px-3">Document</th>
                  <th className="py-3 px-3">Act &amp; Signer</th>
                  <th className="py-3 px-3">Certificate</th>
                  <th className="py-3 px-3 text-right">Fee</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/80">
                    <td className="py-3.5 px-4 font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {entry.entryNumber}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {new Date(entry.timestampIso).toISOString().replace('T', ' ').slice(0, 19)}Z
                    </td>
                    <td className="py-3.5 px-3 max-w-[230px]">
                      <div className="text-xs font-medium text-slate-900 truncate">
                        {entry.documentTitle}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {entry.fileName}
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="text-xs font-medium text-slate-800">
                        {entry.signerName}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {entry.actType} ·{' '}
                        {entry.notarizationMode === 'in_person'
                          ? `In-Person (${entry.meetingLocation || 'Office'})`
                          : 'Online RON'}{' '}
                        · {entry.idMethod}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 font-mono text-xs text-blue-800 tabular-nums whitespace-nowrap">
                      {entry.certificateCode}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-xs text-slate-700 text-right tabular-nums whitespace-nowrap">
                      ${(entry.feeCents / 100).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenCase(entry.caseId)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                        >
                          Record
                        </button>
                        <button
                          type="button"
                          onClick={() => onVerifyCertificate(entry.certificateCode)}
                          className="px-2.5 py-1 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 cursor-pointer"
                        >
                          Verify
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
