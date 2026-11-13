import React, { useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  Search,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { sha256Hex, verifyNotarizationSignature } from '../lib/crypto';
import { formatFileSize } from '../lib/documentParser';
import type { VerificationRecord } from '../types/notary';

interface VerifyPortalViewProps {
  initialCode?: string;
  localVerifications: Record<string, VerificationRecord>;
}

export const VerifyPortalView: React.FC<VerifyPortalViewProps> = ({
  initialCode = '',
  localVerifications,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [certCode, setCertCode] = useState(initialCode);
  const [record, setRecord] = useState<VerificationRecord | null>(null);
  const [signatureValid, setSignatureValid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');

  // File / Text Tamper Comparison
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [computedFileHash, setComputedFileHash] = useState('');
  const [pastedText, setPastedText] = useState('');

  const runLookup = async (codeToCheck: string) => {
    const cleaned = codeToCheck.trim().toUpperCase();
    if (!cleaned) return;
    setLoading(true);
    setLookupError('');
    setRecord(null);
    setSignatureValid(null);

    try {
      let found: VerificationRecord | null = localVerifications[cleaned] || null;
      if (!found) {
        const snap = await getDoc(doc(db, 'verifications', cleaned));
        if (snap.exists()) {
          const data = snap.data();
          found = {
            certificateCode: String(data.certificateCode),
            ownerId: String(data.ownerId),
            caseId: String(data.caseId),
            documentTitle: String(data.documentTitle),
            fileName: String(data.fileName),
            fileSize: Number(data.fileSize),
            actType: data.actType,
            notarizationMode: data.notarizationMode === 'in_person' ? 'in_person' : 'online',
            meetingLocation: String(data.meetingLocation || ''),
            documentHash: String(data.documentHash),
            sealedHash: String(data.sealedHash),
            signatureAlgorithm: String(data.signatureAlgorithm),
            publicKeyJwk: String(data.publicKeyJwk),
            digitalSignature: String(data.digitalSignature),
            signedPayload: String(data.signedPayload),
            timestampIso: String(data.timestampIso),
            notaryName: String(data.notaryName),
            notaryCommission: String(data.notaryCommission),
            notaryJurisdiction: String(data.notaryJurisdiction),
            notaryExpires: String(data.notaryExpires),
            notarizedAtIso: data.timestampIso
              ? String(data.timestampIso)
              : new Date().toISOString(),
          };
        }
      }

      if (!found) {
        setLookupError(
          `No notarization certificate found for "${cleaned}". Verify the code and try again.`
        );
        return;
      }

      setRecord(found);
      const isValid = await verifyNotarizationSignature(
        found.signedPayload,
        found.digitalSignature,
        found.publicKeyJwk
      );
      setSignatureValid(isValid);
    } catch (err) {
      setLookupError(
        err instanceof Error
          ? err.message
          : 'Unable to verify certificate at this time.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialCode) {
      setCertCode(initialCode);
      void runLookup(initialCode);
    }
  }, [initialCode]);

  const handleFileCompare = async (file: File | undefined) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const hex = await sha256Hex(buf);
    setUploadedFileName(`${file.name} (${formatFileSize(file.size)})`);
    setComputedFileHash(hex);
  };

  const handleTextCompare = async (text: string) => {
    setPastedText(text);
    if (!text) {
      setComputedFileHash('');
      setUploadedFileName('');
      return;
    }
    const hex = await sha256Hex(text);
    setUploadedFileName('Pasted Text Input');
    setComputedFileHash(hex);
  };

  const hashMatches =
    Boolean(record && computedFileHash) &&
    computedFileHash === record?.documentHash;

  const availableCodes = Object.keys(localVerifications);

  return (
    <div className="space-y-6">
      <div className="border border-slate-200 bg-white rounded-lg p-6">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold text-slate-900">
            Public Certificate &amp; Signature Verification Portal
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Independently verify a VeriSeal notarization using Web Crypto ECDSA P-256 signature verification and exact SHA-256 file integrity matching.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runLookup(certCode);
          }}
          className="mt-5 flex flex-col sm:flex-row gap-3 max-w-xl"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={certCode}
              onChange={(e) => setCertCode(e.target.value)}
              placeholder="Enter Certificate Code (e.g., VS-2026-A1B2C3D4)"
              className="w-full pl-9 pr-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !certCode.trim()}
            className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap cursor-pointer"
          >
            {loading ? 'Verifying...' : 'Verify Certificate'}
          </button>
        </form>

        {availableCodes.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Recent certificates:</span>
            {availableCodes.slice(0, 4).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  setCertCode(code);
                  void runLookup(code);
                }}
                className="font-mono text-blue-800 hover:underline cursor-pointer"
              >
                {code}
              </button>
            ))}
          </div>
        )}

        {lookupError && (
          <div className="mt-4 px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">
            {lookupError}
          </div>
        )}
      </div>

      {record && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 border border-slate-200 bg-white rounded-lg p-6 space-y-5">
            <div
              className={`p-4 rounded-md border flex items-start gap-3 ${
                signatureValid
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              {signatureValid ? (
                <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="text-sm font-semibold">
                  {signatureValid
                    ? 'ECDSA Digital Signature & Timestamp Cryptographically Valid'
                    : 'Cryptographic Signature Verification Failed'}
                </div>
                <p className="mt-0.5 text-xs opacity-90">
                  {signatureValid
                    ? 'The notary commission public key mathematically verified the canonical signed payload and ISO-8601 timestamp.'
                    : 'The stored signature does not match the public key and payload.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-slate-500">Document Title</div>
                <div className="mt-0.5 font-semibold text-slate-900">
                  {record.documentTitle}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Original File</div>
                <div className="mt-0.5 font-medium text-slate-900 tabular-nums">
                  {record.fileName} · {formatFileSize(record.fileSize)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Notarial Act &amp; Mode</div>
                <div className="mt-0.5 font-medium text-slate-900">
                  {record.actType} ·{' '}
                  {record.notarizationMode === 'in_person'
                    ? `In-Person (${record.meetingLocation || 'Physical Presence'})`
                    : 'Remote Online (RON)'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Notarized Timestamp (UTC)</div>
                <div className="mt-0.5 font-mono text-slate-900 tabular-nums">
                  {record.timestampIso}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Commissioned Notary</div>
                <div className="mt-0.5 font-medium text-slate-900">
                  {record.notaryName} ({record.notaryJurisdiction})
                </div>
              </div>
              <div>
                <div className="text-slate-500">Commission # / Expiration</div>
                <div className="mt-0.5 font-mono text-slate-900 tabular-nums">
                  {record.notaryCommission} · Exp {record.notaryExpires}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 space-y-2 text-xs">
              <div>
                <span className="text-slate-500 block">
                  Recorded Document SHA-256 Digest
                </span>
                <code className="font-mono text-[11px] text-slate-800 break-all">
                  {record.documentHash}
                </code>
              </div>
              <div>
                <span className="text-slate-500 block">
                  Sealed Notarization SHA-256 Digest ({record.signatureAlgorithm})
                </span>
                <code className="font-mono text-[11px] text-slate-800 break-all">
                  {record.sealedHash}
                </code>
              </div>
              <div>
                <span className="text-slate-500 block">
                  ECDSA Digital Signature (Base64)
                </span>
                <code className="font-mono text-[11px] text-slate-600 break-all">
                  {record.digitalSignature}
                </code>
              </div>
            </div>
          </div>

          {/* Independent File Tamper-Detection Check */}
          <div className="lg:col-span-5 border border-slate-200 bg-white rounded-lg p-6 space-y-4">
            <div className="flex items-center gap-2">
              <FileSearch className="w-4 h-4 text-blue-800" />
              <h3 className="text-sm font-semibold text-slate-900">
                Tamper-Evident File Comparison
              </h3>
            </div>
            <p className="text-xs text-slate-600">
              Upload your copy of the document file (PDF, DOCX, TXT, Image) or paste its text to verify that not a single byte has changed since notarization.
            </p>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold text-slate-800 bg-slate-50 border border-dashed border-slate-300 rounded-md hover:bg-slate-100 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Upload Document Copy to Compare SHA-256
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => void handleFileCompare(e.target.files?.[0])}
            />

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Or Paste Text Content
              </label>
              <textarea
                rows={4}
                value={pastedText}
                onChange={(e) => void handleTextCompare(e.target.value)}
                placeholder="Paste document text to compute SHA-256..."
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
              />
            </div>

            {computedFileHash && (
              <div
                className={`p-3.5 rounded-md border text-xs space-y-1.5 ${
                  hashMatches
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  {hashMatches ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      Exact Byte-for-Byte Match (Untampered)
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-red-700" />
                      SHA-256 Mismatch — Document Modified or Different File
                    </>
                  )}
                </div>
                <div className="text-[11px] opacity-85">{uploadedFileName}</div>
                <code className="block font-mono text-[11px] break-all">
                  {computedFileHash}
                </code>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
