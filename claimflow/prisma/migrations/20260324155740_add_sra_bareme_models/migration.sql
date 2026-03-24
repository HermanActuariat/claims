-- CreateTable
CREATE TABLE "RepairReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "vehicleSegment" TEXT NOT NULL,
    "avgPartCost" REAL NOT NULL,
    "avgLaborHours" REAL NOT NULL,
    "avgLaborRate" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "regionFactor" TEXT,
    "validFrom" DATETIME NOT NULL,
    "validUntil" DATETIME,
    "updatedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RepairReference_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GarageQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "garageName" TEXT,
    "garageCity" TEXT,
    "totalAmount" REAL,
    "extractedByAI" BOOLEAN NOT NULL DEFAULT false,
    "validatedById" TEXT,
    "validatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GarageQuote_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GarageQuote_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GarageQuote_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GarageQuoteLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "lineType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "partReference" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceHT" REAL NOT NULL,
    "laborHours" REAL,
    "laborRateHT" REAL,
    "totalHT" REAL NOT NULL,
    "confidence" REAL,
    CONSTRAINT "GarageQuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "GarageQuote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RepairReference_category_vehicleSegment_idx" ON "RepairReference"("category", "vehicleSegment");

-- CreateIndex
CREATE UNIQUE INDEX "GarageQuote_documentId_key" ON "GarageQuote"("documentId");

-- CreateIndex
CREATE INDEX "GarageQuote_claimId_idx" ON "GarageQuote"("claimId");

-- CreateIndex
CREATE INDEX "GarageQuoteLine_quoteId_idx" ON "GarageQuoteLine"("quoteId");
