import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ImportEconstatSchema } from "@/lib/validations";
import { parseEconstat, validateEconstatData } from "@/lib/econstat-parser";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();
  const parsed = ImportEconstatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const { claimId, data, format } = parsed.data;

    // Verify claim exists
    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      return NextResponse.json({ error: "Sinistre introuvable" }, { status: 404 });
    }

    // Parse econstat data
    const econstatData = parseEconstat(data, format);

    // Validate and collect warnings
    const warnings = validateEconstatData(econstatData);

    // Build claim update payload from econstat data
    const updateData: Record<string, unknown> = {};

    if (econstatData.dateAccident) {
      const parsedDate = new Date(econstatData.dateAccident);
      if (!isNaN(parsedDate.getTime())) {
        updateData.incidentDate = parsedDate;
      }
    }

    if (econstatData.lieuAccident) {
      updateData.incidentLocation = econstatData.lieuAccident;
    }

    // Build third party info from vehicule B
    if (econstatData.vehiculeB) {
      const vehB = econstatData.vehiculeB;
      const thirdPartyInfo = {
        name: vehB.conducteur,
        plate: vehB.immatriculation,
        insurance: vehB.assureur,
        contact: null,
        vehicleMake: vehB.marque,
        vehicleModel: vehB.modele,
        numContrat: vehB.numContrat,
        permisNum: vehB.permisNum,
      };
      updateData.thirdPartyInvolved = true;
      updateData.thirdPartyInfo = JSON.stringify(thirdPartyInfo);
    }

    // Build description addendum from econstat circonstances + dégâts
    const descriptionParts: string[] = [];
    if (econstatData.circonstances.length > 0) {
      descriptionParts.push(`Circonstances : ${econstatData.circonstances.join(", ")}`);
    }
    if (econstatData.degats.length > 0) {
      descriptionParts.push(`Dégâts : ${econstatData.degats.join(", ")}`);
    }
    if (econstatData.observations) {
      descriptionParts.push(`Observations : ${econstatData.observations}`);
    }
    if (descriptionParts.length > 0) {
      const econstatDescription = `[E-Constat] ${descriptionParts.join(" | ")}`;
      // Append to existing description if not already present
      if (!claim.description.includes("[E-Constat]")) {
        updateData.description = `${claim.description}\n\n${econstatDescription}`;
      }
    }

    // Persist updates if any fields changed
    let updatedClaim = claim;
    if (Object.keys(updateData).length > 0) {
      updatedClaim = await prisma.claim.update({
        where: { id: claimId },
        data: updateData,
      });
    }

    await createAuditLog({
      action: "ECONSTAT_IMPORTED",
      entityType: "CLAIM",
      entityId: claimId,
      before: {
        incidentDate: claim.incidentDate,
        incidentLocation: claim.incidentLocation,
        thirdPartyInvolved: claim.thirdPartyInvolved,
        thirdPartyInfo: claim.thirdPartyInfo,
      },
      after: {
        econstatFormat: format,
        fieldsUpdated: Object.keys(updateData),
        warnings,
        vehiculeA: econstatData.vehiculeA,
        vehiculeB: econstatData.vehiculeB,
        circonstancesCount: econstatData.circonstances.length,
        degatsCount: econstatData.degats.length,
      },
      claimId,
      userId: session.user.id,
    });

    return NextResponse.json(
      {
        data: {
          econstatData,
          warnings,
          claimId: updatedClaim.id,
          fieldsUpdated: Object.keys(updateData),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[claims/import-econstat]", err);
    return NextResponse.json(
      { error: "Erreur import e-constat" },
      { status: 500 }
    );
  }
}
