-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'HANDLER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Policyholder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "vehicleMake" TEXT NOT NULL,
    "vehicleModel" TEXT NOT NULL,
    "vehicleYear" INTEGER NOT NULL,
    "vehiclePlate" TEXT NOT NULL,
    "vehicleVin" TEXT,
    "policyNumber" TEXT NOT NULL,
    "contractStart" DATETIME NOT NULL,
    "contractEnd" DATETIME NOT NULL,
    "coverageType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    CONSTRAINT "Policyholder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "incidentDate" DATETIME NOT NULL,
    "incidentLocation" TEXT NOT NULL,
    "incidentCity" TEXT,
    "incidentZipCode" TEXT,
    "incidentCountry" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "thirdPartyInvolved" BOOLEAN NOT NULL DEFAULT false,
    "thirdPartyInfo" TEXT,
    "estimatedAmount" REAL,
    "approvedAmount" REAL,
    "fraudScore" INTEGER,
    "fraudRisk" TEXT,
    "closureReason" TEXT,
    "repairGarage" TEXT,
    "expertName" TEXT,
    "networkScore" INTEGER,
    "networkRisk" TEXT,
    "networkId" TEXT,
    "policyholderID" TEXT NOT NULL,
    "assignedToID" TEXT,
    "createdByID" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Claim_policyholderID_fkey" FOREIGN KEY ("policyholderID") REFERENCES "Policyholder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Claim_assignedToID_fkey" FOREIGN KEY ("assignedToID") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claim_createdByID_fkey" FOREIGN KEY ("createdByID") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Claim_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "FraudNetwork" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "documentType" TEXT,
    "ocrExtracted" BOOLEAN NOT NULL DEFAULT false,
    "ocrData" TEXT,
    "ocrConfidence" REAL,
    "claimId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "inputData" TEXT NOT NULL,
    "outputData" TEXT NOT NULL,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    "provider" TEXT NOT NULL DEFAULT 'ANTHROPIC',
    "explainabilityReport" TEXT,
    "confidenceScore" REAL,
    "claimId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIAnalysis_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIContestation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolution" TEXT,
    "contestedBy" TEXT NOT NULL,
    "resolvedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "AIContestation_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "conditions" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actionParams" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RuleExecutionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "resultData" TEXT,
    "errorMessage" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RuleExecutionLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "apiKeyEnvVar" TEXT NOT NULL,
    "defaultModel" TEXT NOT NULL,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "config" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AIProviderLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT true,
    "claimId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "metadata" TEXT,
    "claimId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailNotification_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    "claimId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Notification_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FraudNetwork" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "networkNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "networkScore" INTEGER NOT NULL DEFAULT 0,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "claimCount" INTEGER NOT NULL DEFAULT 0,
    "avgFraudScore" REAL NOT NULL DEFAULT 0,
    "density" REAL NOT NULL DEFAULT 0,
    "nodesJson" TEXT NOT NULL DEFAULT '[]',
    "mergedFrom" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FraudLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "networkId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "claimIds" TEXT NOT NULL DEFAULT '[]',
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FraudLink_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "FraudNetwork" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FraudNetworkAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "networkId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "metadata" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FraudNetworkAudit_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "FraudNetwork" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiskScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyholderId" TEXT NOT NULL,
    "scoreGlobal" INTEGER NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "factorHistorique" REAL NOT NULL,
    "factorProfil" REAL NOT NULL,
    "factorZone" REAL NOT NULL,
    "factorPeriode" REAL NOT NULL,
    "factorMeteo" REAL NOT NULL,
    "weatherDataSource" TEXT NOT NULL DEFAULT 'FALLBACK_NEUTRAL',
    "scoringNotes" TEXT,
    "highFrequencyClaimant" BOOLEAN NOT NULL DEFAULT false,
    "contractStatus" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "RiskScore_policyholderId_fkey" FOREIGN KEY ("policyholderId") REFERENCES "Policyholder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeatherCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "latRounded" REAL NOT NULL,
    "lonRounded" REAL NOT NULL,
    "forecastJson" TEXT NOT NULL,
    "meteoScore" REAL NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RiskAlertLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyholderId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "previousLevel" TEXT NOT NULL,
    "newLevel" TEXT NOT NULL,
    "emailSentAt" DATETIME,
    "emailNotificationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskAlertLog_policyholderId_fkey" FOREIGN KEY ("policyholderId") REFERENCES "Policyholder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AcprReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportNumber" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileUrl" TEXT,
    "fileHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "claimsOpened" INTEGER NOT NULL DEFAULT 0,
    "claimsClosed" INTEGER NOT NULL DEFAULT 0,
    "claimsNew" INTEGER NOT NULL DEFAULT 0,
    "totalProvisioned" REAL NOT NULL DEFAULT 0,
    "fraudRate" REAL NOT NULL DEFAULT 0,
    "avgProcessingDays" REAL NOT NULL DEFAULT 0,
    "claimToPremiumRatio" REAL NOT NULL DEFAULT 0,
    "indemnitesPaid" REAL NOT NULL DEFAULT 0,
    "indemnitesWaiting" REAL NOT NULL DEFAULT 0,
    "configSnapshot" TEXT,
    "generatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AcprReport_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AcprReportConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "logoBase64" TEXT,
    "headerTitle" TEXT NOT NULL DEFAULT 'Rapport ACPR — ClaimFlow',
    "headerSubtitle" TEXT,
    "sections" TEXT NOT NULL DEFAULT '["claims","fraud","sla","provisions"]',
    "footerText" TEXT,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcprReportConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GdprErasureRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyholderId" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "requestedById" TEXT NOT NULL,
    "executedById" TEXT,
    "metadata" TEXT,
    CONSTRAINT "GdprErasureRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GdprErasureRequest_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GdprDataAccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accessorId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GdprDataAccessLog_accessorId_fkey" FOREIGN KEY ("accessorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GdprPurgeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purgeType" TEXT NOT NULL,
    "recordsCount" INTEGER NOT NULL DEFAULT 0,
    "periodCutoff" DATETIME NOT NULL,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggeredBy" TEXT NOT NULL DEFAULT 'CRON',
    "metadata" TEXT
);

-- CreateTable
CREATE TABLE "SolvencyProvision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodQuarter" TEXT NOT NULL,
    "bestEstimate" REAL NOT NULL,
    "riskFreeRate" REAL NOT NULL DEFAULT 0.035,
    "scr" REAL NOT NULL,
    "riskMargin" REAL NOT NULL,
    "totalProvision" REAL NOT NULL,
    "probabilityResolution" REAL NOT NULL DEFAULT 0.8,
    "futureFlows" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "computedById" TEXT,
    CONSTRAINT "SolvencyProvision_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SolvencyProvision_computedById_fkey" FOREIGN KEY ("computedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SolvencyReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportNumber" TEXT NOT NULL,
    "periodQuarter" TEXT NOT NULL,
    "totalBE" REAL NOT NULL DEFAULT 0,
    "totalSCR" REAL NOT NULL DEFAULT 0,
    "totalRM" REAL NOT NULL DEFAULT 0,
    "totalProvisions" REAL NOT NULL DEFAULT 0,
    "claimCount" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,
    "snapshotJson" TEXT,
    CONSTRAINT "SolvencyReport_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Policyholder_policyNumber_key" ON "Policyholder"("policyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Policyholder_userId_key" ON "Policyholder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_claimNumber_key" ON "Claim"("claimNumber");

-- CreateIndex
CREATE INDEX "AIContestation_analysisId_idx" ON "AIContestation"("analysisId");

-- CreateIndex
CREATE INDEX "AIContestation_status_idx" ON "AIContestation"("status");

-- CreateIndex
CREATE INDEX "AutomationRule_active_idx" ON "AutomationRule"("active");

-- CreateIndex
CREATE INDEX "RuleExecutionLog_ruleId_idx" ON "RuleExecutionLog"("ruleId");

-- CreateIndex
CREATE INDEX "RuleExecutionLog_claimId_idx" ON "RuleExecutionLog"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "AIProviderConfig_provider_key" ON "AIProviderConfig"("provider");

-- CreateIndex
CREATE INDEX "AIProviderLog_provider_idx" ON "AIProviderLog"("provider");

-- CreateIndex
CREATE INDEX "AIProviderLog_createdAt_idx" ON "AIProviderLog"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_claimId_idx" ON "Notification"("claimId");

-- CreateIndex
CREATE INDEX "Notification_type_claimId_idx" ON "Notification"("type", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "FraudNetwork_networkNumber_key" ON "FraudNetwork"("networkNumber");

-- CreateIndex
CREATE INDEX "FraudLink_networkId_idx" ON "FraudLink"("networkId");

-- CreateIndex
CREATE INDEX "FraudLink_sourceKey_targetKey_idx" ON "FraudLink"("sourceKey", "targetKey");

-- CreateIndex
CREATE INDEX "FraudNetworkAudit_networkId_idx" ON "FraudNetworkAudit"("networkId");

-- CreateIndex
CREATE INDEX "RiskScore_policyholderId_idx" ON "RiskScore"("policyholderId");

-- CreateIndex
CREATE INDEX "RiskScore_expiresAt_idx" ON "RiskScore"("expiresAt");

-- CreateIndex
CREATE INDEX "RiskScore_riskLevel_idx" ON "RiskScore"("riskLevel");

-- CreateIndex
CREATE UNIQUE INDEX "WeatherCache_latRounded_lonRounded_key" ON "WeatherCache"("latRounded", "lonRounded");

-- CreateIndex
CREATE INDEX "RiskAlertLog_policyholderId_idx" ON "RiskAlertLog"("policyholderId");

-- CreateIndex
CREATE UNIQUE INDEX "AcprReport_reportNumber_key" ON "AcprReport"("reportNumber");

-- CreateIndex
CREATE INDEX "AcprReport_periodStart_periodEnd_idx" ON "AcprReport"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "AcprReport_status_idx" ON "AcprReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AcprReportConfig_key_key" ON "AcprReportConfig"("key");

-- CreateIndex
CREATE INDEX "GdprErasureRequest_status_idx" ON "GdprErasureRequest"("status");

-- CreateIndex
CREATE INDEX "GdprErasureRequest_policyholderId_idx" ON "GdprErasureRequest"("policyholderId");

-- CreateIndex
CREATE INDEX "GdprDataAccessLog_accessorId_idx" ON "GdprDataAccessLog"("accessorId");

-- CreateIndex
CREATE INDEX "GdprDataAccessLog_entityId_entityType_idx" ON "GdprDataAccessLog"("entityId", "entityType");

-- CreateIndex
CREATE INDEX "GdprDataAccessLog_createdAt_idx" ON "GdprDataAccessLog"("createdAt");

-- CreateIndex
CREATE INDEX "GdprPurgeLog_purgeType_idx" ON "GdprPurgeLog"("purgeType");

-- CreateIndex
CREATE INDEX "GdprPurgeLog_executedAt_idx" ON "GdprPurgeLog"("executedAt");

-- CreateIndex
CREATE INDEX "SolvencyProvision_claimId_idx" ON "SolvencyProvision"("claimId");

-- CreateIndex
CREATE INDEX "SolvencyProvision_periodQuarter_idx" ON "SolvencyProvision"("periodQuarter");

-- CreateIndex
CREATE INDEX "SolvencyProvision_status_idx" ON "SolvencyProvision"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SolvencyReport_reportNumber_key" ON "SolvencyReport"("reportNumber");

-- CreateIndex
CREATE INDEX "SolvencyReport_periodQuarter_idx" ON "SolvencyReport"("periodQuarter");
