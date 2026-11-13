export type NotarialActType =
  | 'Acknowledgment'
  | 'Jurat'
  | 'Copy Certification'
  | 'Oath / Affirmation';

export type NotarizationMode = 'online' | 'in_person';

export type NotarizationStatus =
  | 'draft'
  | 'identity_verified'
  | 'signed'
  | 'notarized';

export type SignatureType = 'none' | 'drawn' | 'typed';

export type AppView =
  | 'documents'
  | 'signing_room'
  | 'journal'
  | 'verify'
  | 'profile';

export const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const MAX_TITLE_LEN = 140;
export const MAX_FILENAME_LEN = 180;
export const MAX_DOC_TEXT_LEN = 60000;
export const MAX_FOLDER_NAME_LEN = 60;
export const MAX_NAME_LEN = 100;
export const MAX_EMAIL_LEN = 120;

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  phone: string;
  location: string;
  commissionNumber: string;
  commissionJurisdiction: string;
  commissionExpires: string;
  customStampDataUrl: string;
  createdAtIso?: string;
  updatedAtIso?: string;
}

export interface DocumentFolder {
  id: string;
  ownerId: string;
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface CustodyEvent {
  id: string;
  ownerId: string;
  caseId: string;
  step: string;
  actor: string;
  details: string;
  eventHash: string;
  recordedAtIso: string;
}

export interface PlacementBox {
  page: number;
  xPct: number;
  yPct: number;
  scale: number;
}

export interface DocumentPlacement {
  signature: PlacementBox;
  stamp: PlacementBox;
}

export const DEFAULT_DOCUMENT_PLACEMENT: DocumentPlacement = {
  signature: { page: 1, xPct: 26, yPct: 78, scale: 1 },
  stamp: { page: 1, xPct: 75, yPct: 76, scale: 1 },
};

export interface NotarizationCase {
  id: string;
  ownerId: string;
  folderId: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  actType: NotarialActType;
  notarizationMode: NotarizationMode;
  meetingLocation: string;
  status: NotarizationStatus;
  signerName: string;
  signerEmail: string;
  documentText: string;
  documentHash: string;
  idMethod: string;
  idScore: number;
  kbaPassed: boolean;
  signerSignatureData: string;
  signatureType: SignatureType;
  notaryName: string;
  notaryCommission: string;
  notaryJurisdiction: string;
  notaryExpires: string;
  notaryStampDataUrl: string;
  includeCertifiedLogo: boolean;
  includeNotarizedMark: boolean;
  placement?: DocumentPlacement;
  certificateCode: string;
  sealedHash: string;
  signatureAlgorithm: string;
  publicKeyJwk: string;
  digitalSignature: string;
  signedPayload: string;
  timestampIso: string;
  feeCents: number;
  createdAtIso: string;
  updatedAtIso: string;
  notarizedAtIso?: string;
}

export interface JournalEntry {
  id: string;
  ownerId: string;
  caseId: string;
  entryNumber: string;
  documentTitle: string;
  fileName: string;
  actType: NotarialActType;
  notarizationMode: NotarizationMode;
  meetingLocation: string;
  signerName: string;
  idMethod: string;
  certificateCode: string;
  sealedHash: string;
  timestampIso: string;
  feeCents: number;
  recordedAtIso: string;
}

export interface VerificationRecord {
  certificateCode: string;
  ownerId: string;
  caseId: string;
  documentTitle: string;
  fileName: string;
  fileSize: number;
  actType: NotarialActType;
  notarizationMode: NotarizationMode;
  meetingLocation: string;
  documentHash: string;
  sealedHash: string;
  signatureAlgorithm: string;
  publicKeyJwk: string;
  digitalSignature: string;
  signedPayload: string;
  timestampIso: string;
  notaryName: string;
  notaryCommission: string;
  notaryJurisdiction: string;
  notaryExpires: string;
  notarizedAtIso: string;
}
