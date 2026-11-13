import React, { useEffect, useRef, useState } from 'react';
import {
  Award,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileCheck2,
  Fingerprint,
  Lock,
  Printer,
  ShieldCheck,
  Stamp,
  Video,
  VideoOff,
} from 'lucide-react';
import { downloadSigningCertificateHtml } from '../lib/certificateExport';
import {
  DEFAULT_DOCUMENT_PLACEMENT,
  type CustodyEvent,
  type DocumentPlacement,
  type NotarizationCase,
  type NotarizationMode,
  type SignatureType,
  type UserProfile,
} from '../types/notary';
import { KBA_QUESTIONS } from '../lib/templates';
import { formatFileSize } from '../lib/documentParser';
import { InteractiveDocumentCanvas } from './InteractiveDocumentCanvas';
import { NotarySealSvg } from './NotarySealSvg';
import {
  VeriSealCertifiedLogo,
  VeriSealNotarizedMark,
} from './VeriSealEmblems';
import notaryAvatar from '../assets/images/notary_avatar_elena_1794534757716.jpg';
import sampleIdCard from '../assets/images/sample_id_card_1794534759841.jpg';

interface SigningRoomViewProps {
  activeCase: NotarizationCase | null;
  custodyEvents: CustodyEvent[];
  previewObjectUrl?: string;
  userProfile: UserProfile;
  onChangeMode: (
    caseId: string,
    mode: NotarizationMode,
    meetingLocation: string
  ) => Promise<void>;
  onCompleteIdentity: (
    caseId: string,
    idMethod: string,
    idScore: number,
    meetingLocation: string
  ) => Promise<void>;
  onApplySignature: (
    caseId: string,
    signatureData: string,
    signatureType: SignatureType
  ) => Promise<void>;
  onNotarizeCase: (
    caseId: string,
    useCustomTransparentStamp: boolean,
    includeCertifiedLogo: boolean,
    includeNotarizedMark: boolean
  ) => Promise<void>;
  onToggleEmblems: (
    caseId: string,
    includeCertifiedLogo: boolean,
    includeNotarizedMark: boolean
  ) => Promise<void>;
  onUpdatePlacement: (
    caseId: string,
    placement: DocumentPlacement
  ) => Promise<void>;
  onNavigateVerify: (certificateCode: string) => void;
  onNavigateStampTool: () => void;
}

export const SigningRoomView: React.FC<SigningRoomViewProps> = ({
  activeCase,
  custodyEvents,
  previewObjectUrl,
  userProfile,
  onChangeMode,
  onCompleteIdentity,
  onApplySignature,
  onNotarizeCase,
  onToggleEmblems,
  onUpdatePlacement,
  onNavigateVerify,
  onNavigateStampTool,
}) => {
  const [canvasTab, setCanvasTab] = useState<
    'instrument' | 'certificate' | 'file' | 'custody'
  >('file');
  const [copiedCode, setCopiedCode] = useState(false);
  const [idMethod, setIdMethod] = useState('Government Photo ID + KBA');
  const [venueInput, setVenueInput] = useState('San Francisco County, CA');
  const [physicalIdChecked, setPhysicalIdChecked] = useState(true);
  const [physicalPresenceChecked, setPhysicalPresenceChecked] = useState(true);
  const [willingnessChecked, setWillingnessChecked] = useState(true);
  const [kbaAnswers, setKbaAnswers] = useState<Record<string, number>>({
    'kba-1': 2,
    'kba-2': 0,
    'kba-3': 1,
  });
  const [credentialAnalyzed, setCredentialAnalyzed] = useState(false);

  // Signature Pad State & Workflow Card Refs
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const step2Ref = useRef<HTMLDivElement | null>(null);
  const step3Ref = useRef<HTMLDivElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawnStroke, setHasDrawnStroke] = useState(false);
  const [sigMode, setSigMode] = useState<'drawn' | 'typed'>('drawn');
  const [typedSignature, setTypedSignature] = useState('');

  // Notary Seal Mode & Optional Official Emblems
  const [useCustomStamp, setUseCustomStamp] = useState<boolean>(
    Boolean(userProfile.customStampDataUrl)
  );
  const [includeCertifiedLogo, setIncludeCertifiedLogo] = useState<boolean>(
    activeCase?.includeCertifiedLogo ?? true
  );
  const [includeNotarizedMark, setIncludeNotarizedMark] = useState<boolean>(
    activeCase?.includeNotarizedMark ?? true
  );
  const [busyStep, setBusyStep] = useState<string>('');
  const [roomError, setRoomError] = useState<string>('');

  // Live Camera Preview (Optional WebRTC local check)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    setUseCustomStamp(Boolean(userProfile.customStampDataUrl));
  }, [userProfile.customStampDataUrl]);

  useEffect(() => {
    if (activeCase) {
      setTypedSignature(activeCase.signerName);
      setCredentialAnalyzed(activeCase.kbaPassed);
      setVenueInput(
        activeCase.meetingLocation ||
          (activeCase.notarizationMode === 'in_person'
            ? 'San Francisco County, CA'
            : 'Remote Audio-Video Session')
      );
      setIdMethod(
        activeCase.notarizationMode === 'in_person'
          ? 'Physical Government Photo ID'
          : 'Government Photo ID + KBA'
      );
      setIncludeCertifiedLogo(activeCase.includeCertifiedLogo ?? true);
      setIncludeNotarizedMark(activeCase.includeNotarizedMark ?? true);
      setRoomError('');
      if (activeCase.status === 'notarized') {
        setCanvasTab('certificate');
      } else {
        setCanvasTab('file');
      }
    }
  }, [
    activeCase?.id,
    activeCase?.status,
    activeCase?.kbaPassed,
    activeCase?.signerName,
    activeCase?.notarizationMode,
    activeCase?.meetingLocation,
    activeCase?.includeCertifiedLogo,
    activeCase?.includeNotarizedMark,
  ]);

  useEffect(() => {
    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  if (!activeCase) {
    return (
      <div className="border border-slate-200 bg-white rounded-lg p-12 text-center">
        <FileCheck2 className="w-9 h-9 text-slate-300 mx-auto mb-3" />
        <h2 className="text-base font-semibold text-slate-900">
          No Document Selected for Signing Room
        </h2>
        <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
          Select a notarization request from your Documents &amp; Folders queue to begin identity verification, electronic signature, and cryptographic timestamping.
        </p>
      </div>
    );
  }

  const toggleCamera = async () => {
    setCameraError('');
    if (cameraActive) {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
      setCameraActive(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch {
      setCameraError('Camera unavailable in this preview; studio attestation mode active.');
    }
  };

  // Signature Canvas Handlers
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.setPointerCapture(e.pointerId);
    const pt = getCanvasPoint(e);
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    setIsDrawing(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pt = getCanvasPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    setHasDrawnStroke(true);
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
  };

  const clearSignatureCanvas = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawnStroke(false);
  };

  const handleVerifyIdentitySubmit = async () => {
    setRoomError('');
    if (activeCase.notarizationMode === 'in_person') {
      if (!physicalIdChecked || !physicalPresenceChecked || !willingnessChecked) {
        setRoomError(
          'Confirm all three in-person physical presence and ID inspection checks.'
        );
        return;
      }
      if (!venueInput.trim()) {
        setRoomError('Enter the physical signing venue or county.');
        return;
      }
      setBusyStep('identity');
      try {
        await onCompleteIdentity(
          activeCase.id,
          idMethod,
          100,
          venueInput.trim()
        );
        setCredentialAnalyzed(true);
      } catch (err) {
        setRoomError(
          err instanceof Error ? err.message : 'Failed to record identity check.'
        );
      } finally {
        setBusyStep('');
      }
      return;
    }

    const correctCount = KBA_QUESTIONS.filter(
      (q) => kbaAnswers[q.id] === q.correctIndex
    ).length;
    if (correctCount < 2) {
      setRoomError(
        `KBA verification requires at least 2 of 3 correct answers (currently ${correctCount}/3).`
      );
      return;
    }
    setBusyStep('identity');
    try {
      const score = Math.round(70 + (correctCount / KBA_QUESTIONS.length) * 28);
      await onCompleteIdentity(
        activeCase.id,
        idMethod,
        score,
        'Remote Audio-Video Session'
      );
      setCredentialAnalyzed(true);
    } catch (err) {
      setRoomError(
        err instanceof Error ? err.message : 'Failed to record identity check.'
      );
    } finally {
      setBusyStep('');
    }
  };

  const handleApplySignatureSubmit = async () => {
    setRoomError('');
    let signatureData = '';
    if (sigMode === 'drawn') {
      if (!hasDrawnStroke || !sigCanvasRef.current) {
        setRoomError('Please draw your signature inside the signature pad.');
        return;
      }
      signatureData = sigCanvasRef.current.toDataURL('image/png');
    } else {
      if (!typedSignature.trim()) {
        setRoomError('Please enter your full legal signature text.');
        return;
      }
      signatureData = typedSignature.trim();
    }

    setBusyStep('sign');
    try {
      await onApplySignature(activeCase.id, signatureData, sigMode);
    } catch (err) {
      setRoomError(
        err instanceof Error ? err.message : 'Failed to apply electronic signature.'
      );
    } finally {
      setBusyStep('');
    }
  };

  const handleEmblemToggle = async (
    nextCertified: boolean,
    nextNotarized: boolean
  ) => {
    setIncludeCertifiedLogo(nextCertified);
    setIncludeNotarizedMark(nextNotarized);
    if (activeCase.status !== 'notarized') {
      try {
        await onToggleEmblems(activeCase.id, nextCertified, nextNotarized);
      } catch (err) {
        setRoomError(
          err instanceof Error ? err.message : 'Could not save emblem preference.'
        );
      }
    }
  };

  const handleSealAndTimestamp = async () => {
    setRoomError('');
    setBusyStep('notarize');
    try {
      await onNotarizeCase(
        activeCase.id,
        useCustomStamp && Boolean(userProfile.customStampDataUrl),
        includeCertifiedLogo,
        includeNotarizedMark
      );
      setCanvasTab('certificate');
    } catch (err) {
      setRoomError(
        err instanceof Error ? err.message : 'Failed to notarize and seal document.'
      );
    } finally {
      setBusyStep('');
    }
  };

  const handleCopyCertificateCode = async () => {
    if (!activeCase.certificateCode) return;
    try {
      await navigator.clipboard.writeText(activeCase.certificateCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Ignore clipboard permission failure
    }
  };

  const handleDownloadProofBundle = () => {
    const bundle = {
      platform: 'VeriSeal Remote Online Notarization',
      certificateCode: activeCase.certificateCode,
      documentTitle: activeCase.title,
      fileName: activeCase.fileName,
      fileSize: activeCase.fileSize,
      documentSha256: activeCase.documentHash,
      sealedSha256: activeCase.sealedHash,
      signatureAlgorithm: activeCase.signatureAlgorithm,
      timestampIso: activeCase.timestampIso,
      notary: {
        name: activeCase.notaryName,
        commission: activeCase.notaryCommission,
        jurisdiction: activeCase.notaryJurisdiction,
        expires: activeCase.notaryExpires,
      },
      signedPayload: activeCase.signedPayload,
      digitalSignatureBase64: activeCase.digitalSignature,
      publicKeyJwk: activeCase.publicKeyJwk
        ? JSON.parse(activeCase.publicKeyJwk)
        : null,
      custodyChain: custodyEvents,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeCase.certificateCode || activeCase.id}-proof-bundle.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isNotarized = activeCase.status === 'notarized';
  const effectiveStampUrl = isNotarized
    ? activeCase.notaryStampDataUrl
    : useCustomStamp
    ? userProfile.customStampDataUrl
    : '';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left/Center Document & Certificate Canvas */}
      <div className="xl:col-span-7 space-y-4">
        <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => setCanvasTab('file')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  canvasTab === 'file'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Document &amp; Placement
              </button>
              <button
                type="button"
                onClick={() => setCanvasTab('instrument')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  canvasTab === 'instrument'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Summary Sheet
              </button>
              <button
                type="button"
                onClick={() => setCanvasTab('certificate')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  canvasTab === 'certificate'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                Signing Certificate
              </button>
              <button
                type="button"
                onClick={() => setCanvasTab('custody')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  canvasTab === 'custody'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Custody ({custodyEvents.length})
              </button>
            </div>

            {isNotarized && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadSigningCertificateHtml(activeCase, custodyEvents, {
                      includeCertifiedLogo,
                      includeNotarizedMark,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-800 rounded hover:bg-blue-900 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Certificate
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={handleDownloadProofBundle}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Proof JSON
                </button>
              </div>
            )}
          </div>

          {canvasTab === 'instrument' && (
            <div className="p-8 bg-slate-100/70">
              <div className="print-only-sheet max-w-2xl mx-auto bg-white border border-slate-300 shadow-xs rounded-sm p-8 sm:p-10 space-y-6">
                <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-200">
                  <div>
                    <div className="text-xs font-mono text-slate-500 uppercase tracking-wider">
                      {activeCase.actType} · Electronic Notarial Record
                    </div>
                    <h2 className="mt-1 text-xl font-semibold text-slate-900">
                      {activeCase.title}
                    </h2>
                    <div className="mt-1 text-xs text-slate-500 tabular-nums">
                      {activeCase.fileName} · {formatFileSize(activeCase.fileSize)}
                    </div>
                  </div>
                  {isNotarized && (
                    <div className="text-right shrink-0">
                      <div className="text-xs font-semibold text-emerald-700">
                        VERIFIED SEALED
                      </div>
                      <div className="font-mono text-xs text-slate-700 tabular-nums">
                        {activeCase.certificateCode}
                      </div>
                    </div>
                  )}
                </div>

                {(includeCertifiedLogo || includeNotarizedMark) && (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      {includeCertifiedLogo && <VeriSealCertifiedLogo compact />}
                      {includeNotarizedMark && (
                        <div className={isNotarized ? '' : 'opacity-75'}>
                          <VeriSealNotarizedMark
                            certificateCode={
                              isNotarized
                                ? activeCase.certificateCode
                                : 'PENDING SEAL'
                            }
                          />
                        </div>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-slate-500">
                      {isNotarized ? 'Sealed Emblems' : 'Emblem Preview'}
                    </span>
                  </div>
                )}

                <div className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap font-serif bg-slate-50/70 border border-slate-200 rounded p-5 max-h-[380px] overflow-y-auto">
                  {activeCase.documentText}
                </div>

                {/* Signer Execution Block */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-200 items-end">
                  <div>
                    <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2">
                      Principal Signer Execution
                    </div>
                    <div className="h-20 border-b border-slate-400 flex items-end pb-2">
                      {activeCase.signatureType === 'drawn' &&
                      activeCase.signerSignatureData ? (
                        <img
                          src={activeCase.signerSignatureData}
                          alt={`Electronic signature of ${activeCase.signerName}`}
                          referrerPolicy="no-referrer"
                          className="max-h-16 w-auto object-contain"
                        />
                      ) : activeCase.signatureType === 'typed' &&
                        activeCase.signerSignatureData ? (
                        <span className="text-2xl italic font-serif text-slate-900">
                          {activeCase.signerSignatureData}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Awaiting signer electronic signature
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 text-xs text-slate-700 font-medium">
                      {activeCase.signerName} · {activeCase.signerEmail}
                    </div>
                  </div>

                  <div className="flex flex-col items-end justify-end">
                    {isNotarized ? (
                      <NotarySealSvg
                        notaryName={activeCase.notaryName}
                        commissionNumber={activeCase.notaryCommission}
                        jurisdiction={activeCase.notaryJurisdiction}
                        expires={activeCase.notaryExpires}
                        certificateCode={activeCase.certificateCode}
                        customStampDataUrl={effectiveStampUrl}
                        size={146}
                      />
                    ) : (
                      <div className="w-36 h-36 border border-dashed border-slate-300 rounded-full flex items-center justify-center text-center p-3">
                        <span className="text-[11px] text-slate-400">
                          Notary Electronic Seal &amp; Timestamp Pending
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Statutory Notarial Certificate & Cryptographic Proof Footer */}
                <div className="pt-4 border-t border-slate-200 text-xs text-slate-600 space-y-2">
                  <p className="leading-relaxed">
                    <strong>Notarial Certificate ({activeCase.actType}):</strong>{' '}
                    {activeCase.notarizationMode === 'in_person' ? (
                      <>
                        Subscribed, acknowledged, or affirmed personally before me in physical presence at{' '}
                        <span className="font-medium text-slate-800">
                          {activeCase.meetingLocation || venueInput || 'Notary Office'}
                        </span>
                      </>
                    ) : (
                      <>
                        Subscribed, acknowledged, or affirmed via two-way audiovisual communication before
                      </>
                    )}{' '}
                    {isNotarized
                      ? activeCase.notaryName
                      : userProfile.displayName || 'Elena Vance'}
                    , Commissioned Notary Public ({activeCase.notaryJurisdiction || userProfile.commissionJurisdiction}), identified via{' '}
                    {activeCase.idMethod}.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 font-mono text-[11px] text-slate-500 tabular-nums">
                    <div className="truncate">
                      Doc SHA-256: {activeCase.documentHash}
                    </div>
                    <div className="truncate">
                      Timestamp:{' '}
                      {activeCase.timestampIso || 'Pending notarization'}
                    </div>
                    {isNotarized && (
                      <>
                        <div className="truncate">
                          Algorithm: {activeCase.signatureAlgorithm}
                        </div>
                        <div className="truncate">
                          Sealed Hash: {activeCase.sealedHash}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {canvasTab === 'certificate' && (
            <div className="p-8 bg-slate-100/70">
              {!isNotarized ? (
                <div className="max-w-xl mx-auto bg-white border border-slate-200 rounded-md p-8 text-center space-y-4">
                  <Award className="w-9 h-9 text-slate-300 mx-auto" />
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      {activeCase.status === 'signed'
                        ? 'Signer Execution Complete — Ready to Issue Signing Certificate'
                        : 'Signing Certificate Pending Execution'}
                    </h3>
                    <p className="mt-1 text-xs text-slate-600 max-w-md mx-auto">
                      {activeCase.status === 'signed'
                        ? 'The principal signer has applied their electronic signature. Issue the official Signing Certificate now to bind the ECDSA P-256 signature, UTC timestamp, and notary seal.'
                        : 'Complete identity verification and electronic signing first, then issue the official Signing Certificate.'}
                    </p>
                  </div>
                  {activeCase.status === 'signed' && (
                    <button
                      type="button"
                      disabled={busyStep === 'notarize'}
                      onClick={() => void handleSealAndTimestamp()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-800 rounded-md hover:bg-blue-900 disabled:opacity-45 cursor-pointer"
                    >
                      <Award className="w-4 h-4" />
                      {busyStep === 'notarize'
                        ? 'Issuing Signing Certificate...'
                        : 'Issue Signing Certificate & Notary Seal'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="print-only-sheet max-w-2xl mx-auto bg-white border-2 border-slate-800 rounded-sm p-8 sm:p-10 space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b-2 border-slate-900">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-widest text-blue-900">
                        VeriSeal Official Issuance
                      </div>
                      <h2 className="mt-1 text-xl font-bold text-slate-900">
                        Certificate of Electronic Signing &amp; Notarial Act
                      </h2>
                      <div className="mt-1 text-xs text-slate-600">
                        {activeCase.actType} ·{' '}
                        {activeCase.notarizationMode === 'in_person'
                          ? `In-Person Appearance (${activeCase.meetingLocation})`
                          : 'Remote Online Notarization (RON)'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
                        Issued &amp; Validated
                      </div>
                      <div className="mt-0.5 flex items-center justify-end gap-1.5">
                        <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                          {activeCase.certificateCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyCertificateCode()}
                          title="Copy certificate code"
                          className="no-print p-1 text-slate-500 hover:text-slate-900 rounded cursor-pointer"
                        >
                          {copiedCode ? (
                            <Check className="w-3.5 h-3.5 text-emerald-700" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {activeCase.timestampIso}
                      </div>
                    </div>
                  </div>

                  {(includeCertifiedLogo || includeNotarizedMark) && (
                    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 bg-slate-50 border border-slate-200 rounded">
                      <div className="flex flex-wrap items-center gap-4">
                        {includeCertifiedLogo && <VeriSealCertifiedLogo />}
                        {includeNotarizedMark && (
                          <VeriSealNotarizedMark
                            certificateCode={activeCase.certificateCode}
                          />
                        )}
                      </div>
                      <span className="font-mono text-[11px] text-slate-500">
                        Official Emblems Attached
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-slate-500 block">
                        Certified Document
                      </span>
                      <span className="font-semibold text-slate-900">
                        {activeCase.title}
                      </span>
                      <span className="block text-[11px] text-slate-500 tabular-nums">
                        {activeCase.fileName} · {formatFileSize(activeCase.fileSize)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">
                        Principal Signer &amp; Verification
                      </span>
                      <span className="font-semibold text-slate-900">
                        {activeCase.signerName}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {activeCase.idMethod} ({activeCase.idScore}%)
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">
                        Commissioned Notary Public
                      </span>
                      <span className="font-semibold text-slate-900">
                        {activeCase.notaryName}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {activeCase.notaryJurisdiction}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">
                        Commission &amp; Expiration
                      </span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        #{activeCase.notaryCommission}
                      </span>
                      <span className="block font-mono text-[11px] text-slate-500 tabular-nums">
                        Expires {activeCase.notaryExpires}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-5 border-y border-slate-200 items-end">
                    <div>
                      <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2">
                        Verified Signer Signature
                      </div>
                      <div className="h-20 border-b border-slate-400 flex items-end pb-2">
                        {activeCase.signatureType === 'drawn' &&
                        activeCase.signerSignatureData ? (
                          <img
                            src={activeCase.signerSignatureData}
                            alt={`Signature of ${activeCase.signerName}`}
                            referrerPolicy="no-referrer"
                            className="max-h-16 w-auto object-contain"
                          />
                        ) : (
                          <span className="text-2xl italic font-serif text-slate-900">
                            {activeCase.signerSignatureData || activeCase.signerName}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 text-xs text-slate-600">
                        Executed by {activeCase.signerName}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <NotarySealSvg
                        notaryName={activeCase.notaryName}
                        commissionNumber={activeCase.notaryCommission}
                        jurisdiction={activeCase.notaryJurisdiction}
                        expires={activeCase.notaryExpires}
                        certificateCode={activeCase.certificateCode}
                        customStampDataUrl={effectiveStampUrl}
                        size={146}
                      />
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded p-4 font-mono text-[11px] text-slate-700 space-y-1 tabular-nums">
                    <div className="font-semibold text-slate-900 mb-1">
                      Cryptographic Attestation ({activeCase.signatureAlgorithm})
                    </div>
                    <div className="break-all">
                      Document SHA-256: {activeCase.documentHash}
                    </div>
                    <div className="break-all">
                      Sealed SHA-256: {activeCase.sealedHash}
                    </div>
                    <div className="break-all text-slate-500">
                      ECDSA Signature: {activeCase.digitalSignature}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {canvasTab === 'file' && (
            <InteractiveDocumentCanvas
              activeCase={activeCase}
              previewObjectUrl={previewObjectUrl}
              userProfile={userProfile}
              useCustomStamp={useCustomStamp}
              includeCertifiedLogo={includeCertifiedLogo}
              includeNotarizedMark={includeNotarizedMark}
              placement={activeCase.placement || DEFAULT_DOCUMENT_PLACEMENT}
              onChangePlacement={(next) =>
                void onUpdatePlacement(activeCase.id, next)
              }
              onJumpToSignStep={() =>
                step2Ref.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center',
                })
              }
              onJumpToSealStep={() =>
                step3Ref.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center',
                })
              }
            />
          )}

          {canvasTab === 'custody' && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Tamper-Evident Chain of Custody
                  </h3>
                  <p className="text-xs text-slate-500">
                    Each milestone is cryptographically chained to the previous event hash.
                  </p>
                </div>
              </div>
              {custodyEvents.length === 0 ? (
                <div className="text-xs text-slate-500 py-8 text-center border border-dashed border-slate-200 rounded">
                  Custody events will record automatically as this session progresses.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                  {custodyEvents.map((ev, index) => (
                    <div key={ev.id} className="p-4 flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-slate-900">
                          {index + 1}. {ev.step}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-600">
                          {ev.details}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Actor: {ev.actor}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {new Date(ev.recordedAtIso).toLocaleString()}
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums">
                          #{ev.eventHash.slice(0, 14)}…
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Compliance & Execution Rail */}
      <div className="xl:col-span-5 space-y-4 no-print">
        {roomError && (
          <div className="px-4 py-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
            {roomError}
          </div>
        )}

        {/* Session Mode & Attestation Panel */}
        <div className="border border-slate-200 bg-white rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {activeCase.notarizationMode === 'in_person'
                  ? 'In-Person Appearance Session'
                  : 'Remote Audio-Video Attestation'}
              </h3>
              <p className="text-xs text-slate-500">
                Notary: {userProfile.displayName || 'Elena Vance'} · Comm. #
                {userProfile.commissionNumber || 'CA-2491804'}
              </p>
            </div>
            {activeCase.status === 'draft' && (
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                <button
                  type="button"
                  onClick={() =>
                    void onChangeMode(
                      activeCase.id,
                      'online',
                      'Remote Audio-Video Session'
                    )
                  }
                  className={`px-2.5 py-1 text-[11px] font-medium rounded cursor-pointer ${
                    activeCase.notarizationMode === 'online'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Online
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void onChangeMode(
                      activeCase.id,
                      'in_person',
                      venueInput || 'San Francisco County, CA'
                    )
                  }
                  className={`px-2.5 py-1 text-[11px] font-medium rounded cursor-pointer ${
                    activeCase.notarizationMode === 'in_person'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  In-Person
                </button>
              </div>
            )}
          </div>

          {activeCase.notarizationMode === 'online' ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Live Two-Way A/V Feed
                </span>
                <button
                  type="button"
                  onClick={() => void toggleCamera()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer"
                >
                  {cameraActive ? (
                    <>
                      <VideoOff className="w-3.5 h-3.5" />
                      Stop Cam
                    </>
                  ) : (
                    <>
                      <Video className="w-3.5 h-3.5" />
                      Enable Cam
                    </>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="relative h-28 rounded-md overflow-hidden border border-slate-200 bg-slate-900">
                  <img
                    src={notaryAvatar}
                    alt="Commissioned Notary Public Elena Vance"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2.5 py-1.5 text-[11px] text-white font-medium">
                    Commissioned Notary
                  </div>
                </div>

                <div className="relative h-28 rounded-md overflow-hidden border border-slate-200 bg-slate-900 flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${
                      cameraActive ? 'block' : 'hidden'
                    }`}
                  />
                  {!cameraActive && (
                    <div className="text-center px-2">
                      <Camera className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                      <span className="text-[11px] text-slate-300 block">
                        {activeCase.signerName}
                      </span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2.5 py-1.5 text-[11px] text-white font-medium">
                    Principal Signer
                  </div>
                </div>
              </div>
              {cameraError && (
                <p className="text-[11px] text-slate-500">{cameraError}</p>
              )}
            </>
          ) : (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 space-y-1">
              <div className="font-medium text-slate-900">
                Physical Presence Mode (IPEN / Traditional)
              </div>
              <div className="text-slate-600">
                Venue: {activeCase.meetingLocation || venueInput}
              </div>
            </div>
          )}
        </div>

        {/* Step 1: Credential Analysis / Physical ID Inspection */}
        <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-blue-800" />
              <h3 className="text-sm font-semibold text-slate-900">
                {activeCase.notarizationMode === 'in_person'
                  ? '1. Physical Presence & ID Inspection'
                  : '1. Identity & Credential Verification'}
              </h3>
            </div>
            {activeCase.kbaPassed && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Verified ({activeCase.idScore}%)
              </span>
            )}
          </div>

          {activeCase.status === 'draft' ? (
            activeCase.notarizationMode === 'in_person' ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Signing Venue / County &amp; State
                  </label>
                  <input
                    type="text"
                    maxLength={160}
                    value={venueInput}
                    onChange={(e) => setVenueInput(e.target.value)}
                    placeholder="450 Mission St, San Francisco, CA"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Satisfactory Evidence Presented
                  </label>
                  <select
                    value={idMethod}
                    onChange={(e) => setIdMethod(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-md"
                  >
                    <option value="Physical Government Photo ID">
                      Physical Government Photo ID (Driver&apos;s License / State ID)
                    </option>
                    <option value="U.S. or Foreign Passport (In-Person)">
                      U.S. or Foreign Passport (In-Person)
                    </option>
                    <option value="Credible Identifying Witness">
                      Sworn Credible Identifying Witness
                    </option>
                    <option value="Personal Knowledge">
                      Notary Personal Knowledge
                    </option>
                  </select>
                </div>

                <div className="space-y-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={physicalPresenceChecked}
                      onChange={(e) => setPhysicalPresenceChecked(e.target.checked)}
                      className="mt-0.5 accent-slate-900"
                    />
                    <span>
                      Principal signer is physically present before the notary.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={physicalIdChecked}
                      onChange={(e) => setPhysicalIdChecked(e.target.checked)}
                      className="mt-0.5 accent-slate-900"
                    />
                    <span>
                      Original photo ID inspected; unexpired, intact, and matches signer likeness.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={willingnessChecked}
                      onChange={(e) => setWillingnessChecked(e.target.checked)}
                      className="mt-0.5 accent-slate-900"
                    />
                    <span>
                      Signer appears competent and executes this instrument willingly.
                    </span>
                  </label>
                </div>

                <button
                  type="button"
                  disabled={busyStep === 'identity'}
                  onClick={() => void handleVerifyIdentitySubmit()}
                  className="w-full py-2 px-4 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  {busyStep === 'identity'
                    ? 'Recording Appearance...'
                    : 'Confirm Physical Presence & ID'}
                </button>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center bg-slate-50 border border-slate-200 rounded-md p-3">
                  <img
                    src={sampleIdCard}
                    alt="Specimen government photo ID credential scan"
                    referrerPolicy="no-referrer"
                    className="w-full h-24 object-cover rounded border border-slate-200"
                  />
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-medium text-slate-600">
                      Verification Method
                    </label>
                    <select
                      value={idMethod}
                      onChange={(e) => setIdMethod(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    >
                      <option value="Government Photo ID + KBA">
                        Government Photo ID + KBA
                      </option>
                      <option value="Passport + Credential Analysis">
                        Passport + Credential Analysis
                      </option>
                      <option value="Personal Knowledge">Personal Knowledge</option>
                    </select>
                    <div className="text-[11px] text-emerald-700 font-medium">
                      {credentialAnalyzed
                        ? 'Optical security & barcode checks passed'
                        : '5-point hologram & MRZ check ready'}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-medium text-slate-700">
                    Knowledge-Based Authentication (KBA)
                  </div>
                  {KBA_QUESTIONS.map((q) => (
                    <div key={q.id} className="space-y-1">
                      <div className="text-xs text-slate-700">{q.prompt}</div>
                      <select
                        value={kbaAnswers[q.id]}
                        onChange={(e) =>
                          setKbaAnswers((prev) => ({
                            ...prev,
                            [q.id]: Number(e.target.value),
                          }))
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                      >
                        {q.options.map((opt, idx) => (
                          <option key={opt} value={idx}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={busyStep === 'identity'}
                  onClick={() => void handleVerifyIdentitySubmit()}
                  className="w-full py-2 px-4 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  {busyStep === 'identity'
                    ? 'Recording Verification...'
                    : 'Confirm Identity & Pass KBA'}
                </button>
              </>
            )
          ) : (
            <div className="text-xs text-slate-600">
              Method: {activeCase.idMethod} · Confidence Score:{' '}
              <span className="font-mono tabular-nums font-medium text-slate-900">
                {activeCase.idScore}%
              </span>
              {activeCase.notarizationMode === 'in_person' && (
                <span className="block mt-1">
                  Venue: {activeCase.meetingLocation}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Electronic Signature Pad */}
        <div
          ref={step2Ref}
          className="border border-slate-200 bg-white rounded-lg p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              2. Signer Electronic Signature
            </h3>
            {activeCase.signatureType !== 'none' && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Signed
              </span>
            )}
          </div>

          {activeCase.status === 'draft' ? (
            <p className="text-xs text-slate-500">
              Complete Step 1 (Identity Verification) to unlock electronic signing.
            </p>
          ) : activeCase.status === 'identity_verified' ||
            activeCase.status === 'signed' ? (
            <>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md">
                <button
                  type="button"
                  onClick={() => setSigMode('drawn')}
                  className={`py-1.5 text-xs font-medium rounded cursor-pointer ${
                    sigMode === 'drawn'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Draw Signature
                </button>
                <button
                  type="button"
                  onClick={() => setSigMode('typed')}
                  className={`py-1.5 text-xs font-medium rounded cursor-pointer ${
                    sigMode === 'typed'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Type Legal Name
                </button>
              </div>

              {sigMode === 'drawn' ? (
                <div className="space-y-2">
                  <div className="border border-slate-300 rounded-md bg-slate-50 overflow-hidden">
                    <canvas
                      ref={sigCanvasRef}
                      width={420}
                      height={120}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                      className="w-full h-28 touch-none cursor-crosshair bg-white"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Sign above using mouse, trackpad, or touch</span>
                    <button
                      type="button"
                      onClick={clearSignatureCanvas}
                      className="text-slate-700 hover:text-slate-900 font-medium cursor-pointer"
                    >
                      Clear Pad
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    value={typedSignature}
                    onChange={(e) => setTypedSignature(e.target.value)}
                    placeholder="Full legal signature"
                    className="w-full px-3 py-2 text-base italic font-serif border border-slate-300 rounded-md"
                  />
                </div>
              )}

              <button
                type="button"
                disabled={busyStep === 'sign'}
                onClick={() => void handleApplySignatureSubmit()}
                className="w-full py-2 px-4 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {busyStep === 'sign'
                  ? 'Applying Signature...'
                  : activeCase.status === 'signed'
                  ? 'Update Electronic Signature'
                  : 'Apply Electronic Signature'}
              </button>
            </>
          ) : (
            <div className="text-xs text-slate-600">
              Electronic signature locked onto legal instrument ({activeCase.signatureType}).
            </div>
          )}
        </div>

        {/* Step 3: Notary Digital Signature, Transparent Stamp & Timestamp */}
        <div
          ref={step3Ref}
          className="border border-slate-200 bg-white rounded-lg p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Stamp className="w-4 h-4 text-blue-800" />
              <h3 className="text-sm font-semibold text-slate-900">
                3. Notary Seal &amp; Cryptographic Timestamp
              </h3>
            </div>
            {isNotarized && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                <Lock className="w-3.5 h-3.5" />
                Sealed
              </span>
            )}
          </div>

          {!isNotarized ? (
            <>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700">
                    Stamp Overlay Mode
                  </span>
                  <button
                    type="button"
                    onClick={onNavigateStampTool}
                    className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
                  >
                    {userProfile.customStampDataUrl
                      ? 'Edit Transparent Stamp'
                      : 'Upload Transparent Stamp'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setUseCustomStamp(false)}
                    className={`px-2.5 py-2 text-xs font-medium rounded border text-left cursor-pointer ${
                      !useCustomStamp
                        ? 'border-blue-800 bg-blue-50 text-blue-900'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    Vector SVG Seal
                  </button>
                  <button
                    type="button"
                    disabled={!userProfile.customStampDataUrl}
                    onClick={() => setUseCustomStamp(true)}
                    className={`px-2.5 py-2 text-xs font-medium rounded border text-left cursor-pointer disabled:opacity-45 ${
                      useCustomStamp && userProfile.customStampDataUrl
                        ? 'border-blue-800 bg-blue-50 text-blue-900'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    Uploaded PNG Stamp
                  </button>
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2">
                <div className="text-xs font-medium text-slate-700">
                  Official Logos &amp; Marks (Optional)
                </div>
                <label className="flex items-center justify-between gap-2 text-xs text-slate-700 cursor-pointer">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeCertifiedLogo}
                      onChange={(e) =>
                        void handleEmblemToggle(
                          e.target.checked,
                          includeNotarizedMark
                        )
                      }
                      className="accent-blue-800"
                    />
                    <span>Include &ldquo;VeriSeal Certified&rdquo; Logo</span>
                  </span>
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-slate-700 cursor-pointer">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeNotarizedMark}
                      onChange={(e) =>
                        void handleEmblemToggle(
                          includeCertifiedLogo,
                          e.target.checked
                        )
                      }
                      className="accent-emerald-700"
                    />
                    <span>Include &ldquo;Notarized&rdquo; Official Mark</span>
                  </span>
                </label>
              </div>

              <button
                type="button"
                disabled={
                  activeCase.status !== 'signed' || busyStep === 'notarize'
                }
                onClick={() => void handleSealAndTimestamp()}
                className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-blue-800 rounded-md hover:bg-blue-900 disabled:opacity-45 transition-colors cursor-pointer"
              >
                {busyStep === 'notarize'
                  ? 'Issuing Certificate & Timestamp...'
                  : 'Issue Signing Certificate, Notary Seal & Timestamp'}
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md space-y-1.5 text-xs text-emerald-900">
                <div className="flex items-center gap-1.5 font-semibold">
                  <ShieldCheck className="w-4 h-4" />
                  Signing Certificate Issued
                </div>
                <div className="font-mono text-[11px] tabular-nums">
                  Certificate: {activeCase.certificateCode}
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                  <Clock className="w-3.5 h-3.5" />
                  {activeCase.timestampIso}
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2">
                <div className="text-xs font-medium text-slate-700">
                  Certificate &amp; Print Emblem Display
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeCertifiedLogo}
                    onChange={(e) =>
                      void handleEmblemToggle(
                        e.target.checked,
                        includeNotarizedMark
                      )
                    }
                    className="accent-blue-800"
                  />
                  <span>Show &ldquo;VeriSeal Certified&rdquo; Logo</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeNotarizedMark}
                    onChange={(e) =>
                      void handleEmblemToggle(
                        includeCertifiedLogo,
                        e.target.checked
                      )
                    }
                    className="accent-emerald-700"
                  />
                  <span>Show &ldquo;Notarized&rdquo; Official Mark</span>
                </label>
              </div>

              <button
                type="button"
                onClick={() =>
                  downloadSigningCertificateHtml(activeCase, custodyEvents, {
                    includeCertifiedLogo,
                    includeNotarizedMark,
                  })
                }
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-4 text-xs font-semibold text-white bg-blue-800 rounded-md hover:bg-blue-900 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download Signing Certificate
              </button>

              <button
                type="button"
                onClick={() => onNavigateVerify(activeCase.certificateCode)}
                className="w-full py-2 px-4 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
              >
                Verify Signature in Public Portal
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
