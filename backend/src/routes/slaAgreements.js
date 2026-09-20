const express = require("express");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");
const { logAudit } = require("../services/audit");
const { createNotificationsForUsers, getActiveUsersForOrganizations } = require("../services/notifications");

const router = express.Router();

function roleCode(req) {
  return String(req.user?.role_code || "").toUpperCase();
}

function optionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canAccessOrganization(req, organizationId) {
  const role = roleCode(req);
  if (role === "SUPER_ADMIN") return true;
  if (["ORG_ADMIN", "DIRECTOR", "ORG_STAFF"].includes(role)) {
    return String(req.user.organization_id) === String(organizationId);
  }
  return false;
}

async function getAgreementOrThrow(id) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM sla_agreements
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

function normalizeEmailGroup(value) {
  const emails = String(value || "").split(/[;,\n]+/).map((email) => email.trim()).filter(Boolean);
  return [...new Set(emails)].join(", ");
}

async function createApprovalEscalations(agreement, terms, executor = pool) {
  const stages = [
    { level: 1, beforeMinutes: 30, event: "WARNING", emails: terms.escalation30Emails, name: "30-minute SLA warning recipients" },
    { level: 2, beforeMinutes: 15, event: "WARNING", emails: terms.escalation15Emails, name: "15-minute SLA warning recipients" },
    { level: 3, beforeMinutes: 0, event: "BREACH", emails: terms.escalationBreachEmails, name: "SLA breach recipients" },
  ];
  const policies = await executor.query(`SELECT id, target_resolution_minutes FROM sla_agreement_policies WHERE sla_agreement_id = $1 AND is_active = TRUE`, [agreement.id]);
  for (const policy of policies.rows) {
    for (const stage of stages) {
      const emailGroup = normalizeEmailGroup(stage.emails);
      const existingContact = await executor.query(
        `SELECT id
         FROM organization_contacts
         WHERE organization_id = $1
           AND LOWER(COALESCE(email, '')) = LOWER($2)
         ORDER BY is_primary DESC, created_at ASC
         LIMIT 1`,
        [agreement.contractor_organization_id, emailGroup]
      );
      const contact = existingContact.rowCount
        ? existingContact
        : await executor.query(
            `INSERT INTO organization_contacts (organization_id, name, email, contact_type, description, is_active)
             VALUES ($1,'SLA escalation contact',$2,'SLA_ESCALATION',$3,TRUE) RETURNING id`,
            [agreement.contractor_organization_id, emailGroup, `Receives automatic SLA notices for ${agreement.agreement_name}`]
          );
      await executor.query(
        `INSERT INTO sla_agreement_escalations (sla_policy_id, level_no, trigger_minutes, trigger_event_type, contact_id, is_active)
         VALUES ($1,$2,$3,$4,$5,TRUE)
         ON CONFLICT (sla_policy_id, level_no) DO UPDATE SET trigger_minutes = EXCLUDED.trigger_minutes, trigger_event_type = EXCLUDED.trigger_event_type, contact_id = EXCLUDED.contact_id, is_active = TRUE, updated_at = now()`,
        [policy.id, stage.level, Math.max(0, Number(policy.target_resolution_minutes) - stage.beforeMinutes), stage.event, contact.rows[0].id]
      );
    }
  }
}

async function getOrganizationById(id) {
  const { rows } = await pool.query(
    `
    SELECT id, name, organization_type, is_active
    FROM organizations
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

async function getPartnershipById(id) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM organization_partnerships
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

async function getContactById(id) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM organization_contacts
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

router.get("/", requireRole("SUPER_ADMIN", "ORG_ADMIN", "DIRECTOR", "ORG_STAFF"), async (req, res) => {
  try {
    const requestedOrgId = req.query.organization_id || null;
    const role = roleCode(req);

    const params = [];
    let where = "";

    if (role === "SUPER_ADMIN" && requestedOrgId) {
      params.push(requestedOrgId);
      where = `
        WHERE a.client_organization_id = $1
           OR a.contractor_organization_id = $1
      `;
    } else if (role !== "SUPER_ADMIN") {
      params.push(req.user.organization_id);
      where = `
        WHERE a.client_organization_id = $1
           OR a.contractor_organization_id = $1
      `;
    }

    const { rows } = await pool.query(
      `
      SELECT
        a.*,
        client_org.name AS client_organization_name,
        contractor_org.name AS contractor_organization_name,
        creator.full_name AS created_by_name
      FROM sla_agreements a
      JOIN organizations client_org
        ON client_org.id = a.client_organization_id
      JOIN organizations contractor_org
        ON contractor_org.id = a.contractor_organization_id
      LEFT JOIN users creator
        ON creator.id = a.created_by
      ${where}
      ORDER BY a.created_at DESC
      `,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST SLA AGREEMENTS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch SLA agreements" });
  }
});

router.get("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN", "DIRECTOR", "ORG_STAFF"), async (req, res) => {
  try {
    const agreement = await getAgreementOrThrow(req.params.id);
    if (!agreement) {
      return res.status(404).json({ error: "SLA agreement not found" });
    }

    if (
      !canAccessOrganization(req, agreement.client_organization_id) &&
      !canAccessOrganization(req, agreement.contractor_organization_id)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const agreementResult = await pool.query(
      `
      SELECT
        a.*,
        client_org.name AS client_organization_name,
        contractor_org.name AS contractor_organization_name,
        creator.full_name AS created_by_name
      FROM sla_agreements a
      JOIN organizations client_org
        ON client_org.id = a.client_organization_id
      JOIN organizations contractor_org
        ON contractor_org.id = a.contractor_organization_id
      LEFT JOIN users creator
        ON creator.id = a.created_by
      WHERE a.id = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    const policiesResult = await pool.query(
      `
      SELECT *
      FROM sla_agreement_policies
      WHERE sla_agreement_id = $1
      ORDER BY priority_level ASC
      `,
      [req.params.id]
    );

    const escalationsResult = await pool.query(
      `
      SELECT
        e.*,
        c.name AS contact_name,
        c.email AS contact_email,
        c.phone AS contact_phone
      FROM sla_agreement_escalations e
      JOIN organization_contacts c
        ON c.id = e.contact_id
      WHERE e.sla_policy_id IN (
        SELECT id
        FROM sla_agreement_policies
        WHERE sla_agreement_id = $1
      )
      ORDER BY e.sla_policy_id ASC, e.level_no ASC
      `,
      [req.params.id]
    );

    return res.json({
      agreement: agreementResult.rows[0],
      policies: policiesResult.rows,
      escalations: escalationsResult.rows,
    });
  } catch (error) {
    console.error("GET SLA AGREEMENT ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch SLA agreement" });
  }
});

router.post("/", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    if (roleCode(req) === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Super admins cannot create agreements on behalf of organizations" });
    }
    const clientOrganizationId = req.body?.client_organization_id;
    const contractorOrganizationId = req.body?.contractor_organization_id;
    const partnershipId = req.body?.partnership_id || null;
    const agreementName = String(req.body?.agreement_name || "").trim();
    const description = String(req.body?.description || "").trim() || null;
    const agreementVersion = optionalText(req.body?.agreement_version) || "1.0";
    const effectiveDate = optionalText(req.body?.effective_date);
    const endDate = optionalText(req.body?.end_date);
    const renewalType = String(req.body?.renewal_type || "ONGOING").trim().toUpperCase();
    const noticePeriodDays = req.body?.notice_period_days === "" || req.body?.notice_period_days == null ? null : Number(req.body.notice_period_days);
    const reviewIntervalMonths = req.body?.review_interval_months === "" || req.body?.review_interval_months == null ? null : Number(req.body.review_interval_months);
    const nextReviewDate = optionalText(req.body?.next_review_date);
    const documentOwnerName = optionalText(req.body?.document_owner_name);
    const servicesInScope = optionalText(req.body?.services_in_scope);
    const servicesExcluded = optionalText(req.body?.services_excluded);
    const clientResponsibilities = optionalText(req.body?.client_responsibilities);
    const contractorResponsibilities = optionalText(req.body?.contractor_responsibilities);
    const serviceAssumptions = optionalText(req.body?.service_assumptions);
    const supportHours = optionalText(req.body?.support_hours);
    const supportChannels = optionalText(req.body?.support_channels);
    const paymentTerms = optionalText(req.body?.payment_terms);
    const governingLaw = optionalText(req.body?.governing_law);
    const legalTerms = optionalText(req.body?.legal_terms);

    if (!clientOrganizationId || !contractorOrganizationId || !agreementName) {
      return res.status(400).json({
        error: "client_organization_id, contractor_organization_id, and agreement_name are required",
      });
    }

    if (String(clientOrganizationId) === String(contractorOrganizationId)) {
      return res.status(400).json({
        error: "client_organization_id and contractor_organization_id must be different",
      });
    }

    if (!["ONGOING", "FIXED_TERM", "AUTO_RENEW"].includes(renewalType)) {
      return res.status(400).json({ error: "renewal_type must be ONGOING, FIXED_TERM, or AUTO_RENEW" });
    }
    if (renewalType === "FIXED_TERM" && !endDate) {
      return res.status(400).json({ error: "A fixed-term agreement requires an end_date" });
    }
    if (effectiveDate && endDate && new Date(endDate) < new Date(effectiveDate)) {
      return res.status(400).json({ error: "end_date cannot be earlier than effective_date" });
    }
    if (noticePeriodDays !== null && (!Number.isInteger(noticePeriodDays) || noticePeriodDays < 0)) {
      return res.status(400).json({ error: "notice_period_days must be a non-negative whole number" });
    }
    if (reviewIntervalMonths !== null && (!Number.isInteger(reviewIntervalMonths) || reviewIntervalMonths <= 0)) {
      return res.status(400).json({ error: "review_interval_months must be a positive whole number" });
    }

    if (
      roleCode(req) !== "SUPER_ADMIN" &&
      String(req.user.organization_id) !== String(clientOrganizationId)
    ) {
      return res.status(403).json({
        error: "Organization admins can only create agreements for their own organization as client",
      });
    }

    const [clientOrganization, contractorOrganization] = await Promise.all([
      getOrganizationById(clientOrganizationId),
      getOrganizationById(contractorOrganizationId),
    ]);

    if (!clientOrganization || !contractorOrganization) {
      return res.status(404).json({ error: "Client or contractor organization not found" });
    }

    if (partnershipId) {
      const partnership = await getPartnershipById(partnershipId);
      if (!partnership) {
        return res.status(404).json({ error: "Partnership not found" });
      }

      const partnershipMatches =
        String(partnership.client_organization_id) === String(clientOrganizationId) &&
        String(partnership.contractor_organization_id) === String(contractorOrganizationId);

      if (!partnershipMatches) {
        return res.status(400).json({
          error: "partnership_id does not match the provided client and contractor organizations",
        });
      }

      if (partnership.status !== "ACTIVE") {
        return res.status(400).json({ error: "An active partnership is required before drafting an SLA" });
      }
    } else if (roleCode(req) !== "SUPER_ADMIN") {
      return res.status(400).json({ error: "partnership_id is required for organization-created SLAs" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO sla_agreements (
        client_organization_id,
        contractor_organization_id,
        partnership_id,
        agreement_name,
        description,
        agreement_version,
        effective_date,
        end_date,
        renewal_type,
        notice_period_days,
        review_interval_months,
        next_review_date,
        document_owner_name,
        services_in_scope,
        services_excluded,
        client_responsibilities,
        contractor_responsibilities,
        service_assumptions,
        support_hours,
        support_channels,
        payment_terms,
        governing_law,
        legal_terms,
        status,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      RETURNING *
      `,
      [
        clientOrganizationId,
        contractorOrganizationId,
        partnershipId,
        agreementName,
        description,
        agreementVersion,
        effectiveDate,
        endDate,
        renewalType,
        noticePeriodDays,
        reviewIntervalMonths,
        nextReviewDate,
        documentOwnerName,
        servicesInScope,
        servicesExcluded,
        clientResponsibilities,
        contractorResponsibilities,
        serviceAssumptions,
        supportHours,
        supportChannels,
        paymentTerms,
        governingLaw,
        legalTerms,
        "DRAFT",
        req.user.id,
      ]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "SLA_AGREEMENT_CREATED",
      entityType: "sla_agreement",
      entityId: rows[0].id,
      metadata: {
        client_organization_id: clientOrganizationId,
        contractor_organization_id: contractorOrganizationId,
        status: "DRAFT",
      },
    });

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("CREATE SLA AGREEMENT ERROR:", error);
    return res.status(500).json({ error: "Failed to create SLA agreement" });
  }
});

router.patch("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    if (roleCode(req) === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Super admins can review or revoke agreements but cannot edit party terms" });
    }
    const agreement = await getAgreementOrThrow(req.params.id);
    if (!agreement) {
      return res.status(404).json({ error: "SLA agreement not found" });
    }

    if (roleCode(req) !== "SUPER_ADMIN" && String(req.user.organization_id) !== String(agreement.client_organization_id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (roleCode(req) !== "SUPER_ADMIN" && !["DRAFT", "REJECTED"].includes(agreement.status)) {
      return res.status(409).json({ error: "SLA targets can only be changed while the agreement is in draft or rejected" });
    }

    const agreementName = req.body?.agreement_name ? String(req.body.agreement_name).trim() : null;
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : null;
    const effectiveDate = optionalText(req.body?.effective_date);
    const endDate = optionalText(req.body?.end_date);
    const renewalType = req.body?.renewal_type ? String(req.body.renewal_type).trim().toUpperCase() : null;
    const noticePeriodDays = req.body?.notice_period_days === "" || req.body?.notice_period_days == null ? null : Number(req.body.notice_period_days);
    const reviewIntervalMonths = req.body?.review_interval_months === "" || req.body?.review_interval_months == null ? null : Number(req.body.review_interval_months);
    const nextReviewDate = optionalText(req.body?.next_review_date);
    const documentOwnerName = optionalText(req.body?.document_owner_name);
    const servicesInScope = optionalText(req.body?.services_in_scope);
    const servicesExcluded = optionalText(req.body?.services_excluded);
    const clientResponsibilities = optionalText(req.body?.client_responsibilities);
    const contractorResponsibilities = optionalText(req.body?.contractor_responsibilities);
    const serviceAssumptions = optionalText(req.body?.service_assumptions);
    const supportHours = optionalText(req.body?.support_hours);
    const supportChannels = optionalText(req.body?.support_channels);
    const paymentTerms = optionalText(req.body?.payment_terms);
    const governingLaw = optionalText(req.body?.governing_law);
    const legalTerms = optionalText(req.body?.legal_terms);
    const status = req.body?.status ? String(req.body.status).trim().toUpperCase() : null;

    if (status && !["DRAFT", "PENDING_APPROVAL", "ACTIVE", "REJECTED", "INACTIVE", "REVOKED"].includes(status)) {
      return res.status(400).json({ error: "Invalid SLA agreement status" });
    }

    if (roleCode(req) !== "SUPER_ADMIN" && agreement.status !== "DRAFT" && agreement.status !== "REJECTED") {
      return res.status(409).json({ error: "Only draft or rejected agreements can be edited" });
    }

    if (roleCode(req) !== "SUPER_ADMIN" && status) {
      return res.status(403).json({ error: "Use the agreement submit and decision actions to change approval status" });
    }

    if (renewalType && !["ONGOING", "FIXED_TERM", "AUTO_RENEW"].includes(renewalType)) {
      return res.status(400).json({ error: "renewal_type must be ONGOING, FIXED_TERM, or AUTO_RENEW" });
    }
    if (renewalType === "FIXED_TERM" && !endDate) {
      return res.status(400).json({ error: "A fixed-term agreement requires an end_date" });
    }
    if (effectiveDate && endDate && new Date(endDate) < new Date(effectiveDate)) {
      return res.status(400).json({ error: "end_date cannot be earlier than effective_date" });
    }
    if (noticePeriodDays !== null && (!Number.isInteger(noticePeriodDays) || noticePeriodDays < 0)) {
      return res.status(400).json({ error: "notice_period_days must be a non-negative whole number" });
    }
    if (reviewIntervalMonths !== null && (!Number.isInteger(reviewIntervalMonths) || reviewIntervalMonths <= 0)) {
      return res.status(400).json({ error: "review_interval_months must be a positive whole number" });
    }

    const { rows } = await pool.query(
      `
      UPDATE sla_agreements
      SET
        agreement_name = COALESCE($1, agreement_name),
        description = COALESCE($2, description),
        effective_date = COALESCE($3, effective_date),
        end_date = COALESCE($4, end_date),
        renewal_type = COALESCE($5, renewal_type),
        notice_period_days = COALESCE($6, notice_period_days),
        review_interval_months = COALESCE($7, review_interval_months),
        next_review_date = COALESCE($8, next_review_date),
        document_owner_name = COALESCE($9, document_owner_name),
        services_in_scope = COALESCE($10, services_in_scope),
        services_excluded = COALESCE($11, services_excluded),
        client_responsibilities = COALESCE($12, client_responsibilities),
        contractor_responsibilities = COALESCE($13, contractor_responsibilities),
        service_assumptions = COALESCE($14, service_assumptions),
        support_hours = COALESCE($15, support_hours),
        support_channels = COALESCE($16, support_channels),
        payment_terms = COALESCE($17, payment_terms),
        governing_law = COALESCE($18, governing_law),
        legal_terms = COALESCE($19, legal_terms),
        status = COALESCE($20, status),
        updated_at = now()
      WHERE id = $21
      RETURNING *
      `,
      [
        agreementName, description, effectiveDate, endDate, renewalType, noticePeriodDays,
        reviewIntervalMonths, nextReviewDate, documentOwnerName, servicesInScope,
        servicesExcluded, clientResponsibilities, contractorResponsibilities, serviceAssumptions,
        supportHours, supportChannels, paymentTerms, governingLaw, legalTerms, status, req.params.id,
      ]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "SLA_AGREEMENT_UPDATED",
      entityType: "sla_agreement",
      entityId: req.params.id,
      metadata: {
        status,
      },
    });

    return res.json(rows[0]);
  } catch (error) {
    console.error("UPDATE SLA AGREEMENT ERROR:", error);
    return res.status(500).json({ error: "Failed to update SLA agreement" });
  }
});

router.post("/:id/submit", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    if (roleCode(req) === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Super admins cannot submit agreements on behalf of an organization" });
    }
    const agreement = await getAgreementOrThrow(req.params.id);
    if (!agreement) return res.status(404).json({ error: "SLA agreement not found" });
    if (roleCode(req) !== "SUPER_ADMIN" && String(req.user.organization_id) !== String(agreement.client_organization_id)) {
      return res.status(403).json({ error: "Only the client organization can submit this SLA for approval" });
    }
    if (!["DRAFT", "REJECTED"].includes(agreement.status)) {
      return res.status(409).json({ error: "Only draft or rejected agreements can be submitted" });
    }

    const policies = await pool.query(
      `SELECT priority_level FROM sla_agreement_policies
       WHERE sla_agreement_id = $1 AND is_active = TRUE`,
      [agreement.id]
    );
    const levels = new Set(policies.rows.map((policy) => Number(policy.priority_level)));
    if (![1, 2, 3].every((level) => levels.has(level))) {
      return res.status(400).json({ error: "Set active resolution targets for Critical, High, and Normal priorities before submitting" });
    }

    const { rows } = await pool.query(
      `UPDATE sla_agreements
       SET status = 'PENDING_APPROVAL',
           contractor_approved_by = NULL,
           contractor_approved_at = NULL,
           contractor_review_note = NULL,
           updated_at = now()
       WHERE id = $1 RETURNING *`,
      [agreement.id]
    );
    await logAudit({ actorUserId: req.user.id, actionType: "SLA_AGREEMENT_SUBMITTED", entityType: "sla_agreement", entityId: agreement.id });
    const contractorUsers = await getActiveUsersForOrganizations([agreement.contractor_organization_id]);
    await createNotificationsForUsers(contractorUsers.map((user) => user.id), {
      title: "SLA Awaiting Review",
      message: `${agreement.agreement_name} has been submitted for your organization's approval.`,
      type: "INFO",
      entityType: "sla_agreement",
      entityId: agreement.id,
      link: `/sla-agreements/${agreement.id}`,
    });
    return res.json(rows[0]);
  } catch (error) {
    console.error("SUBMIT SLA AGREEMENT ERROR:", error);
    return res.status(500).json({ error: "Failed to submit SLA agreement" });
  }
});

router.post("/:id/decision", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    if (roleCode(req) === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Super admins cannot approve or reject agreements on behalf of a party" });
    }
    const agreement = await getAgreementOrThrow(req.params.id);
    if (!agreement) return res.status(404).json({ error: "SLA agreement not found" });
    const decision = String(req.body?.decision || "").trim().toUpperCase();
    const reviewNote = String(req.body?.review_note || "").trim() || null;
    const contractorPaymentTerms = String(req.body?.contractor_payment_terms || "").trim();
    const breachRemedies = String(req.body?.breach_remedies || "").trim();
    const jobContactName = String(req.body?.contractor_job_contact_name || "").trim();
    const jobContactEmail = String(req.body?.contractor_job_contact_email || "").trim();
    const jobContactPhone = String(req.body?.contractor_job_contact_phone || "").trim() || null;
    // If a stage has no separate recipients, keep the delivery contact informed.
    const deliveryEmailRecipients = normalizeEmailGroup(jobContactEmail);
    const escalation30Emails = normalizeEmailGroup(req.body?.escalation_30m_emails) || deliveryEmailRecipients;
    const escalation15Emails = normalizeEmailGroup(req.body?.escalation_15m_emails) || deliveryEmailRecipients;
    const escalationBreachEmails = normalizeEmailGroup(req.body?.escalation_breach_emails) || deliveryEmailRecipients;
    if (!["APPROVE", "REJECT"].includes(decision)) {
      return res.status(400).json({ error: "decision must be APPROVE or REJECT" });
    }
    if (roleCode(req) !== "SUPER_ADMIN" && String(req.user.organization_id) !== String(agreement.contractor_organization_id)) {
      return res.status(403).json({ error: "Only the contractor organization can decide on this SLA" });
    }
    if (agreement.status !== "PENDING_APPROVAL") {
      return res.status(409).json({ error: "This agreement is not awaiting contractor approval" });
    }

    if (decision === "APPROVE" && (!contractorPaymentTerms || !breachRemedies || !jobContactName || !jobContactEmail)) {
      return res.status(400).json({ error: "Complete payment terms, breach remedies, and the delivery contact before approving." });
    }

    const nextStatus = decision === "APPROVE" ? "ACTIVE" : "REJECTED";
    const { rows } = await pool.query(
      `UPDATE sla_agreements
       SET status = $1::varchar,
           contractor_approved_by = $2,
           contractor_approved_at = now(),
           contractor_review_note = $3,
           contractor_payment_terms = CASE WHEN $1::varchar = 'ACTIVE' THEN $4 ELSE contractor_payment_terms END,
           breach_remedies = CASE WHEN $1::varchar = 'ACTIVE' THEN $5 ELSE breach_remedies END,
           contractor_job_contact_name = CASE WHEN $1::varchar = 'ACTIVE' THEN $6 ELSE contractor_job_contact_name END,
           contractor_job_contact_email = CASE WHEN $1::varchar = 'ACTIVE' THEN $7 ELSE contractor_job_contact_email END,
           contractor_job_contact_phone = CASE WHEN $1::varchar = 'ACTIVE' THEN $8 ELSE contractor_job_contact_phone END,
           escalation_30m_emails = CASE WHEN $1::varchar = 'ACTIVE' THEN $9 ELSE escalation_30m_emails END,
           escalation_15m_emails = CASE WHEN $1::varchar = 'ACTIVE' THEN $10 ELSE escalation_15m_emails END,
           escalation_breach_emails = CASE WHEN $1::varchar = 'ACTIVE' THEN $11 ELSE escalation_breach_emails END,
           updated_at = now()
       WHERE id = $12 RETURNING *`,
      [nextStatus, req.user.id, reviewNote, contractorPaymentTerms, breachRemedies, jobContactName, jobContactEmail, jobContactPhone, escalation30Emails, escalation15Emails, escalationBreachEmails, agreement.id]
    );
    if (decision === "APPROVE") await createApprovalEscalations(agreement, { escalation30Emails, escalation15Emails, escalationBreachEmails });
    await logAudit({
      actorUserId: req.user.id,
      actionType: decision === "APPROVE" ? "SLA_AGREEMENT_APPROVED" : "SLA_AGREEMENT_REJECTED",
      entityType: "sla_agreement",
      entityId: agreement.id,
      metadata: { review_note: reviewNote },
    });
    const clientUsers = await getActiveUsersForOrganizations([agreement.client_organization_id]);
    await createNotificationsForUsers(clientUsers.map((user) => user.id), {
      title: decision === "APPROVE" ? "SLA Approved" : "SLA Revision Requested",
      message: decision === "APPROVE"
        ? `${agreement.agreement_name} is active and ready for tickets.`
        : `${agreement.agreement_name} was returned for revision.${reviewNote ? ` Note: ${reviewNote}` : ""}`,
      type: decision === "APPROVE" ? "SUCCESS" : "WARNING",
      entityType: "sla_agreement",
      entityId: agreement.id,
      link: `/sla-agreements/${agreement.id}`,
    });
    return res.json(rows[0]);
  } catch (error) {
    console.error("DECIDE SLA AGREEMENT ERROR:", error);
    return res.status(500).json({ error: "Failed to record SLA decision" });
  }
});

router.post("/:id/revoke", requireRole("SUPER_ADMIN"), async (req, res) => {
  try {
    const agreement = await getAgreementOrThrow(req.params.id);
    if (!agreement) return res.status(404).json({ error: "SLA agreement not found" });
    if (agreement.status !== "ACTIVE") {
      return res.status(409).json({ error: "Only an active SLA agreement can be revoked" });
    }

    const reason = String(req.body?.reason || "").trim();
    if (!reason) return res.status(400).json({ error: "Provide a reason for revoking this agreement" });

    const { rows } = await pool.query(
      `UPDATE sla_agreements
       SET status = 'REVOKED', revoked_by = $1, revoked_at = now(), revocation_reason = $2, updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [req.user.id, reason, agreement.id]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "SLA_AGREEMENT_REVOKED",
      entityType: "sla_agreement",
      entityId: agreement.id,
      metadata: { reason },
    });

    const affectedUsers = await getActiveUsersForOrganizations([
      agreement.client_organization_id,
      agreement.contractor_organization_id,
    ]);
    await createNotificationsForUsers(affectedUsers.map((user) => user.id), {
      title: "SLA Revoked by Platform Administration",
      message: `${agreement.agreement_name} has been revoked. Reason: ${reason}`,
      type: "DANGER",
      entityType: "sla_agreement",
      entityId: agreement.id,
      link: `/sla-agreements/${agreement.id}`,
    });

    return res.json(rows[0]);
  } catch (error) {
    console.error("REVOKE SLA AGREEMENT ERROR:", error);
    return res.status(500).json({ error: "Failed to revoke SLA agreement" });
  }
});

router.post("/:agreementId/policies", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    if (roleCode(req) === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Super admins cannot edit SLA targets" });
    }
    const agreement = await getAgreementOrThrow(req.params.agreementId);
    if (!agreement) {
      return res.status(404).json({ error: "SLA agreement not found" });
    }

    if (roleCode(req) !== "SUPER_ADMIN" && String(req.user.organization_id) !== String(agreement.client_organization_id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (roleCode(req) !== "SUPER_ADMIN" && !["DRAFT", "REJECTED"].includes(agreement.status)) {
      return res.status(409).json({ error: "SLA targets can only be changed while the agreement is in draft or rejected" });
    }

    const priorityLevel = Number(req.body?.priority_level);
    const targetResponseMinutes =
      req.body?.target_response_minutes === "" || req.body?.target_response_minutes == null
        ? null
        : Number(req.body.target_response_minutes);
    const targetResolutionMinutes = Number(req.body?.target_resolution_minutes);
    const isActive =
      typeof req.body?.is_active === "boolean" ? req.body.is_active : true;

    if (
      ![1, 2, 3].includes(priorityLevel) ||
      !Number.isInteger(targetResolutionMinutes) ||
      targetResolutionMinutes <= 0 ||
      (targetResponseMinutes !== null && (!Number.isInteger(targetResponseMinutes) || targetResponseMinutes <= 0))
    ) {
      return res.status(400).json({
        error: "Priority targets must be valid positive whole numbers",
      });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO sla_agreement_policies (
        sla_agreement_id,
        priority_level,
        target_response_minutes,
        target_resolution_minutes,
        is_active
      )
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (sla_agreement_id, priority_level)
      DO UPDATE SET
        target_response_minutes = EXCLUDED.target_response_minutes,
        target_resolution_minutes = EXCLUDED.target_resolution_minutes,
        is_active = EXCLUDED.is_active,
        updated_at = now()
      RETURNING *
      `,
      [req.params.agreementId, priorityLevel, targetResponseMinutes, targetResolutionMinutes, isActive]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "SLA_POLICY_UPSERTED",
      entityType: "sla_agreement_policy",
      entityId: rows[0].id,
      metadata: {
        sla_agreement_id: req.params.agreementId,
        priority_level: priorityLevel,
        target_resolution_minutes: targetResolutionMinutes,
      },
    });

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("UPSERT SLA POLICY ERROR:", error);
    return res.status(500).json({ error: "Failed to save SLA policy" });
  }
});

router.patch("/policies/:policyId", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    if (roleCode(req) === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Super admins cannot edit SLA targets" });
    }
    const existing = await pool.query(
      `
      SELECT p.*, a.client_organization_id, a.contractor_organization_id
      FROM sla_agreement_policies p
      JOIN sla_agreements a
        ON a.id = p.sla_agreement_id
      WHERE p.id = $1
      LIMIT 1
      `,
      [req.params.policyId]
    );

    if (!existing.rowCount) {
      return res.status(404).json({ error: "SLA policy not found" });
    }

    const policy = existing.rows[0];
    if (roleCode(req) !== "SUPER_ADMIN" && String(req.user.organization_id) !== String(policy.client_organization_id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const agreementStatus = await getAgreementOrThrow(policy.sla_agreement_id);
    if (roleCode(req) !== "SUPER_ADMIN" && !["DRAFT", "REJECTED"].includes(agreementStatus?.status)) {
      return res.status(409).json({ error: "SLA targets can only be changed while the agreement is in draft or rejected" });
    }

    const targetResolutionMinutes = req.body?.target_resolution_minutes
      ? Number(req.body.target_resolution_minutes)
      : null;
    const isActive =
      typeof req.body?.is_active === "boolean" ? req.body.is_active : null;

    if (
      targetResolutionMinutes !== null &&
      (!Number.isInteger(targetResolutionMinutes) || targetResolutionMinutes <= 0)
    ) {
      return res.status(400).json({
        error: "target_resolution_minutes must be a positive integer",
      });
    }

    const { rows } = await pool.query(
      `
      UPDATE sla_agreement_policies
      SET
        target_resolution_minutes = COALESCE($1, target_resolution_minutes),
        is_active = COALESCE($2, is_active),
        updated_at = now()
      WHERE id = $3
      RETURNING *
      `,
      [targetResolutionMinutes, isActive, req.params.policyId]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "SLA_POLICY_UPDATED",
      entityType: "sla_agreement_policy",
      entityId: req.params.policyId,
      metadata: {
        target_resolution_minutes: targetResolutionMinutes,
        is_active: isActive,
      },
    });

    return res.json(rows[0]);
  } catch (error) {
    console.error("UPDATE SLA POLICY ERROR:", error);
    return res.status(500).json({ error: "Failed to update SLA policy" });
  }
});

router.get("/:agreementId/policies", requireRole("SUPER_ADMIN", "ORG_ADMIN", "DIRECTOR", "ORG_STAFF"), async (req, res) => {
  try {
    const agreement = await getAgreementOrThrow(req.params.agreementId);
    if (!agreement) {
      return res.status(404).json({ error: "SLA agreement not found" });
    }

    if (
      !canAccessOrganization(req, agreement.client_organization_id) &&
      !canAccessOrganization(req, agreement.contractor_organization_id)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { rows } = await pool.query(
      `
      SELECT *
      FROM sla_agreement_policies
      WHERE sla_agreement_id = $1
      ORDER BY priority_level ASC
      `,
      [req.params.agreementId]
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST SLA POLICIES ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch SLA policies" });
  }
});

router.post("/policies/:policyId/escalations", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    if (roleCode(req) === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Super admins cannot edit SLA escalation rules" });
    }
    const existing = await pool.query(
      `
      SELECT p.*, a.client_organization_id, a.contractor_organization_id
      FROM sla_agreement_policies p
      JOIN sla_agreements a
        ON a.id = p.sla_agreement_id
      WHERE p.id = $1
      LIMIT 1
      `,
      [req.params.policyId]
    );

    if (!existing.rowCount) {
      return res.status(404).json({ error: "SLA policy not found" });
    }

    const policy = existing.rows[0];
    if (roleCode(req) !== "SUPER_ADMIN" && String(req.user.organization_id) !== String(policy.client_organization_id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const levelNo = Number(req.body?.level_no);
    const triggerMinutes = Number(req.body?.trigger_minutes);
    const triggerEventType = String(req.body?.trigger_event_type || "").trim().toUpperCase();
    const contactId = req.body?.contact_id;
    const repeatEveryMinutes =
      req.body?.repeat_every_minutes === null || req.body?.repeat_every_minutes === undefined
        ? null
        : Number(req.body.repeat_every_minutes);
    const isActive =
      typeof req.body?.is_active === "boolean" ? req.body.is_active : true;

    if (
      !Number.isInteger(levelNo) ||
      levelNo <= 0 ||
      !Number.isInteger(triggerMinutes) ||
      triggerMinutes < 0 ||
      !contactId
    ) {
      return res.status(400).json({
        error: "level_no, trigger_minutes, and contact_id are required and must be valid",
      });
    }

    if (!["WARNING", "BREACH", "POST_BREACH_REPEAT"].includes(triggerEventType)) {
      return res.status(400).json({
        error: "trigger_event_type must be WARNING, BREACH, or POST_BREACH_REPEAT",
      });
    }

    if (
      repeatEveryMinutes !== null &&
      (!Number.isInteger(repeatEveryMinutes) || repeatEveryMinutes <= 0)
    ) {
      return res.status(400).json({
        error: "repeat_every_minutes must be a positive integer when provided",
      });
    }

    const contact = await getContactById(contactId);
    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    const contactAllowedOrganizations = [
      String(policy.client_organization_id),
      String(policy.contractor_organization_id),
    ];

    if (!contactAllowedOrganizations.includes(String(contact.organization_id))) {
      return res.status(400).json({
        error: "Escalation contact must belong to either the client or contractor organization in this agreement",
      });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO sla_agreement_escalations (
        sla_policy_id,
        level_no,
        trigger_minutes,
        trigger_event_type,
        contact_id,
        repeat_every_minutes,
        is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (sla_policy_id, level_no)
      DO UPDATE SET
        trigger_minutes = EXCLUDED.trigger_minutes,
        trigger_event_type = EXCLUDED.trigger_event_type,
        contact_id = EXCLUDED.contact_id,
        repeat_every_minutes = EXCLUDED.repeat_every_minutes,
        is_active = EXCLUDED.is_active,
        updated_at = now()
      RETURNING *
      `,
      [
        req.params.policyId,
        levelNo,
        triggerMinutes,
        triggerEventType,
        contactId,
        repeatEveryMinutes,
        isActive,
      ]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "SLA_ESCALATION_UPSERTED",
      entityType: "sla_agreement_escalation",
      entityId: rows[0].id,
      metadata: {
        sla_policy_id: req.params.policyId,
        level_no: levelNo,
        trigger_event_type: triggerEventType,
        trigger_minutes: triggerMinutes,
      },
    });

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("UPSERT SLA ESCALATION ERROR:", error);
    return res.status(500).json({ error: "Failed to save SLA escalation" });
  }
});

router.patch("/escalations/:escalationId", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    if (roleCode(req) === "SUPER_ADMIN") {
      return res.status(403).json({ error: "Super admins cannot edit SLA escalation rules" });
    }
    const existing = await pool.query(
      `
      SELECT e.*, a.client_organization_id
      FROM sla_agreement_escalations e
      JOIN sla_agreement_policies p
        ON p.id = e.sla_policy_id
      JOIN sla_agreements a
        ON a.id = p.sla_agreement_id
      WHERE e.id = $1
      LIMIT 1
      `,
      [req.params.escalationId]
    );

    if (!existing.rowCount) {
      return res.status(404).json({ error: "SLA escalation not found" });
    }

    const escalation = existing.rows[0];
    if (roleCode(req) !== "SUPER_ADMIN" && String(req.user.organization_id) !== String(escalation.client_organization_id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const triggerMinutes = req.body?.trigger_minutes !== undefined
      ? Number(req.body.trigger_minutes)
      : null;
    const triggerEventType = req.body?.trigger_event_type
      ? String(req.body.trigger_event_type).trim().toUpperCase()
      : null;
    const contactId = req.body?.contact_id || null;
    const repeatEveryMinutes =
      req.body?.repeat_every_minutes === undefined || req.body?.repeat_every_minutes === null
        ? null
        : Number(req.body.repeat_every_minutes);
    const isActive =
      typeof req.body?.is_active === "boolean" ? req.body.is_active : null;

    if (triggerMinutes !== null && (!Number.isInteger(triggerMinutes) || triggerMinutes < 0)) {
      return res.status(400).json({ error: "trigger_minutes must be a non-negative integer" });
    }

    if (
      triggerEventType &&
      !["WARNING", "BREACH", "POST_BREACH_REPEAT"].includes(triggerEventType)
    ) {
      return res.status(400).json({
        error: "trigger_event_type must be WARNING, BREACH, or POST_BREACH_REPEAT",
      });
    }

    if (
      repeatEveryMinutes !== null &&
      (!Number.isInteger(repeatEveryMinutes) || repeatEveryMinutes <= 0)
    ) {
      return res.status(400).json({
        error: "repeat_every_minutes must be a positive integer when provided",
      });
    }

    if (contactId) {
      const contact = await getContactById(contactId);
      if (!contact) {
        return res.status(404).json({ error: "Contact not found" });
      }

      const allowedOrganizations = [
        String(escalation.client_organization_id),
        String(escalation.contractor_organization_id),
      ];

      if (!allowedOrganizations.includes(String(contact.organization_id))) {
        return res.status(400).json({
          error:
            "Escalation contact must belong to either the client or contractor organization in this agreement",
        });
      }
    }

    const { rows } = await pool.query(
      `
      UPDATE sla_agreement_escalations
      SET
        trigger_minutes = COALESCE($1, trigger_minutes),
        trigger_event_type = COALESCE($2, trigger_event_type),
        contact_id = COALESCE($3, contact_id),
        repeat_every_minutes = COALESCE($4, repeat_every_minutes),
        is_active = COALESCE($5, is_active),
        updated_at = now()
      WHERE id = $6
      RETURNING *
      `,
      [
        triggerMinutes,
        triggerEventType,
        contactId,
        repeatEveryMinutes,
        isActive,
        req.params.escalationId,
      ]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "SLA_ESCALATION_UPDATED",
      entityType: "sla_agreement_escalation",
      entityId: req.params.escalationId,
      metadata: {
        trigger_event_type: triggerEventType,
        trigger_minutes: triggerMinutes,
        repeat_every_minutes: repeatEveryMinutes,
      },
    });

    return res.json(rows[0]);
  } catch (error) {
    console.error("UPDATE SLA ESCALATION ERROR:", error);
    return res.status(500).json({ error: "Failed to update SLA escalation" });
  }
});

router.get("/policies/:policyId/escalations", requireRole("SUPER_ADMIN", "ORG_ADMIN", "DIRECTOR", "ORG_STAFF"), async (req, res) => {
  try {
    const existing = await pool.query(
      `
      SELECT p.id, a.client_organization_id, a.contractor_organization_id
      FROM sla_agreement_policies p
      JOIN sla_agreements a
        ON a.id = p.sla_agreement_id
      WHERE p.id = $1
      LIMIT 1
      `,
      [req.params.policyId]
    );

    if (!existing.rowCount) {
      return res.status(404).json({ error: "SLA policy not found" });
    }

    const policy = existing.rows[0];
    if (
      !canAccessOrganization(req, policy.client_organization_id) &&
      !canAccessOrganization(req, policy.contractor_organization_id)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        e.*,
        c.name AS contact_name,
        c.email AS contact_email,
        c.phone AS contact_phone,
        c.job_title AS contact_job_title
      FROM sla_agreement_escalations e
      JOIN organization_contacts c
        ON c.id = e.contact_id
      WHERE e.sla_policy_id = $1
      ORDER BY e.level_no ASC
      `,
      [req.params.policyId]
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST SLA ESCALATIONS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch SLA escalations" });
  }
});

module.exports = router;
