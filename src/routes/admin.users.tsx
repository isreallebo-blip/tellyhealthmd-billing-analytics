import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app-shell";
import { UserManagement } from "@/components/user-management";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "User Management — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Invite users, assign roles and companies." },
    ],
  }),
  component: () => (
    <AppShell adminOnly>
      <PageHeader
        title="User Management"
        description="Invite team members and control which companies they can access."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Users" }]}
      />
      <div className="p-4 md:p-8">
        <UserManagement />
      </div>
    </AppShell>
  ),
});
