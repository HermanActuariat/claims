"use client";
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout/main-layout";
import { Spinner } from "@/components/ui/spinner";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AIAnalysisPanel } from "@/components/claims/AIAnalysisPanel";
import { ClaimTimeline } from "@/components/claims/ClaimTimeline";
import { RiskScoreWidget } from "@/components/risk/RiskScoreWidget";
import { RiskScoreHistory } from "@/components/risk/RiskScoreHistory";
import {
  CLAIM_STATUS_LABELS,
  CLAIM_TYPE_LABELS,
  VALID_TRANSITIONS,
  ClaimStatus,
  ClaimWithRelations,
} from "@/types";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { FileUpload, type FileWithStatus } from "@/components/ui/FileUpload";
import {
  ArrowLeft, MapPin, Calendar, Car, User, FileText, MessageSquare,
  UploadCloud, Pencil, Trash2, X, AlertTriangle, CheckCircle,
  XCircle, ArrowUpRight, Clock, DollarSign
} from "lucide-react";
import Link from "next/link";

const TYPE_OPTIONS = Object.entries(CLAIM_TYPE_LABELS).map(([value, label]) => ({ value, label }));

const STATUS_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  SUBMITTED:   { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200" },
  IN_REVIEW:   { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200" },
  ANALYZED:    { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  APPROVED:    { bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-200" },
  REJECTED:    { bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200" },
  CLOSED:      { bg: "bg-slate-100", text: "text-slate-600",  border: "border-slate-200" },
};

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white/70 backdrop-blur-sm rounded-2xl border border-white/60 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, count }: { icon: typeof FileText; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
      <div className="h-7 w-7 rounded-lg bg-indigo-50 flex items-center justify-center">
        <Icon className="h-4 w-4 text-indigo-600" />
      </div>
      <span className="text-sm font-semibold text-slate-800" style={{ fontFamily: "Space Grotesk, Inter, sans-serif" }}>
        {title}
      </span>
      {count !== undefined && (
        <span className="ml-auto text-xs text-slate-400">{count}</span>
      )}
    </div>
  );
}

export default function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const router = useRouter();
  const [claim, setClaim] = useState<ClaimWithRelations | null>(null);
  const [auditLogs, setAuditLogs] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [docFiles, setDocFiles] = useState<FileWithStatus[]>([]);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [uploadDocErrors, setUploadDocErrors] = useState<string[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState({ type: "", description: "", incidentDate: "", incidentLocation: "" });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [handlers, setHandlers] = useState<{ id: string; name: string; email: string; active: boolean }[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const fetchClaim = async () => {
    try {
      const canViewLogs = ["MANAGER", "ADMIN"].includes(session?.user?.role ?? "");
      const requests: Promise<Response>[] = [fetch(`/api/claims/${id}`)];
      if (canViewLogs) requests.push(fetch(`/api/admin/audit-logs?claimId=${id}`));
      const [claimRes, logsRes] = await Promise.all(requests);
      if (!claimRes.ok) throw new Error(`Sinistre introuvable (${claimRes.status})`);
      const claimData = (await claimRes.json()) as { data: ClaimWithRelations };
      setClaim(claimData.data);
      if (logsRes) {
        const logsData = (await logsRes.json()) as { data: unknown[] };
        setAuditLogs(logsData.data || []);
      }
    } catch (err) {
      console.error("Erreur chargement sinistre:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (session !== undefined) fetchClaim(); }, [id, session]);

  useEffect(() => {
    if (session?.user?.role === "MANAGER" || session?.user?.role === "ADMIN") {
      fetch("/api/admin/users?role=HANDLER&active=true&pageSize=100")
        .then((r) => r.json())
        .then((d: { data: typeof handlers }) => setHandlers(d.data ?? []))
        .catch((err) => console.error("Failed to fetch handlers:", err));
    }
  }, [session]);

  const updateStatus = async (newStatus: string) => {
    setStatusUpdating(true);
    setMutationError(null);
    try {
      const res = await fetch(`/api/claims/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
      }
      await fetchClaim();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Erreur lors du changement de statut");
    } finally {
      setStatusUpdating(false);
    }
  };

  const addComment = async () => {
    if (!newComment.trim()) return;
    setAddingComment(true);
    setMutationError(null);
    try {
      const res = await fetch(`/api/claims/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newComment, isInternal: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
      }
      setNewComment("");
      await fetchClaim();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Erreur lors de l'ajout du commentaire");
    } finally {
      setAddingComment(false);
    }
  };

  const uploadDocuments = async () => {
    const toUpload = docFiles.filter((f) => f.status === "selected");
    if (toUpload.length === 0) return;
    setUploadingDocs(true);
    setUploadDocErrors([]);
    setDocFiles((prev) => prev.map((f) => f.status === "selected" ? { ...f, status: "uploading" } : f));
    const errors: string[] = [];
    for (let i = 0; i < docFiles.length; i++) {
      const entry = docFiles[i];
      if (entry.status !== "selected") continue;
      const fd = new FormData();
      fd.append("file", entry.file);
      try {
        const res = await fetch(`/api/claims/${id}/documents`, { method: "POST", body: fd });
        const json = (await res.json()) as { error?: string; data?: { id: string } };
        if (!res.ok) {
          const msg = json.error ?? "Erreur inconnue";
          setDocFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, status: "error", error: msg } : f));
          errors.push(`${entry.file.name} : ${msg}`);
        } else {
          setDocFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, status: "success", documentId: json.data?.id } : f));
        }
      } catch {
        const msg = "Échec de l'upload";
        setDocFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, status: "error", error: msg } : f));
        errors.push(`${entry.file.name} : ${msg}`);
      }
    }
    setUploadDocErrors(errors);
    setUploadingDocs(false);
    if (errors.length === 0) { setDocFiles([]); await fetchClaim(); }
  };

  const reassign = async (userId: string) => {
    if (!userId) return;
    setAssigning(true);
    setMutationError(null);
    try {
      const res = await fetch(`/api/claims/${id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
      }
      await fetchClaim();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Erreur lors de la réassignation");
    } finally {
      setAssigning(false);
    }
  };

  const openEdit = () => {
    if (!claim) return;
    setEditData({
      type: claim.type,
      description: claim.description,
      incidentDate: claim.incidentDate.toString().split("T")[0],
      incidentLocation: claim.incidentLocation,
    });
    setEditError(null);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    setEditLoading(true);
    setEditError(null);
    const res = await fetch(`/api/claims/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editData, incidentDate: new Date(editData.incidentDate).toISOString() }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) { setEditError(json.error ?? "Erreur lors de la modification"); setEditLoading(false); return; }
    setEditOpen(false);
    setEditLoading(false);
    await fetchClaim();
  };

  const handleDelete = async () => {
    setDeleteLoading(true);
    setMutationError(null);
    try {
      const res = await fetch(`/api/claims/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
      }
      router.push("/claims");
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Erreur lors de la suppression");
      setDeleteLoading(false);
      setDeleteConfirm(false);
    }
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="flex justify-center py-20">
          <Spinner size="lg" className="text-indigo-600" />
        </div>
      </MainLayout>
    );
  }

  if (!claim) {
    return (
      <MainLayout>
        <div className="text-center py-20">
          <div className="h-16 w-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="h-8 w-8 text-red-400" />
          </div>
          <p className="text-slate-500 mb-4">Sinistre introuvable</p>
          <Link href="/claims">
            <button className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50">
              Retour aux sinistres
            </button>
          </Link>
        </div>
      </MainLayout>
    );
  }

  const availableTransitions = VALID_TRANSITIONS[claim.status] || [];
  const canChangeStatus = session?.user?.role !== "HANDLER" || !["APPROVED", "REJECTED"].includes(claim.status);
  const statusStyle = STATUS_STYLE[claim.status] ?? STATUS_STYLE.SUBMITTED;

  return (
    <MainLayout>
      {/* Edit Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Pencil className="h-4 w-4 text-indigo-600" />
                <h2 className="text-base font-semibold text-slate-800" style={{ fontFamily: "Space Grotesk, Inter, sans-serif" }}>
                  Modifier le sinistre
                </h2>
              </div>
              <button onClick={() => setEditOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Type de sinistre</Label>
                <select
                  value={editData.type}
                  onChange={(e) => setEditData((d) => ({ ...d, type: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Date</Label>
                  <Input type="date" value={editData.incidentDate} onChange={(e) => setEditData((d) => ({ ...d, incidentDate: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Lieu</Label>
                  <Input value={editData.incidentLocation} onChange={(e) => setEditData((d) => ({ ...d, incidentLocation: e.target.value }))} className="rounded-xl" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Description</Label>
                <Textarea rows={4} value={editData.description} onChange={(e) => setEditData((d) => ({ ...d, description: e.target.value }))} className="rounded-xl" />
              </div>
              {editError && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{editError}</p>}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/60">
              <button onClick={() => setEditOpen(false)} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50">
                Annuler
              </button>
              <button onClick={saveEdit} disabled={editLoading} className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                {editLoading ? <Spinner size="sm" className="border-white border-t-transparent" /> : null}
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6" style={{ fontFamily: "Inter, sans-serif" }}>

        {/* Breadcrumb + header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Link href="/claims">
              <button className="h-9 w-9 rounded-xl border border-slate-200 bg-white/70 flex items-center justify-center hover:bg-slate-50 transition-colors shrink-0">
                <ArrowLeft className="h-4 w-4 text-slate-600" />
              </button>
            </Link>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold font-mono text-slate-900">{claim.claimNumber}</h1>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                  {CLAIM_STATUS_LABELS[claim.status]}
                </span>
              </div>
              <p className="text-slate-400 text-sm mt-1">
                {CLAIM_TYPE_LABELS[claim.type]} · Créé le {formatDate(claim.createdAt)}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {claim && (session?.user?.role !== "HANDLER" || claim.status === "SUBMITTED") && (
              <button onClick={openEdit} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-slate-600 border border-slate-200 bg-white/70 hover:bg-slate-50 transition-colors">
                <Pencil className="h-3.5 w-3.5" /> Modifier
              </button>
            )}
            {["MANAGER", "ADMIN"].includes(session?.user?.role ?? "") && (
              !deleteConfirm ? (
                <button onClick={() => setDeleteConfirm(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  <span className="text-sm text-red-700">Confirmer ?</span>
                  <button onClick={handleDelete} disabled={deleteLoading} className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-xs font-medium disabled:opacity-50">
                    {deleteLoading ? <Spinner size="sm" className="border-white border-t-transparent" /> : "Oui"}
                  </button>
                  <button onClick={() => setDeleteConfirm(false)}><X className="h-4 w-4 text-slate-400" /></button>
                </div>
              )
            )}

            {/* Quick action buttons */}
            {availableTransitions.includes("REJECTED" as ClaimStatus) && canChangeStatus && (
              <button
                onClick={() => updateStatus("REJECTED")}
                disabled={statusUpdating}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 transition-colors"
              >
                <XCircle className="h-3.5 w-3.5" /> Rejeter
              </button>
            )}
            {availableTransitions.includes("IN_REVIEW" as ClaimStatus) && canChangeStatus && (
              <button
                onClick={() => updateStatus("IN_REVIEW")}
                disabled={statusUpdating}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-amber-600 border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors"
              >
                <ArrowUpRight className="h-3.5 w-3.5" /> Escalader
              </button>
            )}
            {availableTransitions.includes("APPROVED" as ClaimStatus) && canChangeStatus && (
              <button
                onClick={() => updateStatus("APPROVED")}
                disabled={statusUpdating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-700 hover:to-cyan-600 shadow-md transition-all"
              >
                <CheckCircle className="h-3.5 w-3.5" /> Approuver
              </button>
            )}
            {availableTransitions.length > 0 && canChangeStatus && (
              <div className="flex items-center gap-2">
                <Select
                  options={availableTransitions.map((s) => ({ value: s, label: CLAIM_STATUS_LABELS[s as ClaimStatus] }))}
                  onChange={(e) => e.target.value && updateStatus(e.target.value)}
                  placeholder="Autre statut..."
                  className="w-44 rounded-xl text-sm"
                  disabled={statusUpdating}
                />
                {statusUpdating && <Spinner size="sm" className="text-indigo-600" />}
              </div>
            )}
          </div>
        </div>

        {mutationError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {mutationError}
            <button onClick={() => setMutationError(null)} className="ml-auto"><X className="h-4 w-4" /></button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main — 2 cols */}
          <div className="lg:col-span-2 space-y-5">

            {/* Claim details */}
            <GlassCard>
              <SectionHeader icon={FileText} title="Détails du sinistre" />
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { icon: Calendar, label: "Date du sinistre", value: formatDate(claim.incidentDate) },
                    { icon: MapPin, label: "Lieu", value: claim.incidentLocation },
                    { icon: Car, label: "Tiers impliqué", value: claim.thirdPartyInvolved ? "Oui" : "Non" },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="bg-slate-50/60 rounded-xl p-3.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">{label}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-800">{value}</p>
                    </div>
                  ))}
                  <div className="bg-slate-50/60 rounded-xl p-3.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <User className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Gestionnaire</span>
                    </div>
                    {["MANAGER", "ADMIN"].includes(session?.user?.role ?? "") ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={claim.assignedTo?.id ?? ""}
                          onChange={(e) => reassign(e.target.value)}
                          disabled={assigning}
                          className="text-sm border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                        >
                          <option value="">— Non assigné —</option>
                          {handlers.map((h) => (
                            <option key={h.id} value={h.id}>{h.name}</option>
                          ))}
                        </select>
                        {assigning && <Spinner size="sm" className="text-indigo-600" />}
                      </div>
                    ) : (
                      <p className="text-sm font-semibold text-slate-800">{claim.assignedTo?.name || "Non assigné"}</p>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2">Description</p>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50/60 rounded-xl p-4">
                    {claim.description}
                  </p>
                </div>

                {(claim.estimatedAmount || claim.approvedAmount) && (
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                    {claim.estimatedAmount && (
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-indigo-50 flex items-center justify-center">
                          <DollarSign className="h-4 w-4 text-indigo-600" />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider">Montant estimé</p>
                          <p className="text-sm font-bold text-indigo-700">{formatCurrency(claim.estimatedAmount)}</p>
                        </div>
                      </div>
                    )}
                    {claim.approvedAmount && (
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider">Montant approuvé</p>
                          <p className="text-sm font-bold text-emerald-700">{formatCurrency(claim.approvedAmount)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </GlassCard>

            {/* Policyholder */}
            <GlassCard>
              <SectionHeader icon={User} title="Assuré" />
              <div className="p-6">
                <div className="flex items-center gap-4 mb-5">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white font-bold text-lg shrink-0">
                    {claim.policyholder.firstName[0]}{claim.policyholder.lastName[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{claim.policyholder.firstName} {claim.policyholder.lastName}</p>
                    <p className="text-sm text-slate-400">{claim.policyholder.email}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Téléphone", value: claim.policyholder.phone },
                    { label: "Numéro de police", value: claim.policyholder.policyNumber, mono: true },
                    { label: "Véhicule", value: `${claim.policyholder.vehicleMake} ${claim.policyholder.vehicleModel} (${claim.policyholder.vehicleYear})` },
                    { label: "Immatriculation", value: claim.policyholder.vehiclePlate, mono: true },
                  ].map(({ label, value, mono }) => (
                    <div key={label} className="bg-slate-50/60 rounded-xl p-3">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</p>
                      <p className={`text-sm font-semibold text-slate-800 mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>

            {/* AI Analysis */}
            <GlassCard className="overflow-hidden">
              <div className="p-6">
                <AIAnalysisPanel claimId={id} policyholderEmail={claim.policyholder.email} onAnalysisComplete={fetchClaim} />
              </div>
            </GlassCard>

            {/* Comments */}
            <GlassCard>
              <SectionHeader icon={MessageSquare} title="Commentaires internes" count={claim.comments?.length} />
              <div className="p-6 space-y-4">
                {claim.comments && claim.comments.length > 0 ? (
                  <div className="space-y-3">
                    {claim.comments.map((comment) => (
                      <div key={comment.id} className="bg-slate-50/60 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-lg bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-700">
                              {comment.author.name[0]}
                            </div>
                            <span className="text-xs font-semibold text-slate-700">{comment.author.name}</span>
                          </div>
                          <span className="text-xs text-slate-400">{formatDateTime(comment.createdAt)}</span>
                        </div>
                        <p className="text-sm text-slate-700">{comment.content}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Aucun commentaire</p>
                )}
                <div className="flex gap-2 pt-2 border-t border-slate-100">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Ajouter un commentaire interne..."
                    className="flex-1 text-sm border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white/80"
                    onKeyDown={(e) => e.key === "Enter" && addComment()}
                  />
                  <button
                    onClick={addComment}
                    disabled={!newComment.trim() || addingComment}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {addingComment ? <Spinner size="sm" className="border-white border-t-transparent" /> : "Ajouter"}
                  </button>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Sidebar */}
          <div className="space-y-5">

            {/* Timeline */}
            <GlassCard>
              <SectionHeader icon={Clock} title="Historique" />
              <div className="p-6">
                <ClaimTimeline events={auditLogs as Parameters<typeof ClaimTimeline>[0]["events"]} />
              </div>
            </GlassCard>

            {/* Risk Score */}
            {claim.policyholderID && (
              <>
                <RiskScoreWidget policyholderId={claim.policyholderID} />
                <RiskScoreHistory policyholderId={claim.policyholderID} />
              </>
            )}

            {/* Documents */}
            <GlassCard>
              <SectionHeader icon={FileText} title="Documents" count={claim.documents?.length} />
              <div className="p-6 space-y-4">
                {claim.documents && claim.documents.length > 0 ? (
                  <div className="space-y-2">
                    {claim.documents.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-3 p-3 bg-slate-50/60 rounded-xl">
                        <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                          <FileText className="h-4 w-4 text-indigo-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate">{doc.filename}</p>
                          <p className="text-[10px] text-slate-400">{(doc.size / 1024).toFixed(0)} Ko</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Aucun document</p>
                )}

                <div className="pt-3 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 mb-3 flex items-center gap-1.5">
                    <UploadCloud className="h-3.5 w-3.5" /> Ajouter des documents
                  </p>
                  <FileUpload files={docFiles} onFilesChange={setDocFiles} disabled={uploadingDocs} />
                  {uploadDocErrors.length > 0 && (
                    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-xl space-y-0.5">
                      {uploadDocErrors.map((err, i) => (
                        <p key={i} className="text-xs text-red-600">{err}</p>
                      ))}
                    </div>
                  )}
                  {docFiles.some((f) => f.status === "selected") && (
                    <button
                      type="button"
                      onClick={uploadDocuments}
                      disabled={uploadingDocs}
                      className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-700 hover:to-cyan-600 disabled:opacity-50 transition-all"
                    >
                      <UploadCloud className="h-4 w-4" />
                      {uploadingDocs ? "Upload en cours…" : "Envoyer les documents"}
                    </button>
                  )}
                </div>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
