"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatCurrency } from "@/lib/utils";
import { QUOTE_LINE_TYPE_LABELS, QuoteLineType } from "@/types";
import { FileText, Upload, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";

interface QuoteLine {
  id: string;
  lineType: string;
  description: string;
  partReference: string | null;
  quantity: number;
  unitPriceHT: number;
  laborHours: number | null;
  laborRateHT: number | null;
  totalHT: number;
  confidence: number | null;
}

interface Quote {
  id: string;
  documentId: string;
  documentName?: string;
  garageName: string | null;
  garageCity: string | null;
  totalAmount: number | null;
  extractedByAI: boolean;
  validatedById: string | null;
  validatedAt: string | null;
  createdAt: string;
  lines: QuoteLine[];
}

interface GarageQuotePanelProps {
  claimId: string;
  userRole: string;
}

export function GarageQuotePanel({ claimId, userRole }: GarageQuotePanelProps) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [validating, setValidating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canValidate = ["MANAGER", "ADMIN"].includes(userRole);

  const fetchQuotes = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/claims/${claimId}/garage-quotes`);
      if (res.ok) {
        const json = (await res.json()) as { data: Quote[] };
        setQuotes(json.data);
      } else {
        setError("Impossible de charger les devis garage");
      }
    } catch (err) {
      console.error("Failed to fetch garage quotes:", err);
      setError("Erreur réseau lors du chargement des devis");
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`/api/claims/${claimId}/garage-quotes`, { method: "POST", body: fd });
      if (res.ok) {
        setError(null);
        await fetchQuotes();
      } else {
        setError("Échec de l'upload du devis");
      }
    } catch (err) {
      console.error("Upload failed:", err);
      setError("Erreur réseau lors de l'upload");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleValidate = async (quoteId: string, validated: boolean) => {
    setValidating(quoteId);
    try {
      await fetch(`/api/claims/${claimId}/garage-quotes/${quoteId}/validate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validated }),
      });
      setError(null);
      await fetchQuotes();
    } catch (err) {
      console.error("Validation failed:", err);
      setError("Erreur lors de la validation du devis");
    } finally {
      setValidating(null);
    }
  };

  if (loading) {
    return (
      <Card className="border-2 border-amber-100 bg-amber-50/30">
        <CardContent className="flex justify-center py-8">
          <Spinner size="sm" className="text-amber-600" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-amber-100 bg-amber-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-amber-600" />
            Devis garage
            <span className="text-xs text-slate-400 font-normal">({quotes.length})</span>
          </div>
          <label className="cursor-pointer">
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUpload} className="hidden" disabled={uploading} />
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 transition-colors">
              {uploading ? <Spinner size="sm" className="border-white border-t-transparent" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? "Upload..." : "Importer un devis"}
            </span>
          </label>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {quotes.length === 0 && !error ? (
          <p className="text-sm text-slate-400 text-center py-4">Aucun devis garage importé</p>
        ) : (
          quotes.map((quote) => (
            <div key={quote.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* Quote header */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50/60 transition-colors"
                onClick={() => setExpandedId(expandedId === quote.id ? null : quote.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-slate-800">
                      {quote.garageName || "Garage inconnu"}
                    </span>
                    <span className="text-xs text-slate-400">
                      {quote.garageCity || "—"} · {quote.lines.length} ligne(s)
                      {quote.extractedByAI && " · IA"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {quote.totalAmount !== null && (
                    <span className="text-sm font-bold text-amber-700">{formatCurrency(quote.totalAmount)}</span>
                  )}
                  {quote.validatedById ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                      <CheckCircle className="h-3 w-3" /> Validé
                    </span>
                  ) : canValidate ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => { e.stopPropagation(); handleValidate(quote.id, true); }}
                      disabled={validating === quote.id}
                      className="text-xs rounded-lg"
                    >
                      {validating === quote.id ? <Spinner size="sm" /> : "Valider"}
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-400">En attente</span>
                  )}
                  {expandedId === quote.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </div>
              </div>

              {/* Expanded lines */}
              {expandedId === quote.id && quote.lines.length > 0 && (
                <div className="border-t border-slate-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50/60">
                        <th className="text-left px-3 py-2 text-slate-500 font-semibold">Type</th>
                        <th className="text-left px-3 py-2 text-slate-500 font-semibold">Description</th>
                        <th className="text-right px-3 py-2 text-slate-500 font-semibold">Qté</th>
                        <th className="text-right px-3 py-2 text-slate-500 font-semibold">PU HT</th>
                        <th className="text-right px-3 py-2 text-slate-500 font-semibold">Total HT</th>
                        <th className="text-right px-3 py-2 text-slate-500 font-semibold">Conf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quote.lines.map((line) => (
                        <tr key={line.id} className="border-t border-slate-50">
                          <td className="px-3 py-2">
                            <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                              {QUOTE_LINE_TYPE_LABELS[line.lineType as QuoteLineType] ?? line.lineType}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">{line.description}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600">{line.quantity}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600">{formatCurrency(line.unitPriceHT)}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800">{formatCurrency(line.totalHT)}</td>
                          <td className="px-3 py-2 text-right">
                            {line.confidence !== null && (
                              <span className={`font-mono ${line.confidence >= 0.8 ? "text-green-600" : line.confidence >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
                                {Math.round(line.confidence * 100)}%
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
