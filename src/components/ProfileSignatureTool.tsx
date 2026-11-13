import React, { useEffect, useRef, useState } from 'react';
import { Check, Eraser, PenTool, Trash2, Type } from 'lucide-react';
import type { SignatureType } from '../types/notary';

interface ProfileSignatureToolProps {
  displayName: string;
  currentSignatureData: string;
  currentSignatureType: SignatureType;
  onSaveSignature: (
    signatureData: string,
    signatureType: SignatureType
  ) => Promise<void> | void;
  saving?: boolean;
}

export const ProfileSignatureTool: React.FC<ProfileSignatureToolProps> = ({
  displayName,
  currentSignatureData,
  currentSignatureType,
  onSaveSignature,
  saving = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<'drawn' | 'typed'>(
    currentSignatureType === 'typed' ? 'typed' : 'drawn'
  );
  const [typedName, setTypedName] = useState<string>(
    currentSignatureType === 'typed' && currentSignatureData
      ? currentSignatureData
      : displayName || ''
  );
  const [inkColor, setInkColor] = useState<'#0F172A' | '#1E3A8A' | '#000000'>(
    '#0F172A'
  );
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [localSaving, setLocalSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (currentSignatureType === 'typed' && currentSignatureData) {
      setTypedName(currentSignatureData);
    } else if (!typedName && displayName) {
      setTypedName(displayName);
    }
  }, [currentSignatureType, currentSignatureData, displayName]);

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const pt = getPoint(e);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    setIsDrawing(true);
    setNotice('');
    setError('');
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pt = getPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    setHasStroke(true);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture already ended
    }
  };

  const clearPad = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
    setNotice('');
    setError('');
  };

  const handleSave = async () => {
    setError('');
    setNotice('');

    let nextData = '';
    const nextType: SignatureType = mode;

    if (mode === 'drawn') {
      if (!hasStroke || !canvasRef.current) {
        setError('Draw your signature on the pad above before saving.');
        return;
      }
      nextData = canvasRef.current.toDataURL('image/png');
      if (nextData.length > 145000) {
        setError('Signature image is too large. Clear and draw a simpler stroke.');
        return;
      }
    } else {
      const cleaned = typedName.trim();
      if (!cleaned) {
        setError('Enter your legal signature text before saving.');
        return;
      }
      nextData = cleaned.slice(0, 120);
    }

    setLocalSaving(true);
    try {
      await onSaveSignature(nextData, nextType);
      setNotice('Reusable electronic signature saved to your profile.');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to save profile signature.'
      );
    } finally {
      setLocalSaving(false);
    }
  };

  const handleClearSaved = async () => {
    setError('');
    setNotice('');
    setLocalSaving(true);
    try {
      await onSaveSignature('', 'none');
      clearPad();
      setNotice('Saved profile signature removed.');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to remove saved signature.'
      );
    } finally {
      setLocalSaving(false);
    }
  };

  const hasSavedSignature =
    currentSignatureType !== 'none' && Boolean(currentSignatureData);

  return (
    <div className="border border-slate-200 bg-white rounded-lg p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <PenTool className="w-4 h-4 text-blue-800" />
            <h3 className="text-base font-semibold text-slate-900">
              Saved Electronic Signature Studio
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Create and save your reusable signature here so you can apply it in one click inside the Signing Room.
          </p>
        </div>

        {notice && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <Check className="w-3.5 h-3.5" />
            {notice}
          </span>
        )}
      </div>

      {error && (
        <div className="px-3.5 py-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Creator Pad / Typed Input */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex p-1 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => {
                  setMode('drawn');
                  setError('');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded cursor-pointer ${
                  mode === 'drawn'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                Draw Signature
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('typed');
                  setError('');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded cursor-pointer ${
                  mode === 'typed'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Type className="w-3.5 h-3.5" />
                Type Legal Signature
              </button>
            </div>

            {mode === 'drawn' && (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>Ink:</span>
                {(
                  [
                    { label: 'Slate', hex: '#0F172A' },
                    { label: 'Navy', hex: '#1E3A8A' },
                    { label: 'Black', hex: '#000000' },
                  ] as const
                ).map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setInkColor(c.hex)}
                    className={`px-2 py-0.5 rounded border text-[11px] cursor-pointer ${
                      inkColor === c.hex
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {mode === 'drawn' ? (
            <div className="space-y-2">
              <div className="relative border border-slate-300 rounded-md bg-white overflow-hidden">
                <div className="pointer-events-none absolute inset-x-6 bottom-6 border-b border-dashed border-slate-300" />
                <canvas
                  ref={canvasRef}
                  width={540}
                  height={160}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="w-full h-36 touch-none cursor-crosshair block"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Sign above the baseline using mouse, trackpad, or stylus</span>
                <button
                  type="button"
                  onClick={clearPad}
                  className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 font-medium cursor-pointer"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  Clear Pad
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Full Legal Signature Text
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder={displayName || 'Elena Vance'}
                  className="w-full px-3 py-2 text-base italic font-serif border border-slate-300 rounded-md"
                />
              </div>
              <div className="p-4 border border-dashed border-slate-300 rounded-md bg-slate-50 text-center min-h-[76px] flex items-center justify-center">
                {typedName.trim() ? (
                  <span className="text-3xl italic font-serif text-slate-900">
                    {typedName.trim()}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">
                    Signature preview will appear here
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={saving || localSaving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-800 rounded-md hover:bg-blue-900 disabled:opacity-50 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              {localSaving ? 'Saving Signature...' : 'Save Signature to Profile'}
            </button>
          </div>
        </div>

        {/* Right: Current Saved Profile Signature Preview */}
        <div className="lg:col-span-5 border border-slate-200 rounded-md bg-slate-50/70 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900">
              Active Profile Signature
            </span>
            {hasSavedSignature && (
              <span className="text-[11px] font-mono uppercase text-emerald-700 font-semibold">
                {currentSignatureType === 'drawn' ? 'Drawn PNG' : 'Typed Legal'}
              </span>
            )}
          </div>

          <div className="h-32 rounded border border-slate-200 bg-white flex items-center justify-center p-3 overflow-hidden">
            {currentSignatureType === 'drawn' && currentSignatureData ? (
              <img
                src={currentSignatureData}
                alt="Saved profile signature"
                draggable={false}
                referrerPolicy="no-referrer"
                className="max-h-24 w-auto object-contain"
              />
            ) : currentSignatureType === 'typed' && currentSignatureData ? (
              <span className="text-2xl italic font-serif text-slate-900 text-center break-words">
                {currentSignatureData}
              </span>
            ) : (
              <span className="text-xs text-slate-400 text-center">
                No saved signature yet. Create one on the left to reuse in any Signing Room session.
              </span>
            )}
          </div>

          {hasSavedSignature && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                Available as 1-click option in Signing Room Step 2.
              </span>
              <button
                type="button"
                disabled={saving || localSaving}
                onClick={() => void handleClearSaved()}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-red-700 bg-white border border-red-200 rounded hover:bg-red-50 disabled:opacity-50 cursor-pointer shrink-0"
              >
                <Trash2 className="w-3 h-3" />
                Remove
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
