import type { NotarialActType, NotarizationMode } from '../types/notary';

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const data =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hashBuffer);
}

export interface CryptographicSealResult {
  certificateCode: string;
  signatureAlgorithm: string;
  publicKeyJwk: string;
  digitalSignature: string;
  signedPayload: string;
  timestampIso: string;
  sealedHash: string;
}

export interface SealPayloadInput {
  caseId: string;
  documentTitle: string;
  fileName: string;
  fileSize: number;
  documentHash: string;
  actType: NotarialActType;
  notarizationMode: NotarizationMode;
  meetingLocation: string;
  signerName: string;
  notaryName: string;
  notaryCommission: string;
  notaryJurisdiction: string;
}

export function generateCertificateCode(): string {
  const bytes = new Uint8Array(4);
  window.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return `VS-2026-${hex}`;
}

export async function generateAndSignNotarization(
  input: SealPayloadInput
): Promise<CryptographicSealResult> {
  const certificateCode = generateCertificateCode();
  const timestampIso = new Date().toISOString();

  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify']
  );

  const exportedJwk = await window.crypto.subtle.exportKey(
    'jwk',
    keyPair.publicKey
  );
  const publicKeyJwk = JSON.stringify(exportedJwk);

  const canonicalObject = {
    version: 'VERISEAL-TSP-1.0',
    certificateCode,
    caseId: input.caseId,
    documentTitle: input.documentTitle,
    fileName: input.fileName,
    fileSize: input.fileSize,
    documentHash: input.documentHash,
    actType: input.actType,
    notarizationMode: input.notarizationMode,
    meetingLocation: input.meetingLocation,
    signerName: input.signerName,
    notaryName: input.notaryName,
    notaryCommission: input.notaryCommission,
    notaryJurisdiction: input.notaryJurisdiction,
    timestampIso,
  };

  const signedPayload = JSON.stringify(canonicalObject);
  const encodedPayload = new TextEncoder().encode(signedPayload);

  const signatureBuffer = await window.crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' },
    },
    keyPair.privateKey,
    encodedPayload
  );

  const digitalSignature = bufferToBase64(signatureBuffer);
  const sealedHash = await sha256Hex(`${signedPayload}|${digitalSignature}`);

  return {
    certificateCode,
    signatureAlgorithm: 'ECDSA-P256-SHA256',
    publicKeyJwk,
    digitalSignature,
    signedPayload,
    timestampIso,
    sealedHash,
  };
}

export async function verifyNotarizationSignature(
  signedPayload: string,
  digitalSignatureBase64: string,
  publicKeyJwkString: string
): Promise<boolean> {
  try {
    const jwk = JSON.parse(publicKeyJwkString) as JsonWebKey;
    const publicKey = await window.crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      false,
      ['verify']
    );

    const encodedPayload = new TextEncoder().encode(signedPayload);
    const signatureBytes = base64ToUint8Array(digitalSignatureBase64);

    return await window.crypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' },
      },
      publicKey,
      signatureBytes.buffer as ArrayBuffer,
      encodedPayload
    );
  } catch {
    return false;
  }
}

export async function computeCustodyEventHash(
  prevHash: string,
  step: string,
  actor: string,
  details: string,
  timestampIso: string
): Promise<string> {
  return sha256Hex(`${prevHash}|${step}|${actor}|${details}|${timestampIso}`);
}
