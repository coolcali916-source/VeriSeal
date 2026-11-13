import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Lock,
  Move,
  PenTool,
  RotateCcw,
  Stamp,
} from 'lucide-react';
import {
  DEFAULT_DOCUMENT_PLACEMENT,
  type DocumentPlacement,
  type NotarizationCase,
  type UserProfile,
} from '../types/notary';
import { loadLocalDocumentFile } from '../lib/localFileStore';
import { formatFileSize } from '../lib/documentParser';
import { NotarySealSvg } from './NotarySealSvg';
import {
  VeriSealCertifiedLogo,
  VeriSealNotarizedMark,
} from './VeriSealEmblems';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PlacementTool = 'signature' | 'stamp' | 'view';

interface InteractiveDocumentCanvasProps {
  activeCase: NotarizationCase;
  previewObjectUrl?: string;
  userProfile: UserProfile;
  useCustomStamp: boolean;
  includeCertifiedLogo: boolean;
  includeNotarizedMark: boolean;
  placement: DocumentPlacement;
  onChangePlacement: (next: DocumentPlacement) => void;
  onJumpToSignStep?: () => void;
  onJumpToSealStep?: () => void;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export const InteractiveDocumentCanvas: React.FC<
  InteractiveDocumentCanvasProps
> = ({
  activeCase,
  previewObjectUrl,
  userProfile,
  useCustomStamp,
  includeCertifiedLogo,
  includeNotarizedMark,
  placement,
  onChangePlacement,
  onJumpToSignStep,
  onJumpToSealStep,
}) => {
  const isNotarized = activeCase.status === 'notarized';
  const [activeTool, setActiveTool] = useState<PlacementTool>(
    isNotarized ? 'view' : 'signature'
  );
  const [currentPage, setCurrentPage] = useState<number>(
    placement.signature.page || 1
  );
  const [numPages, setNumPages] = useState<number>(1);
  const [resolvedUrl, setResolvedUrl] = useState<string>(previewObjectUrl || '');
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [exportingPng, setExportingPng] = useState(false);

  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stampWrapRef = useRef<HTMLDivElement | null>(null);

  // Drag state
  const [draggingTarget, setDraggingTarget] = useState<
    'signature' | 'stamp' | null
  >(null);
  const [draftPlacement, setDraftPlacement] =
    useState<DocumentPlacement>(placement);

  useEffect(() => {
    setDraftPlacement(placement);
  }, [placement]);

  useEffect(() => {
    setActiveTool(isNotarized ? 'view' : 'signature');
  }, [activeCase.id, isNotarized]);

  const isPdfFile =
    activeCase.fileType === 'application/pdf' ||
    activeCase.fileName.toLowerCase().endsWith('.pdf');
  const isImageFile =
    activeCase.fileType.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif)$/i.test(activeCase.fileName);

  // Resolve file binary from memory URL or IndexedDB cache
  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl = '';

    const resolveSource = async () => {
      setPdfError('');
      setPdfDoc(null);
      setNumPages(1);

      if (previewObjectUrl) {
        setResolvedUrl(previewObjectUrl);
        if (isPdfFile) {
          setPdfLoading(true);
          try {
            const resp = await fetch(previewObjectUrl);
            const buf = await resp.arrayBuffer();
            const doc = await pdfjsLib.getDocument({ data: buf }).promise;
            if (!cancelled) {
              setPdfDoc(doc);
              setNumPages(doc.numPages);
              setCurrentPage((p) => clamp(p, 1, doc.numPages));
            }
          } catch {
            if (!cancelled) {
              setPdfError(
                'Could not render PDF binary in canvas; showing extracted document sheet instead.'
              );
            }
          } finally {
            if (!cancelled) setPdfLoading(false);
          }
        }
        return;
      }

      // Check IndexedDB cache if previewObjectUrl isn't in memory (e.g., after reload)
      if (isPdfFile || isImageFile) {
        const cached = await loadLocalDocumentFile(
          activeCase.id,
          activeCase.documentHash
        );
        if (cancelled) return;
        if (cached) {
          createdObjectUrl = cached.objectUrl;
          setResolvedUrl(cached.objectUrl);
          if (isPdfFile) {
            setPdfLoading(true);
            try {
              const doc = await pdfjsLib.getDocument({
                data: cached.arrayBuffer,
              }).promise;
              if (!cancelled) {
                setPdfDoc(doc);
                setNumPages(doc.numPages);
                setCurrentPage((p) => clamp(p, 1, doc.numPages));
              }
            } catch {
              if (!cancelled) {
                setPdfError(
                  'Could not render cached PDF; showing extracted document sheet.'
                );
              }
            } finally {
              if (!cancelled) setPdfLoading(false);
            }
          }
          return;
        }
      }

      setResolvedUrl('');
    };

    void resolveSource();

    return () => {
      cancelled = true;
      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
      }
    };
  }, [
    activeCase.id,
    activeCase.documentHash,
    previewObjectUrl,
    isPdfFile,
    isImageFile,
  ]);

  // Render active PDF page onto canvas
  useEffect(() => {
    if (!pdfDoc || !pdfCanvasRef.current) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    const renderPage = async () => {
      try {
        const pageNum = clamp(currentPage, 1, pdfDoc.numPages);
        const page = await pdfDoc.getPage(pageNum);
        if (cancelled || !pdfCanvasRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = 760;
        const cssScale = targetWidth / baseViewport.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * dpr });

        const canvas = pdfCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        renderTask = page.render({
          canvasContext: ctx,
          viewport,
          canvas,
        });
        await renderTask.promise;
      } catch {
        // Ignore cancelled render task errors when switching pages rapidly
      }
    };

    void renderPage();

    return () => {
      cancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // Ignore
        }
      }
    };
  }, [pdfDoc, currentPage]);

  const computeRelativePct = useCallback(
    (clientX: number, clientY: number) => {
      const el = pageSurfaceRef.current;
      if (!el) return { xPct: 50, yPct: 50 };
      const rect = el.getBoundingClientRect();
      const xPct = clamp(((clientX - rect.left) / rect.width) * 100, 6, 94);
      const yPct = clamp(((clientY - rect.top) / rect.height) * 100, 6, 94);
      return {
        xPct: Math.round(xPct * 10) / 10,
        yPct: Math.round(yPct * 10) / 10,
      };
    },
    []
  );

  const handleSurfaceClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isNotarized || activeTool === 'view' || draggingTarget) return;
    const { xPct, yPct } = computeRelativePct(e.clientX, e.clientY);
    const updated: DocumentPlacement = {
      ...draftPlacement,
      [activeTool]: {
        ...draftPlacement[activeTool],
        page: currentPage,
        xPct,
        yPct,
      },
    };
    setDraftPlacement(updated);
    onChangePlacement(updated);
  };

  const handleBoxPointerDown = (
    target: 'signature' | 'stamp',
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (isNotarized) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveTool(target);
    setDraggingTarget(target);
  };

  const handleBoxPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingTarget || isNotarized) return;
    e.stopPropagation();
    const { xPct, yPct } = computeRelativePct(e.clientX, e.clientY);
    setDraftPlacement((prev) => ({
      ...prev,
      [draggingTarget]: {
        ...prev[draggingTarget],
        page: currentPage,
        xPct,
        yPct,
      },
    }));
  };

  const handleBoxPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingTarget) return;
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if capture was already released
    }
    const finalTarget = draggingTarget;
    setDraggingTarget(null);
    const { xPct, yPct } = computeRelativePct(e.clientX, e.clientY);
    const committed: DocumentPlacement = {
      ...draftPlacement,
      [finalTarget]: {
        ...draftPlacement[finalTarget],
        page: currentPage,
        xPct,
        yPct,
      },
    };
    setDraftPlacement(committed);
    onChangePlacement(committed);
  };

  const handleScaleChange = (newScale: number) => {
    if (activeTool === 'view' || isNotarized) return;
    const updated: DocumentPlacement = {
      ...draftPlacement,
      [activeTool]: {
        ...draftPlacement[activeTool],
        scale: newScale,
      },
    };
    setDraftPlacement(updated);
    onChangePlacement(updated);
  };

  const handleResetPlacement = () => {
    if (isNotarized) return;
    const reset: DocumentPlacement = {
      signature: { ...DEFAULT_DOCUMENT_PLACEMENT.signature, page: currentPage },
      stamp: { ...DEFAULT_DOCUMENT_PLACEMENT.stamp, page: currentPage },
    };
    setDraftPlacement(reset);
    onChangePlacement(reset);
  };

  const effectiveStampUrl = isNotarized
    ? activeCase.notaryStampDataUrl
    : useCustomStamp
    ? userProfile.customStampDataUrl
    : '';

  const effectiveNotaryName = isNotarized
    ? activeCase.notaryName
    : userProfile.displayName || 'Elena Vance';
  const effectiveCommission = isNotarized
    ? activeCase.notaryCommission
    : userProfile.commissionNumber || 'CA-2491804';
  const effectiveJurisdiction = isNotarized
    ? activeCase.notaryJurisdiction
    : userProfile.commissionJurisdiction || 'State of California';
  const effectiveExpires = isNotarized
    ? activeCase.notaryExpires
    : userProfile.commissionExpires || '2028-09-30';

  const handleDownloadSignedPage = async () => {
    setExportingPng(true);
    try {
      const outCanvas = document.createElement('canvas');
      let outW = 1200;
      let outH = 1553;

      if (pdfDoc && pdfCanvasRef.current) {
        outW = pdfCanvasRef.current.width;
        outH = pdfCanvasRef.current.height;
        outCanvas.width = outW;
        outCanvas.height = outH;
        const ctx = outCanvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(pdfCanvasRef.current, 0, 0, outW, outH);
      } else if (isImageFile && imageRef.current && resolvedUrl) {
        const img = imageRef.current;
        outW = img.naturalWidth || 1200;
        outH = img.naturalHeight || 1553;
        outCanvas.width = outW;
        outCanvas.height = outH;
        const ctx = outCanvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, 0, 0, outW, outH);
      } else {
        outCanvas.width = outW;
        outCanvas.height = outH;
        const ctx = outCanvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.strokeRect(24, 24, outW - 48, outH - 48);

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 28px Georgia, serif';
        ctx.fillText(activeCase.title, 72, 92);
        ctx.fillStyle = '#64748b';
        ctx.font = '16px monospace';
        ctx.fillText(
          `${activeCase.fileName} • SHA-256: ${activeCase.documentHash.slice(
            0,
            24
          )}...`,
          72,
          126
        );

        ctx.fillStyle = '#1e293b';
        ctx.font = '18px Georgia, serif';
        const words = activeCase.documentText.split(/\s+/);
        let line = '';
        let y = 185;
        const maxWidth = outW - 144;
        for (const w of words) {
          const test = line ? `${line} ${w}` : w;
          if (ctx.measureText(test).width > maxWidth) {
            ctx.fillText(line, 72, y);
            line = w;
            y += 28;
            if (y > outH - 220) break;
          } else {
            line = test;
          }
        }
        if (line && y <= outH - 220) {
          ctx.fillText(line, 72, y);
        }
      }

      const ctx = outCanvas.getContext('2d');
      if (!ctx) return;

      // Draw placed Signature if on currentPage
      if (draftPlacement.signature.page === currentPage) {
        const sx = (draftPlacement.signature.xPct / 100) * outW;
        const sy = (draftPlacement.signature.yPct / 100) * outH;
        const boxW = Math.round(outW * 0.28 * draftPlacement.signature.scale);
        const boxH = Math.round(boxW * 0.36);

        if (
          activeCase.signatureType === 'drawn' &&
          activeCase.signerSignatureData
        ) {
          await new Promise<void>((resolve) => {
            const sigImg = new Image();
            sigImg.onload = () => {
              const ratio = Math.min(
                boxW / sigImg.width,
                boxH / sigImg.height
              );
              const dw = sigImg.width * ratio;
              const dh = sigImg.height * ratio;
              ctx.drawImage(sigImg, sx - dw / 2, sy - dh / 2, dw, dh);
              resolve();
            };
            sigImg.onerror = () => resolve();
            sigImg.src = activeCase.signerSignatureData;
          });
        } else if (
          activeCase.signatureType === 'typed' &&
          activeCase.signerSignatureData
        ) {
          ctx.save();
          ctx.fillStyle = '#0f172a';
          ctx.font = `italic ${Math.round(
            outW * 0.032 * draftPlacement.signature.scale
          )}px Georgia, serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(activeCase.signerSignatureData, sx, sy);
          ctx.restore();
        }
      }

      // Draw placed Notary Stamp / SVG Seal if on currentPage
      if (draftPlacement.stamp.page === currentPage) {
        const nx = (draftPlacement.stamp.xPct / 100) * outW;
        const ny = (draftPlacement.stamp.yPct / 100) * outH;
        const stampDim = Math.round(outW * 0.19 * draftPlacement.stamp.scale);

        if (effectiveStampUrl) {
          await new Promise<void>((resolve) => {
            const stImg = new Image();
            stImg.onload = () => {
              ctx.drawImage(
                stImg,
                nx - stampDim / 2,
                ny - stampDim / 2,
                stampDim,
                stampDim
              );
              resolve();
            };
            stImg.onerror = () => resolve();
            stImg.src = effectiveStampUrl;
          });
        } else if (stampWrapRef.current) {
          const svgEl = stampWrapRef.current.querySelector('svg');
          if (svgEl) {
            const serializer = new XMLSerializer();
            const svgStr = serializer.serializeToString(svgEl);
            const svgBlob = new Blob([svgStr], {
              type: 'image/svg+xml;charset=utf-8',
            });
            const svgUrl = URL.createObjectURL(svgBlob);
            await new Promise<void>((resolve) => {
              const svgImg = new Image();
              svgImg.onload = () => {
                ctx.drawImage(
                  svgImg,
                  nx - stampDim / 2,
                  ny - stampDim / 2,
                  stampDim,
                  stampDim
                );
                URL.revokeObjectURL(svgUrl);
                resolve();
              };
              svgImg.onerror = () => {
                URL.revokeObjectURL(svgUrl);
                resolve();
              };
              svgImg.src = svgUrl;
            });
          }
        }
      }

      const pngUrl = outCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = pngUrl;
      const base = activeCase.fileName.replace(/\.[^.]+$/, '');
      a.download = `${base}-page${currentPage}-${
        isNotarized ? 'notarized' : 'preview'
      }.png`;
      a.click();
    } finally {
      setExportingPng(false);
    }
  };

  const activeScale =
    activeTool === 'view'
      ? 1
      : draftPlacement[activeTool]?.scale ?? 1;

  return (
    <div className="bg-slate-100/80 border-t border-slate-200 flex flex-col">
      {/* Placement & Viewer Toolbar */}
      <div className="px-4 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {!isNotarized ? (
            <>
              <button
                type="button"
                onClick={() => setActiveTool('signature')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                  activeTool === 'signature'
                    ? 'bg-blue-800 text-white border-blue-800'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                Place Signature
              </button>
              <button
                type="button"
                onClick={() => setActiveTool('stamp')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                  activeTool === 'stamp'
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                <Stamp className="w-3.5 h-3.5" />
                Place Notary Stamp
              </button>
              <button
                type="button"
                onClick={() => setActiveTool('view')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                  activeTool === 'view'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                View
              </button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
              <Lock className="w-3.5 h-3.5" />
              Sealed &amp; Placement Locked
            </span>
          )}
        </div>

        {/* Page Controls + Size + Download */}
        <div className="flex flex-wrap items-center gap-2.5">
          {numPages > 1 && (
            <div className="inline-flex items-center gap-1 px-1.5 py-1 bg-slate-100 border border-slate-200 rounded-md">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1 text-slate-700 hover:bg-white rounded disabled:opacity-35 cursor-pointer"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 text-xs font-mono text-slate-700 tabular-nums">
                Page {currentPage} / {numPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= numPages}
                onClick={() =>
                  setCurrentPage((p) => Math.min(numPages, p + 1))
                }
                className="p-1 text-slate-700 hover:bg-white rounded disabled:opacity-35 cursor-pointer"
                aria-label="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {!isNotarized && activeTool !== 'view' && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1">
              <span>Size</span>
              <input
                type="range"
                min={0.6}
                max={1.6}
                step={0.05}
                value={activeScale}
                onChange={(e) => handleScaleChange(Number(e.target.value))}
                className="w-20 accent-blue-800"
              />
              <span className="font-mono text-[11px] tabular-nums w-8">
                {activeScale.toFixed(1)}×
              </span>
            </label>
          )}

          {!isNotarized && (
            <button
              type="button"
              onClick={handleResetPlacement}
              title="Reset signature and stamp to bottom of current page"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          )}

          <button
            type="button"
            disabled={exportingPng}
            onClick={() => void handleDownloadSignedPage()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {exportingPng ? 'Exporting...' : 'Download Page PNG'}
          </button>
        </div>
      </div>

      {/* Placement Status & Quick Jump Bar */}
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
        <div className="flex flex-wrap items-center gap-2">
          <Move className="w-3.5 h-3.5 text-slate-400" />
          <span>
            {isNotarized
              ? 'Signature and notary stamp locations are permanently bound to this certificate.'
              : activeTool === 'signature'
              ? 'Click anywhere on the document or drag the blue Signature box to choose where to sign.'
              : activeTool === 'stamp'
              ? 'Click anywhere on the document or drag the green Stamp box to choose where to issue the notary seal.'
              : 'Read-only preview mode.'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono">
          <button
            type="button"
            onClick={() => setCurrentPage(draftPlacement.signature.page)}
            className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 cursor-pointer"
          >
            Sign: P{draftPlacement.signature.page} ({Math.round(draftPlacement.signature.xPct)}%, {Math.round(draftPlacement.signature.yPct)}%)
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage(draftPlacement.stamp.page)}
            className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 cursor-pointer"
          >
            Stamp: P{draftPlacement.stamp.page} ({Math.round(draftPlacement.stamp.xPct)}%, {Math.round(draftPlacement.stamp.yPct)}%)
          </button>
        </div>
      </div>

      {/* Interactive Document Page Surface */}
      <div className="p-4 sm:p-6 overflow-auto max-h-[720px] flex justify-center">
        <div
          ref={pageSurfaceRef}
          onClick={handleSurfaceClick}
          className={`relative w-full max-w-[760px] bg-white shadow-sm border border-slate-300 select-none overflow-hidden ${
            !isNotarized && activeTool !== 'view'
              ? 'cursor-crosshair'
              : 'cursor-default'
          }`}
        >
          {/* Underlying Document Page */}
          {pdfLoading ? (
            <div className="h-[580px] flex items-center justify-center text-xs text-slate-500">
              Rendering uploaded PDF pages...
            </div>
          ) : pdfDoc ? (
            <canvas
              ref={pdfCanvasRef}
              className="block w-full h-auto pointer-events-none"
            />
          ) : isImageFile && resolvedUrl ? (
            <img
              ref={imageRef}
              src={resolvedUrl}
              alt={activeCase.fileName}
              referrerPolicy="no-referrer"
              className="block w-full h-auto object-contain pointer-events-none"
            />
          ) : (
            <div className="min-h-[640px] p-8 sm:p-10 space-y-5 pointer-events-none">
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                    {activeCase.fileName} · {formatFileSize(activeCase.fileSize)}
                  </div>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">
                    {activeCase.title}
                  </h3>
                </div>
                {(includeCertifiedLogo || includeNotarizedMark) && (
                  <div className="flex items-center gap-2 scale-75 origin-top-right">
                    {includeCertifiedLogo && <VeriSealCertifiedLogo compact />}
                    {includeNotarizedMark && (
                      <VeriSealNotarizedMark
                        certificateCode={
                          isNotarized
                            ? activeCase.certificateCode
                            : 'PENDING SEAL'
                        }
                      />
                    )}
                  </div>
                )}
              </div>

              {pdfError && (
                <div className="px-3 py-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded">
                  {pdfError}
                </div>
              )}

              <div className="text-sm font-serif text-slate-800 whitespace-pre-wrap leading-relaxed">
                {activeCase.documentText}
              </div>

              <div className="h-36" />
            </div>
          )}

          {/* Optional Corner Emblems Overlay on PDF/Image when enabled */}
          {(pdfDoc || (isImageFile && resolvedUrl)) &&
            (includeCertifiedLogo || includeNotarizedMark) && (
              <div className="absolute top-3 right-3 flex items-center gap-2 pointer-events-none opacity-90 scale-75 origin-top-right">
                {includeCertifiedLogo && <VeriSealCertifiedLogo compact />}
                {includeNotarizedMark && (
                  <VeriSealNotarizedMark
                    certificateCode={
                      isNotarized ? activeCase.certificateCode : 'PENDING SEAL'
                    }
                  />
                )}
              </div>
            )}

          {/* Placed Signature Box */}
          {draftPlacement.signature.page === currentPage && (
            <div
              onPointerDown={(e) => handleBoxPointerDown('signature', e)}
              onPointerMove={handleBoxPointerMove}
              onPointerUp={handleBoxPointerUp}
              onClick={(e) => e.stopPropagation()}
              style={{
                left: `${draftPlacement.signature.xPct}%`,
                top: `${draftPlacement.signature.yPct}%`,
                transform: `translate(-50%, -50%) scale(${draftPlacement.signature.scale})`,
              }}
              className={`absolute z-20 touch-none transition-shadow ${
                isNotarized ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
              } ${
                activeCase.signatureType !== 'none' &&
                activeCase.signerSignatureData
                  ? `px-3 py-1.5 rounded ${
                      isNotarized
                        ? 'bg-transparent'
                        : 'bg-blue-50/35 border border-dashed border-blue-600/70 hover:bg-blue-50/55'
                    }`
                  : `w-52 px-3 py-2.5 rounded border-2 border-dashed ${
                      activeTool === 'signature'
                        ? 'border-blue-700 bg-blue-50/90 shadow-md ring-2 ring-blue-500/20'
                        : 'border-blue-400 bg-blue-50/75 hover:border-blue-700'
                    }`
              }`}
            >
              {activeCase.signatureType === 'drawn' &&
              activeCase.signerSignatureData ? (
                <div className="flex flex-col items-center">
                  <img
                    src={activeCase.signerSignatureData}
                    alt={`Signature of ${activeCase.signerName}`}
                    draggable={false}
                    referrerPolicy="no-referrer"
                    className="h-14 w-auto object-contain pointer-events-none"
                  />
                  <span className="text-[9px] font-mono text-slate-600 bg-white/80 px-1 rounded">
                    Signed: {activeCase.signerName}
                  </span>
                </div>
              ) : activeCase.signatureType === 'typed' &&
                activeCase.signerSignatureData ? (
                <div className="flex flex-col items-center">
                  <span className="text-2xl italic font-serif text-slate-900 whitespace-nowrap pointer-events-none">
                    {activeCase.signerSignatureData}
                  </span>
                  <span className="text-[9px] font-mono text-slate-600 bg-white/80 px-1 rounded">
                    Signed: {activeCase.signerName}
                  </span>
                </div>
              ) : (
                <div className="text-center space-y-0.5 pointer-events-none">
                  <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-blue-900">
                    <PenTool className="w-3 h-3" />
                    Sign Here
                  </div>
                  <div className="text-[11px] font-medium text-slate-700 truncate">
                    {activeCase.signerName}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Placed Notary Stamp / Vector Seal Box */}
          {draftPlacement.stamp.page === currentPage && (
            <div
              ref={stampWrapRef}
              onPointerDown={(e) => handleBoxPointerDown('stamp', e)}
              onPointerMove={handleBoxPointerMove}
              onPointerUp={handleBoxPointerUp}
              onClick={(e) => e.stopPropagation()}
              style={{
                left: `${draftPlacement.stamp.xPct}%`,
                top: `${draftPlacement.stamp.yPct}%`,
                transform: `translate(-50%, -50%) scale(${draftPlacement.stamp.scale})`,
              }}
              className={`absolute z-20 touch-none ${
                isNotarized ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
              } ${
                isNotarized
                  ? ''
                  : `p-1.5 rounded-full border-2 border-dashed ${
                      activeTool === 'stamp'
                        ? 'border-emerald-700 bg-emerald-50/75 shadow-md ring-2 ring-emerald-500/20'
                        : 'border-emerald-500/70 bg-white/65 hover:border-emerald-700'
                    }`
              }`}
            >
              <div className={isNotarized ? '' : 'opacity-80 pointer-events-none'}>
                <NotarySealSvg
                  notaryName={effectiveNotaryName}
                  commissionNumber={effectiveCommission}
                  jurisdiction={effectiveJurisdiction}
                  expires={effectiveExpires}
                  certificateCode={
                    isNotarized ? activeCase.certificateCode : 'PREVIEW SEAL'
                  }
                  customStampDataUrl={effectiveStampUrl}
                  size={128}
                />
              </div>
              {!isNotarized && (
                <div className="mt-1 text-center">
                  <span className="px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase bg-emerald-800 text-white rounded">
                    Stamp Spot
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Contextual Action Shortcuts below the Page Canvas */}
      {!isNotarized && (onJumpToSignStep || onJumpToSealStep) && (
        <div className="px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-600">
            {activeCase.status === 'draft'
              ? 'Next: Complete Step 1 (Identity Verification) in the right panel to unlock signing.'
              : activeCase.status === 'identity_verified'
              ? 'Signature spot is set — complete Step 2 to apply the electronic signature here.'
              : 'Signature placed — complete Step 3 to issue the official notary stamp & ECDSA seal here.'}
          </span>
          <div className="flex items-center gap-2">
            {activeCase.status === 'identity_verified' && onJumpToSignStep && (
              <button
                type="button"
                onClick={onJumpToSignStep}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-800 rounded hover:bg-blue-900 cursor-pointer"
              >
                Go to Step 2: Sign Document
              </button>
            )}
            {activeCase.status === 'signed' && onJumpToSealStep && (
              <button
                type="button"
                onClick={onJumpToSealStep}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded hover:bg-emerald-800 cursor-pointer"
              >
                Go to Step 3: Issue Stamp &amp; Seal
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
