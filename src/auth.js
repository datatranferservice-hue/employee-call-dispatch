import {
  config
} from "./config.js";

import {
  one,
  query
} from "./db.js";

import {
  clearSessionCookie,
  createSessionToken,
  hashSessionToken,
  normalizeEmail,
  parseCookies,
  sessionCookie,
  verifyPassword
} from "./lib/security.js";

import {
  forbidden,
  unauthorized
} from "./lib/errors.js";

const SESSION_COOKIE =
  "cf_session";

function clientIp(req) {
  return (
    req.ip ||
    req.socket?.remoteAddress ||
    null
  );
}

export async function loginUser(
  req,
  res,
  email,
  password
) {
  const normalizedEmail =
    normalizeEmail(email);

  const user = await one(
    `
    SELECT
      u.*,
      o.name AS organization_name,
      o.active AS organization_active
    FROM users u
    JOIN organizations o
      ON o.id = u.organization_id
    WHERE LOWER(u.email) = LOWER($1)
    LIMIT 1
    `,
    [
      normalizedEmail
    ]
  );

  if (
    !user ||
    !user.active ||
    !user.organization_active
  ) {
    await recordLogin(
      req,
      null,
      normalizedEmail,
      false,
      "invalid_credentials"
    );

    throw unauthorized(
      "Invalid email or password."
    );
  }

  if (
    user.locked_until &&
    new Date(user.locked_until) >
      new Date()
  ) {
    await recordLogin(
      req,
      user,
      normalizedEmail,
      false,
      "account_locked"
    );

    throw unauthorized(
      "Account temporarily locked."
    );
  }

  const valid =
    await verifyPassword(
      password,
      user.password_hash
    );

  if (!valid) {
    const failures =
      Number(
        user.failed_login_attempts || 0
      ) + 1;

    let lockedUntil = null;

    if (
      failures >=
      config.security.loginMaxAttempts
    ) {
      lockedUntil =
        new Date(
          Date.now() +
          config.security
            .loginWindowMinutes *
            60_000
        );
    }

    await query(
      `
      UPDATE users
      SET
        failed_login_attempts = $2,
        locked_until = $3
      WHERE id = $1
      `,
      [
        user.id,
        failures,
        lockedUntil
      ]
    );

    await recordLogin(
      req,
      user,
      normalizedEmail,
      false,
      "invalid_credentials"
    );

    throw unauthorized(
      "Invalid email or password."
    );
  }

  await query(
    `
    UPDATE users
    SET
      failed_login_attempts = 0,
      locked_until = NULL,
      last_login_at = NOW()
    WHERE id = $1
    `,
    [
      user.id
    ]
  );

  const rawToken =
    createSessionToken();

  const tokenHash =
    hashSessionToken(rawToken);

  const expiresAt =
    new Date(
      Date.now() +
      config.security.sessionHours *
        60 *
        60 *
        1000
    );

  await query(
    `
    INSERT INTO sessions (
      user_id,
      token_hash,
      ip_address,
      user_agent,
      expires_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5
    )
    `,
    [
      user.id,
      tokenHash,
      clientIp(req),
      req.get("user-agent") || null,
      expiresAt
    ]
  );

  await recordLogin(
    req,
    user,
    normalizedEmail,
    true,
    null
  );

  res.setHeader(
    "Set-Cookie",
    sessionCookie(
      rawToken,
      {
        secure:
          config.production,
        maxAgeSeconds:
          config.security
            .sessionHours *
          60 *
          60
      }
    )
  );

  return safeUser(user);
}

export async function logoutUser(
  req,
  res
) {
  const cookies =
    parseCookies(
      req.headers.cookie
    );

  const rawToken =
    cookies[SESSION_COOKIE];

  if (rawToken) {
    await query(
      `
      DELETE FROM sessions
      WHERE token_hash = $1
      `,
      [
        hashSessionToken(rawToken)
      ]
    );
  }

  res.setHeader(
    "Set-Cookie",
    clearSessionCookie(
      config.production
    )
  );
}

export async function authenticate(
  req,
  res,
  next
) {
  try {
    const cookies =
      parseCookies(
        req.headers.cookie
      );

    const rawToken =
      cookies[SESSION_COOKIE];

    if (!rawToken) {
      throw unauthorized();
    }

    const session =
      await one(
        `
        SELECT
          s.id AS session_id,
          s.expires_at,

          u.id,
          u.organization_id,
          u.email,
          u.first_name,
          u.last_name,
          u.phone,
          u.role,
          u.active,
          u.must_change_password,

          o.name AS organization_name,
          o.timezone,
          o.active AS organization_active

        FROM sessions s

        JOIN users u
          ON u.id = s.user_id

        JOIN organizations o
          ON o.id = u.organization_id

        WHERE
          s.token_hash = $1
          AND s.expires_at > NOW()

        LIMIT 1
        `,
        [
          hashSessionToken(
            rawToken
          )
        ]
      );

    if (
      !session ||
      !session.active ||
      !session.organization_active
    ) {
      throw unauthorized();
    }

    req.user =
      safeUser(session);

    req.sessionId =
      session.session_id;

    await query(
      `
      UPDATE sessions
      SET last_seen_at = NOW()
      WHERE id = $1
      `,
      [
        session.session_id
      ]
    );

    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(
  ...roles
) {
  return function roleGuard(
    req,
    res,
    next
  ) {
    try {
      if (!req.user) {
        throw unauthorized();
      }

      if (
        !roles.includes(
          req.user.role
        )
      ) {
        throw forbidden();
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireOwner =
  requireRole("owner");

export const requireAdmin =
  requireRole(
    "owner",
    "admin"
  );

export const requireManager =
  requireRole(
    "owner",
    "admin",
    "manager"
  );

function safeUser(user) {
  return {
    id:
      user.id,

    organizationId:
      user.organization_id,

    organizationName:
      user.organization_name,

    email:
      user.email,

    firstName:
      user.first_name,

    lastName:
      user.last_name,

    phone:
      user.phone,

    role:
      user.role,

    timezone:
      user.timezone,

    mustChangePassword:
      Boolean(
        user.must_change_password
      )
  };
}

async function recordLogin(
  req,
  user,
  email,
  successful,
  failureReason
) {
  try {
    await query(
      `
      INSERT INTO login_events (
        organization_id,
        user_id,
        email,
        successful,
        ip_address,
        user_agent,
        failure_reason
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7
      )
      `,
      [
        user?.organization_id ||
          null,

        user?.id || null,

        email,

        successful,

        clientIp(req),

        req.get("user-agent") ||
          null,

        failureReason
      ]
    );
  } catch (error) {
    console.error(
      "Could not write login event:",
      error.message
    );
  }
}
