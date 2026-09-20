const SECTION_GUIDES = {
  services_in_scope: {
    question: "What work do you want the provider to deliver? Include the main activities, location or coverage, and any expected deliverables.",
    title: "Services in scope",
    examples: [
      "Provide relocation planning, packing, transport, unloading, and post-move checks within Nairobi County.",
      "Provide preventive maintenance, fault diagnosis, repair, and service reports for the listed equipment.",
      "Provide network support, incident response, scheduled maintenance, and monthly performance reporting.",
      "Provide project coordination, field implementation, quality assurance, and agreed completion reports.",
    ],
  },
  services_excluded: {
    question: "What work, costs, areas, or situations are not covered unless both parties separately agree?",
    title: "Services excluded",
    examples: [
      "Third-party charges, work outside the agreed coverage area, and work requiring a separate quotation are excluded unless approved in writing.",
      "Emergency work outside agreed support hours, replacement materials, and services not listed in scope require separate approval.",
      "The provider is not responsible for pre-existing defects, work performed by third parties, or services outside the agreed deliverables.",
      "Any additional service request that materially changes the scope, timeline, or cost will be handled through a written variation.",
    ],
  },
  client_responsibilities: {
    question: "What must the client provide or do so the provider can complete the work successfully?",
    title: "Client responsibilities",
    examples: [
      "The client will provide accurate requirements, timely access to the work site, a designated contact person, and prompt approvals where required.",
      "The client will provide relevant information, safe access, required permits, and timely decisions that affect service delivery.",
      "The client will submit complete tickets through ContractorLink, cooperate with reasonable requests, and meet agreed payment obligations.",
      "The client will notify the provider of changes, provide access to approved systems or locations, and confirm completion of delivered work.",
    ],
  },
  contractor_responsibilities: {
    question: "What service standard and communication should the provider commit to?",
    title: "Provider responsibilities",
    examples: [
      "The provider will supply suitably qualified personnel, deliver the agreed services professionally, and provide timely progress updates through ContractorLink.",
      "The provider will acknowledge and work on valid tickets within the agreed targets, maintain quality standards, and notify the client of material delays.",
      "The provider will maintain the resources required for delivery, keep service records, and escalate issues that may affect the agreed service levels.",
      "The provider will comply with agreed safety and quality requirements, protect client information, and provide a completion report where applicable.",
    ],
  },
  service_assumptions: {
    question: "What conditions do both parties assume will be true for the service to be delivered?",
    title: "Service assumptions",
    examples: [
      "Both parties assume that the work location is accessible, the required information is accurate, and any necessary approvals are obtained before work begins.",
      "Delivery assumes a safe working environment, availability of the agreed contacts, and timely access to required systems, equipment, or premises.",
      "The agreed targets apply only where the client provides complete ticket information and the service is within the agreed scope and support hours.",
      "Both parties assume normal operating conditions; delays caused by force majeure or third parties will be discussed and documented promptly.",
    ],
  },
  support_hours: {
    question: "When can the client request support, and are there different arrangements for emergencies?",
    title: "Support hours and availability",
    examples: [
      "Standard support is available Monday to Friday, 8:00 AM to 5:00 PM, excluding public holidays. Critical incidents may be reported through the agreed emergency contact.",
      "The provider will receive and acknowledge tickets through ContractorLink at all times. Work is performed during normal business hours unless emergency support is separately agreed.",
      "Support is available on weekdays from 8:00 AM to 5:00 PM. Requests received outside these hours are treated as received on the next business day unless classified as critical.",
      "Service availability follows the agreed project schedule. Planned maintenance or service interruptions will be communicated to the client in advance where practicable.",
    ],
  },
  support_channels: {
    question: "Which approved channels should be used to create, track, and escalate service requests?",
    title: "Approved service channels",
    examples: [
      "Service requests must be created through the ContractorLink ticket portal. Email may be used for supporting documents and approved contacts for urgent escalation.",
      "The primary channel is the ContractorLink ticket portal. Critical incidents may additionally be reported to the provider's designated phone contact.",
      "Both parties will use ContractorLink for tickets, status updates, and records. Messages sent through other channels must be added to the relevant ticket.",
      "Tickets and service updates will be managed through ContractorLink, with email used only for formal notices, approvals, and escalation alerts.",
    ],
  },
};

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function fallbackOptions(section, answer) {
  const guide = SECTION_GUIDES[section];
  const detail = normalize(answer);
  if (!guide) return [];

  if (!detail) return guide.examples;

  const prefix = {
    services_in_scope: "The provider will deliver the following agreed services: ",
    services_excluded: "The following are excluded from this agreement unless approved in writing: ",
    client_responsibilities: "The client will ",
    contractor_responsibilities: "The provider will ",
    service_assumptions: "This agreement assumes that ",
    support_hours: "Support availability is as follows: ",
    support_channels: "The parties will use the following approved channels: ",
  }[section] || "";

  return [
    `${prefix}${detail}`,
    `${prefix}${detail}. Any material change will be confirmed by both parties through ContractorLink.`,
    `${prefix}${detail}. The parties will keep relevant updates and approvals in the related ContractorLink record.`,
    `${prefix}${detail}. Where this cannot be met, the affected party will notify the other party as soon as reasonably possible.`,
  ];
}

function getGuide(section) {
  return SECTION_GUIDES[section] || null;
}

module.exports = { fallbackOptions, getGuide, SECTION_GUIDES };
