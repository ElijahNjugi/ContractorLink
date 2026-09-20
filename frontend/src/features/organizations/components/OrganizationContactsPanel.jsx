import { useState } from "react";
import {
  createOrganizationContact,
  updateOrganizationContact,
} from "../../../api/organizations";

const initialForm = {
  name: "",
  email: "",
  phone: "",
  job_title: "",
  contact_type: "",
  description: "",
  is_primary: false,
  is_active: true,
};

export default function OrganizationContactsPanel({
  organizationId,
  contacts,
  onRefresh,
}) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCreate(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await createOrganizationContact({
        organization_id: organizationId,
        ...form,
      });
      setForm(initialForm);
      onRefresh?.();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to create contact.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleActive(contact) {
    await Promise.all(
      (contact.contact_ids || [contact.id]).map((contactId) =>
        updateOrganizationContact(contactId, { is_active: !contact.is_active })
      )
    );
    onRefresh?.();
  }

  return (
    <div className="stack-lg">
      <div className="panel">
        <div className="detail-header">
          <div>
            <span className="eyebrow">Escalation contacts</span>
            <h3>Contacts</h3>
          </div>
        </div>

        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Used for</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <strong>{contact.name}</strong>
                    <div className="muted-table-text">{contact.job_title || "No title"}</div>
                  </td>
                  <td>{contact.email || "No email"}</td>
                  <td>
                    {contact.escalation_usages?.length ? (
                      <div className="contact-usage-list">
                        {contact.escalation_usages.map((usage, index) => (
                          <span key={`${usage.agreement_name}-${usage.stage}-${index}`}>
                            <strong>{usage.agreement_name}</strong> · {usage.stage}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted-table-text">{contact.contact_type || "General contact"}</span>
                    )}
                  </td>
                  <td>{contact.is_active ? "Active" : "Inactive"}</td>
                  <td>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => toggleActive(contact)}
                    >
                      {contact.is_active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
              {!contacts.length ? (
                <tr>
                  <td colSpan="5">No contacts added yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={handleCreate} className="panel stack-md">
        <div className="detail-header">
          <div>
            <span className="eyebrow">Add contact</span>
            <h3>New organization contact</h3>
          </div>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({ ...current, email: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              value={form.phone}
              onChange={(event) =>
                setForm((current) => ({ ...current, phone: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Job title</span>
            <input
              value={form.job_title}
              onChange={(event) =>
                setForm((current) => ({ ...current, job_title: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Contact type</span>
            <input
              value={form.contact_type}
              onChange={(event) =>
                setForm((current) => ({ ...current, contact_type: event.target.value }))
              }
              placeholder="PRIMARY_CONTACT, ESCALATION, SUPPORT..."
            />
          </label>
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={form.is_primary}
              onChange={(event) =>
                setForm((current) => ({ ...current, is_primary: event.target.checked }))
              }
            />
            <span>Primary contact</span>
          </label>
        </div>

        <label className="field">
          <span>Description</span>
          <textarea
            rows="3"
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
          />
        </label>

        {error ? <div className="form-error">{error}</div> : null}

        <button type="submit" className="button button-primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving contact..." : "Add contact"}
        </button>
      </form>
    </div>
  );
}
