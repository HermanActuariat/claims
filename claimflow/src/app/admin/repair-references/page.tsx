"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Plus, X, Wrench, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  RepairReferenceItem,
  REPAIR_CATEGORY_LABELS,
  VEHICLE_SEGMENT_LABELS,
  RepairCategory,
  VehicleSegment,
} from "@/types";

const CATEGORY_OPTIONS = Object.entries(REPAIR_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));
const SEGMENT_OPTIONS = Object.entries(VEHICLE_SEGMENT_LABELS).map(([value, label]) => ({ value, label }));
const SOURCE_OPTIONS = [
  { value: "MANUAL", label: "Manuel" },
  { value: "SRA_OBSERVATOIRE", label: "SRA Observatoire" },
  { value: "SRA_API", label: "SRA API" },
];

interface FormData {
  category: string;
  subcategory: string;
  vehicleSegment: string;
  avgPartCost: string;
  avgLaborHours: string;
  avgLaborRate: string;
  source: string;
  validFrom: string;
  validUntil: string;
}

const emptyForm: FormData = {
  category: "BODY",
  subcategory: "",
  vehicleSegment: "SEDAN",
  avgPartCost: "0",
  avgLaborHours: "0",
  avgLaborRate: "0",
  source: "MANUAL",
  validFrom: new Date().toISOString().split("T")[0],
  validUntil: "",
};

export default function RepairReferencesPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [refs, setRefs] = useState<RepairReferenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSegment, setFilterSegment] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRefs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterCategory) params.set("category", filterCategory);
      if (filterSegment) params.set("vehicleSegment", filterSegment);
      params.set("pageSize", "100");
      const res = await fetch(`/api/admin/repair-references?${params}`);
      if (res.ok) {
        const json = (await res.json()) as { data: RepairReferenceItem[] };
        setRefs(json.data);
      } else {
        setError("Impossible de charger les barèmes de réparation");
      }
    } catch (err) {
      console.error("Failed to fetch repair references:", err);
      setError("Erreur réseau lors du chargement des barèmes");
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterSegment]);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session || !["MANAGER", "ADMIN"].includes(session.user.role)) {
      router.push("/dashboard");
      return;
    }
    fetchRefs();
  }, [session, sessionStatus, router, fetchRefs]);

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (ref: RepairReferenceItem) => {
    setEditId(ref.id);
    setForm({
      category: ref.category,
      subcategory: ref.subcategory,
      vehicleSegment: ref.vehicleSegment,
      avgPartCost: String(ref.avgPartCost),
      avgLaborHours: String(ref.avgLaborHours),
      avgLaborRate: String(ref.avgLaborRate),
      source: ref.source,
      validFrom: ref.validFrom.split("T")[0],
      validUntil: ref.validUntil?.split("T")[0] ?? "",
    });
    setError(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const payload = {
      category: form.category,
      subcategory: form.subcategory,
      vehicleSegment: form.vehicleSegment,
      avgPartCost: Number(form.avgPartCost),
      avgLaborHours: Number(form.avgLaborHours),
      avgLaborRate: Number(form.avgLaborRate),
      source: form.source,
      validFrom: form.validFrom,
      validUntil: form.validUntil || null,
    };

    const url = editId
      ? `/api/admin/repair-references/${editId}`
      : "/api/admin/repair-references";
    const method = editId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Erreur lors de la sauvegarde");
      setSaving(false);
      return;
    }

    setModalOpen(false);
    setSaving(false);
    await fetchRefs();
  };

  if (sessionStatus === "loading" || loading) {
    return (
      <MainLayout>
        <div className="flex justify-center py-20">
          <Spinner size="lg" className="text-indigo-600" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-800" style={{ fontFamily: "Space Grotesk, Inter, sans-serif" }}>
                {editId ? "Modifier le barème" : "Nouveau barème"}
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Catégorie</Label>
                  <Select
                    options={CATEGORY_OPTIONS}
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Segment</Label>
                  <Select
                    options={SEGMENT_OPTIONS}
                    value={form.vehicleSegment}
                    onChange={(e) => setForm((f) => ({ ...f, vehicleSegment: e.target.value }))}
                    className="rounded-xl"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Sous-catégorie</Label>
                <Input value={form.subcategory} onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))} className="rounded-xl" placeholder="Ex: Pare-chocs avant" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Coût pièces</Label>
                  <Input type="number" step="0.01" value={form.avgPartCost} onChange={(e) => setForm((f) => ({ ...f, avgPartCost: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Heures MO</Label>
                  <Input type="number" step="0.5" value={form.avgLaborHours} onChange={(e) => setForm((f) => ({ ...f, avgLaborHours: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Taux horaire</Label>
                  <Input type="number" step="0.01" value={form.avgLaborRate} onChange={(e) => setForm((f) => ({ ...f, avgLaborRate: e.target.value }))} className="rounded-xl" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Source</Label>
                  <Select
                    options={SOURCE_OPTIONS}
                    value={form.source}
                    onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Valide depuis</Label>
                  <Input type="date" value={form.validFrom} onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Valide jusqu&apos;à</Label>
                  <Input type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} className="rounded-xl" />
                </div>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/60">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50">Annuler</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                {saving && <Spinner size="sm" className="border-white border-t-transparent" />}
                {editId ? "Enregistrer" : "Créer"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6" style={{ fontFamily: "Inter, sans-serif" }}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-500 flex items-center justify-center">
              <Wrench className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900" style={{ fontFamily: "Space Grotesk, Inter, sans-serif" }}>
                Barèmes de réparation
              </h1>
              <p className="text-sm text-slate-400">{refs.length} référence(s)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchRefs} className="rounded-xl">
              <RefreshCw className="h-4 w-4 mr-1" /> Actualiser
            </Button>
            <Button size="sm" onClick={openCreate} className="rounded-xl bg-indigo-600 hover:bg-indigo-700">
              <Plus className="h-4 w-4 mr-1" /> Nouveau barème
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <Select
            options={[{ value: "", label: "Toutes les catégories" }, ...CATEGORY_OPTIONS]}
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="w-48 rounded-xl"
          />
          <Select
            options={[{ value: "", label: "Tous les segments" }, ...SEGMENT_OPTIONS]}
            value={filterSegment}
            onChange={(e) => setFilterSegment(e.target.value)}
            className="w-48 rounded-xl"
          />
        </div>

        {/* Table */}
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-white/60 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Catégorie</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Sous-catégorie</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Segment</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Pièces</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Heures MO</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Taux/h</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Total est.</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Source</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {refs.map((ref) => (
                <tr key={ref.id} className="border-b border-slate-50 hover:bg-slate-50/40 transition-colors">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {REPAIR_CATEGORY_LABELS[ref.category as RepairCategory] ?? ref.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">{ref.subcategory}</td>
                  <td className="px-4 py-3 text-slate-600">{VEHICLE_SEGMENT_LABELS[ref.vehicleSegment as VehicleSegment] ?? ref.vehicleSegment}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{formatCurrency(ref.avgPartCost)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{ref.avgLaborHours}h</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{formatCurrency(ref.avgLaborRate)}/h</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-indigo-700">
                    {formatCurrency(ref.avgPartCost + ref.avgLaborHours * ref.avgLaborRate)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-500">{ref.source}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(ref)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                      Modifier
                    </button>
                  </td>
                </tr>
              ))}
              {refs.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                    Aucun barème de réparation. Cliquez sur &quot;Nouveau barème&quot; pour commencer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MainLayout>
  );
}
