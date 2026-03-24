"use client";
import { EstimationResult, REPAIR_CATEGORY_LABELS, RepairCategory } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { TrendingUp, Info, Database, FileText as FileTextIcon } from "lucide-react";

interface EstimationCardProps {
  estimation: EstimationResult;
}

const CONFIDENCE_LABELS: Record<string, { label: string; color: string }> = {
  low: { label: "Faible", color: "text-red-600" },
  medium: { label: "Moyenne", color: "text-yellow-600" },
  high: { label: "Élevée", color: "text-green-600" },
};

const SOURCE_BADGES: Record<string, { label: string; bg: string; text: string; icon: typeof Database }> = {
  BAREME_INTERNE: { label: "Barème SRA interne", bg: "bg-indigo-50", text: "text-indigo-700", icon: Database },
  DEVIS_GARAGE: { label: "Devis garage", bg: "bg-green-50", text: "text-green-700", icon: FileTextIcon },
  COMBINED: { label: "Barème + Devis", bg: "bg-purple-50", text: "text-purple-700", icon: Database },
};

export function EstimationCard({ estimation }: EstimationCardProps) {
  const conf = CONFIDENCE_LABELS[estimation.confidence] || { label: estimation.confidence, color: "text-gray-600" };
  const sourceBadge = estimation.sraSource ? SOURCE_BADGES[estimation.sraSource] : null;

  return (
    <Card className="border-2 border-blue-100 bg-blue-50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-5 w-5 text-blue-600" />
          Estimation d&apos;indemnisation
          {sourceBadge && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium border ${sourceBadge.bg} ${sourceBadge.text}`}>
              <sourceBadge.icon className="h-3 w-3" />
              {sourceBadge.label}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main estimate */}
        <div className="text-center py-2">
          <div className="text-3xl font-bold text-blue-700">
            {formatCurrency(estimation.estimatedTotal)}
          </div>
          <div className="text-sm text-gray-600">Montant probable</div>
        </div>

        {/* Min / Max range */}
        <div className="flex justify-between items-center bg-white rounded p-3 text-sm">
          <div className="text-center">
            <div className="text-gray-500">Minimum</div>
            <div className="font-semibold text-gray-800">{formatCurrency(estimation.min)}</div>
          </div>
          <div className="h-px flex-1 bg-gray-200 mx-3" />
          <div className="text-center">
            <div className="text-blue-600 font-medium">Probable</div>
            <div className="font-bold text-blue-700">{formatCurrency(estimation.estimatedTotal)}</div>
          </div>
          <div className="h-px flex-1 bg-gray-200 mx-3" />
          <div className="text-center">
            <div className="text-gray-500">Maximum</div>
            <div className="font-semibold text-gray-800">{formatCurrency(estimation.max)}</div>
          </div>
        </div>

        {/* SRA Breakdown (if available) */}
        {estimation.sraBreakdown && Object.keys(estimation.sraBreakdown).length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Ventilation par catégorie SRA</h4>
            {Object.entries(estimation.sraBreakdown).map(([key, value]) => (
              value > 0 && (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-gray-600">{REPAIR_CATEGORY_LABELS[key as RepairCategory] ?? key}</span>
                  <span className="font-medium">{formatCurrency(value)}</span>
                </div>
              )
            ))}
          </div>
        ) : (
          /* Generic Breakdown */
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Ventilation</h4>
            {estimation.breakdown.parts > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Pièces détachées</span>
                <span className="font-medium">{formatCurrency(estimation.breakdown.parts)}</span>
              </div>
            )}
            {estimation.breakdown.labor > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Main d&apos;oeuvre</span>
                <span className="font-medium">{formatCurrency(estimation.breakdown.labor)}</span>
              </div>
            )}
            {estimation.breakdown.other > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Autres frais</span>
                <span className="font-medium">{formatCurrency(estimation.breakdown.other)}</span>
              </div>
            )}
          </div>
        )}

        {/* Garage quote comparison */}
        {estimation.garageQuoteTotal != null && estimation.garageQuoteTotal > 0 && (
          <div className="bg-green-50 rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-green-700 font-medium">Devis garage{estimation.garageName ? ` (${estimation.garageName})` : ""}</span>
              <span className="font-bold text-green-800">{formatCurrency(estimation.garageQuoteTotal)}</span>
            </div>
          </div>
        )}

        <div className="border-t pt-2 flex justify-between text-sm">
          <span className="text-gray-600">Franchise</span>
          <span className="font-medium text-red-600">−{formatCurrency(estimation.franchise)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Net estimé</span>
          <span className="text-blue-700">{formatCurrency(estimation.netEstimate)}</span>
        </div>

        {/* Confidence */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Info className="h-3 w-3" />
          <span>Confiance de l&apos;estimation : <span className={`font-medium ${conf.color}`}>{conf.label}</span></span>
        </div>
      </CardContent>
    </Card>
  );
}
