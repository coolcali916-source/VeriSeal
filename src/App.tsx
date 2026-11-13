import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
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
  auth,
  db,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from './lib/firebase';
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
  type AppVersionManifest,
} from './lib/appUpdater';

function makeId(prefix: string): string {
  const bytes = new Uint8Array(5);
  window.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}_${hex}`;
}

function tsToIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return new Date().toISOString();
}

function parsePlacement(raw: unknown): DocumentPlacement | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const sig = obj.signature as Record<string, unknown> | undefined;
  const stamp = obj.stamp as Record<string, unknown> | undefined;
  if (!sig || !stamp) return undefined;
  return {
    signature: {
      page: Math.max(1, Math.round(Number(sig.page) || 1)),
      xPct: Number(sig.xPct ?? DEFAULT_DOCUMENT_PLACEMENT.signature.xPct),
      yPct: Number(sig.yPct ?? DEFAULT_DOCUMENT_PLACEMENT.signature.yPct),
      scale: Number(sig.scale ?? DEFAULT_DOCUMENT_PLACEMENT.signature.scale),
    },
    stamp: {
      page: Math.max(1, Math.round(Number(stamp.page) || 1)),
      xPct: Number(stamp.xPct ?? DEFAULT_DOCUMENT_PLACEMENT.stamp.xPct),
      yPct: Number(stamp.yPct ?? DEFAULT_DOCUMENT_PLACEMENT.stamp.yPct),
      scale: Number(stamp.scale ?? DEFAULT_DOCUMENT_PLACEMENT.stamp.scale),
    },
  };
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
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
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
  const pendingPlacementByCaseRef = useRef<
    Record<string, { placement: DocumentPlacement; ts: number }>
  >({});

  // App Update State
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [remoteBuild, setRemoteBuild] = useState<AppVersionManifest | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateNotice, setUpdateNotice] = useState('');

  // Clean _upd param & poll /version.json for new deployments
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

  // Boot Firestore connection check + initial sandbox seed
  useEffect(() => {
    void testFirestoreConnection();

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsubAuth();
  }, []);

  // Initialize Local Preview Mode when signed out
  useEffect(() => {
    if (!authReady || firebaseUser) return;

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
  }, [authReady, firebaseUser]);

  // Firestore Real-time Sync when authenticated
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    const uid = firebaseUser.uid;

    // 1. Bootstrap or subscribe to userProfiles/{uid}
    const profileRef = doc(db, 'userProfiles', uid);
    void (async () => {
      try {
        const snap = await getDoc(profileRef);
        if (!snap.exists()) {
          await setDoc(profileRef, {
            uid,
            displayName: firebaseUser.displayName || 'Notary User',
            email: firebaseUser.email || '',
            phone: '',
            location: 'San Francisco, CA',
            commissionNumber: 'CA-2491804',
            commissionJurisdiction: 'State of California',
            commissionExpires: '2028-09-30',
            customStampDataUrl: '',
            savedSignatureData: '',
            savedSignatureType: 'none',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `userProfiles/${uid}`);
      }
    })();

    const unsubProfile = onSnapshot(
      profileRef,
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          const sigType =
            d.savedSignatureType === 'drawn' || d.savedSignatureType === 'typed'
              ? d.savedSignatureType
              : 'none';
          setUserProfile({
            uid: String(d.uid),
            displayName: String(d.displayName || ''),
            email: String(d.email || ''),
            phone: String(d.phone || ''),
            location: String(d.location || ''),
            commissionNumber: String(d.commissionNumber || ''),
            commissionJurisdiction: String(d.commissionJurisdiction || ''),
            commissionExpires: String(d.commissionExpires || ''),
            customStampDataUrl: String(d.customStampDataUrl || ''),
            savedSignatureData: String(d.savedSignatureData || ''),
            savedSignatureType: sigType,
            createdAtIso: tsToIso(d.createdAt),
            updatedAtIso: tsToIso(d.updatedAt),
          });
        }
      },
      (err) =>
        handleFirestoreError(err, OperationType.GET, `userProfiles/${uid}`)
    );

    // 2. Subscribe to folders
    const foldersQuery = query(
      collection(db, 'folders'),
      where('ownerId', '==', uid)
    );
    let foldersBootstrapped = false;
    const unsubFolders = onSnapshot(
      foldersQuery,
      (snap) => {
        const list: DocumentFolder[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            ownerId: String(d.ownerId),
            name: String(d.name),
            createdAtIso: tsToIso(d.createdAt),
            updatedAtIso: tsToIso(d.updatedAt),
          };
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        setFolders(list);

        if (list.length === 0 && !foldersBootstrapped) {
          foldersBootstrapped = true;
          const batch = writeBatch(db);
          DEFAULT_FOLDER_NAMES.forEach((name) => {
            const id = makeId('fld');
            batch.set(doc(db, 'folders', id), {
              id,
              ownerId: uid,
              name,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          });
          void batch.commit().catch((err) =>
            handleFirestoreError(err, OperationType.WRITE, 'folders')
          );
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'folders')
    );

    // 3. Subscribe to notarizations
    const casesQuery = query(
      collection(db, 'notarizations'),
      where('ownerId', '==', uid)
    );
    const unsubCases = onSnapshot(
      casesQuery,
      (snap) => {
        const list: NotarizationCase[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            ownerId: String(d.ownerId),
            folderId: String(d.folderId || 'unfiled'),
            title: String(d.title),
            fileName: String(d.fileName),
            fileType: String(d.fileType),
            fileSize: Number(d.fileSize || 0),
            actType: d.actType as NotarialActType,
            notarizationMode:
              d.notarizationMode === 'in_person' ? 'in_person' : 'online',
            meetingLocation: String(d.meetingLocation || ''),
            status: d.status,
            signerName: String(d.signerName),
            signerEmail: String(d.signerEmail),
            documentText: String(d.documentText),
            documentHash: String(d.documentHash),
            idMethod: String(d.idMethod || ''),
            idScore: Number(d.idScore || 0),
            kbaPassed: Boolean(d.kbaPassed),
            signerSignatureData: String(d.signerSignatureData || ''),
            signatureType: d.signatureType as SignatureType,
            notaryName: String(d.notaryName || ''),
            notaryCommission: String(d.notaryCommission || ''),
            notaryJurisdiction: String(d.notaryJurisdiction || ''),
            notaryExpires: String(d.notaryExpires || ''),
            notaryStampDataUrl: String(d.notaryStampDataUrl || ''),
            includeCertifiedLogo: d.includeCertifiedLogo !== false,
            includeNotarizedMark: d.includeNotarizedMark !== false,
            placement: (() => {
              const serverPlacement =
                parsePlacement(d.placement) || DEFAULT_DOCUMENT_PLACEMENT;
              const pending = pendingPlacementByCaseRef.current[docSnap.id];
              if (pending && Date.now() - pending.ts < 3000) {
                if (
                  JSON.stringify(serverPlacement) ===
                  JSON.stringify(pending.placement)
                ) {
                  delete pendingPlacementByCaseRef.current[docSnap.id];
                  return serverPlacement;
                }
                return pending.placement;
              }
              return serverPlacement;
            })(),
            certificateCode: String(d.certificateCode || ''),
            sealedHash: String(d.sealedHash || ''),
            signatureAlgorithm: String(d.signatureAlgorithm || ''),
            publicKeyJwk: String(d.publicKeyJwk || ''),
            digitalSignature: String(d.digitalSignature || ''),
            signedPayload: String(d.signedPayload || ''),
            timestampIso: String(d.timestampIso || ''),
            feeCents: Number(d.feeCents || 0),
            createdAtIso: tsToIso(d.createdAt),
            updatedAtIso: tsToIso(d.updatedAt),
            notarizedAtIso: d.notarizedAt ? tsToIso(d.notarizedAt) : undefined,
          };
        });
        list.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
        setCases(list);
        setActiveCaseId((prev) =>
          prev && list.some((c) => c.id === prev) ? prev : list[0]?.id || null
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notarizations')
    );

    // 4. Subscribe to journalEntries
    const journalQuery = query(
      collection(db, 'journalEntries'),
      where('ownerId', '==', uid)
    );
    const unsubJournal = onSnapshot(
      journalQuery,
      (snap) => {
        const list: JournalEntry[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            ownerId: String(d.ownerId),
            caseId: String(d.caseId),
            entryNumber: String(d.entryNumber),
            documentTitle: String(d.documentTitle),
            fileName: String(d.fileName),
            actType: d.actType as NotarialActType,
            notarizationMode:
              d.notarizationMode === 'in_person' ? 'in_person' : 'online',
            meetingLocation: String(d.meetingLocation || ''),
            signerName: String(d.signerName),
            idMethod: String(d.idMethod),
            certificateCode: String(d.certificateCode),
            sealedHash: String(d.sealedHash),
            timestampIso: String(d.timestampIso),
            feeCents: Number(d.feeCents || 0),
            recordedAtIso: tsToIso(d.recordedAt),
          };
        });
        list.sort((a, b) => b.recordedAtIso.localeCompare(a.recordedAtIso));
        setJournalEntries(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'journalEntries')
    );

    return () => {
      unsubProfile();
      unsubFolders();
      unsubCases();
      unsubJournal();
    };
  }, [authReady, firebaseUser]);

  // Subscribe to custodyEvents for active case when signed in
  useEffect(() => {
    if (!authReady || !firebaseUser || !activeCaseId) return;
    if (activeCaseId.startsWith('case_demo_')) return;

    const path = `notarizations/${activeCaseId}/custodyEvents`;
    const q = query(collection(db, path), orderBy('recordedAt', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const events: CustodyEvent[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            ownerId: String(d.ownerId),
            caseId: String(d.caseId),
            step: String(d.step),
            actor: String(d.actor),
            details: String(d.details),
            eventHash: String(d.eventHash),
            recordedAtIso: tsToIso(d.recordedAt),
          };
        });
        setCustodyByCase((prev) => ({ ...prev, [activeCaseId]: events }));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, path)
    );
    return () => unsub();
  }, [authReady, firebaseUser, activeCaseId]);

  const activeCase = useMemo(
    () => cases.find((c) => c.id === activeCaseId) || null,
    [cases, activeCaseId]
  );

  // Handlers
  const handleCreateFolder = async (name: string) => {
    const id = makeId('fld');
    const nowIso = new Date().toISOString();
    if (firebaseUser) {
      const path = `folders/${id}`;
      try {
        await setDoc(doc(db, 'folders', id), {
          id,
          ownerId: firebaseUser.uid,
          name,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    } else {
      setFolders((prev) => [
        ...prev,
        {
          id,
          ownerId: 'local_preview',
          name,
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
        },
      ]);
    }
  };

  const handleRenameFolder = async (folderId: string, name: string) => {
    if (firebaseUser) {
      const path = `folders/${folderId}`;
      try {
        await updateDoc(doc(db, 'folders', folderId), {
          name,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    } else {
      setFolders((prev) =>
        prev.map((f) =>
          f.id === folderId
            ? { ...f, name, updatedAtIso: new Date().toISOString() }
            : f
        )
      );
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (firebaseUser) {
      const path = `folders/${folderId}`;
      try {
        await deleteDoc(doc(db, 'folders', folderId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    } else {
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
    }
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

    const optimisticCase: NotarizationCase = {
      id: caseId,
      ownerId: firebaseUser?.uid || 'local_preview',
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

    if (firebaseUser) {
      const uid = firebaseUser.uid;
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'notarizations', caseId), {
          id: caseId,
          ownerId: uid,
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
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'notarizations', caseId, 'custodyEvents', eventId), {
          id: eventId,
          ownerId: uid,
          caseId,
          step: 'Document Uploaded & Hashed',
          actor: payload.signerName.slice(0, 100),
          details: `Ingested ${payload.fileName.slice(0, 150)} (${
            payload.notarizationMode === 'in_person' ? 'In-Person' : 'Online RON'
          })`,
          eventHash: evHash,
          recordedAt: serverTimestamp(),
        });
        await batch.commit();
        setCases((prev) =>
          prev.some((c) => c.id === caseId) ? prev : [optimisticCase, ...prev]
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `notarizations/${caseId}`);
      }
    } else {
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
    if (firebaseUser) {
      try {
        await updateDoc(doc(db, 'notarizations', caseId), {
          folderId,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `notarizations/${caseId}`);
      }
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
    if (firebaseUser) {
      try {
        await deleteDoc(doc(db, 'notarizations', caseId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `notarizations/${caseId}`);
      }
    } else {
      setCases((prev) => prev.filter((c) => c.id !== caseId));
    }
    if (activeCaseId === caseId) setActiveCaseId(null);
  };

  const appendCustodyEvent = async (
    caseId: string,
    step: string,
    actor: string,
    details: string
  ) => {
    const existingEvents = custodyByCase[caseId] || [];
    const prevHash =
      existingEvents.length > 0
        ? existingEvents[existingEvents.length - 1].eventHash
        : 'GENESIS';
    const nowIso = new Date().toISOString();
    const eventHash = await computeCustodyEventHash(
      prevHash,
      step,
      actor,
      details,
      nowIso
    );
    const eventId = makeId('ev');

    if (firebaseUser) {
      try {
        await setDoc(doc(db, 'notarizations', caseId, 'custodyEvents', eventId), {
          id: eventId,
          ownerId: firebaseUser.uid,
          caseId,
          step,
          actor,
          details,
          eventHash,
          recordedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.CREATE,
          `notarizations/${caseId}/custodyEvents/${eventId}`
        );
      }
    } else {
      setCustodyByCase((prev) => ({
        ...prev,
        [caseId]: [
          ...(prev[caseId] || []),
          {
            id: eventId,
            ownerId: 'local_preview',
            caseId,
            step,
            actor,
            details,
            eventHash,
            recordedAtIso: nowIso,
          },
        ],
      }));
    }
  };

  const handleChangeMode = async (
    caseId: string,
    mode: NotarizationMode,
    meetingLocation: string
  ) => {
    if (firebaseUser) {
      try {
        await updateDoc(doc(db, 'notarizations', caseId), {
          notarizationMode: mode,
          meetingLocation,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `notarizations/${caseId}`);
      }
    } else {
      setCases((prev) =>
        prev.map((c) =>
          c.id === caseId
            ? {
                ...c,
                notarizationMode: mode,
                meetingLocation,
                updatedAtIso: new Date().toISOString(),
              }
            : c
        )
      );
    }
  };

  const handleCompleteIdentity = async (
    caseId: string,
    idMethod: string,
    idScore: number,
    meetingLocation: string
  ) => {
    const target = cases.find((c) => c.id === caseId);
    if (!target) return;
    if (firebaseUser) {
      try {
        await updateDoc(doc(db, 'notarizations', caseId), {
          status: 'identity_verified',
          idMethod,
          idScore,
          kbaPassed: true,
          meetingLocation,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `notarizations/${caseId}`);
      }
    } else {
      setCases((prev) =>
        prev.map((c) =>
          c.id === caseId
            ? {
                ...c,
                status: 'identity_verified',
                idMethod,
                idScore,
                kbaPassed: true,
                meetingLocation,
                updatedAtIso: new Date().toISOString(),
              }
            : c
        )
      );
    }
    await appendCustodyEvent(
      caseId,
      target.notarizationMode === 'in_person'
        ? 'Physical Presence & ID Verified'
        : 'Identity & KBA Verified',
      target.signerName,
      `${idMethod} (${meetingLocation}) verified at ${idScore}%`
    );
  };

  const handleApplySignature = async (
    caseId: string,
    signatureData: string,
    signatureType: SignatureType
  ) => {
    const target = cases.find((c) => c.id === caseId);
    if (!target) return;
    if (firebaseUser) {
      try {
        await updateDoc(doc(db, 'notarizations', caseId), {
          status: 'signed',
          signerSignatureData: signatureData,
          signatureType,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `notarizations/${caseId}`);
      }
    } else {
      setCases((prev) =>
        prev.map((c) =>
          c.id === caseId
            ? {
                ...c,
                status: 'signed',
                signerSignatureData: signatureData,
                signatureType,
                updatedAtIso: new Date().toISOString(),
              }
            : c
        )
      );
    }
    await appendCustodyEvent(
      caseId,
      'Signer Electronic Signature Applied',
      target.signerName,
      `Captured ${signatureType} electronic signature`
    );
  };

  const handleToggleEmblems = async (
    caseId: string,
    includeCertifiedLogo: boolean,
    includeNotarizedMark: boolean
  ) => {
    if (firebaseUser) {
      try {
        await updateDoc(doc(db, 'notarizations', caseId), {
          includeCertifiedLogo,
          includeNotarizedMark,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `notarizations/${caseId}`);
      }
    } else {
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

    pendingPlacementByCaseRef.current[caseId] = {
      placement: sanitized,
      ts: Date.now(),
    };

    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? { ...c, placement: sanitized, updatedAtIso: new Date().toISOString() }
          : c
      )
    );

    if (firebaseUser) {
      try {
        await updateDoc(doc(db, 'notarizations', caseId), {
          placement: sanitized,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        delete pendingPlacementByCaseRef.current[caseId];
        handleFirestoreError(err, OperationType.UPDATE, `notarizations/${caseId}`);
      }
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

    const notaryName = userProfile.displayName || 'Elena Vance';
    const notaryCommission = userProfile.commissionNumber || 'CA-2491804';
    const notaryJurisdiction =
      userProfile.commissionJurisdiction || 'State of California';
    const notaryExpires = userProfile.commissionExpires || '2028-09-30';
    const stampUrl = useCustomTransparentStamp
      ? userProfile.customStampDataUrl
      : '';

    const sealResult = await generateAndSignNotarization({
      caseId: target.id,
      documentTitle: target.title,
      fileName: target.fileName,
      fileSize: target.fileSize,
      documentHash: target.documentHash,
      actType: target.actType,
      notarizationMode: target.notarizationMode,
      meetingLocation: target.meetingLocation,
      signerName: target.signerName,
      notaryName,
      notaryCommission,
      notaryJurisdiction,
    });

    const entryId = makeId('jrn');
    const entryNumber = `NJ-2026-${String(journalEntries.length + 1).padStart(
      4,
      '0'
    )}`;
    const eventId = makeId('ev');
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

    if (firebaseUser) {
      const uid = firebaseUser.uid;
      try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'notarizations', caseId), {
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
          notarizedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'journalEntries', entryId), {
          id: entryId,
          ownerId: uid,
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
          recordedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'verifications', sealResult.certificateCode), {
          certificateCode: sealResult.certificateCode,
          ownerId: uid,
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
          notarizedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'notarizations', caseId, 'custodyEvents', eventId), {
          id: eventId,
          ownerId: uid,
          caseId,
          step: 'Notary Seal & ECDSA Timestamp Applied',
          actor: notaryName,
          details: `Certificate ${sealResult.certificateCode} sealed & recorded in statutory journal`,
          eventHash: evHash,
          recordedAt: serverTimestamp(),
        });

        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `notarizations/${caseId}`);
      }
    } else {
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
    }

    setLocalVerifications((prev) => ({
      ...prev,
      [sealResult.certificateCode]: {
        certificateCode: sealResult.certificateCode,
        ownerId: firebaseUser?.uid || 'local_preview',
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
  };

  const handleSaveProfile = async (next: UserProfile) => {
    const sigType: SignatureType =
      next.savedSignatureType === 'drawn' || next.savedSignatureType === 'typed'
        ? next.savedSignatureType
        : 'none';
    const sigData =
      sigType === 'none' ? '' : String(next.savedSignatureData || '').slice(0, 150000);

    if (firebaseUser) {
      const uid = firebaseUser.uid;
      try {
        await updateDoc(doc(db, 'userProfiles', uid), {
          displayName: next.displayName.trim() || 'Notary User',
          email: next.email.trim(),
          phone: next.phone.trim(),
          location: next.location.trim(),
          commissionNumber: next.commissionNumber.trim(),
          commissionJurisdiction: next.commissionJurisdiction.trim(),
          commissionExpires: next.commissionExpires.trim(),
          customStampDataUrl: next.customStampDataUrl,
          savedSignatureData: sigData,
          savedSignatureType: sigType,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `userProfiles/${uid}`);
      }
    } else {
      setUserProfile({
        ...next,
        savedSignatureData: sigData,
        savedSignatureType: sigType,
      });
    }
  };

  const handleUpdateApp = async (forceReload = false) => {
    setUpdateNotice('');
    if (forceReload || updateAvailable) {
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
      if (result.updateAvailable) {
        setUpdateAvailable(true);
        setUpdatingApp(true);
        await applyAppUpdate();
      } else {
        setUpdateNotice(
          `Up to date on build ${CURRENT_APP_BUILD.buildId}.`
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
              {firebaseUser ? 'Firestore Cloud Synced' : 'Local Preview Mode'}
            </div>
          </div>

          {!firebaseUser ? (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="w-full py-2 px-3 text-xs font-semibold text-white bg-blue-800 rounded-md hover:bg-blue-900 transition-colors cursor-pointer"
            >
              Sign In with Google / Email
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

            {firebaseUser ? (
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
          {(updateAvailable || updateNotice) && (
            <div
              className={`no-print mb-5 px-4 py-3 rounded-lg border flex flex-wrap items-center justify-between gap-3 text-xs ${
                updateAvailable
                  ? 'bg-blue-50 border-blue-200 text-blue-950'
                  : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <RefreshCw className="w-4 h-4 shrink-0 text-blue-800" />
                <span>
                  {updateAvailable
                    ? `A new VeriSeal update (${
                        remoteBuild?.buildId || 'latest'
                      }) is ready to load.`
                    : updateNotice}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={updatingApp}
                  onClick={() => void handleUpdateApp(true)}
                  className="px-3 py-1.5 font-semibold text-white bg-blue-800 rounded hover:bg-blue-900 disabled:opacity-50 cursor-pointer"
                >
                  {updateAvailable ? 'Update Now' : 'Reload Fresh Assets'}
                </button>
                {!updateAvailable && (
                  <button
                    type="button"
                    onClick={() => setUpdateNotice('')}
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
              firebaseUser={firebaseUser}
              profile={userProfile}
              cases={cases}
              onSaveProfile={handleSaveProfile}
              onOpenAuthModal={() => setAuthModalOpen(true)}
              onSignOut={async () => {
                await signOut(auth);
              }}
              onOpenCase={(caseId) => {
                setActiveCaseId(caseId);
                setActiveView('signing_room');
              }}
              updateAvailable={updateAvailable}
              checkingUpdate={checkingUpdate}
              updatingApp={updatingApp}
              remoteBuild={remoteBuild}
              onUpdateApp={handleUpdateApp}
            />
          )}
        </main>
      </div>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />
    </div>
  );
}
