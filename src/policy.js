const CALL_STATUSES = new Set(["queued", "routing", "ringing", "answered", "completed", "failed", "busy", "no_answer", "canceled", "overflow", "after_hours"]);
const TERMINAL_CALL_STATUSES = new Set(["completed", "failed", "busy", "no_answer", "canceled"]);

export function canCreateRole(actorRole, requestedRole) {
  if (!["owner", "admin", "employee"].includes(requestedRole)) return false;
  if (actorRole === "owner") return true;
  return actorRole === "admin" && requestedRole !== "owner";
}

export const isValidCallStatus = status => CALL_STATUSES.has(status);
export const isTerminalCallStatus = status => TERMINAL_CALL_STATUSES.has(status);
