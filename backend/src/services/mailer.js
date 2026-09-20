const nodemailer = require("nodemailer");

let transporter = null;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildCompanyEmail({ subject, text, html }) {
  if (html) return html;
  const message = escapeHtml(text).replace(/\n/g, "<br />");
  return `<!doctype html><html><body style="margin:0;background:#f4f0e8;font-family:Arial,sans-serif;color:#24211d;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f4f0e8;"><tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fffdf9;border:1px solid #dfd1ba;border-radius:20px;overflow:hidden;">
        <tr><td style="padding:26px 32px;background:#0e6b5c;color:#ffffff;"><div style="font-size:12px;letter-spacing:2px;font-weight:700;">CONTRACTORLINK</div><div style="margin-top:7px;font-size:24px;font-weight:700;">SLA Platform</div></td></tr>
        <tr><td style="padding:34px 32px;"><div style="font-size:12px;letter-spacing:1.6px;font-weight:700;color:#0e6b5c;text-transform:uppercase;">Account update</div><h1 style="margin:10px 0 18px;font-size:25px;line-height:1.25;color:#24211d;">${escapeHtml(subject)}</h1><div style="padding:20px;background:#f6f1e8;border-radius:14px;font-size:16px;line-height:1.6;color:#4b4338;">${message}</div><p style="margin:24px 0 0;font-size:14px;line-height:1.5;color:#756a5b;">Please sign in to ContractorLink to view the full record and take any required action.</p></td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #eadfce;font-size:12px;line-height:1.5;color:#8a7d6b;">This is an automated ContractorLink notification. Keep your account details secure.</td></tr>
      </table>
    </td></tr></table></body></html>`;
}

function smtpConfigured() {
  return Boolean(process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS);
}

function getTransporter() {
  if (!smtpConfigured()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT || 587),
      secure: String(process.env.MAIL_SECURE || "false").toLowerCase() === "true",
      connectionTimeout: Number(process.env.MAIL_CONNECTION_TIMEOUT_MS || 3000),
      greetingTimeout: Number(process.env.MAIL_GREETING_TIMEOUT_MS || 3000),
      socketTimeout: Number(process.env.MAIL_SOCKET_TIMEOUT_MS || 5000),
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
  }

  return transporter;
}

function resolveFromAddress() {
  const mailUser = String(process.env.MAIL_USER || "").trim();
  const configuredFrom = String(process.env.MAIL_FROM || "").trim();
  const host = String(process.env.MAIL_HOST || "").trim().toLowerCase();
  const isGmail = host.includes("gmail");

  if (!configuredFrom) {
    return mailUser;
  }

  if (!isGmail) {
    return configuredFrom;
  }

  if (configuredFrom.toLowerCase().includes(mailUser.toLowerCase())) {
    return configuredFrom;
  }

  const displayNameMatch = configuredFrom.match(/^(.*)<.*>$/);
  if (displayNameMatch?.[1]) {
    return `${displayNameMatch[1].trim()} <${mailUser}>`;
  }

  return `ContractorLink <${mailUser}>`;
}

async function sendMail({ to, subject, text, html }) {
  try {
    const mailer = getTransporter();
    if (!mailer) {
      return { ok: false, skipped: true, reason: "SMTP not configured" };
    }

    const result = await mailer.sendMail({
      from: resolveFromAddress(),
      to,
      subject,
      text,
      html: buildCompanyEmail({ subject, text, html }),
    });

    return { ok: true, result };
  } catch (error) {
    console.error("MAIL SEND ERROR:", error);
    return { ok: false, error: error.message };
  }
}

module.exports = {
  sendMail,
  buildCompanyEmail,
};
