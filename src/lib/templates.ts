import type { NotarialActType } from '../types/notary';

export interface LegalTemplate {
  id: string;
  title: string;
  fileName: string;
  actType: NotarialActType;
  defaultFolderName: string;
  feeCents: number;
  body: string;
}

export const LEGAL_TEMPLATES: LegalTemplate[] = [
  {
    id: 'poa-durable',
    title: 'Durable Financial Power of Attorney',
    fileName: 'Durable_Power_of_Attorney_2026.txt',
    actType: 'Acknowledgment',
    defaultFolderName: 'Estate & Powers of Attorney',
    feeCents: 2500,
    body: `DURABLE POWER OF ATTORNEY FOR FINANCIAL MANAGEMENT

NOTICE: THE POWERS GRANTED BY THIS DOCUMENT ARE BROAD AND SWEEPING.

1. APPOINTMENT OF AGENT
I, the Principal identified in this notarization record, hereby appoint and designate my duly authorized Attorney-in-Fact to act in my name, place, and stead in any way which I myself could do, if I were personally present, with respect to banking transactions, real property management, tax filings, and investment administration.

2. DURABILITY CLAUSE
This Power of Attorney shall not be affected by subsequent disability or incapacity of the Principal, or lapse of time.

3. EFFECTIVE DATE AND REVOCATION
This instrument becomes effective immediately upon execution and acknowledgment before a duly commissioned Notary Public, and remains in full force unless revoked in writing by the Principal.`,
  },
  {
    id: 'quitclaim-deed',
    title: 'Real Property Quitclaim Deed',
    fileName: 'Real_Property_Quitclaim_Deed.txt',
    actType: 'Acknowledgment',
    defaultFolderName: 'Real Estate & Deeds',
    feeCents: 3500,
    body: `QUITCLAIM DEED OF REAL PROPERTY

THIS INDENTURE, made this day between the Grantor (Principal Signer) and the Grantee Trust, WITNESSETH:

That the said Grantor, for and in consideration of the sum of Ten Dollars ($10.00) and other valuable consideration, in hand paid, does hereby remise, release, and forever quitclaim unto the said Grantee, all right, title, interest, claim, and demand which the Grantor has in and to the parcel of land situated in the County of San Francisco, State of California, commonly known as Parcel APN 3721-048.

TO HAVE AND TO HOLD the same, together with all and singular the appurtenances and privileges thereunto belonging, forever.`,
  },
  {
    id: 'affidavit-identity',
    title: 'Sworn Affidavit of Identity & Residence',
    fileName: 'Sworn_Affidavit_Identity.txt',
    actType: 'Jurat',
    defaultFolderName: 'Affidavits & Personal',
    feeCents: 2500,
    body: `SWORN AFFIDAVIT OF IDENTITY AND DOMICILE

State of California
County of Sacramento

I, the undersigned Affiant, being first duly sworn under penalty of perjury, depose and state as follows:
1. I am over eighteen (18) years of age and competent to execute this Affidavit.
2. My full legal name and current residential address match the government-issued photo credential presented during this remote online notarization session.
3. All representations made herein are true, correct, and complete to the best of my personal knowledge and belief.`,
  },
  {
    id: 'corporate-incumbency',
    title: 'Corporate Secretary Certificate of Incumbency',
    fileName: 'Corporate_Incumbency_Certificate.txt',
    actType: 'Oath / Affirmation',
    defaultFolderName: 'Corporate & Legal',
    feeCents: 3000,
    body: `CERTIFICATE OF INCUMBENCY AND CORPORATE RESOLUTION

The undersigned, being the duly elected Corporate Secretary, hereby certifies that:
1. The Corporation is validly existing and in good standing under the laws of the State of Delaware.
2. The resolutions adopted by the Board of Directors on November 2, 2026, authorizing execution of the Master Services and Credit Facility Agreements, remain in full force and effect without modification.
3. Each officer listed in Schedule A is a duly appointed signatory authorized to bind the Corporation.`,
  },
  {
    id: 'veriseal-certified-attestation',
    title: 'VeriSeal Certified Official Logo & Mark Attestation',
    fileName: 'VeriSeal_Certified_Logo_Attestation.txt',
    actType: 'Copy Certification',
    defaultFolderName: 'Corporate & Legal',
    feeCents: 2500,
    body: `OFFICIAL ATTESTATION OF THE "VERISEAL CERTIFIED" LOGO AND "NOTARIZED" SEAL MARK

1. SUBJECT EMBLEMS
This instrument formally records and certifies the official "VeriSeal Certified" vector emblem (shield-and-check mark paired with ECDSA cryptographic attestation seal) and the accompanying "NOTARIZED" official verification mark issued for authenticated electronic records.

2. AUTHORIZATION AND INTEGRITY
The Principal Signer affirms that the VeriSeal Certified emblem and Notarized mark attached to this record are true, accurate, and unaltered representations designated for cryptographic timestamping, chain-of-custody verification, and statutory certificate issuance.

3. OPTIONAL ATTACHMENT NOTICE
Authorized parties may elect to affix or omit the VeriSeal Certified logo and Notarized official mark on executed documents and signing certificates as recorded in the notarization metadata.`,
  },
];

export interface KbaQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}

export const KBA_QUESTIONS: KbaQuestion[] = [
  {
    id: 'kba-1',
    prompt: 'Which previous street address was associated with your credit file prior to 2023?',
    options: [
      '4180 Cedar Ridge Pkwy',
      '742 Evergreen Terrace',
      '1920 Market St, Apt 4B',
      'None of the above',
    ],
    correctIndex: 2,
  },
  {
    id: 'kba-2',
    prompt: 'Which financial institution issued your auto or equipment lien opened in 2021?',
    options: [
      'Pacific Crest Credit Union',
      'First Liberty National Bank',
      'Summit Municipal Savings',
      'No auto lien on file',
    ],
    correctIndex: 0,
  },
  {
    id: 'kba-3',
    prompt: 'In which county was your state professional license or voter registration recorded?',
    options: [
      'King County',
      'Sacramento County',
      'Travis County',
      'Suffolk County',
    ],
    correctIndex: 1,
  },
];

export const DEFAULT_FOLDER_NAMES = [
  'Real Estate & Deeds',
  'Corporate & Legal',
  'Estate & Powers of Attorney',
  'Affidavits & Personal',
];
