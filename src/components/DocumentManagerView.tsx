import React, { useRef, useState } from 'react';
import {
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  type DocumentFolder,
  type NotarialActType,
  type NotarizationCase,
  type NotarizationMode,
  type NotarizationStatus,
  MAX_DOC_TEXT_LEN,
  MAX_FOLDER_NAME_LEN,
  MAX_TITLE_LEN,
} from '../types/notary';
import {
  formatFileSize,
  parseUploadedFile,
  truncateUtf8Bytes,
} from '../lib/documentParser';
import { sha256Hex } from '../lib/crypto';
import { LEGAL_TEMPLATES } from '../lib/templates';
import {
  VeriSealCertifiedLogo,
  VeriSealNotarizedMark,
} from './VeriSealEmblems';

interface DocumentManagerViewProps {
  cases: NotarizationCase[];
  folders: DocumentFolder[];
  activeFolderId: string;
  onSelectFolder: (folderId: string) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onCreateCase: (payload: {
    title: string;
    folderId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    actType: NotarialActType;
    notarizationMode: NotarizationMode;
    meetingLocation: string;
    signerName: string;
    signerEmail: string;
    documentText: string;
    documentHash: string;
    feeCents: number;
    includeCertifiedLogo: boolean;
    includeNotarizedMark: boolean;
    previewObjectUrl?: string;
    uploadedFile?: File;
  }) => Promise<void>;
  onMoveCaseFolder: (caseId: string, folderId: string) => Promise<void>;
  onDeleteCase: (caseId: string) => Promise<void>;
  onOpenCase: (caseId: string) => void;
  defaultSignerName: string;
  defaultSignerEmail: string;
}

const STATUS_LABELS: Record<NotarizationStatus, string> = {
  draft: 'Draft Uploaded',
  identity_verified: 'ID Verified',
  signed: 'Signer Executed',
  notarized: 'Notarized & Sealed',
};

const PROGRESS_STEP: Record<NotarizationStatus, number> = {
  draft: 1,
  identity_verified: 2,
  signed: 3,
  notarized: 4,
};

export const DocumentManagerView: React.FC<DocumentManagerViewProps> = ({
  cases,
  folders,
  activeFolderId,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onCreateCase,
  onMoveCaseFolder,
  onDeleteCase,
  onOpenCase,
  defaultSignerName,
  defaultSignerEmail,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const intakeFormRef = useRef<HTMLFormElement | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | NotarizationStatus>('all');
  const [modeFilter, setModeFilter] = useState<'all' | NotarizationMode>('all');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');

  // Upload / Intake Drawer State
  const [showIntake, setShowIntake] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState(activeFolderId === 'all' ? '' : activeFolderId);
  const [actType, setActType] = useState<NotarialActType>('Acknowledgment');
  const [notarizationMode, setNotarizationMode] = useState<NotarizationMode>('online');
  const [meetingLocation, setMeetingLocation] = useState('San Francisco County, CA');
  const [signerName, setSignerName] = useState(defaultSignerName || 'Jordan M. Mercer');
  const [signerEmail, setSignerEmail] = useState(defaultSignerEmail || 'signer@veriseal.example');
  const [fileName, setFileName] = useState('');
  const [fileType, setFileType] = useState('text/plain');
  const [fileSize, setFileSize] = useState(0);
  const [documentText, setDocumentText] = useState('');
  const [documentHash, setDocumentHash] = useState('');
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | undefined>(undefined);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [includeCertifiedLogo, setIncludeCertifiedLogo] = useState(true);
  const [includeNotarizedMark, setIncludeNotarizedMark] = useState(true);
  const [parsingFile, setParsingFile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [intakeError, setIntakeError] = useState('');

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setIntakeError('');
    setParsingFile(true);
    try {
      const parsed = await parseUploadedFile(file);
      const baseTitle = parsed.fileName
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim();
      setTitle(truncateUtf8Bytes(baseTitle || 'Uploaded Document', 135));
      setFileName(parsed.fileName);
      setFileType(parsed.fileType);
      setFileSize(parsed.fileSize);
      setDocumentText(parsed.extractedText);
      setDocumentHash(parsed.documentHash);
      setPreviewObjectUrl(parsed.previewObjectUrl);
      setUploadedFile(file);
      if (defaultSignerName && (!signerName || signerName === 'Jordan M. Mercer')) {
        setSignerName(defaultSignerName);
      }
      if (
        defaultSignerEmail &&
        (!signerEmail || signerEmail === 'signer@veriseal.example')
      ) {
        setSignerEmail(defaultSignerEmail);
      }
      setShowIntake(true);
      requestAnimationFrame(() => {
        intakeFormRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      });
    } catch (err) {
      setIntakeError(
        err instanceof Error ? err.message : 'Could not read uploaded file.'
      );
    } finally {
      setParsingFile(false);
    }
  };

  const handleSelectTemplate = async (templateId: string) => {
    const tpl = LEGAL_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    const hash = await sha256Hex(tpl.body);
    const matchedFolder = folders.find(
      (f) => f.name.toLowerCase() === tpl.defaultFolderName.toLowerCase()
    );
    setTitle(tpl.title);
    setFileName(tpl.fileName);
    setFileType('text/plain');
    setFileSize(new Blob([tpl.body]).size);
    setActType(tpl.actType);
    setDocumentText(tpl.body);
    setDocumentHash(hash);
    setPreviewObjectUrl(undefined);
    setUploadedFile(null);
    if (matchedFolder) setFolderId(matchedFolder.id);
    setShowIntake(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIntakeError('');
    if (!title.trim() || !documentText.trim()) {
      setIntakeError('Please upload a document file or select a legal template.');
      return;
    }
    setSubmitting(true);
    try {
      const safeDocText = truncateUtf8Bytes(documentText.trim(), MAX_DOC_TEXT_LEN);
      const safeTitle = truncateUtf8Bytes(title.trim(), 135) || 'Untitled Document';
      const safeFileName =
        truncateUtf8Bytes(
          fileName || `${safeTitle.replace(/\s+/g, '_')}.txt`,
          175
        ) || 'document.txt';
      const safeFileType = truncateUtf8Bytes(fileType || 'text/plain', 95);
      const safeSignerName =
        truncateUtf8Bytes(signerName.trim(), 95) || 'Principal Signer';
      const rawEmail = signerEmail.trim();
      const safeSignerEmail =
        rawEmail.length >= 3
          ? truncateUtf8Bytes(rawEmail, 115)
          : 'signer@veriseal.example';
      const safeLocation = truncateUtf8Bytes(
        notarizationMode === 'in_person'
          ? meetingLocation.trim() || 'In-Person Signing Office'
          : 'Remote Audio-Video Session',
        155
      );
      const computedHash = documentHash || (await sha256Hex(safeDocText));
      await onCreateCase({
        title: safeTitle,
        folderId: folderId || 'unfiled',
        fileName: safeFileName,
        fileType: safeFileType,
        fileSize: fileSize || new Blob([safeDocText]).size,
        actType,
        notarizationMode,
        meetingLocation: safeLocation,
        signerName: safeSignerName,
        signerEmail: safeSignerEmail,
        documentText: safeDocText,
        documentHash: computedHash,
        feeCents: actType === 'Acknowledgment' ? 2500 : 3000,
        includeCertifiedLogo,
        includeNotarizedMark,
        previewObjectUrl,
        uploadedFile: uploadedFile || undefined,
      });
      setShowIntake(false);
      setTitle('');
      setFileName('');
      setDocumentText('');
      setDocumentHash('');
      setPreviewObjectUrl(undefined);
      setUploadedFile(null);
    } catch (err) {
      setIntakeError(
        err instanceof Error ? err.message : 'Unable to create notarization request.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleFolderCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newFolderName.trim().slice(0, MAX_FOLDER_NAME_LEN);
    if (!cleaned) return;
    await onCreateFolder(cleaned);
    setNewFolderName('');
    setShowNewFolderInput(false);
  };

  const handleFolderRenameSubmit = async (id: string) => {
    const cleaned = editingFolderName.trim().slice(0, MAX_FOLDER_NAME_LEN);
    if (cleaned) {
      await onRenameFolder(id, cleaned);
    }
    setEditingFolderId(null);
  };

  const filteredCases = cases.filter((item) => {
    if (activeFolderId === 'unfiled') {
      if (item.folderId && item.folderId !== 'unfiled') return false;
    } else if (activeFolderId !== 'all') {
      if (item.folderId !== activeFolderId) return false;
    }
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (modeFilter !== 'all' && item.notarizationMode !== modeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.fileName.toLowerCase().includes(q) ||
        item.signerName.toLowerCase().includes(q) ||
        item.certificateCode.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const notarizedCount = cases.filter((c) => c.status === 'notarized').length;
  const pendingCount = cases.length - notarizedCount;
  const avgProgress =
    cases.length > 0
      ? Math.round(
          (cases.reduce((acc, c) => acc + PROGRESS_STEP[c.status], 0) /
            (cases.length * 4)) *
            100
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border border-slate-200 bg-white rounded-lg px-5 py-4">
          <div className="text-xs font-medium text-slate-500">Total Documents</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
            {cases.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Across {folders.length} folders
          </div>
        </div>
        <div className="border border-slate-200 bg-white rounded-lg px-5 py-4">
          <div className="text-xs font-medium text-slate-500">In Progress</div>
          <div className="mt-1 text-2xl font-semibold text-amber-700 tabular-nums">
            {pendingCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Awaiting verification or seal
          </div>
        </div>
        <div className="border border-slate-200 bg-white rounded-lg px-5 py-4">
          <div className="text-xs font-medium text-slate-500">Notarized &amp; Sealed</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-700 tabular-nums">
            {notarizedCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            ECDSA-signed &amp; timestamped
          </div>
        </div>
        <div className="border border-slate-200 bg-white rounded-lg px-5 py-4">
          <div className="text-xs font-medium text-slate-500">Pipeline Completion</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
            {avgProgress}%
          </div>
          <div className="mt-1 text-xs text-slate-500">
            4-stage custody workflow
          </div>
        </div>
      </div>

      {/* Upload Dropzone & Quick Template Bar */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`border border-dashed rounded-lg p-6 transition-colors ${
          dragActive
            ? 'border-blue-700 bg-blue-50/50'
            : 'border-slate-300 bg-white'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
              <Upload className="w-5 h-5 text-slate-700" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Upload Document for Notarization
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Drop PDF, DOCX, TXT, MD, PNG, or JPG files here. VeriSeal computes an exact SHA-256 byte digest immediately upon intake.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={parsingFile}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              {parsingFile ? 'Reading & Hashing...' : 'Select File'}
            </button>
            <button
              type="button"
              onClick={() => setShowIntake((v) => !v)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {showIntake ? 'Close Form' : 'New Request / Template'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,.csv,.json,.rtf,.xml,.png,.jpg,.jpeg,.webp,application/pdf,text/*,image/*"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                e.target.value = '';
                void handleFile(selected);
              }}
            />
          </div>
        </div>

        {intakeError && !showIntake && (
          <div className="mt-4 px-3.5 py-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
            {intakeError}
          </div>
        )}

        {showIntake && (
          <form
            ref={intakeFormRef}
            onSubmit={handleCreateSubmit}
            className="mt-6 pt-6 border-t border-slate-200 space-y-4"
          >
            {fileName && (
              <div className="p-3.5 rounded-md border border-blue-200 bg-blue-50/70 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-blue-950 truncate">
                    Ready to Open: {fileName} ({formatFileSize(fileSize)})
                  </div>
                  <div className="text-[11px] text-blue-800">
                    Review details below or click now to open the document and place the signature and notary stamp.
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-800 rounded-md hover:bg-blue-900 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {submitting
                    ? 'Opening Document...'
                    : 'Open Document to Sign & Stamp'}
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500 mr-1">
                Load Legal Template:
              </span>
              {LEGAL_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => void handleSelectTemplate(tpl.id)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  {tpl.title}
                </button>
              ))}
            </div>

            {intakeError && (
              <div className="px-3.5 py-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
                {intakeError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Document Title
                </label>
                <input
                  type="text"
                  required
                  maxLength={MAX_TITLE_LEN}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Durable Power of Attorney"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Destination Folder
                </label>
                <select
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                >
                  <option value="">Unfiled</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Notarial Act Type
                </label>
                <select
                  value={actType}
                  onChange={(e) => setActType(e.target.value as NotarialActType)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                >
                  <option value="Acknowledgment">Acknowledgment</option>
                  <option value="Jurat">Jurat</option>
                  <option value="Copy Certification">Copy Certification</option>
                  <option value="Oath / Affirmation">Oath / Affirmation</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Principal Signer Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Signer Email
                </label>
                <input
                  type="email"
                  required
                  maxLength={120}
                  value={signerEmail}
                  onChange={(e) => setSignerEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Notarization Mode
                </label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md">
                  <button
                    type="button"
                    onClick={() => setNotarizationMode('online')}
                    className={`py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                      notarizationMode === 'online'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Online (RON)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotarizationMode('in_person')}
                    className={`py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                      notarizationMode === 'in_person'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    In-Person
                  </button>
                </div>
              </div>

              {notarizationMode === 'in_person' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Physical Signing Venue / Address
                  </label>
                  <input
                    type="text"
                    maxLength={160}
                    value={meetingLocation}
                    onChange={(e) => setMeetingLocation(e.target.value)}
                    placeholder="450 Mission St, San Francisco, CA"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Detected File &amp; Digest
                </label>
                <div className="px-3 py-2 text-xs font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded-md truncate tabular-nums">
                  {fileName
                    ? `${fileName} (${formatFileSize(fileSize)})`
                    : 'Plain text instrument'}
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-700 mb-2">
                Official Emblems &amp; Marks (Optional — choose whether to affix)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label
                  className={`flex items-center justify-between gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                    includeCertifiedLogo
                      ? 'border-blue-800 bg-blue-50/40'
                      : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={includeCertifiedLogo}
                      onChange={(e) => setIncludeCertifiedLogo(e.target.checked)}
                      className="mt-0.5 accent-blue-800"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        Add &ldquo;VeriSeal Certified&rdquo; Logo
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Affixes the VeriSeal Certified seal to the document &amp; certificate.
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 scale-90 origin-right">
                    <VeriSealCertifiedLogo compact />
                  </div>
                </label>

                <label
                  className={`flex items-center justify-between gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                    includeNotarizedMark
                      ? 'border-emerald-700 bg-emerald-50/40'
                      : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={includeNotarizedMark}
                      onChange={(e) => setIncludeNotarizedMark(e.target.checked)}
                      className="mt-0.5 accent-emerald-700"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        Add &ldquo;Notarized&rdquo; Official Mark
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Displays the framed NOTARIZED verification stamp upon sealing.
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 origin-right scale-[0.65]">
                    <VeriSealNotarizedMark certificateCode="OFFICIAL MARK" />
                  </div>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Document Text / Extracted Instrument Content
              </label>
              <textarea
                rows={5}
                required
                value={documentText}
                onChange={(e) => {
                  setDocumentText(e.target.value);
                  setDocumentHash('');
                }}
                placeholder="Upload a PDF/DOCX/TXT above or paste the legal instrument text..."
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
              />
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowIntake(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 text-xs font-semibold text-white bg-blue-800 rounded-md hover:bg-blue-900 disabled:opacity-50 cursor-pointer"
              >
                {submitting
                  ? 'Opening & Hashing...'
                  : 'Open Document to Sign & Stamp'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Folder Organization & Document Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Folder Directory Rail */}
        <div className="lg:col-span-3 border border-slate-200 bg-white rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
              Document Folders
            </h3>
            <button
              type="button"
              onClick={() => setShowNewFolderInput((v) => !v)}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
              title="Create new folder"
              aria-label="Create new folder"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          {showNewFolderInput && (
            <form onSubmit={handleFolderCreate} className="flex gap-1.5">
              <input
                type="text"
                autoFocus
                maxLength={MAX_FOLDER_NAME_LEN}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name..."
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-800"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 cursor-pointer"
              >
                Add
              </button>
            </form>
          )}

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => onSelectFolder('all')}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                activeFolderId === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                <Folder className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">All Documents</span>
              </span>
              <span className="tabular-nums opacity-75">{cases.length}</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectFolder('unfiled')}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                activeFolderId === 'unfiled'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                <Folder className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Unfiled</span>
              </span>
              <span className="tabular-nums opacity-75">
                {cases.filter((c) => !c.folderId || c.folderId === 'unfiled').length}
              </span>
            </button>

            {folders.map((folder) => {
              const count = cases.filter((c) => c.folderId === folder.id).length;
              const isSelected = activeFolderId === folder.id;
              return (
                <div key={folder.id} className="group flex items-center gap-1">
                  {editingFolderId === folder.id ? (
                    <div className="flex-1 flex items-center gap-1">
                      <input
                        type="text"
                        autoFocus
                        maxLength={MAX_FOLDER_NAME_LEN}
                        value={editingFolderName}
                        onChange={(e) => setEditingFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void handleFolderRenameSubmit(folder.id);
                          }
                          if (e.key === 'Escape') setEditingFolderId(null);
                        }}
                        className="flex-1 min-w-0 px-2 py-1 text-xs border border-blue-800 rounded"
                      />
                      <button
                        type="button"
                        onClick={() => void handleFolderRenameSubmit(folder.id)}
                        className="px-2 py-1 text-[11px] font-semibold bg-blue-800 text-white rounded cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onSelectFolder(folder.id)}
                        className={`flex-1 min-w-0 flex items-center justify-between px-3 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <Folder className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{folder.name}</span>
                        </span>
                        <span className="tabular-nums opacity-75 ml-2">
                          {count}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingFolderId(folder.id);
                          setEditingFolderName(folder.name);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        title="Rename folder"
                        aria-label={`Rename ${folder.name}`}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteFolder(folder.id)}
                        className="p-1 text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        title="Delete folder"
                        aria-label={`Delete ${folder.name}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Document Queue & Progress Table */}
        <div className="lg:col-span-9 border border-slate-200 bg-white rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search documents, signers, certificates..."
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                {(
                  [
                    ['all', 'All Modes'],
                    ['online', 'Online'],
                    ['in_person', 'In-Person'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setModeFilter(key)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      modeFilter === key
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md overflow-x-auto">
                {(
                  [
                    ['all', 'All'],
                    ['draft', 'Draft'],
                    ['identity_verified', 'ID Verified'],
                    ['signed', 'Signed'],
                    ['notarized', 'Notarized'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatusFilter(key)}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      statusFilter === key
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredCases.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-900">
                No documents match this view
              </h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Upload a PDF, DOCX, or text document, or switch folders to view your notarization requests.
              </p>
              <button
                type="button"
                onClick={() => setShowIntake(true)}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Start New Notarization
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Document &amp; File</th>
                    <th className="py-3 px-3">Folder</th>
                    <th className="py-3 px-3">Signer &amp; Act</th>
                    <th className="py-3 px-3">Progress</th>
                    <th className="py-3 px-3">SHA-256</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredCases.map((docItem) => {
                    const step = PROGRESS_STEP[docItem.status];
                    return (
                      <tr
                        key={docItem.id}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        <td className="py-3.5 px-4 max-w-[260px]">
                          <button
                            type="button"
                            onClick={() => onOpenCase(docItem.id)}
                            className="font-medium text-slate-900 hover:text-blue-800 text-left truncate block w-full cursor-pointer"
                          >
                            {docItem.title}
                          </button>
                          <div className="mt-0.5 text-xs text-slate-500 truncate tabular-nums">
                            {docItem.fileName} · {formatFileSize(docItem.fileSize)}
                          </div>
                        </td>

                        <td className="py-3.5 px-3">
                          {docItem.status === 'notarized' ? (
                            <span className="text-xs text-slate-600">
                              {folders.find((f) => f.id === docItem.folderId)?.name ||
                                'Unfiled'}
                            </span>
                          ) : (
                            <select
                              aria-label={`Move ${docItem.title} to folder`}
                              value={docItem.folderId || 'unfiled'}
                              onChange={(e) =>
                                void onMoveCaseFolder(docItem.id, e.target.value)
                              }
                              className="text-xs text-slate-700 bg-white border border-slate-200 rounded px-2 py-1 max-w-[140px]"
                            >
                              <option value="unfiled">Unfiled</option>
                              {folders.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="text-xs font-medium text-slate-900">
                            {docItem.signerName}
                          </div>
                          <div className="text-xs text-slate-500">
                            {docItem.actType} ·{' '}
                            {docItem.notarizationMode === 'in_person'
                              ? 'In-Person'
                              : 'Online RON'}
                          </div>
                        </td>

                        <td className="py-3.5 px-3 min-w-[155px]">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span
                              className={`font-medium ${
                                docItem.status === 'notarized'
                                  ? 'text-emerald-700'
                                  : docItem.status === 'signed'
                                  ? 'text-blue-800'
                                  : 'text-amber-700'
                              }`}
                            >
                              {STATUS_LABELS[docItem.status]}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                              {step}/4
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-1 h-1.5">
                            {[1, 2, 3, 4].map((idx) => (
                              <div
                                key={idx}
                                className={`rounded-xs ${
                                  idx <= step
                                    ? docItem.status === 'notarized'
                                      ? 'bg-emerald-600'
                                      : 'bg-blue-800'
                                    : 'bg-slate-200'
                                }`}
                              />
                            ))}
                          </div>
                        </td>

                        <td className="py-3.5 px-3 font-mono text-xs text-slate-500 tabular-nums">
                          {docItem.documentHash.slice(0, 12)}…
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onOpenCase(docItem.id)}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              {docItem.status === 'notarized'
                                ? 'View Certificate'
                                : 'Open & Sign / Stamp'}
                            </button>
                            {docItem.status !== 'notarized' && (
                              <button
                                type="button"
                                onClick={() => void onDeleteCase(docItem.id)}
                                className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors cursor-pointer"
                                title="Delete draft"
                                aria-label={`Delete ${docItem.title}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
