"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FraudScoreCard } from "./FraudScoreCard";
import { EstimationCard } from "./EstimationCard";
import { LetterGenerator } from "./LetterGenerator";
import { FraudAnalysisResult, EstimationResult, ExtractionResult } from "@/types";
import { Brain, RefreshCw, ChevronDown, ChevronUp, FileText, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AIAnalysisPanelProps {
  claimId: string;
  policyholderEmail?: string;
  onAnalysisComplete?: () => void;
}

interface AnalysisResults {
  extraction?: ExtractionResult;
  fraud?: FraudAnalysisResult;
  estimation?: EstimationResult;
  extractionError?: string;
  fraudError?: string;
  estimationError?: string;
}

export function AIAnalysisPanel({ claimId, policyholderEmail, onAnalysisComplete }: AIAnalysisPanelProps) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showExtraction, setShowExtraction] = useState(false);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/analyze`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur analyse IA");
      setResults(data.data.results);
      onAnalysisComplete?.();
    } catch (err) {
      console.error("Analysis failed:", err);
      setError(err instanceof Error ? err.message : "Erreur inconnue lors de l'analyse");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Brain className="h-5 w-5 text-purple-600" />
          Analyse IA
        </h3>
        <Button
          onClick={runAnalysis}
          disabled={loading}
          className="bg-purple-600 hover:bg-purple-700"
        >
          {loading ? (
            <>
              <Spinner size="sm" className="mr-2 border-white border-t-transparent" />
              Analyse en cours...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              {results ? "Relancer l'analyse" : "Lancer l'analyse IA"}
            </>
          )}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          {/* Extraction */}
          {results.extraction && (
            <Card>
              <CardHeader
                className="cursor-pointer"
                onClick={() => setShowExtraction(!showExtraction)}
              >
                <CardTitle className="flex items-center justify-between text-base">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-green-600" />
                    Données extraites
                    {results.extraction.missingFields.length > 0 && (
                      <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">
                        {results.extraction.missingFields.length} champs manquants
                      </span>
                    )}
                  </div>
                  {showExtraction ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </CardTitle>
              </CardHeader>
              {showExtraction && (
                <CardContent className="text-sm space-y-2">
                  {results.extraction.date && (
                    <div><span className="font-medium">Date : </span>{results.extraction.date}</div>
                  )}
                  {results.extraction.location && (
                    <div><span className="font-medium">Lieu : </span>{results.extraction.location}</div>
                  )}
                  {results.extraction.vehicles.length > 0 && (
                    <div>
                      <span className="font-medium">Véhicules :</span>
                      <ul className="ml-4 mt-1 space-y-1">
                        {results.extraction.vehicles.map((v, i) => (
                          <li key={i} className="text-gray-600">
                            {v.role === "insured" ? "Assuré" : "Tiers"}: {v.make} {v.model}
                            {v.plate && ` (${v.plate})`}
                            {v.damages.length > 0 && ` — ${v.damages.join(", ")}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {results.extraction.missingFields.length > 0 && (
                    <div className="p-2 bg-yellow-50 rounded border border-yellow-200">
                      <div className="flex items-center gap-1 text-yellow-700 font-medium">
                        <AlertTriangle className="h-3 w-3" />
                        Informations manquantes
                      </div>
                      <ul className="mt-1 text-yellow-600 text-xs">
                        {results.extraction.missingFields.map((f, i) => (
                          <li key={i}>• {f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {/* Fraud score */}
          {results.fraud && (
            <FraudScoreCard
              score={results.fraud.score}
              risk={results.fraud.risk}
              factors={results.fraud.factors}
              summary={results.fraud.summary}
              recommendation={results.fraud.recommendation}
            />
          )}

          {/* Estimation */}
          {results.estimation && (
            <EstimationCard estimation={results.estimation} />
          )}

          {/* Letter generator */}
          <LetterGenerator claimId={claimId} policyholderEmail={policyholderEmail} />

          {/* Errors */}
          {(results.extractionError || results.fraudError || results.estimationError) && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {results.extractionError && <p>Extraction: {results.extractionError}</p>}
              {results.fraudError && <p>Fraude: {results.fraudError}</p>}
              {results.estimationError && <p>Estimation: {results.estimationError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
