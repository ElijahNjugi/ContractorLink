const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const pool = require("../config/db");
const requireAuth = require("../middleware/requireAuth");
const { sendMail } = require("../services/mailer");

const router = express.Router();

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildResetLink(rawToken) {
  const base = process.env.APP_BASE_URL || "http://localhost:5173";
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

async function issueResetToken({ client, userId, createdBy = null }) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await client.query(
    `
    UPDATE password_tokens
    SET used_at = now()
    WHERE user_id = $1
      AND purpose = 'RESET'
      AND used_at IS NULL
    `,
    [userId]
  );

  await client.query(
    `
    INSERT INTO password_tokens (
      user_id,
      token_hash,
      purpose,
      expires_at,
      created_by
    )
    VALUES ($1,$2,'RESET',$3,$4)
    `,
    [userId, tokenHash, expiresAt, createdBy]
  );

  return {
    rawToken,
    expiresAt,
  };
}

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        u.id,
        u.organization_id,
        u.full_name,
        u.email,
        u.password_hash,
        u.is_active,
        u.must_change_password,
        r.code AS role_code,
        r.name AS role_name,
        o.name AS organization_name,
        o.organization_type,
        o.is_active AS organization_is_active
      FROM users u
      JOIN roles r
        ON r.id = u.role_id
      LEFT JOIN organizations o
        ON o.id = u.organization_id
      WHERE LOWER(u.email) = LOWER($1)
      LIMIT 1
      `,
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = rows[0];

    if (user.is_active === false) {
      return res.status(403).json({
        error: "ACCOUNT_DISABLED",
        message: "Your account has been deactivated.",
      });
    }

    if (user.organization_id && user.organization_is_active === false) {
      return res.status(403).json({
        error: "ORGANIZATION_DISABLED",
        message: "Your organization has been disabled.",
      });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role_code: user.role_code,
        organization_id: user.organization_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role_code: user.role_code,
        role_name: user.role_name,
        organization_id: user.organization_id,
        organization: user.organization_name,
        organization_type: user.organization_type,
        must_change_password: user.must_change_password,
      },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  return res.json({
    user: req.user,
  });
});

router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const currentPassword = String(
      req.body?.current_password ?? req.body?.currentPassword ?? ""
    );
    const newPassword = String(
      req.body?.new_password ?? req.body?.newPassword ?? ""
    );

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: "current_password and new_password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        error: "New password must be at least 8 characters long",
      });
    }

    const { rows } = await pool.query(
      `
      SELECT id, password_hash
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const currentOk = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!currentOk) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const nextHash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE users
      SET password_hash = $1,
          must_change_password = FALSE,
          temp_password_issued_at = NULL,
          updated_at = now()
      WHERE id = $2
      `,
      [nextHash, req.user.id]
    );

    return res.json({ message: "Password changed successfully." });
  } catch (error) {
    console.error("CHANGE PASSWORD ERROR:", error);
    return res.status(500).json({ error: "Failed to change password" });
  }
});

router.post("/request-password-change", requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rawToken } = await issueResetToken({
      client,
      userId: req.user.id,
      createdBy: req.user.id,
    });

    await client.query("COMMIT");

    const resetLink = buildResetLink(rawToken);
    const subject = "Confirm your ContractorLink password change";
    const text = [
      `Hello ${req.user.full_name},`,
      "",
      "We received a request to change your ContractorLink SLA Platform password.",
      "Use the link below within the next 1 hour to choose a new password:",
      resetLink,
      "",
      "If you did not request this change, you can ignore this email.",
    ].join("\n");

    const html = `
      <p>Hello ${req.user.full_name},</p>
      <p>We received a request to change your ContractorLink SLA Platform password.</p>
      <p>Use the link below within the next 1 hour to choose a new password:</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>If you did not request this change, you can ignore this email.</p>
    `;

    const emailResult = await sendMail({
      to: req.user.email,
      subject,
      text,
      html,
    });

    if (!emailResult.ok) {
      console.error("PASSWORD CHANGE EMAIL DELIVERY ERROR:", emailResult.error || emailResult.reason || "Unknown mail error");
      return res.status(503).json({ error: "The password email could not be delivered. Check the mail settings or try again shortly." });
    }

    return res.json({
      message: "Password confirmation email sent.",
      email_delivery: emailResult.ok ? "sent" : emailResult.skipped ? "skipped" : "failed",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("REQUEST PASSWORD CHANGE ERROR:", error);
    return res.status(500).json({ error: "Failed to request password change" });
  } finally {
    client.release();
  }
});

router.post("/forgot-password", async (req, res) => {
  const client = await pool.connect();

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const userResult = await client.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.is_active,
        o.is_active AS organization_is_active
      FROM users u
      LEFT JOIN organizations o
        ON o.id = u.organization_id
      WHERE LOWER(u.email) = LOWER($1)
      LIMIT 1
      `,
      [email]
    );

    if (!userResult.rowCount) {
      return res.json({
        message:
          "If an account exists for that email, a password reset link has been sent.",
      });
    }

    const user = userResult.rows[0];

    if (user.is_active === false || user.organization_is_active === false) {
      return res.json({
        message:
          "If an account exists for that email, a password reset link has been sent.",
      });
    }

    await client.query("BEGIN");
    const { rawToken } = await issueResetToken({
      client,
      userId: user.id,
      createdBy: null,
    });
    await client.query("COMMIT");

    const resetLink = buildResetLink(rawToken);
    const subject = "Reset your ContractorLink password";
    const text = [
      `Hello ${user.full_name},`,
      "",
      "A request was made to reset your ContractorLink SLA Platform password.",
      "Use the link below within the next 1 hour to choose a new password:",
      resetLink,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n");

    const html = `
      <p>Hello ${user.full_name},</p>
      <p>A request was made to reset your ContractorLink SLA Platform password.</p>
      <p>Use the link below within the next 1 hour to choose a new password:</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `;

    const emailResult = await sendMail({
      to: user.email,
      subject,
      text,
      html,
    });

    if (!emailResult.ok) {
      console.error("FORGOT PASSWORD EMAIL DELIVERY ERROR:", emailResult.error || emailResult.reason || "Unknown mail error");
      return res.status(503).json({ error: "The password reset email could not be delivered. Check the mail settings or try again shortly." });
    }

    return res.json({
      message:
        "If an account exists for that email, a password reset link has been sent.",
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    console.error("FORGOT PASSWORD ERROR:", error);
    return res.status(500).json({ error: "Failed to process forgot password request" });
  } finally {
    client.release();
  }
});

router.get("/reset-password/validate", async (req, res) => {
  try {
    const rawToken = String(req.query?.token || "").trim();
    if (!rawToken) {
      return res.status(400).json({ error: "token is required" });
    }

    const tokenHash = hashToken(rawToken);

    const { rows } = await pool.query(
      `
      SELECT pt.id, pt.expires_at, pt.used_at, u.email, u.full_name
      FROM password_tokens pt
      JOIN users u
        ON u.id = pt.user_id
      WHERE pt.token_hash = $1
        AND pt.purpose = 'RESET'
      LIMIT 1
      `,
      [tokenHash]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Reset token not found" });
    }

    const token = rows[0];
    if (token.used_at) {
      return res.status(410).json({ error: "Reset token has already been used" });
    }

    if (new Date(token.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: "Reset token has expired" });
    }

    return res.json({
      valid: true,
      email: token.email,
      full_name: token.full_name,
    });
  } catch (error) {
    console.error("VALIDATE RESET PASSWORD TOKEN ERROR:", error);
    return res.status(500).json({ error: "Failed to validate reset token" });
  }
});

router.post("/reset-password/confirm", async (req, res) => {
  const client = await pool.connect();

  try {
    const rawToken = String(req.body?.token || "").trim();
    const newPassword = String(
      req.body?.new_password ?? req.body?.newPassword ?? ""
    );

    if (!rawToken || !newPassword) {
      return res.status(400).json({ error: "token and new_password are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        error: "New password must be at least 8 characters long",
      });
    }

    const tokenHash = hashToken(rawToken);

    await client.query("BEGIN");

    const tokenResult = await client.query(
      `
      SELECT id, user_id, expires_at, used_at
      FROM password_tokens
      WHERE token_hash = $1
        AND purpose = 'RESET'
      FOR UPDATE
      `,
      [tokenHash]
    );

    if (!tokenResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reset token not found" });
    }

    const token = tokenResult.rows[0];

    if (token.used_at) {
      await client.query("ROLLBACK");
      return res.status(410).json({ error: "Reset token has already been used" });
    }

    if (new Date(token.expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return res.status(410).json({ error: "Reset token has expired" });
    }

    const nextHash = await bcrypt.hash(newPassword, 10);

    await client.query(
      `
      UPDATE users
      SET password_hash = $1,
          must_change_password = FALSE,
          temp_password_issued_at = NULL,
          updated_at = now()
      WHERE id = $2
      `,
      [nextHash, token.user_id]
    );

    await client.query(
      `
      UPDATE password_tokens
      SET used_at = now()
      WHERE id = $1
      `,
      [token.id]
    );

    await client.query(
      `
      INSERT INTO password_resets (user_id, reset_by)
      VALUES ($1, NULL)
      `,
      [token.user_id]
    );

    await client.query("COMMIT");

    return res.json({ message: "Password updated successfully." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("CONFIRM RESET PASSWORD ERROR:", error);
    return res.status(500).json({ error: "Failed to reset password" });
  } finally {
    client.release();
  }
});

module.exports = router;
