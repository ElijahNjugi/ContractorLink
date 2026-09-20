const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const pool = require("../config/db");
const requireAuth = require("../middleware/requireAuth");
const requireRole = require("../middleware/requireRole");
const { logAudit } = require("../services/audit");
const { sendMail } = require("../services/mailer");
const { createNotificationsForUsers } = require("../services/notifications");

const router = express.Router();

const APPLICATION_TYPES = ["CLIENT", "CONTRACTOR", "HYBRID"];
const APPLICATION_STATUSES = [
  "PENDING",
  "UNDER_REVIEW",
  "CONDITIONAL",
  "APPROVED",
  "REJECTED",
];
const REVIEWABLE_STATUSES = ["PENDING", "UNDER_REVIEW", "CONDITIONAL"];
const MAX_DOCUMENT_SIZE_BYTES = 8 * 1024 * 1024;
const DOCUMENT_TYPES = [
  "COMPANY_REGISTRATION",
  "BUSINESS_PERMIT",
  "TAX_COMPLIANCE",
  "COMPANY_PROFILE",
  "REPRESENTATIVE_ID",
  "INSURANCE_CERTIFICATE",
  "SECTOR_CERTIFICATION",
  "SUPPORTING_DOCUMENT",
];
const UPLOAD_ROOT = path.join(process.env.UPLOAD_ROOT || path.join(__dirname, "..", "..", "uploads"), "organization-applications");

function generateTempPassword() {
  return `Temp@${crypto.randomBytes(4).toString("hex")}7!`;
}

async function getRoleByCode(client, roleCode) {
  const { rows } = await client.query(
    `
    SELECT id, code, name
    FROM roles
    WHERE UPPER(code) = UPPER($1)
    LIMIT 1
    `,
    [roleCode]
  );

  return rows[0] || null;
}

function normalizeApplicationDocuments(documents) {
  if (!Array.isArray(documents)) {
    return [];
  }

  return documents
    .map((document) => {
      const documentLabel = String(document?.document_label || "").trim();
      const documentType = String(document?.document_type || "SUPPORTING_DOCUMENT")
        .trim()
        .toUpperCase();
      const fileName = String(document?.file_name || "").trim();
      const mimeType = String(document?.mime_type || "application/octet-stream").trim();
      const contentBase64 = String(document?.content_base64 || "").trim();
      const documentNumber = String(document?.document_number || "").trim() || null;
      const issueDate = String(document?.issue_date || "").trim() || null;
      const expiryDate = String(document?.expiry_date || "").trim() || null;
      const notes = String(document?.notes || "").trim() || null;

      if (!documentLabel || !fileName || !contentBase64) {
        return null;
      }

      return {
        document_label: documentLabel,
        document_type: DOCUMENT_TYPES.includes(documentType)
          ? documentType
          : "SUPPORTING_DOCUMENT",
        file_name: fileName,
        mime_type: mimeType,
        content_base64: contentBase64,
        document_number: documentNumber,
        issue_date: issueDate,
        expiry_date: expiryDate,
        notes,
      };
    })
    .filter(Boolean);
}

function sanitizeFileName(fileName) {
  const extension = path.extname(fileName || "").slice(0, 16);
  const baseName = path
    .basename(fileName || "document", extension)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return `${baseName || "document"}${extension || ""}`;
}

async function persistApplicationDocuments(client, applicationId, documents) {
  const writtenPaths = [];

  try {
    if (!documents.length) {
      return [];
    }

    const applicationDirectory = path.join(UPLOAD_ROOT, applicationId);
    await fs.mkdir(applicationDirectory, { recursive: true });

    const savedDocuments = [];

    for (const document of documents) {
      const buffer = Buffer.from(document.content_base64, "base64");

      if (!buffer.length) {
        throw new Error(`Document "${document.document_label}" is empty.`);
      }

      if (buffer.length > MAX_DOCUMENT_SIZE_BYTES) {
        throw new Error(
          `Document "${document.document_label}" exceeds the 8 MB upload limit.`
        );
      }

      const storedName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${sanitizeFileName(
        document.file_name
      )}`;
      const absolutePath = path.join(applicationDirectory, storedName);
      const publicPath = `/uploads/organization-applications/${applicationId}/${storedName}`;

      await fs.writeFile(absolutePath, buffer);
      writtenPaths.push(absolutePath);

      const { rows } = await client.query(
        `
        INSERT INTO organization_application_documents (
          application_id,
          document_label,
          document_type,
          file_name,
          file_path,
          mime_type,
          document_number,
          issue_date,
          expiry_date,
          notes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
        `,
        [
          applicationId,
          document.document_label,
          document.document_type,
          document.file_name,
          publicPath,
          document.mime_type,
          document.document_number,
          document.issue_date,
          document.expiry_date,
          document.notes,
        ]
      );

      savedDocuments.push(rows[0]);
    }

    return savedDocuments;
  } catch (error) {
    await Promise.all(
      writtenPaths.map((writtenPath) =>
        fs.unlink(writtenPath).catch(() => {
          return null;
        })
      )
    );

    throw error;
  }
}

function getBackendBaseUrl() {
  const raw = String(process.env.BACKEND_PUBLIC_URL || "http://localhost:5000").trim();
  return raw.replace(/\/+$/, "");
}

function serializeDocument(document) {
  return {
    ...document,
    document_url: document.file_path
      ? `${getBackendBaseUrl()}${document.file_path}`
      : null,
  };
}

async function fetchApplicationDocuments(applicationId) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM organization_application_documents
    WHERE application_id = $1
    ORDER BY uploaded_at ASC
    `,
    [applicationId]
  );

  return rows.map(serializeDocument);
}

async function fetchApplicationById(applicationId) {
  const { rows } = await pool.query(
    `
    SELECT
      oa.*,
      u.full_name AS reviewed_by_name,
      u.email AS reviewed_by_email,
      o.name AS approved_organization_name,
      hidden_user.full_name AS hidden_by_name
    FROM organization_applications oa
    LEFT JOIN users u
      ON u.id = oa.reviewed_by
    LEFT JOIN organizations o
      ON o.id = oa.approved_organization_id
    LEFT JOIN users hidden_user
      ON hidden_user.id = oa.hidden_by
    WHERE oa.id = $1
    LIMIT 1
    `,
    [applicationId]
  );

  if (!rows.length) {
    return null;
  }

  const documents = await fetchApplicationDocuments(applicationId);
  return {
    ...rows[0],
    documents,
  };
}

function buildApplicantStatusResponse(application) {
  const response = {
    id: application.id,
    company_name: application.company_name,
    organization_type_requested: application.organization_type_requested,
    application_status: application.application_status,
    created_at: application.created_at,
    updated_at: application.updated_at,
    reviewed_at: application.reviewed_at,
    approved_organization_name: application.approved_organization_name || null,
    review_notes: application.review_notes || null,
    rejection_reason: application.rejection_reason || null,
    applicant_response_notes: application.applicant_response_notes || null,
    document_count: Array.isArray(application.documents) ? application.documents.length : 0,
  };

  if (application.application_status === "APPROVED") {
    response.status_summary =
      "Your application was approved. Check your email for your primary organization admin account details.";
  } else if (application.application_status === "CONDITIONAL") {
    response.status_summary =
      "Your application needs additional clarification or supporting documents before it can be approved.";
  } else if (application.application_status === "UNDER_REVIEW") {
    response.status_summary =
      "Your application is currently under review by the platform administrator.";
  } else if (application.application_status === "REJECTED") {
    response.status_summary =
      "Your application was not approved. Review the feedback and submit a new request when ready.";
  } else {
    response.status_summary =
      "Your application has been received and is waiting for administrative review.";
  }

  return response;
}

async function fetchSuperAdminRecipients() {
  const { rows } = await pool.query(
    `
    SELECT u.email
    FROM users u
    INNER JOIN roles r
      ON r.id = u.role_id
    WHERE UPPER(r.code) = 'SUPER_ADMIN'
      AND u.is_active = TRUE
      AND u.email IS NOT NULL
    `
  );

  return rows.map((row) => row.email).filter(Boolean);
}

async function fetchSuperAdminUserIds() {
  const { rows } = await pool.query(
    `
    SELECT u.id
    FROM users u
    INNER JOIN roles r
      ON r.id = u.role_id
    WHERE UPPER(r.code) = 'SUPER_ADMIN'
      AND u.is_active = TRUE
    `
  );

  return rows.map((row) => row.id);
}

router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const companyName = String(req.body?.company_name || "").trim();
    const organizationTypeRequested = String(
      req.body?.organization_type_requested || ""
    )
      .trim()
      .toUpperCase();
    const primaryContactName = String(req.body?.primary_contact_name || "").trim();
    const primaryContactEmail = String(req.body?.primary_contact_email || "")
      .trim()
      .toLowerCase();
    const primaryContactPhone = String(req.body?.primary_contact_phone || "").trim() || null;
    const description = String(req.body?.description || "").trim() || null;
    const serviceSummary = String(req.body?.service_summary || "").trim() || null;
    const coverageArea = String(req.body?.coverage_area || "").trim() || null;
    const documents = normalizeApplicationDocuments(req.body?.documents);

    if (
      !companyName ||
      !organizationTypeRequested ||
      !primaryContactName ||
      !primaryContactEmail
    ) {
      return res.status(400).json({
        error:
          "company_name, organization_type_requested, primary_contact_name, and primary_contact_email are required",
      });
    }

    if (!APPLICATION_TYPES.includes(organizationTypeRequested)) {
      return res.status(400).json({
        error: "organization_type_requested must be CLIENT, CONTRACTOR, or HYBRID",
      });
    }

    if (!documents.length) {
      return res.status(400).json({
        error: "At least one supporting document is required before submission.",
      });
    }

    await client.query("BEGIN");

    const inserted = await client.query(
      `
      INSERT INTO organization_applications (
        company_name,
        organization_type_requested,
        primary_contact_name,
        primary_contact_email,
        primary_contact_phone,
        description,
        service_summary,
        coverage_area
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        companyName,
        organizationTypeRequested,
        primaryContactName,
        primaryContactEmail,
        primaryContactPhone,
        description,
        serviceSummary,
        coverageArea,
      ]
    );

    const application = inserted.rows[0];
    const savedDocuments = await persistApplicationDocuments(
      client,
      application.id,
      documents
    );

    await logAudit({
      actionType: "ORGANIZATION_APPLICATION_SUBMITTED",
      entityType: "organization_application",
      entityId: application.id,
      metadata: {
        company_name: companyName,
        organization_type_requested: organizationTypeRequested,
        primary_contact_email: primaryContactEmail,
        documents_uploaded: savedDocuments.length,
      },
      executor: client,
    });

    await client.query("COMMIT");

    // Keep the public application request responsive even if notifications fail.
    void fetchSuperAdminUserIds()
      .then((adminUserIds) => createNotificationsForUsers(adminUserIds, {
        title: "New organization application",
        message: `${companyName} submitted a ${organizationTypeRequested.toLowerCase()} organization application for review.`,
        type: "INFO",
        entityType: "organization_application",
        entityId: application.id,
        link: "/applications",
      }))
      .catch((notificationError) => console.error("APPLICATION NOTIFICATION ERROR:", notificationError.message));

    await sendMail({
      to: primaryContactEmail,
      subject: "ContractorLink application received",
      text: [
        `Hello ${primaryContactName},`,
        "",
        `Your application for ${companyName} has been received.`,
        `Reference ID: ${application.id}`,
        "",
        "You can use your application reference ID together with this email address to check the current review status in ContractorLink.",
      ].join("\n"),
      html: `
        <p>Hello ${primaryContactName},</p>
        <p>Your application for <strong>${companyName}</strong> has been received.</p>
        <p><strong>Reference ID:</strong> ${application.id}</p>
        <p>You can use your application reference ID together with this email address to check the current review status in ContractorLink.</p>
      `,
    });

    return res.status(201).json({
      ...application,
      documents: savedDocuments.map(serializeDocument),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("CREATE ORGANIZATION APPLICATION ERROR:", error);
    return res.status(500).json({ error: error.message || "Failed to submit organization application" });
  } finally {
    client.release();
  }
});

router.get("/status", async (req, res) => {
  try {
    const applicationId = String(req.query?.application_id || "").trim();
    const email = String(req.query?.email || "").trim().toLowerCase();

    if (!applicationId || !email) {
      return res.status(400).json({
        error: "application_id and email are required",
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        oa.*,
        o.name AS approved_organization_name
      FROM organization_applications oa
      LEFT JOIN organizations o
        ON o.id = oa.approved_organization_id
      WHERE oa.id = $1
        AND LOWER(oa.primary_contact_email) = LOWER($2)
      LIMIT 1
      `,
      [applicationId, email]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: "No application was found for the provided reference ID and email.",
      });
    }

    const application = rows[0];
    const documents = await fetchApplicationDocuments(application.id);

    return res.json(
      buildApplicantStatusResponse({
        ...application,
        documents,
      })
    );
  } catch (error) {
    console.error("PUBLIC APPLICATION STATUS ERROR:", error);
    return res.status(500).json({ error: "Failed to check application status" });
  }
});

router.patch("/:id/respond", async (req, res) => {
  const client = await pool.connect();

  try {
    const applicationId = req.params.id;
    const email = String(req.body?.email || "").trim().toLowerCase();
    const applicantResponseNotes =
      String(req.body?.applicant_response_notes || "").trim() || null;
    const primaryContactPhone =
      String(req.body?.primary_contact_phone || "").trim() || null;
    const serviceSummary = String(req.body?.service_summary || "").trim() || null;
    const description = String(req.body?.description || "").trim() || null;
    const coverageArea = String(req.body?.coverage_area || "").trim() || null;
    const documents = normalizeApplicationDocuments(req.body?.documents);

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    if (!documents.length && !applicantResponseNotes) {
      return res.status(400).json({
        error: "Provide additional documents or applicant response notes before resubmitting.",
      });
    }

    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT *
      FROM organization_applications
      WHERE id = $1
        AND LOWER(primary_contact_email) = LOWER($2)
      FOR UPDATE
      `,
      [applicationId, email]
    );

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "No application was found for the provided reference ID and email.",
      });
    }

    const application = existing.rows[0];

    if (application.application_status !== "CONDITIONAL") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Only applications in conditional review can be updated by the applicant.",
      });
    }

    if (documents.length) {
      await persistApplicationDocuments(client, applicationId, documents);
    }

    await client.query(
      `
      UPDATE organization_applications
      SET primary_contact_phone = COALESCE($1, primary_contact_phone),
          service_summary = COALESCE($2, service_summary),
          description = COALESCE($3, description),
          coverage_area = COALESCE($4, coverage_area),
          applicant_response_notes = $5,
          application_status = 'UNDER_REVIEW',
          updated_at = now()
      WHERE id = $6
      `,
      [
        primaryContactPhone,
        serviceSummary,
        description,
        coverageArea,
        applicantResponseNotes,
        applicationId,
      ]
    );

    await logAudit({
      actionType: "ORGANIZATION_APPLICATION_RESPONDED",
      entityType: "organization_application",
      entityId: applicationId,
      metadata: {
        email,
        added_documents: documents.length,
        applicant_response_notes: applicantResponseNotes,
      },
      executor: client,
    });

    await client.query("COMMIT");

    const refreshed = await fetchApplicationById(applicationId);
    const adminRecipients = await fetchSuperAdminRecipients();

    if (adminRecipients.length) {
      await sendMail({
        to: adminRecipients.join(", "),
        subject: `Applicant resubmitted ContractorLink application: ${application.company_name}`,
        text: [
          `The applicant for ${application.company_name} has responded to a conditional review.`,
          `Reference ID: ${application.id}`,
          `Applicant email: ${application.primary_contact_email}`,
          `Additional documents uploaded: ${documents.length}`,
          applicantResponseNotes ? `Applicant response notes: ${applicantResponseNotes}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        html: `
          <p>The applicant for <strong>${application.company_name}</strong> has responded to a conditional review.</p>
          <ul>
            <li><strong>Reference ID:</strong> ${application.id}</li>
            <li><strong>Applicant email:</strong> ${application.primary_contact_email}</li>
            <li><strong>Additional documents uploaded:</strong> ${documents.length}</li>
          </ul>
          ${
            applicantResponseNotes
              ? `<p><strong>Applicant response notes:</strong> ${applicantResponseNotes}</p>`
              : ""
          }
        `,
      });
    }

    return res.json(buildApplicantStatusResponse(refreshed));
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("RESPOND TO ORGANIZATION APPLICATION ERROR:", error);
    return res.status(500).json({
      error: error.message || "Failed to update the conditional application.",
    });
  } finally {
    client.release();
  }
});

router.get("/", requireAuth, requireRole("SUPER_ADMIN"), async (req, res) => {
  try {
    const status = String(req.query?.status || "").trim().toUpperCase();
    const includeHidden = String(req.query?.include_hidden || "")
      .trim()
      .toLowerCase() === "true";
    const params = [];
    const whereParts = [];

    if (!includeHidden) {
      params.push(false);
      whereParts.push(`oa.is_hidden = $${params.length}`);
    }

    if (status) {
      params.push(status);
      whereParts.push(`oa.application_status = $${params.length}`);
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `
      SELECT
        oa.*,
        u.full_name AS reviewed_by_name,
        u.email AS reviewed_by_email,
        o.name AS approved_organization_name,
        hidden_user.full_name AS hidden_by_name,
        COUNT(oad.id)::int AS document_count
      FROM organization_applications oa
      LEFT JOIN users u
        ON u.id = oa.reviewed_by
      LEFT JOIN organizations o
        ON o.id = oa.approved_organization_id
      LEFT JOIN users hidden_user
        ON hidden_user.id = oa.hidden_by
      LEFT JOIN organization_application_documents oad
        ON oad.application_id = oa.id
      ${where}
      GROUP BY oa.id, u.full_name, u.email, o.name, hidden_user.full_name
      ORDER BY oa.created_at DESC
      `,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST ORGANIZATION APPLICATIONS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch organization applications" });
  }
});

router.patch("/:id/visibility", requireAuth, requireRole("SUPER_ADMIN"), async (req, res) => {
  try {
    const hide = Boolean(req.body?.hide);

    const { rows } = await pool.query(
      `
      UPDATE organization_applications
      SET is_hidden = $1,
          hidden_at = CASE WHEN $1 THEN now() ELSE NULL END,
          hidden_by = CASE WHEN $1 THEN $2::uuid ELSE NULL END,
          updated_at = now()
      WHERE id = $3
      RETURNING id, company_name, application_status, is_hidden, hidden_at, hidden_by
      `,
      [hide, req.user.id, req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Organization application not found" });
    }

    await logAudit({
      actorUserId: req.user.id,
      actionType: hide
        ? "ORGANIZATION_APPLICATION_HIDDEN"
        : "ORGANIZATION_APPLICATION_UNHIDDEN",
      entityType: "organization_application",
      entityId: req.params.id,
      metadata: {
        hide,
      },
    });

    return res.json(rows[0]);
  } catch (error) {
    console.error("APPLICATION VISIBILITY UPDATE ERROR:", error);
    return res.status(500).json({ error: "Failed to update application visibility" });
  }
});

router.get("/:id", requireAuth, requireRole("SUPER_ADMIN"), async (req, res) => {
  try {
    const application = await fetchApplicationById(req.params.id);

    if (!application) {
      return res.status(404).json({ error: "Organization application not found" });
    }

    return res.json(application);
  } catch (error) {
    console.error("GET ORGANIZATION APPLICATION ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch organization application" });
  }
});

router.patch("/:id/review", requireAuth, requireRole("SUPER_ADMIN"), async (req, res) => {
  const client = await pool.connect();

  try {
    const applicationId = req.params.id;
    const status = String(req.body?.status || "").trim().toUpperCase();
    const reviewNotes = String(req.body?.review_notes || "").trim() || null;
    const rejectionReason = String(req.body?.rejection_reason || "").trim() || null;

    if (!APPLICATION_STATUSES.includes(status) || status === "PENDING") {
      return res.status(400).json({
        error: "status must be UNDER_REVIEW, CONDITIONAL, APPROVED, or REJECTED",
      });
    }

    if (status === "CONDITIONAL" && !reviewNotes) {
      return res.status(400).json({
        error: "review_notes are required when marking an application as conditional",
      });
    }

    if (status === "REJECTED" && !rejectionReason) {
      return res.status(400).json({ error: "rejection_reason is required when rejecting" });
    }

    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT *
      FROM organization_applications
      WHERE id = $1
      FOR UPDATE
      `,
      [applicationId]
    );

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Organization application not found" });
    }

    const application = existing.rows[0];

    if (!REVIEWABLE_STATUSES.includes(application.application_status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Application has already reached a final review state" });
    }

    const documentCountResult = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM organization_application_documents
      WHERE application_id = $1
      `,
      [applicationId]
    );

    if (status === "APPROVED" && documentCountResult.rows[0].count < 1) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "At least one supporting document must be attached before approval.",
      });
    }

    let approvedOrganizationId = application.approved_organization_id || null;
    let createdAdminEmail = null;
    let createdAdminTempPassword = null;

    if (status === "APPROVED") {
      const orgAdminRole = await getRoleByCode(client, "ORG_ADMIN");
      if (!orgAdminRole) {
        await client.query("ROLLBACK");
        return res.status(500).json({ error: "ORG_ADMIN role is missing from roles table" });
      }

      const orgResult = await client.query(
        `
        INSERT INTO organizations (name, organization_type, description, email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (name)
        DO UPDATE SET
          organization_type = EXCLUDED.organization_type,
          description = COALESCE(EXCLUDED.description, organizations.description),
          email = COALESCE(EXCLUDED.email, organizations.email),
          is_active = TRUE,
          updated_at = now()
        RETURNING id
        `,
        [
          application.company_name,
          application.organization_type_requested,
          application.description,
          application.primary_contact_email,
        ]
      );

      approvedOrganizationId = orgResult.rows[0].id;

      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      const existingUser = await client.query(
        `
        SELECT id, organization_id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        FOR UPDATE
        `,
        [application.primary_contact_email]
      );

      if (
        existingUser.rowCount &&
        String(existingUser.rows[0].organization_id || "") !== String(approvedOrganizationId)
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error:
            "The applicant email is already attached to another user account. Use a different email or resolve the existing account first.",
        });
      }

      if (existingUser.rowCount) {
        await client.query(
          `
          UPDATE users
          SET organization_id = $1,
              role_id = $2,
              full_name = $3,
              password_hash = $4,
              phone = COALESCE($5, phone),
              job_title = COALESCE(job_title, 'Organization Admin'),
              is_active = TRUE,
              must_change_password = TRUE,
              temp_password_issued_at = now(),
              updated_at = now()
          WHERE id = $6
          `,
          [
            approvedOrganizationId,
            orgAdminRole.id,
            application.primary_contact_name,
            passwordHash,
            application.primary_contact_phone,
            existingUser.rows[0].id,
          ]
        );
      } else {
        await client.query(
          `
          INSERT INTO users (
            organization_id,
            role_id,
            full_name,
            email,
            password_hash,
            phone,
            job_title,
            is_active,
            must_change_password,
            temp_password_issued_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,'Organization Admin',TRUE,TRUE,now())
          `,
          [
            approvedOrganizationId,
            orgAdminRole.id,
            application.primary_contact_name,
            application.primary_contact_email,
            passwordHash,
            application.primary_contact_phone,
          ]
        );
      }

      createdAdminEmail = application.primary_contact_email;
      createdAdminTempPassword = tempPassword;

      await client.query(
        `
        INSERT INTO organization_contacts (
          organization_id,
          name,
          email,
          phone,
          contact_type,
          description,
          is_primary,
          is_active
        )
        SELECT
          $1::uuid,
          $2::varchar(150),
          $3::varchar(150),
          $4::varchar(50),
          'PRIMARY_CONTACT',
          'Imported from approved application',
          TRUE,
          TRUE
        WHERE NOT EXISTS (
          SELECT 1
          FROM organization_contacts
          WHERE organization_id = $1::uuid
            AND LOWER(email) = LOWER($3::text)
        )
        `,
        [
          approvedOrganizationId,
          application.primary_contact_name,
          application.primary_contact_email,
          application.primary_contact_phone,
        ]
      );
    }

    const reviewed = await client.query(
      `
      UPDATE organization_applications
      SET application_status = $1,
          review_notes = $2,
          reviewed_by = $3,
          reviewed_at = now(),
          approved_organization_id = $4,
          rejection_reason = $5,
          updated_at = now()
      WHERE id = $6
      RETURNING *
      `,
      [status, reviewNotes, req.user.id, approvedOrganizationId, rejectionReason, applicationId]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "ORGANIZATION_APPLICATION_REVIEWED",
      entityType: "organization_application",
      entityId: applicationId,
      metadata: {
        previous_status: application.application_status,
        status,
        approved_organization_id: approvedOrganizationId,
        rejection_reason: rejectionReason,
        created_admin_email: createdAdminEmail,
      },
      executor: client,
    });

    await client.query("COMMIT");

    if (status === "APPROVED" && createdAdminEmail && createdAdminTempPassword) {
      await sendMail({
        to: createdAdminEmail,
        subject: "Your ContractorLink organization application was approved",
        text: [
          `Hello ${application.primary_contact_name},`,
          "",
          `Your organization application for ${application.company_name} has been approved.`,
          "Your primary administrator account has been created with the details below:",
          `Email: ${createdAdminEmail}`,
          `Temporary password: ${createdAdminTempPassword}`,
          "",
          "Please sign in and change your password immediately after logging in.",
        ].join("\n"),
        html: `
          <p>Hello ${application.primary_contact_name},</p>
          <p>Your organization application for <strong>${application.company_name}</strong> has been approved.</p>
          <p>Your primary administrator account has been created with the details below:</p>
          <ul>
            <li><strong>Email:</strong> ${createdAdminEmail}</li>
            <li><strong>Temporary password:</strong> ${createdAdminTempPassword}</li>
          </ul>
          <p>Please sign in and change your password immediately after logging in.</p>
        `,
      });
    }

    if (status === "CONDITIONAL" && application.primary_contact_email) {
      await sendMail({
        to: application.primary_contact_email,
        subject: "Additional information needed for your ContractorLink application",
        text: [
          `Hello ${application.primary_contact_name},`,
          "",
          `Your organization application for ${application.company_name} needs additional clarification before it can be approved.`,
          `Review notes: ${reviewNotes}`,
          "",
          "Please review the current feedback in the platform and prepare the requested corrections or supporting documents.",
        ].join("\n"),
        html: `
          <p>Hello ${application.primary_contact_name},</p>
          <p>Your organization application for <strong>${application.company_name}</strong> needs additional clarification before it can be approved.</p>
          <p><strong>Review notes:</strong> ${reviewNotes}</p>
          <p>Please review the current feedback in the platform and prepare the requested corrections or supporting documents.</p>
        `,
      });
    }

    if (status === "REJECTED" && application.primary_contact_email) {
      await sendMail({
        to: application.primary_contact_email,
        subject: "Your ContractorLink organization application was not approved",
        text: [
          `Hello ${application.primary_contact_name},`,
          "",
          `Your organization application for ${application.company_name} was reviewed and was not approved at this time.`,
          `Reason: ${rejectionReason}`,
          "",
          "You may review the feedback and submit a new request when ready.",
        ].join("\n"),
        html: `
          <p>Hello ${application.primary_contact_name},</p>
          <p>Your organization application for <strong>${application.company_name}</strong> was reviewed and was not approved at this time.</p>
          <p><strong>Reason:</strong> ${rejectionReason}</p>
          <p>You may review the feedback and submit a new request when ready.</p>
        `,
      });
    }

    const applicationWithDocuments = await fetchApplicationById(applicationId);

    return res.json({
      ...applicationWithDocuments,
      created_admin_email: createdAdminEmail,
      created_admin_temp_password: createdAdminTempPassword,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("REVIEW ORGANIZATION APPLICATION ERROR:", error);
    return res.status(500).json({ error: error.message || "Failed to review organization application" });
  } finally {
    client.release();
  }
});

module.exports = router;
