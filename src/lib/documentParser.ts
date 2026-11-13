import { sha256Hex } from './crypto';
import { MAX_DOC_TEXT_LEN } from '../types/notary';

export interface ParsedUploadedDocument {
  fileName: string;
  fileType: string;
  fileSize: number;
  documentHash: string;
  extractedText: string;
  previewObjectUrl: string;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  await writer.write(copy);
  await writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export function truncateUtf8Bytes(input: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(input).byteLength <= maxBytes) {
    return input;
  }
  let low = 0;
  let high = input.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(input.slice(0, mid)).byteLength <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return input.slice(0, low);
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  try {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let offset = 0;

    while (offset + 30 < bytes.length) {
      const signature = view.getUint32(offset, true);
      if (signature !== 0x04034b50) {
        offset += 1;
        continue;
      }

      const compressionMethod = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const nameStart = offset + 30;
      const dataStart = nameStart + fileNameLength + extraLength;
      if (dataStart > bytes.length) break;

      const nameBytes = bytes.slice(nameStart, nameStart + fileNameLength);
      const entryName = new TextDecoder().decode(nameBytes);

      if (
        entryName === 'word/document.xml' &&
        compressedSize > 0 &&
        dataStart + compressedSize <= bytes.length
      ) {
        const entryData = bytes.slice(dataStart, dataStart + compressedSize);
        const xmlBytes =
          compressionMethod === 8
            ? await inflateRawBytes(entryData)
            : entryData;
        const xmlText = new TextDecoder().decode(xmlBytes);
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'application/xml');
        const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
        const lines = paragraphs
          .map((p) => {
            const runs = Array.from(p.getElementsByTagName('w:t'));
            return runs.map((t) => t.textContent || '').join('');
          })
          .filter((line) => line.trim().length > 0);
        if (lines.length > 0) {
          return truncateUtf8Bytes(lines.join('\n\n'), MAX_DOC_TEXT_LEN);
        }
      }

      if (compressedSize > 0) {
        offset = dataStart + compressedSize;
      } else {
        offset = dataStart;
      }
    }
  } catch {
    // Fallback below if ZIP/DEFLATE stream uses data descriptors
  }
  return '';
}

function extractReadablePdfStrings(buffer: ArrayBuffer): string {
  try {
    const raw = new TextDecoder('latin1').decode(buffer.slice(0, 400000));
    const matches = raw.match(/\(([A-Za-z0-9 ,.;:'"/?!@#$%&*()\-_+=\n\r]{4,180})\)/g);
    if (matches && matches.length > 0) {
      const cleaned = matches
        .map((m) => m.slice(1, -1).replace(/\\([()\\])/g, '$1'))
        .filter((s) => /[A-Za-z]{2,}/.test(s))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length > 30) {
        return truncateUtf8Bytes(cleaned, MAX_DOC_TEXT_LEN);
      }
    }
  } catch {
    // Ignore decode issues
  }
  return '';
}

const MAX_FILE_BYTES = 100 * 1024 * 1024;

export async function parseUploadedFile(
  file: File
): Promise<ParsedUploadedDocument> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('File exceeds the 100 MB maximum upload limit.');
  }

  const buffer = await file.arrayBuffer();
  const documentHash = await sha256Hex(buffer);
  const previewObjectUrl = URL.createObjectURL(file);
  const lower = file.name.toLowerCase();
  const fileType = (file.type || inferMimeType(lower) || 'application/octet-stream').trim();

  let extractedText = '';

  if (
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.json') ||
    lower.endsWith('.xml') ||
    lower.endsWith('.rtf') ||
    fileType.startsWith('text/')
  ) {
    extractedText = truncateUtf8Bytes(
      new TextDecoder().decode(buffer),
      MAX_DOC_TEXT_LEN
    );
  } else if (lower.endsWith('.docx')) {
    extractedText = await extractDocxText(buffer);
  } else if (lower.endsWith('.pdf')) {
    extractedText = extractReadablePdfStrings(buffer);
  }

  if (!extractedText.trim()) {
    extractedText = [
      `Uploaded Document: ${file.name}`,
      `MIME Type: ${fileType}`,
      `File Size: ${formatFileSize(file.size)} (${file.size} bytes)`,
      `SHA-256 Digest: ${documentHash}`,
      '',
      'This document has been cryptographically hashed over its exact binary byte stream. Any alteration to a single byte of the uploaded file will invalidate the SHA-256 digest and ECDSA notarization signature.',
    ].join('\n');
  }

  return {
    fileName: truncateUtf8Bytes(file.name, 175) || 'uploaded_document',
    fileType: truncateUtf8Bytes(fileType, 95) || 'application/octet-stream',
    fileSize: file.size,
    documentHash,
    extractedText: truncateUtf8Bytes(extractedText, MAX_DOC_TEXT_LEN),
    previewObjectUrl,
  };
}

function inferMimeType(lowerName: string): string {
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lowerName.endsWith('.doc')) return 'application/msword';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg'))
    return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
