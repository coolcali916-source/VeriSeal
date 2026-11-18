import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  FileCheck2,
  FolderKanban,
  Menu,
  RefreshCw,
  ShieldCheck,
  Stamp,
  UserCircle2,
  X,
} from 'lucide-react';
import {
  apiCreateCase,
  apiCreateFolder,
  apiDeleteCase,
  apiDeleteFolder,
  apiRenameFolder,
  apiSaveProfile,
  apiSealCase,
  apiUpdateCase,
  apiUploadCaseFile,
  authLogout,
  authMe,
  fetchWorkspace,
  type AuthUser,
} from './lib/localApi';
import {
  computeCustodyEventHash,
  generateAndSignNotarization,
  sha256Hex,
} from './lib/crypto';
import { DEFAULT_FOLDER_NAMES, LEGAL_TEMPLATES } from './lib/templates';
import {
  DEFAULT_DOCUMENT_PLACEMENT,
  type AppView,
  type CustodyEvent,
  type DocumentFolder,
  type DocumentPlacement,
  type JournalEntry,
  type NotarialActType,
  type NotarizationCase,
  type NotarizationMode,
  type SignatureType,
  type UserProfile,
  type VerificationRecord,
} from './types/notary';
import {
  deleteLocalDocumentFile,
  saveLocalDocumentFile,
} from './lib/localFileStore';
import { AuthModal } from './components/AuthModal';
import { DocumentManagerView } from './components/DocumentManagerView';
import { SigningRoomView } from './components/SigningRoomView';
import { JournalView } from './components/JournalView';
import { VerifyPortalView } from './components/VerifyPortalView';
import { ProfileView } from './components/ProfileView';
import { VeriSealBrandIcon } from './components/VeriSealEmblems';
import {
  applyAppUpdate,
  checkForAppUpdate,
  clearUpdateQueryParam,
  CURRENT_APP_BUILD,
  getSavedGitHubTarget,
  runGitHubAppUpdate,
  saveGitHubConfigOnServer,
  type AppVersionManifest,
  type GitHubUpdateStatus,
} from './lib/appUpdater';

function makeId(prefix: string): string {
  const bytes = new Uint8Array(5);
  window.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}_${hex}`;
}

const DEFAULT_PROFILE: UserProfile = {
  uid: 'local_preview',
  displayName: 'Elena Vance',
  email: 'elena.vance@veriseal.example',
  phone: '+1 (415) 555-0192',
  location: 'San Francisco, CA',
  commissionNumber: 'CA-2491804',
  commissionJurisdiction: 'State of California',
  commissionExpires: '2028-09-30',
  customStampDataUrl: '',
  savedSignatureData: '',
  savedSignatureType: 'none',
};

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [hasAnyUsers, setHasAnyUsers] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [activeView, setActiveView] = useState<AppView>('documents');
  const [activeFolderId, setActiveFolderId] = useState<string>('all');
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [verifyCodePreset, setVerifyCodePreset] = useState<string>('');

  // Workspace Data
  const [userProfile, setUserProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [cases, setCases] = useState<NotarizationCase[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [custodyByCase, setCustodyByCase] = useState<
    Record<string, CustodyEvent[]>
  >({});
  const [localVerifications, setLocalVerifications] = useState<
    Record<string, VerificationRecord>
  >({});
  const [previewUrlsByCase, setPreviewUrlsByCase] = useState<
    Record<string, string>
  >({});

  // App Update State
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [remoteBuild, setRemoteBuild] = useState<AppVersionManifest | null>(null);
  const [githubStatus, setGithubStatus] = useState<GitHubUpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateNotice, setUpdateNotice] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [githubRepoInput, setGithubRepoInput] = useState(
    () => getSavedGitHubTarget().repo || ''
  );
  const [githubBranchInput, setGithubBranchInput] = useState(
    () => getSavedGitHubTarget().branch || 'main'
  );

  // Clean _upd param & poll GitHub / /version.json for new deployments
  useEffect(() => {
    clearUpdateQueryParam();
    let lastChecked = 0;

    const runSilentCheck = async () => {
      const now = Date.now();
      if (now - lastChecked < 30000) return;
      lastChecked = now;
      const result = await checkForAppUpdate();
      if (result.remoteBuild) {
        setRemoteBuild(result.remoteBuild);
      }
      if (result.githubStatus) {
        setGithubStatus(result.githubStatus);
        if (result.githubStatus.repoSlug && !githubRepoInput) {
          setGithubRepoInput(result.githubStatus.repoSlug);
        }
        if (result.githubStatus.branch) {
          setGithubBranchInput(result.githubStatus.branch);
        }
      }
      if (result.updateAvailable) {
        setUpdateAvailable(true);
      }
    };

    void runSilentCheck();
    const timer = window.setInterval(() => void runSilentCheck(), 5 * 60 * 1000);
    const onFocus = () => void runSilentCheck();
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Check self-hosted VPS session on startup
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await authMe();
        if (cancelled) return;
        setAuthUser(res.user);
        setHasAnyUsers(res.hasAnyUsers);
      } catch (err) {
        console.error('Auth session check failed:', err);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize Local Preview Mode when signed out
  useEffect(() => {
    if (!authReady || authUser) return;

    let cancelled = false;
    const initSandbox = async () => {
      const nowIso = new Date().toISOString();
      const seedFolders: DocumentFolder[] = DEFAULT_FOLDER_NAMES.map(
        (name, idx) => ({
          id: `fld_demo_${idx + 1}`,
          ownerId: 'local_preview',
          name,
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
        })
      );

      const tpl1 = LEGAL_TEMPLATES[0];
      const tpl2 = LEGAL_TEMPLATES[1];
      const hash1 = await sha256Hex(tpl1.body);
      const hash2 = await sha256Hex(tpl2.body);

      const case1Id = 'case_demo_poa';
      const case2Id = 'case_demo_deed';

      // Create one notarized sample with real ECDSA signature for immediate verification testing
      const sealResult = await generateAndSignNotarization({
        caseId: case2Id,
        documentTitle: tpl2.title,
        fileName: tpl2.fileName,
        fileSize: new Blob([tpl2.body]).size,
        documentHash: hash2,
        actType: tpl2.actType,
        notarizationMode: 'in_person',
        meetingLocation: '450 Mission St, San Francisco, CA',
        signerName: 'Jordan M. Mercer',
        notaryName: DEFAULT_PROFILE.displayName,
        notaryCommission: DEFAULT_PROFILE.commissionNumber,
        notaryJurisdiction: DEFAULT_PROFILE.commissionJurisdiction,
      });

      if (cancelled) return;

      const demoCases: NotarizationCase[] = [
        {
          id: case1Id,
          ownerId: 'local_preview',
          folderId: seedFolders[2].id,
          title: tpl1.title,
          fileName: tpl1.fileName,
          fileType: 'text/plain',
          fileSize: new Blob([tpl1.body]).size,
          actType: tpl1.actType,
          notarizationMode: 'online',
          meetingLocation: 'Remote Audio-Video Session',
          status: 'draft',
          signerName: 'Marcus Chen',
          signerEmail: 'marcus.chen@example.com',
          documentText: tpl1.body,
          documentHash: hash1,
          idMethod: 'Government Photo ID + KBA',
          idScore: 0,
          kbaPassed: false,
          signerSignatureData: '',
          signatureType: 'none',
          notaryName: '',
          notaryCommission: '',
          notaryJurisdiction: '',
          notaryExpires: '',
          notaryStampDataUrl: '',
          includeCertifiedLogo: true,
          includeNotarizedMark: true,
          placement: DEFAULT_DOCUMENT_PLACEMENT,
          certificateCode: '',
          sealedHash: '',
          signatureAlgorithm: '',
          publicKeyJwk: '',
          digitalSignature: '',
          signedPayload: '',
          timestampIso: '',
          feeCents: tpl1.feeCents,
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
        },
        {
          id: case2Id,
          ownerId: 'local_preview',
          folderId: seedFolders[0].id,
          title: tpl2.title,
          fileName: tpl2.fileName,
          fileType: 'text/plain',
          fileSize: new Blob([tpl2.body]).size,
          actType: tpl2.actType,
          notarizationMode: 'in_person',
          meetingLocation: '450 Mission St, San Francisco, CA',
          status: 'notarized',
          signerName: 'Jordan M. Mercer',
          signerEmail: 'jordan.mercer@example.com',
          documentText: tpl2.body,
          documentHash: hash2,
          idMethod: 'Physical Government Photo ID',
          idScore: 100,
          kbaPassed: true,
          signerSignatureData: 'Jordan M. Mercer',
          signatureType: 'typed',
          notaryName: DEFAULT_PROFILE.displayName,
          notaryCommission: DEFAULT_PROFILE.commissionNumber,
          notaryJurisdiction: DEFAULT_PROFILE.commissionJurisdiction,
          notaryExpires: DEFAULT_PROFILE.commissionExpires,
          notaryStampDataUrl: '',
          includeCertifiedLogo: true,
          includeNotarizedMark: true,
          placement: DEFAULT_DOCUMENT_PLACEMENT,
          certificateCode: sealResult.certificateCode,
          sealedHash: sealResult.sealedHash,
          signatureAlgorithm: sealResult.signatureAlgorithm,
          publicKeyJwk: sealResult.publicKeyJwk,
          digitalSignature: sealResult.digitalSignature,
          signedPayload: sealResult.signedPayload,
          timestampIso: sealResult.timestampIso,
          feeCents: tpl2.feeCents,
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
          notarizedAtIso: sealResult.timestampIso,
        },
      ];

      const evHash1 = await computeCustodyEventHash(
        'GENESIS',
        'Document Uploaded & Hashed',
        'Jordan M. Mercer',
        `${tpl2.fileName} ingested (SHA-256)`,
        nowIso
      );
      const evHash2 = await computeCustodyEventHash(
        evHash1,
        'Notary Seal & ECDSA Timestamp Applied',
        DEFAULT_PROFILE.displayName,
        `Certificate ${sealResult.certificateCode} sealed`,
        sealResult.timestampIso
      );

      setFolders(seedFolders);
      setCases(demoCases);
      setActiveCaseId(case1Id);
      setCustodyByCase({
        [case1Id]: [
          {
            id: 'ev_demo_1',
            ownerId: 'local_preview',
            caseId: case1Id,
            step: 'Document Uploaded & Hashed',
            actor: 'Marcus Chen',
            details: `${tpl1.fileName} ingested with SHA-256 digest`,
            eventHash: await computeCustodyEventHash(
              'GENESIS',
              'Document Uploaded & Hashed',
              'Marcus Chen',
              tpl1.fileName,
              nowIso
            ),
            recordedAtIso: nowIso,
          },
        ],
        [case2Id]: [
          {
            id: 'ev_demo_2a',
            ownerId: 'local_preview',
            caseId: case2Id,
            step: 'Document Uploaded & Hashed',
            actor: 'Jordan M. Mercer',
            details: `${tpl2.fileName} ingested (SHA-256)`,
            eventHash: evHash1,
            recordedAtIso: nowIso,
          },
          {
            id: 'ev_demo_2b',
            ownerId: 'local_preview',
            caseId: case2Id,
            step: 'Notary Seal & ECDSA Timestamp Applied',
            actor: DEFAULT_PROFILE.displayName,
            details: `Certificate ${sealResult.certificateCode} sealed`,
            eventHash: evHash2,
            recordedAtIso: sealResult.timestampIso,
          },
        ],
      });
      setJournalEntries([
        {
          id: 'jrn_demo_1',
          ownerId: 'local_preview',
          caseId: case2Id,
          entryNumber: 'NJ-2026-0001',
          documentTitle: tpl2.title,
          fileName: tpl2.fileName,
          actType: tpl2.actType,
          notarizationMode: 'in_person',
          meetingLocation: '450 Mission St, San Francisco, CA',
          signerName: 'Jordan M. Mercer',
          idMethod: 'Physical Government Photo ID',
          certificateCode: sealResult.certificateCode,
          sealedHash: sealResult.sealedHash,
          timestampIso: sealResult.timestampIso,
          feeCents: tpl2.feeCents,
          recordedAtIso: sealResult.timestampIso,
        },
      ]);
      setLocalVerifications({
        [sealResult.certificateCode]: {
          certificateCode: sealResult.certificateCode,
          ownerId: 'local_preview',
          caseId: case2Id,
          documentTitle: tpl2.title,
          fileName: tpl2.fileName,
          fileSize: new Blob([tpl2.body]).size,
          actType: tpl2.actType,
          notarizationMode: 'in_person',
          meetingLocation: '450 Mission St, San Francisco, CA',
          documentHash: hash2,
          sealedHash: sealResult.sealedHash,
          signatureAlgorithm: sealResult.signatureAlgorithm,
          publicKeyJwk: sealResult.publicKeyJwk,
          digitalSignature: sealResult.digitalSignature,
          signedPayload: sealResult.signedPayload,
          timestampIso: sealResult.timestampIso,
          notaryName: DEFAULT_PROFILE.displayName,
          notaryCommission: DEFAULT_PROFILE.commissionNumber,
          notaryJurisdiction: DEFAULT_PROFILE.commissionJurisdiction,
          notaryExpires: DEFAULT_PROFILE.commissionExpires,
          notarizedAtIso: sealResult.timestampIso,
        },
      });
    };

    void initSandbox();
    return () => {
      cancelled = true;
    };
  }, [authReady, authUser]);

  // Load Self-Hosted VPS Workspace when authenticated
  useEffect(() => {
    if (!authReady || !authUser) return;
    let cancelled = false;

    const loadWorkspace = async () => {
      try {
        const snap = await fetchWorkspace();
        if (cancelled) return;
        setUserProfile(snap.profile);
        setFolders(snap.folders);
        setCases(snap.cases);
        setJournalEntries(snap.journalEntries);
        setCustodyByCase(snap.custodyByCase);
        setLocalVerifications(snap.verifications);
        setActiveCaseId((prev) =>
          prev && snap.cases.some((c) => c.id === prev)
            ? prev
            : snap.cases[0]?.id || null
        );
      } catch (err) {
        console.error('Failed to load self-hosted workspace:', err);
      }
    };

    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [authReady, authUser]);

  const activeCase = useMemo(
    () => cases.find((c) => c.id === activeCaseId) || null,
    [cases, activeCaseId]
  );

  // Handlers
  const handleCreateFolder = async (name: string) => {
    const id = makeId('fld');
    const safeName = name.trim().slice(0, 60) || 'Untitled Folder';
    const nowIso = new Date().toISOString();
    if (authUser) {
      const folder = await apiCreateFolder(safeName, id);
      setFolders((prev) =>
        [...prev, folder].sort((a, b) => a.name.localeCompare(b.name))
      );
    } else {
      setFolders((prev) => [
        ...prev,
        {
          id,
          ownerId: 'local_preview',
          name: safeName,
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
        },
      ]);
    }
  };

  const handleRenameFolder = async (folderId: string, name: string) => {
    const safeName = name.trim().slice(0, 60) || 'Untitled Folder';
    if (authUser) {
      const updated = await apiRenameFolder(folderId, safeName);
      setFolders((prev) =>
        prev
          .map((f) => (f.id === folderId ? updated : f))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } else {
      setFolders((prev) =>
        prev.map((f) =>
          f.id === folderId
            ? { ...f, name: safeName, updatedAtIso: new Date().toISOString() }
            : f
        )
      );
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (authUser) {
      await apiDeleteFolder(folderId);
    }
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    if (activeFolderId === folderId) setActiveFolderId('all');
  };

  const handleCreateCase = async (payload: {
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
  }) => {
    const caseId = makeId('case');
    const eventId = makeId('ev');
    const nowIso = new Date().toISOString();
    const evHash = await computeCustodyEventHash(
      'GENESIS',
      'Document Uploaded & Hashed',
      payload.signerName,
      `${payload.fileName} (${payload.documentHash.slice(0, 12)})`,
      nowIso
    );

    if (payload.previewObjectUrl) {
      setPreviewUrlsByCase((prev) => ({
        ...prev,
        [caseId]: payload.previewObjectUrl!,
      }));
    }
    if (payload.uploadedFile) {
      await saveLocalDocumentFile(caseId, payload.documentHash, payload.uploadedFile);
    }

    if (authUser) {
      const created = await apiCreateCase({
        id: caseId,
        folderId: payload.folderId || 'unfiled',
        title: payload.title,
        fileName: payload.fileName,
        fileType: payload.fileType,
        fileSize: payload.fileSize,
        actType: payload.actType,
        notarizationMode: payload.notarizationMode,
        meetingLocation: payload.meetingLocation,
        signerName: payload.signerName,
        signerEmail: payload.signerEmail,
        documentText: payload.documentText,
        documentHash: payload.documentHash,
        feeCents: payload.feeCents,
        includeCertifiedLogo: payload.includeCertifiedLogo,
        includeNotarizedMark: payload.includeNotarizedMark,
        placement: DEFAULT_DOCUMENT_PLACEMENT,
        custodyEvent: {
          id: eventId,
          step: 'Document Uploaded & Hashed',
          actor: payload.signerName,
          details: `Ingested ${payload.fileName} (${
            payload.notarizationMode === 'in_person' ? 'In-Person' : 'Online RON'
          })`,
          eventHash: evHash,
        },
      });
      if (payload.uploadedFile) {
        await apiUploadCaseFile(caseId, payload.uploadedFile);
      }
      setCases((prev) => [created.caseRecord, ...prev]);
      setCustodyByCase((prev) => ({
        ...prev,
        [caseId]: [created.custodyRecord],
      }));
    } else {
      const optimisticCase: NotarizationCase = {
        id: caseId,
        ownerId: 'local_preview',
        folderId: payload.folderId || 'unfiled',
        title: payload.title,
        fileName: payload.fileName,
        fileType: payload.fileType,
        fileSize: payload.fileSize,
        actType: payload.actType,
        notarizationMode: payload.notarizationMode,
        meetingLocation: payload.meetingLocation,
        status: 'draft',
        signerName: payload.signerName,
        signerEmail: payload.signerEmail,
        documentText: payload.documentText,
        documentHash: payload.documentHash,
        idMethod:
          payload.notarizationMode === 'in_person'
            ? 'Physical Government Photo ID'
            : 'Government Photo ID + KBA',
        idScore: 0,
        kbaPassed: false,
        signerSignatureData: '',
        signatureType: 'none',
        notaryName: '',
        notaryCommission: '',
        notaryJurisdiction: '',
        notaryExpires: '',
        notaryStampDataUrl: '',
        includeCertifiedLogo: payload.includeCertifiedLogo,
        includeNotarizedMark: payload.includeNotarizedMark,
        placement: DEFAULT_DOCUMENT_PLACEMENT,
        certificateCode: '',
        sealedHash: '',
        signatureAlgorithm: '',
        publicKeyJwk: '',
        digitalSignature: '',
        signedPayload: '',
        timestampIso: '',
        feeCents: payload.feeCents,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
      };
      setCases((prev) => [optimisticCase, ...prev]);
      setCustodyByCase((prev) => ({
        ...prev,
        [caseId]: [
          {
            id: eventId,
            ownerId: 'local_preview',
            caseId,
            step: 'Document Uploaded & Hashed',
            actor: payload.signerName,
            details: `Ingested ${payload.fileName} (${
              payload.notarizationMode === 'in_person'
                ? 'In-Person'
                : 'Online RON'
            })`,
            eventHash: evHash,
            recordedAtIso: nowIso,
          },
        ],
      }));
    }

    setActiveCaseId(caseId);
    setActiveView('signing_room');
  };

  const handleMoveCaseFolder = async (caseId: string, folderId: string) => {
    if (authUser && !caseId.startsWith('case_demo_')) {
      const res = await apiUpdateCase(caseId, { folderId });
      setCases((prev) =>
        prev.map((c) => (c.id === caseId ? res.caseRecord : c))
      );
    } else {
      setCases((prev) =>
        prev.map((c) =>
          c.id === caseId
            ? { ...c, folderId, updatedAtIso: new Date().toISOString() }
            : c
        )
      );
    }
  };

  const handleDeleteCase = async (caseId: string) => {
    void deleteLocalDocumentFile(caseId);
    if (authUser && !caseId.startsWith('case_demo_')) {
      await apiDeleteCase(caseId);
    }
    setCases((prev) => prev.filter((c) => c.id !== caseId));
    if (activeCaseId === caseId) setActiveCaseId(null);
  };

  const handleChangeMode = async (
    caseId: string,
    mode: NotarizationMode,
    meetingLocation: string
  ) => {
    const target = cases.find((c) => c.id === caseId);
    if (!target || target.status === 'notarized') return;

    const rawLocation =
      mode === 'in_person'
        ? meetingLocation && meetingLocation !== 'Remote Audio-Video Session'
          ? meetingLocation
          : userProfile.location || 'San Francisco County, CA'
        : 'Remote Audio-Video Session';
    const normalizedLocation =
      rawLocation.trim().slice(0, 155) || 'San Francisco County, CA';

    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? {
              ...c,
              notarizationMode: mode,
              meetingLocation: normalizedLocation,
              updatedAtIso: new Date().toISOString(),
            }
          : c
      )
    );

    if (authUser && !caseId.startsWith('case_demo_')) {
      try {
        const res = await apiUpdateCase(caseId, {
          notarizationMode: mode,
          meetingLocation: normalizedLocation,
        });
        setCases((prev) =>
          prev.map((c) => (c.id === caseId ? res.caseRecord : c))
        );
      } catch (err) {
        setCases((prev) => prev.map((c) => (c.id === caseId ? target : c)));
        throw err;
      }
    }
  };

  const handleCompleteIdentity = async (
    caseId: string,
    idMethod: string,
    idScore: number,
    meetingLocation: string
  ) => {
    const target = cases.find((c) => c.id === caseId);
    if (!target || target.status === 'notarized') return;

    const safeIdMethod =
      idMethod.trim().slice(0, 75) || 'Government Photo ID + KBA';
    const safeScore = Math.max(80, Math.min(100, Math.round(Number(idScore) || 100)));
    const safeLocation =
      meetingLocation.trim().slice(0, 155) ||
      (target.notarizationMode === 'in_person'
        ? userProfile.location || 'San Francisco County, CA'
        : 'Remote Audio-Video Session');

    const stepLabel =
      target.notarizationMode === 'in_person'
        ? 'Physical Presence & ID Verified'
        : 'Identity & KBA Verified';
    const detailsText = `${safeIdMethod} (${safeLocation}) verified at ${safeScore}%`;
    const existingEvents = custodyByCase[caseId] || [];
    const prevHash =
      existingEvents.length > 0
        ? existingEvents[existingEvents.length - 1].eventHash
        : 'GENESIS';
    const nowIso = new Date().toISOString();
    const eventHash = await computeCustodyEventHash(
      prevHash,
      stepLabel,
      target.signerName,
      detailsText,
      nowIso
    );

    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? {
              ...c,
              status: 'identity_verified',
              idMethod: safeIdMethod,
              idScore: safeScore,
              kbaPassed: true,
              meetingLocation: safeLocation,
              updatedAtIso: nowIso,
            }
          : c
      )
    );

    if (authUser && !caseId.startsWith('case_demo_')) {
      try {
        const res = await apiUpdateCase(caseId, {
          status: 'identity_verified',
          idMethod: safeIdMethod,
          idScore: safeScore,
          kbaPassed: true,
          meetingLocation: safeLocation,
          custodyEvent: {
            step: stepLabel,
            actor: target.signerName,
            details: detailsText,
            eventHash,
          },
        });
        setCases((prev) =>
          prev.map((c) => (c.id === caseId ? res.caseRecord : c))
        );
        if (res.custodyRecord) {
          setCustodyByCase((prev) => ({
            ...prev,
            [caseId]: [...(prev[caseId] || []), res.custodyRecord!],
          }));
        }
      } catch (err) {
        setCases((prev) => prev.map((c) => (c.id === caseId ? target : c)));
        throw err;
      }
    } else {
      setCustodyByCase((prev) => ({
        ...prev,
        [caseId]: [
          ...(prev[caseId] || []),
          {
            id: makeId('ev'),
            ownerId: 'local_preview',
            caseId,
            step: stepLabel,
            actor: target.signerName,
            details: detailsText,
            eventHash,
            recordedAtIso: nowIso,
          },
        ],
      }));
    }
  };

  const handleApplySignature = async (
    caseId: string,
    signatureData: string,
    signatureType: SignatureType
  ) => {
    const target = cases.find((c) => c.id === caseId);
    if (!target || target.status === 'notarized') return;
    if (!signatureData || signatureData.length > 180000) {
      throw new Error(
        'Signature image is too large. Please draw a simpler stroke or use a typed signature.'
      );
    }

    const stepLabel = 'Signer Electronic Signature Applied';
    const detailsText = `Captured ${signatureType} electronic signature`;
    const existingEvents = custodyByCase[caseId] || [];
    const prevHash =
      existingEvents.length > 0
        ? existingEvents[existingEvents.length - 1].eventHash
        : 'GENESIS';
    const nowIso = new Date().toISOString();
    const eventHash = await computeCustodyEventHash(
      prevHash,
      stepLabel,
      target.signerName,
      detailsText,
      nowIso
    );

    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? {
              ...c,
              status: 'signed',
              signerSignatureData: signatureData,
              signatureType,
              updatedAtIso: nowIso,
            }
          : c
      )
    );

    if (authUser && !caseId.startsWith('case_demo_')) {
      try {
        const res = await apiUpdateCase(caseId, {
          status: 'signed',
          signerSignatureData: signatureData,
          signatureType,
          custodyEvent: {
            step: stepLabel,
            actor: target.signerName,
            details: detailsText,
            eventHash,
          },
        });
        setCases((prev) =>
          prev.map((c) => (c.id === caseId ? res.caseRecord : c))
        );
        if (res.custodyRecord) {
          setCustodyByCase((prev) => ({
            ...prev,
            [caseId]: [...(prev[caseId] || []), res.custodyRecord!],
          }));
        }
      } catch (err) {
        setCases((prev) => prev.map((c) => (c.id === caseId ? target : c)));
        throw err;
      }
    } else {
      setCustodyByCase((prev) => ({
        ...prev,
        [caseId]: [
          ...(prev[caseId] || []),
          {
            id: makeId('ev'),
            ownerId: 'local_preview',
            caseId,
            step: stepLabel,
            actor: target.signerName,
            details: detailsText,
            eventHash,
            recordedAtIso: nowIso,
          },
        ],
      }));
    }
  };

  const handleToggleEmblems = async (
    caseId: string,
    includeCertifiedLogo: boolean,
    includeNotarizedMark: boolean
  ) => {
    const target = cases.find((c) => c.id === caseId);
    if (!target || target.status === 'notarized') return;

    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? {
              ...c,
              includeCertifiedLogo,
              includeNotarizedMark,
              updatedAtIso: new Date().toISOString(),
            }
          : c
      )
    );

    if (authUser && !caseId.startsWith('case_demo_')) {
      try {
        const res = await apiUpdateCase(caseId, {
          includeCertifiedLogo,
          includeNotarizedMark,
        });
        setCases((prev) =>
          prev.map((c) => (c.id === caseId ? res.caseRecord : c))
        );
      } catch (err) {
        setCases((prev) => prev.map((c) => (c.id === caseId ? target : c)));
        throw err;
      }
    }
  };

  const handleUpdatePlacement = async (
    caseId: string,
    placement: DocumentPlacement
  ) => {
    const target = cases.find((c) => c.id === caseId);
    if (!target || target.status === 'notarized') return;

    const sanitizeBox = (box: DocumentPlacement['signature']) => ({
      page: Math.max(1, Math.min(500, Math.round(Number(box.page) || 1))),
      xPct: Math.max(
        0,
        Math.min(100, Math.round((Number(box.xPct) || 50) * 10) / 10)
      ),
      yPct: Math.max(
        0,
        Math.min(100, Math.round((Number(box.yPct) || 50) * 10) / 10)
      ),
      scale: Math.max(
        0.4,
        Math.min(2.5, Math.round((Number(box.scale) || 1) * 100) / 100)
      ),
    });

    const sanitized: DocumentPlacement = {
      signature: sanitizeBox(placement.signature),
      stamp: sanitizeBox(placement.stamp),
    };

    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? { ...c, placement: sanitized, updatedAtIso: new Date().toISOString() }
          : c
      )
    );

    if (authUser && !caseId.startsWith('case_demo_')) {
      await apiUpdateCase(caseId, { placement: sanitized });
    }
  };

  const handleNotarizeCase = async (
    caseId: string,
    useCustomTransparentStamp: boolean,
    includeCertifiedLogo: boolean,
    includeNotarizedMark: boolean
  ) => {
    const target = cases.find((c) => c.id === caseId);
    if (!target) return;

    const notaryName =
      (userProfile.displayName || '').trim().slice(0, 100) || 'Elena Vance';
    const notaryCommission =
      (userProfile.commissionNumber || '').trim().slice(0, 60) || 'CA-2491804';
    const notaryJurisdiction =
      (userProfile.commissionJurisdiction || '').trim().slice(0, 60) ||
      'State of California';
    const notaryExpires =
      (userProfile.commissionExpires || '').trim().slice(0, 30) || '2028-09-30';
    const stampUrl = useCustomTransparentStamp
      ? String(userProfile.customStampDataUrl || '').slice(0, 450000)
      : '';
    const safeTitle = target.title.trim().slice(0, 140) || 'Notarized Document';
    const safeFileName = target.fileName.trim().slice(0, 180) || 'document.pdf';
    const safeSignerName = target.signerName.trim().slice(0, 100) || 'Principal Signer';
    const safeLocation = (target.meetingLocation || '').trim().slice(0, 160);

    const sealResult = await generateAndSignNotarization({
      caseId: target.id,
      documentTitle: safeTitle,
      fileName: safeFileName,
      fileSize: target.fileSize,
      documentHash: target.documentHash,
      actType: target.actType,
      notarizationMode: target.notarizationMode,
      meetingLocation: safeLocation,
      signerName: safeSignerName,
      notaryName,
      notaryCommission,
      notaryJurisdiction,
    });

    const existingEvents = custodyByCase[caseId] || [];
    const prevHash =
      existingEvents.length > 0
        ? existingEvents[existingEvents.length - 1].eventHash
        : 'GENESIS';
    const evHash = await computeCustodyEventHash(
      prevHash,
      'Notary Seal & ECDSA Timestamp Applied',
      notaryName,
      `Certificate ${sealResult.certificateCode} signed (${sealResult.signatureAlgorithm})`,
      sealResult.timestampIso
    );

    if (authUser && !caseId.startsWith('case_demo_')) {
      const sealed = await apiSealCase(caseId, {
        notaryName,
        notaryCommission,
        notaryJurisdiction,
        notaryExpires,
        notaryStampDataUrl: stampUrl,
        includeCertifiedLogo,
        includeNotarizedMark,
        certificateCode: sealResult.certificateCode,
        sealedHash: sealResult.sealedHash,
        signatureAlgorithm: sealResult.signatureAlgorithm,
        publicKeyJwk: sealResult.publicKeyJwk,
        digitalSignature: sealResult.digitalSignature,
        signedPayload: sealResult.signedPayload,
        timestampIso: sealResult.timestampIso,
        custodyEventHash: evHash,
      });

      setCases((prev) =>
        prev.map((c) => (c.id === caseId ? sealed.caseRecord : c))
      );
      setJournalEntries((prev) => [sealed.journalRecord, ...prev]);
      setCustodyByCase((prev) => ({
        ...prev,
        [caseId]: [...(prev[caseId] || []), sealed.custodyRecord],
      }));
      setLocalVerifications((prev) => ({
        ...prev,
        [sealed.verificationRecord.certificateCode]: sealed.verificationRecord,
      }));
    } else {
      const entryId = makeId('jrn');
      const entryNumber = `NJ-2026-${String(journalEntries.length + 1).padStart(
        4,
        '0'
      )}`;
      const eventId = makeId('ev');
      setCases((prev) =>
        prev.map((c) =>
          c.id === caseId
            ? {
                ...c,
                status: 'notarized',
                notaryName,
                notaryCommission,
                notaryJurisdiction,
                notaryExpires,
                notaryStampDataUrl: stampUrl,
                includeCertifiedLogo,
                includeNotarizedMark,
                certificateCode: sealResult.certificateCode,
                sealedHash: sealResult.sealedHash,
                signatureAlgorithm: sealResult.signatureAlgorithm,
                publicKeyJwk: sealResult.publicKeyJwk,
                digitalSignature: sealResult.digitalSignature,
                signedPayload: sealResult.signedPayload,
                timestampIso: sealResult.timestampIso,
                updatedAtIso: sealResult.timestampIso,
                notarizedAtIso: sealResult.timestampIso,
              }
            : c
        )
      );
      setJournalEntries((prev) => [
        {
          id: entryId,
          ownerId: 'local_preview',
          caseId: target.id,
          entryNumber,
          documentTitle: target.title,
          fileName: target.fileName,
          actType: target.actType,
          notarizationMode: target.notarizationMode,
          meetingLocation: target.meetingLocation,
          signerName: target.signerName,
          idMethod: target.idMethod,
          certificateCode: sealResult.certificateCode,
          sealedHash: sealResult.sealedHash,
          timestampIso: sealResult.timestampIso,
          feeCents: target.feeCents,
          recordedAtIso: sealResult.timestampIso,
        },
        ...prev,
      ]);
      setCustodyByCase((prev) => ({
        ...prev,
        [caseId]: [
          ...(prev[caseId] || []),
          {
            id: eventId,
            ownerId: 'local_preview',
            caseId,
            step: 'Notary Seal & ECDSA Timestamp Applied',
            actor: notaryName,
            details: `Certificate ${sealResult.certificateCode} sealed & recorded in statutory journal`,
            eventHash: evHash,
            recordedAtIso: sealResult.timestampIso,
          },
        ],
      }));
      setLocalVerifications((prev) => ({
        ...prev,
        [sealResult.certificateCode]: {
          certificateCode: sealResult.certificateCode,
          ownerId: 'local_preview',
          caseId: target.id,
          documentTitle: target.title,
          fileName: target.fileName,
          fileSize: target.fileSize,
          actType: target.actType,
          notarizationMode: target.notarizationMode,
          meetingLocation: target.meetingLocation,
          documentHash: target.documentHash,
          sealedHash: sealResult.sealedHash,
          signatureAlgorithm: sealResult.signatureAlgorithm,
          publicKeyJwk: sealResult.publicKeyJwk,
          digitalSignature: sealResult.digitalSignature,
          signedPayload: sealResult.signedPayload,
          timestampIso: sealResult.timestampIso,
          notaryName,
          notaryCommission,
          notaryJurisdiction,
          notaryExpires,
          notarizedAtIso: sealResult.timestampIso,
        },
      }));
    }
  };

  const handleSaveProfile = async (next: UserProfile) => {
    const sigType: SignatureType =
      next.savedSignatureType === 'drawn' || next.savedSignatureType === 'typed'
        ? next.savedSignatureType
        : 'none';
    const sigData =
      sigType === 'none'
        ? ''
        : String(next.savedSignatureData || '').slice(0, 450000);
    const payloadFields = {
      displayName: next.displayName.trim().slice(0, 120) || 'Notary User',
      email: next.email.trim().slice(0, 190),
      phone: next.phone.trim().slice(0, 55),
      location: next.location.trim().slice(0, 190),
      commissionNumber: next.commissionNumber.trim().slice(0, 75),
      commissionJurisdiction: next.commissionJurisdiction.trim().slice(0, 75),
      commissionExpires: next.commissionExpires.trim().slice(0, 35),
      customStampDataUrl: String(next.customStampDataUrl || '').slice(0, 450000),
      savedSignatureData: sigData,
      savedSignatureType: sigType,
    };

    if (authUser) {
      const updated = await apiSaveProfile(payloadFields);
      setUserProfile(updated);
    } else {
      setUserProfile({
        ...next,
        ...payloadFields,
      });
    }
  };

  const handleConfigureGitHubRepo = async (
    repo: string,
    branch: string
  ): Promise<boolean> => {
    setUpdateError('');
    setUpdateNotice('');
    try {
      const res = await saveGitHubConfigOnServer(repo, branch);
      if (!res.ok) {
        setUpdateError(res.error || 'Could not save GitHub repository.');
        return false;
      }
      if (res.repoSlug) setGithubRepoInput(res.repoSlug);
      if (res.branch) setGithubBranchInput(res.branch);
      const latestCheck = await checkForAppUpdate();
      if (latestCheck.remoteBuild) setRemoteBuild(latestCheck.remoteBuild);
      if (latestCheck.githubStatus) setGithubStatus(latestCheck.githubStatus);
      setUpdateAvailable(latestCheck.updateAvailable);
      setUpdateNotice(`Linked GitHub repository ${res.repoSlug} (${res.branch}).`);
      return true;
    } catch (err) {
      setUpdateError(
        err instanceof Error ? err.message : 'Unable to save GitHub config.'
      );
      return false;
    }
  };

  const handlePullFromGitHub = async (force = false) => {
    setUpdateError('');
    setUpdateNotice('');
    setUpdatingApp(true);
    try {
      const res = await runGitHubAppUpdate({
        repo: githubRepoInput.trim() || undefined,
        branch: githubBranchInput.trim() || undefined,
        force,
      });

      if (!res.ok) {
        if (res.needsRepoConfig) {
          setShowGitHubModal(true);
        }
        setUpdateError(
          res.error || 'Unable to pull update from GitHub.'
        );
        return;
      }

      if (res.updated) {
        setUpdateAvailable(false);
        setUpdateNotice(
          `Updated from GitHub (${res.newShortCommit || 'latest'}${
            res.commitMessage ? ` — ${res.commitMessage}` : ''
          }). Reloading...`
        );
        await applyAppUpdate();
      } else {
        setUpdateAvailable(false);
        setUpdateNotice(
          `Already on the latest GitHub commit${
            res.newShortCommit ? ` (${res.newShortCommit})` : ''
          }.`
        );
      }
    } finally {
      setUpdatingApp(false);
    }
  };

  const handleUpdateApp = async (forceReload = false) => {
    setUpdateError('');
    setUpdateNotice('');

    if (forceReload || updateAvailable) {
      if (githubStatus?.repoConfigured) {
        await handlePullFromGitHub(forceReload);
        return;
      }
      setUpdatingApp(true);
      await applyAppUpdate();
      return;
    }

    setCheckingUpdate(true);
    try {
      const result = await checkForAppUpdate();
      if (result.remoteBuild) {
        setRemoteBuild(result.remoteBuild);
      }
      if (result.githubStatus) {
        setGithubStatus(result.githubStatus);
        if (result.githubStatus.repoSlug) {
          setGithubRepoInput(result.githubStatus.repoSlug);
        }
        if (result.githubStatus.branch) {
          setGithubBranchInput(result.githubStatus.branch);
        }
      }

      if (result.githubStatus && !result.githubStatus.repoConfigured) {
        setShowGitHubModal(true);
        setUpdateNotice(
          'Connect your GitHub repository below to pull updates directly from GitHub.'
        );
        return;
      }

      if (result.githubStatus?.checkError) {
        setUpdateError(result.githubStatus.checkError);
        return;
      }

      if (result.updateAvailable) {
        setUpdateAvailable(true);
        setCheckingUpdate(false);
        await handlePullFromGitHub(false);
      } else {
        const gh = result.githubStatus;
        setUpdateNotice(
          gh?.repoConfigured && gh.localShortCommit
            ? `Up to date with GitHub (${gh.repoSlug} @ ${gh.localShortCommit}${
                gh.remoteCommitMessage ? ` — ${gh.remoteCommitMessage}` : ''
              }).`
            : `Up to date on build ${CURRENT_APP_BUILD.buildId}.`
        );
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  const navItems: {
    id: AppView;
    label: string;
    icon: typeof FolderKanban;
  }[] = [
    { id: 'documents', label: 'Documents & Folders', icon: FolderKanban },
    { id: 'signing_room', label: 'Signing Room', icon: FileCheck2 },
    { id: 'journal', label: 'Electronic Journal', icon: BookOpen },
    { id: 'verify', label: 'Verify Document', icon: ShieldCheck },
    { id: 'profile', label: 'Profile & Stamp', icon: Stamp },
  ];

  const viewTitles: Record<AppView, string> = {
    documents: 'Documents & Folders',
    signing_room: activeCase ? `Signing Room / ${activeCase.title}` : 'Signing Room',
    journal: 'Statutory Electronic Journal',
    verify: 'Public Certificate Verification',
    profile: 'Profile, Signature & Stamp Studio',
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Sidebar Navigation (256px) */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setActiveView('documents');
              setMobileNavOpen(false);
            }}
            className="inline-flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap cursor-pointer"
          >
            <VeriSealBrandIcon size={24} />
            <span>VeriSeal</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveView(item.id);
                  setMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="text-xs">
            <div className="font-semibold text-slate-900 truncate">
              {userProfile.displayName}
            </div>
            <div className="text-slate-500 truncate mt-0.5 font-mono text-[11px]">
              Comm. #{userProfile.commissionNumber}
            </div>
            <div className="text-slate-500 truncate mt-0.5 text-[11px]">
              {authUser ? 'VPS SQLite Synced' : 'Local Preview Mode'}
            </div>
          </div>

          {!authUser ? (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="w-full py-2 px-3 text-xs font-semibold text-white bg-blue-800 rounded-md hover:bg-blue-900 transition-colors cursor-pointer"
            >
              Sign In / Create Account
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActiveView('profile')}
              className="w-full py-1.5 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
            >
              Manage Account &amp; Stamp
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Breadcrumb Bar */}
        <header className="no-print h-16 px-4 sm:px-8 bg-white border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm text-slate-500 truncate">
              <span className="font-medium text-slate-900">VeriSeal</span>
              <span className="mx-2">/</span>
              <span className="text-slate-700">{viewTitles[activeView]}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={checkingUpdate || updatingApp}
              onClick={() => void handleUpdateApp(false)}
              title={
                updateAvailable
                  ? 'A newer version of VeriSeal is ready — click to update'
                  : `Check for updates (Build ${CURRENT_APP_BUILD.buildId})`
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                updateAvailable
                  ? 'text-white bg-blue-800 hover:bg-blue-900'
                  : 'text-slate-700 bg-white border border-slate-300 hover:bg-slate-50'
              }`}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  checkingUpdate || updatingApp ? 'animate-spin' : ''
                }`}
              />
              <span>
                {updatingApp
                  ? 'Updating...'
                  : checkingUpdate
                  ? 'Checking...'
                  : updateAvailable
                  ? 'Update Ready'
                  : 'Update App'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('verify')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Verify Code
            </button>

            {authUser ? (
              <button
                type="button"
                onClick={() => setActiveView('profile')}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserCircle2 className="w-4 h-4 text-slate-700" />
                <span className="max-w-[140px] truncate">
                  {userProfile.displayName}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign In
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-[1360px] w-full mx-auto">
          {(updateAvailable || updateNotice || updateError) && (
            <div
              className={`no-print mb-5 px-4 py-3 rounded-lg border flex flex-wrap items-center justify-between gap-3 text-xs ${
                updateError
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : updateAvailable
                  ? 'bg-blue-50 border-blue-200 text-blue-950'
                  : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <RefreshCw className="w-4 h-4 shrink-0 text-blue-800" />
                <span className="break-words">
                  {updateError
                    ? updateError
                    : updateAvailable
                    ? `A newer GitHub version (${
                        githubStatus?.remoteShortCommit ||
                        remoteBuild?.buildId ||
                        'latest'
                      }${
                        githubStatus?.remoteCommitMessage
                          ? ` — ${githubStatus.remoteCommitMessage}`
                          : ''
                      }) is available.`
                    : updateNotice}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {githubStatus?.repoConfigured ? (
                  <button
                    type="button"
                    disabled={updatingApp}
                    onClick={() => void handlePullFromGitHub(!updateAvailable)}
                    className="px-3 py-1.5 font-semibold text-white bg-blue-800 rounded hover:bg-blue-900 disabled:opacity-50 cursor-pointer"
                  >
                    {updatingApp
                      ? 'Updating from GitHub...'
                      : updateAvailable
                      ? 'Update from GitHub Now'
                      : 'Force Pull & Rebuild'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowGitHubModal(true)}
                    className="px-3 py-1.5 font-semibold text-white bg-blue-800 rounded hover:bg-blue-900 cursor-pointer"
                  >
                    Connect GitHub Repo
                  </button>
                )}
                {!updateAvailable && (
                  <button
                    type="button"
                    onClick={() => {
                      setUpdateNotice('');
                      setUpdateError('');
                    }}
                    aria-label="Dismiss update message"
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
          {activeView === 'documents' && (
            <DocumentManagerView
              cases={cases}
              folders={folders}
              activeFolderId={activeFolderId}
              onSelectFolder={setActiveFolderId}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              onCreateCase={handleCreateCase}
              onMoveCaseFolder={handleMoveCaseFolder}
              onDeleteCase={handleDeleteCase}
              onOpenCase={(id) => {
                setActiveCaseId(id);
                setActiveView('signing_room');
              }}
              defaultSignerName={userProfile.displayName}
              defaultSignerEmail={userProfile.email}
            />
          )}

          {activeView === 'signing_room' && (
            <SigningRoomView
              activeCase={activeCase}
              custodyEvents={activeCase ? custodyByCase[activeCase.id] || [] : []}
              previewObjectUrl={
                activeCase ? previewUrlsByCase[activeCase.id] : undefined
              }
              userProfile={userProfile}
              onChangeMode={handleChangeMode}
              onCompleteIdentity={handleCompleteIdentity}
              onApplySignature={handleApplySignature}
              onNotarizeCase={handleNotarizeCase}
              onToggleEmblems={handleToggleEmblems}
              onUpdatePlacement={handleUpdatePlacement}
              onNavigateVerify={(code) => {
                setVerifyCodePreset(code);
                setActiveView('verify');
              }}
              onNavigateStampTool={() => setActiveView('profile')}
            />
          )}

          {activeView === 'journal' && (
            <JournalView
              entries={journalEntries}
              onVerifyCertificate={(code) => {
                setVerifyCodePreset(code);
                setActiveView('verify');
              }}
              onOpenCase={(caseId) => {
                setActiveCaseId(caseId);
                setActiveView('signing_room');
              }}
            />
          )}

          {activeView === 'verify' && (
            <VerifyPortalView
              initialCode={verifyCodePreset}
              localVerifications={localVerifications}
            />
          )}

          {activeView === 'profile' && (
            <ProfileView
              authUser={authUser}
              profile={userProfile}
              cases={cases}
              onSaveProfile={handleSaveProfile}
              onOpenAuthModal={() => setAuthModalOpen(true)}
              onSignOut={async () => {
                await authLogout();
                setAuthUser(null);
                setActiveCaseId(null);
              }}
              onOpenCase={(caseId) => {
                setActiveCaseId(caseId);
                setActiveView('signing_room');
              }}
              updateAvailable={updateAvailable}
              checkingUpdate={checkingUpdate}
              updatingApp={updatingApp}
              remoteBuild={remoteBuild}
              githubStatus={githubStatus}
              updateNotice={updateNotice}
              updateError={updateError}
              onUpdateApp={handleUpdateApp}
              onConfigureGitHubRepo={handleConfigureGitHubRepo}
              onPullFromGitHub={handlePullFromGitHub}
            />
          )}
        </main>
      </div>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        defaultToRegister={!hasAnyUsers}
        onAuthenticated={(user) => {
          setAuthUser(user);
          setHasAnyUsers(true);
        }}
      />

      {showGitHubModal && (
        <div className="no-print fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-lg border border-slate-200 shadow-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Update VeriSeal from GitHub
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Enter your GitHub repository so VeriSeal can pull the latest commit, rebuild, and reload automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGitHubModal(false)}
                aria-label="Close GitHub update modal"
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {updateError && (
              <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
                {updateError}
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const saved = await handleConfigureGitHubRepo(
                  githubRepoInput,
                  githubBranchInput
                );
                if (saved) {
                  setShowGitHubModal(false);
                  await handlePullFromGitHub(false);
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  GitHub Repository (owner/repo or URL)
                </label>
                <input
                  type="text"
                  required
                  value={githubRepoInput}
                  onChange={(e) => setGithubRepoInput(e.target.value)}
                  placeholder="https://github.com/username/veriseal"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Branch
                </label>
                <input
                  type="text"
                  required
                  value={githubBranchInput}
                  onChange={(e) => setGithubBranchInput(e.target.value)}
                  placeholder="main"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowGitHubModal(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingApp || !githubRepoInput.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-800 rounded-md hover:bg-blue-900 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      updatingApp ? 'animate-spin' : ''
                    }`}
                  />
                  {updatingApp ? 'Updating from GitHub...' : 'Save & Update from GitHub'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
