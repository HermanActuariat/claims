import { UserRole } from "@/types";

// Permission matrix based on PRD §5.4
export const permissions = {
  // Claims
  canViewAllClaims: (role: UserRole) => role === "MANAGER" || role === "ADMIN",
  canCreateClaim: (_role?: UserRole) => true,
  canEditClaim: (role: UserRole, isOwner: boolean) =>
    role === "MANAGER" || role === "ADMIN" || isOwner,
  canApproveClaim: (role: UserRole) => role === "MANAGER" || role === "ADMIN",
  canRejectClaim: (role: UserRole) => role === "MANAGER" || role === "ADMIN",
  canAssignClaim: (role: UserRole) => role === "MANAGER" || role === "ADMIN",
  canDeleteClaim: (role: UserRole) => role === "ADMIN",

  // AI Analysis
  canRunAI: (_role?: UserRole) => true,

  // Dashboard
  canViewFullDashboard: (role: UserRole) => role === "MANAGER" || role === "ADMIN",
  canViewOwnDashboard: () => true,

  // Users
  canManageUsers: (role: UserRole) => role === "ADMIN",
  canConfigureThresholds: (role: UserRole) => role === "ADMIN",

  // Audit logs
  canViewAuditLogs: (role: UserRole) => role === "MANAGER" || role === "ADMIN",
  canExportAuditLogs: (role: UserRole) => role === "ADMIN",
} as const;

export function requireRole(
  userRole: UserRole,
  ...allowedRoles: UserRole[]
): boolean {
  return allowedRoles.includes(userRole);
}

export function getDefaultRedirect(role: UserRole): string {
  switch (role) {
    case "HANDLER":
      return "/claims";
    case "MANAGER":
      return "/dashboard";
    case "ADMIN":
      return "/admin";
    case "POLICYHOLDER":
      return "/portail/mes-sinistres";
    default:
      return "/claims";
  }
}
