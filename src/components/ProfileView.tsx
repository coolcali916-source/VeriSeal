import React, { useEffect, useState } from 'react';
import { sendPasswordResetEmail, type User } from 'firebase/auth';
import {
  Check,
  KeyRound,
  LogOut,
  RefreshCw,
  Shield,
  UserCheck,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import {
  CURRENT_APP_BUILD,
  type AppVersionManifest,
} from '../lib/appUpdater';
import type { NotarizationCase, SignatureType, UserProfile } from '../types/notary';
import { ProfileSignatureTool } from './ProfileSignatureTool';
import { StampUploaderTool } from './StampUploaderTool';

interface ProfileViewProps {
  firebaseUser: User | null;
  profile: UserProfile;
  cases: NotarizationCase[];
  onSaveProfile: (next: UserProfile) => Promise<void>;
  onOpenAuthModal: () => void;
  onSignOut: () => Promise<void>;
  onOpenCase: (caseId: string) => void;
  updateAvailable: boolean;
  checkingUpdate: boolean;
  updatingApp: boolean;
  remoteBuild: AppVersionManifest | null;
  onUpdateApp: (forceReload?: boolean) => Promise<void>;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  firebaseUser,
  profile,
  cases,
  onSaveProfile,
  onOpenAuthModal,
  onSignOut,
  onOpenCase,
  updateAvailable,
  checkingUpdate,
  updatingApp,
  remoteBuild,
  onUpdateApp,
}) => {
  const [form, setForm] = useState<UserProfile>(profile);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [resetNotice, setResetNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setForm(profile);
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedMsg('');
    setErrorMsg('');
    try {
      await onSaveProfile(form);
      setSavedMsg('Profile and commission details updated.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to save profile changes.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStamp = async (stampDataUrl: string) => {
    const next = { ...form, customStampDataUrl: stampDataUrl };
    setForm(next);
    await onSaveProfile(next);
  };

  const handleSaveSignature = async (
    signatureData: string,
    signatureType: SignatureType
  ) => {
    const next = {
      ...form,
      savedSignatureData: signatureData,
      savedSignatureType: signatureType,
    };
    setForm(next);
    await onSaveProfile(next);
  };

  const handlePasswordReset = async () => {
    if (!firebaseUser?.email) return;
    setResetNotice('');
    setErrorMsg('');
    try {
      await sendPasswordResetEmail(auth, firebaseUser.email);
      setResetNotice(
        `Password recovery email dispatched to ${firebaseUser.email}.`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Unable to send password recovery email.'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Account Status & Authentication Summary */}
      <div className="border border-slate-200 bg-white rounded-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
            <UserCheck className="w-5 h-5 text-slate-800" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {firebaseUser
                ? firebaseUser.displayName || profile.displayName
                : 'Local Workspace Preview'}
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              {firebaseUser
                ? `${firebaseUser.email} · ${
                    firebaseUser.emailVerified ? 'Verified Identity' : 'Unverified Email'
                  } · Synced to Firestore`
                : 'Sign in with Google or Email/Password to persist your documents, folders, and transparent notary stamp in Firestore.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {firebaseUser ? (
            <>
              {firebaseUser.email && (
                <button
                  type="button"
                  onClick={() => void handlePasswordReset()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Password Reset
                </button>
              )}
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onOpenAuthModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-800 rounded-md hover:bg-blue-900 cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5" />
              Sign In / Register
            </button>
          )}
        </div>
      </div>

      {resetNotice && (
        <div className="px-4 py-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
          {resetNotice}
        </div>
      )}

      {errorMsg && (
        <div className="px-4 py-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
          {errorMsg}
        </div>
      )}

      {/* Personal Information & Notary Commission Form */}
      <form
        onSubmit={handleSubmit}
        className="border border-slate-200 bg-white rounded-lg p-6 space-y-5"
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Personal Information &amp; Notary Commission
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              These details populate signer records, electronic notary seals, and statutory certificates.
            </p>
          </div>
          {savedMsg && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <Check className="w-3.5 h-3.5" />
              {savedMsg}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Full Legal Name
            </label>
            <input
              type="text"
              required
              maxLength={100}
              value={form.displayName}
              onChange={(e) =>
                setForm((p) => ({ ...p, displayName: e.target.value }))
              }
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Contact Email
            </label>
            <input
              type="email"
              maxLength={120}
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              maxLength={40}
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              placeholder="+1 (415) 555-0148"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              City &amp; State
            </label>
            <input
              type="text"
              maxLength={120}
              value={form.location}
              onChange={(e) =>
                setForm((p) => ({ ...p, location: e.target.value }))
              }
              placeholder="San Francisco, CA"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Notary Commission Number
            </label>
            <input
              type="text"
              maxLength={60}
              value={form.commissionNumber}
              onChange={(e) =>
                setForm((p) => ({ ...p, commissionNumber: e.target.value }))
              }
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Commission Jurisdiction
            </label>
            <input
              type="text"
              maxLength={60}
              value={form.commissionJurisdiction}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  commissionJurisdiction: e.target.value,
                }))
              }
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Commission Expiration Date
            </label>
            <input
              type="text"
              maxLength={30}
              value={form.commissionExpires}
              onChange={(e) =>
                setForm((p) => ({ ...p, commissionExpires: e.target.value }))
              }
              placeholder="2028-09-30"
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Saving Profile...' : 'Save Profile Changes'}
          </button>
        </div>
      </form>

      {/* Saved Electronic Signature Studio */}
      <ProfileSignatureTool
        displayName={form.displayName}
        currentSignatureData={form.savedSignatureData || ''}
        currentSignatureType={form.savedSignatureType || 'none'}
        onSaveSignature={handleSaveSignature}
        saving={saving}
      />

      {/* Transparent Notary Stamp Upload & Processor */}
      <StampUploaderTool
        currentStampDataUrl={form.customStampDataUrl}
        onSaveStamp={handleSaveStamp}
        saving={saving}
      />

      {/* Application Version & Live Updates */}
      <div className="border border-slate-200 bg-white rounded-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Application Updates
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            Current Build: {CURRENT_APP_BUILD.buildId} · Built{' '}
            {new Date(CURRENT_APP_BUILD.builtAt).toLocaleString()}
          </p>
          {updateAvailable && remoteBuild && (
            <p className="text-xs font-medium text-blue-800 mt-1">
              New build available ({remoteBuild.buildId}). Click Update App Now to load the latest version.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={checkingUpdate || updatingApp}
            onClick={() => void onUpdateApp(false)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer disabled:opacity-50 ${
              updateAvailable
                ? 'text-white bg-blue-800 hover:bg-blue-900'
                : 'text-slate-900 bg-white border border-slate-300 hover:bg-slate-50'
            }`}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                checkingUpdate || updatingApp ? 'animate-spin' : ''
              }`}
            />
            {updatingApp
              ? 'Updating App...'
              : checkingUpdate
              ? 'Checking...'
              : updateAvailable
              ? 'Update App Now'
              : 'Check for Updates'}
          </button>
          <button
            type="button"
            disabled={updatingApp}
            onClick={() => void onUpdateApp(true)}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer disabled:opacity-50"
          >
            Reload Fresh Assets
          </button>
        </div>
      </div>

      {/* Personal Notarization History */}
      <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="text-base font-semibold text-slate-900">
            Notarization History
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Complete audit history of all notarization requests initiated or sealed under this account.
          </p>
        </div>

        {cases.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No notarization history recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-5">Document</th>
                  <th className="py-3 px-3">Act Type</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Updated</th>
                  <th className="py-3 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {cases.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="py-3 px-5 font-medium text-slate-900">
                      {item.title}
                      <span className="block text-[11px] text-slate-500 font-normal">
                        {item.fileName}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-600">{item.actType}</td>
                    <td className="py-3 px-3 font-medium capitalize text-slate-800">
                      {item.status.replace('_', ' ')}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-500 tabular-nums">
                      {new Date(item.updatedAtIso).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-5 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenCase(item.id)}
                        className="px-3 py-1 font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
