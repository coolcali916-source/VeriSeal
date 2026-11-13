import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
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

interface PdfPageCanvasProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  registerCanvas: (pageNumber: number, canvas: HTMLCanvasElement | null) => void;
  onRenderError: (msg: string) => void;
}

const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdfDoc,
  pageNumber,
  registerCanvas,
  onRenderError,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    registerCanvas(pageNumber, canvasRef.current);
    return () => registerCanvas(pageNumber, null);
  }, [pageNumber, registerCanvas]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    setRendered(false);

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = 760;
        const cssScale = targetWidth / baseViewport.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * dpr });

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        renderTask = page.render({
          canvas,
          viewport,
        });
        await renderTask.promise;
        if (!cancelled) {
          setRendered(true);
        }
      } catch (err) {
        const name =
          err && typeof err === 'object' && 'name' in err
            ? String((err as { name?: unknown }).name)
            : '';
        if (!cancelled && name !== 'RenderingCancelledException') {
          console.error(`PDF page ${pageNumber} render error:`, err);
          onRenderError(
            `Could not render PDF page ${pageNumber} visually; showing fallback view.`
          );
        }
      }
    };

    void renderPage();

    return () => {
      cancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // Ignore cancelled render task
        }
      }
    };
  }, [pdfDoc, pageNumber, onRenderError]);

  return (
    <div className="relative w-full bg-white">
      {!rendered && (
        <div className="h-[480px] flex items-center justify-center text-xs text-slate-400">
          Rendering page {pageNumber}...
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`block w-full h-auto pointer-events-none ${
          rendered ? 'block' : 'hidden'
        }`}
      />
    </div>
  );
};

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

  const pageSurfaceRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pdfCanvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const pageContainerRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stampWrapRef = useRef<HTMLDivElement | null>(null);
  const loadSeqRef = useRef<number>(0);

  // Drag & Sync Refs
  const [draggingTarget, setDraggingTarget] = useState<{
    target: 'signature' | 'stamp';
    page: number;
  } | null>(null);
  const draggingTargetRef = useRef<{
    target: 'signature' | 'stamp';
    page: number;
  } | null>(null);
  const grabOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const lastDragEndAtRef = useRef<number>(0);
  const lastLocalCommitRef = useRef<{ json: string; ts: number }>({
    json: '',
    ts: 0,
  });
  const activeCaseIdRef = useRef<string>(activeCase.id);

  const [draftPlacement, setDraftPlacement] =
    useState<DocumentPlacement>(placement);
  const draftPlacementRef = useRef<DocumentPlacement>(placement);

  useEffect(() => {
    if (activeCaseIdRef.current !== activeCase.id) {
      activeCaseIdRef.current = activeCase.id;
      draggingTargetRef.current = null;
      setDraggingTarget(null);
      lastLocalCommitRef.current = { json: '', ts: 0 };
      draftPlacementRef.current = placement;
      setDraftPlacement(placement);
      return;
    }

    if (draggingTargetRef.current) {
      return;
    }

    const incomingJson = JSON.stringify(placement);
    if (incomingJson === JSON.stringify(draftPlacementRef.current)) {
      return;
    }

    // Prevent stale Firestore onSnapshot echoes from snapping a freshly moved box back
    if (
      lastLocalCommitRef.current.ts > 0 &&
      Date.now() - lastLocalCommitRef.current.ts < 2500 &&
      incomingJson !== lastLocalCommitRef.current.json
    ) {
      return;
    }

    draftPlacementRef.current = placement;
    setDraftPlacement(placement);
  }, [placement, activeCase.id]);

  useEffect(() => {
    setActiveTool(isNotarized ? 'view' : 'signature');
    setCurrentPage(draftPlacementRef.current.signature.page || 1);
  }, [activeCase.id, isNotarized]);

  const registerPdfCanvas = useCallback(
    (pageNumber: number, canvas: HTMLCanvasElement | null) => {
      pdfCanvasRefs.current[pageNumber] = canvas;
    },
    []
  );

  const isPdfFile =
    activeCase.fileType === 'application/pdf' ||
    activeCase.fileName.toLowerCase().endsWith('.pdf');
  const isImageFile =
    activeCase.fileType.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif)$/i.test(activeCase.fileName);

  const loadPdfDocumentWithFallback = useCallback(
    async (bytes: Uint8Array): Promise<pdfjsLib.PDFDocumentProxy> => {
      const tryLoad = (timeoutMs: number) => {
        const task = pdfjsLib.getDocument({
          data: new Uint8Array(bytes),
        });
        return new Promise<pdfjsLib.PDFDocumentProxy>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            void task.destroy().catch(() => undefined);
            reject(new Error('PDF worker initialization timed out'));
          }, timeoutMs);

          task.promise.then(
            (doc) => {
              window.clearTimeout(timer);
              resolve(doc);
            },
            (err) => {
              window.clearTimeout(timer);
              reject(err);
            }
          );
        });
      };

      try {
        return await tryLoad(2500);
      } catch (workerErr) {
        console.warn('Retrying PDF parse with in-bundle worker:', workerErr);
        // @ts-expect-error pdf.worker.min.mjs has no TypeScript declaration file
        await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
        return await tryLoad(10000);
      }
    },
    []
  );

  // Resolve file binary from memory URL or IndexedDB cache
  useEffect(() => {
    const seq = ++loadSeqRef.current;
    let createdObjectUrl = '';
    const isStale = () => loadSeqRef.current !== seq;

    const resolveSource = async () => {
      setPdfError('');
      setPdfDoc(null);
      setNumPages(1);
      setPdfLoading(isPdfFile);

      try {
        let pdfBytes: Uint8Array | null = null;
        let nextResolvedUrl = previewObjectUrl || '';

        if (previewObjectUrl && isPdfFile) {
          try {
            const resp = await fetch(previewObjectUrl);
            if (resp.ok) {
              pdfBytes = new Uint8Array(await resp.arrayBuffer());
            }
          } catch (err) {
            console.warn('Could not read previewObjectUrl:', err);
          }
        }

        if ((!pdfBytes && isPdfFile) || (!nextResolvedUrl && isImageFile)) {
          const cached = await loadLocalDocumentFile(
            activeCase.id,
            activeCase.documentHash
          );
          if (isStale()) {
            if (cached?.objectUrl) URL.revokeObjectURL(cached.objectUrl);
            return;
          }
          if (cached) {
            createdObjectUrl = cached.objectUrl;
            nextResolvedUrl = cached.objectUrl;
            if (isPdfFile) {
              pdfBytes = new Uint8Array(cached.arrayBuffer);
            }
          }
        }

        if (isStale()) return;
        setResolvedUrl(nextResolvedUrl);

        if (isPdfFile && pdfBytes && pdfBytes.byteLength > 0) {
          const doc = await loadPdfDocumentWithFallback(pdfBytes);
          if (isStale()) return;
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          setCurrentPage((p) => clamp(p, 1, doc.numPages));
        } else if (isPdfFile && !nextResolvedUrl) {
          setPdfError(
            'Original PDF binary is not cached in this browser; showing extracted document text.'
          );
        } else if (isPdfFile && !pdfBytes) {
          setPdfError(
            'PDF binary could not be read into canvas; showing document preview.'
          );
        }
      } catch (err) {
        console.error('PDF load error:', err);
        if (!isStale()) {
          setPdfError(
            'Could not render PDF pages on canvas; showing document preview instead.'
          );
        }
      } finally {
        if (!isStale()) {
          setPdfLoading(false);
        }
      }
    };

    void resolveSource();

    return () => {
      loadSeqRef.current += 1;
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
    loadPdfDocumentWithFallback,
  ]);

  const scrollToPage = useCallback((pageNum: number) => {
    const safePage = clamp(pageNum, 1, numPages);
    setCurrentPage(safePage);
    pageContainerRefs.current[safePage]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [numPages]);

  const computeRelativePct = useCallback(
    (pageNum: number, clientX: number, clientY: number) => {
      const el = pageSurfaceRefs.current[pageNum];
      if (!el) return { xPct: 50, yPct: 50 };
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return { xPct: 50, yPct: 50 };
      }
      const xPct = clamp(((clientX - rect.left) / rect.width) * 100, 6, 94);
      const yPct = clamp(((clientY - rect.top) / rect.height) * 100, 6, 94);
      return {
        xPct: Math.round(xPct * 10) / 10,
        yPct: Math.round(yPct * 10) / 10,
      };
    },
    []
  );

  const resolvePageAndPctAtPoint = useCallback(
    (fallbackPage: number, clientX: number, clientY: number) => {
      let bestPage = fallbackPage;
      let bestDistance = Number.POSITIVE_INFINITY;

      const entries = Object.entries(pageSurfaceRefs.current);
      for (const [pageKey, el] of entries) {
        if (!el) continue;
        const p = Number(pageKey);
        if (!Number.isFinite(p) || p < 1 || p > numPages) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        if (clientY >= rect.top && clientY <= rect.bottom) {
          bestPage = p;
          bestDistance = 0;
          break;
        }
        const dist =
          clientY < rect.top ? rect.top - clientY : clientY - rect.bottom;
        if (dist < bestDistance) {
          bestDistance = dist;
          bestPage = p;
        }
      }

      const { xPct, yPct } = computeRelativePct(bestPage, clientX, clientY);
      return { page: bestPage, xPct, yPct };
    },
    [computeRelativePct, numPages]
  );

  const commitPlacement = useCallback(
    (next: DocumentPlacement) => {
      lastLocalCommitRef.current = {
        json: JSON.stringify(next),
        ts: Date.now(),
      };
      draftPlacementRef.current = next;
      setDraftPlacement(next);
      onChangePlacement(next);
    },
    [onChangePlacement]
  );

  const handleSurfaceClick = (
    pageNum: number,
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    if (
      isNotarized ||
      activeTool === 'view' ||
      draggingTargetRef.current ||
      performance.now() - lastDragEndAtRef.current < 320
    ) {
      return;
    }
    const { xPct, yPct } = computeRelativePct(pageNum, e.clientX, e.clientY);
    setCurrentPage(pageNum);
    const updated: DocumentPlacement = {
      ...draftPlacementRef.current,
      [activeTool]: {
        ...draftPlacementRef.current[activeTool],
        page: pageNum,
        xPct,
        yPct,
      },
    };
    commitPlacement(updated);
  };

  const handleBoxPointerDown = (
    target: 'signature' | 'stamp',
    pageNum: number,
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (isNotarized || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const surfaceEl = pageSurfaceRefs.current[pageNum];
    if (surfaceEl) {
      const rect = surfaceEl.getBoundingClientRect();
      const box = draftPlacementRef.current[target];
      const centerX = rect.left + (box.xPct / 100) * rect.width;
      const centerY = rect.top + (box.yPct / 100) * rect.height;
      grabOffsetRef.current = {
        dx: e.clientX - centerX,
        dy: e.clientY - centerY,
      };
    } else {
      grabOffsetRef.current = { dx: 0, dy: 0 };
    }

    const dragState = { target, page: pageNum };
    draggingTargetRef.current = dragState;
    setDraggingTarget(dragState);
    setActiveTool(target);
    setCurrentPage(pageNum);
  };

  useEffect(() => {
    if (!draggingTarget) return;

    const handleWindowPointerMove = (e: PointerEvent) => {
      const activeDrag = draggingTargetRef.current;
      if (!activeDrag || isNotarized) return;

      const centerClientX = e.clientX - grabOffsetRef.current.dx;
      const centerClientY = e.clientY - grabOffsetRef.current.dy;
      const resolved = resolvePageAndPctAtPoint(
        activeDrag.page,
        centerClientX,
        centerClientY
      );

      if (resolved.page !== activeDrag.page) {
        const nextDrag = { target: activeDrag.target, page: resolved.page };
        draggingTargetRef.current = nextDrag;
        setDraggingTarget(nextDrag);
        setCurrentPage(resolved.page);
      }

      const updated: DocumentPlacement = {
        ...draftPlacementRef.current,
        [activeDrag.target]: {
          ...draftPlacementRef.current[activeDrag.target],
          page: resolved.page,
          xPct: resolved.xPct,
          yPct: resolved.yPct,
        },
      };
      draftPlacementRef.current = updated;
      setDraftPlacement(updated);
    };

    const finishDrag = (e?: PointerEvent) => {
      const activeDrag = draggingTargetRef.current;
      if (!activeDrag) return;
      draggingTargetRef.current = null;
      lastDragEndAtRef.current = performance.now();
      setDraggingTarget(null);

      let committed = draftPlacementRef.current;
      if (e) {
        const centerClientX = e.clientX - grabOffsetRef.current.dx;
        const centerClientY = e.clientY - grabOffsetRef.current.dy;
        const resolved = resolvePageAndPctAtPoint(
          activeDrag.page,
          centerClientX,
          centerClientY
        );
        committed = {
          ...draftPlacementRef.current,
          [activeDrag.target]: {
            ...draftPlacementRef.current[activeDrag.target],
            page: resolved.page,
            xPct: resolved.xPct,
            yPct: resolved.yPct,
          },
        };
        setCurrentPage(resolved.page);
      }
      commitPlacement(committed);
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [draggingTarget, isNotarized, resolvePageAndPctAtPoint, commitPlacement]);

  const handlePlaceSingleOnPage = (
    target: 'signature' | 'stamp',
    pageNum: number
  ) => {
    if (isNotarized) return;
    setActiveTool(target);
    setCurrentPage(pageNum);
    commitPlacement({
      ...draftPlacementRef.current,
      [target]: {
        ...draftPlacementRef.current[target],
        page: pageNum,
      },
    });
  };

  const handlePlaceBothOnPage = (pageNum: number) => {
    if (isNotarized) return;
    setCurrentPage(pageNum);
    commitPlacement({
      signature: {
        ...draftPlacementRef.current.signature,
        page: pageNum,
      },
      stamp: {
        ...draftPlacementRef.current.stamp,
        page: pageNum,
      },
    });
  };

  const handleScaleChange = (newScale: number) => {
    if (activeTool === 'view' || isNotarized) return;
    const updated: DocumentPlacement = {
      ...draftPlacementRef.current,
      [activeTool]: {
        ...draftPlacementRef.current[activeTool],
        scale: newScale,
      },
    };
    commitPlacement(updated);
  };

  const handleResetPlacement = () => {
    if (isNotarized) return;
    const targetPage = clamp(currentPage, 1, numPages);
    const reset: DocumentPlacement = {
      signature: { ...DEFAULT_DOCUMENT_PLACEMENT.signature, page: targetPage },
      stamp: { ...DEFAULT_DOCUMENT_PLACEMENT.stamp, page: targetPage },
    };
    commitPlacement(reset);
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
      const exportPage = pdfDoc
        ? clamp(currentPage, 1, numPages)
        : 1;
      const outCanvas = document.createElement('canvas');
      let outW = 1200;
      let outH = 1553;

      const targetPdfCanvas = pdfCanvasRefs.current[exportPage];

      if (pdfDoc && targetPdfCanvas && targetPdfCanvas.width > 0) {
        outW = targetPdfCanvas.width;
        outH = targetPdfCanvas.height;
        outCanvas.width = outW;
        outCanvas.height = outH;
        const ctx = outCanvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(targetPdfCanvas, 0, 0, outW, outH);
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

      // Draw placed Signature if on exportPage
      if (draftPlacementRef.current.signature.page === exportPage) {
        const sx = (draftPlacementRef.current.signature.xPct / 100) * outW;
        const sy = (draftPlacementRef.current.signature.yPct / 100) * outH;
        const boxW = Math.round(
          outW * 0.28 * draftPlacementRef.current.signature.scale
        );
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
            outW * 0.032 * draftPlacementRef.current.signature.scale
          )}px Georgia, serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(activeCase.signerSignatureData, sx, sy);
          ctx.restore();
        }
      }

      // Draw placed Notary Stamp / SVG Seal if on exportPage
      if (draftPlacementRef.current.stamp.page === exportPage) {
        const nx = (draftPlacementRef.current.stamp.xPct / 100) * outW;
        const ny = (draftPlacementRef.current.stamp.yPct / 100) * outH;
        const stampDim = Math.round(
          outW * 0.19 * draftPlacementRef.current.stamp.scale
        );

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
      a.download = `${base}-page${exportPage}-${
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

  const renderOverlaysForPage = (pageNumber: number) => (
    <>
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
      {draftPlacement.signature.page === pageNumber && (
        <div
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onPointerDown={(e) => handleBoxPointerDown('signature', pageNumber, e)}
          onClick={(e) => e.stopPropagation()}
          style={{
            left: `${draftPlacement.signature.xPct}%`,
            top: `${draftPlacement.signature.yPct}%`,
            transform: `translate(-50%, -50%) scale(${draftPlacement.signature.scale})`,
          }}
          className={`absolute z-20 touch-none select-none transition-shadow ${
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
            <div className="flex flex-col items-center pointer-events-none">
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
            <div className="flex flex-col items-center pointer-events-none">
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
      {draftPlacement.stamp.page === pageNumber && (
        <div
          ref={stampWrapRef}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onPointerDown={(e) => handleBoxPointerDown('stamp', pageNumber, e)}
          onClick={(e) => e.stopPropagation()}
          style={{
            left: `${draftPlacement.stamp.xPct}%`,
            top: `${draftPlacement.stamp.yPct}%`,
            transform: `translate(-50%, -50%) scale(${draftPlacement.stamp.scale})`,
          }}
          className={`absolute z-20 touch-none select-none ${
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
          <div className={isNotarized ? 'pointer-events-none' : 'opacity-80 pointer-events-none'}>
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
            <div className="mt-1 text-center pointer-events-none">
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase bg-emerald-800 text-white rounded">
                Stamp Spot
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );

  const pageNumbers = pdfDoc
    ? Array.from({ length: numPages }, (_, idx) => idx + 1)
    : [1];

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
                onClick={() => scrollToPage(currentPage - 1)}
                className="p-1 text-slate-700 hover:bg-white rounded disabled:opacity-35 cursor-pointer"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <select
                aria-label="Jump to page"
                value={currentPage}
                onChange={(e) => scrollToPage(Number(e.target.value))}
                className="px-1.5 py-0.5 text-xs font-mono text-slate-700 bg-transparent rounded focus:outline-none tabular-nums cursor-pointer"
              >
                {pageNumbers.map((p) => (
                  <option key={p} value={p}>
                    Page {p} / {numPages}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={currentPage >= numPages}
                onClick={() => scrollToPage(currentPage + 1)}
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
              title="Reset signature and stamp onto current page"
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
            {exportingPng
              ? 'Exporting...'
              : numPages > 1
              ? `Download P${currentPage} PNG`
              : 'Download Page PNG'}
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
              ? 'Scroll to any page and click anywhere (or drag the blue Signature box) to choose where to sign.'
              : activeTool === 'stamp'
              ? 'Scroll to any page and click anywhere (or drag the green Stamp box) to choose where to issue the notary seal.'
              : 'Read-only preview mode.'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono">
          <button
            type="button"
            onClick={() => scrollToPage(draftPlacement.signature.page)}
            className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 cursor-pointer"
          >
            Sign: P{draftPlacement.signature.page} ({Math.round(draftPlacement.signature.xPct)}%, {Math.round(draftPlacement.signature.yPct)}%)
          </button>
          <button
            type="button"
            onClick={() => scrollToPage(draftPlacement.stamp.page)}
            className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 cursor-pointer"
          >
            Stamp: P{draftPlacement.stamp.page} ({Math.round(draftPlacement.stamp.xPct)}%, {Math.round(draftPlacement.stamp.yPct)}%)
          </button>
        </div>
      </div>

      {/* Interactive Scrollable Multi-Page Document Surface */}
      <div className="p-4 sm:p-6 overflow-auto max-h-[760px] flex flex-col items-center gap-6">
        {pdfLoading ? (
          <div className="w-full max-w-[760px] h-[580px] bg-white border border-slate-300 shadow-sm flex items-center justify-center text-xs text-slate-500">
            Rendering uploaded PDF pages...
          </div>
        ) : pdfDoc ? (
          pageNumbers.map((pageNum) => (
            <div
              key={pageNum}
              ref={(el) => {
                pageContainerRefs.current[pageNum] = el;
              }}
              className="w-full max-w-[760px] space-y-1.5"
            >
              <div className="flex items-center justify-between px-1 text-[11px] text-slate-500">
                <span className="font-mono font-semibold text-slate-700">
                  Page {pageNum} of {numPages}
                </span>
                {!isNotarized && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handlePlaceSingleOnPage('signature', pageNum)}
                      className="text-[11px] font-medium text-blue-800 hover:underline cursor-pointer"
                    >
                      Place Sign on P{pageNum}
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePlaceSingleOnPage('stamp', pageNum)}
                      className="text-[11px] font-medium text-emerald-700 hover:underline cursor-pointer"
                    >
                      Place Stamp on P{pageNum}
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePlaceBothOnPage(pageNum)}
                      className="text-[11px] font-medium text-slate-700 hover:underline cursor-pointer"
                    >
                      Move Both Here
                    </button>
                  </div>
                )}
              </div>

              <div
                ref={(el) => {
                  pageSurfaceRefs.current[pageNum] = el;
                }}
                onClick={(e) => handleSurfaceClick(pageNum, e)}
                className={`relative w-full bg-white shadow-sm border select-none overflow-hidden ${
                  currentPage === pageNum
                    ? 'border-blue-400 ring-1 ring-blue-200'
                    : 'border-slate-300'
                } ${
                  !isNotarized && activeTool !== 'view'
                    ? 'cursor-crosshair'
                    : 'cursor-default'
                }`}
              >
                <PdfPageCanvas
                  pdfDoc={pdfDoc}
                  pageNumber={pageNum}
                  registerCanvas={registerPdfCanvas}
                  onRenderError={setPdfError}
                />
                {renderOverlaysForPage(pageNum)}
              </div>
            </div>
          ))
        ) : (
          <div
            ref={(el) => {
              pageContainerRefs.current[1] = el;
            }}
            className="w-full max-w-[760px]"
          >
            {pdfError && (
              <div className="mb-3 px-3 py-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded">
                {pdfError}
              </div>
            )}

            <div
              ref={(el) => {
                pageSurfaceRefs.current[1] = el;
              }}
              onClick={(e) => handleSurfaceClick(1, e)}
              className={`relative w-full bg-white shadow-sm border border-slate-300 select-none overflow-hidden ${
                !isNotarized && activeTool !== 'view'
                  ? 'cursor-crosshair'
                  : 'cursor-default'
              }`}
            >
              {isPdfFile && resolvedUrl ? (
                <div className="relative w-full h-[760px] bg-white">
                  <iframe
                    src={`${resolvedUrl}#toolbar=0&navpanes=0`}
                    title={activeCase.fileName}
                    className="w-full h-full border-0 pointer-events-none"
                  />
                </div>
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

                  <div className="text-sm font-serif text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {activeCase.documentText}
                  </div>

                  <div className="h-36" />
                </div>
              )}

              {renderOverlaysForPage(1)}
            </div>
          </div>
        )}
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
