import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import AppShell from "./components/layout/AppShell";
import LoginPage from "./pages/auth/LoginPage";
import ChangePasswordPage from "./pages/auth/ChangePasswordPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import OrganizationRegistrationPage from "./pages/public/OrganizationRegistrationPage";
import ApplicationStatusPage from "./pages/public/ApplicationStatusPage";
import DashboardPage from "./pages/dashboard/DashboardPage";
import ApplicationsPage from "./pages/organizations/ApplicationsPage";
import OrganizationsPage from "./pages/organizations/OrganizationsPage";
import OrganizationDetailsPage from "./pages/organizations/OrganizationDetailsPage";
import SettingsPage from "./pages/settings/SettingsPage";
import ContractorMarketplacePage from "./pages/marketplace/ContractorMarketplacePage";
import ContractorMarketplaceDetailPage from "./pages/marketplace/ContractorMarketplaceDetailPage";
import PartnershipsPage from "./pages/partnerships/PartnershipsPage";
import SlaAgreementsPage from "./pages/sla/SlaAgreementsPage";
import NewSlaAgreementPage from "./pages/sla/NewSlaAgreementPage";
import SlaAgreementDetailPage from "./pages/sla/SlaAgreementDetailPage";
import TicketsPage from "./pages/tickets/TicketsPage";
import NewTicketPage from "./pages/tickets/NewTicketPage";
import TicketDetailPage from "./pages/tickets/TicketDetailPage";
import TicketChatPage from "./pages/tickets/TicketChatPage";
import TicketHoldPage from "./pages/tickets/TicketHoldPage";
import TicketCompletionPage from "./pages/tickets/TicketCompletionPage";
import OperationsReportPage from "./pages/reports/OperationsReportPage";
import MlAdministrationPage from "./pages/ml/MlAdministrationPage";
import LandingPage from "./pages/public/LandingPage";

function RoleProtectedRoute({ allowedRoles, children, fallbackTo }) {
  const { user } = useAuth();
  const normalizedRole = String(user?.role_code || "").toUpperCase();

  if (!allowedRoles.includes(normalizedRole)) {
    return <Navigate to={fallbackTo} replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register-organization" element={<OrganizationRegistrationPage />} />
      <Route path="/application-status" element={<ApplicationStatusPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/change-password"
        element={
          <ProtectedRoute>
            <ChangePasswordPage />
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route
          path="/applications"
          element={
            <RoleProtectedRoute
              allowedRoles={["SUPER_ADMIN"]}
              fallbackTo="/dashboard"
            >
              <ApplicationsPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/organizations"
          element={
            <RoleProtectedRoute
              allowedRoles={["SUPER_ADMIN"]}
              fallbackTo="/dashboard"
            >
              <OrganizationsPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/organizations/:organizationId"
          element={<OrganizationDetailsPage />}
        />
        <Route path="/marketplace" element={<ContractorMarketplacePage />} />
        <Route path="/marketplace/:contractorId" element={<ContractorMarketplaceDetailPage />} />
        <Route path="/partnerships" element={<PartnershipsPage />} />
        <Route path="/sla-agreements" element={<SlaAgreementsPage />} />
        <Route path="/sla-agreements/new" element={<NewSlaAgreementPage />} />
        <Route path="/sla-agreements/:agreementId/edit" element={<NewSlaAgreementPage />} />
        <Route path="/sla-agreements/:agreementId" element={<SlaAgreementDetailPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/tickets/new" element={<NewTicketPage />} />
        <Route path="/tickets/:ticketId/chat" element={<TicketChatPage />} />
        <Route path="/tickets/:ticketId/holds" element={<TicketHoldPage />} />
        <Route path="/tickets/:ticketId/complete" element={<TicketCompletionPage />} />
        <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
        <Route path="/reports" element={<RoleProtectedRoute allowedRoles={["SUPER_ADMIN"]} fallbackTo="/dashboard"><OperationsReportPage /></RoleProtectedRoute>} />
        <Route path="/ml-admin" element={<RoleProtectedRoute allowedRoles={["SUPER_ADMIN"]} fallbackTo="/dashboard"><MlAdministrationPage /></RoleProtectedRoute>} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
