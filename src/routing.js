export function normalizeStrategy(value) {
  return ["round_robin", "least_calls", "longest_idle"].includes(value) ? value : "round_robin";
}

export function chooseEmployee(employees, strategy = "round_robin", cursor = 0) {
  const eligible = employees.filter((employee) =>
    employee.active &&
    employee.on_duty &&
    !employee.busy &&
    employee.phone_verified &&
    employee.phone_approved &&
    employee.forwarding_phone
  );
  if (!eligible.length) return null;

  const mode = normalizeStrategy(strategy);
  if (mode === "least_calls") {
    return [...eligible].sort((a, b) => (a.routed_calls || 0) - (b.routed_calls || 0))[0];
  }
  if (mode === "longest_idle") {
    return [...eligible].sort((a, b) => {
      const left = a.last_routed_at ? new Date(a.last_routed_at).getTime() : 0;
      const right = b.last_routed_at ? new Date(b.last_routed_at).getTime() : 0;
      return left - right;
    })[0];
  }
  return eligible[Math.abs(Number(cursor) || 0) % eligible.length];
}

export function isWithinBusinessHours(now, timezone, businessHours, closedOverride = false) {
  if (closedOverride) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "America/Phoenix",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const key = String(parts.weekday || "").toLowerCase();
  const window = businessHours?.[key];
  if (!Array.isArray(window) || window.length !== 2) return false;
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  const toMinutes = (value) => {
    const [hours, minutes] = String(value).split(":").map(Number);
    return hours * 60 + minutes;
  };
  return current >= toMinutes(window[0]) && current < toMinutes(window[1]);
}
