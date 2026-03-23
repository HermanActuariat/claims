/**
 * Tests — PATCH /api/claims/[id]/status
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    claim: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/claim-service", () => ({
  isValidTransition: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/notification-service", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}));

vi.mock("@/lib/email-service", () => ({
  sendClaimStatusEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/rules-engine", () => ({
  executeRulesForClaim: vi.fn().mockResolvedValue([]),
}));

import { PATCH } from "@/app/api/claims/[id]/status/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isValidTransition } from "@/lib/claim-service";
import { createNotification } from "@/lib/notification-service";
import { sendClaimStatusEmail } from "@/lib/email-service";
import { executeRulesForClaim } from "@/lib/rules-engine";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;
type ClaimReturn = ReturnType<typeof prisma.claim.findUnique> extends Promise<infer T> ? T : never;
type ClaimUpdateReturn = ReturnType<typeof prisma.claim.update> extends Promise<infer T> ? T : never;

const mockManagerSession = {
  user: { id: "user-1", email: "manager@test.com", name: "Manager", role: "MANAGER" as const },
};

const mockHandlerSession = {
  user: { id: "handler-1", email: "handler@test.com", name: "Handler", role: "HANDLER" as const },
};

const mockClaim = {
  id: "claim-1",
  claimNumber: "CLM-2026-00001",
  status: "SUBMITTED",
  assignedToID: "handler-1",
  policyholder: {
    id: "ph-1",
    firstName: "Jean",
    lastName: "Dupont",
    email: "jean@test.com",
  },
  assignedTo: { id: "handler-1", name: "Handler", email: "handler@test.com", role: "HANDLER" },
  createdBy: { id: "user-1", name: "Manager", email: "manager@test.com", role: "MANAGER" },
};

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });
const makeRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/claims/claim-1/status", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("PATCH /api/claims/[id]/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(
      mockManagerSession as unknown as AuthReturn
    );
    vi.mocked(prisma.claim.findUnique).mockResolvedValue(
      mockClaim as unknown as ClaimReturn
    );
    vi.mocked(prisma.claim.update).mockResolvedValue({
      ...mockClaim,
      status: "UNDER_REVIEW",
    } as unknown as ClaimUpdateReturn);
    vi.mocked(isValidTransition).mockReturnValue(true);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const res = await PATCH(makeRequest({ status: "UNDER_REVIEW" }), makeParams("claim-1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid status", async () => {
    const res = await PATCH(makeRequest({ status: "INVALID_STATUS" }), makeParams("claim-1"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when claim not found", async () => {
    vi.mocked(prisma.claim.findUnique).mockResolvedValue(null);
    const res = await PATCH(makeRequest({ status: "UNDER_REVIEW" }), makeParams("unknown"));
    expect(res.status).toBe(404);
  });

  it("returns 422 for invalid transition", async () => {
    vi.mocked(isValidTransition).mockReturnValue(false);
    const res = await PATCH(makeRequest({ status: "UNDER_REVIEW" }), makeParams("claim-1"));
    expect(res.status).toBe(422);
  });

  it("returns 403 when HANDLER tries to APPROVE", async () => {
    vi.mocked(auth).mockResolvedValue(
      mockHandlerSession as unknown as AuthReturn
    );
    const res = await PATCH(makeRequest({ status: "APPROVED" }), makeParams("claim-1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when HANDLER tries to REJECT", async () => {
    vi.mocked(auth).mockResolvedValue(
      mockHandlerSession as unknown as AuthReturn
    );
    const res = await PATCH(makeRequest({ status: "REJECTED" }), makeParams("claim-1"));
    expect(res.status).toBe(403);
  });

  it("updates status successfully for manager", async () => {
    const res = await PATCH(makeRequest({ status: "UNDER_REVIEW" }), makeParams("claim-1"));
    expect(res.status).toBe(200);
    expect(prisma.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "UNDER_REVIEW" }) })
    );
  });

  it("sends notification to assignee when status changes", async () => {
    await PATCH(makeRequest({ status: "UNDER_REVIEW" }), makeParams("claim-1"));
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "STATUS_CHANGED", userId: "handler-1" })
    );
  });

  it("sends email when status changes to APPROVED", async () => {
    vi.mocked(prisma.claim.update).mockResolvedValue({
      ...mockClaim,
      status: "APPROVED",
    } as unknown as ClaimUpdateReturn);
    await PATCH(makeRequest({ status: "APPROVED", approvedAmount: 5000 }), makeParams("claim-1"));
    expect(sendClaimStatusEmail).toHaveBeenCalledWith(
      expect.objectContaining({ status: "APPROVED" })
    );
  });

  it("sends email when status changes to REJECTED", async () => {
    vi.mocked(prisma.claim.update).mockResolvedValue({
      ...mockClaim,
      status: "REJECTED",
    } as unknown as ClaimUpdateReturn);
    await PATCH(makeRequest({ status: "REJECTED" }), makeParams("claim-1"));
    expect(sendClaimStatusEmail).toHaveBeenCalledWith(
      expect.objectContaining({ status: "REJECTED" })
    );
  });

  it("sends email when status changes to INFO_REQUESTED", async () => {
    vi.mocked(prisma.claim.update).mockResolvedValue({
      ...mockClaim,
      status: "INFO_REQUESTED",
    } as unknown as ClaimUpdateReturn);
    await PATCH(makeRequest({ status: "INFO_REQUESTED" }), makeParams("claim-1"));
    expect(sendClaimStatusEmail).toHaveBeenCalledWith(
      expect.objectContaining({ status: "INFO_REQUESTED" })
    );
  });

  it("does not send email for UNDER_REVIEW", async () => {
    await PATCH(makeRequest({ status: "UNDER_REVIEW" }), makeParams("claim-1"));
    expect(sendClaimStatusEmail).not.toHaveBeenCalled();
  });

  it("sets approvedAmount when status is APPROVED", async () => {
    await PATCH(makeRequest({ status: "APPROVED", approvedAmount: 3000 }), makeParams("claim-1"));
    expect(prisma.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "APPROVED", approvedAmount: 3000 }),
      })
    );
  });

  it("does not send notification when no assignee", async () => {
    vi.mocked(prisma.claim.findUnique).mockResolvedValue({
      ...mockClaim,
      assignedToID: null,
    } as unknown as ClaimReturn);
    vi.mocked(prisma.claim.update).mockResolvedValue({
      ...mockClaim,
      assignedToID: null,
      status: "UNDER_REVIEW",
    } as unknown as ClaimUpdateReturn);
    await PATCH(makeRequest({ status: "UNDER_REVIEW" }), makeParams("claim-1"));
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("calls executeRulesForClaim after status change", async () => {
    await PATCH(makeRequest({ status: "UNDER_REVIEW" }), makeParams("claim-1"));
    expect(executeRulesForClaim).toHaveBeenCalledWith("claim-1", "user-1");
  });

  it("returns 200 even when rules engine fails", async () => {
    vi.mocked(executeRulesForClaim).mockRejectedValue(new Error("rules failed"));
    const res = await PATCH(makeRequest({ status: "UNDER_REVIEW" }), makeParams("claim-1"));
    expect(res.status).toBe(200);
  });
});
