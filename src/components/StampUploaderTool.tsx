import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  Eraser,
  RotateCcw,
  Stamp,
  Upload,
} from 'lucide-react';
import { processNotaryStampToTransparentPng } from '../lib/stampProcessor';

interface StampUploaderToolProps {
  currentStampDataUrl: string;
  onSaveStamp: (dataUrl: string) => Promise<void> | void;
  saving?: boolean;
}

export const StampUploaderTool: React.FC<StampUploaderToolProps> = ({
  currentStampDataUrl,
  onSaveStamp,
  saving = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string>('');
  const [processedUrl, setProcessedUrl] = useState<string>(currentStampDataUrl);
  const [transparentRatio, setTransparentRatio] = useState<number>(0);
  const [threshold, setThreshold] = useState<number>(215);
  const [feather, setFeather] = useState<number>(32);
  const [inkMode, setInkMode] = useState<'original' | 'navy' | 'black'>('navy');
  const [processing, setProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [savedNotice, setSavedNotice] = useState<string>('');

  useEffect(() => {
    setProcessedUrl(currentStampDataUrl);
  }, [currentStampDataUrl]);

  useEffect(() => {
    if (!sourceFile && !sourcePreviewUrl) return;
    let active = true;
    const run = async () => {
      setProcessing(true);
      setError('');
      try {
        const input = sourceFile || sourcePreviewUrl;
        const result = await processNotaryStampToTransparentPng(input, {
          threshold,
          feather,
          inkMode,
        });
        if (!active) return;
        setProcessedUrl(result.dataUrl);
        setTransparentRatio(result.transparentPixelRatio);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : 'Unable to process stamp image.'
        );
      } finally {
        if (active) setProcessing(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [sourceFile, sourcePreviewUrl, threshold, feather, inkMode]);

  const handleFileSelected = (file: File | undefined) => {
    if (!file) return;
    setSavedNotice('');
    setError('');
    setSourceFile(file);
    const reader = new FileReader();
    reader.onload = () => setSourcePreviewUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const handleGenerateSampleStamp = () => {
    setSavedNotice('');
    setError('');
    setSourceFile(null);
    const canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Simulate a scanned rubber stamp on bright off-white paper
    ctx.fillStyle = '#F7F6F2';
    ctx.fillRect(0, 0, 420, 420);

    ctx.strokeStyle = '#1E3A5F';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(210, 210, 170, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(210, 210, 154, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(210, 210, 108, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#1E3A5F';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('OFFICIAL NOTARY STAMP', 210, 185);
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('STATE COMMISSIONED', 210, 218);
    ctx.font = '16px monospace';
    ctx.fillText('EXPIRES DEC 2028', 210, 248);

    setSourcePreviewUrl(canvas.toDataURL('image/png'));
  };

  const handleSave = async () => {
    setError('');
    await onSaveStamp(processedUrl);
    setSavedNotice('Transparent notary stamp saved to your profile.');
  };

  const handleClearStamp = async () => {
    setSourceFile(null);
    setSourcePreviewUrl('');
    setProcessedUrl('');
    setTransparentRatio(0);
    await onSaveStamp('');
    setSavedNotice('Custom stamp removed. Dynamic vector seal will be used.');
  };

  return (
    <div className="border border-slate-200 bg-white rounded-lg p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Notary Stamp Upload &amp; Transparency Processor
          </h3>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            Upload a scanned or photographed rubber stamp (PNG, JPG, WEBP, or SVG). White paper backgrounds are automatically stripped with smooth edge feathering to guarantee an alpha-transparent PNG overlay for legal documents.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleGenerateSampleStamp}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Test with Sample Scan
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Stamp Image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => handleFileSelected(e.target.files?.[0])}
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      {savedNotice && (
        <div className="mt-4 px-4 py-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{savedNotice}</span>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border border-slate-200 rounded-md p-4 bg-slate-50">
            <div className="text-xs font-medium text-slate-500 mb-3">
              Original Upload
            </div>
            <div className="h-52 flex items-center justify-center bg-white border border-slate-200 rounded overflow-hidden p-3">
              {sourcePreviewUrl ? (
                <img
                  src={sourcePreviewUrl}
                  alt="Original uploaded notary stamp"
                  referrerPolicy="no-referrer"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="text-center text-xs text-slate-400 px-4">
                  <Stamp className="w-7 h-7 mx-auto mb-2 text-slate-300" />
                  Upload a stamp scan or click &ldquo;Test with Sample Scan&rdquo;
                </div>
              )}
            </div>
          </div>

          <div className="border border-slate-200 rounded-md p-4 bg-slate-50">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-xs font-medium text-slate-500">
                Alpha-Transparent Output
              </span>
              {transparentRatio > 0 && (
                <span className="text-xs font-mono text-emerald-700 tabular-nums">
                  {Math.round(transparentRatio * 100)}% transparent
                </span>
              )}
            </div>
            <div
              className="h-52 flex items-center justify-center border border-slate-200 rounded overflow-hidden p-3"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                backgroundColor: '#ffffff',
              }}
            >
              {processing ? (
                <span className="text-xs text-slate-600 bg-white/90 px-3 py-1.5 rounded border border-slate-200">
                  Removing background...
                </span>
              ) : processedUrl ? (
                <img
                  src={processedUrl}
                  alt="Processed alpha-transparent notary stamp"
                  referrerPolicy="no-referrer"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-slate-500 bg-white/90 px-3 py-1.5 rounded border border-slate-200">
                  No custom stamp configured
                </span>
              )}
            </div>
          </div>

          {processedUrl && (
            <div className="sm:col-span-2 border border-slate-200 rounded-md p-4 bg-white">
              <div className="text-xs font-medium text-slate-500 mb-2">
                Document Overlay Verification (Transparent Over Legal Text)
              </div>
              <div className="relative p-4 bg-amber-50/40 border border-slate-200 rounded text-xs leading-relaxed text-slate-700 font-serif overflow-hidden">
                <p>
                  Subscribed and sworn to (or affirmed) before me on this 12th day of November, 2026, by the Principal Signer, proved to me on the basis of satisfactory government-issued photographic evidence.
                </p>
                <div className="mt-2 pt-2 border-t border-slate-300/70 flex items-center justify-between">
                  <span className="font-sans text-[11px] text-slate-500">
                    Notary Official Stamp Placement
                  </span>
                  <img
                    src={processedUrl}
                    alt="Transparent stamp overlay verification"
                    referrerPolicy="no-referrer"
                    className="h-20 w-auto object-contain -mt-6 opacity-90 pointer-events-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 space-y-5 border border-slate-200 rounded-md p-5 bg-slate-50/60">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5">
              <label htmlFor="stamp-threshold">Background Removal Threshold</label>
              <span className="font-mono tabular-nums text-slate-500">{threshold}</span>
            </div>
            <input
              id="stamp-threshold"
              type="range"
              min={150}
              max={250}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full accent-slate-900 cursor-pointer"
            />
            <p className="mt-1 text-xs text-slate-500">
              Lower values strip off-white or shadowed paper; higher values preserve faint ink strokes.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5">
              <label htmlFor="stamp-feather">Edge Anti-Aliasing Feather</label>
              <span className="font-mono tabular-nums text-slate-500">{feather}</span>
            </div>
            <input
              id="stamp-feather"
              type="range"
              min={8}
              max={64}
              value={feather}
              onChange={(e) => setFeather(Number(e.target.value))}
              className="w-full accent-slate-900 cursor-pointer"
            />
          </div>

          <div>
            <div className="text-xs font-medium text-slate-700 mb-2">
              Ink Normalization
            </div>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-200/70 rounded-md">
              {(['original', 'navy', 'black'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setInkMode(mode)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors capitalize whitespace-nowrap cursor-pointer ${
                    inkMode === mode
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {mode === 'navy' ? 'Notary Navy' : mode}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!processedUrl || saving}
              onClick={handleSave}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-800 rounded-md hover:bg-blue-900 disabled:opacity-45 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              {saving ? 'Saving Stamp...' : 'Save Transparent Stamp'}
            </button>
            {processedUrl && (
              <a
                href={processedUrl}
                download="veriseal-transparent-notary-stamp.png"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                PNG
              </a>
            )}
            {processedUrl && (
              <button
                type="button"
                onClick={handleClearStamp}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Eraser className="w-3.5 h-3.5" />
                Remove
              </button>
            )}
            {sourcePreviewUrl && (
              <button
                type="button"
                onClick={() => {
                  setThreshold(215);
                  setFeather(32);
                  setInkMode('navy');
                }}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
                title="Reset tuning sliders"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
