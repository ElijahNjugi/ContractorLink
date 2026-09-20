import { useState } from "react";
import { createOrganization, updateOrganization } from "../../../api/organizations";
import { ORGANIZATION_TYPES } from "../constants";

function getInitialForm(organization) {
  return {
    name: organization?.name || "",
    organization_type: organization?.organization_type || "CLIENT",
    description: organization?.description || "",
    website_url: organization?.website_url || "",
    phone: organization?.phone || "",
    email: organization?.email || "",
    is_active: organization?.is_active ?? true,
  };
}

export default function OrganizationForm({
  organization = null,
  onSuccess,
  submitLabel,
}) {
  const [form, setForm] = useState(() => getInitialForm(organization));
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        description: form.description.trim(),
        website_url: form.website_url.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
      };

      const saved = organization
        ? await updateOrganization(organization.id, payload)
        : await createOrganization(payload);

      if (!organization) {
        setForm(getInitialForm(null));
      }
      onSuccess?.(saved);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to save organization.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel stack-md">
      <div className="detail-header">
        <div>
          <span className="eyebrow">
            {organization ? "Update organization" : "Create organization"}
          </span>
          <h3>{organization ? organization.name : "New company profile"}</h3>
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
          <span>Type</span>
          <select
            value={form.organization_type}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                organization_type: event.target.value,
              }))
            }
          >
            {ORGANIZATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
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
          <span>Website</span>
          <input
            value={form.website_url}
            onChange={(event) =>
              setForm((current) => ({ ...current, website_url: event.target.value }))
            }
          />
        </label>

        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(event) =>
              setForm((current) => ({ ...current, is_active: event.target.checked }))
            }
          />
          <span>Organization is active</span>
        </label>
      </div>

      <label className="field">
        <span>Description</span>
        <textarea
          rows="4"
          value={form.description}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
        />
      </label>

      {error ? <div className="form-error">{error}</div> : null}

      <button type="submit" className="button button-primary" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : submitLabel || (organization ? "Save changes" : "Create organization")}
      </button>
    </form>
  );
}
