import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/files")({
  component: FilesLayout,
});

function FilesLayout() {
  return <Outlet />;
}